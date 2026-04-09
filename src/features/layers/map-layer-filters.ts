import type { ExpressionSpecification } from 'maplibre-gl'

import type {
  Drawing,
  DrawingType,
  MarkerType,
} from '../../infrastructure/mission-store/tauri-mission-store'

export function buildTrackingLayerFilter(
  hiddenDeviceIds: readonly string[],
): ExpressionSpecification | null {
  if (hiddenDeviceIds.length === 0) {
    return null
  }

  return ['!', ['in', ['get', 'deviceId'], ['literal', [...hiddenDeviceIds]]]]
}

export function buildMarkerLayerFilter(
  markerType: MarkerType,
  visible: boolean,
): ExpressionSpecification {
  if (!visible) {
    return ['==', ['get', 'markerId'], '__hidden__']
  }

  return ['==', ['get', 'markerType'], markerType]
}

export function buildDrawingVisibilitySummary(
  drawings: readonly Drawing[],
  drawingTypeVisibility: Record<DrawingType, boolean>,
  hiddenDrawingIds: readonly string[],
): {
  readonly visibleCount: number
  readonly totalCount: number
} {
  const visibleCount = drawings.filter(
    (drawing) => drawingTypeVisibility[drawing.type] && !hiddenDrawingIds.includes(drawing.id),
  ).length

  return {
    visibleCount,
    totalCount: drawings.length,
  }
}
