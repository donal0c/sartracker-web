import { useEffect, useState } from 'react'

import { loadAppSettings } from '../../infrastructure/settings-store/tauri-settings-store'
import type { Mission } from '../../infrastructure/mission-store/tauri-mission-store'
import { useFocusModeStore } from '../focus-mode/focus-mode-store'
import { useMissionReviewWorkspaceStore } from '../mission-review/mission-review-workspace-store'
import { useMissionStore, type MissionRuntimePhase } from './mission-store'
import type { MissionTimerState } from './mission-timers'
import { useMissionTimer } from './use-mission-timer'

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
  readonly governanceBusy: boolean
  readonly governanceFeedback: string | null
  readonly adminRoster: readonly string[]
  readonly selectedAdmin: string
  readonly setSelectedAdmin: (admin: string) => void
  readonly unlockReason: string
  readonly setUnlockReason: (reason: string) => void
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
  readonly confirmFinalize: () => Promise<void>
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
  const governanceController = useMissionStore((state) => state.governanceController)
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
  const [governanceBusy, setGovernanceBusy] = useState(false)
  const [governanceFeedback, setGovernanceFeedback] = useState<string | null>(null)
  const [adminRoster, setAdminRoster] = useState<readonly string[]>([])
  const [selectedAdmin, setSelectedAdmin] = useState('')
  const [unlockReason, setUnlockReason] = useState('')

  useEffect(() => {
    if (!showUnlockDialog) {
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
  }, [showUnlockDialog])

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
      await controller.startMission({
        name: normalizedName,
        ...(parsedOffset === 0
          ? {}
          : { startTime: new Date(Date.now() - parsedOffset * 60 * 60 * 1000).toISOString() }),
      })

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

  async function confirmFinalize(): Promise<void> {
    if (governanceController === null || governanceMission === null) {
      return
    }

    setGovernanceBusy(true)
    setActionError(null)
    setGovernanceFeedback(null)

    try {
      const result = await governanceController.finalizeGovernanceMission(governanceMission.id)
      setGovernanceFeedback(`Mission archived to ${result.archive.archive_path}`)
      setShowFinalizeDialog(false)
    } catch (error) {
      setActionError(toErrorMessage(error))
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
    governanceBusy,
    governanceFeedback,
    adminRoster,
    selectedAdmin,
    setSelectedAdmin,
    unlockReason,
    setUnlockReason,
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
    confirmFinalize,
    confirmUnlock,
  }
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Mission action failed.'
}
