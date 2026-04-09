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

export function buildDrawingLayerFilter(
  drawingTypeVisibility: Record<DrawingType, boolean>,
  hiddenDrawingIds: readonly string[],
  featureKind: 'geometry' | 'label',
): ExpressionSpecification | null {
  const visibleTypes = (Object.entries(drawingTypeVisibility) as [DrawingType, boolean][])
    .filter(([, visible]) => visible)
    .map(([type]) => type)

  if (visibleTypes.length === 0) {
    return ['==', ['get', 'drawingId'], '__hidden__']
  }

  const filters: ExpressionSpecification[] = [
    ['==', ['get', 'featureKind'], featureKind],
    ['in', ['get', 'drawingType'], ['literal', visibleTypes]],
  ]

  if (hiddenDrawingIds.length > 0) {
    filters.push(['!', ['in', ['get', 'drawingId'], ['literal', [...hiddenDrawingIds]]]])
  }

  return filters.length === 1 ? filters[0]! : ['all', ...filters]
}
