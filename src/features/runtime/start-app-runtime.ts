import {
  type AutosaveStore,
  startMissionAutosave,
} from '../persistence/mission-autosave'
import { createTauriTrackingCache } from '../../infrastructure/tracking-cache/tauri-tracking-cache'
import {
  createTauriMissionStore,
  type MissionStore,
} from '../../infrastructure/mission-store/tauri-mission-store'
import { registerServiceWorker } from '../../lib/register-service-worker'
import { isTauriRuntimeAvailable } from '../../lib/tauri-runtime'
import {
  applyMissionRuntime,
  applyMissionRuntimeController,
  useMissionStore,
} from '../mission/mission-store'
import { startMissionRuntime } from '../mission/start-mission-runtime'
import {
  createPollingManager,
  type TrackingPollerClient,
} from '../tracking/polling-manager'
import { createTraccarClient } from '../tracking/traccar-client'
import { applyTrackingSnapshot, applyTrackingStatus } from '../tracking/tracking-store'
import { readTrackingRuntimeConfig } from '../tracking/tracking-runtime-config'
import {
  startTrackingRuntime,
  type TrackingRuntimeMissionStore,
} from '../tracking/start-tracking-runtime'

type StartAppRuntimeDependencies = {
  readonly registerServiceWorker: () => Promise<void>
  readonly isTauriRuntimeAvailable: () => boolean
  readonly createMissionStore: () => MissionStore
  readonly startMissionAutosave: (store: AutosaveStore) => () => void
  readonly startMissionRuntime: typeof startMissionRuntime
  readonly startTrackingRuntime: typeof startTrackingRuntime
}

const DEFAULT_DEPENDENCIES: StartAppRuntimeDependencies = {
  registerServiceWorker,
  isTauriRuntimeAvailable,
  createMissionStore: createTauriMissionStore,
  startMissionAutosave,
  startMissionRuntime,
  startTrackingRuntime,
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

  const missionStore = dependencies.createMissionStore()
  const trackingMissionStore: TrackingRuntimeMissionStore = missionStore

  dependencies.startMissionAutosave(missionStore)
  const missionRuntimeController = await dependencies.startMissionRuntime({
    missionStore,
    applyRuntime: applyMissionRuntime,
  })
  applyMissionRuntimeController(missionRuntimeController)
  await dependencies.startTrackingRuntime({
    config: readTrackingRuntimeConfig(),
    createClient: createTraccarClient,
    createPoller: (client, hooks) =>
      createPollingManager(client as TrackingPollerClient, {
        intervalMs: 30_000,
        staleThresholdMs: 60 * 60 * 1000,
        getPollingMode: () => {
          const phase = useMissionStore.getState().phase
          return phase === 'active' || phase === 'paused' ? phase : 'idle'
        },
        getHistoryResetKey: () => useMissionStore.getState().currentMission?.id ?? null,
        getInitialBreadcrumbFrom: () => {
          const mission = useMissionStore.getState().currentMission
          return mission === null ? null : new Date(mission.start_time)
        },
        onSnapshot: hooks.onSnapshot,
        onStatusChange: hooks.onStatusChange,
      }),
    cache: createTauriTrackingCache(),
    missionStore: trackingMissionStore,
    applySnapshot: applyTrackingSnapshot,
    applyStatus: applyTrackingStatus,
  })
}
