const fs = require('node:fs/promises')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { parentPort, threadId, workerData } = require('node:worker_threads')

const Database = require('better-sqlite3')
const { SaxesParser } = require('saxes')
const {
  finishGpxImportBatch,
  recordGpxImportFailure,
  recordGpxImportSourceReceipt,
  retainGpxImportSourceBytes,
  settleGpxImportSourceReceipt,
  startGpxImportBatch,
  upsertGpxEvidenceChunked,
} = require('./mission-store.cjs')

if (parentPort === null) throw new Error('GPX evidence worker requires a parent message port.')

async function run() {
  let database
  try {
    database = new Database(workerData.databasePath)
    database.pragma('foreign_keys = ON')
    database.pragma('journal_mode = WAL')
    const imports = []
    const failures = []
    if (workerData.receiptsStarted !== true) {
      startGpxImportBatch(database, {
        batchId: workerData.batchId,
        missionId: workerData.missionId,
        totalFiles: workerData.paths.length,
      })
    }
    for (const [index, sourcePath] of workerData.paths.entries()) {
      let normalizedPath = sourcePath
      let sourceBytes = null
      try {
        normalizedPath = validatePath(sourcePath)
        if (workerData.receiptsStarted !== true) {
          recordGpxImportSourceReceipt(database, {
            batchId: workerData.batchId,
            missionId: workerData.missionId,
            sourcePath: normalizedPath,
            fileName: path.basename(normalizedPath),
          })
        }
        pauseForForcedKill('pending')
        sourceBytes = await fs.readFile(normalizedPath)
        const contentSha256 = createHash('sha256').update(sourceBytes).digest('hex')
        const sourceBytesBase64 = sourceBytes.toString('base64')
        retainGpxImportSourceBytes(database, {
          batchId: workerData.batchId,
          missionId: workerData.missionId,
          sourcePath: normalizedPath,
          contentSha256,
          sourceBytesBase64,
        })
        pauseForForcedKill('retained')
        const decoded = new TextDecoder('utf-8', { fatal: true }).decode(sourceBytes)
        const parsed = parseGpxEvidence(decoded, path.basename(normalizedPath))
        const stored = await upsertGpxEvidenceChunked(database, {
          mission_id: workerData.missionId,
          source_path: normalizedPath,
          file_name: path.basename(normalizedPath),
          display_name: path.basename(normalizedPath).replace(/\.[^.]+$/u, ''),
          geometry_json: parsed.geometryJson,
          metadata_json: JSON.stringify({
            trackCount: parsed.trackCount,
            pointCount: parsed.points.length,
            rejectionCount: parsed.rejections.length,
            timingClass: parsed.timingClass,
            workerParsed: true,
          }),
          content_sha256: contentSha256,
          source_bytes_base64: sourceBytesBase64,
          timing_class: parsed.timingClass,
          points: parsed.points,
          rejections: parsed.rejections,
        })
        settleGpxImportSourceReceipt(database, {
          batchId: workerData.batchId,
          missionId: workerData.missionId,
          sourcePath: normalizedPath,
        })
        imports.push({
          id: stored.id,
          mission_id: stored.mission_id,
          source_path: stored.source_path,
          file_name: stored.file_name,
          display_name: stored.display_name,
          content_sha256: stored.content_sha256,
          timing_class: stored.timing_class,
          outing_id: stored.outing_id,
          revision_sequence: stored.revision_sequence,
          imported_at: stored.imported_at,
          updated_at: stored.updated_at,
        })
      } catch (error) {
        const reason = error instanceof TypeError && /encoded data/u.test(error.message)
          ? 'GPX source is not valid UTF-8.'
          : error instanceof Error ? error.message : String(error)
        recordGpxImportFailure(database, {
          batchId: workerData.batchId,
          missionId: workerData.missionId,
          sourcePath: normalizedPath,
          fileName: path.basename(normalizedPath),
          contentSha256: sourceBytes === null ? null : createHash('sha256').update(sourceBytes).digest('hex'),
          sourceBytesBase64: sourceBytes === null ? null : sourceBytes.toString('base64'),
          reason,
        })
        failures.push({ sourcePath: normalizedPath, reason })
      }
      parentPort.postMessage({ type: 'progress', completed: index + 1, total: workerData.paths.length })
    }
    finishGpxImportBatch(database, workerData.batchId, workerData.missionId)
    parentPort.postMessage({ type: 'complete', workerThreadId: threadId, imports, failures })
  } catch (error) {
    parentPort.postMessage({
      type: 'error',
      name: error instanceof Error ? error.name : 'Error',
      message: error instanceof Error ? error.message : String(error),
    })
  } finally {
    database?.close()
    parentPort.close()
  }
}

