import type { MissionReviewSnapshot } from './mission-review-model'

/** Returns whether a finished mission is in the explicitly authorized correction epoch. */
export function hasActiveMissionCorrectionAuthorization(
  snapshot: MissionReviewSnapshot,
): boolean {
  return snapshot.mission.status === 'finished' && snapshot.correctionAuthorized
}
