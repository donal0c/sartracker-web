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
import { createElectronMissionStore } from '../../infrastructure/mission-store/electron-mission-store'
import { createElectronGpxImportSource } from '../../infrastructure/gpx-import-source/electron-gpx-import-source'
import { createTauriGpxImportSource } from '../../infrastructure/gpx-import-source/tauri-gpx-import-source'
import { electronMarkerAttachmentAdapter } from '../../infrastructure/marker-attachment-store/electron-marker-attachment-store'
import { noopMarkerAttachmentAdapter } from '../../infrastructure/marker-attachment-store/noop-marker-attachment-adapter'
import { tauriMarkerAttachmentAdapter } from '../../infrastructure/marker-attachment-store/tauri-marker-attachment-store'
import { createElectronTrackingCache } from '../../infrastructure/tracking-cache/electron-tracking-cache'
import { createTauriTrackingCache } from '../../infrastructure/tracking-cache/tauri-tracking-cache'
import { createElectronTraccarClient } from '../../infrastructure/traccar-http/electron-traccar-fetch'
import { createTauriTraccarClient } from '../../infrastructure/traccar-http/tauri-traccar-fetch'
import { loadRuntimeBootstrapSettings } from '../../infrastructure/settings-store/tauri-settings-store'
import { registerServiceWorker } from '../../lib/register-service-worker'
import { isTauriRuntimeAvailable } from '../../lib/tauri-runtime'
import { isElectronRuntimeAvailable, type DesktopRuntimeKind } from '../../lib/desktop-runtime'
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
  readonly isElectronRuntimeAvailable: () => boolean
  readonly createMissionStore: (runtimeKind: Exclude<DesktopRuntimeKind, 'browser'>) => MissionStore
  readonly readRuntimeBootstrapSettings: (
    forceConnect?: boolean,
  ) => Promise<{
    readonly autosaveEnabled: boolean
    readonly autosaveIntervalMs: number
    readonly trackingPollIntervalMs: number
    readonly trackingMinimumPollIntervalMs?: number
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
  isElectronRuntimeAvailable,
  createMissionStore: (runtimeKind) =>
    runtimeKind === 'electron' ? createElectronMissionStore() : createTauriMissionStore(),
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

  const runtimeKind = resolveOperationalRuntimeKind(resolvedDependencies)
  if (runtimeKind === null) {
    return null
  }

  const missionStore = resolvedDependencies.createMissionStore(runtimeKind)
  const trackingMissionStore = missionStore as MissionStore & TrackingRuntimeMissionStore
  const gpxImportSource =
    runtimeKind === 'electron' ? createElectronGpxImportSource() : createTauriGpxImportSource()
  const attachmentAdapter =
    runtimeKind === 'electron'
      ? electronMarkerAttachmentAdapter
      : runtimeKind === 'tauri'
        ? tauriMarkerAttachmentAdapter
        : noopMarkerAttachmentAdapter
  let activeServices = createNoopRuntimeServiceHandles()
  let reloadGeneration = 0

  const coreFeatureRuntimes = await resolvedDependencies.startCoreFeatureRuntimes({
    missionStore,
    attachmentAdapter,
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
      createClient:
        runtimeKind === 'electron' ? createElectronTraccarClient : createTauriTraccarClient,
      createPoller: (client, hooks) =>
        createPollingManager(client as TrackingPollerClient, {
          intervalMs: runtimeSettings.trackingPollIntervalMs,
          ...(runtimeSettings.trackingMinimumPollIntervalMs === undefined
            ? {}
            : { minimumIntervalMs: runtimeSettings.trackingMinimumPollIntervalMs }),
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
          getInitialBreadcrumbs: hooks.getInitialBreadcrumbs,
          onSnapshot: hooks.onSnapshot,
          onStatusChange: hooks.onStatusChange,
          onPollDiagnostic: hooks.onPollDiagnostic,
        }),
      createTrackingCache:
        runtimeKind === 'electron' ? createElectronTrackingCache : createTauriTrackingCache,
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

function resolveOperationalRuntimeKind(
  dependencies: Pick<
    StartAppRuntimeDependencies,
    'isTauriRuntimeAvailable' | 'isElectronRuntimeAvailable'
  >,
): Exclude<DesktopRuntimeKind, 'browser'> | null {
  if (dependencies.isElectronRuntimeAvailable()) {
    return 'electron'
  }

  if (dependencies.isTauriRuntimeAvailable()) {
    return 'tauri'
  }

  return null
}
