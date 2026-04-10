import {
  type AutosaveStore,
  startMissionAutosave,
} from '../persistence/mission-autosave'
import { createTauriTrackingCache } from '../../infrastructure/tracking-cache/tauri-tracking-cache'
import {
  createTauriMissionStore,
  type MissionStore,
} from '../../infrastructure/mission-store/tauri-mission-store'
import { loadRuntimeBootstrapSettings } from '../../infrastructure/settings-store/tauri-settings-store'
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
import type { AppRuntimeController } from './app-runtime-controller'

const NOOP_TRACKING_CACHE = {
  read: async () => null,
  write: async (contents: string) => contents,
}

type StartAppRuntimeDependencies = {
  readonly registerServiceWorker: () => Promise<void>
  readonly isTauriRuntimeAvailable: () => boolean
  readonly createMissionStore: () => MissionStore
  readonly readRuntimeBootstrapSettings: (
    forceConnect?: boolean,
  ) => Promise<{
    readonly autosaveEnabled: boolean
    readonly autosaveIntervalMs: number
    readonly trackingPollIntervalMs: number
    readonly trackingCacheEnabled: boolean
    readonly trackingConfig: {
      readonly baseUrl: string
      readonly email?: string
      readonly password?: string
      readonly token?: string
    } | null
  }>
  readonly startMissionAutosave: (
    store: AutosaveStore,
    options?: { readonly intervalMs?: number },
  ) => () => void
  readonly startMissionRuntime: typeof startMissionRuntime
  readonly startMarkerRuntime: typeof startMarkerRuntime
  readonly startDrawingRuntime: typeof startDrawingRuntime
  readonly startTrackingRuntime: typeof startTrackingRuntime
}

const DEFAULT_DEPENDENCIES: StartAppRuntimeDependencies = {
  registerServiceWorker,
  isTauriRuntimeAvailable,
  createMissionStore: createTauriMissionStore,
  readRuntimeBootstrapSettings: loadRuntimeBootstrapSettings,
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
): Promise<AppRuntimeController | null> {
  await dependencies.registerServiceWorker()

  if (!dependencies.isTauriRuntimeAvailable()) {
    return null
  }

  const missionStore = dependencies.createMissionStore()
  const trackingMissionStore: TrackingRuntimeMissionStore = missionStore
  let stopAutosave: () => void = () => undefined
  let stopTracking: () => void = () => undefined

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
  await reloadSettings()
  return { reloadSettings }

  async function reloadSettings(options?: { readonly forceConnect?: boolean }): Promise<void> {
    stopAutosave()
    stopTracking()

    const runtimeSettings = await dependencies.readRuntimeBootstrapSettings(
      options?.forceConnect ?? false,
    )

    if (runtimeSettings.autosaveEnabled) {
      stopAutosave = dependencies.startMissionAutosave(missionStore, {
        intervalMs: runtimeSettings.autosaveIntervalMs,
      })
    } else {
      stopAutosave = () => undefined
    }

    stopTracking = await dependencies.startTrackingRuntime({
      config: runtimeSettings.trackingConfig ?? readTrackingRuntimeConfig(),
      createClient: createTraccarClient,
      createPoller: (client, hooks) =>
        createPollingManager(client as TrackingPollerClient, {
          intervalMs: runtimeSettings.trackingPollIntervalMs,
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
      cache: runtimeSettings.trackingCacheEnabled
        ? createTauriTrackingCache()
        : NOOP_TRACKING_CACHE,
      missionStore: trackingMissionStore,
      applySnapshot: applyTrackingSnapshot,
      applyStatus: applyTrackingStatus,
    })
  }
}
