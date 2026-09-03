import type { MissionReviewSnapshot } from './mission-review-model'

/** Returns whether a finished mission is in the explicitly authorized correction epoch. */
export function hasActiveMissionCorrectionAuthorization(
  snapshot: MissionReviewSnapshot,
): boolean {
  if (snapshot.mission.status !== 'finished') return false
  let finalizedSeen = false
  let unlockedAfterFinalization = false
  for (const event of snapshot.eventRows) {
    if (event.eventType === 'mission_finalized') {
      finalizedSeen = true
      unlockedAfterFinalization = false
    } else if (finalizedSeen && event.eventType === 'mission_unlocked') {
      unlockedAfterFinalization = true
    }
  }
  return unlockedAfterFinalization
}
