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
  readonly renderedLabelDrawingIds?: readonly string[]
}

/**
 * Returns the id of the text-label drawing grabbed by the pointer, or null when
 * no text label is grabbed. Rendered label hits are preferred because the
 * visible text can extend well beyond the anchor point.
 */
export function resolveDraggableTextLabelId(args: ResolveDraggableTextLabelArgs): string | null {
  const renderedLabelId = resolveRenderedTextLabelId(args.drawings, args.renderedLabelDrawingIds ?? [])
  if (renderedLabelId !== null) {
    return renderedLabelId
  }

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
    if (isPointInsideEstimatedLabelBounds(drawing, args.point, projected)) {
      return drawing.id
    }

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

/**
 * Resolves the first rendered text-label id that still exists in the drawing
 * collection.
 */
function resolveRenderedTextLabelId(
  drawings: readonly Drawing[],
  renderedLabelDrawingIds: readonly string[],
): string | null {
  for (const renderedId of renderedLabelDrawingIds) {
    const drawing = drawings.find((candidate) => (
      candidate.id === renderedId && candidate.type === 'text_label'
    ))
    if (drawing !== undefined) {
      return drawing.id
    }
  }

  return null
}

/**
 * Returns true when the pointer falls inside a conservative estimate of the
 * rendered text label bounds.
 */
function isPointInsideEstimatedLabelBounds(
  drawing: Drawing,
  point: ScreenPoint,
  anchor: ScreenPoint,
): boolean {
  const metrics = readTextLabelMetrics(drawing)
  if (metrics === null) {
    return false
  }

  const width = Math.max(TEXT_LABEL_GRAB_RADIUS_PX * 2, metrics.text.length * metrics.fontSize * 0.62)
  const height = Math.max(TEXT_LABEL_GRAB_RADIUS_PX, metrics.fontSize * 1.35)
  const padding = 8

  return (
    point.x >= anchor.x - width / 2 - padding &&
    point.x <= anchor.x + width / 2 + padding &&
    point.y >= anchor.y - height / 2 - padding &&
    point.y <= anchor.y + height / 2 + padding
  )
}

/**
 * Reads the visible text and font size used to estimate a text-label hit box.
 */
function readTextLabelMetrics(
  drawing: Drawing,
): { readonly text: string; readonly fontSize: number } | null {
  let metadata: { readonly text?: unknown; readonly fontSize?: unknown } | null = null

  try {
    metadata = JSON.parse(drawing.metadata_json ?? '{}') as {
      readonly text?: unknown
      readonly fontSize?: unknown
    }
  } catch {
    metadata = null
  }

  const text = typeof metadata?.text === 'string'
    ? metadata.text
    : drawing.label ?? drawing.name
  const fontSize = typeof metadata?.fontSize === 'number' && Number.isFinite(metadata.fontSize)
    ? metadata.fontSize
    : 14

  if (text.trim().length === 0) {
    return null
  }

  return { text, fontSize }
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
