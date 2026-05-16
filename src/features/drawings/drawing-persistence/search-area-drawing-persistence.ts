import type { Drawing } from '../../../infrastructure/mission-store/tauri-mission-store'
import { geodesicPolygonArea } from '../drawing-math'
import type { SearchAreaDrawingDraft } from '../drawing-types'
import {
  assertValidName,
  normalizeHexColor,
  normalizeOptionalNumber,
  normalizeOptionalText,
  parsePersistedDrawing,
  parseRequiredPositiveInteger,
  toLonLat,
  toMutableCoordinate,
} from './shared'

/**
 * Builds the persisted payload for a search-area drawing draft.
 */
export function buildSearchAreaDrawingInput(
  missionId: string,
  displayOrder: number,
  draft: SearchAreaDrawingDraft,
) {
  assertValidName(draft.name)
  const ring = closeRing(draft.points)
  const areaSqM = geodesicPolygonArea(ring)
  const labelFontSize = parseRequiredPositiveInteger(draft.labelFontSize, 'Search area label size')
  const fillColor = normalizeHexColor(draft.fillColor, 'Search area fill colour')

  return {
    id: draft.id,
    mission_id: missionId,
    type: 'search_area' as const,
    name: draft.name.trim(),
    description: normalizeOptionalText(draft.description),
    color: fillColor,
    display_order: displayOrder,
    geometry_json: JSON.stringify({
      type: 'Polygon',
      coordinates: [ring.map(toMutableCoordinate)],
    } satisfies GeoJSON.Polygon),
    metadata_json: JSON.stringify({
      kind: 'search_area',
      team: normalizeOptionalText(draft.team),
      status: draft.status,
      poaPercent: normalizeOptionalNumber(draft.poaPercent),
      terrain: normalizeOptionalText(draft.terrain),
      notes: normalizeOptionalText(draft.notes),
      areaSqM,
      labelFontSize,
      fillColor,
    }),
    label: draft.name.trim(),
  }
}

/**
 * Creates an editable search-area draft from a persisted drawing.
 */
export function createSearchAreaDraftFromDrawing(
  drawing: Drawing,
): SearchAreaDrawingDraft {
  const parsed = parsePersistedDrawing(drawing)
  const geometry = parsed.parsedGeometry as GeoJSON.Polygon
  const metadata = parsed.metadata?.kind === 'search_area' ? parsed.metadata : null
  const ring = geometry.coordinates[0] ?? []

  return {
    id: parsed.id,
    type: 'search_area',
    name: parsed.name,
    description: parsed.description ?? '',
    points: ring
      .slice(0, Math.max(0, ring.length - 1))
      .map((coordinate) => toLonLat(coordinate)),
    team: metadata?.team ?? '',
    status: metadata?.status ?? 'Planned',
    poaPercent: metadata?.poaPercent?.toString() ?? '',
    labelFontSize: (metadata?.labelFontSize ?? 12).toString(),
    fillColor: metadata?.fillColor ?? parsed.color ?? '#F59E0B',
    terrain: metadata?.terrain ?? '',
    notes: metadata?.notes ?? '',
  }
}

function closeRing(points: readonly (readonly [number, number])[]) {
  if (points.length < 3) {
    throw new Error('Search areas require at least three points.')
  }

  const first = points[0]!
  const last = points.at(-1) ?? first
  if (first[0] === last[0] && first[1] === last[1]) {
    return points
  }

  return [...points, first] as const
}
