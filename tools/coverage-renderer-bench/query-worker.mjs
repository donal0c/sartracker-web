import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { parentPort } from 'node:worker_threads'
import { performance } from 'node:perf_hooks'

import geojsonvt from 'geojson-vt'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')
const vtpbf = require('vt-pbf')

const GAP_THRESHOLD_MS = 30 * 60 * 1000
const PAGE_SIZE = 10_000
const periodIndexes = new Map()
const chunksByKey = new Map()
const periodFeatures = new Map()
const periodRevisions = new Map()
const tileCacheFilesByChunk = new Map()
const phaseMs = { queryMs: 0, segmentationMs: 0, encodeServeMs: 0 }
let activeBuild = null
let currentCacheDirectory = null
let currentCandidate = null
let appendTarget = null

parentPort.on('message', (message) => {
  void handleMessage(message).catch((error) => replyError(message, error))
})

/** Routes one bounded worker command. */
async function handleMessage(message) {
  if (message.type === 'start') {
    if (activeBuild !== null) throw new Error('Coverage benchmark build is already active.')
    activeBuild = buildCoverage(message)
    await activeBuild
    return
  }
  if (message.type === 'tile') {
    reply(message.requestId, await readVectorTile(message))
    return
  }
  if (message.type === 'append') {
    reply(message.requestId, await appendLateBatch())
    return
  }
  if (message.type === 'prime-invalidation') {
    reply(message.requestId, await primeInvalidationEvidence())
    return
  }
  if (message.type === 'attest-pane') {
    reply(message.requestId, attestPane(message.bounds))
    return
  }
  throw new Error(`Unknown coverage benchmark worker message: ${String(message.type)}`)
}

/** Streams all logical device/period chunks from SQLite in newest-period-first order. */
async function buildCoverage(input) {
  currentCacheDirectory = input.cacheDirectory
  currentCandidate = input.candidate
  const db = new Database(input.databasePath, { readonly: true, fileMustExist: true })
  db.pragma('query_only = ON')
  const mission = db.prepare(`SELECT id FROM missions
    WHERE status IN ('active','paused','finished','finalized')
    ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END, start_time DESC
    LIMIT 1`).get()
  if (!mission) throw new Error('Benchmark fixture has no mission to render.')
  const outings = db.prepare(`SELECT id, label, started_at, ended_at
    FROM outings WHERE mission_id = ? ORDER BY started_at ASC, id ASC`).all(mission.id)
  const periods = [
    ...[...outings].reverse().map((outing) => ({
      kind: 'outing',
      id: outing.id,
      label: outing.label,
      startedAt: outing.started_at,
      endedAt: outing.ended_at,
    })),
    { kind: 'unassigned', id: '', label: 'Outside outings', startedAt: null, endedAt: null },
  ]
  const devices = db.prepare(`SELECT device_id, group_id FROM devices
    WHERE mission_id = ? ORDER BY device_id ASC`).all(mission.id)
  const metadata = {
    type: 'metadata',
    missionId: mission.id,
    periodCount: periods.length,
    deviceCount: devices.length,
    expectedChunkCount: periods.length * devices.length,
    firstDeviceId: devices[0]?.device_id ?? null,
    firstGroupId: devices[0]?.group_id ?? null,
  }
  parentPort.postMessage(metadata)

  let deliveredFixes = 0
  let deliveredChunks = 0
  const bounds = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY]
  try {
    for (const period of periods) {
      const key = periodKey(period)
      periodRevisions.set(key, 1)
      const featuresForPeriod = []
      let periodFixCount = 0
      for (const device of devices) {
        const deviceId = device.device_id
        const queryStarted = performance.now()
        const rows = readChunkRows(db, mission.id, deviceId, period, outings)
        phaseMs.queryMs += performance.now() - queryStarted
        const segmentationStarted = performance.now()
        const chunk = materializeChunk({
          missionId: mission.id,
          deviceId,
          groupId: device.group_id,
          period,
          rows,
          contentRev: 1,
        })
        phaseMs.segmentationMs += performance.now() - segmentationStarted
        updateBounds(bounds, rows)
        if (appendTarget === null && rows.length > 2) {
          appendTarget = { ...chunk, rows }
          chunksByKey.set(chunk.chunkKey, appendTarget)
        } else if (input.candidate === 'B') {
          chunksByKey.set(chunk.chunkKey, { ...chunk, rows: [] })
        }
        featuresForPeriod.push(...chunk.features)
        periodFixCount += chunk.fixCount
        deliveredFixes += chunk.fixCount
        deliveredChunks += 1

        if (input.candidate !== 'B') {
          parentPort.postMessage({ type: 'chunk', period, ...withoutRows(chunk) })
        }
        if (deliveredChunks % 5 === 0) await yieldToWorkerMessages()
      }
      periodFeatures.set(key, featuresForPeriod)
      if (input.candidate === 'B') {
        const started = performance.now()
        periodIndexes.set(key, buildVectorIndex(featuresForPeriod))
        phaseMs.encodeServeMs += performance.now() - started
        parentPort.postMessage({
          type: 'period-ready',
          period,
          periodKey: key,
          contentRev: 1,
          fixCount: periodFixCount,
          featureCount: featuresForPeriod.length,
          chunkCount: devices.length,
        })
      }
      parentPort.postMessage({
        type: 'progress',
        deliveredFixes,
        deliveredChunks,
        expectedChunkCount: metadata.expectedChunkCount,
      })
    }
    parentPort.postMessage({
      type: 'complete',
      expectedFixCount: deliveredFixes,
      expectedChunkCount: deliveredChunks,
      bounds: normalizeBounds(bounds),
      phases: { ...phaseMs },
      pageSize: PAGE_SIZE,
    })
  } finally {
    db.close()
  }
}

