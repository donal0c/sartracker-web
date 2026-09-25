import { createHash } from 'node:crypto'
import { PNG } from 'pngjs'

const SHA256 = /^[a-f0-9]{64}$/u
const OBSERVATIONS = ['providerDisabled', 'networkBlocked', 'servedTileMatchesSource', 'servedTileDecoded',
  'sourceLoaded', 'renderFrameObserved', 'targetViewConfirmed', 'viewComplete', 'fieldReady', 'privateInputUnchanged']

/** Read coordinate-free source counts independently of the application's map inspector. */
export function privateMapFacts(database) {
  const row = database.prepare(`SELECT COUNT(*) AS tileCount, MIN(zoom_level) AS minZoom,
    MAX(zoom_level) AS maxZoom FROM tiles`).get()
  if (!Number.isSafeInteger(row.tileCount) || row.tileCount < 1 || row.tileCount > 100_000
      || !Number.isInteger(row.minZoom) || !Number.isInteger(row.maxZoom)
      || row.minZoom < 0 || row.maxZoom > 22) throw new Error('PRIVATE_MAP_INVENTORY_INVALID')
  return row
}

/** Decode all bounded PNG rows with pngjs, independent of Electron's nativeImage path. */
export function inspectPrivateMapTiles(database) {
  const facts = privateMapFacts(database)
  let decodedTileCount = 0
  const identities = new Set()
  for (const row of database.prepare('SELECT zoom_level AS z, tile_column AS x, tile_row AS tmsY, tile_data AS bytes FROM tiles').iterate()) {
    const key = `${row.z}/${row.x}/${row.tmsY}`
    if (![row.z, row.x, row.tmsY].every(Number.isSafeInteger) || row.z < 0 || row.z > 22
        || row.x < 0 || row.x >= 2 ** row.z || row.tmsY < 0 || row.tmsY >= 2 ** row.z
        || identities.has(key)) throw new Error('PRIVATE_MAP_TILE_IDENTITY_INVALID')
    identities.add(key)
    const bytes = row.bytes
    if (!Buffer.isBuffer(bytes) || bytes.length < 33 || bytes.length > 4 * 1024 * 1024
        || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        || ![256, 512].includes(bytes.readUInt32BE(16)) || bytes.readUInt32BE(16) !== bytes.readUInt32BE(20)) {
      throw new Error('PRIVATE_MAP_PNG_HEADER_INVALID')
    }
    let decoded
    try { decoded = PNG.sync.read(bytes, { checkCRC: true }) } catch { throw new Error('PRIVATE_MAP_PNG_DECODE_FAILED') }
    if (decoded.width !== bytes.readUInt32BE(16) || decoded.height !== decoded.width
        || decoded.data.length !== decoded.width * decoded.height * 4) throw new Error('PRIVATE_MAP_PNG_DIMENSIONS_INVALID')
    let visible = false
    for (let offset = 3; offset < decoded.data.length; offset += 4) {
      if (decoded.data[offset] !== 0) { visible = true; break }
    }
    // Native policy accepts edge transparency but rejects an entirely invisible
    // tile. Decodability does not imply required-view coverage or Field ready.
    if (!visible) throw new Error('PRIVATE_MAP_PNG_ALPHA_INVALID')
    decodedTileCount++
  }
  if (decodedTileCount !== facts.tileCount) throw new Error('PRIVATE_MAP_DECODE_INCOMPLETE')
  // Use a real interior tile at a fixed bounded operational zoom, without
  // persisting its coordinates or bytes in the sanitized producer receipt.
  const z = Math.min(12, facts.maxZoom)
  const extent = database.prepare(`SELECT MIN(tile_column) AS x0, MAX(tile_column) AS x1,
    MIN(tile_row) AS y0, MAX(tile_row) AS y1 FROM tiles WHERE zoom_level = ?`).get(z)
  const target = database.prepare(`SELECT tile_column AS x, tile_row AS tmsY, tile_data AS bytes
    FROM tiles WHERE zoom_level = ? ORDER BY ABS(tile_column - ?) + ABS(tile_row - ?), tile_column, tile_row LIMIT 1`)
    .get(z, (extent.x0 + extent.x1) / 2, (extent.y0 + extent.y1) / 2)
  if (!target) throw new Error('PRIVATE_MAP_VIEW_UNAVAILABLE')
  return { facts: { ...facts, decodedTileCount }, target: { z, x: target.x, y: 2 ** z - 1 - target.tmsY,
    sha256: createHash('sha256').update(target.bytes).digest('hex') } }
}

