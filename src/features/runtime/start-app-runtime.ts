import type {
  AutosaveStore,
  MissionAutosaveController,
} from '../persistence/mission-autosave'
import { startMissionAutosave } from '../persistence/mission-autosave'
import type { AutosaveSyncReason } from '../persistence/autosave-status-store'
import {
  createTauriMissionStore,
  type MissionStore,
} from '../../infrastructure/mission-store/tauri-mission-store'
import { createTauriGpxImportSource } from '../../infrastructure/gpx-import-source/tauri-gpx-import-source'
import { tauriMarkerAttachmentAdapter } from '../../infrastructure/marker-attachment-store/tauri-marker-attachment-store'
import { createTauriTrackingCache } from '../../infrastructure/tracking-cache/tauri-tracking-cache'
import { createTauriTraccarClient } from '../../infrastructure/traccar-http/tauri-traccar-fetch'
import { loadRuntimeBootstrapSettings } from '../../infrastructure/settings-store/tauri-settings-store'
import { registerServiceWorker } from '../../lib/register-service-worker'
import { isTauriRuntimeAvailable } from '../../lib/tauri-runtime'
import { startGpxRuntime } from '../gpx/start-gpx-runtime'
import { startHelicopterRuntime } from '../helicopters/start-helicopter-runtime'
import { startMarkerRuntime } from '../markers/start-marker-runtime'
import { startDrawingRuntime } from '../drawings/start-drawing-runtime'
import { useMissionStore } from '../mission/mission-store'
import { startMissionGovernanceRuntime } from '../mission/start-mission-governance-runtime'
import { startMissionRuntime } from '../mission/start-mission-runtime'
import {
  createPollingManager,
  type TrackingPollerClient,
} from '../tracking/polling-manager'
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
import { startCoreFeatureRuntimes } from './start-core-feature-runtimes'

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
  ) => MissionAutosaveController
  readonly startMissionRuntime: typeof startMissionRuntime
  readonly startMissionGovernanceRuntime: typeof startMissionGovernanceRuntime
  readonly startMarkerRuntime: typeof startMarkerRuntime
  readonly startDrawingRuntime: typeof startDrawingRuntime
  readonly startHelicopterRuntime: typeof startHelicopterRuntime
  readonly startGpxRuntime: typeof startGpxRuntime
  readonly startTrackingRuntime: typeof startTrackingRuntime
  readonly startCoreFeatureRuntimes: typeof startCoreFeatureRuntimes
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
  startHelicopterRuntime,
  startGpxRuntime,
  startTrackingRuntime,
  startCoreFeatureRuntimes,
}

/**
 * Starts non-React application runtime services behind a small orchestration boundary.
 */
export async function startAppRuntime(
  dependencies: Partial<StartAppRuntimeDependencies> = {},
): Promise<AppRuntimeController | null> {
  const resolvedDependencies = {
    ...DEFAULT_DEPENDENCIES,
    ...dependencies,
  } satisfies StartAppRuntimeDependencies

  await resolvedDependencies.registerServiceWorker()

  if (!resolvedDependencies.isTauriRuntimeAvailable()) {
    return null
  }

  const missionStore = resolvedDependencies.createMissionStore()
  const trackingMissionStore = missionStore as MissionStore & TrackingRuntimeMissionStore
  const gpxImportSource = createTauriGpxImportSource()
  let activeServices = createNoopRuntimeServiceHandles()
  let reloadGeneration = 0

  const coreFeatureRuntimes = await resolvedDependencies.startCoreFeatureRuntimes({
    missionStore,
    attachmentAdapter: tauriMarkerAttachmentAdapter,
    gpxWatchSource: gpxImportSource,
    requestAutosaveSync: (reason: AutosaveSyncReason) =>
      activeServices.requestAutosaveSync(reason),
    startMissionRuntime: resolvedDependencies.startMissionRuntime,
    startMissionGovernanceRuntime: resolvedDependencies.startMissionGovernanceRuntime,
    startMarkerRuntime: resolvedDependencies.startMarkerRuntime,
    startDrawingRuntime: resolvedDependencies.startDrawingRuntime,
    startHelicopterRuntime: resolvedDependencies.startHelicopterRuntime,
    startGpxRuntime: resolvedDependencies.startGpxRuntime,
  })
  try {
    await reloadSettings()
  } catch (error) {
    coreFeatureRuntimes.dispose()
    throw error
  }
  let disposed = false

  return {
    reloadSettings: async (options) => {
      if (disposed) {
        throw new Error('App runtime has already been disposed.')
      }

      await reloadSettings(options)
    },
    dispose: () => {
      if (disposed) {
        return
      }

      disposed = true
      reloadGeneration += 1
      const previousServices = activeServices
      activeServices = createNoopRuntimeServiceHandles()
      stopRuntimeServices(previousServices)
      coreFeatureRuntimes.dispose()
    },
  }

  async function reloadSettings(options?: { readonly forceConnect?: boolean }): Promise<void> {
    const generation = ++reloadGeneration

    const runtimeSettings = await resolvedDependencies.readRuntimeBootstrapSettings(
      options?.forceConnect ?? false,
    )

    const nextServices = await createManagedRuntimeServices({
      runtimeSettings,
      missionStore: trackingMissionStore,
      startMissionAutosave: resolvedDependencies.startMissionAutosave,
      startTrackingRuntime: resolvedDependencies.startTrackingRuntime,
      createClient: createTauriTraccarClient,
      createPoller: (client, hooks) =>
        createPollingManager(client as TrackingPollerClient, {
          intervalMs: runtimeSettings.trackingPollIntervalMs,
          staleThresholdMs: 60 * 60 * 1000,
          maxBackoffMs: 60_000,
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
      createTrackingCache: createTauriTrackingCache,
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
