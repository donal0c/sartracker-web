import type { Drawing } from '../../../infrastructure/mission-store/tauri-mission-store'
import { formatDistance, geodesicCirclePoints } from '../drawing-math'
import {
  LPB_CATEGORIES,
  LPB_PERCENTILE_ORDER,
  LPB_RING_COLORS,
  type LpbCategoryId,
} from '../lpb-data'
import type { RangeRingDrawingDraft } from '../drawing-types'
import {
  assertValidName,
  normalizeOptionalText,
  parsePersistedDrawing,
  parseRequiredPositiveInteger,
  parseRequiredPositiveNumber,
  toMutableCoordinate,
} from './shared'

/**
 * Builds the persisted payload for a range-ring drawing draft.
 */
export function buildRangeRingDrawingInput(
  missionId: string,
  displayOrder: number,
  draft: RangeRingDrawingDraft,
) {
  assertValidName(draft.name)
  const ringSpec =
    draft.mode === 'lpb'
      ? buildLpbRingSpec(draft.lpbCategory)
      : buildManualRingSpec(draft.manualRadiusM, draft.manualRingCount)
  const coordinates = ringSpec.radiiM.map((radiusM) => [
    geodesicCirclePoints(draft.center[0], draft.center[1], radiusM).map(toMutableCoordinate),
  ])

  return {
    id: draft.id,
    mission_id: missionId,
    type: 'range_ring' as const,
    name: draft.name.trim(),
    description: normalizeOptionalText(draft.description),
    display_order: displayOrder,
    geometry_json: JSON.stringify({
      type: 'MultiPolygon',
      coordinates,
    } satisfies GeoJSON.MultiPolygon),
    metadata_json: JSON.stringify({
      kind: 'range_ring',
      mode: draft.mode,
      radiiM: ringSpec.radiiM,
      colors: ringSpec.colors,
      labels: ringSpec.labels,
      center: draft.center,
      lpbCategory: draft.mode === 'lpb' ? draft.lpbCategory : null,
    }),
    label: draft.name.trim(),
  }
}

/**
 * Creates an editable range-ring draft from a persisted drawing.
 */
export function createRangeRingDraftFromDrawing(
  drawing: Drawing,
): RangeRingDrawingDraft {
  const parsed = parsePersistedDrawing(drawing)
  const metadata = parsed.metadata?.kind === 'range_ring' ? parsed.metadata : null

  return {
    id: parsed.id,
    type: 'range_ring',
    name: parsed.name,
    description: parsed.description ?? '',
    center: metadata?.center ?? [0, 0],
    mode: metadata?.mode ?? 'manual',
    manualRadiusM: metadata?.radiiM[0]?.toString() ?? '500',
    manualRingCount: metadata?.radiiM.length.toString() ?? '3',
    lpbCategory: metadata?.lpbCategory ?? 'hiker',
  }
}

function buildManualRingSpec(radiusInput: string, countInput: string) {
  const radiusM = parseRequiredPositiveNumber(radiusInput, 'Radius')
  const ringCount = parseRequiredPositiveInteger(countInput, 'Ring count')
  const radiiM = Array.from({ length: ringCount }, (_, index) => radiusM * (index + 1))

  return {
    radiiM,
    colors: radiiM.map(() => '#38BDF8'),
    labels: radiiM.map((distance) => formatDistance(distance)),
  }
}

function buildLpbRingSpec(categoryId: LpbCategoryId) {
  const category = LPB_CATEGORIES[categoryId]
  return {
    radiiM: LPB_PERCENTILE_ORDER.map((percentile) => category.distances[percentile]),
    colors: LPB_PERCENTILE_ORDER.map((percentile) => LPB_RING_COLORS[percentile]),
    labels: LPB_PERCENTILE_ORDER.map((percentile) => `${percentile.slice(1)}%`),
  }
}