/** Parses ordered GPX evidence with explicit point/segment rejection provenance. */
function parseGpxEvidence(contents, fileName) {
  const parser = new SaxesParser()
  const segments = []
  const points = []
  const rejections = []
  let trackName = null
  let segmentIndex = -1
  let pointIndex = -1
  let segmentPoints = null
  let point = null
  let capture = null
  let capturedText = ''

  parser.on('opentag', (tag) => {
    const name = localName(tag.name)
    if (name === 'trk') trackName = null
    if (name === 'trkseg') {
      segmentIndex += 1
      pointIndex = -1
      segmentPoints = []
    }
    if (name === 'trkpt') {
      pointIndex += 1
      point = { latSource: attributeValue(tag.attributes.lat), lonSource: attributeValue(tag.attributes.lon), elevationSource: null, timestampSource: null }
    }
    if (name === 'name' && point === null && segmentPoints === null) beginCapture('track-name')
    if (name === 'ele' && point !== null) beginCapture('elevation')
    if (name === 'time' && point !== null) beginCapture('timestamp')
  })
  parser.on('text', (value) => { if (capture !== null) capturedText += value })
  parser.on('closetag', (tag) => {
    const name = localName(tag.name)
    if (name === 'name' && capture === 'track-name') {
      trackName = capturedText.trim() || null
      endCapture()
    }
    if (name === 'ele' && capture === 'elevation' && point !== null) {
      point.elevationSource = capturedText.trim()
      endCapture()
    }
    if (name === 'time' && capture === 'timestamp' && point !== null) {
      point.timestampSource = capturedText.trim()
      endCapture()
    }
    if (name === 'trkpt' && point !== null && segmentPoints !== null) {
      const parsedPoint = normalizePoint(point, trackName, segmentIndex, pointIndex, rejections)
      if (parsedPoint !== null) {
        points.push(parsedPoint)
        segmentPoints.push([parsedPoint.lon, parsedPoint.lat])
      }
      point = null
    }
    if (name === 'trkseg' && segmentPoints !== null) {
      if (segmentPoints.length >= 2) segments.push(segmentPoints)
      else rejections.push({ kind: 'segment', segment_index: segmentIndex, point_index: null, reason: 'insufficient_segment_points', source_value: String(segmentPoints.length) })
      segmentPoints = null
    }
  })
  parser.write(contents).close()
  if (segments.length === 0) throw new Error(`GPX file does not contain any usable track segments: ${fileName}`)
  const dated = points.filter((entry) => entry.timestamp !== null).length
  return {
    geometryJson: JSON.stringify({ type: 'MultiLineString', coordinates: segments }),
    trackCount: segments.length,
    points,
    rejections,
    timingClass: dated === 0 ? 'undated' : dated === points.length ? 'fully_dated' : 'partially_dated',
  }

  function beginCapture(nextCapture) { capture = nextCapture; capturedText = '' }
  function endCapture() { capture = null; capturedText = '' }
}

function normalizePoint(source, trackName, segmentIndex, pointIndex, rejections) {
  const lat = Number(source.latSource)
  const lon = Number(source.lonSource)
  if (source.latSource === null || source.lonSource === null || !Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    rejections.push({ kind: 'point', segment_index: segmentIndex, point_index: pointIndex, reason: 'invalid_coordinates', source_value: `lat=${source.latSource ?? ''};lon=${source.lonSource ?? ''}` })
    return null
  }
  const elevationValue = source.elevationSource === null ? null : Number(source.elevationSource)
  const elevation = elevationValue !== null && Number.isFinite(elevationValue) ? elevationValue : null
  if (source.elevationSource !== null && elevation === null) rejections.push({ kind: 'point', segment_index: segmentIndex, point_index: pointIndex, reason: 'invalid_elevation', source_value: source.elevationSource })
  const timestampValue = source.timestampSource === null ? null : new Date(source.timestampSource)
  const timestamp = timestampValue !== null && Number.isFinite(timestampValue.getTime()) ? timestampValue.toISOString() : null
  if (source.timestampSource !== null && timestamp === null) rejections.push({ kind: 'point', segment_index: segmentIndex, point_index: pointIndex, reason: 'invalid_timestamp', source_value: source.timestampSource })
  return { segment_index: segmentIndex, point_index: pointIndex, track_name: trackName, lat, lon, elevation, timestamp }
}

function attributeValue(value) {
  if (typeof value === 'string') return value
  return typeof value?.value === 'string' ? value.value : null
}

function localName(name) { return String(name).split(':').pop() }

function validatePath(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || path.extname(value).toLowerCase() !== '.gpx') {
    throw new Error('GPX evidence worker path is invalid.')
  }
  return path.normalize(value)
}

/** Holds the worker at one durable boundary until the forced-kill harness terminates the process. */
function pauseForForcedKill(phase) {
  if (workerData.pauseAfter !== phase) return
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0)
}

run()

module.exports = { parseGpxEvidence }
