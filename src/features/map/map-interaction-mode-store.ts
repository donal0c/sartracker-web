import type { DrawingDialogState, DrawingSketchState, DrawingTool } from '../drawings/drawing-types'
import type { MarkerDialogState } from '../markers/marker-store'
import type { MeasurementMode } from '../measurements/measurement-types'

/**
 * The effective interaction mode for the live map surface.
 *
 * Priority (highest first): drawing_sketching > drawing_dialog >
 * marker_dialog > drawing_tool_armed > measurement_armed > idle.
 *
 * Each map interaction hook reads this single value instead of
 * cross-reading multiple feature stores.
 */
export type MapInteractionMode =
  | 'idle'
  | 'marker_dialog'
  | 'drawing_tool_armed'
  | 'drawing_sketching'
  | 'drawing_dialog'
  | 'measurement_armed'

export type MapInteractionModeInputs = {
  readonly drawingActiveTool: DrawingTool
  readonly drawingDialog: DrawingDialogState | null
  readonly drawingSketch: DrawingSketchState
  readonly measurementMode: MeasurementMode
  readonly markerDialog: MarkerDialogState | null
}

/**
 * Computes the current effective interaction mode from the individual
 * feature store states. This is a pure function — the single place
 * where all cross-feature interaction priority is resolved.
 */
export function computeMapInteractionMode(
  inputs: MapInteractionModeInputs,
): MapInteractionMode {
  if (inputs.drawingSketch !== null) {
    return 'drawing_sketching'
  }

  if (inputs.drawingDialog !== null) {
    return 'drawing_dialog'
  }

  if (inputs.markerDialog !== null) {
    return 'marker_dialog'
  }

  if (inputs.drawingActiveTool !== 'select') {
    return 'drawing_tool_armed'
  }

  if (inputs.measurementMode === 'armed') {
    return 'measurement_armed'
  }

  return 'idle'
}
