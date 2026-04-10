import {
  formatIrishGridReference,
  formatITMCoordinates,
  formatWGS84Degrees,
  itmToWgs84,
  parseIrishGridReference,
  tm65ToWgs84,
  wgs84ToITM,
  wgs84ToTM65,
} from '../../lib/coordinates'

export type CoordinateConverterMode = 'wgs84' | 'itm' | 'tm65'

export type CoordinateConverterDraft = {
  readonly mode: CoordinateConverterMode
  readonly latitude: string
  readonly longitude: string
  readonly itmEasting: string
  readonly itmNorthing: string
  readonly tm65GridRef: string
}

export type CoordinateConversionResult = {
  readonly latitude: number
  readonly longitude: number
  readonly wgs84Display: string
  readonly itmEasting: number
  readonly itmNorthing: number
  readonly itmDisplay: string
  readonly tm65Easting: number
  readonly tm65Northing: number
  readonly tm65GridRef: string
}

export function createCoordinateConverterDraft(): CoordinateConverterDraft {
  return {
    mode: 'wgs84',
    latitude: '',
    longitude: '',
    itmEasting: '',
    itmNorthing: '',
    tm65GridRef: '',
  }
}

/**
 * Converts any supported coordinate input mode into the canonical WGS84/ITM/TM65 outputs.
 */
export function convertCoordinates(
  draft: CoordinateConverterDraft,
): CoordinateConversionResult {
  const [latitude, longitude] =
    draft.mode === 'wgs84'
      ? parseWgs84Draft(draft)
      : draft.mode === 'itm'
        ? parseItmDraft(draft)
        : parseTm65Draft(draft)

  const [itmEasting, itmNorthing] = wgs84ToITM(latitude, longitude)
  const [tm65Easting, tm65Northing] = wgs84ToTM65(latitude, longitude)

  return {
    latitude,
    longitude,
    wgs84Display: formatWGS84Degrees(latitude, longitude),
    itmEasting,
    itmNorthing,
    itmDisplay: formatITMCoordinates(itmEasting, itmNorthing),
    tm65Easting,
    tm65Northing,
    tm65GridRef: formatIrishGridReference(tm65Easting, tm65Northing),
  }
}

export function formatCoordinateClipboardValue(
  result: CoordinateConversionResult,
  kind: 'wgs84' | 'itm' | 'tm65',
): string {
  switch (kind) {
    case 'wgs84':
      return result.wgs84Display
    case 'itm':
      return result.itmDisplay
    case 'tm65':
      return result.tm65GridRef
  }
}

function parseWgs84Draft(draft: CoordinateConverterDraft): [number, number] {
  return [
    parseRequiredNumber(draft.latitude, 'Latitude'),
    parseRequiredNumber(draft.longitude, 'Longitude'),
  ]
}

function parseItmDraft(draft: CoordinateConverterDraft): [number, number] {
  return itmToWgs84(
    parseRequiredNumber(draft.itmEasting, 'ITM Easting'),
    parseRequiredNumber(draft.itmNorthing, 'ITM Northing'),
  )
}

function parseTm65Draft(draft: CoordinateConverterDraft): [number, number] {
  const [tm65Easting, tm65Northing] = parseIrishGridReference(draft.tm65GridRef)
  return tm65ToWgs84(tm65Easting, tm65Northing)
}

function parseRequiredNumber(value: string, label: string): number {
  const parsed = Number(value.trim())
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} must be a finite number.`)
  }

  return parsed
}
