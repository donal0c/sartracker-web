import { create } from 'zustand'

export type RuntimeBootPhase = 'booting' | 'ready' | 'failed'
export type RuntimeBootGeneration = number

export type RuntimeBootSnapshot = {
  readonly phase: RuntimeBootPhase
  readonly error: string | null
}

type RuntimeBootStore = RuntimeBootSnapshot & {
  readonly generation: RuntimeBootGeneration
}

const UNKNOWN_RUNTIME_STARTUP_FAILURE =
  'Runtime startup failed before the application became operational.'

export const useRuntimeBootStore = create<RuntimeBootStore>(() => ({
  phase: 'booting',
  error: null,
  generation: 0,
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
export function markRuntimeBooting(): RuntimeBootGeneration {
  const generation = useRuntimeBootStore.getState().generation + 1

  useRuntimeBootStore.setState({
    phase: 'booting',
    error: null,
    generation,
  })

  return generation
}

/**
 * Marks the runtime as ready for normal operator interaction.
 */
export function markRuntimeBootReady(generation?: RuntimeBootGeneration): void {
  useRuntimeBootStore.setState((state) => {
    if (!bootGenerationCanTransition(state, generation)) {
      return state
    }

    return {
      ...state,
      phase: 'ready',
      error: null,
    }
  })
}

/**
 * Marks startup as failed with a message safe to show in the app shell.
 */
export function markRuntimeBootFailed(
  error: unknown,
  generation?: RuntimeBootGeneration,
): void {
  useRuntimeBootStore.setState((state) => {
    if (!bootGenerationCanTransition(state, generation)) {
      return state
    }

    return {
      ...state,
      phase: 'failed',
      error: runtimeBootFailureMessage(error),
    }
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

/** Returns true when an in-flight boot still owns the current boot state. */
function bootGenerationCanTransition(
  state: RuntimeBootStore,
  generation?: RuntimeBootGeneration,
): boolean {
  if (generation === undefined) {
    return true
  }

  return state.generation === generation && state.phase === 'booting'
}