/** Reads one logical chunk using only the per-device timestamp index. */
function readChunkRows(db, missionId, deviceId, period, outings) {
  const periodSql = period.kind === 'outing'
    ? period.endedAt === null
      ? ' AND timestamp >= ?'
      : ' AND timestamp >= ? AND timestamp < ?'
    : ''
  const periodParameters = period.kind === 'outing'
    ? period.endedAt === null ? [period.startedAt] : [period.startedAt, period.endedAt]
    : []
  const firstPage = db.prepare(`SELECT id, source_position_id, timestamp, lon, lat FROM positions
    WHERE mission_id = ? AND device_id = ?${periodSql}
    ORDER BY timestamp ASC, id ASC LIMIT ?`)
  const nextPage = db.prepare(`SELECT id, source_position_id, timestamp, lon, lat FROM positions
    WHERE mission_id = ? AND device_id = ?${periodSql}
      AND (timestamp > ? OR (timestamp = ? AND id > ?))
    ORDER BY timestamp ASC, id ASC LIMIT ?`)
  const rows = []
  let page = firstPage.all(missionId, deviceId, ...periodParameters, PAGE_SIZE)
  while (page.length > 0) {
    for (const row of page) {
      if (period.kind === 'outing' || findContainingOuting(outings, row.timestamp) === null) {
        rows.push(row)
      }
    }
    if (page.length < PAGE_SIZE) break
    const cursor = page.at(-1)
    page = nextPage.all(
      missionId,
      deviceId,
      ...periodParameters,
      cursor.timestamp,
      cursor.timestamp,
      cursor.id,
      PAGE_SIZE,
    )
  }
  return rows
}

/** Uses the same half-open binary-search semantics as the production outing summary. */
function findContainingOuting(outings, timestamp) {
  let low = 0
  let high = outings.length - 1
  let candidate = -1
  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    if (outings[middle].started_at <= timestamp) {
      candidate = middle
      low = middle + 1
    } else {
      high = middle - 1
    }
  }
  if (candidate === -1) return null
  const outing = outings[candidate]
  return outing.ended_at === null || timestamp < outing.ended_at ? outing : null
}

