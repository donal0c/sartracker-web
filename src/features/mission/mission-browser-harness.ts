import { noopMarkerAttachmentAdapter } from '../../infrastructure/marker-attachment-store/noop-marker-attachment-adapter'
import { loadRuntimeBootstrapSettings } from '../../infrastructure/settings-store/tauri-settings-store'
import { getBrowserHarnessStore } from '../browser-validation/browser-harness-store'
import {
  hydrateTrackingFromBrowserHarness,
  installBrowserHarnessApi,
} from '../browser-validation/browser-harness-api'
import { startCoreFeatureRuntimes } from '../runtime/start-core-feature-runtimes'
import { applyAppRuntimeController } from '../runtime/app-runtime-controller'
import { useMissionStore } from './mission-store'
import { isTauriRuntimeAvailable } from '../../lib/tauri-runtime'
import { readTrackingRuntimeConfig } from '../tracking/tracking-runtime-config'
import { createTraccarClient } from '../tracking/traccar-client'
import {
  createPollingManager,
  type TrackingPollerClient,
} from '../tracking/polling-manager'
import { startTrackingRuntime } from '../tracking/start-tracking-runtime'
import { applyTrackingSnapshot, applyTrackingStatus } from '../tracking/tracking-store'

type BrowserHarnessContext = {
  readonly search: string
  readonly dev: boolean
  readonly tauriAvailable: boolean
}

/**
 * Evaluates whether a browser harness should run for a concrete runtime
 * context. Hosted browser builds may opt in with `?missionHarness=1`; Tauri
 * production builds must never be forced into the harness by a query string.
 */
export function shouldEnableMissionBrowserHarnessForContext(
  context: BrowserHarnessContext,
): boolean {
  if (new URLSearchParams(context.search).get('missionHarness') !== '1') {
    return false
  }

  return context.dev || !context.tauriAvailable
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
    const trackingConfig = runtimeSettings.trackingConfig ?? envTrackingConfig
    const stopTracking = await startTrackingRuntime({
      config: trackingConfig,
      createClient: createTraccarClient,
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
      cache: { read: async () => null, write: async (contents: string) => contents },
      missionStore: browserStore,
      applySnapshot: applyTrackingSnapshot,
      applyStatus: applyTrackingStatus,
    })

    if (generation !== reloadGeneration) {
      stopTracking()
      return
    }

    const previousTrackingStop = activeTrackingStop
    activeTrackingStop = stopTracking
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
