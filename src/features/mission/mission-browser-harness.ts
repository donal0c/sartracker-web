import type {
  MissionStore,
} from '../../infrastructure/mission-store/tauri-mission-store'
import { applyDrawingController, applyDrawingRuntime } from '../drawings/drawing-store'
import { startDrawingRuntime } from '../drawings/start-drawing-runtime'
import { getBrowserHarnessStore } from '../browser-validation/browser-harness-store'
import { applyGpxController, applyGpxRuntime } from '../gpx/gpx-store'
import { startGpxRuntime } from '../gpx/start-gpx-runtime'
import { ingestMarkerAttachment } from '../../infrastructure/marker-attachment-store/tauri-marker-attachment-store'
import {
  hydrateTrackingFromBrowserHarness,
  installBrowserHarnessApi,
} from '../browser-validation/browser-harness-api'
import { applyMarkerController, applyMarkerRuntime } from '../markers/marker-store'
import { startMarkerRuntime } from '../markers/start-marker-runtime'
import {
  applyMissionGovernanceController,
  applyMissionGovernanceRuntime,
  applyMissionRuntime,
  applyMissionRuntimeController,
  useMissionStore,
} from './mission-store'
import { startMissionGovernanceRuntime } from './start-mission-governance-runtime'
import { startMissionRuntime } from './start-mission-runtime'
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
 */
export async function startMissionBrowserHarness(): Promise<void> {
  if (typeof window === 'undefined') {
    return
  }

  installBrowserHarnessApi()

  const browserStore = getBrowserHarnessStore() as Pick<
    MissionStore,
    | 'createMission'
    | 'listMissions'
    | 'getActiveMission'
    | 'getRecoverableMission'
    | 'pauseMission'
    | 'resumeMission'
    | 'finishMission'
    | 'finalizeMission'
    | 'unlockFinalizedMission'
    | 'listDevices'
    | 'upsertDevice'
    | 'addPosition'
    | 'listPositions'
    | 'listMarkers'
    | 'upsertMarker'
    | 'deleteMarker'
    | 'listDrawings'
    | 'upsertDrawing'
    | 'deleteDrawing'
    | 'listGpxImports'
    | 'upsertGpxImport'
    | 'deleteGpxImport'
  >
  const controller = await startMissionRuntime({
    missionStore: browserStore,
    applyRuntime: applyMissionRuntime,
    now: () => new Date(),
  })

  applyMissionRuntimeController(controller)
  const governanceController = await startMissionGovernanceRuntime({
    missionStore: browserStore,
    applyRuntime: applyMissionGovernanceRuntime,
  })
  applyMissionGovernanceController(governanceController)
  const markerController = await startMarkerRuntime({
    markerStore: browserStore,
    attachmentStore: {
      ingest: ingestMarkerAttachment,
    },
    applyRuntime: applyMarkerRuntime,
  })
  applyMarkerController(markerController)
  const drawingController = await startDrawingRuntime({
    drawingStore: browserStore,
    applyRuntime: applyDrawingRuntime,
  })
  applyDrawingController(drawingController)
  const gpxController = await startGpxRuntime({
    gpxStore: browserStore,
    applyRuntime: applyGpxRuntime,
  })
  applyGpxController(gpxController)

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
