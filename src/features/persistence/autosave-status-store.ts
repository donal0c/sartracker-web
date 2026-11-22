import { create } from 'zustand'

import { DEFAULT_AUTOSAVE_INTERVAL_MS } from './autosave-config'

export type AutosaveSyncReason =
  | 'interval'
  | 'visibilitychange'
  | 'pagehide'
  | 'mission-start'
  | 'mission-pause'
  | 'mission-resume'
  | 'mission-finish'
  | 'mission-recover-resume'
  | 'mission-start-fresh'
  | 'mission-finalize'
  | 'mission-cleanup'
  | 'mission-evidence-loss-acknowledgement'
  | 'mission-unlock'

export type AutosavePhase = 'disabled' | 'idle' | 'syncing' | 'synced' | 'failed'

type AutosaveFailure = {
  readonly message: string
  readonly reason: AutosaveSyncReason
  readonly at: string
}

export type LifecycleBackupFailureAlert = {
  readonly reason: AutosaveSyncReason
  readonly reasonLabel: string
  readonly message: string
}

type AutosaveConfigureInput = {
  readonly enabled: boolean
  readonly intervalMs: number
  readonly now?: Date
}

type AutosaveSyncStartedInput = {
  readonly reason: AutosaveSyncReason
  readonly now?: Date
}

type AutosaveSyncSucceededInput = {
  readonly reason: AutosaveSyncReason
  readonly backupPath: string
  readonly now?: Date
}

type AutosaveSyncFailedInput = {
  readonly reason: AutosaveSyncReason
  readonly message: string
  readonly now?: Date
}

type AutosaveObservedElapsedInput = {
  readonly elapsedMs: number
}

const LIFECYCLE_SYNC_REASONS = new Set<AutosaveSyncReason>([
  'mission-start',
  'mission-pause',
  'mission-resume',
  'mission-finish',
  'mission-recover-resume',
  'mission-start-fresh',
  'mission-finalize',
  'mission-cleanup',
  'mission-unlock',
])

export type AutosaveStatusState = {
  readonly phase: AutosavePhase
  readonly enabled: boolean
  readonly intervalMs: number
  readonly staleAfterMs: number
  readonly lastAttemptAt: string | null
  readonly lastSuccessAt: string | null
  readonly lastSuccessReason: AutosaveSyncReason | null
  readonly lastBackupPath: string | null
  readonly lastFailure: AutosaveFailure | null
  readonly observedMsSinceLastSuccess: number
  readonly configure: (input: AutosaveConfigureInput) => void
  readonly markDisabled: () => void
  readonly markSyncStarted: (input: AutosaveSyncStartedInput) => void
  readonly markSyncSucceeded: (input: AutosaveSyncSucceededInput) => void
  readonly markSyncFailed: (input: AutosaveSyncFailedInput) => void
  readonly markObservedElapsed: (input: AutosaveObservedElapsedInput) => void
  readonly reset: () => void
}

const STALE_INTERVAL_MULTIPLIER = 2

const INITIAL_STATE = {
  phase: 'disabled' as const,
  enabled: false,
  intervalMs: DEFAULT_AUTOSAVE_INTERVAL_MS,
  staleAfterMs: DEFAULT_AUTOSAVE_INTERVAL_MS * STALE_INTERVAL_MULTIPLIER,
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastSuccessReason: null,
  lastBackupPath: null,
  lastFailure: null,
  observedMsSinceLastSuccess: 0,
}

