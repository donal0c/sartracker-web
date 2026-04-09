import type { Drawing } from '../../../infrastructure/mission-store/tauri-mission-store'
import {
  formatDistance,
  geodesicBearingEndpoint,
  magneticToTrue,
  trueToMagnetic,
} from '../drawing-math'
import type { BearingLineDrawingDraft } from '../drawing-types'
import {
  assertValidName,
  normalizeOptionalText,
  parsePersistedDrawing,
  parseRequiredPositiveNumber,
} from './shared'

/**
 * Builds the persisted payload for a bearing-line drawing draft.
 */
export function buildBearingLineDrawingInput(
  missionId: string,
  displayOrder: number,
  draft: BearingLineDrawingDraft,
) {
  assertValidName(draft.name)
  const inputBearing = parseRequiredPositiveNumber(draft.inputBearing, 'Bearing')
  const distanceM = parseRequiredPositiveNumber(draft.distanceM, 'Distance')
  const trueBearing =
    draft.inputBearingType === 'magnetic'
      ? magneticToTrue(inputBearing)
      : inputBearing
  const [endLon, endLat] = geodesicBearingEndpoint(
    draft.origin[0],
    draft.origin[1],
    trueBearing,
    distanceM,
  )

  return {
    id: draft.id,
    mission_id: missionId,
    type: 'bearing_line' as const,
    name: draft.name.trim(),
    description: normalizeOptionalText(draft.description),
    display_order: displayOrder,
    geometry_json: JSON.stringify({
      type: 'LineString',
      coordinates: [
        [draft.origin[0], draft.origin[1]],
        [endLon, endLat],
      ],
    } satisfies GeoJSON.LineString),
    metadata_json: JSON.stringify({
      kind: 'bearing_line',
      trueBearing,
      inputBearingType: draft.inputBearingType,
      inputBearing,
      origin: draft.origin,
    }),
    distance_m: distanceM,
    label: `${formatDistance(distanceM)} @ ${trueBearing.toFixed(1)}°T / ${trueToMagnetic(trueBearing).toFixed(1)}°M`,
  }
}

/**
 * Creates an editable bearing-line draft from a persisted drawing.
 */
export function createBearingLineDraftFromDrawing(
  drawing: Drawing,
): BearingLineDrawingDraft {
  const parsed = parsePersistedDrawing(drawing)
  const metadata = parsed.metadata?.kind === 'bearing_line' ? parsed.metadata : null

  return {
    id: parsed.id,
    type: 'bearing_line',
    name: parsed.name,
    description: parsed.description ?? '',
    origin: metadata?.origin ?? [0, 0],
    inputBearingType: metadata?.inputBearingType ?? 'true',
    inputBearing: metadata?.inputBearing.toString() ?? '0',
    distanceM: parsed.distance_m?.toString() ?? '1000',
  }
}
