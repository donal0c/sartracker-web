export type AppRuntimeController = {
  readonly reloadSettings: (options?: { readonly forceConnect?: boolean }) => Promise<void>
  readonly dispose: () => void
}

let controller: AppRuntimeController | null = null

/**
 * Replaces the active app runtime controller after disposing the previous one.
 */
export function applyAppRuntimeController(nextController: AppRuntimeController): void {
  const previousController = controller
  if (previousController !== null) {
    safelyDisposeController(
      previousController,
      'Failed to dispose previous app runtime controller during replacement.',
    )
  }

  let disposed = false
  const wrappedController: AppRuntimeController = {
    reloadSettings: async (options) => {
      if (disposed) {
        throw new Error('App runtime controller has been disposed.')
      }

      await nextController.reloadSettings(options)
    },
    dispose: () => {
      if (disposed) {
        return
      }

      disposed = true
      try {
        nextController.dispose()
      } finally {
        if (controller === wrappedController) {
          controller = null
        }
      }
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
 * Clears the global controller registry for unit tests that need isolation.
 */
export function clearAppRuntimeControllerForTest(): void {
  if (controller !== null) {
    safelyDisposeController(
      controller,
      'Failed to dispose app runtime controller while clearing test state.',
    )
  }
  controller = null
}

/** Disposes a controller without letting cleanup failures corrupt controller state. */
function safelyDisposeController(targetController: AppRuntimeController, message: string): void {
  try {
    targetController.dispose()
  } catch (error) {
    console.error(message, error)
  }
}
