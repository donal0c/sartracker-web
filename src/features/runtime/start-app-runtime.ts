import {
  type AutosaveStore,
  startMissionAutosave,
} from '../persistence/mission-autosave'
import { createTauriMissionStore } from '../../infrastructure/mission-store/tauri-mission-store'
import { registerServiceWorker } from '../../lib/register-service-worker'
import { isTauriRuntimeAvailable } from '../../lib/tauri-runtime'

type StartAppRuntimeDependencies = {
  readonly registerServiceWorker: () => Promise<void>
  readonly isTauriRuntimeAvailable: () => boolean
  readonly createMissionStore: () => AutosaveStore
  readonly startMissionAutosave: (store: AutosaveStore) => () => void
}

const DEFAULT_DEPENDENCIES: StartAppRuntimeDependencies = {
  registerServiceWorker,
  isTauriRuntimeAvailable,
  createMissionStore: createTauriMissionStore,
  startMissionAutosave,
}

/**
 * Starts non-React application runtime services behind a small orchestration boundary.
 */
export async function startAppRuntime(
  dependencies: StartAppRuntimeDependencies = DEFAULT_DEPENDENCIES,
): Promise<void> {
  await dependencies.registerServiceWorker()

  if (!dependencies.isTauriRuntimeAvailable()) {
    return
  }

  dependencies.startMissionAutosave(dependencies.createMissionStore())
}
