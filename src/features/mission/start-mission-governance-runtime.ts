import type {
  FinalizeMissionResult,
  IngestEvidenceHealth,
  Mission,
  MissionArchiveCustodyInput,
  MissionArchiveInfo,
  MissionArchiveRecoveryIssuance,
  MissionCleanupEligibility,
  MissionCleanupResult,
  MissionStore,
  ResumeMissionCleanupInput,
  StartMissionCleanupInput,
  UnlockFinalizedMissionInput,
} from '../../infrastructure/mission-store/tauri-mission-store'
import type { AcknowledgeIngestEvidenceLossInput } from '../../domain/tracking-ingest-evidence'
import { EMPTY_INGEST_EVIDENCE_HEALTH } from '../../domain/tracking-ingest-evidence'
import type { AutosaveSyncReason } from '../persistence/autosave-status-store'

type MissionGovernanceStoreBoundary = Pick<
  MissionStore,
  | 'listMissions'
  | 'getIngestEvidenceHealth'
  | 'finalizeMission'
  | 'issueMissionArchiveRecoveryCode'
  | 'cancelMissionArchiveOperation'
  | 'listMissionArchives'
  | 'getMissionCleanupEligibility'
  | 'startMissionCleanup'
  | 'resumeMissionCleanup'
  | 'acknowledgeIngestEvidenceLoss'
  | 'unlockFinalizedMission'
>

export type MissionGovernanceRuntimeState = {
  readonly governanceMission: Mission | null
  readonly governanceEvidenceHealth: IngestEvidenceHealth | null
}

type StartMissionGovernanceRuntimeDependencies = {
  readonly missionStore: MissionGovernanceStoreBoundary
  readonly applyRuntime: (runtime: MissionGovernanceRuntimeState) => void
  readonly requestAutosaveSync?: (reason: AutosaveSyncReason) => Promise<void>
}

