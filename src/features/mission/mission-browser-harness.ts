import type {
  MissionStore,
} from '../../infrastructure/mission-store/tauri-mission-store'
import { applyDrawingController, applyDrawingRuntime } from '../drawings/drawing-store'
import { startDrawingRuntime } from '../drawings/start-drawing-runtime'
import { getBrowserHarnessStore } from '../browser-validation/browser-harness-store'
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
} from './mission-store'
import { startMissionGovernanceRuntime } from './start-mission-governance-runtime'
import { startMissionRuntime } from './start-mission-runtime'

/**
 * Returns whether the browser mission harness should be enabled for validation.
 */
export function shouldEnableMissionBrowserHarness(): boolean {
  if (!import.meta.env.DEV || typeof window === 'undefined') {
    return false
  }

  return new URLSearchParams(window.location.search).get('missionHarness') === '1'
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
    applyRuntime: applyMarkerRuntime,
  })
  applyMarkerController(markerController)
  const drawingController = await startDrawingRuntime({
    drawingStore: browserStore,
    applyRuntime: applyDrawingRuntime,
  })
  applyDrawingController(drawingController)

  await hydrateTrackingFromBrowserHarness()
}
