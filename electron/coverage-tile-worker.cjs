const fs = require('node:fs/promises')
const path = require('node:path')
const { createHash, randomUUID } = require('node:crypto')
const v8 = require('node:v8')
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
const { normalizeCoverageTileAddress } = require('./coverage-tile-address.cjs')
const { replaceCoverageTileCacheEntry } = require('./coverage-tile-cache-ledger.cjs')

// Must equal coverage-trail-segmentation.cjs createTrailSegments(rows, 30 min):
// a new segment starts only where Date.parse(next) - Date.parse(previous) > 30 min.
const GAP_THRESHOLD_MS = 30 * 60 * 1000
const MAX_CACHE_BYTES = 512 * 1024 * 1024
const TILE_INDEX_OPTIONS = Object.freeze({
  maxZoom: 16,
  indexMaxZoom: 8,
  indexMaxPoints: 100_000,
  tolerance: 3,
  extent: 4096,
  buffer: 64,
  lineMetrics: false,
  promoteId: null,
})
// geojson-vt caches every tile it drills below its pre-built index, forever,
// which exhausted the worker heap (COV-1). Drill-downs here run on a throwaway
// copy of the index state instead; only clipped sources at these zoom levels
// are kept, in a least-recently-used cache bounded by the fixes its entries
// retain and by its entry count (empty-tile entries included). Entries of an
// index are released as soon as no catalog can serve that index any more.
const SOURCE_CACHE_LEVELS = Object.freeze([10, 12, 14])
const DEFAULT_SOURCE_CACHE_POINTS = 2_000_000
const DEFAULT_SOURCE_CACHE_ENTRIES = 8_192
const sourceCacheBudgetPoints = readTuningLimit('sourceCachePoints', DEFAULT_SOURCE_CACHE_POINTS)
const sourceCacheBudgetEntries = readTuningLimit('sourceCacheEntries', DEFAULT_SOURCE_CACHE_ENTRIES)

if (parentPort === null) throw new Error('Coverage tile worker requires a parent port.')

const database = new Database(workerData.databasePath, { readonly: true, fileMustExist: true })
database.pragma('query_only = ON')
let chunksByKey = new Map()
let indexesByPeriod = new Map()
const cacheEntriesByPath = new Map()
let activeCatalog = null
let stagedCatalog = null
let activatedCatalog = null
let finalizedCatalogStageId = null
let nextStageId = 0
const workerGeneration = randomUUID()
let cacheBytes = 0
let failCatalogCommitOnce = workerData.faultInjection?.failCatalogCommitOnce === true
const sourceCache = new Map()
const sourceCacheKeysByIndexId = new Map()
// Each coordinate array cache entries hold, with the number of entries holding
// it. The charge counts every such array once, however many entries share it,
// and only while an entry holds it. Arrays of the entry's own index are
// counted but not charged: the index keeps them alive anyway and the cache
// never outlives the index (its entries are purged when it retires).
const sourceArrayReferences = new Map()
let sourceCachePoints = 0
// Cumulative cache events, read only by diagnostics.
const sourceCacheEvents = { evicted: 0, purged: 0, sharedArrayKeptAlive: 0, uncachedOversized: 0 }
let nextTileIndexId = 0
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
      releaseRetiredSourceCacheEntries()
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
  if (message.type === 'read-diagnostics') return readDiagnostics()
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

  if (workerData.faultInjection?.exhaustHeapOnSync === true) exhaustHeap()
  const changed = new Set(difference.changedChunkKeys)
  for (const descriptor of message.chunks) {
    const chunkKey = createChunkKey(descriptor.key)
    if (!changed.has(chunkKey) && nextChunksByKey.has(chunkKey)) continue
    const chunk = readChunkSnapshot(message.missionId, descriptor)
    nextChunksByKey.set(chunkKey, chunk)
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
    // Chunk order is the map's insertion order, exactly the feature order the
    // single period-wide index used before per-chunk indexes replaced it.
    const periodChunks = Object.freeze([...nextChunksByKey.values()]
      .filter((chunk) => createPeriodKey(chunk.key) === periodKey && chunk.featureCount > 0))
    if (periodChunks.length === 0) {
      nextIndexesByPeriod.delete(periodKey)
    } else {
      nextIndexesByPeriod.set(periodKey, periodChunks)
    }
    await yieldToMessages()
  }
  throwIfRequestCancelled(message.requestId)
  const builds = message.chunks.map((descriptor) => {
    const chunk = nextChunksByKey.get(createChunkKey(descriptor.key))
    if (chunk === undefined || chunk.contentRev !== descriptor.contentRev) {
      throw new Error('Coverage tile chunk evidence is unavailable for delivery.')
    }
    return {
      key: descriptor.key,
      contentRev: descriptor.contentRev,
      fixCount: chunk.fixCount,
      fixDigest: chunk.fixDigest,
      minTs: chunk.minTs,
      maxTs: chunk.maxTs,
    }
  })
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
  if (activatedCatalog?.stageId === message.stageId) return true
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
    releaseRetiredSourceCacheEntries()
    throw error
  }
}

