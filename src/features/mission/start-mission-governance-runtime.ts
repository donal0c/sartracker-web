import type {
  FinalizeMissionResult,
  IngestEvidenceHealth,
  Mission,
  MissionStore,
  UnlockFinalizedMissionInput,
} from '../../infrastructure/mission-store/tauri-mission-store'
import type { AcknowledgeIngestEvidenceLossInput } from '../../domain/tracking-ingest-evidence'
import type { AutosaveSyncReason } from '../persistence/autosave-status-store'

type MissionGovernanceStoreBoundary = Pick<
  MissionStore,
  | 'listMissions'
  | 'finalizeMission'
  | 'acknowledgeIngestEvidenceLoss'
  | 'unlockFinalizedMission'
>

export type MissionGovernanceRuntimeState = {
  readonly governanceMission: Mission | null
}

type StartMissionGovernanceRuntimeDependencies = {
  readonly missionStore: MissionGovernanceStoreBoundary
  readonly applyRuntime: (runtime: MissionGovernanceRuntimeState) => void
  readonly requestAutosaveSync?: (reason: AutosaveSyncReason) => Promise<void>
}

export type MissionGovernanceController = {
  readonly refreshGovernanceMission: () => Promise<void>
  readonly finalizeGovernanceMission: (missionId: string) => Promise<FinalizeMissionResult>
  readonly acknowledgeGovernanceEvidenceLoss: (
    input: AcknowledgeIngestEvidenceLossInput,
  ) => Promise<IngestEvidenceHealth>
  readonly unlockGovernanceMission: (input: UnlockFinalizedMissionInput) => Promise<Mission>
}

/**
 * Manages post-finish mission governance state without polluting the active mission runtime.
 */
export async function startMissionGovernanceRuntime(
  dependencies: StartMissionGovernanceRuntimeDependencies,
): Promise<MissionGovernanceController> {
  let governanceMission: Mission | null = null

  await refreshGovernanceMission()

  return {
    refreshGovernanceMission,
    finalizeGovernanceMission: async (missionId) => {
      const result = await dependencies.missionStore.finalizeMission(missionId)
      await refreshGovernanceMission()
      await requestAutosaveSync('mission-finalize')
      return result
    },
    acknowledgeGovernanceEvidenceLoss: async (input) => {
      const health = await dependencies.missionStore.acknowledgeIngestEvidenceLoss(input)
      await requestAutosaveSync('mission-evidence-loss-acknowledgement')
      return health
    },
    unlockGovernanceMission: async (input) => {
      const mission = await dependencies.missionStore.unlockFinalizedMission(input)
      await refreshGovernanceMission()
      await requestAutosaveSync('mission-unlock')
      return mission
    },
  }

  async function refreshGovernanceMission(): Promise<void> {
    const missions = await dependencies.missionStore.listMissions()
    governanceMission =
      missions.find((mission) => mission.status === 'finished' || mission.status === 'finalized') ??
      null
    publishRuntime()
  }

  function publishRuntime(): void {
    dependencies.applyRuntime({ governanceMission })
  }

  async function requestAutosaveSync(reason: AutosaveSyncReason): Promise<void> {
    try {
      await dependencies.requestAutosaveSync?.(reason)
    } catch (error) {
      console.warn('Mission governance autosave request failed.', error)
    }
  }
}
