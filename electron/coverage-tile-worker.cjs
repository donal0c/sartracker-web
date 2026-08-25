const fs = require('node:fs/promises')
const path = require('node:path')
const { createHash, randomUUID } = require('node:crypto')
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
const { replaceCoverageTileCacheEntry } = require('./coverage-tile-cache-ledger.cjs')

const GAP_THRESHOLD_MS = 30 * 60 * 1000
const MAX_CACHE_BYTES = 512 * 1024 * 1024

if (parentPort === null) throw new Error('Coverage tile worker requires a parent port.')

const database = new Database(workerData.databasePath, { readonly: true, fileMustExist: true })
database.pragma('query_only = ON')
let chunksByKey = new Map()
let indexesByPeriod = new Map()
const cacheEntriesByPath = new Map()
let activeCatalog = null
let stagedCatalog = null
let activatedCatalog = null
let nextStageId = 0
const workerGeneration = randomUUID()
let cacheBytes = 0
let failCatalogCommitOnce = workerData.faultInjection?.failCatalogCommitOnce === true
const cancelledRequestIds = new Set()
const activeTileRequestIds = new Set()
const queuedCatalogRequestIds = new Set()
const initialization = fs.rm(workerData.cacheDirectory, { recursive: true, force: true })
  .then(() => fs.mkdir(workerData.cacheDirectory, { recursive: true }))
let requestTail = initialization

parentPort.on('message', (message) => {
  if (message.type === 'cancel-request') {
    if (activeTileRequestIds.has(message.targetRequestId)) {
      cancelledRequestIds.add(message.targetRequestId)
      return
    }
    if (stagedCatalog?.requestId === message.targetRequestId) {
      stagedCatalog = null
      return
    }
    if (queuedCatalogRequestIds.has(message.targetRequestId)) {
      cancelledRequestIds.add(message.targetRequestId)
    }
    return
  }
  const respond = async () => {
    try {
      const result = await execute(message)
      if (
        message.type === 'sync-catalog' &&
        workerData.faultInjection?.catalogResponseDelayMs > 0
      ) {
        await delay(workerData.faultInjection.catalogResponseDelayMs)
      }
      parentPort.postMessage({ requestId: message.requestId, result })
    } catch (error) {
      parentPort.postMessage({
        requestId: message.requestId,
        error: error instanceof Error ? error.message : String(error),
        code: typeof error?.code === 'string' ? error.code : null,
      })
    } finally {
      if (message.type !== 'read-tile') queuedCatalogRequestIds.delete(message.requestId)
    }
  }
  if (message.type === 'read-tile') {
    activeTileRequestIds.add(message.requestId)
    void initialization.then(respond)
    return
  }
  queuedCatalogRequestIds.add(message.requestId)
  requestTail = requestTail.then(respond)
})

