const { createHash, randomUUID } = require('node:crypto')

const {
  canonicalizeAcceptedPosition,
} = require('./position-ingest-policy.cjs')

/**
 * Records one immutable conflicting source observation in the same transaction
 * as the ingest decision. Repeated delivery of that conflict is idempotent.
 */
function recordConflictAnomaly(db, input) {
  const canonical = canonicalizeAcceptedPosition(input.incoming)
  const anomalyKey = `source:${input.sourcePositionId}:content:${canonical.contentHash}`
  const inserted = db.prepare(`
    INSERT INTO ingest_anomalies (
      id, mission_id, kind, anomaly_key, device_id, source_position_id,
      reason_class, received_at, canonical_payload_json, created_at,
      first_seen_at, last_seen_at, occurrence_count
    ) VALUES (?, ?, 'conflict', ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    ON CONFLICT(mission_id, kind, anomaly_key) DO NOTHING
  `).run(
    randomUUID(),
    input.missionId,
    anomalyKey,
    input.incoming.device_id ?? null,
    input.sourcePositionId,
    'source_identity_content_conflict',
    input.receivedAt,
    canonical.canonicalJson,
    input.receivedAt,
    input.receivedAt,
    input.receivedAt,
  )
  if (inserted.changes === 0) {
    db.prepare(`
      UPDATE ingest_anomalies
      SET last_seen_at = ?, occurrence_count = occurrence_count + 1
      WHERE mission_id = ? AND kind = 'conflict' AND anomaly_key = ?
    `).run(input.receivedAt, input.missionId, anomalyKey)
  } else {
    recordInsertedAnomalySummary(
      db,
      input.missionId,
      'conflict',
      input.incoming.device_id ?? null,
    )
  }
}

/** Lists one bounded newest-first mission anomaly page. */
function listIngestAnomalies(db, missionId, options = {}) {
  const boundedLimit = Number.isInteger(options.limit) && options.limit > 0 && options.limit <= 200
    ? options.limit
    : 200
  const boundedOffset = Number.isSafeInteger(options.offset) && options.offset >= 0
    ? options.offset
    : 0
  return db.prepare(`
    SELECT * FROM ingest_anomalies
    WHERE mission_id = ?
    ORDER BY created_at ASC, id ASC
    LIMIT ? OFFSET ?
  `).all(missionId, boundedLimit, boundedOffset)
}

/**
 * Projects one durable rejection delivery transactionally. Delivery identity
 * and anomaly content identity are independently idempotent.
 */
function recordRejectedAnomaly(db, envelope) {
  const transaction = db.transaction(() => {
    const delivered = db.prepare(
      `SELECT delivery_id FROM ingest_anomaly_deliveries
       WHERE mission_id = ? AND delivery_id = ?`,
    ).get(envelope.missionId, envelope.deliveryId)
    if (delivered !== undefined) {
      return false
    }
    const mission = db.prepare('SELECT status FROM missions WHERE id = ?').get(envelope.missionId)
    if (mission === undefined) {
      throw new Error(`Mission not found: ${envelope.missionId}`)
    }
    if (mission.status === 'finalized') {
      const error = new Error(
        'Late rejected-position evidence cannot mutate a finalized mission.',
      )
      error.code = 'LATE_EVIDENCE_AFTER_FINALIZATION'
      throw error
    }
    const inserted = db.prepare(`
      INSERT INTO ingest_anomalies (
        id, mission_id, kind, anomaly_key, device_id, source_position_id,
        reason_class, received_at, canonical_payload_json, created_at,
        first_seen_at, last_seen_at, occurrence_count
      ) VALUES (?, ?, 'rejected', ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      ON CONFLICT(mission_id, kind, anomaly_key) DO NOTHING
    `).run(
      randomUUID(),
      envelope.missionId,
      envelope.anomalyKey,
      envelope.deviceId,
      envelope.sourcePositionId,
      envelope.reasonClass,
      envelope.receivedAt,
      JSON.stringify(envelope.canonicalEvidence),
      envelope.receivedAt,
      envelope.receivedAt,
      envelope.receivedAt,
    )
    if (inserted.changes === 0) {
      db.prepare(`
        UPDATE ingest_anomalies
        SET last_seen_at = ?, occurrence_count = occurrence_count + 1
        WHERE mission_id = ? AND kind = 'rejected' AND anomaly_key = ?
      `).run(envelope.receivedAt, envelope.missionId, envelope.anomalyKey)
    } else {
      recordInsertedAnomalySummary(
        db,
        envelope.missionId,
        'rejected',
        envelope.deviceId,
      )
    }
    db.prepare(`
      INSERT INTO ingest_anomaly_deliveries (delivery_id, mission_id, projected_at)
      VALUES (?, ?, ?)
    `).run(envelope.deliveryId, envelope.missionId, envelope.receivedAt)
    return true
  })
  return transaction()
}

