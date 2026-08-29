const MAX_REPLAY_MESSAGE_BYTES = 512 * 1024
const MAX_REPLAY_OBJECTS = 100
const MAX_REPLAY_PARTICIPANTS = 1_000
const MAX_REPLAY_LIMITATIONS = 100

/** Rejects a replay result that could monopolize worker-to-main structured cloning. */
function assertReplayResultBounded(result, trackLimit) {
  if (typeof result !== 'object' || result === null) {
    throw new Error('Mission replay worker result is invalid.')
  }
  if (result.tracks !== undefined) assertArrayBound(result.tracks, trackLimit, 'tracks')
  if (result.objects !== undefined) assertArrayBound(result.objects, MAX_REPLAY_OBJECTS, 'objects')
  if (result.participants !== undefined) {
    assertArrayBound(result.participants, MAX_REPLAY_PARTICIPANTS, 'participants')
  }
  if (result.groupMembership !== undefined) {
    assertArrayBound(result.groupMembership, MAX_REPLAY_PARTICIPANTS, 'group membership')
  }
  if (result.limitations !== undefined) {
    assertArrayBound(result.limitations, MAX_REPLAY_LIMITATIONS, 'limitations')
  }
  if (result.staticGpxEvidence !== undefined) {
    assertArrayBound(result.staticGpxEvidence, 100, 'static GPX evidence')
  }
  if (result.entries !== undefined) assertArrayBound(result.entries, 100, 'filter choices')
  let serialized
  try {
    serialized = JSON.stringify(result)
  } catch {
    throw new Error('Mission replay worker result cannot be serialized safely.')
  }
  if (Buffer.byteLength(serialized, 'utf8') > MAX_REPLAY_MESSAGE_BYTES) {
    throw new Error('Mission replay worker result exceeds the bounded message byte budget.')
  }
}

/** Enforces one array cardinality boundary. */
function assertArrayBound(value, maximum, label) {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new Error(`Mission replay worker ${label} exceed the bounded message limit.`)
  }
}

module.exports = { MAX_REPLAY_MESSAGE_BYTES, assertReplayResultBounded }
