import type {
  MissionStore,
} from '../../infrastructure/mission-store/tauri-mission-store'
import { getBrowserHarnessStore } from '../browser-validation/browser-harness-store'
import { applyMarkerController, applyMarkerRuntime } from '../markers/marker-store'
import { startMarkerRuntime } from '../markers/start-marker-runtime'
import { applyMissionRuntime, applyMissionRuntimeController } from './mission-store'
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

  const browserStore = getBrowserHarnessStore() as Pick<
    MissionStore,
    | 'createMission'
    | 'listMissions'
    | 'getRecoverableMission'
    | 'pauseMission'
    | 'resumeMission'
    | 'finishMission'
    | 'listMarkers'
    | 'upsertMarker'
    | 'deleteMarker'
  >
  const controller = await startMissionRuntime({
    missionStore: browserStore,
    applyRuntime: applyMissionRuntime,
    now: () => new Date(),
  })

  applyMissionRuntimeController(controller)
  const markerController = await startMarkerRuntime({
    markerStore: browserStore,
    applyRuntime: applyMarkerRuntime,
  })
  applyMarkerController(markerController)
}
