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
import { applyMarkerController, applyMarkerRuntime } from '../markers/marker-store'
import { startMarkerRuntime } from '../markers/start-marker-runtime'
import {
  applyDrawingController,
  applyDrawingRuntime,
} from '../drawings/drawing-store'
import { startDrawingRuntime } from '../drawings/start-drawing-runtime'
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
  readonly startMarkerRuntime: typeof startMarkerRuntime
  readonly startDrawingRuntime: typeof startDrawingRuntime
  readonly startTrackingRuntime: typeof startTrackingRuntime
}

const DEFAULT_DEPENDENCIES: StartAppRuntimeDependencies = {
  registerServiceWorker,
  isTauriRuntimeAvailable,
  createMissionStore: createTauriMissionStore,
  startMissionAutosave,
  startMissionRuntime,
  startMarkerRuntime,
  startDrawingRuntime,
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
  const markerRuntimeController = await dependencies.startMarkerRuntime({
    markerStore: missionStore,
    applyRuntime: applyMarkerRuntime,
  })
  applyMarkerController(markerRuntimeController)
  const drawingRuntimeController = await dependencies.startDrawingRuntime({
    drawingStore: missionStore,
    applyRuntime: applyDrawingRuntime,
  })
  applyDrawingController(drawingRuntimeController)
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
