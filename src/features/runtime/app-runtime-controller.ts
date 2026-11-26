import type { ParticipantHistoryRetryOutcome } from '../tracking/participant-history-retry'

export type AppRuntimeController = {
  readonly reloadSettings: (options?: { readonly forceConnect?: boolean }) => Promise<void>
  /** Whether the settings applied last hold a live tracking connection. */
  readonly isTrackingConnected: () => boolean
  /** Fetches incomplete participant history now, skipping its backoff (DON-376). */
  readonly retryParticipantHistory: () => Promise<ParticipantHistoryRetryOutcome>
  readonly dispose: () => Promise<void>
}

let controller: AppRuntimeController | null = null
let controllerOperationTail: Promise<void> = Promise.resolve()

/**
 * Replaces the active app runtime controller after disposing the previous one.
 */
export function applyAppRuntimeController(
  nextController: AppRuntimeController,
): Promise<void> {
  const operation = controllerOperationTail.then(() =>
    replaceAppRuntimeController(nextController))
  controllerOperationTail = operation
  return operation
}

/** Serializes one replacement so concurrent boot requests cannot overtake disposal. */
async function replaceAppRuntimeController(
  nextController: AppRuntimeController,
): Promise<void> {
  const previousController = controller
  if (previousController !== null) {
    await previousController.dispose()
  }

  let disposed = false
  let disposalPromise: Promise<void> | null = null
  const wrappedController: AppRuntimeController = {
    reloadSettings: async (options) => {
      if (disposed) {
        throw new Error('App runtime controller has been disposed.')
      }

      await nextController.reloadSettings(options)
    },
    isTrackingConnected: () => !disposed && nextController.isTrackingConnected(),
    retryParticipantHistory: async () => disposed
      ? { kind: 'unavailable', reason: 'SAR Tracker is shutting down.' }
      : nextController.retryParticipantHistory(),
    dispose: () => {
      if (disposalPromise === null) {
        disposed = true
        disposalPromise = (async () => {
          try {
            await nextController.dispose()
          } finally {
            if (controller === wrappedController) {
              controller = null
            }
          }
        })()
      }
      return disposalPromise
    },
  }

  controller = wrappedController
}

/**
 * Returns the currently active app runtime controller, when startup succeeded.
 */
export function getAppRuntimeController(): AppRuntimeController | null {
  return controller
}

/**
 * Serializes main-process teardown with any controller replacement in flight.
 */
export function disposeAppRuntimeController(): Promise<void> {
  const operation = controllerOperationTail.then(async () => {
    const activeController = controller
    if (activeController !== null) {
      await activeController.dispose()
    }
  })
  controllerOperationTail = operation
  return operation
}

/**
 * Clears the global controller registry for unit tests that need isolation.
 */
export async function clearAppRuntimeControllerForTest(): Promise<void> {
  if (controller !== null) {
    await safelyDisposeController(
      controller,
      'Failed to dispose app runtime controller while clearing test state.',
    )
  }
  controller = null
  controllerOperationTail = Promise.resolve()
}

/** Disposes a controller without letting cleanup failures corrupt controller state. */
async function safelyDisposeController(
  targetController: AppRuntimeController,
  message: string,
): Promise<void> {
  try {
    await targetController.dispose()
  } catch (error) {
    console.error(message, error)
  }
}
