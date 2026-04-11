import { useDrawingStore } from '../drawings/drawing-store'
import { useMarkerStore } from '../markers/marker-store'
import { useMeasurementStore } from '../measurements/measurement-store'
import { computeMapInteractionMode, type MapInteractionMode } from './map-interaction-mode-store'

/**
 * Returns the current effective map interaction mode.
 *
 * This is the single hook that resolves cross-feature interaction
 * priority. Individual interaction hooks read this instead of
 * reaching into each other's stores.
 */
export function useMapInteractionMode(): MapInteractionMode {
  const drawingActiveTool = useDrawingStore((state) => state.activeTool)
  const drawingDialog = useDrawingStore((state) => state.dialog)
  const drawingSketch = useDrawingStore((state) => state.sketch)
  const measurementMode = useMeasurementStore((state) => state.mode)
  const markerDialog = useMarkerStore((state) => state.dialog)

  return computeMapInteractionMode({
    drawingActiveTool,
    drawingDialog,
    drawingSketch,
    measurementMode,
    markerDialog,
  })
}
