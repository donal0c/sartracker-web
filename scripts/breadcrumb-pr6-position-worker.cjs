'use strict'

const { parentPort, workerData } = require('node:worker_threads')
const { randomUUID } = require('node:crypto')
const Database = require('better-sqlite3')
const { canonicalizeAcceptedPosition } = require('../electron/position-ingest-policy.cjs')

if (parentPort === null) throw new Error('Breadcrumb PR6 position worker requires a parent port.')

let database
let insertPosition
let updateDevice

try {
  database = new Database(workerData.databasePath, { fileMustExist: true })
  database.pragma('journal_mode = WAL')
  database.pragma('synchronous = FULL')
  database.pragma('foreign_keys = ON')
  database.pragma('busy_timeout = 1000')
  insertPosition = database.prepare(`INSERT INTO positions (
    id, mission_id, device_id, source_position_id, name, lat, lon, altitude, speed,
    battery, accuracy, source, timestamp, data_origin, received_at, content_hash,
    source_kind, timestamp_source, timestamp_provenance_recorded_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  updateDevice = database.prepare(`UPDATE devices
    SET last_seen = CASE
      WHEN last_seen IS NULL OR julianday(?) > julianday(last_seen) THEN ?
      ELSE last_seen
    END,
    status = 'online'
    WHERE mission_id = ? AND device_id = ?`)
  parentPort.postMessage({ type: 'ready' })
} catch (error) {
  parentPort.postMessage({
    type: 'fatal',
    name: error?.name ?? 'Error',
    code: error?.code ?? null,
    message: error?.message ?? 'Position worker failed to open the database.',
  })
}

function writePosition(position) {
  if (database === undefined) throw new Error('Position worker database is not open.')
  if (position.mission_id !== workerData.missionId
    || position.device_id !== workerData.deviceId) {
    throw new Error('Position worker received a mission or device mismatch.')
  }
  const timestamp = new Date(position.timestamp).toISOString()
  const canonical = canonicalizeAcceptedPosition({ ...position, timestamp })
  const receivedAt = new Date().toISOString()
  database.transaction(() => {
    insertPosition.run(
      randomUUID(),
      position.mission_id,
      position.device_id,
      position.source_position_id,
      position.name ?? null,
      position.lat,
      position.lon,
      position.altitude ?? null,
      position.speed ?? null,
      position.battery ?? null,
      position.accuracy ?? null,
      position.source ?? null,
      timestamp,
      position.data_origin ?? 'live',
      receivedAt,
      canonical.contentHash,
      position.source_position_id === null ? null : 'traccar',
      position.timestamp_source ?? null,
      position.timestamp_source === 'fix' ? receivedAt : null,
    )
    updateDevice.run(timestamp, timestamp, position.mission_id, position.device_id)
  })()
}

parentPort.on('message', (message) => {
  if (message?.type === 'position') {
    const startedAt = performance.now()
    try {
      writePosition(message.position)
      parentPort.postMessage({
        type: 'ack',
        sourcePositionId: message.position.source_position_id,
        latencyMs: performance.now() - startedAt,
      })
    } catch (error) {
      parentPort.postMessage({
        type: 'error',
        sourcePositionId: message.position.source_position_id,
        name: error?.name ?? 'Error',
        code: error?.code ?? null,
        message: error?.message ?? 'Position worker write failed.',
      })
    }
    return
  }
  if (message?.type === 'stop') {
    try { database?.close() } finally {
      parentPort.postMessage({ type: 'stopped' })
      parentPort.close()
    }
  }
})