/** Retires the predecessor only after renderer activation is irrevocable. */
async function finalizeCatalog(message) {
  if (finalizedCatalogStageId === message.stageId) return true
  if (stagedCatalog === null && activatedCatalog === null) return true
  const activation = requireActivatedCatalog(message.stageId)
  for (const tilePath of activation.retiredPaths) {
    await removeCacheEntry(tilePath).catch(() => undefined)
  }
  activatedCatalog = null
  finalizedCatalogStageId = message.stageId
  releaseRetiredSourceCacheEntries()
  return true
}

/** Discards a stale stage or rolls a committed stage back to its predecessor. */
function discardCatalog(message) {
  if (stagedCatalog?.stageId === message.stageId) {
    stagedCatalog = null
    releaseRetiredSourceCacheEntries()
    return true
  }
  if (stagedCatalog === null && activatedCatalog === null) return true
  const activation = requireActivatedCatalog(message.stageId)
  activeCatalog = activation.predecessor.catalog
  chunksByKey = activation.predecessor.chunksByKey
  indexesByPeriod = activation.predecessor.indexesByPeriod
  activatedCatalog = null
  releaseRetiredSourceCacheEntries()
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
    return materializeChunk(
      descriptor.key,
      descriptor.contentRev,
      query.statement.iterate(...query.params),
    )
  })
  return read()
}

/**
 * Streams one chunk's ordered rows into the same lossless 30-minute
 * segmentation used by live trails, then keeps only its compact tile index.
 * Rows are never held as an array: only each segment's [lon, lat] pairs live
 * until the index is built, and those are released when this returns.
 * @param {{device_id: string, period_kind: string, period_id: string}} key
 * @param {number} contentRev
 * @param {Iterable<{id: string, source_position_id: string|null, timestamp: string, lat: number, lon: number}>} rows
 */
function materializeChunk(key, contentRev, rows) {
  const chunkKey = createChunkKey(key)
  const digest = createHash('sha256')
  const segments = []
  let segment = null
  let previousTime = 0
  let fixCount = 0
  let minTs = null
  let maxTs = null
  for (const row of rows) {
    if (fixCount > 0) digest.update('\n')
    digest.update(createAcceptedPositionIdentity(row))
    const time = Date.parse(row.timestamp)
    if (segment === null || time - previousTime > GAP_THRESHOLD_MS) {
      segment = []
      segments.push(segment)
    }
    segment.push([row.lon, row.lat])
    previousTime = time
    if (fixCount === 0) minTs = row.timestamp ?? null
    maxTs = row.timestamp ?? null
    fixCount += 1
  }
  const features = segments.map((coordinates, index) => ({
    type: 'Feature',
    id: `${chunkKey}:${contentRev}:${index}`,
    geometry: coordinates.length === 1
      ? { type: 'Point', coordinates: coordinates[0] }
      : { type: 'LineString', coordinates },
    properties: {
      chunk_key: chunkKey,
      device_id: key.device_id,
      period_kind: key.period_kind,
      period_id: key.period_id,
      content_rev: contentRev,
    },
  }))
  return {
    key,
    contentRev,
    fixCount,
    fixDigest: digest.digest('hex'),
    minTs,
    maxTs,
    featureCount: features.length,
    tileIndex: features.length === 0 ? null : createChunkTileIndex(features),
    lineMarkers: features
      .filter((feature) => feature.geometry.type === 'LineString')
      .map(createLineMarker),
  }
}

/**
 * Builds one chunk's geojson-vt index. Its pre-built tiles are never drilled
 * in place (see readChunkTile), so the index keeps exactly its post-build state.
 * @param {object[]} features GeoJSON features of one chunk, in segment order.
 */