const STORE_REJECTION_EVIDENCE_FIELDS = Object.freeze([
  'device_id',
  'source_position_id',
  'lat',
  'lon',
  'timestamp',
  'timestamp_source',
  'data_origin',
])
const MAX_STORE_REJECTION_TEXT_LENGTH = 200

/**
 * Records one position row the mission store refused, inside the caller's
 * write transaction, so the refusal commits or rolls back with the batch.
 * Repeat delivery of the same refused row raises its occurrence count instead
 * of adding a row [DON-338].
 *
 * @param {import('better-sqlite3').Database} db open mission database
 * @param {{ missionId: string, reasonClass: string, receivedAt: string, position: unknown }} input
 *   the refused row as received and the fixed reason class
 * @returns {void}
 */
function recordStoreRejectedPosition(db, input) {
  const evidence = createStoreRejectionEvidence(input.position)
  const evidenceJson = JSON.stringify(evidence)
  const contentHash = createHash('sha256').update(evidenceJson).digest('hex')
  const anomalyKey = `store:reason:${input.reasonClass}:content:${contentHash}`
  const deviceId = typeof evidence.device_id === 'string' && evidence.device_id !== ''
    ? evidence.device_id
    : null
  const sourcePositionId = typeof evidence.source_position_id === 'string'
    && evidence.source_position_id.trim() !== ''
    ? evidence.source_position_id
    : null
  const inserted = db.prepare(`
    INSERT INTO ingest_anomalies (
      id, mission_id, kind, anomaly_key, device_id, source_position_id,
      reason_class, received_at, canonical_payload_json, created_at,
      first_seen_at, last_seen_at, occurrence_count
    ) VALUES (?, ?, 'rejected', ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    ON CONFLICT(mission_id, kind, anomaly_key) DO NOTHING
  `).run(
    randomUUID(),
    input.missionId,
    anomalyKey,
    deviceId,
    sourcePositionId,
    input.reasonClass,
    input.receivedAt,
    evidenceJson,
    input.receivedAt,
    input.receivedAt,
    input.receivedAt,
  )
  if (inserted.changes === 0) {
    db.prepare(`
      UPDATE ingest_anomalies
      SET last_seen_at = ?, occurrence_count = occurrence_count + 1
      WHERE mission_id = ? AND kind = 'rejected' AND anomaly_key = ?
    `).run(input.receivedAt, input.missionId, anomalyKey)
  } else {
    recordInsertedAnomalySummary(db, input.missionId, 'rejected', deviceId)
  }
}

/**
 * Returns the mission's distinct store-write anomaly totals: rows the mission
 * store refused, and reused source position ids whose new observation was
 * kept as a conflict instead of a fix. Both read indexed rows only.
 *
 * @param {import('better-sqlite3').Database} db open mission database
 * @param {string} missionId mission to count
 * @returns {{ missionRejectedPositionTotal: number, missionSourceIdentityConflictTotal: number }}
 */
function countStoreWriteAnomalies(db, missionId) {
  // 'store;' is the first key after every 'store:' key, so this is an index range.
  const rejected = db.prepare(`
    SELECT COUNT(*) AS count FROM ingest_anomalies
    WHERE mission_id = ? AND kind = 'rejected'
      AND anomaly_key >= 'store:' AND anomaly_key < 'store;'
  `).get(missionId)
  const health = db.prepare(`
    SELECT conflict_count FROM ingest_anomaly_mission_health WHERE mission_id = ?
  `).get(missionId)
  return {
    missionRejectedPositionTotal: Number(rejected?.count ?? 0),
    missionSourceIdentityConflictTotal: Number(health?.conflict_count ?? 0),
  }
}

