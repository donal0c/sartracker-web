// Which observations of one tracking write the mission store refused as
// source-id conflicts [DON-338 round 9].
//
// The store keeps the first row it saw for a Traccar position id and refuses
// a later row with the same id and different content. Its acknowledgement
// names each refused row by its index in the batch, its device id and its
// provider position id as sent. The tracking runtime reads that list here,
// on receipt from the IPC boundary, and maps it back to the observations it
// sent so the live trail never draws a refused fix. A missing or malformed
// list is a persistence failure, never "nothing was refused".

/** One refused row as it crosses the IPC boundary from the mission store. */
export type RefusedSourceIdentityConflict = {
  /** Zero-based position of the row in the batch the runtime sent. */
  readonly index: number
  readonly device_id: string
  /** The provider position id exactly as the runtime sent it. */
  readonly source_position_id: string
}

/** The renderer-side identity of an observation sent to the store. */
type SentObservation = {
  /** The provider position id, sent to the store as `source_position_id`. */
  readonly id: string
  readonly device_id: string
}

const ACKNOWLEDGEMENT_FAILURE =
  'Mission storage did not confirm which trail fixes it refused, so the new fixes from this save '
  + 'are kept off the map until a save is confirmed.'

/**
 * Returns the observations, from those just sent, that the mission store
 * refused as source-id conflicts.
 *
 * `sent` must be the observations in the exact order their rows were sent.
 * Each named row must match the device and provider id sent at its index,
 * no row may be named twice, and the list must agree with the store's own
 * conflict count for the call.
 *
 * @param acknowledgement the store's write acknowledgement, as received over IPC
 * @param sent the observations whose rows made up the batch, in batch order
 * @returns the refused observations, as the same objects passed in `sent`
 * @throws Error in operator words when the store's answer is missing or malformed
 */
export function readRefusedSourcePositions<Observation extends SentObservation>(
  acknowledgement: unknown,
  sent: readonly Observation[],
): readonly Observation[] {
  if (typeof acknowledgement !== 'object' || acknowledgement === null) {
    throw acknowledgementFailure('no acknowledgement was received')
  }
  const { refusedSourceIdentityConflicts: list, sourceIdentityConflictCount: count } =
    acknowledgement as Record<string, unknown>
  if (!Array.isArray(list)) {
    throw acknowledgementFailure('the refused-row list is missing')
  }
  if (typeof count === 'number' && count !== list.length) {
    throw acknowledgementFailure(`the list names ${list.length} rows but the store counted ${count}`)
  }
  const seen = new Set<number>()
  const refused: Observation[] = []
  for (const entry of list as readonly unknown[]) {
    const named = readEntry(entry)
    const observation = named === null ? undefined : sent[named.index]
    if (named === null || observation === undefined) {
      throw acknowledgementFailure('a refused row is malformed or outside the batch')
    }
    if (observation.device_id !== named.device_id || observation.id !== named.source_position_id) {
      throw acknowledgementFailure(`refused row ${named.index} does not match the fix that was sent`)
    }
    if (seen.has(named.index)) {
      throw acknowledgementFailure(`refused row ${named.index} is named twice`)
    }
    seen.add(named.index)
    refused.push(observation)
  }
  return refused
}

/** Reads one list entry, or null when it is not a well-formed refused row. */
function readEntry(entry: unknown): RefusedSourceIdentityConflict | null {
  if (typeof entry !== 'object' || entry === null) return null
  const { index, device_id: deviceId, source_position_id: sourcePositionId } =
    entry as Record<string, unknown>
  if (
    typeof index !== 'number' || !Number.isSafeInteger(index) || index < 0 ||
    typeof deviceId !== 'string' || typeof sourcePositionId !== 'string'
  ) {
    return null
  }
  return { index, device_id: deviceId, source_position_id: sourcePositionId }
}

/** Builds the persistence failure, with the operator sentence first. */
function acknowledgementFailure(detail: string): Error {
  return new Error(`${ACKNOWLEDGEMENT_FAILURE} (${detail})`)
}

/**
 * Returns `positions` without the observations the store refused. Refusals
 * are matched by object identity, so another observation with the same
 * provider id (for example the original the store kept, sent in the same
 * batch) is never removed with it.
 *
 * @param positions the observations of one write
 * @param refused the observations the store refused, from {@link readRefusedSourcePositions}
 * @returns the observations the store did not refuse, in their original order
 */
export function withoutRefusedPositions<Observation>(
  positions: readonly Observation[],
  refused: readonly Observation[],
): readonly Observation[] {
  if (refused.length === 0) return positions
  const refusedSet = new Set(refused)
  return positions.filter((position) => !refusedSet.has(position))
}
