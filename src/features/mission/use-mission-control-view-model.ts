import { useCallback, useEffect, useState } from 'react'

import { loadAppSettings } from '../../infrastructure/settings-store/tauri-settings-store'
import type {
  FinalizeMissionResult,
  Mission,
  MissionArchiveInfo,
  MissionArchiveCustodyInput,
  MissionArchiveProgress,
  MissionArchiveRecoveryIssuance,
  MissionCleanupEligibility,
  MissionCleanupResult,
  ResumeMissionCleanupInput,
  StartMissionCleanupInput,
} from '../../infrastructure/mission-store/tauri-mission-store'
import { readMissionArchiveErrorCode } from './mission-archive-error'
import { useFocusModeStore } from '../focus-mode/focus-mode-store'
import { useMissionReviewWorkspaceStore } from '../mission-review/mission-review-workspace-store'
import { useMissionStore, type MissionRuntimePhase } from './mission-store'
import type { MissionTimerState } from './mission-timers'
import { useMissionTimer } from './use-mission-timer'
import { useParticipantStore } from '../participants/participant-store'
import { isMissionModelEnabled } from '../runtime/mission-model-flag'

const MAX_START_OFFSET_HOURS = 48

export type MissionControlViewModel = {
  readonly phase: MissionRuntimePhase
  readonly currentMission: Mission | null
  readonly recoverableMission: Mission | null
  readonly governanceMission: Mission | null
  readonly focusModeActive: boolean
  readonly timerState: MissionTimerState | null
  readonly missionName: string
  readonly setMissionName: (name: string) => void
  readonly startOffsetHours: string
  readonly setStartOffsetHours: (hours: string) => void
  readonly startError: string | null
  readonly actionError: string | null
  readonly duplicateWarning: string | null
  readonly showFinishDialog: boolean
  readonly setShowFinishDialog: (show: boolean) => void
  readonly showFinalizeDialog: boolean
  readonly setShowFinalizeDialog: (show: boolean) => void
  readonly showUnlockDialog: boolean
  readonly setShowUnlockDialog: (show: boolean) => void
  readonly showCleanupDialog: boolean
  readonly setShowCleanupDialog: (show: boolean) => void
  readonly showEvidenceLossDialog: boolean
  readonly setShowEvidenceLossDialog: (show: boolean) => void
  readonly governanceBusy: boolean
  readonly governanceFeedback: string | null
  readonly adminRoster: readonly string[]
  readonly selectedAdmin: string
  readonly setSelectedAdmin: (admin: string) => void
  readonly unlockReason: string
  readonly setUnlockReason: (reason: string) => void
  readonly evidenceLossReason: string
  readonly setEvidenceLossReason: (reason: string) => void
  readonly canOpenReview: boolean
  readonly openReviewWorkspace: () => void
  readonly canStart: boolean
  readonly canPauseOrResume: boolean
  readonly pauseResumeLabel: 'Pause' | 'Resume'
  readonly canFinish: boolean
  readonly startMission: () => Promise<void>
  readonly pauseOrResume: () => Promise<void>
  readonly confirmFinish: () => Promise<void>
  readonly resumeRecoverable: () => Promise<void>
  readonly startFresh: () => Promise<void>
  readonly issueArchiveRecoveryCode: (
    missionId: string,
  ) => Promise<MissionArchiveRecoveryIssuance>
  readonly cancelArchiveOperation: (operationId: string) => Promise<boolean>
  readonly subscribeArchiveProgress: (
    listener: (progress: MissionArchiveProgress) => void,
  ) => () => void
  readonly confirmFinalize: (
    custody: MissionArchiveCustodyInput,
  ) => Promise<FinalizeMissionResult>
  readonly loadCleanupState: (missionId: string) => Promise<{
    readonly archive: MissionArchiveInfo
    readonly eligibility: MissionCleanupEligibility
  }>
  readonly startCleanup: (input: StartMissionCleanupInput) => Promise<MissionCleanupResult>
  readonly resumeCleanup: (input: ResumeMissionCleanupInput) => Promise<MissionCleanupResult>
  readonly confirmEvidenceLossAcknowledgement: () => Promise<void>
  readonly confirmUnlock: () => Promise<void>
}

