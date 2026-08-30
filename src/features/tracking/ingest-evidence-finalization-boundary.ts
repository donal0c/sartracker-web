import type {
  MissionArchiveCustodyInput,
  UnlockFinalizedMissionInput,
} from '../../infrastructure/mission-store/tauri-mission-store'

type FinalizableMissionStore = {
  readonly finishMission?: (missionId: string) => Promise<unknown>
  readonly finalizeMission: (
    missionId: string,
    custody: MissionArchiveCustodyInput,
  ) => Promise<unknown>
  readonly unlockFinalizedMission: (input: UnlockFinalizedMissionInput) => Promise<unknown>
}

type RendererEvidenceBoundary = {
  readonly flushMission: (missionId: string) => Promise<void>
  readonly runWithMissionFinishFence: <Result>(
    missionId: string,
    operation: () => Promise<Result>,
  ) => Promise<Result>
  readonly runWithMissionFinalizationFence: <Result>(
    missionId: string,
    operation: () => Promise<Result>,
  ) => Promise<Result>
  readonly reopenMissionEvidenceAfterUnlock: (missionId: string) => void
}

/**
 * Prevents mission completeness from racing renderer-held rejection evidence.
 * The main-process finalized-status guard remains the final atomic fence.
 */
export function createIngestEvidenceFinalizationBoundary<
  Store extends FinalizableMissionStore,
>(
  missionStore: Store,
  evidence: RendererEvidenceBoundary,
): Store {
  const finishMission = missionStore.finishMission
  const finishBoundary = finishMission === undefined
    ? {}
    : {
        finishMission: async (missionId: string) =>
          evidence.runWithMissionFinishFence(
            missionId,
            () => finishMission(missionId),
          ),
      }
  return {
    ...missionStore,
    ...finishBoundary,
    finalizeMission: async (missionId: string, custody: MissionArchiveCustodyInput) =>
      evidence.runWithMissionFinalizationFence(
        missionId,
        () => missionStore.finalizeMission(missionId, custody),
      ),
    unlockFinalizedMission: async (
      input: Parameters<Store['unlockFinalizedMission']>[0],
    ) => {
      const mission = await missionStore.unlockFinalizedMission(input)
      evidence.reopenMissionEvidenceAfterUnlock(input.mission_id)
      return mission
    },
  } as Store
}
