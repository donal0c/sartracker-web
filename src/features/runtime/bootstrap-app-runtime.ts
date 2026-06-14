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
  type RuntimeBootGeneration,
  markRuntimeBootFailed,
  markRuntimeBooting,
  markRuntimeBootReady,
} from './runtime-boot-store'
import { startAppRuntime } from './start-app-runtime'

const RUNTIME_BOOT_WATCHDOG_MS = 30_000
const RUNTIME_BOOT_WATCHDOG_FAILURE =
  'Runtime startup is taking longer than expected. Reload SAR Tracker from a clean runtime; if this repeats, capture the fault message before operational use.'

type RuntimeBootWatchdogHandle = ReturnType<typeof globalThis.setTimeout>

type BootstrapAppRuntimeDependencies = {
  readonly registerServiceWorker: () => Promise<void>
  readonly shouldEnableMissionBrowserHarness: () => boolean
  readonly startMissionBrowserHarness: () => Promise<void>
  readonly startAppRuntime: () => Promise<AppRuntimeController | null>
  readonly applyAppRuntimeController: (controller: AppRuntimeController) => void
  readonly markRuntimeBooting: () => RuntimeBootGeneration | undefined
  readonly markRuntimeBootReady: (generation?: RuntimeBootGeneration) => void
  readonly markRuntimeBootFailed: (
    error: unknown,
    generation?: RuntimeBootGeneration,
  ) => void
  readonly scheduleRuntimeBootWatchdog?: (
    callback: () => void,
    delayMs: number,
  ) => RuntimeBootWatchdogHandle
  readonly clearRuntimeBootWatchdog?: (handle: RuntimeBootWatchdogHandle) => void
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
  scheduleRuntimeBootWatchdog: (callback, delayMs) =>
    globalThis.setTimeout(callback, delayMs),
  clearRuntimeBootWatchdog: (handle) => globalThis.clearTimeout(handle),
}

const MISSING_OPERATIONAL_RUNTIME_CONTROLLER =
  'No operational runtime controller is available. Open hosted browser testing with ?missionHarness=1, or run SAR Tracker inside the Electron desktop app for operational use.'

/**
 * Starts the correct app runtime path and advances the boot state only after
 * that runtime has successfully installed its operator-facing controller.
 */
export async function bootstrapAppRuntime(
  dependencies: BootstrapAppRuntimeDependencies = DEFAULT_DEPENDENCIES,
): Promise<void> {
  const bootGeneration = dependencies.markRuntimeBooting()
  const scheduleWatchdog =
    dependencies.scheduleRuntimeBootWatchdog ??
    DEFAULT_DEPENDENCIES.scheduleRuntimeBootWatchdog
  const clearWatchdog =
    dependencies.clearRuntimeBootWatchdog ?? DEFAULT_DEPENDENCIES.clearRuntimeBootWatchdog
  const watchdogHandle = scheduleWatchdog?.(
    () =>
      dependencies.markRuntimeBootFailed(
        new Error(RUNTIME_BOOT_WATCHDOG_FAILURE),
        bootGeneration,
      ),
    RUNTIME_BOOT_WATCHDOG_MS,
  )

  try {
    await dependencies.registerServiceWorker()

    if (dependencies.shouldEnableMissionBrowserHarness()) {
      await dependencies.startMissionBrowserHarness()
      dependencies.markRuntimeBootReady(bootGeneration)
      return
    }

    const controller = await dependencies.startAppRuntime()

    if (controller === null) {
      throw new Error(MISSING_OPERATIONAL_RUNTIME_CONTROLLER)
    }

    dependencies.applyAppRuntimeController(controller)
    dependencies.markRuntimeBootReady(bootGeneration)
  } catch (error) {
    dependencies.markRuntimeBootFailed(error, bootGeneration)
  } finally {
    if (watchdogHandle !== undefined) {
      clearWatchdog?.(watchdogHandle)
    }
  }
}
