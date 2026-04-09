import {
  DRAWING_FILL_HITBOX_LAYER_ID,
  DRAWING_FILL_LAYER_ID,
  DRAWING_LABEL_LAYER_ID,
  DRAWING_LINE_HITBOX_LAYER_ID,
  DRAWING_LINE_LAYER_ID,
  DRAWING_POINT_LAYER_ID,
} from '../drawings/sync-drawing-overlay'
import {
  isPointInsideMapContainer,
  shouldIgnoreMapInteraction,
} from './map-interaction-guards'

export function shouldIgnoreDrawingMapClick(
  currentMissionId: string | null,
  missionPhase: 'idle' | 'active' | 'paused' | 'recovery',
  target: EventTarget | null,
): boolean {
  return shouldIgnoreMapInteraction({
    currentMissionId,
    missionPhase,
    target,
    interactiveSelector: 'button, input, select, label, textarea, a',
  })
}

export function getInteractiveDrawingLayerIds(hasLayer: (layerId: string) => boolean): string[] {
  return [
    DRAWING_FILL_HITBOX_LAYER_ID,
    DRAWING_LINE_HITBOX_LAYER_ID,
    DRAWING_FILL_LAYER_ID,
    DRAWING_LINE_LAYER_ID,
    DRAWING_POINT_LAYER_ID,
    DRAWING_LABEL_LAYER_ID,
  ].filter(hasLayer)
}

export function resolveClickedDrawingId(renderedDrawingId: unknown): string | null {
  return typeof renderedDrawingId === 'string' ? renderedDrawingId : null
}

export { isPointInsideMapContainer }
