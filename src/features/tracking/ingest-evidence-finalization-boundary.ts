import type {
  MissionArchiveCustodyInput,
  RestoreMissionForCorrectionInput,
  RestoreMissionForCorrectionResult,
  UnlockFinalizedMissionInput,
} from '../../infrastructure/mission-store/tauri-mission-store'

export type MissionCorrectionEvidenceRecoveryFacts = Readonly<{
  committed: true
  cleanupComplete: boolean
  evidenceReopenFailed: true
}>

const correctionEvidenceFactsByFailure = new WeakMap<
  object,
  MissionCorrectionEvidenceRecoveryFacts
>()

/** Creates one locally authenticated failure for a post-commit renderer transition. */
function createMissionCorrectionEvidenceRecoveryFailure(cleanupComplete: boolean): Error {
  const failure = new Error(
    'Archive correction committed; renderer evidence recovery is required.',
  )
  correctionEvidenceFactsByFailure.set(failure, Object.freeze({
    committed: true,
    cleanupComplete,
    evidenceReopenFailed: true,
  }))
  return failure
}

/** Reads local correction facts without touching properties on an untrusted failure. */
export function readMissionCorrectionEvidenceRecoveryFailure(
  failure: unknown,
): MissionCorrectionEvidenceRecoveryFacts | null {
  if (failure === null
    || (typeof failure !== 'object' && typeof failure !== 'function')) {
    return null
  }
  return correctionEvidenceFactsByFailure.get(failure) ?? null
}

type FinalizableMissionStore = {
  readonly finishMission?: (missionId: string) => Promise<unknown>
  readonly finalizeMission: (
    missionId: string,
    custody: MissionArchiveCustodyInput,
  ) => Promise<unknown>
  readonly unlockFinalizedMission: (input: UnlockFinalizedMissionInput) => Promise<unknown>
  readonly restoreMissionForCorrection?: (
    input: RestoreMissionForCorrectionInput,
  ) => Promise<RestoreMissionForCorrectionResult>
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
  const restoreMissionForCorrection = missionStore.restoreMissionForCorrection
  const correctionBoundary = restoreMissionForCorrection === undefined
    ? {}
    : {
        restoreMissionForCorrection: async (input: RestoreMissionForCorrectionInput) => {
          const result = await restoreMissionForCorrection(input)
          const correction = result?.correction
          const committed = correction?.committed === true
          const cleanupComplete = correction?.cleanupComplete === true
          const failureCode = correction?.failureCode
          if (correction === undefined
            || (committed && cleanupComplete && failureCode === undefined)) {
            try {
              evidence.reopenMissionEvidenceAfterUnlock(input.mission_id)
            } catch {
              throw createMissionCorrectionEvidenceRecoveryFailure(
                committed && cleanupComplete,
              )
            }
          }
          return result
        },
      }
  return {
    ...missionStore,
    reopenMissionEvidenceAfterUnlock: evidence.reopenMissionEvidenceAfterUnlock,
    ...finishBoundary,
    ...correctionBoundary,
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
