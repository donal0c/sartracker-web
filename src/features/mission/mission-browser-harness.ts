import { noopMarkerAttachmentAdapter } from '../../infrastructure/marker-attachment-store/noop-marker-attachment-adapter'
import { loadRuntimeBootstrapSettings } from '../../infrastructure/settings-store/tauri-settings-store'
import { createElectronTrackingCache } from '../../infrastructure/tracking-cache/electron-tracking-cache'
import { getBrowserHarnessStore } from '../browser-validation/browser-harness-store'
import {
  hydrateTrackingFromBrowserHarness,
  installBrowserHarnessApi,
} from '../browser-validation/browser-harness-api'
import { startCoreFeatureRuntimes } from '../runtime/start-core-feature-runtimes'
import { applyAppRuntimeController } from '../runtime/app-runtime-controller'
import { useMissionStore } from './mission-store'
import { isTauriRuntimeAvailable } from '../../lib/tauri-runtime'
import { isElectronRuntimeAvailable } from '../../lib/desktop-runtime'
import { readTrackingRuntimeConfig } from '../tracking/tracking-runtime-config'
import { createTraccarClient } from '../tracking/traccar-client'
import { createElectronTraccarClient } from '../../infrastructure/traccar-http/electron-traccar-fetch'
import {
  createPollingManager,
  type TrackingPollerClient,
} from '../tracking/polling-manager'
import { startTrackingRuntime } from '../tracking/start-tracking-runtime'
import { applyTrackingSnapshot, applyTrackingStatus } from '../tracking/tracking-store'
import { startMissionTrackingStatusBridge } from '../tracking/mission-tracking-status-bridge'
import { recordDiagnosticEvent } from '../diagnostics/diagnostic-event-log'

const BROWSER_HARNESS_MAX_PERSISTED_TRACKING_POSITIONS = 2_000
const LEAFLET_FALLBACK_SEED_MISSION_NAME = 'DON-27 Leaflet fallback surface'

type BrowserHarnessContext = {
  readonly search: string
  readonly dev: boolean
  readonly tauriAvailable: boolean
  readonly electronAvailable: boolean
}

/**
 * Evaluates whether a browser harness should run for a concrete runtime
 * context. Hosted browser builds may opt in with `?missionHarness=1`; packaged
 * desktop runtimes must never be forced into the harness by a query string.
 */
export function shouldEnableMissionBrowserHarnessForContext(
  context: BrowserHarnessContext,
): boolean {
  if (new URLSearchParams(context.search).get('missionHarness') !== '1') {
    return false
  }

  return context.dev || (!context.tauriAvailable && !context.electronAvailable)
}

/**
 * Returns whether the browser mission harness should be enabled for validation.
 */
export function shouldEnableMissionBrowserHarness(): boolean {
  if (typeof window === 'undefined') {
    return false
  }

  return shouldEnableMissionBrowserHarnessForContext({
    search: window.location.search,
    dev: import.meta.env.DEV,
    tauriAvailable: isTauriRuntimeAvailable(),
    electronAvailable: isElectronRuntimeAvailable(),
  })
}

function shouldEnableBrowserHarnessLiveTracking(): boolean {
  if (typeof window === 'undefined') {
    return false
  }

  return new URLSearchParams(window.location.search).get('liveTracking') === '1'
}

/**
 * Starts a browser-only mission runtime harness for headless validation.
 *
 * The harness deliberately omits autosave and settings-reload — both depend on
 * Tauri-backed adapters and are therefore production-only. The harness also
 * passes `gpxWatchSource: undefined`: GPX file watching requires a Tauri
 * filesystem and is intentionally not available in browser-harness mode.
 */
