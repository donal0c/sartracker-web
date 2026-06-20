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
  isWithinIreland,
  parseIrishGridReference,
  tm65ToWgs84,
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
  readonly labelSize: string
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

/**
 * Creates a marker draft at a validated WGS84 coordinate.
 */
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
    labelSize: defaultMarkerLabelSize(type).toString(),
    updatedBy: '',
    coordinatorIds: '',
    attachmentPath: null,
    attachmentName: null,
    displayOrder: null,
  }
}

/**
 * Creates a marker draft from an operator-entered TM65 Irish Grid reference.
 */
export function createMarkerDraftFromIrishGridReference(
  gridReference: string,
  type: MarkerType = 'ipp_lkp',
): MarkerDraft {
  const [tm65Easting, tm65Northing] = parseIrishGridReference(gridReference)
  const [lat, lon] = tm65ToWgs84(tm65Easting, tm65Northing)
  return createMarkerDraftAtCoordinate(lat, lon, type)
}

/**
 * Creates an editable draft from a persisted marker.
 */
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
      tm65GridRef: describeIrishGridRef(marker.lat, marker.lon),
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
    labelSize: (marker.label_size ?? defaultMarkerLabelSize(marker.type)).toString(),
    updatedBy: marker.updated_by ?? '',
    coordinatorIds: marker.coordinator_ids ?? '',
    attachmentPath: marker.attachment_path,
    attachmentName: marker.attachment_path === null ? null : readFileName(marker.attachment_path),
    displayOrder: marker.display_order,
  }
}

/**
 * Changes the marker type while clearing fields that no longer apply.
 */
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
    labelSize: defaultMarkerLabelSize(type).toString(),
    updatedBy: draft.updatedBy,
    coordinatorIds: draft.coordinatorIds,
    attachmentPath: draft.attachmentPath,
    attachmentName: draft.attachmentName,
  }
}

/**
 * Appends an operator treatment update while preserving previous casualty notes.
 */
export function appendTreatmentUpdate(input: {
  readonly existingTreatment: string
  readonly note: string
  readonly timestamp: Date
  readonly updatedBy: string
}): string {
  const note = input.note.trim()
  if (note === '') {
    throw new Error('Treatment update is required.')
  }

  const entry = `${formatTreatmentUpdatePrefix(input.timestamp, input.updatedBy)}${note}`
  const existingTreatment = input.existingTreatment.trim()

  return existingTreatment === '' ? entry : `${existingTreatment}\n\n${entry}`
}

export type CasualtyRequiredField = 'name' | 'condition' | 'evacuationPriority'

/**
 * Returns the list of missing required fields for a casualty marker.
 * Non-casualty markers always return an empty array.
 */
export function getCasualtyValidationErrors(
  draft: Pick<MarkerDraft, 'type' | 'name' | 'condition' | 'evacuationPriority'>,
): readonly CasualtyRequiredField[] {
  if (draft.type !== 'casualty') {
    return []
  }

  const missing: CasualtyRequiredField[] = []
  if (draft.name.trim() === '') missing.push('name')
  if (draft.condition.trim() === '') missing.push('condition')
  if (draft.evacuationPriority.trim() === '') missing.push('evacuationPriority')
  return missing
}

/**
 * Builds the backend persistence payload for a marker draft.
 */
export function buildMarkerSaveInput({
  missionId,
  displayOrder,
  draft,
}: BuildMarkerSaveInputArgs): UpsertMarkerInput {
  const normalizedName = draft.name.trim()
  if (normalizedName === '') {
    throw new Error('Marker name is required.')
  }

  if (draft.type === 'casualty') {
    if (draft.condition.trim() === '') {
      throw new Error('Casualty Status is required for casualty markers.')
    }
    if (draft.evacuationPriority.trim() === '') {
      throw new Error('Evacuation Priority is required for casualty markers.')
    }
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
    label_size: normalizeLabelSize(draft.labelSize),
    updated_by: normalizeOptionalText(draft.updatedBy),
    coordinator_ids: normalizeOptionalText(normalizeCoordinatorIds(draft.coordinatorIds)),
    attachment_path: draft.attachmentPath,
  }
}

export function defaultMarkerLabelSize(type: MarkerType): number {
  return type === 'casualty' ? 16 : 12
}

function createMarkerDraftCoordinates(lat: number, lon: number): MarkerDraftCoordinates {
  // New markers must sit inside Ireland: wgs84ToITM/wgs84ToTM65 throw on offshore input,
  // and that throw is surfaced to the operator by the marker runtime's beginCreateAt.
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

/**
 * Formats a persisted marker's Irish Grid reference for display without throwing.
 *
 * Reopening an existing marker must never fail. A marker persisted before Irish-bounds
 * validation existed (or any future out-of-bounds record) is shown with an explicit
 * "Outside Ireland" label rather than crashing the edit dialog.
 */
function describeIrishGridRef(lat: number, lon: number): string {
  if (!isWithinIreland(lat, lon)) {
    return 'Outside Ireland'
  }

  return formatIrishGridReference(...wgs84ToTM65(lat, lon))
}

function normalizeOptionalText(value: string): string | null {
  const normalized = value.trim()
  return normalized === '' ? null : normalized
}

function formatTreatmentUpdatePrefix(timestamp: Date, updatedBy: string): string {
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error('Treatment update timestamp is invalid.')
  }

  const dateTime = `${timestamp.getFullYear()}-${padDatePart(timestamp.getMonth() + 1)}-${padDatePart(timestamp.getDate())} ${padDatePart(timestamp.getHours())}:${padDatePart(timestamp.getMinutes())}`
  const author = updatedBy.trim()

  return author === '' ? `[${dateTime}] ` : `[${dateTime}] ${author}: `
}

function padDatePart(value: number): string {
  return value.toString().padStart(2, '0')
}

function normalizeConfidence(value: ConfidenceLevel | ''): number | null {
  return value === '' ? null : toConfidenceScore(value)
}

function normalizeLabelSize(value: string): number {
  const labelSize = Number(value)
  if (!Number.isFinite(labelSize) || labelSize < 8 || labelSize > 28) {
    throw new Error('Marker label size must be between 8 and 28.')
  }

  return Math.round(labelSize)
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
