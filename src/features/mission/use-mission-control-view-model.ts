import { useCallback, useRef, useState } from 'react'

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
import { useGovernanceAdminRoster, type AdminRosterStatus } from './use-governance-admin-roster'
import { useParticipantStore } from '../participants/participant-store'
import { isMissionModelEnabled } from '../runtime/mission-model-flag'
import { getAppRuntimeController } from '../runtime/app-runtime-controller'
import type { ParticipantHistoryRetryOutcome } from '../tracking/participant-history-retry'
import {
  HISTORY_NOW_LOADED_NOTE,
  HISTORY_RETRY_STARTED_NOTE,
  HISTORY_START_FRESH_REFUSAL,
  countPeopleStillFetchingHistory,
  describeHistoryIncompleteFinishRefusal,
  isHistoryIncompleteFinishRefusal,
} from './finish-refusal'

const MAX_START_OFFSET_HOURS = 48

export type MissionControlViewModel = {
  readonly phase: MissionRuntimePhase
  readonly currentMission: Mission | null
  readonly recoverableMission: Mission | null
  readonly governanceMission: Mission | null
  /** Finished and archived missions the governance card can act on, most recent first. */
  readonly governanceCandidates: readonly Mission[]
  /** Points Archive & Lock and unlock at the chosen mission (DON-294). */
  readonly selectGovernanceMission: (missionId: string) => Promise<void>
  readonly focusModeActive: boolean
  readonly timerState: MissionTimerState | null
  readonly missionName: string
  readonly setMissionName: (name: string) => void
  readonly startOffsetHours: string
  readonly setStartOffsetHours: (hours: string) => void
  readonly startError: string | null
  readonly actionError: string | null
  readonly rosterError: string | null
  readonly rosterStatus: AdminRosterStatus
  readonly retryAdminRoster: () => void
  /** Leaves the open admin decision for Settings → Admin roster, returning on close. */
  readonly openAdminRosterSettings: () => void
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
  /**
   * Present while Finish is refused because earlier tracks are still being
   * fetched; the panel then offers Try again (DON-376).
   */
  readonly historyRetry: { readonly busy: boolean } | null
  /** Restarts the history fetch through the existing reconnect path. Never finishes. */
  readonly retryHistoryFetch: () => Promise<void>
  /** Says the history fetch was restarted, until Finish is pressed again. */
  readonly historyRetryNote: string | null
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
  const governanceCandidates = useMissionStore((state) => state.governanceCandidates)
  const governanceEvidenceHealth = useMissionStore((state) => state.governanceEvidenceHealth)
  const governanceController = useMissionStore((state) => state.governanceController)
  const participantController = useParticipantStore((state) => state.controller)
  const openReviewWorkspace = useMissionReviewWorkspaceStore((state) => state.openWorkspace)
  const focusModeActive = useFocusModeStore((state) => state.active)
  const timerState = useMissionTimer(currentMission)
  const [missionName, setMissionNameState] = useState('')
  const [startOffsetHours, setStartOffsetHours] = useState('0')
  const [startError, setStartError] = useState<string | null>(null)
  const [actionErrorState, setActionErrorState] = useState<string | null>(null)
  // Finish refused while earlier tracks load (DON-376). Its words are derived
  // live from the participant checkpoints, so the count never goes stale.
  const [finishBlock, setFinishBlock] = useState<FinishHistoryBlock | null>(null)
  const [historyRetryBusy, setHistoryRetryBusy] = useState(false)
  const [historyRetryNote, setHistoryRetryNote] = useState<{ readonly missionId: string; readonly text: string } | null>(null)
  // Each Finish attempt supersedes any Try again result still on its way.
  const finishAttempt = useRef(0)
  const participantMissionId = useParticipantStore((state) => state.activeMissionId)
  const backfillCheckpoints = useParticipantStore((state) => state.backfillCheckpoints)
  /** Shows a mission action failure; any history refusal it replaces goes. */
  const setActionError = useCallback((message: string | null) => {
    setFinishBlock(null)
    setActionErrorState(message)
  }, [])
  const finishBlockActive = finishBlock !== null && currentMission?.id === finishBlock.missionId
  const peopleStillLoading = finishBlockActive && participantMissionId === finishBlock.missionId
    ? countPeopleStillFetchingHistory(backfillCheckpoints, finishBlock.missionId)
    : null
  const historyNowLoaded = finishBlockActive && finishBlock.countAtRefusal !== null && peopleStillLoading === 0
  const actionError = !finishBlockActive
    ? actionErrorState
    : historyNowLoaded
      ? HISTORY_NOW_LOADED_NOTE
      : `${describeHistoryIncompleteFinishRefusal(peopleStillLoading)}${
        finishBlock.retryError === null ? '' : ` Try again did not work: ${finishBlock.retryError}`}`
  const historyRetry = finishBlockActive && !historyNowLoaded ? { busy: historyRetryBusy } : null
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null)
  const [duplicateAcknowledged, setDuplicateAcknowledged] = useState(false)
  const [showFinishDialog, setShowFinishDialog] = useState(false)
  const [showFinalizeDialog, setShowFinalizeDialog] = useState(false)
  const [showUnlockDialog, setShowUnlockDialog] = useState(false)
  const [showCleanupDialog, setShowCleanupDialog] = useState(false)
  const [showEvidenceLossDialog, setShowEvidenceLossDialog] = useState(false)
  const [governanceBusy, setGovernanceBusy] = useState(false)
  const [governanceFeedback, setGovernanceFeedback] = useState<string | null>(null)
  const [unlockReason, setUnlockReason] = useState('')
  const [evidenceLossReason, setEvidenceLossReason] = useState('')
  const subscribeArchiveProgress = useCallback((
    listener: (progress: MissionArchiveProgress) => void,
  ): (() => void) => window.sartrackerElectron?.onMissionArchiveProgress?.(listener)
    ?? (() => undefined), [])

  const {
    adminRoster,
    rosterStatus,
    rosterError,
    retryAdminRoster,
    selectedAdmin,
    setSelectedAdmin,
    openAdminRosterSettings,
  } = useGovernanceAdminRoster({
    openDecision: showEvidenceLossDialog ? 'evidence-loss' : showUnlockDialog ? 'unlock' : null,
    governanceBusy,
    setDecisionOpen: (decision, open) => {
      if (decision === 'unlock') {
        setShowUnlockDialog(open)
      } else {
        setShowEvidenceLossDialog(open)
      }
    },
  })

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
      // Capture the pre-start selection before the mission exists: the mission
      // change that follows refreshes the participant runtime (DON-292).
      const participantDraft = isMissionModelEnabled()
        ? participantController?.takeDraftSnapshot()
        : undefined
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
          participantDraft,
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

    const attempt = ++finishAttempt.current
    const missionId = currentMission?.id ?? null
    setActionError(null)
    setHistoryRetryNote(null)

    try {
      const finished = await controller.finishMission()
      await targetGovernanceAt(finished)
      setShowFinishDialog(false)
    } catch (error) {
      if (attempt !== finishAttempt.current) return
      const message = toErrorMessage(error)
      if (missionId === null || !isHistoryIncompleteFinishRefusal(message)) {
        setActionError(message)
        return
      }
      // The store's precise refusal is already in the main-process log; the
      // operator gets plain words and Try again.
      const { activeMissionId, backfillCheckpoints: checkpoints } = useParticipantStore.getState()
      const count = activeMissionId === missionId ? countPeopleStillFetchingHistory(checkpoints, missionId) : 0
      setActionErrorState(null)
      setFinishBlock({ missionId, countAtRefusal: count > 0 ? count : null, retryError: null })
    }
  }

  /**
   * Try again: asks tracking to fetch the incomplete participant history now,
   * skipping its backoff. It never finishes the mission; Finish stays refused
   * until the history is complete (DON-376). A retry that cannot start keeps
   * the refusal on screen with the reason.
   */
  async function retryHistoryFetch(): Promise<void> {
    if (!finishBlockActive || historyRetryBusy) return
    const block = finishBlock
    const attempt = finishAttempt.current
    setHistoryRetryBusy(true)
    try {
      const runtime = getAppRuntimeController()
      const outcome: ParticipantHistoryRetryOutcome = runtime === null
        ? { kind: 'unavailable', reason: 'Tracking is not running. Restart SAR Tracker.' }
        : runtime.retryParticipantHistory()
      if (attempt !== finishAttempt.current) return
      if (outcome.kind === 'started') {
        setFinishBlock(null)
        setActionErrorState(null)
        setHistoryRetryNote({ missionId: block.missionId, text: HISTORY_RETRY_STARTED_NOTE })
        return
      }
      console.warn('Try again for participant history could not start:', outcome.reason)
      setFinishBlock({ ...block, retryError: outcome.reason })
    } catch (error) {
      console.warn('Try again for participant history failed.', error)
      if (attempt === finishAttempt.current) setFinishBlock({ ...block, retryError: toErrorMessage(error) })
    } finally {
      setHistoryRetryBusy(false)
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
      const finished = await controller.startFresh()
      await targetGovernanceAt(finished)
    } catch (error) {
      const message = toErrorMessage(error)
      setActionError(isHistoryIncompleteFinishRefusal(message) ? HISTORY_START_FRESH_REFUSAL : message)
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

  /**
   * Points governance at the mission just finished. An earlier explicit choice
   * must not keep Archive & Lock on an older mission (DON-294).
   */
  async function targetGovernanceAt(finished: Mission | null): Promise<void> {
    if (governanceController === null) return
    if (finished === null) {
      await governanceController.refreshGovernanceMission()
      return
    }
    await governanceController.selectGovernanceMission(finished.id)
  }

  /** Switches the governance card to another finished or archived mission. */
  async function selectGovernanceMission(missionId: string): Promise<void> {
    if (governanceController === null) return
    setActionError(null)
    try {
      await governanceController.selectGovernanceMission(missionId)
    } catch (error) {
      setActionError(toErrorMessage(error))
    }
  }

  return {
    phase,
    currentMission,
    recoverableMission,
    governanceMission,
    governanceCandidates,
    selectGovernanceMission,
    focusModeActive,
    timerState,
    missionName,
    setMissionName,
    startOffsetHours,
    setStartOffsetHours,
    startError,
    actionError,
    rosterError,
    rosterStatus,
    retryAdminRoster,
    openAdminRosterSettings,
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
    historyRetry,
    retryHistoryFetch,
    historyRetryNote: historyRetryNote !== null && historyRetryNote.missionId === currentMission?.id &&
      (phase === 'active' || phase === 'paused')
      ? historyRetryNote.text
      : null,
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

/** Finish refused while earlier tracks load, for one mission (DON-376). */
type FinishHistoryBlock = {
  readonly missionId: string
  /** People still loading when Finish was refused, or null when not known. */
  readonly countAtRefusal: number | null
  /** Why the last Try again could not start, if it could not. */
  readonly retryError: string | null
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
