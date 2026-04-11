import type { AutosaveStore } from '../persistence/mission-autosave'
import { startMissionAutosave } from '../persistence/mission-autosave'
import {
  createTauriMissionStore,
  type MissionStore,
} from '../../infrastructure/mission-store/tauri-mission-store'
import { createTauriGpxImportSource } from '../../infrastructure/gpx-import-source/tauri-gpx-import-source'
import { ingestMarkerAttachment } from '../../infrastructure/marker-attachment-store/tauri-marker-attachment-store'
import { loadRuntimeBootstrapSettings } from '../../infrastructure/settings-store/tauri-settings-store'
import { registerServiceWorker } from '../../lib/register-service-worker'
import { isTauriRuntimeAvailable } from '../../lib/tauri-runtime'
import { applyGpxController, applyGpxRuntime } from '../gpx/gpx-store'
import { startGpxRuntime } from '../gpx/start-gpx-runtime'
import { applyMarkerController, applyMarkerRuntime } from '../markers/marker-store'
import { startMarkerRuntime } from '../markers/start-marker-runtime'
import {
  applyDrawingController,
  applyDrawingRuntime,
} from '../drawings/drawing-store'
import { startDrawingRuntime } from '../drawings/start-drawing-runtime'
import {
  applyMissionGovernanceController,
  applyMissionGovernanceRuntime,
  applyMissionRuntime,
  applyMissionRuntimeController,
  useMissionStore,
} from '../mission/mission-store'
import { startMissionGovernanceRuntime } from '../mission/start-mission-governance-runtime'
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
import {
  createManagedRuntimeServices,
  createNoopRuntimeServiceHandles,
  stopRuntimeServices,
} from './runtime-managed-services'

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
  readonly startMissionGovernanceRuntime: typeof startMissionGovernanceRuntime
  readonly startMarkerRuntime: typeof startMarkerRuntime
  readonly startDrawingRuntime: typeof startDrawingRuntime
  readonly startGpxRuntime: typeof startGpxRuntime
  readonly startTrackingRuntime: typeof startTrackingRuntime
}

const DEFAULT_DEPENDENCIES: StartAppRuntimeDependencies = {
  registerServiceWorker,
  isTauriRuntimeAvailable,
  createMissionStore: createTauriMissionStore,
  readRuntimeBootstrapSettings: loadRuntimeBootstrapSettings,
  startMissionAutosave,
  startMissionRuntime,
  startMissionGovernanceRuntime,
  startMarkerRuntime,
  startDrawingRuntime,
  startGpxRuntime,
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
  const trackingMissionStore = missionStore as MissionStore & TrackingRuntimeMissionStore
  const gpxImportSource = createTauriGpxImportSource()
  let activeServices = createNoopRuntimeServiceHandles()
  let reloadGeneration = 0

  const missionRuntimeController = await dependencies.startMissionRuntime({
    missionStore,
    applyRuntime: applyMissionRuntime,
  })
  applyMissionRuntimeController(missionRuntimeController)
  const missionGovernanceController = await dependencies.startMissionGovernanceRuntime({
    missionStore,
    applyRuntime: applyMissionGovernanceRuntime,
  })
  applyMissionGovernanceController(missionGovernanceController)
  const markerRuntimeController = await dependencies.startMarkerRuntime({
    markerStore: missionStore,
    attachmentStore: {
      ingest: ingestMarkerAttachment,
    },
    applyRuntime: applyMarkerRuntime,
  })
  applyMarkerController(markerRuntimeController)
  const drawingRuntimeController = await dependencies.startDrawingRuntime({
    drawingStore: missionStore,
    applyRuntime: applyDrawingRuntime,
  })
  applyDrawingController(drawingRuntimeController)
  const gpxRuntimeController = await dependencies.startGpxRuntime({
    gpxStore: missionStore,
    watchSource: gpxImportSource,
    applyRuntime: applyGpxRuntime,
  })
  applyGpxController(gpxRuntimeController)
  await reloadSettings()
  return {
    reloadSettings,
    dispose: () => {
      reloadGeneration += 1
      const previousServices = activeServices
      activeServices = createNoopRuntimeServiceHandles()
      stopRuntimeServices(previousServices)
    },
  }

  async function reloadSettings(options?: { readonly forceConnect?: boolean }): Promise<void> {
    const generation = ++reloadGeneration

    const runtimeSettings = await dependencies.readRuntimeBootstrapSettings(
      options?.forceConnect ?? false,
    )

    const nextServices = await createManagedRuntimeServices({
      runtimeSettings,
      missionStore: trackingMissionStore,
      startMissionAutosave: dependencies.startMissionAutosave,
      startTrackingRuntime: dependencies.startTrackingRuntime,
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
      readTrackingRuntimeConfig,
      applySnapshot: applyTrackingSnapshot,
      applyStatus: applyTrackingStatus,
    })

    if (generation !== reloadGeneration) {
      stopRuntimeServices(nextServices)
      return
    }

    const previousServices = activeServices
    activeServices = nextServices
    stopRuntimeServices(previousServices)
  }
}
