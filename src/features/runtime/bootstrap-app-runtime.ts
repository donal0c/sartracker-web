import { registerServiceWorker } from '../../lib/register-service-worker'
import {
  shouldEnableMissionBrowserHarness,
  startMissionBrowserHarness,
} from '../mission/mission-browser-harness'
import {
  applyAppRuntimeController,
  type AppRuntimeController,
} from './app-runtime-controller'
import {
  markRuntimeBootFailed,
  markRuntimeBooting,
  markRuntimeBootReady,
} from './runtime-boot-store'
import { startAppRuntime } from './start-app-runtime'

type BootstrapAppRuntimeDependencies = {
  readonly registerServiceWorker: () => Promise<void>
  readonly shouldEnableMissionBrowserHarness: () => boolean
  readonly startMissionBrowserHarness: () => Promise<void>
  readonly startAppRuntime: () => Promise<AppRuntimeController | null>
  readonly applyAppRuntimeController: (controller: AppRuntimeController) => void
  readonly markRuntimeBooting: () => void
  readonly markRuntimeBootReady: () => void
  readonly markRuntimeBootFailed: (error: unknown) => void
}

const DEFAULT_DEPENDENCIES: BootstrapAppRuntimeDependencies = {
  registerServiceWorker,
  shouldEnableMissionBrowserHarness,
  startMissionBrowserHarness,
  startAppRuntime: () =>
    startAppRuntime({
      registerServiceWorker: async () => undefined,
    }),
  applyAppRuntimeController,
  markRuntimeBooting,
  markRuntimeBootReady,
  markRuntimeBootFailed,
}

/**
 * Starts the correct app runtime path and advances the boot state only after
 * that runtime has successfully installed its operator-facing controller.
 */
export async function bootstrapAppRuntime(
  dependencies: BootstrapAppRuntimeDependencies = DEFAULT_DEPENDENCIES,
): Promise<void> {
  dependencies.markRuntimeBooting()

  try {
    await dependencies.registerServiceWorker()

    if (dependencies.shouldEnableMissionBrowserHarness()) {
      await dependencies.startMissionBrowserHarness()
      dependencies.markRuntimeBootReady()
      return
    }

    const controller = await dependencies.startAppRuntime()

    if (controller !== null) {
      dependencies.applyAppRuntimeController(controller)
    }

    dependencies.markRuntimeBootReady()
  } catch (error) {
    dependencies.markRuntimeBootFailed(error)
  }
}