function createChunkTileIndex(features) {
  const index = geojsonvt({ type: 'FeatureCollection', features }, TILE_INDEX_OPTIONS)
  // Arrays the index itself holds live exactly as long as the index; cache
  // entries never outlive it (they are purged when it retires), so the cache
  // is not charged for them.
  const ownArrays = new Set()
  for (const tileId of Object.keys(index.tiles)) {
    const tile = index.tiles[tileId]
    if (tile.source === null) continue
    for (const feature of tile.source) compactSourceGeometry(feature)
    for (const array of collectSourceArrays(tile)) ownArrays.add(array)
  }
  return { id: ++nextTileIndexId, index, prototype: Object.getPrototypeOf(index), ownArrays }
}

/**
 * Stores one retained source geometry as an exact Float64Array copy instead
 * of a growable JS array of doubles. geojson-vt only indexes these arrays and
 * reads their size/start/end fields when clipping and simplifying, so the
 * tiles it derives are identical; the copy holds 24 bytes per fix and lives
 * outside the JavaScript heap.
 * @param {{type: string, geometry: number[] & {size?: number, start?: number, end?: number}}} feature
 */
function compactSourceGeometry(feature) {
  if (feature.type === 'LineString' || feature.type === 'Point' || feature.type === 'MultiPoint') {
    feature.geometry = compactCoordinates(feature.geometry)
    return
  }
  if (feature.type === 'MultiLineString') {
    // Clipping a line that leaves and re-enters a tile yields several parts.
    for (let part = 0; part < feature.geometry.length; part += 1) {
      feature.geometry[part] = compactCoordinates(feature.geometry[part])
    }
    return
  }
  throw new Error(`Coverage tile index has an unexpected ${feature.type} source geometry.`)
}

/** Copies one flat [x, y, importance, ...] array, keeping its line metrics. */
function compactCoordinates(coordinates) {
  if (coordinates instanceof Float64Array) return coordinates
  const compact = Float64Array.from(coordinates)
  if (coordinates.size !== undefined) compact.size = coordinates.size
  if (coordinates.start !== undefined) compact.start = coordinates.start
  if (coordinates.end !== undefined) compact.end = coordinates.end
  return compact
}

/**
 * Records what is needed to keep a short line visible as a dot (COV-5):
 * geojson-vt drops a whole line below max zoom when its total projected length
 * is under the simplification tolerance. Size and first vertex use geojson-vt's
 * own projection and length formula so the drop decision matches exactly.
 * @param {{id: string, geometry: {coordinates: number[][]}, properties: object}} feature
 */
function createLineMarker(feature) {
  const coordinates = feature.geometry.coordinates
  let size = 0
  let x0 = 0
  let y0 = 0
  for (let index = 0; index < coordinates.length; index += 1) {
    const x = projectX(coordinates[index][0])
    const y = projectY(coordinates[index][1])
    if (index > 0) size += Math.sqrt(Math.pow(x - x0, 2) + Math.pow(y - y0, 2))
    x0 = x
    y0 = y
  }
  return Object.freeze({
    id: feature.id,
    tags: feature.properties,
    size: Math.abs(size),
    x: projectX(coordinates[0][0]),
    y: projectY(coordinates[0][1]),
  })
}

/** Same Web Mercator X projection as geojson-vt's convert step. */
function projectX(lon) {
  return lon / 360 + 0.5
}

/** Same clamped Web Mercator Y projection as geojson-vt's convert step. */
function projectY(lat) {
  const sin = Math.sin(lat * Math.PI / 180)
  const y = 0.5 - 0.25 * Math.log((1 + sin) / (1 - sin)) / Math.PI
  return y < 0 ? 0 : y > 1 ? 1 : y
}

/**
 * Composes one period tile from its chunks' indexes in period order. Each
 * geojson-vt feature is clipped and simplified independently, so the
 * concatenation equals the tile of one index built from all features. Dots for
 * lines dropped at this zoom are appended after every indexed feature.
 * @param {readonly object[]} periodChunks chunks of one period, in period order
 * @returns {{features: object[]} | null}
 */
