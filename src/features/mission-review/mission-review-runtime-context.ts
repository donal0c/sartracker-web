import type { MissionStore } from '../../infrastructure/mission-store/tauri-mission-store'

/** The app-owned store used by both live and archive Mission Review runtimes. */
export type MissionReviewMissionStore = MissionStore

let activeMissionReviewMissionStore: MissionReviewMissionStore | null = null

/** Registers the app-owned mission store for the archive Review bridge. */
export function setMissionReviewMissionStore(
  missionStore: MissionReviewMissionStore | null,
): void {
  activeMissionReviewMissionStore = missionStore
}

/** Returns the app-owned mission store, if the runtime has started. */
export function getMissionReviewMissionStore(): MissionReviewMissionStore | null {
  return activeMissionReviewMissionStore
}
