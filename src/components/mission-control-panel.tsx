import { useEffect, useMemo, useState } from 'react'

import { useMissionStore } from '../features/mission/mission-store'
import {
  calculateMissionTimerState,
  formatMissionDuration,
} from '../features/mission/mission-timers'

/**
 * Renders mission lifecycle controls and timer state for operators.
 */
export function MissionControlPanel() {
  const phase = useMissionStore((state) => state.phase)
  const currentMission = useMissionStore((state) => state.currentMission)
  const recoverableMission = useMissionStore((state) => state.recoverableMission)
  const controller = useMissionStore((state) => state.controller)
  const [missionName, setMissionName] = useState('')
  const [startOffsetHours, setStartOffsetHours] = useState('0')
  const [now, setNow] = useState(() => new Date())
  const [startError, setStartError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null)
  const [duplicateAcknowledged, setDuplicateAcknowledged] = useState(false)
  const [showFinishDialog, setShowFinishDialog] = useState(false)
  const missionNameInputId = 'mission-name-input'
  const missionOffsetInputId = 'mission-offset-input'

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(new Date())
    }, 1000)

    return () => {
      window.clearInterval(timer)
    }
  }, [])

  const timerState = useMemo(() => {
    if (currentMission === null) {
      return null
    }

    return calculateMissionTimerState(currentMission, now)
  }, [currentMission, now])

  async function handleStartMission(): Promise<void> {
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
    if (!Number.isFinite(parsedOffset) || parsedOffset < 0 || parsedOffset > 48) {
      setStartError('Start offset must be between 0 and 48 hours.')
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
          : { startTime: new Date(now.getTime() - parsedOffset * 60 * 60 * 1000).toISOString() }),
      })

      setMissionName('')
      setStartOffsetHours('0')
      setStartError(null)
      setDuplicateWarning(null)
      setDuplicateAcknowledged(false)
      setNow(new Date())
    } catch (error) {
      setStartError(toErrorMessage(error))
    }
  }

  async function handlePauseOrResume(): Promise<void> {
    if (controller === null) {
      return
    }

    setActionError(null)

    try {
      if (phase === 'paused') {
        await controller.resumeMission()
        setNow(new Date())
        return
      }

      await controller.pauseMission()
      setNow(new Date())
    } catch (error) {
      setActionError(toErrorMessage(error))
    }
  }

  async function handleConfirmFinish(): Promise<void> {
    if (controller === null) {
      return
    }

    setActionError(null)

    try {
      await controller.finishMission()
      setNow(new Date())
      setShowFinishDialog(false)
    } catch (error) {
      setActionError(toErrorMessage(error))
    }
  }

  async function handleResumeRecoverable(): Promise<void> {
    if (controller === null) {
      return
    }

    setActionError(null)

    try {
      await controller.resumeRecoverableMission()
      setNow(new Date())
    } catch (error) {
      setActionError(toErrorMessage(error))
    }
  }

  async function handleStartFresh(): Promise<void> {
    if (controller === null) {
      return
    }

    setActionError(null)

    try {
      await controller.startFresh()
      setNow(new Date())
    } catch (error) {
      setActionError(toErrorMessage(error))
    }
  }

  return (
    <section
      className="rounded-2xl border border-stone-700 bg-stone-950/70 p-4 text-sm text-stone-300"
      data-testid="mission-control"
    >
      <div className="flex items-center justify-between">
        <span className="font-semibold text-stone-100">Mission Control</span>
        <span
          className={
            phase === 'active'
              ? 'text-emerald-300'
              : phase === 'paused'
                ? 'animate-pulse text-amber-300'
                : phase === 'recovery'
                  ? 'text-amber-200'
                  : 'text-stone-400'
          }
        >
          {phase}
        </span>
      </div>

      <div className="mt-3 space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-stone-800 bg-stone-900/80 p-3">
            <p className="text-xs uppercase tracking-[0.2em] text-stone-300">Elapsed</p>
            <p className="mt-1 font-mono text-xl text-stone-50" data-testid="mission-elapsed">
              {formatMissionDuration(timerState?.elapsedSeconds ?? 0)}
            </p>
          </div>
          <div className="rounded-xl border border-stone-800 bg-stone-900/80 p-3">
            <p className="text-xs uppercase tracking-[0.2em] text-stone-300">Active Search</p>
            <p className="mt-1 font-mono text-xl text-stone-50" data-testid="mission-active-search">
              {formatMissionDuration(timerState?.activeSeconds ?? 0)}
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-stone-800 bg-stone-900/80 p-3">
          <label
            className="block text-xs uppercase tracking-[0.2em] text-stone-300"
            htmlFor={missionNameInputId}
          >
            Mission Name
          </label>
          <input
            className="mt-2 w-full rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-stone-100 outline-none ring-0"
            data-testid="mission-name-input"
            disabled={controller === null || phase !== 'idle'}
            id={missionNameInputId}
            onChange={(event) => {
              setMissionName(event.target.value)
              setDuplicateWarning(null)
              setDuplicateAcknowledged(false)
            }}
            placeholder="Enter mission name"
            value={missionName}
          />

          <label
            className="mt-3 block text-xs uppercase tracking-[0.2em] text-stone-300"
            htmlFor={missionOffsetInputId}
          >
            Start Offset (Hours)
          </label>
          <input
            className="mt-2 w-full rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-stone-100 outline-none ring-0"
            data-testid="mission-offset-input"
            disabled={controller === null || phase !== 'idle'}
            id={missionOffsetInputId}
            max="48"
            min="0"
            onChange={(event) => setStartOffsetHours(event.target.value)}
            step="0.5"
            type="number"
            value={startOffsetHours}
          />

          {currentMission !== null ? (
            <p className="mt-3 text-xs text-stone-300">
              Current mission: <span className="text-stone-200">{currentMission.name}</span>
            </p>
          ) : null}
          {startError !== null ? <p className="mt-3 text-xs text-rose-300">{startError}</p> : null}
          {actionError !== null ? <p className="mt-3 text-xs text-rose-300">{actionError}</p> : null}
          {duplicateWarning !== null ? (
            <p className="mt-3 text-xs text-amber-300">{duplicateWarning}</p>
          ) : null}
          {controller === null ? (
            <p className="mt-3 text-xs text-stone-300">
              Mission controls activate in the desktop runtime.
            </p>
          ) : null}
        </div>

        <div className="grid gap-2 sm:grid-cols-3">
          <button
            className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200 disabled:cursor-not-allowed disabled:opacity-40"
            data-testid="mission-start-btn"
            disabled={controller === null || phase !== 'idle'}
            onClick={() => void handleStartMission()}
            type="button"
          >
            Start
          </button>
          <button
            className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200 disabled:cursor-not-allowed disabled:opacity-40"
            data-testid="mission-pause-resume-btn"
            disabled={controller === null || (phase !== 'active' && phase !== 'paused')}
            onClick={() => void handlePauseOrResume()}
            type="button"
          >
            {phase === 'paused' ? 'Resume' : 'Pause'}
          </button>
          <button
            className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200 disabled:cursor-not-allowed disabled:opacity-40"
            data-testid="mission-finish-btn"
            disabled={controller === null || (phase !== 'active' && phase !== 'paused')}
            onClick={() => setShowFinishDialog(true)}
            type="button"
          >
            Finish
          </button>
        </div>
      </div>

      {phase === 'recovery' && recoverableMission !== null ? (
        <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4" data-testid="mission-recovery-dialog">
          <p className="font-semibold text-amber-100">Resume Mission?</p>
          <p className="mt-2 whitespace-pre-line text-xs leading-5 text-amber-50/90">
            {`Found paused mission:\n\nMission: ${recoverableMission.name}\nStarted: ${recoverableMission.start_time}\n\nDo you want to resume this mission?`}
          </p>
          <div className="mt-4 flex gap-2">
            <button
              className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200"
              onClick={() => void handleResumeRecoverable()}
              type="button"
            >
              Resume Mission
            </button>
            <button
              className="rounded-lg border border-stone-600 bg-stone-900 px-3 py-2 text-sm text-stone-200"
              onClick={() => void handleStartFresh()}
              type="button"
            >
              Start Fresh
            </button>
          </div>
        </div>
      ) : null}

      {showFinishDialog ? (
        <div className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 p-4" data-testid="mission-finish-dialog">
          <p className="font-semibold text-rose-100">End Mission</p>
          <p className="mt-2 whitespace-pre-line text-xs leading-5 text-rose-50/90">
            {`Are you sure you want to end this mission?\n\nThis will:\n• Stop mission timers\n• Keep all mission data editable\n• Reset UI for the next mission\n\nMission data remains saved.\nUse Finalize Mission later to archive and lock the data.`}
          </p>
          <div className="mt-4 flex gap-2">
            <button
              className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-100"
              onClick={() => void handleConfirmFinish()}
              type="button"
            >
              Yes
            </button>
            <button
              className="rounded-lg border border-stone-600 bg-stone-900 px-3 py-2 text-sm text-stone-200"
              onClick={() => setShowFinishDialog(false)}
              type="button"
            >
              No
            </button>
          </div>
        </div>
      ) : null}
    </section>
  )
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Mission action failed.'
}
