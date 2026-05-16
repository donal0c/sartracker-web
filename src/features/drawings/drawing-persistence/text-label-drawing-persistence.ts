import type { Drawing } from '../../../infrastructure/mission-store/tauri-mission-store'
import type { TextLabelDrawingDraft } from '../drawing-types'
import {
  parsePersistedDrawing,
  normalizeHexColor,
  parseRequiredBearing,
  parseRequiredPositiveInteger,
  toLonLat,
} from './shared'

/**
 * Builds the persisted payload for a text-label drawing draft.
 */
export function buildTextLabelDrawingInput(
  missionId: string,
  displayOrder: number,
  draft: TextLabelDrawingDraft,
) {
  const text = draft.text.trim()
  if (text === '') {
    throw new Error('Label text is required.')
  }
  if (text.length > 255) {
    throw new Error('Label text must be 255 characters or fewer.')
  }

  const fontSize = parseRequiredPositiveInteger(draft.fontSize, 'Font size')
  const rotation = parseRequiredBearing(draft.rotation, 'Rotation')
  const color = normalizeHexColor(draft.color, 'Label color')

  return {
    id: draft.id,
    mission_id: missionId,
    type: 'text_label' as const,
    name: text,
    description: null,
    color,
    width: null,
    display_order: displayOrder,
    geometry_json: JSON.stringify({
      type: 'Point',
      coordinates: [draft.point[0], draft.point[1]],
    } satisfies GeoJSON.Point),
    metadata_json: JSON.stringify({
      kind: 'text_label',
      text,
      fontSize,
      color,
      rotation,
      point: draft.point,
    }),
    distance_m: null,
    temporary_measure: null,
    label: text,
  }
}

/**
 * Creates an editable text-label draft from a persisted drawing.
 */
export function createTextLabelDraftFromDrawing(drawing: Drawing): TextLabelDrawingDraft {
  const parsed = parsePersistedDrawing(drawing)
  const geometry = parsed.parsedGeometry as GeoJSON.Point
  const metadata = parsed.metadata?.kind === 'text_label' ? parsed.metadata : null

  return {
    id: parsed.id,
    type: 'text_label',
    text: metadata?.text ?? parsed.label ?? parsed.name,
    fontSize: (metadata?.fontSize ?? 12).toString(),
    color: metadata?.color ?? parsed.color ?? '#FAFAF9',
    rotation: (metadata?.rotation ?? 0).toString(),
    point: metadata?.point ?? toLonLat(geometry.coordinates),
  }
}