/**
 * Owns Mission Control state and lifecycle actions so the component can stay
 * focused on rendering the operator surface.
 */
export function useMissionControlViewModel(): MissionControlViewModel {
  const phase = useMissionStore((state) => state.phase)
  const currentMission = useMissionStore((state) => state.currentMission)
  const recoverableMission = useMissionStore((state) => state.recoverableMission)
  const controller = useMissionStore((state) => state.controller)
  const governanceMission = useMissionStore((state) => state.governanceMission)
  const governanceEvidenceHealth = useMissionStore((state) => state.governanceEvidenceHealth)
  const governanceController = useMissionStore((state) => state.governanceController)
  const participantController = useParticipantStore((state) => state.controller)
  const openReviewWorkspace = useMissionReviewWorkspaceStore((state) => state.openWorkspace)
  const focusModeActive = useFocusModeStore((state) => state.active)
  const timerState = useMissionTimer(currentMission)
  const [missionName, setMissionNameState] = useState('')
  const [startOffsetHours, setStartOffsetHours] = useState('0')
  const [startError, setStartError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null)
  const [duplicateAcknowledged, setDuplicateAcknowledged] = useState(false)
  const [showFinishDialog, setShowFinishDialog] = useState(false)
  const [showFinalizeDialog, setShowFinalizeDialog] = useState(false)
  const [showUnlockDialog, setShowUnlockDialog] = useState(false)
  const [showCleanupDialog, setShowCleanupDialog] = useState(false)
  const [showEvidenceLossDialog, setShowEvidenceLossDialog] = useState(false)
  const [governanceBusy, setGovernanceBusy] = useState(false)
  const [governanceFeedback, setGovernanceFeedback] = useState<string | null>(null)
  const [adminRoster, setAdminRoster] = useState<readonly string[]>([])
  const [selectedAdmin, setSelectedAdmin] = useState('')
  const [unlockReason, setUnlockReason] = useState('')
  const [evidenceLossReason, setEvidenceLossReason] = useState('')
  const subscribeArchiveProgress = useCallback((
    listener: (progress: MissionArchiveProgress) => void,
  ): (() => void) => window.sartrackerElectron?.onMissionArchiveProgress?.(listener)
    ?? (() => undefined), [])

  useEffect(() => {
    if (!showUnlockDialog && !showEvidenceLossDialog) {
      return
    }

    let cancelled = false

    void loadAppSettings()
      .then((settings) => {
        if (cancelled) {
          return
        }

        setAdminRoster(settings.missionDefaults.adminRoster)
        setSelectedAdmin((current) =>
          current !== '' && settings.missionDefaults.adminRoster.includes(current)
            ? current
            : (settings.missionDefaults.adminRoster[0] ?? ''),
        )
      })
      .catch((error) => {
        if (!cancelled) {
          setActionError(toErrorMessage(error))
        }
      })

    return () => {
      cancelled = true
    }
  }, [showEvidenceLossDialog, showUnlockDialog])

  function setMissionName(name: string): void {
    setMissionNameState(name)
    setDuplicateWarning(null)
    setDuplicateAcknowledged(false)
  }

  async function startMission(): Promise<void> {
    if (controller === null) {
      return
    }

    setStartError(null)
    setActionError(null)

    const normalizedName = missionName.trim()
    if (normalizedName === '') {
      setStartError('Mission name is required.')
      return
    }

    const parsedOffset = Number(startOffsetHours)
    if (!Number.isFinite(parsedOffset) || parsedOffset < 0 || parsedOffset > MAX_START_OFFSET_HOURS) {
      setStartError(`Start offset must be between 0 and ${MAX_START_OFFSET_HOURS} hours.`)
      return
    }

    const hasConflict = await controller.hasMissionNameConflict(normalizedName)
    if (hasConflict && !duplicateAcknowledged) {
      setDuplicateWarning(
        'Mission name already exists. Starting anyway will create a separate mission record.',
      )
      setDuplicateAcknowledged(true)
      return
    }

    try {
      const mission = await controller.startMission({
        name: normalizedName,
        ...(parsedOffset === 0
          ? {}
          : { startTime: new Date(Date.now() - parsedOffset * 60 * 60 * 1000).toISOString() }),
      })
      if (isMissionModelEnabled()) {
        await participantController?.selectInitialParticipants(
          mission.id,
          'Mission coordinator',
        )
      }

      setMissionNameState('')
      setStartOffsetHours('0')
      setStartError(null)
      setDuplicateWarning(null)
      setDuplicateAcknowledged(false)
    } catch (error) {
      setStartError(toErrorMessage(error))
    }
  }

  async function pauseOrResume(): Promise<void> {
    if (controller === null) {
      return
    }

    setActionError(null)

    try {
      if (phase === 'paused') {
        await controller.resumeMission()
        return
      }

      await controller.pauseMission()
    } catch (error) {
      setActionError(toErrorMessage(error))
    }
  }

  async function confirmEvidenceLossAcknowledgement(): Promise<void> {
    if (governanceController === null || governanceMission === null) {
      return
    }

    setGovernanceBusy(true)
    setActionError(null)
    setGovernanceFeedback(null)

    try {
      await governanceController.acknowledgeGovernanceEvidenceLoss({
        mission_id: governanceMission.id,
        admin_name: selectedAdmin,
        reason: evidenceLossReason,
      })
      setGovernanceFeedback(
        `Evidence loss acknowledged by ${selectedAdmin}. Complete remains unavailable; Archive & Lock can now retain the mission with this permanent warning.`,
      )
      setShowEvidenceLossDialog(false)
      setEvidenceLossReason('')
    } catch (error) {
      setActionError(toErrorMessage(error))
    } finally {
      setGovernanceBusy(false)
    }
  }

  async function confirmFinish(): Promise<void> {
    if (controller === null) {
      return
    }

    setActionError(null)

    try {
      await controller.finishMission()
      await governanceController?.refreshGovernanceMission()
      setShowFinishDialog(false)
    } catch (error) {
      setActionError(toErrorMessage(error))
    }
  }

  async function resumeRecoverable(): Promise<void> {
    if (controller === null) {
      return
    }

    setActionError(null)

    try {
      await controller.resumeRecoverableMission()
    } catch (error) {
      setActionError(toErrorMessage(error))
    }
  }

  async function startFresh(): Promise<void> {
    if (controller === null) {
      return
    }

    setActionError(null)

    try {
      await controller.startFresh()
      await governanceController?.refreshGovernanceMission()
    } catch (error) {
      setActionError(toErrorMessage(error))
    }
  }

  async function issueArchiveRecoveryCode(
    missionId: string,
  ): Promise<MissionArchiveRecoveryIssuance> {
    if (governanceController === null) {
      throw new Error('Mission archive custody is unavailable.')
    }
    return governanceController.issueGovernanceArchiveRecoveryCode(missionId)
  }

  async function cancelArchiveOperation(operationId: string): Promise<boolean> {
    if (governanceController === null) {
      throw new Error('Mission archive cancellation is unavailable.')
    }
    return governanceController.cancelGovernanceArchiveOperation(operationId)
  }

  async function confirmFinalize(
    custody: MissionArchiveCustodyInput,
  ): Promise<FinalizeMissionResult> {
    if (governanceController === null || governanceMission === null) {
      throw new Error('Mission archive finalization is unavailable.')
    }

    setGovernanceBusy(true)
    setActionError(null)
    setGovernanceFeedback(null)

    try {
      const result = await governanceController.finalizeGovernanceMission(
        governanceMission.id,
        custody,
      )
      setGovernanceFeedback(`Mission archived to ${result.archive.archive_path}`)
      return result
    } catch (error) {
      const currentGovernanceHealth =
        useMissionStore.getState().governanceEvidenceHealth
      if (isAcknowledgeableEvidenceHealthFinalizationBlock(
        error,
        currentGovernanceHealth?.reason ?? governanceEvidenceHealth?.reason ?? null,
      )) {
        setActionError(null)
        setShowFinalizeDialog(false)
        setShowEvidenceLossDialog(true)
      } else {
        setActionError(toErrorMessage(error))
      }
      throw error
    } finally {
      setGovernanceBusy(false)
    }
  }

  async function confirmUnlock(): Promise<void> {
    if (governanceController === null || governanceMission === null) {
      return
    }

    setGovernanceBusy(true)
    setActionError(null)
    setGovernanceFeedback(null)

    try {
      const mission = await governanceController.unlockGovernanceMission({
        mission_id: governanceMission.id,
        admin_name: selectedAdmin,
        reason: unlockReason,
      })
      setGovernanceFeedback(`Mission unlocked by ${selectedAdmin}. Status is now ${mission.status}.`)
      setShowUnlockDialog(false)
      setUnlockReason('')
    } catch (error) {
      setActionError(toErrorMessage(error))
    } finally {
      setGovernanceBusy(false)
    }
  }

  async function loadCleanupState(missionId: string): Promise<{
    readonly archive: MissionArchiveInfo
    readonly eligibility: MissionCleanupEligibility
  }> {
    if (governanceController === null || governanceMission?.id !== missionId) {
      throw new Error('Mission live-store archival is unavailable.')
    }
    return governanceController.readGovernanceCleanupState(missionId)
  }

  async function startCleanup(input: StartMissionCleanupInput): Promise<MissionCleanupResult> {
    if (governanceController === null || governanceMission?.id !== input.missionId) {
      throw new Error('Mission live-store archival is unavailable.')
    }
    setGovernanceBusy(true)
    setActionError(null)
    setGovernanceFeedback(null)
    try {
      const result = await governanceController.startGovernanceCleanup(input)
      setGovernanceFeedback(
        'Live-store archival completed. The mission remains listed and available through read-only archive review.',
      )
      return result
    } finally {
      setGovernanceBusy(false)
    }
  }

  async function resumeCleanup(input: ResumeMissionCleanupInput): Promise<MissionCleanupResult> {
    if (governanceController === null || governanceMission?.id !== input.missionId) {
      throw new Error('Mission live-store archival recovery is unavailable.')
    }
    setGovernanceBusy(true)
    setActionError(null)
    setGovernanceFeedback(null)
    try {
      const result = await governanceController.resumeGovernanceCleanup(input)
      setGovernanceFeedback(
        'Live-store archival recovery completed. The mission remains listed and available through read-only archive review.',
      )
      return result
    } finally {
      setGovernanceBusy(false)
    }
  }

  return {
    phase,
    currentMission,
    recoverableMission,
    governanceMission,
    focusModeActive,
    timerState,
    missionName,
    setMissionName,
    startOffsetHours,
    setStartOffsetHours,
    startError,
    actionError,
    duplicateWarning,
    showFinishDialog,
    setShowFinishDialog,
    showFinalizeDialog,
    setShowFinalizeDialog,
    showUnlockDialog,
    setShowUnlockDialog,
    showCleanupDialog,
    setShowCleanupDialog,
    showEvidenceLossDialog,
    setShowEvidenceLossDialog,
    governanceBusy,
    governanceFeedback,
    adminRoster,
    selectedAdmin,
    setSelectedAdmin,
    unlockReason,
    setUnlockReason,
    evidenceLossReason,
    setEvidenceLossReason,
    canOpenReview: currentMission !== null || governanceMission !== null || recoverableMission !== null,
    openReviewWorkspace,
    canStart: controller !== null && phase === 'idle',
    canPauseOrResume: controller !== null && (phase === 'active' || phase === 'paused'),
    pauseResumeLabel: phase === 'paused' ? 'Resume' : 'Pause',
    canFinish: controller !== null && (phase === 'active' || phase === 'paused'),
    startMission,
    pauseOrResume,
    confirmFinish,
    resumeRecoverable,
    startFresh,
    issueArchiveRecoveryCode,
    cancelArchiveOperation,
    subscribeArchiveProgress,
    confirmFinalize,
    loadCleanupState,
    startCleanup,
    resumeCleanup,
    confirmEvidenceLossAcknowledgement,
    confirmUnlock,
  }
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Mission action failed.'
}

function isAcknowledgeableEvidenceHealthFinalizationBlock(
  error: unknown,
  reason: string | null,
): boolean {
  return readMissionArchiveErrorCode(error) === 'ARCHIVE_EVIDENCE_HEALTH_BLOCKED' &&
    (reason === 'mission_persistence_failed' ||
      reason === 'renderer_pending_evidence_lost' ||
      reason === 'renderer_pending_capacity_exhausted')
}
