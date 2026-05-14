import type { MissionStore } from '../../infrastructure/mission-store/tauri-mission-store'
import type { MarkerAttachmentBoundary } from '../../infrastructure/marker-attachment-store/marker-attachment-boundary'
import {
  applyDrawingController,
  applyDrawingRuntime,
} from '../drawings/drawing-store'
import { startDrawingRuntime } from '../drawings/start-drawing-runtime'
import { applyGpxController, applyGpxRuntime } from '../gpx/gpx-store'
import {
  startGpxRuntime,
  type GpxImportFileInput,
} from '../gpx/start-gpx-runtime'
import {
  applyHelicopterController,
  applyHelicopterRuntime,
} from '../helicopters/helicopter-store'
import { startHelicopterRuntime } from '../helicopters/start-helicopter-runtime'
import { applyMarkerController, applyMarkerRuntime } from '../markers/marker-store'
import { startMarkerRuntime } from '../markers/start-marker-runtime'
import {
  applyMissionGovernanceController,
  applyMissionGovernanceRuntime,
  applyMissionRuntime,
  applyMissionRuntimeController,
} from '../mission/mission-store'
import { startMissionGovernanceRuntime } from '../mission/start-mission-governance-runtime'
import { startMissionRuntime } from '../mission/start-mission-runtime'

/**
 * Mission store surface required by the six core feature runtimes. Derived
 * from the union of all feature controllers' Pick<> requirements so callers
 * can supply either the real Tauri store or a browser-harness store without
 * widening any individual controller's contract.
 */
export type CoreFeatureRuntimeMissionStore = Pick<
  MissionStore,
  | 'createMission'
  | 'listMissions'
  | 'getRecoverableMission'
  | 'pauseMission'
  | 'resumeMission'
  | 'finishMission'
  | 'finalizeMission'
  | 'unlockFinalizedMission'
  | 'listMarkers'
  | 'upsertMarker'
  | 'deleteMarker'
  | 'listDrawings'
  | 'upsertDrawing'
  | 'deleteDrawing'
  | 'listHelicopters'
  | 'upsertHelicopter'
  | 'deleteHelicopter'
  | 'listGpxImports'
  | 'upsertGpxImport'
  | 'deleteGpxImport'
>

export type GpxWatchSource = {
  readonly listDirectoryFiles: (
    directoryPath: string,
  ) => Promise<readonly GpxImportFileInput[]>
}

export type CoreFeatureRuntimeOptions = {
  readonly missionStore: CoreFeatureRuntimeMissionStore
  readonly attachmentAdapter: MarkerAttachmentBoundary
  readonly gpxWatchSource?: GpxWatchSource
  readonly now?: () => Date
  readonly startMissionRuntime?: typeof startMissionRuntime
  readonly startMissionGovernanceRuntime?: typeof startMissionGovernanceRuntime
  readonly startMarkerRuntime?: typeof startMarkerRuntime
  readonly startDrawingRuntime?: typeof startDrawingRuntime
  readonly startHelicopterRuntime?: typeof startHelicopterRuntime
  readonly startGpxRuntime?: typeof startGpxRuntime
}

export type CoreFeatureRuntimeHandles = {
  readonly missionRuntimeController: Awaited<ReturnType<typeof startMissionRuntime>>
  readonly missionGovernanceController: Awaited<
    ReturnType<typeof startMissionGovernanceRuntime>
  >
  readonly markerRuntimeController: Awaited<ReturnType<typeof startMarkerRuntime>>
  readonly drawingRuntimeController: Awaited<ReturnType<typeof startDrawingRuntime>>
  readonly helicopterRuntimeController: Awaited<
    ReturnType<typeof startHelicopterRuntime>
  >
  readonly gpxRuntimeController: Awaited<ReturnType<typeof startGpxRuntime>>
  readonly dispose: () => void
}

/**
 * Wires the six core feature runtimes — mission, mission governance, marker,
 * drawing, helicopter, GPX — and registers their controllers with the global
 * stores. The registration order encodes initialization dependencies and must
 * not change without coordinated review.
 *
 * Both `startAppRuntime` (production) and `startMissionBrowserHarness`
 * (browser-harness mode) delegate here so a new feature controller cannot be
 * added in only one of the two paths.
 */
export async function startCoreFeatureRuntimes(
  options: CoreFeatureRuntimeOptions,
): Promise<CoreFeatureRuntimeHandles> {
  const startMission = options.startMissionRuntime ?? startMissionRuntime
  const startGovernance =
    options.startMissionGovernanceRuntime ?? startMissionGovernanceRuntime
  const startMarker = options.startMarkerRuntime ?? startMarkerRuntime
  const startDrawing = options.startDrawingRuntime ?? startDrawingRuntime
  const startHelicopter = options.startHelicopterRuntime ?? startHelicopterRuntime
  const startGpx = options.startGpxRuntime ?? startGpxRuntime

  // The six per-feature cleanups are pushed in registration order. The disposer
  // walks them in reverse so callers can safely reset wiring without having to
  // know the registration order. Today none of the six controllers expose a
  // cleanup hook; the seam exists so future runtimes can plug one in without
  // changing the boot contract.
  const cleanups: (() => void)[] = []

  const missionRuntimeController = await startMission({
    missionStore: options.missionStore,
    applyRuntime: applyMissionRuntime,
    ...(options.now !== undefined ? { now: options.now } : {}),
  })
  applyMissionRuntimeController(missionRuntimeController)
  cleanups.push(() => undefined)

  const missionGovernanceController = await startGovernance({
    missionStore: options.missionStore,
    applyRuntime: applyMissionGovernanceRuntime,
  })
  applyMissionGovernanceController(missionGovernanceController)
  cleanups.push(() => undefined)

  const markerRuntimeController = await startMarker({
    markerStore: options.missionStore,
    attachmentStore: options.attachmentAdapter,
    applyRuntime: applyMarkerRuntime,
  })
  applyMarkerController(markerRuntimeController)
  cleanups.push(() => undefined)

  const drawingRuntimeController = await startDrawing({
    drawingStore: options.missionStore,
    applyRuntime: applyDrawingRuntime,
  })
  applyDrawingController(drawingRuntimeController)
  cleanups.push(() => undefined)

  const helicopterRuntimeController = await startHelicopter({
    helicopterStore: options.missionStore,
    applyRuntime: applyHelicopterRuntime,
  })
  applyHelicopterController(helicopterRuntimeController)
  cleanups.push(() => undefined)

  const gpxRuntimeController = await startGpx({
    gpxStore: options.missionStore,
    applyRuntime: applyGpxRuntime,
    ...(options.gpxWatchSource !== undefined
      ? { watchSource: options.gpxWatchSource }
      : {}),
  })
  applyGpxController(gpxRuntimeController)
  cleanups.push(() => undefined)

  return {
    missionRuntimeController,
    missionGovernanceController,
    markerRuntimeController,
    drawingRuntimeController,
    helicopterRuntimeController,
    gpxRuntimeController,
    dispose: () => {
      for (const cleanup of [...cleanups].reverse()) {
        cleanup()
      }
    },
  }
}