/** Converts lossless ordered fixes into deterministic segmented coverage features. */
function materializeChunk({ missionId, deviceId, groupId, period, rows, contentRev }) {
  const chunkKey = `${missionId}:${deviceId}:${period.kind}:${period.id}`
  const digest = createHash('sha256')
  for (const row of rows) digest.update(`${row.source_position_id ?? row.id}\n`)
  const segments = segmentRows(rows)
  const features = segments.map((segment, index) => {
    const featureKey = `cov:${chunkKey}:${index}`
    return {
      type: 'Feature',
      id: featureKey,
      geometry: segment.length === 1
        ? { type: 'Point', coordinates: [segment[0].lon, segment[0].lat] }
        : { type: 'LineString', coordinates: segment.map((row) => [row.lon, row.lat]) },
      properties: {
        chunk_key: chunkKey,
        device_id: deviceId,
        group_id: groupId,
        period_kind: period.kind,
        period_id: period.id,
        content_rev: contentRev,
        feature_key: featureKey,
      },
    }
  })
  return {
    chunkKey,
    deviceId,
    groupId,
    periodKey: periodKey(period),
    contentRev,
    fixCount: rows.length,
    fixDigest: digest.digest('hex'),
    features,
  }
}

/** Segments only on the real 30-minute gap; transport pages never create breaks. */
function segmentRows(rows) {
  if (rows.length === 0) return []
  const segments = []
  let current = [rows[0]]
  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index]
    const previous = rows[index - 1]
    if (Date.parse(row.timestamp) - Date.parse(previous.timestamp) > GAP_THRESHOLD_MS) {
      segments.push(current)
      current = [row]
    } else {
      current.push(row)
    }
  }
  segments.push(current)
  return segments
}

/** Creates the vector-tile index used by Candidate B's on-disk tile cache. */
function buildVectorIndex(features) {
  return geojsonvt({ type: 'FeatureCollection', features }, {
    maxZoom: 16,
    indexMaxZoom: 8,
    indexMaxPoints: 100_000,
    tolerance: 3,
    buffer: 64,
    lineMetrics: false,
    promoteId: null,
  })
}

/** Serves one revision-bound protobuf tile and atomically caches its bytes on disk. */
async function readVectorTile(message) {
  const index = periodIndexes.get(message.periodKey)
  const revision = periodRevisions.get(message.periodKey)
  if (!index || revision !== message.contentRev) return null
  const safePeriod = createHash('sha256').update(message.periodKey).digest('hex').slice(0, 24)
  const tile = index.getTile(message.z, message.x, message.y)
  if (!tile) return null
  const contributors = readTileContributors(tile)
  const contributorDigest = digestTileContributors(contributors)
  if (currentCacheDirectory === null) throw new Error('Candidate-B tile cache is not initialized.')
  const tilePath = path.join(currentCacheDirectory, safePeriod, String(message.z), String(message.x), `${message.y}-${contributorDigest}.pbf`)
  const cached = await readFile(tilePath).catch(() => null)
  registerTileCacheContributors(contributors, tilePath)
  if (cached !== null) return cached
  const started = performance.now()
  const bytes = Buffer.from(vtpbf.fromGeojsonVt({ coverage: tile }, { version: 2, extent: 4096 }))
  phaseMs.encodeServeMs += performance.now() - started
  await mkdir(path.dirname(tilePath), { recursive: true })
  await writeFile(tilePath, bytes)
  return bytes
}

/** Reads the exact chunk/revision set contributing geometry to one vector tile. */
function readTileContributors(tile) {
  const contributors = new Set()
  for (const feature of tile.features ?? []) {
    const tags = feature.tags ?? {}
    contributors.add(`${String(tags.chunk_key)}@${String(tags.content_rev)}`)
  }
  return [...contributors].sort()
}

/** Binds each cached tile filename to its exact contributing revision set. */
function digestTileContributors(contributors) {
  return createHash('sha256')
    .update(contributors.join('\n'))
    .digest('hex')
    .slice(0, 20)
}

/** Indexes cached tile files by logical chunk so invalidation never becomes mission-global. */
function registerTileCacheContributors(contributors, tilePath) {
  for (const contributor of contributors) {
    const chunkKey = contributor.slice(0, contributor.lastIndexOf('@'))
    const paths = tileCacheFilesByChunk.get(chunkKey) ?? new Set()
    paths.add(tilePath)
    tileCacheFilesByChunk.set(chunkKey, paths)
  }
}