export const useAutosaveStatusStore = create<AutosaveStatusState>((set) => ({
  ...INITIAL_STATE,
  // A settings reload calls configure() again. It changes the schedule only:
  // a standing failure and the time since the last good backup stay until a
  // backup actually succeeds [DON-352, audit M-63].
  configure: (input) =>
    set((state) => ({
      phase: input.enabled ? (state.lastFailure === null ? 'idle' : 'failed') : 'disabled',
      enabled: input.enabled,
      intervalMs: input.intervalMs,
      staleAfterMs: input.intervalMs * STALE_INTERVAL_MULTIPLIER,
      lastAttemptAt: state.lastAttemptAt ?? toIso(input.now),
    })),
  // Switching autosave off changes the schedule only. A standing failure and
  // the last good backup are kept, so switching it back on shows "Autosave
  // failing" or "Autosave stale" again instead of a clean slate
  // [DON-352, audit M-63].
  markDisabled: () =>
    set({
      phase: 'disabled',
      enabled: false,
    }),
  markSyncStarted: (input) =>
    set({
      phase: 'syncing',
      enabled: true,
      lastAttemptAt: toIso(input.now),
    }),
  markSyncSucceeded: (input) =>
    set((state) => {
      const lastFailure = selectRemainingFailure(state.lastFailure, input.reason)
      return {
        phase: lastFailure === null ? 'synced' : 'failed',
        enabled: true,
        lastAttemptAt: toIso(input.now),
        lastSuccessAt: toIso(input.now),
        lastSuccessReason: input.reason,
        lastBackupPath: input.backupPath,
        lastFailure,
        observedMsSinceLastSuccess: 0,
      }
    }),
  markSyncFailed: (input) =>
    set({
      phase: 'failed',
      enabled: true,
      lastAttemptAt: toIso(input.now),
      lastFailure: {
        message: input.message,
        reason: input.reason,
        at: toIso(input.now),
      },
    }),
  markObservedElapsed: (input) =>
    set((state) => {
      if (
        !state.enabled ||
        state.phase === 'disabled' ||
        state.lastSuccessAt === null ||
        input.elapsedMs <= 0
      ) {
        return state
      }

      return {
        observedMsSinceLastSuccess: state.observedMsSinceLastSuccess + input.elapsedMs,
      }
    }),
  reset: () =>
    set({
      ...INITIAL_STATE,
    }),
}))

/**
 * Returns the operator-facing autosave warning for the current status snapshot.
 */
export function selectAutosaveWarning(state: AutosaveStatusState): string | null {
  if (!state.enabled || state.phase === 'disabled') {
    return null
  }

  if (state.lastFailure !== null) {
    return `Autosave failing: ${state.lastFailure.message}`
  }

  if (state.lastSuccessAt === null) {
    return null
  }

  if (state.observedMsSinceLastSuccess <= state.staleAfterMs) {
    return null
  }

  return `Autosave stale: last backup ${formatTime(state.lastSuccessAt)}`
}

/**
 * Returns a high-prominence alert only for lifecycle-forced backup failures.
 */
export function selectLifecycleBackupFailureAlert(
  state: AutosaveStatusState,
): LifecycleBackupFailureAlert | null {
  const failure = state.lastFailure
  if (failure === null || !LIFECYCLE_SYNC_REASONS.has(failure.reason)) {
    return null
  }

  return {
    reason: failure.reason,
    reasonLabel: formatReasonLabel(failure.reason),
    message: failure.message,
  }
}

/** Returns the provided time, or the current wall-clock time, as an ISO timestamp. */
function toIso(now?: Date): string {
  return (now ?? new Date()).toISOString()
}

/** Preserves lifecycle-specific failures until the matching lifecycle write succeeds. */
function selectRemainingFailure(
  lastFailure: AutosaveFailure | null,
  successReason: AutosaveSyncReason,
): AutosaveFailure | null {
  if (lastFailure === null) {
    return null
  }

  if (!LIFECYCLE_SYNC_REASONS.has(lastFailure.reason)) {
    return null
  }

  return lastFailure.reason === successReason ? null : lastFailure
}

/** Converts sync reason ids into readable operator-facing words. */
function formatReasonLabel(reason: AutosaveSyncReason): string {
  return reason.replace(/^mission-/, 'mission ').replaceAll('-', ' ')
}

/** Formats an ISO timestamp for compact mast and warning copy. */
function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}