function readPeriodTile(periodChunks, z, x, y) {
  let found = false
  const features = []
  for (const chunk of periodChunks) {
    if (chunk.tileIndex === null) continue
    const tile = readChunkTile(chunk.tileIndex, z, x, y)
    if (!tile) continue
    found = true
    for (const feature of tile.features) features.push(feature)
  }
  if (z < TILE_INDEX_OPTIONS.maxZoom) {
    const tolerance = TILE_INDEX_OPTIONS.tolerance / ((1 << z) * TILE_INDEX_OPTIONS.extent)
    const z2 = 1 << z
    const buffer = TILE_INDEX_OPTIONS.buffer / TILE_INDEX_OPTIONS.extent
    for (const chunk of periodChunks) {
      for (const marker of chunk.lineMarkers) {
        if (!(marker.size < tolerance)) continue
        const tileX = marker.x * z2 - x
        const tileY = marker.y * z2 - y
        if (tileX < -buffer || tileX > 1 + buffer || tileY < -buffer || tileY > 1 + buffer) continue
        found = true
        features.push({
          geometry: [[
            Math.round(TILE_INDEX_OPTIONS.extent * tileX),
            Math.round(TILE_INDEX_OPTIONS.extent * tileY),
          ]],
          type: 1,
          tags: marker.tags,
          id: marker.id,
        })
      }
    }
  }
  return found ? { features } : null
}

/**
 * Reads one chunk tile with geojson-vt's own getTile/splitTile/clip/transform,
 * but never lets it cache drilled tiles in the retained index. A drill starts
 * from the nearest pre-built ancestor that getTile itself would choose, or from
 * a cached clipped source on that same ancestor chain, and runs on a throwaway
 * index object; clipping the same chain from either start gives the same tile.
 * @returns {object | null} the transformed geojson-vt tile, or null
 */
function readChunkTile(tileIndex, z, x, y) {
  const index = tileIndex.index
  if (index.tiles[toGeojsonVtTileId(z, x, y)] !== undefined) return index.getTile(z, x, y)
  let start = null
  for (let parentZ = z - 1; parentZ >= 0 && start === null; parentZ -= 1) {
    const parentX = x >> (z - parentZ)
    const parentY = y >> (z - parentZ)
    const tile = index.tiles[toGeojsonVtTileId(parentZ, parentX, parentY)]
    if (tile !== undefined) start = createDrillStart(parentZ, parentX, parentY, tile)
  }
  if (start === null || !start.source) return null
  for (const level of SOURCE_CACHE_LEVELS) {
    if (level <= start.z || level >= z) continue
    start = readCachedSource(tileIndex, start, level, x >> (z - level), y >> (z - level))
    if (start === null) return null
  }
  return createScratchIndex(tileIndex, start).getTile(z, x, y)
}

/** Captures what splitTile reads from a parent tile: its source and bounds. */
function createDrillStart(z, x, y, tile) {
  return Object.freeze({
    z, x, y,
    source: tile.source,
    minX: tile.minX,
    minY: tile.minY,
    maxX: tile.maxX,
    maxY: tile.maxY,
  })
}

/**
 * Creates a disposable geojson-vt index holding only a copy of the drill start
 * tile, so splitTile's writes (new tiles, source = null) never reach the
 * retained index.
 */
function createScratchIndex(tileIndex, start) {
  const scratch = Object.create(tileIndex.prototype)
  scratch.options = tileIndex.index.options
  scratch.tiles = {
    [toGeojsonVtTileId(start.z, start.x, start.y)]: {
      source: start.source,
      minX: start.minX,
      minY: start.minY,
      maxX: start.maxX,
      maxY: start.maxY,
    },
  }
  scratch.tileCoords = []
  return scratch
}

/**
 * Returns the clipped source of one tile at a cache level, drilling it from
 * start on a scratch index when it is not cached. Returns null when the chain
 * has no geometry there, which is exactly when getTile would return null.
 */
function readCachedSource(tileIndex, start, level, x, y) {
  const key = `${tileIndex.id}/${level}/${x}/${y}`
  if (sourceCache.has(key)) {
    const cached = sourceCache.get(key)
    sourceCache.delete(key)
    sourceCache.set(key, cached)
    return cached.start
  }
  const scratch = createScratchIndex(tileIndex, start)
  scratch.splitTile(start.source, start.z, start.x, start.y, level, x, y)
  const tile = scratch.tiles[toGeojsonVtTileId(level, x, y)]
  let next = null
  if (tile !== undefined) {
    for (const feature of tile.source) compactSourceGeometry(feature)
    next = createDrillStart(level, x, y, tile)
  }
  const arrays = [...new Set(collectSourceArrays(next))]
  const points = arrays.reduce((sum, array) => sum + chargeOf(array, tileIndex.ownArrays), 0)
  setSourceCacheEntry(key, tileIndex, { start: next, arrays, points })
  return next
}

