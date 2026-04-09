import type { UpsertDrawingInput, Drawing } from '../../infrastructure/mission-store/tauri-mission-store'
import {
  formatDistance,
  geodesicBearingEndpoint,
  geodesicCirclePoints,
  geodesicDistance,
  geodesicPolygonArea,
  geodesicSectorPoints,
  magneticToTrue,
  trueToMagnetic,
} from './drawing-math'
import { LPB_CATEGORIES, LPB_PERCENTILE_ORDER, LPB_RING_COLORS, type LpbCategoryId } from './lpb-data'
import type {
  BearingLineDrawingDraft,
  DrawingDraft,
  DrawingMetadata,
  LineDrawingDraft,
  PersistedDrawing,
  RangeRingDrawingDraft,
  SearchAreaDrawingDraft,
  SearchSectorDrawingDraft,
} from './drawing-types'
import type { LonLat } from './drawing-math'

type BuildDrawingInputArgs = {
  readonly missionId: string
  readonly displayOrder: number
  readonly draft: DrawingDraft
}

export function buildDrawingInput({
  missionId,
  displayOrder,
  draft,
}: BuildDrawingInputArgs): UpsertDrawingInput {
  switch (draft.type) {
    case 'line':
      return buildLineInput(missionId, displayOrder, draft)
    case 'search_area':
      return buildSearchAreaInput(missionId, displayOrder, draft)
    case 'range_ring':
      return buildRangeRingInput(missionId, displayOrder, draft)
    case 'bearing_line':
      return buildBearingLineInput(missionId, displayOrder, draft)
    case 'search_sector':
      return buildSearchSectorInput(missionId, displayOrder, draft)
  }
}

export function parsePersistedDrawing(drawing: Drawing): PersistedDrawing {
  return {
    ...drawing,
    parsedGeometry: JSON.parse(drawing.geometry_json) as GeoJSON.Geometry,
    metadata:
      drawing.metadata_json === null ? null : (JSON.parse(drawing.metadata_json) as DrawingMetadata),
  }
}

export function createDraftFromDrawing(drawing: Drawing): DrawingDraft {
  const parsed = parsePersistedDrawing(drawing)

  switch (parsed.type) {
    case 'line': {
      const geometry = parsed.parsedGeometry as GeoJSON.LineString
      return {
        id: parsed.id,
        type: 'line',
        name: parsed.name,
        description: parsed.description ?? '',
        points: geometry.coordinates.map((coordinate) => toLonLat(coordinate)),
      }
    }
    case 'search_area': {
      const geometry = parsed.parsedGeometry as GeoJSON.Polygon
      const metadata = parsed.metadata?.kind === 'search_area' ? parsed.metadata : null
      const ring = geometry.coordinates[0] ?? []

      return {
        id: parsed.id,
        type: 'search_area',
        name: parsed.name,
        description: parsed.description ?? '',
        points: ring.slice(0, Math.max(0, ring.length - 1)).map((coordinate) => toLonLat(coordinate)),
        team: metadata?.team ?? '',
        status: metadata?.status ?? 'Planned',
        poaPercent: metadata?.poaPercent?.toString() ?? '',
        terrain: metadata?.terrain ?? '',
        notes: metadata?.notes ?? '',
      }
    }
    case 'range_ring': {
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
    case 'bearing_line': {
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
    case 'search_sector': {
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
    default:
      throw new Error(`Unsupported drawing type for editing: ${parsed.type}`)
  }
}

export function createLineDraft(points: readonly LonLat[]): LineDrawingDraft {
  return {
    id: null,
    type: 'line',
    name: '',
    description: '',
    points,
  }
}

export function createSearchAreaDraft(points: readonly LonLat[]): SearchAreaDrawingDraft {
  return {
    id: null,
    type: 'search_area',
    name: '',
    description: '',
    points,
    team: '',
    status: 'Planned',
    poaPercent: '',
    terrain: '',
    notes: '',
  }
}

export function createRangeRingDraft(center: LonLat): RangeRingDrawingDraft {
  return {
    id: null,
    type: 'range_ring',
    name: '',
    description: '',
    center,
    mode: 'manual',
    manualRadiusM: '500',
    manualRingCount: '3',
    lpbCategory: 'hiker',
  }
}

export function createBearingLineDraft(center: LonLat): BearingLineDrawingDraft {
  return {
    id: null,
    type: 'bearing_line',
    name: '',
    description: '',
    origin: center,
    inputBearingType: 'true',
    inputBearing: '0',
    distanceM: '1000',
  }
}

export function createSearchSectorDraft(center: LonLat): SearchSectorDrawingDraft {
  return {
    id: null,
    type: 'search_sector',
    name: '',
    description: '',
    center,
    startBearing: '0',
    endBearing: '90',
    radiusM: '1000',
  }
}

function buildLineInput(
  missionId: string,
  displayOrder: number,
  draft: LineDrawingDraft,
): UpsertDrawingInput {
  assertValidName(draft.name)
  const coordinates = draft.points.map(toMutableCoordinate)
  const distanceM = totalDistance(draft.points)

  return {
    id: draft.id,
    mission_id: missionId,
    type: 'line',
    name: draft.name.trim(),
    description: normalizeOptionalText(draft.description),
    display_order: displayOrder,
    geometry_json: JSON.stringify({
      type: 'LineString',
      coordinates,
    } satisfies GeoJSON.LineString),
    metadata_json: JSON.stringify({
      kind: 'line',
    } satisfies DrawingMetadata),
    distance_m: distanceM,
    label: formatDistance(distanceM),
  }
}

function buildSearchAreaInput(
  missionId: string,
  displayOrder: number,
  draft: SearchAreaDrawingDraft,
): UpsertDrawingInput {
  assertValidName(draft.name)
  const ring = closeRing(draft.points)
  const areaSqM = geodesicPolygonArea(ring)

  return {
    id: draft.id,
    mission_id: missionId,
    type: 'search_area',
    name: draft.name.trim(),
    description: normalizeOptionalText(draft.description),
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
    } satisfies DrawingMetadata),
    label: draft.name.trim(),
  }
}

function buildRangeRingInput(
  missionId: string,
  displayOrder: number,
  draft: RangeRingDrawingDraft,
): UpsertDrawingInput {
  assertValidName(draft.name)
  const center = draft.center
  const ringSpec =
    draft.mode === 'lpb'
      ? buildLpbRingSpec(draft.lpbCategory)
      : buildManualRingSpec(draft.manualRadiusM, draft.manualRingCount)
  const coordinates = ringSpec.radiiM.map((radiusM) => [
    geodesicCirclePoints(center[0], center[1], radiusM).map(toMutableCoordinate),
  ])

  return {
    id: draft.id,
    mission_id: missionId,
    type: 'range_ring',
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
      center,
      lpbCategory: draft.mode === 'lpb' ? draft.lpbCategory : null,
    } satisfies DrawingMetadata),
    label: draft.name.trim(),
  }
}