export async function startMissionBrowserHarness(): Promise<void> {
  if (typeof window === 'undefined') {
    return
  }

  installBrowserHarnessApi()

  const browserStore = getBrowserHarnessStore()
  await seedLeafletFallbackSurfaceIfRequested(browserStore)
  // Intentional: GPX file watching is not available in browser-harness mode, so
  // gpxWatchSource is omitted entirely (with exactOptionalPropertyTypes a
  // present-but-undefined property is rejected at the type boundary).
  await startCoreFeatureRuntimes({
    missionStore: browserStore,
    attachmentAdapter: noopMarkerAttachmentAdapter,
  })

  await hydrateTrackingFromBrowserHarness()

  let activeTrackingStop: () => void = () => undefined
  let reloadGeneration = 0
  let disposed = false

  const reloadSettings = async (options?: { readonly forceConnect?: boolean }) => {
    if (disposed) {
      throw new Error('Browser harness runtime has already been disposed.')
    }

    const generation = ++reloadGeneration
    const runtimeSettings = await loadRuntimeBootstrapSettings(options?.forceConnect ?? false)
    const envTrackingConfig =
      shouldEnableBrowserHarnessLiveTracking() ? readTrackingRuntimeConfig() : null
    const electronRuntime = isElectronRuntimeAvailable()
    const trackingConfig = runtimeSettings.trackingConfig ?? envTrackingConfig
    const stopTracking = await startTrackingRuntime({
      config: trackingConfig,
      createClient: electronRuntime ? createElectronTraccarClient : createTraccarClient,
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
          ...hooks,
        }),
      cache: electronRuntime
        ? createElectronTrackingCache()
        : { read: async () => null, write: async (contents: string) => contents },
      missionStore: browserStore,
      applySnapshot: applyTrackingSnapshot,
      applyStatus: applyTrackingStatus,
      recordDiagnosticEvent,
      maxPersistedPositionsPerSnapshot: BROWSER_HARNESS_MAX_PERSISTED_TRACKING_POSITIONS,
      writeCache: electronRuntime && runtimeSettings.trackingCacheEnabled,
      ...(runtimeSettings.trackingDisabledReason === undefined
        ? {}
        : { idleWarning: runtimeSettings.trackingDisabledReason }),
    })
    const stopTrackingStatusBridge = trackingConfig === null
      ? () => undefined
      : startMissionTrackingStatusBridge({
          applySnapshot: applyTrackingSnapshot,
          applyStatus: applyTrackingStatus,
        })

    if (generation !== reloadGeneration) {
      stopTracking()
      stopTrackingStatusBridge()
      return
    }

    const previousTrackingStop = activeTrackingStop
    activeTrackingStop = () => {
      stopTrackingStatusBridge()
      stopTracking()
    }
    previousTrackingStop()
  }

  applyAppRuntimeController({
    reloadSettings,
    dispose: () => {
      if (disposed) {
        return
      }

      disposed = true
      reloadGeneration += 1
      const previousTrackingStop = activeTrackingStop
      activeTrackingStop = () => undefined
      previousTrackingStop()
    },
  })

  await reloadSettings()
}

async function seedLeafletFallbackSurfaceIfRequested(
  browserStore: ReturnType<typeof getBrowserHarnessStore>,
): Promise<void> {
  if (new URLSearchParams(window.location.search).get('leafletFallbackSeed') !== '1') {
    return
  }

  const existingSeedMission = (await browserStore.listMissions()).find(
    (mission) => mission.name === LEAFLET_FALLBACK_SEED_MISSION_NAME,
  )
  if (existingSeedMission !== undefined) {
    return
  }

  const mission = await browserStore.createMission({
    name: LEAFLET_FALLBACK_SEED_MISSION_NAME,
    start_time: '2026-05-31T14:00:00.000Z',
  })

  await browserStore.upsertDevice({
    mission_id: mission.id,
    device_id: 'alpha',
    name: 'Alpha Team',
    color: '#38bdf8',
    status: 'online',
    last_seen: '2026-05-31T14:10:00.000Z',
  })
  await browserStore.addPosition({
    mission_id: mission.id,
    device_id: 'alpha',
    name: 'Alpha Team',
    lat: 51.9989,
    lon: -9.7444,
    speed: 3.1,
    battery: 83,
    timestamp: '2026-05-31T14:08:00.000Z',
  })
  await browserStore.addPosition({
    mission_id: mission.id,
    device_id: 'alpha',
    name: 'Alpha Team',
    lat: 51.99917,
    lon: -9.74406,
    speed: 3.5,
    battery: 82,
    timestamp: '2026-05-31T14:10:00.000Z',
  })
  await browserStore.upsertMarker({
    id: 'marker-lkp',
    mission_id: mission.id,
    type: 'ipp_lkp',
    name: 'LKP',
    lat: 51.9999,
    lon: -9.7434,
    irish_grid_e: 490000,
    irish_grid_n: 590000,
    display_order: 1,
  })
  await browserStore.upsertDrawing({
    id: 'drawing-sector-alpha',
    mission_id: mission.id,
    type: 'search_area',
    name: 'Sector Alpha',
    color: '#F59E0B',
    width: 2,
    label: 'Sector Alpha',
    display_order: 1,
    geometry_json: JSON.stringify({
      type: 'Polygon',
      coordinates: [[[-9.758, 51.992], [-9.738, 52.008], [-9.718, 51.992], [-9.758, 51.992]]],
    }),
    metadata_json: JSON.stringify({
      kind: 'search_area',
      team: null,
      status: 'Planned',
      poaPercent: null,
      terrain: null,
      notes: null,
      areaSqM: 100,
    }),
  })
}
