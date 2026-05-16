import { create } from 'zustand'

export type RuntimeBootPhase = 'booting' | 'ready' | 'failed'

export type RuntimeBootSnapshot = {
  readonly phase: RuntimeBootPhase
  readonly error: string | null
}

type RuntimeBootStore = RuntimeBootSnapshot

const UNKNOWN_RUNTIME_STARTUP_FAILURE =
  'Runtime startup failed before the application became operational.'

export const useRuntimeBootStore = create<RuntimeBootStore>(() => ({
  phase: 'booting',
  error: null,
}))

/**
 * Returns the current boot snapshot without exposing Zustand actions to callers.
 */
export function getRuntimeBootState(): RuntimeBootSnapshot {
  const state = useRuntimeBootStore.getState()

  return {
    phase: state.phase,
    error: state.error,
  }
}

/**
 * Marks the runtime as preparing and clears any previous failure message.
 */
export function markRuntimeBooting(): void {
  useRuntimeBootStore.setState({
    phase: 'booting',
    error: null,
  })
}

/**
 * Marks the runtime as ready for normal operator interaction.
 */
export function markRuntimeBootReady(): void {
  useRuntimeBootStore.setState({
    phase: 'ready',
    error: null,
  })
}

/**
 * Marks startup as failed with a message safe to show in the app shell.
 */
export function markRuntimeBootFailed(error: unknown): void {
  useRuntimeBootStore.setState({
    phase: 'failed',
    error: runtimeBootFailureMessage(error),
  })
}

/**
 * Normalizes unknown startup exceptions into an operator-facing fault string.
 */
export function runtimeBootFailureMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message
  }

  if (typeof error === 'string' && error.trim().length > 0) {
    return error
  }

  return UNKNOWN_RUNTIME_STARTUP_FAILURE
}
