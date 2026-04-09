import type { Drawing } from '../../../infrastructure/mission-store/tauri-mission-store'
import { geodesicSectorPoints } from '../drawing-math'
import type { SearchSectorDrawingDraft } from '../drawing-types'
import {
  assertValidName,
  normalizeOptionalText,
  parsePersistedDrawing,
  parseRequiredBearing,
  parseRequiredPositiveNumber,
  toMutableCoordinate,
} from './shared'

/**
 * Builds the persisted payload for a search-sector drawing draft.
 */
export function buildSearchSectorDrawingInput(
  missionId: string,
  displayOrder: number,
  draft: SearchSectorDrawingDraft,
) {
  assertValidName(draft.name)
  const startBearing = parseRequiredBearing(draft.startBearing, 'Start bearing')
  const endBearing = parseRequiredBearing(draft.endBearing, 'End bearing')
  const radiusM = parseRequiredPositiveNumber(draft.radiusM, 'Radius')
  const points = geodesicSectorPoints(
    draft.center[0],
    draft.center[1],
    startBearing,
    endBearing,
    radiusM,
  )

  return {
    id: draft.id,
    mission_id: missionId,
    type: 'search_sector' as const,
    name: draft.name.trim(),
    description: normalizeOptionalText(draft.description),
    display_order: displayOrder,
    geometry_json: JSON.stringify({
      type: 'Polygon',
      coordinates: [points.map(toMutableCoordinate)],
    } satisfies GeoJSON.Polygon),
    metadata_json: JSON.stringify({
      kind: 'search_sector',
      center: draft.center,
      startBearing,
      endBearing,
      radiusM,
    }),
    label: draft.name.trim(),
  }
}

/**
 * Creates an editable search-sector draft from a persisted drawing.
 */
export function createSearchSectorDraftFromDrawing(
  drawing: Drawing,
): SearchSectorDrawingDraft {
  const parsed = parsePersistedDrawing(drawing)
  const metadata = parsed.metadata?.kind === 'search_sector' ? parsed.metadata : null

  return {
    id: parsed.id,
    type: 'search_sector',
    name: parsed.name,
    description: parsed.description ?? '',
    center: metadata?.center ?? [0, 0],
    startBearing: metadata?.startBearing.toString() ?? '0',
    endBearing: metadata?.endBearing.toString() ?? '90',
    radiusM: metadata?.radiusM.toString() ?? '1000',
  }
}
