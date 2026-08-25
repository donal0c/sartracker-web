const fs = require('node:fs/promises')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { parentPort, workerData } = require('node:worker_threads')

const Database = require('better-sqlite3')
const geojsonvt = require('geojson-vt').default
const vtpbf = require('vt-pbf')

const {
  createAcceptedPositionIdentity,
  createCoverageRowsQuery,
} = require('./coverage-query.cjs')
const {
  createChunkKey,
  createCoverageTileCatalog,
  createPeriodKey,
  diffCoverageTileCatalog,
  selectInvalidatedCoverageTilePaths,
} = require('./coverage-tile-catalog.cjs')
const { createTrailSegments } = require('./coverage-trail-segmentation.cjs')

const GAP_THRESHOLD_MS = 30 * 60 * 1000
const MAX_CACHE_BYTES = 512 * 1024 * 1024

if (parentPort === null) throw new Error('Coverage tile worker requires a parent port.')

const database = new Database(workerData.databasePath, { readonly: true, fileMustExist: true })
database.pragma('query_only = ON')
const chunksByKey = new Map()
const indexesByPeriod = new Map()
const cacheEntriesByPath = new Map()
let activeCatalog = null
let stagedCatalog = null
let nextStageId = 0
let cacheBytes = 0
let failCatalogCommitOnce = workerData.faultInjection?.failCatalogCommitOnce === true
let requestTail = fs.rm(workerData.cacheDirectory, { recursive: true, force: true })
  .then(() => fs.mkdir(workerData.cacheDirectory, { recursive: true }))

parentPort.on('message', (message) => {
  requestTail = requestTail.then(async () => {
    try {
      const result = await execute(message)
      parentPort.postMessage({ requestId: message.requestId, result })
    } catch (error) {
      parentPort.postMessage({
        requestId: message.requestId,
        error: error instanceof Error ? error.message : String(error),
        code: typeof error?.code === 'string' ? error.code : null,
      })
    }
  })
})

async function execute(message) {
  if (message.type === 'sync-catalog') return syncCatalog(message)
  if (message.type === 'commit-catalog') return commitCatalog(message)
  if (message.type === 'discard-catalog') return discardCatalog(message)
  if (message.type === 'read-tile') return readTile(message)
  if (message.type === 'close') {
    database.close()
    parentPort.close()
    return true
  }
  throw new Error('Coverage tile worker request type is invalid.')
}

/** Synchronizes only moved chunks and rebuilds only their contributing periods. */
async function syncCatalog(message) {
  if (stagedCatalog !== null) {
    throw new Error('Coverage tile catalog already has an uncommitted stage.')
  }
  const nextCatalog = createCoverageTileCatalog({
    missionId: message.missionId,
    chunks: message.chunks,
  })
  const missionChanged = activeCatalog !== null &&
    activeCatalog.missionId !== message.missionId
  const priorCatalog = !missionChanged && activeCatalog !== null
    ? activeCatalog
    : { missionId: message.missionId, periods: [] }
  const nextChunksByKey = missionChanged ? new Map() : new Map(chunksByKey)
  const nextIndexesByPeriod = missionChanged ? new Map() : new Map(indexesByPeriod)
  const difference = diffCoverageTileCatalog(priorCatalog, nextCatalog)
  const desiredKeys = new Set(message.chunks.map((chunk) => createChunkKey(chunk.key)))
  for (const existingKey of [...nextChunksByKey.keys()]) {
    if (!desiredKeys.has(existingKey)) nextChunksByKey.delete(existingKey)
  }

  const changed = new Set(difference.changedChunkKeys)
  const builds = []
  for (const descriptor of message.chunks) {
    const chunkKey = createChunkKey(descriptor.key)
    if (!changed.has(chunkKey) && nextChunksByKey.has(chunkKey)) continue
    const chunk = readChunkSnapshot(message.missionId, descriptor)
    nextChunksByKey.set(chunkKey, chunk)
    builds.push({
      key: descriptor.key,
      contentRev: descriptor.contentRev,
      fixCount: chunk.fixCount,
      fixDigest: chunk.fixDigest,
      minTs: chunk.minTs,
      maxTs: chunk.maxTs,
    })
    await yieldToMessages()
  }

  const invalidatedPaths = selectInvalidatedCoverageTilePaths(
    [...cacheEntriesByPath.entries()].map(([tilePath, entry]) => ({
      path: tilePath,
      contributors: entry.contributors,
    })),
    difference.changedChunkKeys,
  )
  for (const periodKey of difference.invalidatedPeriodKeys) {
    const features = [...nextChunksByKey.values()]
      .filter((chunk) => createPeriodKey(chunk.key) === periodKey)
      .flatMap((chunk) => chunk.features)
    if (features.length === 0) {
      nextIndexesByPeriod.delete(periodKey)
    } else {
      nextIndexesByPeriod.set(periodKey, geojsonvt({ type: 'FeatureCollection', features }, {
        maxZoom: 16,
        indexMaxZoom: 8,
        indexMaxPoints: 100_000,
        tolerance: 3,
        buffer: 64,
        lineMetrics: false,
        promoteId: null,
      }))
    }
  }
  const stageId = `coverage-stage-${++nextStageId}`
  stagedCatalog = {
    stageId,
    nextCatalog,
    nextChunksByKey,
    nextIndexesByPeriod,
    invalidatedPaths,
    missionChanged,
  }
  return {
    stageId,
    periods: nextCatalog.periods.map(({ periodKey, revisionDigest, contributors }) => ({
      periodKey, revisionDigest, contributors,
    })),
    delivered: message.chunks.map((chunk) => ({
      key: chunk.key,
      contentRev: chunk.contentRev,
    })),
    builds,
  }
}