/** Materializes one affected and one unrelated Candidate-B cache artifact before timing invalidation. */
async function primeInvalidationEvidence() {
  if (currentCandidate !== 'B') return { required: false }
  const target = appendTarget
  if (!target) throw new Error('Cannot prime Candidate-B invalidation without an append target.')
  const unrelatedChunks = [...chunksByKey.values()].filter((chunk) =>
    chunk.chunkKey !== target.chunkKey &&
    chunk.periodKey !== target.periodKey &&
    chunk.features.length > 0,
  )
  if (unrelatedChunks.length === 0) return { required: false }
  await readExclusiveChunkTile(target, null)
  let primedUnrelated = false
  for (const unrelated of unrelatedChunks) {
    if (await readExclusiveChunkTile(unrelated, target.chunkKey, false)) {
      primedUnrelated = true
      break
    }
  }
  if (!primedUnrelated) throw new Error('Cannot prime an unrelated Candidate-B cache artifact.')
  return { required: true }
}

/** Finds and materializes a tile containing one chunk, optionally excluding another chunk. */
async function readExclusiveChunkTile(chunk, excludedChunkKey, required = true) {
  const index = periodIndexes.get(chunk.periodKey)
  for (const feature of chunk.features) {
    for (const coordinates of sampleFeatureCoordinates(feature)) {
      for (const z of [16, 14, 11]) {
        const tileAddress = lonLatToTile(coordinates[0], coordinates[1], z)
        const tile = index?.getTile(tileAddress.z, tileAddress.x, tileAddress.y)
        const contributors = tile ? readTileContributors(tile) : []
        const chunkRevision = `${chunk.chunkKey}@${chunk.contentRev}`
        if (!contributors.includes(chunkRevision)) continue
        if (excludedChunkKey && contributors.some((value) => value.startsWith(`${excludedChunkKey}@`))) continue
        const bytes = await readVectorTile({
          periodKey: chunk.periodKey,
          contentRev: periodRevisions.get(chunk.periodKey),
          ...tileAddress,
        })
        if (bytes !== null) return true
      }
    }
  }
  if (required) throw new Error(`Candidate-B evidence tile for ${chunk.chunkKey} is unavailable.`)
  return false
}

/** Returns bounded representative coordinates from one point or line feature. */
function sampleFeatureCoordinates(feature) {
  const coordinates = feature?.geometry?.coordinates
  if (feature?.geometry?.type === 'Point') return [coordinates]
  if (feature?.geometry?.type === 'LineString') {
    return [coordinates?.[0], coordinates?.[Math.floor(coordinates.length / 2)], coordinates?.at(-1)]
      .filter(Boolean)
  }
  throw new Error('Candidate-B evidence requires a point or line coordinate.')
}

/** Converts a WGS84 coordinate to the containing slippy-map tile. */
function lonLatToTile(lon, lat, z) {
  const scale = 2 ** z
  const boundedLat = Math.max(-85.05112878, Math.min(85.05112878, lat))
  const x = Math.floor(((lon + 180) / 360) * scale)
  const latRadians = boundedLat * Math.PI / 180
  const y = Math.floor((1 - Math.asinh(Math.tan(latRadians)) / Math.PI) / 2 * scale)
  return { z, x, y }
}

/** Returns the exact worker feature-key digest intersecting one sampled map pane. */
function attestPane(boundsInput) {
  if (!Array.isArray(boundsInput) || boundsInput.length !== 4 ||
    boundsInput.some((value) => !Number.isFinite(value))) {
    throw new Error('Pane attestation requires four finite WGS84 bounds.')
  }
  const keys = []
  for (const features of periodFeatures.values()) {
    for (const feature of features) {
      if (featureIntersectsBounds(feature, boundsInput)) keys.push(attestationKey(feature))
    }
  }
  keys.sort()
  return {
    segmentCount: keys.length,
    digest: createHash('sha256').update(keys.join('\n')).digest('hex'),
  }
}

/** Creates the source-stable identity compared with the rendered feature properties. */
function attestationKey(feature) {
  return `${feature.properties.feature_key}|${feature.properties.chunk_key}|${feature.properties.content_rev}`
}