/**
 * Inserts one cache entry, then evicts least-recently-used entries until both
 * the retained-fix budget and the entry budget hold. An entry whose charge
 * alone exceeds the budget is not cached at all: the caller still
 * serves the current read from its local value, so the cache's charge never
 * exceeds the budget. An array is charged when its first entry arrives.
 * @param {string} key
 * @param {{id: number, ownArrays: Set<Float64Array>}} tileIndex
 * @param {{start: object | null, arrays: Float64Array[], points: number}} entry
 *   arrays: the distinct arrays the entry holds; points: what they cost beyond its own index
 */
function setSourceCacheEntry(key, tileIndex, entry) {
  const indexId = tileIndex.id
  if (entry.points > sourceCacheBudgetPoints) {
    sourceCacheEvents.uncachedOversized += 1
    return
  }
  if (sourceCacheBudgetEntries === 0) return
  sourceCache.set(key, { start: entry.start, arrays: entry.arrays, indexId, ownArrays: tileIndex.ownArrays })
  for (const array of entry.arrays) {
    const references = sourceArrayReferences.get(array) ?? 0
    if (references === 0) sourceCachePoints += chargeOf(array, tileIndex.ownArrays)
    sourceArrayReferences.set(array, references + 1)
  }
  let keys = sourceCacheKeysByIndexId.get(indexId)
  if (keys === undefined) {
    keys = new Set()
    sourceCacheKeysByIndexId.set(indexId, keys)
  }
  keys.add(key)
  for (const cachedKey of sourceCache.keys()) {
    if (cachedKey === key) break
    if (sourceCachePoints <= sourceCacheBudgetPoints &&
      sourceCache.size <= sourceCacheBudgetEntries) break
    deleteSourceCacheEntry(cachedKey, 'evicted')
  }
}

/**
 * Removes one cache entry and its charge.
 * @param {string} key
 * @param {'evicted' | 'purged'} reason counted for diagnostics
 */
function deleteSourceCacheEntry(key, reason) {
  const cached = sourceCache.get(key)
  if (cached === undefined) return
  sourceCacheEvents[reason] += 1
  sourceCache.delete(key)
  // An array is uncharged exactly when the last entry holding it goes.
  for (const array of cached.arrays) {
    const references = sourceArrayReferences.get(array) - 1
    if (references === 0) {
      sourceArrayReferences.delete(array)
      sourceCachePoints -= chargeOf(array, cached.ownArrays)
    } else {
      sourceArrayReferences.set(array, references)
      if (reason === 'evicted') sourceCacheEvents.sharedArrayKeptAlive += 1
    }
  }
  const keys = sourceCacheKeysByIndexId.get(cached.indexId)
  keys?.delete(key)
  if (keys?.size === 0) sourceCacheKeysByIndexId.delete(cached.indexId)
}

/**
 * Releases every cache entry of an index that no catalog (active, staged or
 * retained predecessor) can serve any more, so a replaced chunk revision's
 * geometry is never kept alive by the cache and is never served again.
 */
function releaseRetiredSourceCacheEntries() {
  const live = collectServableIndexIds()
  for (const [indexId, keys] of [...sourceCacheKeysByIndexId]) {
    if (live.has(indexId)) continue
    for (const key of [...keys]) deleteSourceCacheEntry(key, 'purged')
  }
}

/** Index ids reachable from any catalog a tile can still be served from. */
function collectServableIndexIds() {
  const live = new Set()
  const add = (chunks) => {
    for (const chunk of chunks?.values() ?? []) {
      if (chunk.tileIndex !== null) live.add(chunk.tileIndex.id)
    }
  }
  add(chunksByKey)
  add(stagedCatalog?.nextChunksByKey)
  add(activatedCatalog?.predecessor.chunksByKey)
  return live
}

/** Read-only cache and heap figures for diagnostics and memory tests. */
function readDiagnostics() {
  const heap = v8.getHeapStatistics()
  const live = collectServableIndexIds()
  return {
    sourceCacheEntries: sourceCache.size,
    sourceCachePoints,
    sourceCacheRetainedPoints: countRetainedSourceCachePoints(),
    sourceCacheEvents: { ...sourceCacheEvents },
    sourceCacheDistinctArrays: sourceArrayReferences.size,
    sourceCacheReferenceMismatches: countReferenceMismatches(),
    sourceCacheBudgetPoints,
    sourceCacheBudgetEntries,
    sourceCacheIndexIds: [...sourceCacheKeysByIndexId.keys()],
    servableIndexIds: [...live],
    usedHeapBytes: heap.used_heap_size,
    externalBytes: heap.external_memory ?? null,
  }
}

