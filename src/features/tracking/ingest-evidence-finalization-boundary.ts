type FinalizableMissionStore = {
  readonly finalizeMission: (missionId: string) => Promise<unknown>
}

type RendererEvidenceBoundary = {
  readonly flushMission: (missionId: string) => Promise<void>
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
  return {
    ...missionStore,
    finalizeMission: async (missionId: string) => {
      await evidence.flushMission(missionId)
      return missionStore.finalizeMission(missionId)
    },
  }
}