/** Publishes a staged catalog only after main-side build metadata commits. */
async function commitCatalog(message) {
  const stage = requireStagedCatalog(message.stageId)
  try {
    if (failCatalogCommitOnce) {
      failCatalogCommitOnce = false
      throw new Error('Injected coverage catalog commit failure.')
    }
    if (stage.missionChanged) {
      cacheEntriesByPath.clear()
      cacheBytes = 0
      await fs.rm(workerData.cacheDirectory, { recursive: true, force: true })
      await fs.mkdir(workerData.cacheDirectory, { recursive: true })
    } else {
      for (const tilePath of stage.invalidatedPaths) await removeCacheEntry(tilePath)
    }
    chunksByKey.clear()
    for (const [key, chunk] of stage.nextChunksByKey) chunksByKey.set(key, chunk)
    indexesByPeriod.clear()
    for (const [key, index] of stage.nextIndexesByPeriod) indexesByPeriod.set(key, index)
    activeCatalog = stage.nextCatalog
    stagedCatalog = null
    return true
  } catch (error) {
    stagedCatalog = null
    throw error
  }
}

/** Discards a stale stage while leaving the active catalog serviceable. */
function discardCatalog(message) {
  requireStagedCatalog(message.stageId)
  stagedCatalog = null
  return true
}

/** Resolves only the current opaque stage token. */
function requireStagedCatalog(stageId) {
  if (stagedCatalog === null || stagedCatalog.stageId !== stageId) {
    throw new Error('Coverage tile catalog stage is no longer current.')
  }
  return stagedCatalog
}

/** Reads and segments one logical chunk in a single SQLite snapshot. */
function readChunkSnapshot(missionId, descriptor) {
  const read = database.transaction(() => {
    const ledger = database.prepare(`SELECT content_rev FROM coverage_chunks
      WHERE mission_id = ? AND device_id = ? AND period_kind = ? AND period_id = ?`)
      .get(
        missionId,
        descriptor.key.device_id,
        descriptor.key.period_kind,
        descriptor.key.period_id,
      )
    if (ledger?.content_rev !== descriptor.contentRev) {
      const error = new Error('chunk-stale: coverage tile chunk revision changed')
      error.code = 'chunk-stale'
      throw error
    }
    const query = createCoverageRowsQuery(database, missionId, descriptor.key)
    const rows = [...query.statement.iterate(...query.params)]
    return materializeChunk(descriptor.key, descriptor.contentRev, rows)
  })
  return read()
}

