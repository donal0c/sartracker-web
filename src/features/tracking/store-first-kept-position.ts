import { isCanonicalFixTimeEvidence } from './canonical-fix-time-evidence'
import type { NormalizedTrackingPosition } from './tracking-types'

/**
 * The live trail's mirror of the mission store's rule for one Traccar position
 * id [DON-338]. The store (`electron/position-ingest-policy.cjs`) keeps the
 * first row it saved for an id. A later row with the same id and the same
 * stored content is a duplicate; one with different stored content is a
 * source-id conflict, and the store keeps the first row and refuses it.
 *
 * The store's acknowledgement carries only counts, not which rows it refused,
 * so the live line applies the same rule to the same observations instead:
 * the runtime saves exactly the fixes that carry a verified Traccar fix time
 * (`isCanonicalFixTimeEvidence`), in the order the poller received them.
 */

/**
 * Returns true when `incoming` must not replace the `held` fix with the same
 * position id, because the store kept `held` and refuses or never saves
 * `incoming`. A held fix the store never saved (no verified fix time) may
 * still be replaced, as before, since the store kept nothing for it.
 */
export function storeKeepsHeldPosition(
  held: NormalizedTrackingPosition,
  heldTimestampMs: number,
  incoming: NormalizedTrackingPosition,
  incomingTimestampMs: number,
): boolean {
  if (held.id.trim() === '' || !isCanonicalFixTimeEvidence(held)) {
    return false
  }
  if (!isCanonicalFixTimeEvidence(incoming)) {
    return true
  }
  return !hasSameStoredContent(held, heldTimestampMs, incoming, incomingTimestampMs)
}

/**
 * Compares the fields the store hashes to decide duplicate versus conflict
 * (`canonicalizeAcceptedPosition`): coordinates, altitude, speed, battery,
 * accuracy, source and the fix time as an instant. Receipt metadata such as
 * data origin or cache age is not part of the stored identity. The store also
 * hashes the device name, which a breadcrumb does not carry; a name-only
 * change cannot move a vertex, so it does not matter to the drawn line.
 */
function hasSameStoredContent(
  held: NormalizedTrackingPosition,
  heldTimestampMs: number,
  incoming: NormalizedTrackingPosition,
  incomingTimestampMs: number,
): boolean {
  return held.device_id === incoming.device_id &&
    held.lat === incoming.lat &&
    held.lon === incoming.lon &&
    (held.altitude ?? null) === (incoming.altitude ?? null) &&
    (held.speed ?? null) === (incoming.speed ?? null) &&
    (held.battery ?? null) === (incoming.battery ?? null) &&
    (held.accuracy ?? null) === (incoming.accuracy ?? null) &&
    (held.source ?? null) === (incoming.source ?? null) &&
    heldTimestampMs === incomingTimestampMs
}
