import {
  MARKER_HITBOX_LAYER_ID,
  MARKER_TYPES,
  getMarkerLabelLayerId,
  getMarkerSymbolLayerId,
} from '../markers/sync-marker-overlay'

type ScreenPoint = {
  readonly x: number
  readonly y: number
}

type ViewportBounds = {
  readonly left: number
  readonly right: number
  readonly top: number
  readonly bottom: number
}

/**
 * Returns whether a map click should be ignored before marker interaction logic runs.
 */
export function shouldIgnoreMarkerMapClick(
  currentMissionId: string | null,
  missionPhase: 'idle' | 'active' | 'paused' | 'recovery',
  target: EventTarget | null,
): boolean {
  if (currentMissionId === null || missionPhase === 'recovery') {
    return true
  }

  return target instanceof HTMLElement && target.closest('button, input, select, label, a') !== null
}

/**
 * Returns whether a screen point falls inside the current map container bounds.
 */
export function isPointInsideMapContainer(
  point: ScreenPoint,
  bounds: ViewportBounds,
): boolean {
  return !(
    point.x < bounds.left ||
    point.x > bounds.right ||
    point.y < bounds.top ||
    point.y > bounds.bottom
  )
}

/**
 * Builds the interactive marker layer list that can participate in hit testing.
 */
export function getInteractiveMarkerLayerIds(
  hasLayer: (layerId: string) => boolean,
): string[] {
  return [
    MARKER_HITBOX_LAYER_ID,
    ...MARKER_TYPES.flatMap((markerType) => [
      getMarkerSymbolLayerId(markerType),
      getMarkerLabelLayerId(markerType),
    ]),
  ].filter(hasLayer)
}

/**
 * Resolves the clicked marker id from rendered feature properties with a nearest-marker fallback.
 */
export function resolveClickedMarkerId(
  renderedMarkerId: unknown,
  nearestMarkerId: string | null,
): string | null {
  return typeof renderedMarkerId === 'string' ? renderedMarkerId : nearestMarkerId
}