async function execute(message) {
  if (message.type === 'sync-catalog') return syncCatalog(message)
  if (message.type === 'commit-catalog') return commitCatalog(message)
  if (message.type === 'finalize-catalog') return finalizeCatalog(message)
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
  throwIfRequestCancelled(message.requestId)
  if (stagedCatalog !== null || activatedCatalog !== null) {
    throw new Error('Coverage tile catalog already has an unsettled stage.')
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
    if (workerData.faultInjection?.chunkBuildDelayMs > 0) {
      await delay(workerData.faultInjection.chunkBuildDelayMs)
    }
    await yieldToMessages()
    throwIfRequestCancelled(message.requestId)
  }

  const invalidatedPaths = selectInvalidatedCoverageTilePaths(
    [...cacheEntriesByPath.entries()].map(([tilePath, entry]) => ({
      path: tilePath,
      contributors: entry.contributors,
    })),
    difference.changedChunkKeys,
  )
  for (const periodKey of difference.invalidatedPeriodKeys) {
    throwIfRequestCancelled(message.requestId)
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
    await yieldToMessages()
  }
  throwIfRequestCancelled(message.requestId)
  const stageId = `coverage-stage-${workerGeneration}-${++nextStageId}`
  stagedCatalog = {
    requestId: message.requestId,
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

/** Aborts a cooperative catalog build without discarding the finalized catalog. */
function throwIfRequestCancelled(requestId) {
  if (!cancelledRequestIds.delete(requestId)) return
  const error = new Error('Coverage tile request was cancelled.')
  error.name = 'AbortError'
  error.code = 'request-cancelled'
  throw error
}

/** Publishes a staged catalog only after main-side build metadata commits. */
async function commitCatalog(message) {
  const stage = requireStagedCatalog(message.stageId)
  try {
    if (failCatalogCommitOnce) {
      failCatalogCommitOnce = false
      throw new Error('Injected coverage catalog commit failure.')
    }
    const predecessor = {
      catalog: activeCatalog,
      chunksByKey,
      indexesByPeriod,
    }
    activatedCatalog = {
      stageId: stage.stageId,
      predecessor,
      retiredPaths: stage.missionChanged
        ? [...cacheEntriesByPath.keys()]
        : stage.invalidatedPaths,
    }
    chunksByKey = stage.nextChunksByKey
    indexesByPeriod = stage.nextIndexesByPeriod
    activeCatalog = stage.nextCatalog
    stagedCatalog = null
    return true
  } catch (error) {
    stagedCatalog = null
    throw error
  }
}

/** Retires the predecessor only after renderer activation is irrevocable. */
async function finalizeCatalog(message) {
  const activation = requireActivatedCatalog(message.stageId)
  activatedCatalog = null
  for (const tilePath of activation.retiredPaths) {
    await removeCacheEntry(tilePath).catch(() => undefined)
  }
  return true
}

/** Discards a stale stage or rolls a committed stage back to its predecessor. */
function discardCatalog(message) {
  if (stagedCatalog?.stageId === message.stageId) {
    stagedCatalog = null
    return true
  }
  const activation = requireActivatedCatalog(message.stageId)
  activeCatalog = activation.predecessor.catalog
  chunksByKey = activation.predecessor.chunksByKey
  indexesByPeriod = activation.predecessor.indexesByPeriod
  activatedCatalog = null
  return true
}

/** Resolves only the currently committed but not finalized stage token. */
function requireActivatedCatalog(stageId) {
  if (activatedCatalog === null || activatedCatalog.stageId !== stageId) {
    throw new Error('Coverage tile catalog activation is no longer current.')
  }
  return activatedCatalog
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
  try {
    return await readTileUncancelled(message)
  } finally {
    activeTileRequestIds.delete(message.requestId)
    cancelledRequestIds.delete(message.requestId)
  }
}

/** Serves one tile while observing renderer cancellation between expensive steps. */
async function readTileUncancelled(message) {
  throwIfRequestCancelled(message.requestId)
  const stagedPeriod = stagedCatalog?.nextCatalog.periods.find((entry) =>
    stagedCatalog.nextCatalog.missionId === message.missionId &&
    entry.periodKey === message.periodKey && entry.revisionDigest === message.revisionDigest)
  const activePeriod = activeCatalog?.periods.find((entry) =>
    activeCatalog.missionId === message.missionId &&
    entry.periodKey === message.periodKey && entry.revisionDigest === message.revisionDigest)
  const predecessorPeriod = activatedCatalog?.predecessor.catalog?.periods.find((entry) =>
    activatedCatalog.predecessor.catalog.missionId === message.missionId &&
    entry.periodKey === message.periodKey && entry.revisionDigest === message.revisionDigest)
  const servingCatalog = stagedPeriod === undefined
    ? (activePeriod === undefined
        ? (predecessorPeriod === undefined ? null : activatedCatalog.predecessor.catalog)
        : activeCatalog)
    : stagedCatalog.nextCatalog
  if (servingCatalog === null) return null
  const servingIndexes = stagedPeriod !== undefined
    ? stagedCatalog.nextIndexesByPeriod
    : activePeriod !== undefined
      ? indexesByPeriod
      : activatedCatalog.predecessor.indexesByPeriod
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
  throwIfRequestCancelled(message.requestId)
  if (cached !== null) {
    const entry = cacheEntriesByPath.get(tilePath)
    if (entry !== undefined) {
      entry.lastAccess = Date.now()
    } else {
      cacheBytes = replaceCoverageTileCacheEntry(cacheEntriesByPath, tilePath, {
        contributors,
        size: cached.byteLength,
        lastAccess: Date.now(),
      }, cacheBytes)
      await enforceCacheBudget()
    }
    return cached
  }
  const bytes = Buffer.from(vtpbf.fromGeojsonVt(
    { coverage: tile },
    { version: 2, extent: 4096 },
  ))
  throwIfRequestCancelled(message.requestId)
  await fs.mkdir(path.dirname(tilePath), { recursive: true })
  await fs.writeFile(tilePath, bytes)
  throwIfRequestCancelled(message.requestId)
  cacheBytes = replaceCoverageTileCacheEntry(cacheEntriesByPath, tilePath, {
    contributors,
    size: bytes.byteLength,
    lastAccess: Date.now(),
  }, cacheBytes)
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

function delay(durationMs) {
  return new Promise((resolve) => setTimeout(resolve, durationMs))
}
