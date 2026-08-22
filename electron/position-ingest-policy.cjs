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

/**
 * Preserves the shipped correction classifier during policy extraction. This
 * is intentionally separate from the immutable-source policy above so the
 * later first-accepted-wins change can be isolated and reviewed.
 */
function classifyLegacyCorrection(existing, input, timestamp, dataOrigin) {
  const previous = canonicalizeLegacyPosition(existing)
  const corrected = canonicalizeLegacyPosition({
    ...input,
    timestamp,
    data_origin: dataOrigin,
  })
  const changedFields = Object.keys(previous).filter(
    (field) => previous[field] !== corrected[field],
  )
  return { previous, corrected, changedFields }
}

/** Builds the exact legacy correction payload without changing shipped semantics. */
function canonicalizeLegacyPosition(position) {
  return {
    device_id: position.device_id,
    name: position.name ?? null,
    lat: position.lat,
    lon: position.lon,
    altitude: position.altitude ?? null,
    speed: position.speed ?? null,
    battery: position.battery ?? null,
    accuracy: position.accuracy ?? null,
    source: position.source ?? null,
    timestamp: position.timestamp,
    data_origin: position.data_origin,
  }
}

module.exports = {
  canonicalizeAcceptedPosition,
  classifyPositionIngest,
  classifyLegacyCorrection,
}
