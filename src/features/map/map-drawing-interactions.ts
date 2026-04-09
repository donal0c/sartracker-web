import {
  DRAWING_FILL_HITBOX_LAYER_ID,
  DRAWING_FILL_LAYER_ID,
  DRAWING_LABEL_LAYER_ID,
  DRAWING_LINE_HITBOX_LAYER_ID,
  DRAWING_LINE_LAYER_ID,
  DRAWING_POINT_LAYER_ID,
} from '../drawings/sync-drawing-overlay'

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

export function shouldIgnoreDrawingMapClick(
  currentMissionId: string | null,
  missionPhase: 'idle' | 'active' | 'paused' | 'recovery',
  target: EventTarget | null,
): boolean {
  if (currentMissionId === null || missionPhase === 'recovery') {
    return true
  }

  return (
    target instanceof HTMLElement &&
    target.closest('button, input, select, label, textarea, a') !== null
  )
}

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