function buildBearingLineInput(
  missionId: string,
  displayOrder: number,
  draft: BearingLineDrawingDraft,
): UpsertDrawingInput {
  assertValidName(draft.name)
  const inputBearing = parseRequiredPositiveNumber(draft.inputBearing, 'Bearing')
  const distanceM = parseRequiredPositiveNumber(draft.distanceM, 'Distance')
  const trueBearing = draft.inputBearingType === 'magnetic' ? magneticToTrue(inputBearing) : inputBearing
  const [endLon, endLat] = geodesicBearingEndpoint(draft.origin[0], draft.origin[1], trueBearing, distanceM)

  return {
    id: draft.id,
    mission_id: missionId,
    type: 'bearing_line',
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
    } satisfies DrawingMetadata),
    distance_m: distanceM,
    label: `${formatDistance(distanceM)} @ ${trueBearing.toFixed(1)}°T / ${trueToMagnetic(trueBearing).toFixed(1)}°M`,
  }
}

function buildSearchSectorInput(
  missionId: string,
  displayOrder: number,
  draft: SearchSectorDrawingDraft,
): UpsertDrawingInput {
  assertValidName(draft.name)
  const startBearing = parseRequiredBearing(draft.startBearing, 'Start bearing')
  const endBearing = parseRequiredBearing(draft.endBearing, 'End bearing')
  const radiusM = parseRequiredPositiveNumber(draft.radiusM, 'Radius')
  const points = geodesicSectorPoints(draft.center[0], draft.center[1], startBearing, endBearing, radiusM)

  return {
    id: draft.id,
    mission_id: missionId,
    type: 'search_sector',
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
    } satisfies DrawingMetadata),
    label: draft.name.trim(),
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

function assertValidName(name: string): void {
  if (name.trim() === '') {
    throw new Error('Drawing name is required.')
  }
}

function normalizeOptionalText(value: string): string | null {
  const normalized = value.trim()
  return normalized === '' ? null : normalized
}

function normalizeOptionalNumber(value: string): number | null {
  const normalized = value.trim()
  if (normalized === '') {
    return null
  }

  return Number(normalized)
}

function parseRequiredPositiveNumber(value: string, label: string): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label} must be greater than zero.`)
  }

  return parsed
}

function parseRequiredBearing(value: string, label: string): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${label} must be zero or greater.`)
  }

  return parsed
}

function parseRequiredPositiveInteger(value: string, label: string): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer.`)
  }

  return parsed
}

function closeRing(points: readonly LonLat[]): readonly LonLat[] {
  if (points.length < 3) {
    throw new Error('Search areas require at least three points.')
  }

  const first = points[0]!
  const last = points.at(-1) ?? first
  const [firstLon, firstLat] = first
  const [lastLon, lastLat] = last
  if (firstLon === lastLon && firstLat === lastLat) {
    return points
  }

  return [...points, first] as const
}

function totalDistance(points: readonly LonLat[]): number {
  if (points.length < 2) {
    throw new Error('Lines require at least two points.')
  }

  let distance = 0
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]!
    const next = points[index]!
    const [prevLon, prevLat] = previous
    const [nextLon, nextLat] = next
    distance += geodesicDistance(prevLon, prevLat, nextLon, nextLat)
  }

  return distance
}

function toLonLat(coordinate: readonly number[]): LonLat {
  const [lon, lat] = coordinate
  if (typeof lon !== 'number' || typeof lat !== 'number') {
    throw new Error('Invalid drawing geometry coordinate.')
  }

  return [lon, lat]
}

function toMutableCoordinate([lon, lat]: LonLat): [number, number] {
  return [lon, lat]
}
