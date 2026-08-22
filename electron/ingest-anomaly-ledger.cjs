const { randomUUID } = require('node:crypto')

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
  db.prepare(`
    INSERT INTO ingest_anomalies (
      id, mission_id, kind, anomaly_key, device_id, source_position_id,
      reason_class, received_at, canonical_payload_json, created_at
    ) VALUES (?, ?, 'conflict', ?, ?, ?, ?, ?, ?, ?)
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
  )
}

/** Lists mission anomalies without interpreting or emitting their payloads. */
function listIngestAnomalies(db, missionId) {
  return db.prepare(`
    SELECT * FROM ingest_anomalies
    WHERE mission_id = ?
    ORDER BY created_at ASC, id ASC
  `).all(missionId)
}

/**
 * Projects one durable rejection delivery transactionally. Delivery identity
 * and anomaly content identity are independently idempotent.
 */
function recordRejectedAnomaly(db, envelope) {
  const transaction = db.transaction(() => {
    const delivered = db.prepare(
      'SELECT delivery_id FROM ingest_anomaly_deliveries WHERE delivery_id = ?',
    ).get(envelope.deliveryId)
    if (delivered !== undefined) {
      return false
    }
    db.prepare(`
      INSERT INTO ingest_anomalies (
        id, mission_id, kind, anomaly_key, device_id, source_position_id,
        reason_class, received_at, canonical_payload_json, created_at
      ) VALUES (?, ?, 'rejected', ?, ?, ?, ?, ?, ?, ?)
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
    )
    db.prepare(`
      INSERT INTO ingest_anomaly_deliveries (delivery_id, mission_id, projected_at)
      VALUES (?, ?, ?)
    `).run(envelope.deliveryId, envelope.missionId, envelope.receivedAt)
    return true
  })
  return transaction()
}

/** Returns bounded aggregate health facts without anomaly content. */
function summarizeIngestAnomalies(db, missionId) {
  const where = missionId === undefined ? '' : 'WHERE mission_id = ?'
  const parameters = missionId === undefined ? [] : [missionId]
  const counts = db.prepare(`
    SELECT
      SUM(CASE WHEN kind = 'conflict' THEN 1 ELSE 0 END) AS conflict_count,
      SUM(CASE WHEN kind = 'rejected' THEN 1 ELSE 0 END) AS rejected_count,
      COUNT(DISTINCT device_id) AS affected_device_count
    FROM ingest_anomalies ${where}
  `).get(...parameters)
  const conflictDeviceIds = db.prepare(`
    SELECT DISTINCT device_id FROM ingest_anomalies
    ${where}${where === '' ? 'WHERE' : ' AND'} kind = 'conflict' AND device_id IS NOT NULL
    ORDER BY device_id ASC LIMIT 100
  `).all(...parameters).map((row) => row.device_id)
  return {
    conflictCount: Number(counts?.conflict_count ?? 0),
    rejectedCount: Number(counts?.rejected_count ?? 0),
    affectedDeviceCount: Number(counts?.affected_device_count ?? 0),
    conflictDeviceIds,
  }
}

module.exports = {
  listIngestAnomalies,
  recordConflictAnomaly,
  recordRejectedAnomaly,
  summarizeIngestAnomalies,
}
