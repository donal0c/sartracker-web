import type { Drawing } from '../../infrastructure/mission-store/tauri-mission-store'

type ScreenPoint = {
  readonly x: number
  readonly y: number
}

type ProjectCoordinate = (coordinate: { readonly lng: number; readonly lat: number }) => ScreenPoint

/**
 * Pixel radius within which a pointer-down is treated as grabbing a text label.
 * Generous enough to grab the small text anchor without competing with nearby
 * drawings.
 */
const TEXT_LABEL_GRAB_RADIUS_PX = 22

/**
 * Pixel distance the pointer must travel before a grab is treated as a drag
 * rather than a click. Matches the map pan-suppression threshold feel.
 */
const TEXT_LABEL_DRAG_THRESHOLD_PX = 6

type ResolveDraggableTextLabelArgs = {
  readonly drawings: readonly Drawing[]
  readonly point: ScreenPoint
  readonly project: ProjectCoordinate
}

/**
 * Returns the id of the text-label drawing whose anchor is closest to the
 * pointer within the grab radius, or null when no text label is grabbed.
 */
export function resolveDraggableTextLabelId(args: ResolveDraggableTextLabelArgs): string | null {
  let nearestId: string | null = null
  let nearestDistanceSq = TEXT_LABEL_GRAB_RADIUS_PX * TEXT_LABEL_GRAB_RADIUS_PX

  for (const drawing of args.drawings) {
    if (drawing.type !== 'text_label') {
      continue
    }

    const anchor = readAnchor(drawing.geometry_json)
    if (anchor === null) {
      continue
    }

    const projected = args.project({ lng: anchor[0], lat: anchor[1] })
    const dx = projected.x - args.point.x
    const dy = projected.y - args.point.y
    const distanceSq = dx * dx + dy * dy

    if (distanceSq <= nearestDistanceSq) {
      nearestId = drawing.id
      nearestDistanceSq = distanceSq
    }
  }

  return nearestId
}

type TextLabelDragState = {
  readonly drawingId: string
  readonly recordMove: (point: ScreenPoint) => void
  readonly hasMoved: () => boolean
}

/**
 * Creates a small drag state machine tracking whether the pointer has moved far
 * enough from its grab origin to count as a drag.
 */
export function createTextLabelDragState(
  drawingId: string,
  origin: ScreenPoint,
  thresholdPx = TEXT_LABEL_DRAG_THRESHOLD_PX,
): TextLabelDragState {
  let moved = false

  return {
    drawingId,
    recordMove: (point) => {
      if (moved) {
        return
      }
      const dx = point.x - origin.x
      const dy = point.y - origin.y
      if (Math.hypot(dx, dy) >= thresholdPx) {
        moved = true
      }
    },
    hasMoved: () => moved,
  }
}

function readAnchor(geometryJson: string): readonly [number, number] | null {
  try {
    const parsed = JSON.parse(geometryJson) as {
      readonly type?: string
      readonly coordinates?: unknown
    }
    if (parsed.type !== 'Point' || !Array.isArray(parsed.coordinates)) {
      return null
    }
    const [lon, lat] = parsed.coordinates
    if (typeof lon !== 'number' || typeof lat !== 'number') {
      return null
    }
    return [lon, lat]
  } catch {
    return null
  }
}
