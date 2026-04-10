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
      className="rounded-2xl border border-stone-800 bg-stone-950/40 p-5 text-sm"
      data-testid="mission-control"
    >
      <div className="flex items-center justify-between mb-4">
        <span className="font-bold uppercase tracking-wider text-stone-400 text-[11px]">Mission Control</span>
        <div className="flex items-center gap-2">
          {phase !== 'idle' && (
            <div className={`h-2 w-2 rounded-full ${phase === 'active' ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-amber-500 animate-pulse'}`} />
          )}
          <span
            className={`font-bold uppercase text-[11px] ${
              phase === 'active'
                ? 'text-emerald-400'
                : phase === 'paused'
                  ? 'text-amber-400'
                  : phase === 'recovery'
                    ? 'text-amber-200'
                    : 'text-stone-500'
            }`}
          >
            {phase}
          </span>
        </div>
      </div>

      <div className="space-y-4">
        {/* Primary Telemetry */}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-stone-800 bg-stone-900/50 p-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-stone-500">Elapsed</p>
            <p className="mt-1 font-mono text-2xl font-bold text-stone-100" data-testid="mission-elapsed">
              {formatMissionDuration(timerState?.elapsedSeconds ?? 0)}
            </p>
          </div>
          <div className="rounded-xl border border-stone-800 bg-stone-900/50 p-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-stone-500">Active Search</p>
            <p className="mt-1 font-mono text-2xl font-bold text-emerald-400" data-testid="mission-active-search">
              {formatMissionDuration(timerState?.activeSeconds ?? 0)}
            </p>
          </div>
        </div>

        {/* Setup Inputs - Only visible in Idle */}
        {phase === 'idle' ? (
          <div className="rounded-xl border border-stone-800 bg-stone-900/30 p-4 space-y-4">
            <div>
              <label
                className="block text-[10px] font-bold uppercase tracking-wider text-stone-500"
                htmlFor={missionNameInputId}
              >
                Mission Name
              </label>
              <input
                className="mt-2 w-full rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-stone-100 placeholder:text-stone-700 outline-none focus:border-amber-500/50 transition-colors"
                data-testid="mission-name-input"
                disabled={controller === null}
                id={missionNameInputId}
                onChange={(event) => {
                  setMissionName(event.target.value)
                  setDuplicateWarning(null)
                  setDuplicateAcknowledged(false)
                }}
                placeholder="Search Operation Name"
                value={missionName}
              />
            </div>

            <div>
              <label
                className="block text-[10px] font-bold uppercase tracking-wider text-stone-500"
                htmlFor={missionOffsetInputId}
              >
                Start Offset (Hours)
              </label>
              <input
                className="mt-2 w-full rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-stone-100 outline-none focus:border-amber-500/50 transition-colors"
                data-testid="mission-offset-input"
                disabled={controller === null}
                id={missionOffsetInputId}
                max="48"
                min="0"
                onChange={(event) => setStartOffsetHours(event.target.value)}
                step="0.5"
                type="number"
                value={startOffsetHours}
              />
            </div>
          </div>
        ) : (
          <div className="px-1 py-2 rounded-xl border border-stone-800 bg-stone-900/30">
             <p className="text-[10px] font-bold text-stone-500 uppercase tracking-widest mb-1">Current Mission</p>
             <p className="text-[11px] font-bold text-stone-200 uppercase tracking-tight" data-testid="current-mission-name">
              {currentMission?.name}
            </p>
          </div>
        )}

        {/* Status Messages */}
        <div className="empty:hidden">
          {startError !== null ? <p className="text-xs text-rose-400 bg-rose-400/10 p-2 rounded-lg border border-rose-400/20">{startError}</p> : null}
          {actionError !== null ? <p className="text-xs text-rose-400 bg-rose-400/10 p-2 rounded-lg border border-rose-400/20">{actionError}</p> : null}
          {duplicateWarning !== null ? (
            <p className="text-xs text-amber-400 bg-amber-400/10 p-2 rounded-lg border border-amber-400/20">{duplicateWarning}</p>
          ) : null}
        </div>

        {/* Tactical Actions */}
        <div className="grid gap-2 sm:grid-cols-3">
          <button
            className="rounded-lg bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider text-white shadow-lg shadow-emerald-900/20 transition-all disabled:cursor-not-allowed disabled:opacity-20 disabled:grayscale"
            data-testid="mission-start-btn"
            disabled={controller === null || phase !== 'idle'}
            onClick={() => void handleStartMission()}
            type="button"
          >
            Start
          </button>
          <button
            className="rounded-lg bg-amber-600 hover:bg-amber-500 active:bg-amber-700 px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider text-white shadow-lg shadow-amber-900/20 transition-all disabled:cursor-not-allowed disabled:opacity-20 disabled:grayscale"
            data-testid="mission-pause-resume-btn"
            disabled={controller === null || (phase !== 'active' && phase !== 'paused')}
            onClick={() => void handlePauseOrResume()}
            type="button"
          >
            {phase === 'paused' ? 'Resume' : 'Pause'}
          </button>
          <button
            className="rounded-lg bg-rose-600 hover:bg-rose-500 active:bg-rose-700 px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider text-white shadow-lg shadow-rose-900/20 transition-all disabled:cursor-not-allowed disabled:opacity-20 disabled:grayscale"
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
        <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-950/50 p-4 shadow-xl" data-testid="mission-recovery-dialog">
          <p className="font-bold text-amber-400 uppercase text-[11px] tracking-wider">Resume Mission?</p>
          <div className="mt-2 font-mono text-[10px] leading-relaxed text-stone-300">
            <p>ID: {recoverableMission.name}</p>
            <p>Started: {new Date(recoverableMission.start_time).toLocaleString()}</p>
          </div>
          <div className="mt-4 flex gap-2">
            <button
              className="flex-1 rounded-lg bg-emerald-600 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-white"
              onClick={() => void handleResumeRecoverable()}
              type="button"
            >
              Resume
            </button>
            <button
              className="flex-1 rounded-lg bg-stone-800 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-stone-300"
              onClick={() => void handleStartFresh()}
              type="button"
            >
              Start Fresh
            </button>
          </div>
        </div>
      ) : null}

      {showFinishDialog ? (
        <div className="mt-4 rounded-xl border border-rose-500/30 bg-rose-950/50 p-4 shadow-xl" data-testid="mission-finish-dialog">
          <p className="font-bold text-rose-400 uppercase text-[11px] tracking-wider">End Mission?</p>
          <p className="mt-2 text-[11px] leading-relaxed text-stone-300">
            This will stop timers and return to IDLE. Data remains saved.
          </p>
          <div className="mt-4 flex gap-2">
            <button
              className="flex-1 rounded-lg bg-rose-600 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-white"
              onClick={() => void handleConfirmFinish()}
              type="button"
            >
              Confirm Finish
            </button>
            <button
              className="flex-1 rounded-lg bg-stone-800 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-stone-300"
              onClick={() => setShowFinishDialog(false)}
              type="button"
            >
              Cancel
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