/** Tests point/line geometry against a non-antimeridian WGS84 rectangle. */
function featureIntersectsBounds(feature, bounds) {
  const coordinates = feature.geometry.coordinates
  if (feature.geometry.type === 'Point') return pointInBounds(coordinates, bounds)
  if (feature.geometry.type !== 'LineString') return false
  for (let index = 0; index < coordinates.length; index += 1) {
    if (pointInBounds(coordinates[index], bounds)) return true
    if (index > 0 && segmentIntersectsBounds(coordinates[index - 1], coordinates[index], bounds)) return true
  }
  return false
}

/** Tests one coordinate against inclusive pane bounds. */
function pointInBounds(point, [west, south, east, north]) {
  return point[0] >= west && point[0] <= east && point[1] >= south && point[1] <= north
}

/** Uses a Liang-Barsky clip test so bbox-only false positives cannot pass attestation. */
function segmentIntersectsBounds(start, end, [west, south, east, north]) {
  const dx = end[0] - start[0]
  const dy = end[1] - start[1]
  const p = [-dx, dx, -dy, dy]
  const q = [start[0] - west, east - start[0], start[1] - south, north - start[1]]
  let lower = 0
  let upper = 1
  for (let index = 0; index < 4; index += 1) {
    if (p[index] === 0) {
      if (q[index] < 0) return false
      continue
    }
    const ratio = q[index] / p[index]
    if (p[index] < 0) lower = Math.max(lower, ratio)
    else upper = Math.min(upper, ratio)
    if (lower > upper) return false
  }
  return true
}

/** Injects a deterministic 5,000-fix late batch into one chunk and invalidates only its period. */
async function appendLateBatch() {
  const target = appendTarget
  if (!target) throw new Error('No populated coverage chunk is available for the append probe.')
  const period = parsePeriodFromChunk(target)
  const source = target.rows[Math.floor(target.rows.length / 2)]
  const baseTime = Date.parse(source.timestamp)
  const lateRows = Array.from({ length: 5_000 }, (_unused, index) => ({
    id: `bench-late-${String(index).padStart(6, '0')}`,
    source_position_id: `bench-late-source-${String(index).padStart(6, '0')}`,
    timestamp: new Date(baseTime + index + 1).toISOString(),
    lon: source.lon + (index % 100) * 0.000001,
    lat: source.lat + Math.floor(index / 100) * 0.000001,
  }))
  const rows = [...target.rows, ...lateRows].sort(compareRows)
  const nextRev = target.contentRev + 1
  const replacement = materializeChunk({
    missionId: target.chunkKey.split(':')[0],
    deviceId: target.deviceId,
    groupId: target.groupId,
    period,
    rows,
    contentRev: nextRev,
  })
  chunksByKey.set(target.chunkKey, { ...replacement, rows })
  appendTarget = { ...replacement, rows }
  const unaffectedChunkRevisionsBefore = new Map(
    [...chunksByKey.values()]
      .filter((chunk) => chunk.chunkKey !== target.chunkKey)
      .map((chunk) => [chunk.chunkKey, chunk.contentRev]),
  )
  const affectedTileFiles = [...(tileCacheFilesByChunk.get(target.chunkKey) ?? [])]
  const affectedTileFileSet = new Set(affectedTileFiles)
  const unrelatedTileFiles = [...tileCacheFilesByChunk.entries()]
    .filter(([chunkKey]) => chunkKey !== target.chunkKey)
    .flatMap(([, files]) => [...files].filter((tilePath) => !affectedTileFileSet.has(tilePath)))
  for (const tilePath of affectedTileFiles) await rm(tilePath, { force: true })
  for (const files of tileCacheFilesByChunk.values()) {
    for (const tilePath of affectedTileFiles) files.delete(tilePath)
  }
  tileCacheFilesByChunk.delete(target.chunkKey)

  if (currentCandidate === 'B') {
    const features = []
    for (const chunk of chunksByKey.values()) {
      if (chunk.periodKey === target.periodKey) features.push(...chunk.features)
    }
    periodFeatures.set(target.periodKey, features)
    periodIndexes.set(target.periodKey, buildVectorIndex(features))
    periodRevisions.set(target.periodKey, nextRev)
    parentPort.postMessage({
      type: 'period-rebuilt',
      period,
      periodKey: target.periodKey,
      contentRev: nextRev,
      fixCount: [...chunksByKey.values()]
        .filter((chunk) => chunk.periodKey === target.periodKey)
        .reduce((total, chunk) => total + chunk.fixCount, 0),
      changedFixCount: replacement.fixCount,
      appendedFixCount: lateRows.length,
    })
  } else {
    const priorFeatures = periodFeatures.get(target.periodKey) ?? []
    const replacedFeatureKeys = new Set(target.features.map((feature) => feature.properties.feature_key))
    periodFeatures.set(target.periodKey, [
      ...priorFeatures.filter((feature) => !replacedFeatureKeys.has(feature.properties.feature_key)),
      ...replacement.features,
    ])
    parentPort.postMessage({ type: 'chunk-replaced', period, ...withoutRows(replacement) })
  }
  const staleTileGuarded = (await Promise.all(affectedTileFiles.map((tilePath) => readFile(tilePath).then(() => false, () => true)))).every(Boolean)
  const unrelatedTileCacheStable = (await Promise.all(unrelatedTileFiles.map((tilePath) => readFile(tilePath).then(() => true, () => false)))).every(Boolean)
  const tileEvidenceRequired = currentCandidate === 'B' && periodIndexes.size > 1
  const tileEvidencePresent = !tileEvidenceRequired ||
    (affectedTileFiles.length > 0 && unrelatedTileFiles.length > 0)
  return {
    chunkKey: target.chunkKey,
    periodKey: target.periodKey,
    contentRev: nextRev,
    appendedFixCount: lateRows.length,
    staleTileGuarded: tileEvidencePresent && staleTileGuarded &&
      (periodRevisions.get(target.periodKey) === nextRev || periodIndexes.size === 0),
    unrelatedRevisionStable: tileEvidencePresent && unrelatedTileCacheStable &&
      [...unaffectedChunkRevisionsBefore].every(([chunkKey, revision]) =>
        chunksByKey.get(chunkKey)?.contentRev === revision,
      ),
    phases: { ...phaseMs },
  }
}