/**
 * Copies only the bounded position fields of a refused row into JSON-safe
 * values, keeping malformed values visible as text instead of dropping them.
 *
 * @param {unknown} position the refused row as received
 * @returns {Record<string, string | number | null>} bounded evidence
 */
function createStoreRejectionEvidence(position) {
  const source = position !== null && typeof position === 'object' ? position : {}
  const evidence = {}
  for (const field of STORE_REJECTION_EVIDENCE_FIELDS) {
    const value = source[field]
    if (value === null || value === undefined) {
      evidence[field] = null
    } else if (typeof value === 'number') {
      evidence[field] = Number.isFinite(value) ? value : String(value)
    } else if (typeof value === 'string') {
      evidence[field] = value.slice(0, MAX_STORE_REJECTION_TEXT_LENGTH)
    } else {
      evidence[field] = `[${typeof value}]`
    }
  }
  return evidence
}

/** Returns bounded aggregate health facts without anomaly content. */
function summarizeIngestAnomalies(db, missionId) {
  const counts = missionId === undefined
    ? db.prepare(`
        SELECT
          SUM(conflict_count) AS conflict_count,
          SUM(rejected_count) AS rejected_count,
          (SELECT COUNT(DISTINCT device_id) FROM ingest_anomaly_devices)
            AS affected_device_count
        FROM ingest_anomaly_mission_health
      `).get()
    : db.prepare(`
        SELECT conflict_count, rejected_count, affected_device_count
        FROM ingest_anomaly_mission_health WHERE mission_id = ?
      `).get(missionId)
  const deviceWhere = missionId === undefined ? '' : 'mission_id = ? AND '
  const parameters = missionId === undefined ? [] : [missionId]
  const conflictDeviceIds = db.prepare(`
    SELECT device_id FROM ingest_anomaly_devices
    WHERE ${deviceWhere}conflict_count > 0
    ORDER BY device_id ASC LIMIT 100
  `).all(...parameters).map((row) => row.device_id)
  return {
    conflictCount: Number(counts?.conflict_count ?? 0),
    rejectedCount: Number(counts?.rejected_count ?? 0),
    affectedDeviceCount: Number(counts?.affected_device_count ?? 0),
    conflictDeviceIds,
  }
}

/** Updates constant-size mission health and bounded per-device summary rows. */
function recordInsertedAnomalySummary(db, missionId, kind, deviceId) {
  const conflictIncrement = kind === 'conflict' ? 1 : 0
  const rejectedIncrement = kind === 'rejected' ? 1 : 0
  db.prepare(`
    INSERT INTO ingest_anomaly_mission_health (
      mission_id, conflict_count, rejected_count, affected_device_count
    ) VALUES (?, ?, ?, 0)
    ON CONFLICT(mission_id) DO UPDATE SET
      conflict_count = conflict_count + excluded.conflict_count,
      rejected_count = rejected_count + excluded.rejected_count
  `).run(missionId, conflictIncrement, rejectedIncrement)
  if (deviceId === null) return
  const insertedDevice = db.prepare(`
    INSERT INTO ingest_anomaly_devices (
      mission_id, device_id, conflict_count, rejected_count
    ) VALUES (?, ?, 0, 0)
    ON CONFLICT(mission_id, device_id) DO NOTHING
  `).run(missionId, deviceId)
  if (insertedDevice.changes > 0) {
    db.prepare(`
      UPDATE ingest_anomaly_mission_health
      SET affected_device_count = affected_device_count + 1
      WHERE mission_id = ?
    `).run(missionId)
  }
  db.prepare(`
    UPDATE ingest_anomaly_devices
    SET conflict_count = conflict_count + ?,
        rejected_count = rejected_count + ?
    WHERE mission_id = ? AND device_id = ?
  `).run(conflictIncrement, rejectedIncrement, missionId, deviceId)
}

module.exports = {
  countStoreWriteAnomalies,
  listIngestAnomalies,
  recordConflictAnomaly,
  recordRejectedAnomaly,
  recordStoreRejectedPosition,
  summarizeIngestAnomalies,
}
