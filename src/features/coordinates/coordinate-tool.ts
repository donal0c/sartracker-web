import {
  formatIrishGridReference,
  formatWGS84Dms,
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
    dmsDisplay: formatWGS84Dms(latitude, longitude),
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
  if (draft.longitude.trim() === '') {
    return parseDecimalDegreesPair(draft.latitude)
  }

  return [
    parseDecimalCoordinate(draft.latitude, 'Latitude', ['N', 'S']),
    parseDecimalCoordinate(draft.longitude, 'Longitude', ['E', 'W']),
  ]
}

function parseDmsDraft(draft: CoordinateConverterDraft): [number, number] {
  if (draft.dmsLongitude.trim() === '') {
    return parseDmsPair(draft.dmsLatitude)
  }

  return [
    parseDmsCoordinate(draft.dmsLatitude, 'Latitude'),
    parseDmsCoordinate(draft.dmsLongitude, 'Longitude'),
  ]
}

function parseDecimalDegreesPair(value: string): [number, number] {
  const tokens = tokenizeDecimalCoordinates(value)
  if (tokens.length !== 2) {
    throw new Error(
      'DD input must include both latitude and longitude. Paste a pair like 52.004677, -9.748060, or split the values into Latitude and Longitude.',
    )
  }

  return [
    parseDecimalToken(tokens[0]!, 'Latitude', ['N', 'S']),
    parseDecimalToken(tokens[1]!, 'Longitude', ['E', 'W']),
  ]
}

function parseDecimalCoordinate(
  value: string,
  label: 'Latitude' | 'Longitude',
  allowedDirections: readonly CardinalDirection[],
): number {
  const tokens = tokenizeDecimalCoordinates(value)
  if (tokens.length !== 1) {
    throw new Error(`${label} must contain one decimal-degree value.`)
  }

  return parseDecimalToken(tokens[0]!, label, allowedDirections)
}

type DecimalCoordinateToken = {
  readonly value: string
  readonly direction: CardinalDirection | null
}

type CardinalDirection = 'N' | 'S' | 'E' | 'W'

function tokenizeDecimalCoordinates(value: string): readonly DecimalCoordinateToken[] {
  const trimmed = value.trim().toUpperCase()
  const tokens: DecimalCoordinateToken[] = []
  let leftover = ''
  let lastIndex = 0
  const pattern = /[+-]?\d+(?:\.\d+)?\s*°?\s*[NSEW]?/g
  let match: RegExpExecArray | null

  while ((match = pattern.exec(trimmed)) !== null) {
    const rawToken = match[0]
    leftover += trimmed.slice(lastIndex, match.index)
    lastIndex = pattern.lastIndex
    const tokenMatch = rawToken.trim().match(/^([+-]?\d+(?:\.\d+)?)\s*°?\s*([NSEW])?$/)
    if (tokenMatch === null) {
      continue
    }

    tokens.push({
      value: tokenMatch[1]!,
      direction: (tokenMatch[2] as CardinalDirection | undefined) ?? null,
    })
  }
  leftover += trimmed.slice(lastIndex)

  if (tokens.length === 0 || leftover.replace(/[,\s;/]+/g, '') !== '') {
    return []
  }

  return tokens
}

function parseDecimalToken(
  token: DecimalCoordinateToken,
  label: 'Latitude' | 'Longitude',
  allowedDirections: readonly CardinalDirection[],
): number {
  const parsed = Number(token.value)
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} must be a finite number.`)
  }

  if (token.direction !== null && !allowedDirections.includes(token.direction)) {
    throw new Error(`${label} direction must be ${allowedDirections.join(' or ')}.`)
  }

  // A negative numeric value paired with a positive-direction cardinal (N or E) is
  // contradictory: the sign says South/West, the cardinal says North/East. Silently
  // honouring either one could place the coordinate ~hundreds of km off target, so we
  // refuse the ambiguous input rather than guess the operator's intent.
  if ((token.direction === 'N' || token.direction === 'E') && parsed < 0) {
    throw new Error(
      `${label}: a negative value with direction '${token.direction}' is ambiguous. ` +
        `Use a positive value with '${token.direction}', or drop the direction suffix.`,
    )
  }

  const signed =
    token.direction === 'S' || token.direction === 'W' ? -Math.abs(parsed) : parsed
  validateCoordinateRange(signed, label)
  return signed
}

function formatDecimalDegrees(latitude: number, longitude: number): string {
  return `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`
}

function parseDmsCoordinate(value: string, label: string): number {
  const normalized = value.trim().toUpperCase()
  const match = normalized.match(
    /^(\d{1,3})(?:°|\s+)\s*(\d{1,2})(?:'|\s+)\s*(\d{1,2}(?:\.\d+)?)(?:"|\s*)\s*([NSEW])$/,
  )

  if (match === null) {
    throw new Error(`${label} must use DMS format like 52°10'45.613"N.`)
  }

  return parseDmsMatch(match, label)
}

function parseDmsPair(value: string): [number, number] {
  const normalized = value.trim().toUpperCase()
  const matches = Array.from(
    normalized.matchAll(/(\d{1,3})(?:°|\s+)\s*(\d{1,2})(?:'|\s+)\s*(\d{1,2}(?:\.\d+)?)(?:"|\s*)\s*([NSEW])/g),
  )

  if (matches.length !== 2) {
    throw new Error(
      'DMS input must include both latitude and longitude. Paste a pair like 52°10\'45.613"N, 9°27\'53.798"W, or split the values into Latitude DMS and Longitude DMS.',
    )
  }

  const leftover = matches.reduce(
    (remaining, match) => remaining.replace(match[0], ','),
    normalized,
  )
  if (leftover.replace(/[,\s;/]+/g, '') !== '') {
    throw new Error(
      'DMS input must include both latitude and longitude. Paste a pair like 52°10\'45.613"N, 9°27\'53.798"W, or split the values into Latitude DMS and Longitude DMS.',
    )
  }

  return [
    parseDmsMatch(matches[0]!, 'Latitude'),
    parseDmsMatch(matches[1]!, 'Longitude'),
  ]
}

function parseDmsMatch(match: RegExpMatchArray, label: string): number {
  const degrees = Number(match[1])
  const minutes = Number(match[2])
  const seconds = Number(match[3])
  const direction = match[4] as CardinalDirection

  if (minutes >= 60 || seconds >= 60) {
    throw new Error(`${label} DMS minutes and seconds must be below 60.`)
  }
  if (label === 'Latitude' && direction !== 'N' && direction !== 'S') {
    throw new Error('Latitude direction must be N or S.')
  }
  if (label === 'Longitude' && direction !== 'E' && direction !== 'W') {
    throw new Error('Longitude direction must be E or W.')
  }

  const unsigned = degrees + minutes / 60 + seconds / 3600
  const signed = direction === 'S' || direction === 'W' ? -unsigned : unsigned
  validateCoordinateRange(signed, label)
  return signed
}

function validateCoordinateRange(value: number, label: string): void {
  const limit = label === 'Latitude' ? 90 : 180
  if (Math.abs(value) > limit) {
    throw new Error(`${label} must be between -${limit} and ${limit} degrees.`)
  }
}
