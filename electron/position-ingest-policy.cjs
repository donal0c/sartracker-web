const { createHash } = require('node:crypto')

/**
 * Builds the fixed-key canonical source payload used for identity comparison.
 * Receipt time and SAR Tracker transport origin are intentionally excluded:
 * they describe delivery, not the immutable Traccar source record.
 */
function canonicalizeAcceptedPosition(input) {
  const payload = {
    source_position_id: input.source_position_id ?? null,
    device_id: input.device_id,
    name: input.name ?? null,
    lat: input.lat,
    lon: input.lon,
    altitude: input.altitude ?? null,
    speed: input.speed ?? null,
    battery: input.battery ?? null,
    accuracy: input.accuracy ?? null,
    source: input.source ?? null,
    timestamp: input.timestamp,
  }
  const canonicalJson = JSON.stringify(payload)
  return {
    payload,
    canonicalJson,
    contentHash: createHash('sha256').update(canonicalJson, 'utf8').digest('hex'),
  }
}

/**
 * Classifies an accepted position without mutating persistence state.
 */
function classifyPositionIngest(input) {
  const incoming = canonicalizeAcceptedPosition(input.incoming)
  if (input.existing === undefined) {
    return { decision: 'insert', contentHash: incoming.contentHash }
  }

  const existing = canonicalizeAcceptedPosition(input.existing)
  return {
    decision:
      existing.contentHash === incoming.contentHash ? 'duplicate' : 'conflict',
    contentHash: incoming.contentHash,
  }
}

module.exports = {
  canonicalizeAcceptedPosition,
  classifyPositionIngest,
}
