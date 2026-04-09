import {
  MARKER_HITBOX_LAYER_ID,
  MARKER_TYPES,
  getMarkerLabelLayerId,
  getMarkerSymbolLayerId,
} from '../markers/sync-marker-overlay'
import {
  isPointInsideMapContainer,
  shouldIgnoreMapInteraction,
} from './map-interaction-guards'

/**
 * Returns whether a map click should be ignored before marker interaction logic runs.
 */
export function shouldIgnoreMarkerMapClick(
  currentMissionId: string | null,
  missionPhase: 'idle' | 'active' | 'paused' | 'recovery',
  target: EventTarget | null,
): boolean {
  return shouldIgnoreMapInteraction({
    currentMissionId,
    missionPhase,
    target,
    interactiveSelector: 'button, input, select, label, a',
  })
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

export { isPointInsideMapContainer }