export type MissionGovernanceController = {
  readonly refreshGovernanceMission: () => Promise<void>
  readonly issueGovernanceArchiveRecoveryCode: (
    missionId: string,
  ) => Promise<MissionArchiveRecoveryIssuance>
  readonly cancelGovernanceArchiveOperation: (operationId: string) => Promise<boolean>
  readonly readGovernanceCleanupState: (missionId: string) => Promise<{
    readonly archive: MissionArchiveInfo
    readonly eligibility: MissionCleanupEligibility
  }>
  readonly startGovernanceCleanup: (
    input: StartMissionCleanupInput,
  ) => Promise<MissionCleanupResult>
  readonly resumeGovernanceCleanup: (
    input: ResumeMissionCleanupInput,
  ) => Promise<MissionCleanupResult>
  readonly finalizeGovernanceMission: (
    missionId: string,
    custody: MissionArchiveCustodyInput,
  ) => Promise<FinalizeMissionResult>
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
  let governanceEvidenceHealth: IngestEvidenceHealth | null = null

  await refreshGovernanceMission()

  return {
    refreshGovernanceMission,
    issueGovernanceArchiveRecoveryCode: (missionId) =>
      dependencies.missionStore.issueMissionArchiveRecoveryCode(missionId),
    cancelGovernanceArchiveOperation: (operationId) =>
      dependencies.missionStore.cancelMissionArchiveOperation(operationId),
    readGovernanceCleanupState: async (missionId) => {
      if (dependencies.missionStore.getMissionCleanupEligibility === undefined) {
        throw new Error('Mission live-store archival is unavailable.')
      }
      const archives = await dependencies.missionStore.listMissionArchives(missionId)
      const archive = [...archives]
        .filter((candidate) => candidate.mission_id === missionId)
        .sort((left, right) => right.revision_sequence - left.revision_sequence)[0]
      if (archive === undefined) {
        throw new Error('No mission archive is available for live-store archival.')
      }
      const eligibility = await dependencies.missionStore.getMissionCleanupEligibility({
        missionId,
        archiveId: archive.id,
      })
      return { archive, eligibility }
    },
    startGovernanceCleanup: async (input) => {
      if (dependencies.missionStore.startMissionCleanup === undefined) {
        throw new Error('Mission live-store archival is unavailable.')
      }
      const result = await dependencies.missionStore.startMissionCleanup(input)
      if (governanceMission?.id === input.missionId
        && result.missionId === input.missionId
        && result.archiveId === input.archiveId
        && result.storageState === 'archived') {
        governanceMission = { ...governanceMission, storage_state: 'archived' }
        publishRuntime()
      }
      await reconcileGovernanceMissionAfterArchiveOperation()
      await requestAutosaveSync('mission-cleanup')
      return result
    },
    resumeGovernanceCleanup: async (input) => {
      if (dependencies.missionStore.resumeMissionCleanup === undefined) {
        throw new Error('Mission live-store archival recovery is unavailable.')
      }
      const result = await dependencies.missionStore.resumeMissionCleanup(input)
      if (governanceMission?.id === input.missionId
        && result.missionId === input.missionId
        && result.archiveId === input.archiveId
        && result.storageState === 'archived') {
        governanceMission = { ...governanceMission, storage_state: 'archived' }
        publishRuntime()
      }
      await reconcileGovernanceMissionAfterArchiveOperation()
      await requestAutosaveSync('mission-cleanup')
      return result
    },
    finalizeGovernanceMission: async (missionId, custody) => {
      let result: FinalizeMissionResult
      try {
        result = await dependencies.missionStore.finalizeMission(missionId, custody)
      } catch (error) {
        await reconcileGovernanceMissionAfterArchiveOperation()
        throw error
      }
      applyAuthoritativeFinalization(result, missionId)
      await reconcileGovernanceMissionAfterArchiveOperation()
      await requestAutosaveSync('mission-finalize')
      return result
    },
    acknowledgeGovernanceEvidenceLoss: async (input) => {
      const health = await dependencies.missionStore.acknowledgeIngestEvidenceLoss(input)
      governanceEvidenceHealth = health
      publishRuntime()
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
    governanceEvidenceHealth = await readGovernanceEvidenceHealth(governanceMission)
    publishRuntime()
  }

  function publishRuntime(): void {
    dependencies.applyRuntime({ governanceMission, governanceEvidenceHealth })
  }

  /** Publishes the minimum durable terminal truth before fallible reconciliation. */
  function applyAuthoritativeFinalization(
    result: FinalizeMissionResult,
    requestedMissionId: string,
  ): void {
    if (result.mission.id !== requestedMissionId
      || result.mission.status !== 'finalized'
      || governanceMission?.id !== requestedMissionId) {
      return
    }
    governanceMission = { ...governanceMission, status: 'finalized' }
    publishRuntime()
  }

  /** Reconciles current store state without replacing an authoritative archive outcome. */
  async function reconcileGovernanceMissionAfterArchiveOperation(): Promise<void> {
    try {
      await refreshGovernanceMission()
    } catch (error) {
      console.warn('Mission governance refresh failed after archive operation.', error)
    }
  }

  /** Fails closed when mission-scoped evidence health cannot be rehydrated. */
  async function readGovernanceEvidenceHealth(
    mission: Mission | null,
  ): Promise<IngestEvidenceHealth | null> {
    if (mission === null) return null
    if (dependencies.missionStore.getIngestEvidenceHealth === undefined) {
      return createUnavailableEvidenceHealth()
    }
    try {
      return await dependencies.missionStore.getIngestEvidenceHealth(mission.id)
    } catch {
      return createUnavailableEvidenceHealth()
    }
  }

  async function requestAutosaveSync(reason: AutosaveSyncReason): Promise<void> {
    try {
      await dependencies.requestAutosaveSync?.(reason)
    } catch (error) {
      console.warn('Mission governance autosave request failed.', error)
    }
  }
}

/** Creates an explicit blocker without sharing a mutable health value. */
function createUnavailableEvidenceHealth(): IngestEvidenceHealth {
  return {
    ...EMPTY_INGEST_EVIDENCE_HEALTH,
    state: 'critical',
    reason: 'evidence_health_unavailable',
  }
}
