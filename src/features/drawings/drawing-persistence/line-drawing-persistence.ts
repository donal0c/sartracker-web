import type { Drawing } from '../../../infrastructure/mission-store/tauri-mission-store'
import { formatDistance, geodesicDistance } from '../drawing-math'
import type { LineDrawingDraft } from '../drawing-types'
import {
  assertValidName,
  normalizeOptionalText,
  parsePersistedDrawing,
  toLonLat,
  toMutableCoordinate,
} from './shared'

/**
 * Builds the persisted payload for a line drawing draft.
 */
export function buildLineDrawingInput(
  missionId: string,
  displayOrder: number,
  draft: LineDrawingDraft,
) {
  assertValidName(draft.name)
  const coordinates = draft.points.map(toMutableCoordinate)
  const distanceM = totalDistance(draft.points)

  return {
    id: draft.id,
    mission_id: missionId,
    type: 'line' as const,
    name: draft.name.trim(),
    description: normalizeOptionalText(draft.description),
    display_order: displayOrder,
    geometry_json: JSON.stringify({
      type: 'LineString',
      coordinates,
    } satisfies GeoJSON.LineString),
    metadata_json: JSON.stringify({
      kind: 'line',
    }),
    distance_m: distanceM,
    label: formatDistance(distanceM),
  }
}

/**
 * Creates an editable line draft from a persisted drawing.
 */
export function createLineDraftFromDrawing(drawing: Drawing): LineDrawingDraft {
  const parsed = parsePersistedDrawing(drawing)
  const geometry = parsed.parsedGeometry as GeoJSON.LineString

  return {
    id: parsed.id,
    type: 'line',
    name: parsed.name,
    description: parsed.description ?? '',
    points: geometry.coordinates.map((coordinate) => toLonLat(coordinate)),
  }
}

function totalDistance(points: readonly (readonly [number, number])[]): number {
  if (points.length < 2) {
    throw new Error('Lines require at least two points.')
  }

  let distance = 0
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]!
    const next = points[index]!
    distance += geodesicDistance(previous[0], previous[1], next[0], next[1])
  }

  return distance
}