/** Returns period metadata retained in the logical chunk key/properties. */
function parsePeriodFromChunk(chunk) {
  const feature = chunk.features[0]
  return {
    kind: feature?.properties?.period_kind ?? chunk.chunkKey.split(':').at(-2),
    id: feature?.properties?.period_id ?? chunk.chunkKey.split(':').at(-1),
    label: feature?.properties?.period_id || 'Outside outings',
    startedAt: null,
    endedAt: null,
  }
}

/** Compares deterministic timestamp/id order for late insertion. */
function compareRows(left, right) {
  return left.timestamp.localeCompare(right.timestamp) || left.id.localeCompare(right.id)
}

/** Removes the large retained row array before crossing the worker boundary. */
function withoutRows(chunk) {
  const { rows: _rows, ...rest } = chunk
  return rest
}

/** Updates aggregate WGS84 bounds from one logical chunk. */
function updateBounds(bounds, rows) {
  for (const row of rows) {
    bounds[0] = Math.min(bounds[0], row.lon)
    bounds[1] = Math.min(bounds[1], row.lat)
    bounds[2] = Math.max(bounds[2], row.lon)
    bounds[3] = Math.max(bounds[3], row.lat)
  }
}

/** Ensures an empty fixture cannot create invalid camera bounds. */
function normalizeBounds(bounds) {
  return bounds.every(Number.isFinite) ? bounds : [-10.5, 51.3, -5.4, 55.5]
}

/** Creates the tagged logical period key used by all candidates. */
function periodKey(period) {
  return `${period.kind}:${period.id}`
}

/** Lets tile and append messages run between bounded chunk batches. */
function yieldToWorkerMessages() {
  return new Promise((resolve) => setImmediate(resolve))
}

/** Sends one successful correlated response. */
function reply(requestId, result) {
  parentPort.postMessage({ requestId, result })
}

/** Sends one sanitized worker failure. */
function replyError(message, error) {
  const text = error instanceof Error ? error.message : String(error)
  if (message?.requestId) parentPort.postMessage({ requestId: message.requestId, error: text })
  else parentPort.postMessage({ type: 'error', error: text })
}