/**
 * Recounts from the entries' sources themselves, independently of the running
 * charge and reference counts, the fixes in the distinct arrays the cache
 * keeps alive beyond each entry's own index (an array shared by several
 * entries counts once).
 */
function countRetainedSourceCachePoints() {
  const arrays = new Set()
  for (const cached of sourceCache.values()) {
    for (const array of collectSourceArrays(cached.start)) {
      if (!cached.ownArrays.has(array)) arrays.add(array)
    }
  }
  let retained = 0
  for (const array of arrays) retained += array.length / 3
  return retained
}

/** Arrays whose running reference count differs from a recount over the entries. */
function countReferenceMismatches() {
  const recount = new Map()
  for (const cached of sourceCache.values()) {
    for (const array of new Set(collectSourceArrays(cached.start))) {
      recount.set(array, (recount.get(array) ?? 0) + 1)
    }
  }
  let mismatches = 0
  for (const [array, references] of sourceArrayReferences) {
    if (recount.get(array) !== references) mismatches += 1
  }
  for (const array of recount.keys()) {
    if (!sourceArrayReferences.has(array)) mismatches += 1
  }
  return mismatches
}

/** Fixes an array costs the cache: none when its own index holds it anyway. */
function chargeOf(array, ownArrays) {
  return ownArrays.has(array) ? 0 : array.length / 3
}

/**
 * The coordinate arrays a drill start's source keeps alive.
 * @param {{source: object[]} | null} start
 * @returns {Float64Array[]}
 */
function collectSourceArrays(start) {
  const arrays = []
  for (const feature of start?.source ?? []) {
    if (feature.type === 'MultiLineString') arrays.push(...feature.geometry)
    else arrays.push(feature.geometry)
  }
  return arrays
}

/** Reads a non-negative integer limit from workerData.tuning. */
function readTuningLimit(name, fallback) {
  const value = workerData?.tuning?.[name]
  return Number.isInteger(value) && value >= 0 ? value : fallback
}

/** geojson-vt's internal tile key (src/index.js toID). */
function toGeojsonVtTileId(z, x, y) {
  return (((1 << z) * y + x) * 32) + z
}

/** Test-only fault: grows the heap until V8 terminates this worker. */
function exhaustHeap() {
  const retained = []
  for (;;) retained.push(new Array(16_384).fill(Math.random()))
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
  const periodChunks = servingIndexes.get(message.periodKey)
  if (periodChunks === undefined) return Buffer.alloc(0)
  const coordinates = normalizeCoverageTileAddress(message)
  const tile = readPeriodTile(periodChunks, coordinates.z, coordinates.x, coordinates.y)
  if (!tile) return Buffer.alloc(0)
  const contributors = readTileContributors(tile)
  const safeMission = hashPath(servingCatalog.missionId)
  const safePeriod = hashPath(message.periodKey)
  const contributorDigest = hashPath(contributors.join('\n'))
  const cacheDirectory = path.resolve(workerData.cacheDirectory)
  const tilePath = assertCoverageCachePath(path.resolve(
    cacheDirectory,
    safeMission,
    safePeriod,
    String(coordinates.z),
    String(coordinates.x),
    `${coordinates.y}-${contributorDigest}.pbf`,
  ), cacheDirectory)
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
  throwIfRequestCancelled(message.requestId)
  const temporaryPath = assertCoverageCachePath(
    `${tilePath}.${message.requestId}.tmp`,
    cacheDirectory,
  )
  try {
    await fs.writeFile(temporaryPath, bytes)
    if (workerData.faultInjection?.tileWriteDelayMs > 0) {
      await delay(workerData.faultInjection.tileWriteDelayMs)
    }
    throwIfRequestCancelled(message.requestId)
    await fs.rename(temporaryPath, tilePath)
    cacheBytes = replaceCoverageTileCacheEntry(cacheEntriesByPath, tilePath, {
      contributors,
      size: bytes.byteLength,
      lastAccess: Date.now(),
    }, cacheBytes)
    await enforceCacheBudget()
    throwIfRequestCancelled(message.requestId)
  } finally {
    await fs.rm(temporaryPath, { force: true })
  }
  return bytes
}

/** Fails closed unless a generated tile path remains under the owned cache root. */
function assertCoverageCachePath(candidatePath, cacheDirectory) {
  const resolved = path.resolve(candidatePath)
  if (!resolved.startsWith(`${cacheDirectory}${path.sep}`)) {
    throw new Error('Coverage tile cache path escaped its owned directory.')
  }
  return resolved
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
