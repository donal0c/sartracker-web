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
  | 'mission-unlock'

export type AutosavePhase = 'disabled' | 'idle' | 'syncing' | 'synced' | 'failed'

type AutosaveFailure = {
  readonly message: string
  readonly reason: AutosaveSyncReason
  readonly at: string
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
  readonly configure: (input: AutosaveConfigureInput) => void
  readonly markDisabled: () => void
  readonly markSyncStarted: (input: AutosaveSyncStartedInput) => void
  readonly markSyncSucceeded: (input: AutosaveSyncSucceededInput) => void
  readonly markSyncFailed: (input: AutosaveSyncFailedInput) => void
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
}

export const useAutosaveStatusStore = create<AutosaveStatusState>((set) => ({
  ...INITIAL_STATE,
  configure: (input) =>
    set({
      phase: input.enabled ? 'idle' : 'disabled',
      enabled: input.enabled,
      intervalMs: input.intervalMs,
      staleAfterMs: input.intervalMs * STALE_INTERVAL_MULTIPLIER,
      lastAttemptAt: toIso(input.now),
      lastFailure: null,
    }),
  markDisabled: () =>
    set({
      ...INITIAL_STATE,
    }),
  markSyncStarted: (input) =>
    set({
      phase: 'syncing',
      enabled: true,
      lastAttemptAt: toIso(input.now),
    }),
  markSyncSucceeded: (input) =>
    set({
      phase: 'synced',
      enabled: true,
      lastAttemptAt: toIso(input.now),
      lastSuccessAt: toIso(input.now),
      lastSuccessReason: input.reason,
      lastBackupPath: input.backupPath,
      lastFailure: null,
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
  reset: () =>
    set({
      ...INITIAL_STATE,
    }),
}))

/**
 * Returns the operator-facing autosave warning for the current status snapshot.
 */
export function selectAutosaveWarning(
  state: AutosaveStatusState,
  now: Date = new Date(),
): string | null {
  if (!state.enabled || state.phase === 'disabled') {
    return null
  }

  if (state.lastFailure !== null) {
    return `Autosave failing: ${state.lastFailure.message}`
  }

  if (state.lastSuccessAt === null) {
    return null
  }

  const elapsedMs = now.getTime() - Date.parse(state.lastSuccessAt)
  if (elapsedMs <= state.staleAfterMs) {
    return null
  }

  return `Autosave stale: last backup ${formatTime(state.lastSuccessAt)}`
}

/** Returns the provided time, or the current wall-clock time, as an ISO timestamp. */
function toIso(now?: Date): string {
  return (now ?? new Date()).toISOString()
}

/** Formats an ISO timestamp for compact mast and warning copy. */
function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}
