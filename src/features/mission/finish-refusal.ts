import type { ParticipantBackfillCheckpoint } from '../../infrastructure/mission-store/tauri-mission-store'

/**
 * The part of the mission store's Finish refusal that means participant
 * history is still being fetched. The store's full sentence stays the
 * diagnostic record; operators see the plain wording below (DON-376).
 */
const HISTORY_INCOMPLETE_REFUSAL = /participant history backfill checkpoint\(s\) are incomplete/

/** Said once every earlier track has loaded after a refused Finish (DON-376). */
export const HISTORY_NOW_LOADED_NOTE = 'Earlier tracks have now loaded. Press Confirm Finish again.'

/**
 * The participant list shows no earlier tracks left, but it may be older than
 * the store, so the app does not claim they have loaded (DON-376).
 */
export const HISTORY_MAY_HAVE_LOADED_NOTE =
  'Earlier tracks may have finished loading. Press Confirm Finish again; if it is still refused, press Try again.'

/**
 * Start Fresh after a restart finishes the unfinished mission, so the same
 * refusal applies; its history only loads while that mission runs (DON-376).
 */
export const HISTORY_START_FRESH_REFUSAL =
  "Can't start a new mission yet. SAR Tracker still has earlier tracks to fetch for the unfinished mission. Press Resume, check the internet connection, and finish it once they have loaded."

/** What the operator is told after pressing Try again succeeds (DON-376). */
export const HISTORY_RETRY_STARTED_NOTE = 'Fetching earlier tracks again. Press Confirm Finish once they have loaded.'

/**
 * The note after Try again started a fetch. Devices with no saved mission
 * record cannot be fetched, so they are named rather than hidden.
 */
export function describeHistoryRetryStarted(unfetchableDeviceCount: number): string {
  if (unfetchableDeviceCount < 1) return HISTORY_RETRY_STARTED_NOTE
  const devices = `${unfetchableDeviceCount} ${unfetchableDeviceCount === 1 ? 'device' : 'devices'}`
  return `${HISTORY_RETRY_STARTED_NOTE} Earlier tracks for ${devices} cannot be fetched; see the PARTICIPANT HISTORY UNAVAILABLE warning.`
}

/**
 * True when a Finish failure is the store refusing because participant
 * history has not finished downloading.
 */
export function isHistoryIncompleteFinishRefusal(message: string): boolean {
  return HISTORY_INCOMPLETE_REFUSAL.test(message)
}

/**
 * The plain words for a Finish refused while earlier tracks are still being
 * fetched. `peopleCount` is null when the count is not known; it is never
 * guessed.
 */
export function describeHistoryIncompleteFinishRefusal(peopleCount: number | null): string {
  const who = peopleCount === null || peopleCount < 1
    ? 'some people'
    : `${peopleCount} ${peopleCount === 1 ? 'person' : 'people'}`
  return `Can't finish yet. SAR Tracker is still fetching earlier tracks for ${who}. Check the internet connection, then press Try again.`
}

/**
 * Counts the distinct people (tracking devices) on a mission whose earlier
 * history is still incomplete. One person can have several history windows.
 */
export function countPeopleStillFetchingHistory(
  checkpoints: readonly ParticipantBackfillCheckpoint[],
  missionId: string,
): number {
  const devices = new Set<string>()
  for (const checkpoint of checkpoints) {
    if (checkpoint.mission_id === missionId && checkpoint.completed !== 1) {
      devices.add(checkpoint.traccar_device_id)
    }
  }
  return devices.size
}

/** The participant store fields that say what history is still missing. */
export type ParticipantHistoryScope = {
  readonly activeMissionId: string | null
  readonly error: string | null
  readonly checkpoints: readonly ParticipantBackfillCheckpoint[]
}

/**
 * People still waiting for earlier tracks, or null when the participant store
 * cannot say: it holds another mission, its last refresh failed, or it has
 * no checkpoints for this mission. Null is never read as "all loaded".
 */
export function countPeopleStillFetchingHistoryIfKnown(
  scope: ParticipantHistoryScope,
  missionId: string,
): number | null {
  if (scope.activeMissionId !== missionId || scope.error !== null) return null
  if (!scope.checkpoints.some((checkpoint) => checkpoint.mission_id === missionId)) return null
  return countPeopleStillFetchingHistory(scope.checkpoints, missionId)
}
