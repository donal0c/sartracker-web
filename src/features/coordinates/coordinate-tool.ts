import {
  formatIrishGridReference,
  parseIrishGridReference,
  tm65ToWgs84,
  wgs84ToTM65,
} from '../../lib/coordinates'

export type CoordinateConverterMode = 'ig' | 'dd' | 'dms' | 'w3w'

export type CoordinateConverterDraft = {
  readonly mode: CoordinateConverterMode
  readonly irishGridRef: string
  readonly latitude: string
  readonly longitude: string
  readonly dmsLatitude: string
  readonly dmsLongitude: string
  readonly w3wWords: string
}

export type CoordinateConversionResult = {
  readonly latitude: number
  readonly longitude: number
  readonly ddDisplay: string
  readonly dmsDisplay: string
  readonly tm65Easting: number
  readonly tm65Northing: number
  readonly irishGridRef: string
  readonly w3wDisplay: string
}

export type CoordinateClipboardKind = 'ig' | 'dd' | 'dms'

export function createCoordinateConverterDraft(): CoordinateConverterDraft {
  return {
    mode: 'ig',
    irishGridRef: '',
    latitude: '',
    longitude: '',
    dmsLatitude: '',
    dmsLongitude: '',
    w3wWords: '',
  }
}

/**
 * Converts any supported operator coordinate input into DD, DMS, and Irish Grid outputs.
 */
export function convertCoordinates(
  draft: CoordinateConverterDraft,
): CoordinateConversionResult {
  const [latitude, longitude] = resolveDraftCoordinate(draft)
  const [tm65Easting, tm65Northing] = wgs84ToTM65(latitude, longitude)

  return {
    latitude,
    longitude,
    ddDisplay: formatDecimalDegrees(latitude, longitude),
    dmsDisplay: `${formatDmsCoordinate(latitude, 'lat')}, ${formatDmsCoordinate(longitude, 'lon')}`,
    tm65Easting,
    tm65Northing,
    irishGridRef: formatIrishGridReference(tm65Easting, tm65Northing),
    w3wDisplay: 'W3W unavailable offline',
  }
}

export function formatCoordinateClipboardValue(
  result: CoordinateConversionResult,
  kind: CoordinateClipboardKind,
): string {
  switch (kind) {
    case 'ig':
      return result.irishGridRef
    case 'dd':
      return result.ddDisplay
    case 'dms':
      return result.dmsDisplay
  }
}

function resolveDraftCoordinate(draft: CoordinateConverterDraft): [number, number] {
  switch (draft.mode) {
    case 'ig':
      return parseIrishGridDraft(draft)
    case 'dd':
      return parseDecimalDegreesDraft(draft)
    case 'dms':
      return parseDmsDraft(draft)
    case 'w3w':
      throw new Error(
        'W3W conversion is not available until API, licensing, offline behavior, and operational accuracy requirements are settled.',
      )
  }
}

function parseIrishGridDraft(draft: CoordinateConverterDraft): [number, number] {
  const [tm65Easting, tm65Northing] = parseIrishGridReference(draft.irishGridRef)
  return tm65ToWgs84(tm65Easting, tm65Northing)
}

function parseDecimalDegreesDraft(draft: CoordinateConverterDraft): [number, number] {
  return [
    parseRequiredNumber(draft.latitude, 'Latitude'),
    parseRequiredNumber(draft.longitude, 'Longitude'),
  ]
}

function parseDmsDraft(draft: CoordinateConverterDraft): [number, number] {
  return [
    parseDmsCoordinate(draft.dmsLatitude, 'Latitude'),
    parseDmsCoordinate(draft.dmsLongitude, 'Longitude'),
  ]
}

function parseRequiredNumber(value: string, label: string): number {
  const parsed = Number(value.trim())
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} must be a finite number.`)
  }

  return parsed
}

function formatDecimalDegrees(latitude: number, longitude: number): string {
  return `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`
}

function formatDmsCoordinate(value: number, axis: 'lat' | 'lon'): string {
  const direction = axis === 'lat'
    ? value >= 0 ? 'N' : 'S'
    : value >= 0 ? 'E' : 'W'
  const absolute = Math.abs(value)
  const degrees = Math.floor(absolute)
  const minutesFloat = (absolute - degrees) * 60
  const minutes = Math.floor(minutesFloat)
  const seconds = (minutesFloat - minutes) * 60

  return `${degrees}°${minutes.toString().padStart(2, '0')}'${seconds
    .toFixed(3)
    .padStart(6, '0')}"${direction}`
}

function parseDmsCoordinate(value: string, label: string): number {
  const normalized = value.trim().toUpperCase()
  const match = normalized.match(
    /^(\d{1,3})(?:°|\s+)\s*(\d{1,2})(?:'|\s+)\s*(\d{1,2}(?:\.\d+)?)(?:"|\s*)\s*([NSEW])$/,
  )

  if (match === null) {
    throw new Error(`${label} must use DMS format like 52°10'45.613"N.`)
  }

  const degrees = Number(match[1])
  const minutes = Number(match[2])
  const seconds = Number(match[3])
  const direction = match[4]

  if (minutes >= 60 || seconds >= 60) {
    throw new Error(`${label} DMS minutes and seconds must be below 60.`)
  }

  const unsigned = degrees + minutes / 60 + seconds / 3600
  return direction === 'S' || direction === 'W' ? -unsigned : unsigned
}
