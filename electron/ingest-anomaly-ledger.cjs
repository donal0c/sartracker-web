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

module.exports = {
  listIngestAnomalies,
  recordConflictAnomaly,
}
