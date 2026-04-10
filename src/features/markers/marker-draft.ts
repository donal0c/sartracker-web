import type {
  Marker,
  MarkerType,
  UpsertMarkerInput,
} from '../../infrastructure/mission-store/tauri-mission-store'
import {
  toConfidenceLevel,
  toConfidenceScore,
  type ConfidenceLevel,
} from './marker-definitions'
import {
  formatIrishGridReference,
  formatWGS84Degrees,
  wgs84ToITM,
  wgs84ToTM65,
} from '../../lib/coordinates'

export type MarkerDraftCoordinates = {
  readonly lat: number
  readonly lon: number
  readonly irishGridE: number
  readonly irishGridN: number
  readonly wgs84Display: string
  readonly tm65GridRef: string
}

export type MarkerDraft = {
  readonly id: string | null
  readonly type: MarkerType
  readonly name: string
  readonly description: string
  readonly coordinates: MarkerDraftCoordinates
  readonly subjectCategory: string
  readonly clueType: string
  readonly confidence: ConfidenceLevel | ''
  readonly foundBy: string
  readonly hazardType: string
  readonly severity: string
  readonly condition: string
  readonly treatment: string
  readonly evacuationPriority: string
  readonly updatedBy: string
  readonly coordinatorIds: string
  readonly attachmentPath: string | null
  readonly attachmentName: string | null
  readonly displayOrder: number | null
}

type BuildMarkerSaveInputArgs = {
  readonly missionId: string
  readonly displayOrder: number
  readonly draft: MarkerDraft
}

export function createMarkerDraftAtCoordinate(
  lat: number,
  lon: number,
  type: MarkerType = 'ipp_lkp',
): MarkerDraft {
  return {
    id: null,
    type,
    name: '',
    description: '',
    coordinates: createMarkerDraftCoordinates(lat, lon),
    subjectCategory: '',
    clueType: '',
    confidence: '',
    foundBy: '',
    hazardType: '',
    severity: 'Medium',
    condition: '',
    treatment: '',
    evacuationPriority: '',
    updatedBy: '',
    coordinatorIds: '',
    attachmentPath: null,
    attachmentName: null,
    displayOrder: null,
  }
}

export function createMarkerDraftFromMarker(marker: Marker): MarkerDraft {
  return {
    id: marker.id,
    type: marker.type,
    name: marker.name,
    description: marker.description ?? '',
    coordinates: {
      lat: marker.lat,
      lon: marker.lon,
      irishGridE: marker.irish_grid_e,
      irishGridN: marker.irish_grid_n,
      wgs84Display: formatWGS84Degrees(marker.lat, marker.lon),
      tm65GridRef: formatIrishGridReference(...wgs84ToTM65(marker.lat, marker.lon)),
    },
    subjectCategory: marker.subject_category ?? '',
    clueType: marker.clue_type ?? '',
    confidence: toConfidenceLevel(marker.confidence),
    foundBy: marker.found_by ?? '',
    hazardType: marker.hazard_type ?? '',
    severity: marker.severity ?? 'Medium',
    condition: marker.condition ?? '',
    treatment: marker.treatment ?? '',
    evacuationPriority: marker.evacuation_priority ?? '',
    updatedBy: marker.updated_by ?? '',
    coordinatorIds: marker.coordinator_ids ?? '',
    attachmentPath: marker.attachment_path,
    attachmentName: marker.attachment_path === null ? null : readFileName(marker.attachment_path),
    displayOrder: marker.display_order,
  }
}

export function changeMarkerDraftType(
  draft: MarkerDraft,
  type: MarkerType,
): MarkerDraft {
  return {
    ...draft,
    type,
    subjectCategory: type === 'ipp_lkp' ? draft.subjectCategory : '',
    clueType: type === 'clue' ? draft.clueType : '',
    confidence: type === 'clue' ? draft.confidence : '',
    foundBy: type === 'clue' || type === 'casualty' ? draft.foundBy : '',
    hazardType: type === 'hazard' ? draft.hazardType : '',
    severity: type === 'hazard' ? draft.severity || 'Medium' : '',
    condition: type === 'casualty' ? draft.condition : '',
    treatment: type === 'casualty' ? draft.treatment : '',
    evacuationPriority: type === 'casualty' ? draft.evacuationPriority : '',
    updatedBy: draft.updatedBy,
    coordinatorIds: draft.coordinatorIds,
    attachmentPath: draft.attachmentPath,
    attachmentName: draft.attachmentName,
  }
}

export function buildMarkerSaveInput({
  missionId,
  displayOrder,
  draft,
}: BuildMarkerSaveInputArgs): UpsertMarkerInput {
  const normalizedName = draft.name.trim()
  if (normalizedName === '') {
    throw new Error('Marker name is required.')
  }

  return {
    id: draft.id,
    mission_id: missionId,
    type: draft.type,
    name: normalizedName,
    description: normalizeOptionalText(draft.description),
    lat: draft.coordinates.lat,
    lon: draft.coordinates.lon,
    irish_grid_e: draft.coordinates.irishGridE,
    irish_grid_n: draft.coordinates.irishGridN,
    display_order: displayOrder,
    subject_category: draft.type === 'ipp_lkp' ? normalizeOptionalText(draft.subjectCategory) : null,
    clue_type: draft.type === 'clue' ? normalizeOptionalText(draft.clueType) : null,
    confidence: draft.type === 'clue' ? normalizeConfidence(draft.confidence) : null,
    found_by:
      draft.type === 'clue' || draft.type === 'casualty'
        ? normalizeOptionalText(draft.foundBy)
        : null,
    hazard_type: draft.type === 'hazard' ? normalizeOptionalText(draft.hazardType) : null,
    severity: draft.type === 'hazard' ? normalizeOptionalText(draft.severity) : null,
    condition: draft.type === 'casualty' ? normalizeOptionalText(draft.condition) : null,
    treatment: draft.type === 'casualty' ? normalizeOptionalText(draft.treatment) : null,
    evacuation_priority:
      draft.type === 'casualty' ? normalizeOptionalText(draft.evacuationPriority) : null,
    updated_by: normalizeOptionalText(draft.updatedBy),
    coordinator_ids: normalizeOptionalText(normalizeCoordinatorIds(draft.coordinatorIds)),
    attachment_path: draft.attachmentPath,
  }
}

function createMarkerDraftCoordinates(lat: number, lon: number): MarkerDraftCoordinates {
  const [irishGridE, irishGridN] = wgs84ToITM(lat, lon)
  const [tm65Easting, tm65Northing] = wgs84ToTM65(lat, lon)

  return {
    lat,
    lon,
    irishGridE: Math.round(irishGridE),
    irishGridN: Math.round(irishGridN),
    wgs84Display: formatWGS84Degrees(lat, lon),
    tm65GridRef: formatIrishGridReference(tm65Easting, tm65Northing),
  }
}

function normalizeOptionalText(value: string): string | null {
  const normalized = value.trim()
  return normalized === '' ? null : normalized
}

function normalizeConfidence(value: ConfidenceLevel | ''): number | null {
  return value === '' ? null : toConfidenceScore(value)
}

function normalizeCoordinatorIds(value: string): string {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
    .join(', ')
}

function readFileName(path: string): string {
  const normalizedPath = path.replace(/\\/g, '/')
  const segments = normalizedPath.split('/')
  return segments[segments.length - 1] ?? path
}
