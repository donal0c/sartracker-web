import { noopMarkerAttachmentAdapter } from '../../infrastructure/marker-attachment-store/noop-marker-attachment-adapter'
import { getBrowserHarnessStore } from '../browser-validation/browser-harness-store'
import {
  hydrateTrackingFromBrowserHarness,
  installBrowserHarnessApi,
} from '../browser-validation/browser-harness-api'
import { startCoreFeatureRuntimes } from '../runtime/start-core-feature-runtimes'
import { useMissionStore } from './mission-store'
import { readTrackingRuntimeConfig } from '../tracking/tracking-runtime-config'
import { createTraccarClient } from '../tracking/traccar-client'
import {
  createPollingManager,
  type TrackingPollerClient,
} from '../tracking/polling-manager'
import { startTrackingRuntime } from '../tracking/start-tracking-runtime'
import { applyTrackingSnapshot, applyTrackingStatus } from '../tracking/tracking-store'

/**
 * Returns whether the browser mission harness should be enabled for validation.
 */
export function shouldEnableMissionBrowserHarness(): boolean {
  if (!import.meta.env.DEV || typeof window === 'undefined') {
    return false
  }

  return new URLSearchParams(window.location.search).get('missionHarness') === '1'
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

  // If Traccar env vars are present, start real HTTP polling against the mock/live server
  const trackingConfig = readTrackingRuntimeConfig()
  if (trackingConfig !== null && shouldEnableBrowserHarnessLiveTracking()) {
    console.log('[browser-harness] Starting real tracking polling against', trackingConfig.baseUrl)
    await startTrackingRuntime({
      config: trackingConfig,
      createClient: createTraccarClient,
      createPoller: (client, hooks) =>
        createPollingManager(client as TrackingPollerClient, {
          intervalMs: 10_000,
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
          ...hooks,
        }),
      cache: { read: async () => null, write: async (c: string) => c },
      missionStore: browserStore,
      applySnapshot: applyTrackingSnapshot,
      applyStatus: applyTrackingStatus,
    })
  }
}
