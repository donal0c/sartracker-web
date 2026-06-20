import {
  useEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react'

import { useMissionControlViewModel } from '../features/mission/use-mission-control-view-model'
import { formatMissionDuration } from '../features/mission/mission-timers'
import { selectMissionPhasePresentation } from '../features/mission/mission-phase-presentation'
import { focusFirstElement, restoreFocus, trapTabKey } from '../lib/focus-management'

const MISSION_NAME_INPUT_ID = 'mission-name-input'
const MISSION_OFFSET_INPUT_ID = 'mission-offset-input'
const MISSION_FINALIZE_TITLE_ID = 'mission-finalize-dialog-title'
const MISSION_FINALIZE_DESCRIPTION_ID = 'mission-finalize-dialog-description'
const MISSION_UNLOCK_TITLE_ID = 'mission-unlock-dialog-title'
const MISSION_FINISH_TITLE_ID = 'mission-finish-dialog-title'
const MISSION_FINISH_DESCRIPTION_ID = 'mission-finish-dialog-description'
const MAX_START_OFFSET_HOURS = 48

type MissionControlPanelProps = {
  readonly minimized?: boolean
  readonly onMinimizedChange?: (minimized: boolean) => void
}

/**
 * Renders mission lifecycle controls and timer state for operators.
 */
export function MissionControlPanel({
  minimized = false,
  onMinimizedChange,
}: MissionControlPanelProps = {}) {
  const {
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
    canOpenReview,
    openReviewWorkspace,
    canStart,
    canPauseOrResume,
    pauseResumeLabel,
    canFinish,
    startMission,
    pauseOrResume,
    confirmFinish,
    resumeRecoverable,
    startFresh,
    confirmFinalize,
    confirmUnlock,
  } = useMissionControlViewModel()

  const phasePresentation = selectMissionPhasePresentation(phase)
  const canMinimizeToMast =
    phase === 'active' &&
    currentMission !== null &&
    onMinimizedChange !== undefined
  const effectiveMinimized = canMinimizeToMast && minimized

  if (effectiveMinimized) {
    return null
  }

  return (
    <section
      className={`sar-panel p-4 text-sm ${phasePresentation.paused ? 'ring-2 ring-red-500/80' : ''}`}
      data-mission-phase={phase}
      data-testid="mission-control"
    >
      <div className="mb-4 flex items-center justify-between border-b border-[var(--sar-line)] pb-3">
        <div>
          <span className="sar-section-label text-amber-300">Mission Control</span>
          <p className="mt-1 text-[11px] uppercase tracking-[0.12em] text-stone-300">
            lifecycle and timing
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="sar-button px-3 py-1.5 text-[12px] font-semibold uppercase tracking-[0.08em]"
            data-testid="open-mission-review-workspace"
            disabled={!canOpenReview}
            onClick={() => openReviewWorkspace()}
            type="button"
          >
            Review
          </button>
          {canMinimizeToMast ? (
            <button
              aria-expanded="true"
              className="sar-button px-3 py-1.5 text-[12px] font-semibold uppercase tracking-[0.08em]"
              data-testid="mission-control-collapse-btn"
              onClick={() => onMinimizedChange(true)}
              type="button"
            >
              Minimize
            </button>
          ) : null}
          {phase !== 'idle' && (
            <div
              className={`h-2 w-2 rounded-full ${
                phase === 'active'
                  ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]'
                  : phasePresentation.paused
                    ? 'bg-red-500 animate-pulse shadow-[0_0_10px_rgba(239,68,68,0.85)]'
                    : 'bg-amber-500 animate-pulse'
              }`}
            />
          )}
          {phasePresentation.paused ? (
            <span
              className="sar-status-chip-paused px-2 py-0.5 font-mono text-[11px] uppercase tracking-[0.12em]"
              data-testid="mission-phase-chip"
            >
              {phasePresentation.statusLabel}
            </span>
          ) : (
            <span
              className={`font-semibold uppercase text-[11px] ${
                phase === 'active'
                  ? 'text-emerald-300'
                  : phase === 'recovery'
                    ? 'text-amber-200'
                    : 'text-stone-300'
              }`}
              data-testid="mission-phase-chip"
            >
              {phase}
            </span>
          )}
        </div>
      </div>

      <>
      {/*
        Paused-state recovery banner (DON-64). Rendered immediately under the
        header so the paused state and its recovery action are impossible to
        miss and are never pushed below a scroll fold. The text spells out the
        state and consequence so the cue does not rely on colour/animation
        alone, and the in-banner Resume button guarantees the recovery control
        stays reachable even when the panel is space-constrained.
      */}
      {phasePresentation.banner !== null ? (
        <div
          aria-live="assertive"
          className="sar-status-chip-paused mb-4 flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between"
          data-testid="mission-paused-banner"
          role="alert"
        >
          <div className="min-w-0">
            <p className="font-mono text-[13px] font-black uppercase tracking-[0.12em]">
              {phasePresentation.banner.heading}
            </p>
            <p className="mt-1 text-[12px] font-semibold leading-snug text-red-50">
              {phasePresentation.banner.detail}
            </p>
          </div>
          <button
            className="sar-action-resume-paused flex-shrink-0 px-4 py-2 text-[13px] font-black uppercase tracking-[0.1em] transition-all disabled:cursor-not-allowed disabled:opacity-40"
            data-testid="mission-paused-banner-resume-btn"
            disabled={!canPauseOrResume}
            onClick={() => void pauseOrResume()}
            type="button"
          >
            {phasePresentation.banner.resumeLabel}
          </button>
        </div>
      ) : null}

      <div className="space-y-4">
        {/* Primary Telemetry */}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sar-readout p-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-stone-300">Elapsed</p>
            <p className="mt-1 font-mono text-[26px] font-black leading-none text-stone-100" data-testid="mission-elapsed">
              {formatMissionDuration(timerState?.elapsedSeconds ?? 0)}
            </p>
          </div>
          <div className="sar-readout p-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-stone-300">Active Search</p>
            <p className="mt-1 font-mono text-[26px] font-black leading-none text-emerald-400" data-testid="mission-active-search">
              {formatMissionDuration(timerState?.activeSeconds ?? 0)}
            </p>
          </div>
        </div>

        {/* Setup Inputs - Only visible in Idle */}
        {phase === 'idle' ? (
          <div className="sar-module space-y-4 p-4">
            <div>
              <label
                className="block text-[11px] font-bold uppercase tracking-[0.1em] text-stone-300"
                htmlFor={MISSION_NAME_INPUT_ID}
              >
                Mission Name
              </label>
              <input
                className="sar-input mt-2 w-full px-3 py-2 text-sm"
                data-testid="mission-name-input"
                disabled={!canStart}
                id={MISSION_NAME_INPUT_ID}
                onChange={(event) => setMissionName(event.target.value)}
                placeholder="Search Operation Name"
                value={missionName}
              />
            </div>

            <div>
              <label
                className="block text-[11px] font-bold uppercase tracking-[0.1em] text-stone-300"
                htmlFor={MISSION_OFFSET_INPUT_ID}
              >
                Start Offset (Hours)
              </label>
              <input
                className="sar-input mt-2 w-full px-3 py-2 text-sm"
                data-testid="mission-offset-input"
                disabled={!canStart}
                id={MISSION_OFFSET_INPUT_ID}
                max={String(MAX_START_OFFSET_HOURS)}
                min="0"
                onChange={(event) => setStartOffsetHours(event.target.value)}
                step="0.5"
                type="number"
                value={startOffsetHours}
              />
            </div>
          </div>
        ) : focusModeActive ? (
          <div className="sar-readout border-l-4 border-l-emerald-400 px-3 py-3">
             <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.12em] text-stone-300">Current Mission</p>
             <p className="text-[13px] font-bold text-stone-100" data-testid="current-mission-name">
              {currentMission?.name}
            </p>
          </div>
        ) : null}

        {/* Status Messages */}
        <div className="empty:hidden">
          {startError !== null ? <p className="border border-rose-400/24 bg-rose-400/10 p-2 text-xs text-rose-400">{startError}</p> : null}
          {actionError !== null ? <p className="border border-rose-400/24 bg-rose-400/10 p-2 text-xs text-rose-400">{actionError}</p> : null}
          {duplicateWarning !== null ? (
            <p className="sar-inline-alert p-2 text-xs text-amber-300">{duplicateWarning}</p>
          ) : null}
        </div>

        {/* Tactical Actions */}
        <div className="space-y-2">
          <button
            className={`${phase === 'idle' ? 'sar-action-primary w-full px-4 py-3 text-[14px] font-black uppercase tracking-[0.12em] transition-all active:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-20 disabled:grayscale' : 'sr-only'}`}
            data-testid="mission-start-btn"
            disabled={!canStart}
            onClick={() => void startMission()}
            type="button"
          >
            Start
          </button>
          <div className="grid gap-2 sm:grid-cols-2">
            <button
              className={`px-3 py-2.5 text-[13px] font-bold uppercase tracking-[0.1em] transition-all disabled:cursor-not-allowed disabled:opacity-20 disabled:grayscale ${
                phasePresentation.paused
                  ? 'sar-action-resume-paused'
                  : 'sar-button-focus'
              }`}
              data-testid="mission-pause-resume-btn"
              disabled={!canPauseOrResume}
              onClick={() => void pauseOrResume()}
              type="button"
            >
              {pauseResumeLabel}
            </button>
            <button
              className="sar-action-danger px-3 py-2.5 text-[13px] font-bold uppercase tracking-[0.1em] transition-all active:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-20 disabled:grayscale"
              data-testid="mission-finish-btn"
              disabled={!canFinish}
              onClick={() => setShowFinishDialog(true)}
              type="button"
            >
              Finish
            </button>
          </div>
        </div>

        {phase === 'idle' && governanceMission !== null ? (
          <div
            className="border border-sky-500/20 bg-sky-950/20 p-4"
            data-testid="mission-governance-card"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[13px] font-semibold uppercase tracking-wide text-sky-200">
                  Mission Governance
                </p>
                <p className="mt-1 text-sm font-semibold text-stone-100">
                  {governanceMission.name}
                </p>
                <p className="mt-1 text-[13px] text-stone-300">
                  Status: <span className="font-mono uppercase">{governanceMission.status}</span>
                </p>
                {governanceMission.finish_time ? (
                  <p className="mt-1 text-[13px] text-stone-300">
                    Finished: {new Date(governanceMission.finish_time).toLocaleString()}
                  </p>
                ) : null}
              </div>
              {governanceMission.status === 'finished' ? (
                <button
                  className="bg-sky-600 px-3 py-2 text-[12px] font-semibold text-white disabled:opacity-40"
                  data-testid="mission-finalize-btn"
                  disabled={governanceBusy}
                  onClick={() => setShowFinalizeDialog(true)}
                  type="button"
                >
                  Archive & Lock
                </button>
              ) : (
                <button
                  className="border border-stone-600 bg-stone-800 px-3 py-2 text-[12px] font-semibold text-stone-200 disabled:opacity-40 hover:bg-stone-700"
                  data-testid="mission-unlock-btn"
                  disabled={governanceBusy}
                  onClick={() => setShowUnlockDialog(true)}
                  type="button"
                >
                  Admin Unlock
                </button>
              )}
            </div>
          </div>
        ) : null}

        {governanceFeedback !== null ? (
          <p className="border border-emerald-500/20 bg-emerald-500/10 p-2 text-xs text-emerald-300">
            {governanceFeedback}
          </p>
        ) : null}
      </div>

      {phase === 'recovery' && recoverableMission !== null ? (
        <div className="mt-4 border border-amber-500/30 bg-amber-950/50 p-4 shadow-xl" data-testid="mission-recovery-dialog">
          <p className="font-semibold text-amber-300 uppercase text-[13px] tracking-wide">Resume Mission?</p>
          <div className="mt-2 font-mono text-[13px] leading-relaxed text-stone-300">
            <p>{recoverableMission.name}</p>
            <p>Started: {new Date(recoverableMission.start_time).toLocaleString()}</p>
          </div>
          <p className="mt-3 text-[12px] leading-relaxed text-amber-100">
            A recoverable mission was found after a reload or interrupted session. Resume it
            to continue the same operational record, or start fresh only if this is not the
            current incident.
          </p>
          <div className="mt-4 flex gap-2">
            <button
              className="flex-1 bg-amber-600 px-3 py-2 text-[12px] font-semibold text-white hover:bg-amber-500"
              onClick={() => void resumeRecoverable()}
              type="button"
            >
              Resume
            </button>
            <button
              className="flex-1 bg-stone-800 px-3 py-2 text-[12px] font-semibold text-stone-200 hover:bg-stone-700"
              onClick={() => void startFresh()}
              type="button"
            >
              Start Fresh
            </button>
          </div>
        </div>
      ) : null}

      {showFinalizeDialog && governanceMission !== null ? (
        <InlineDecisionDialog
          describedBy={MISSION_FINALIZE_DESCRIPTION_ID}
          className="mt-4 border border-sky-500/30 bg-sky-950/50 p-4 shadow-xl"
          data-testid="mission-finalize-dialog"
          labelledBy={MISSION_FINALIZE_TITLE_ID}
          onCancel={() => setShowFinalizeDialog(false)}
        >
          <p
            className="font-semibold text-sky-300 uppercase text-[13px] tracking-wide"
            id={MISSION_FINALIZE_TITLE_ID}
          >
            Archive & Lock?
          </p>
          <p
            className="mt-2 text-[13px] leading-relaxed text-stone-300"
            id={MISSION_FINALIZE_DESCRIPTION_ID}
          >
            This creates a validated archive and makes the mission read-only until an admin
            explicitly unlocks it.
          </p>
          <div className="mt-4 flex gap-2">
            <button
              className="flex-1 bg-sky-600 px-3 py-2 text-[12px] font-semibold text-white disabled:opacity-40 hover:bg-sky-500"
              data-testid="mission-finalize-confirm"
              disabled={governanceBusy}
              onClick={() => void confirmFinalize()}
              type="button"
            >
              {governanceBusy ? 'Finalizing…' : 'Confirm Archive & Lock'}
            </button>
            <button
              className="flex-1 bg-stone-800 px-3 py-2 text-[12px] font-semibold text-stone-200 hover:bg-stone-700"
              onClick={() => setShowFinalizeDialog(false)}
              type="button"
            >
              Cancel
            </button>
          </div>
        </InlineDecisionDialog>
      ) : null}

      {showUnlockDialog && governanceMission !== null ? (
        <InlineDecisionDialog
          className="mt-4 border border-amber-500/30 bg-amber-950/50 p-4 shadow-xl"
          data-testid="mission-unlock-dialog"
          labelledBy={MISSION_UNLOCK_TITLE_ID}
          onCancel={() => setShowUnlockDialog(false)}
        >
          <p
            className="font-semibold text-amber-300 uppercase text-[13px] tracking-wide"
            id={MISSION_UNLOCK_TITLE_ID}
          >
            Admin Unlock
          </p>
          <div className="mt-4 space-y-4">
            <label className="block space-y-2">
              <span className="text-[11px] font-medium text-stone-300">
                Admin Identity
              </span>
              <select
                className="sar-input w-full px-3 py-2 text-sm"
                data-testid="mission-unlock-admin"
                onChange={(event) => setSelectedAdmin(event.target.value)}
                value={selectedAdmin}
              >
                {adminRoster.length === 0 ? (
                  <option value="">No admins configured</option>
                ) : (
                  adminRoster.map((admin) => (
                    <option key={admin} value={admin}>
                      {admin}
                    </option>
                  ))
                )}
              </select>
            </label>
            <label className="block space-y-2">
              <span className="text-[11px] font-medium text-stone-300">
                Unlock Reason
              </span>
              <textarea
                className="sar-input min-h-24 w-full px-3 py-2 text-sm"
                data-testid="mission-unlock-reason"
                onChange={(event) => setUnlockReason(event.target.value)}
                value={unlockReason}
              />
            </label>
          </div>
          <div className="mt-4 flex gap-2">
            <button
              className="flex-1 bg-amber-600 px-3 py-2 text-[12px] font-semibold text-white disabled:opacity-40 hover:bg-amber-500"
              data-testid="mission-unlock-confirm"
              disabled={selectedAdmin.trim() === '' || unlockReason.trim() === '' || governanceBusy}
              onClick={() => void confirmUnlock()}
              type="button"
            >
              {governanceBusy ? 'Unlocking…' : 'Confirm Unlock'}
            </button>
            <button
              className="flex-1 bg-stone-800 px-3 py-2 text-[12px] font-semibold text-stone-200 hover:bg-stone-700"
              onClick={() => setShowUnlockDialog(false)}
              type="button"
            >
              Cancel
            </button>
          </div>
        </InlineDecisionDialog>
      ) : null}

      {showFinishDialog ? (
        <InlineDecisionDialog
          describedBy={MISSION_FINISH_DESCRIPTION_ID}
          className="mt-4 border border-rose-500/30 bg-rose-950/50 p-4 shadow-xl"
          data-testid="mission-finish-dialog"
          labelledBy={MISSION_FINISH_TITLE_ID}
          onCancel={() => setShowFinishDialog(false)}
        >
          <p
            className="font-semibold text-rose-400 uppercase text-[13px] tracking-wide"
            id={MISSION_FINISH_TITLE_ID}
          >
            End Mission?
          </p>
          <p
            className="mt-2 text-[13px] leading-relaxed text-stone-300"
            id={MISSION_FINISH_DESCRIPTION_ID}
          >
            This will stop timers and return to IDLE. Data remains saved.
          </p>
          <div className="mt-4 flex gap-2">
            <button
              className="flex-1 bg-rose-600 px-3 py-2 text-[12px] font-semibold text-white hover:bg-rose-500"
              onClick={() => void confirmFinish()}
              type="button"
            >
              Confirm Finish
            </button>
            <button
              className="flex-1 bg-stone-800 px-3 py-2 text-[12px] font-semibold text-stone-200 hover:bg-stone-700"
              onClick={() => setShowFinishDialog(false)}
              type="button"
            >
              Cancel
            </button>
          </div>
        </InlineDecisionDialog>
      ) : null}
      </>
    </section>
  )
}

function InlineDecisionDialog(props: {
  readonly labelledBy: string
  readonly describedBy?: string
  readonly className: string
  readonly 'data-testid': string
  readonly onCancel: () => void
  readonly children: ReactNode
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const returnFocusRef = useRef<Element | null>(null)

  useEffect(() => {
    returnFocusRef.current = document.activeElement
    const panel = panelRef.current
    if (panel === null) {
      return
    }

    const focusFrame = requestAnimationFrame(() => focusFirstElement(panel))
    return () => {
      cancelAnimationFrame(focusFrame)
      restoreFocus(returnFocusRef.current)
      returnFocusRef.current = null
    }
  }, [])

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      props.onCancel()
      return
    }

    if (panelRef.current !== null) {
      trapTabKey(event.nativeEvent, panelRef.current)
    }
  }

  return (
    <div
      aria-describedby={props.describedBy}
      aria-labelledby={props.labelledBy}
      className={props.className}
      data-testid={props['data-testid']}
      onKeyDown={handleKeyDown}
      ref={panelRef}
      role="alertdialog"
      tabIndex={-1}
    >
      {props.children}
    </div>
  )
}