/** Materializes the same lossless 30-minute segmentation used by live trails. */
function materializeChunk(key, contentRev, rows) {
  const chunkKey = createChunkKey(key)
  const digest = createHash('sha256')
  for (let index = 0; index < rows.length; index += 1) {
    if (index > 0) digest.update('\n')
    digest.update(createAcceptedPositionIdentity(rows[index]))
  }
  const segments = createTrailSegments(rows, GAP_THRESHOLD_MS)
  return {
    key,
    contentRev,
    fixCount: rows.length,
    fixDigest: digest.digest('hex'),
    minTs: rows[0]?.timestamp ?? null,
    maxTs: rows.at(-1)?.timestamp ?? null,
    features: segments.map((segment, index) => ({
      type: 'Feature',
      id: `${chunkKey}:${contentRev}:${index}`,
      geometry: segment.length === 1
        ? { type: 'Point', coordinates: [segment[0].lon, segment[0].lat] }
        : {
            type: 'LineString',
            coordinates: segment.map((position) => [position.lon, position.lat]),
          },
      properties: {
        chunk_key: chunkKey,
        device_id: key.device_id,
        period_kind: key.period_kind,
        period_id: key.period_id,
        content_rev: contentRev,
      },
    })),
  }
}

/** Serves only the currently attested revision for one logical period. */
async function readTile(message) {
  const stagedPeriod = stagedCatalog?.nextCatalog.periods.find((entry) =>
    entry.periodKey === message.periodKey && entry.revisionDigest === message.revisionDigest)
  const activePeriod = activeCatalog?.periods.find((entry) =>
    entry.periodKey === message.periodKey && entry.revisionDigest === message.revisionDigest)
  const servingCatalog = stagedPeriod === undefined
    ? (activePeriod === undefined ? null : activeCatalog)
    : stagedCatalog.nextCatalog
  if (servingCatalog === null) return null
  const servingIndexes = stagedPeriod === undefined
    ? indexesByPeriod
    : stagedCatalog.nextIndexesByPeriod
  const index = servingIndexes.get(message.periodKey)
  if (index === undefined) return Buffer.alloc(0)
  const tile = index.getTile(message.z, message.x, message.y)
  if (!tile) return Buffer.alloc(0)
  const contributors = readTileContributors(tile)
  const safeMission = hashPath(servingCatalog.missionId)
  const safePeriod = hashPath(message.periodKey)
  const contributorDigest = hashPath(contributors.join('\n'))
  const tilePath = path.join(
    workerData.cacheDirectory,
    safeMission,
    safePeriod,
    String(message.z),
    String(message.x),
    `${message.y}-${contributorDigest}.pbf`,
  )
  const cached = await fs.readFile(tilePath).catch(() => null)
  if (cached !== null) {
    const entry = cacheEntriesByPath.get(tilePath)
    if (entry !== undefined) entry.lastAccess = Date.now()
    return cached
  }
  const bytes = Buffer.from(vtpbf.fromGeojsonVt(
    { coverage: tile },
    { version: 2, extent: 4096 },
  ))
  await fs.mkdir(path.dirname(tilePath), { recursive: true })
  await fs.writeFile(tilePath, bytes)
  cacheEntriesByPath.set(tilePath, {
    contributors,
    size: bytes.byteLength,
    lastAccess: Date.now(),
  })
  cacheBytes += bytes.byteLength
  await enforceCacheBudget()
  return bytes
}

function readTileContributors(tile) {
  const contributors = new Set()
  for (const feature of tile.features ?? []) {
    const tags = feature.tags ?? {}
    contributors.add(`${String(tags.chunk_key)}@${String(tags.content_rev)}`)
  }
  return [...contributors].sort()
}

async function enforceCacheBudget() {
  if (cacheBytes <= MAX_CACHE_BYTES) return
  const oldest = [...cacheEntriesByPath.entries()]
    .sort((left, right) => left[1].lastAccess - right[1].lastAccess)
  for (const [tilePath] of oldest) {
    await removeCacheEntry(tilePath)
    if (cacheBytes <= MAX_CACHE_BYTES) break
  }
}

async function removeCacheEntry(tilePath) {
  const entry = cacheEntriesByPath.get(tilePath)
  cacheEntriesByPath.delete(tilePath)
  if (entry !== undefined) cacheBytes -= entry.size
  await fs.rm(tilePath, { force: true })
}

function hashPath(value) {
  return createHash('sha256').update(value).digest('hex').slice(0, 24)
}

function yieldToMessages() {
  return new Promise((resolve) => setImmediate(resolve))
}