/** Require a closed, coordinate-free receipt shape, rejecting private or unreviewed fields. */
function keys(value, allowed) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join(',') === [...allowed].sort().join(',')
}

/** Validate this one private-package supplement without relabelling the synthetic fault matrix. */
export function validatePrivateMapReceipt(report, expected) {
  const shape = keys(report, ['schema', 'runtime', 'map', 'observations', 'custody', 'process'])
    && keys(report.runtime, ['isPackaged', 'executableSha256', 'asarSha256'])
    && keys(report.map, ['sha256', 'bytes', 'tileCount', 'decodedTileCount', 'minZoom', 'maxZoom'])
    && keys(report.observations, [...OBSERVATIONS, 'externalMapRequests', 'viewTotalTiles', 'viewUsableTiles'])
    && keys(report.custody, ['privateBytesRetained', 'privateScreenshotsRetained'])
    && keys(report.process, ['exitCode', 'signal'])
  const passed = shape && report.schema === 'sartracker-private-offline-map-v1'
    && report.runtime.isPackaged === true
    && ['executableSha256', 'asarSha256'].every(key => SHA256.test(expected[key]) && report.runtime[key] === expected[key])
    && SHA256.test(expected.mapSha256) && report.map.sha256 === expected.mapSha256
    && Number.isSafeInteger(expected.mapBytes) && expected.mapBytes > 0 && report.map.bytes === expected.mapBytes
    && Number.isSafeInteger(report.map.tileCount) && report.map.tileCount > 0 && report.map.tileCount <= 100_000
    && report.map.decodedTileCount === report.map.tileCount
    && Number.isInteger(report.map.minZoom) && Number.isInteger(report.map.maxZoom)
    && report.map.minZoom >= 0 && report.map.maxZoom <= 22 && report.map.maxZoom >= report.map.minZoom
    && ['tileCount', 'minZoom', 'maxZoom'].every(key => Number.isSafeInteger(expected[key]) && report.map[key] === expected[key])
    && OBSERVATIONS.every(key => report.observations[key] === true)
    && report.observations.externalMapRequests === 0
    && Number.isSafeInteger(report.observations.viewTotalTiles) && report.observations.viewTotalTiles > 0
    && report.observations.viewTotalTiles <= 256
    && report.observations.viewUsableTiles === report.observations.viewTotalTiles
    && report.custody.privateBytesRetained === false && report.custody.privateScreenshotsRetained === false
    && report.process.exitCode === 0 && report.process.signal === null
  return { passed: Boolean(passed), status: passed ? 'PASS' : 'INVALID_EVIDENCE',
    failureReasons: passed ? [] : ['Private-map source, runtime, decode, readiness or custody evidence is invalid.'] }
}

/** Join sanitized component evidence to its outer exact-candidate custody without private paths. */
export function createPrivateMapPublicBinding(input) {
  return {
    schema: 'sartracker-private-map-public-binding-v1',
    definitionDigest: input.definitionDigest,
    attemptId: input.attemptId,
    sourceSha: input.sourceSha,
    sourceTree: input.sourceTree,
    version: input.version,
    proofMode: input.proofMode,
    artifactSha256: input.artifactSha256,
    executableSha256: input.executableSha256,
    asarSha256: input.asarSha256,
    mapSha256: input.mapSha256,
    mapBytes: input.mapBytes,
    rawReportSha256: input.rawReportSha256,
    qualificationEligible: false,
    scope: 'Exact evidence binding only; private campaign validation and human field acceptance remain separate.',
  }
}
