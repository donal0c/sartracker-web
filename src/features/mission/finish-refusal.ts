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
 * Start Fresh after a restart finishes the unfinished mission, so the same
 * refusal applies; its history only loads while that mission runs (DON-376).
 */
export const HISTORY_START_FRESH_REFUSAL =
  "Can't start a new mission yet. SAR Tracker still has earlier tracks to fetch for the unfinished mission. Press Resume, check the internet connection, and finish it once they have loaded."

/** What the operator is told after pressing Try again succeeds (DON-376). */
export const HISTORY_RETRY_STARTED_NOTE = 'Fetching earlier tracks again. Press Finish once they have loaded.'

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
