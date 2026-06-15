import proj4 from 'proj4'
import type { CoordinateDisplayMode } from '../features/settings/settings-types'

const ITM_PROJ =
  '+proj=tmerc +lat_0=53.5 +lon_0=-8 +k=0.99982 ' +
  '+x_0=600000 +y_0=750000 +ellps=GRS80 ' +
  '+towgs84=0,0,0,0,0,0,0 +units=m +no_defs'

const TM65_PROJ =
  '+proj=tmerc +lat_0=53.5 +lon_0=-8 +k=1.000035 ' +
  '+x_0=200000 +y_0=250000 +a=6377340.189 +b=6356034.447 ' +
  '+towgs84=482.530,-130.596,564.557,-1.042,-0.214,-0.631,8.15 ' +
  '+units=m +no_defs'

proj4.defs('EPSG:2157', ITM_PROJ)
proj4.defs('TM65', TM65_PROJ)
proj4.defs('EPSG:4326', '+proj=longlat +datum=WGS84 +no_defs')

const TM65_EASTING_MIN = 0
const TM65_EASTING_MAX = 500_000
const TM65_NORTHING_MIN = 0
const TM65_NORTHING_MAX = 500_000
const WGS84_LAT_MIN = -90
const WGS84_LAT_MAX = 90
const WGS84_LON_MIN = -180
const WGS84_LON_MAX = 180

// Irish geographic envelope (WGS84), sized to contain the whole island of Ireland
// including its outlying inhabited/rescue-relevant islands, with a small margin.
// Southern extreme: Fastnet/Mizen area (~51.4°N). Northern extreme: Inishtrahull /
// Malin Head (~55.5°N). Western extreme: Tearaght / Blasket Islands (~-10.7°W).
// Eastern extreme: Co. Down / Wexford coast (~-5.9°W). These bounds intentionally
// err toward inclusiveness: a real Irish coordinate must never be rejected, even at
// the cost of admitting some near-coast sea (a rectangle cannot separate the two).
const IRELAND_LAT_MIN = 51.3
const IRELAND_LAT_MAX = 55.6
const IRELAND_LON_MIN = -10.8
const IRELAND_LON_MAX = -5.8

// ITM (EPSG:2157) easting/northing envelope for the same Irish extent. These bounds
// must fully CONTAIN the proj4 image of the WGS84 box above (sampled densely:
// E≈404768..753402, N≈505239..987279), so that any point accepted by
// `isWithinIreland` / `validateIrishWGS84Range` can never subsequently fail ITM
// validation — otherwise a genuine Irish coordinate could convert but fail to format.
// The northern edge in particular must clear Inishtrahull (N≈965951), Ireland's
// northernmost island, and the east must clear Wicklow Head (E≈734629). A small margin
// is added. GPS zero-fill (ITM 0,0 → mid-Atlantic ~46.5°N) sits far below E_MIN, so it
// is still rejected.
const ITM_EASTING_MIN = 400_000
const ITM_EASTING_MAX = 760_000
const ITM_NORTHING_MIN = 500_000
const ITM_NORTHING_MAX = 990_000
const IRISH_GRID_ROWS = ['ABCDE', 'FGHJK', 'LMNOP', 'QRSTU', 'VWXYZ']
const IRISH_GRID_SIZE = 100_000
const IRISH_GRID_DIM = 5

/**
 * Validates a numeric input before it enters coordinate math.
 */
function validateNumeric(value: unknown, name: string, context: string): number {
  if (typeof value !== 'number') {
    throw new TypeError(
      `Invalid ${name} during ${context}: expected numeric, got ${typeof value}`,
    )
  }
  if (Number.isNaN(value)) {
    throw new RangeError(`Invalid ${name} during ${context}: value is NaN`)
  }
  if (!Number.isFinite(value)) {
    throw new RangeError(`Invalid ${name} during ${context}: value is Infinity`)
  }

  return value
}

/**
 * Validates WGS84 latitude and longitude ranges.
 */
function validateWGS84Range(lat: number, lon: number, context: string): void {
  if (lat < WGS84_LAT_MIN || lat > WGS84_LAT_MAX) {
    throw new RangeError(`Invalid latitude during ${context}: ${lat.toFixed(6)}`)
  }
  if (lon < WGS84_LON_MIN || lon > WGS84_LON_MAX) {
    throw new RangeError(`Invalid longitude during ${context}: ${lon.toFixed(6)}`)
  }
}

/**
 * Reports whether a WGS84 coordinate falls inside Ireland's geographic envelope.
 *
 * This is a non-throwing predicate intended for hot paths such as the live coordinate
 * readout, which tracks the mouse cursor over the map (frequently out to sea) and must
 * never raise. It is deliberately inclusive at the coast: a `true` result guarantees
 * the point is within the Irish bounding box, but does not guarantee it is on land.
 * Non-finite inputs return `false`.
 */
export function isWithinIreland(lat: number, lon: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return false
  }

  return (
    lat >= IRELAND_LAT_MIN &&
    lat <= IRELAND_LAT_MAX &&
    lon >= IRELAND_LON_MIN &&
    lon <= IRELAND_LON_MAX
  )
}

/**
 * Throws when a WGS84 coordinate falls outside Ireland's geographic envelope.
 *
 * Used on authoritative/commit paths (deriving an Irish grid reference or ITM
 * coordinate that an operator will act on) so a grossly out-of-area input cannot be
 * silently transformed into a plausible-looking Irish reference.
 */
function validateIrishWGS84Range(lat: number, lon: number, context: string): void {
  if (!isWithinIreland(lat, lon)) {
    throw new RangeError(
      `Coordinate outside Ireland during ${context}: lat=${lat.toFixed(4)}, lon=${lon.toFixed(4)}`,
    )
  }
}

/**
 * Throws when an ITM easting/northing pair falls outside Ireland's projected extent.
 */
function validateITMRange(easting: number, northing: number, context: string): void {
  if (easting < ITM_EASTING_MIN || easting >= ITM_EASTING_MAX) {
    throw new RangeError(`ITM easting outside valid range during ${context}`)
  }
  if (northing < ITM_NORTHING_MIN || northing >= ITM_NORTHING_MAX) {
    throw new RangeError(`ITM northing outside valid range during ${context}`)
  }
}

/**
 * Converts WGS84 latitude/longitude coordinates into ITM easting/northing.
 *
 * Rejects coordinates outside Ireland: ITM is only meaningful for Irish territory, and
 * an offshore input would otherwise produce a plausible-looking but wrong ITM value.
 */
export function wgs84ToITM(lat: number, lon: number): [number, number] {
  const context = 'wgs84_to_itm'
  const safeLat = validateNumeric(lat, 'latitude', context)
  const safeLon = validateNumeric(lon, 'longitude', context)

  validateWGS84Range(safeLat, safeLon, context)
  validateIrishWGS84Range(safeLat, safeLon, context)

  return proj4('EPSG:4326', 'EPSG:2157', [safeLon, safeLat]) as [number, number]
}

/**
 * Converts WGS84 latitude/longitude coordinates into TM65 easting/northing.
 *
 * Rejects coordinates outside Ireland: an offshore input would otherwise be formatted
 * into an authentic-looking Irish grid reference with no indication it is wrong.
 */
export function wgs84ToTM65(lat: number, lon: number): [number, number] {
  const context = 'wgs84_to_tm65'
  const safeLat = validateNumeric(lat, 'latitude', context)
  const safeLon = validateNumeric(lon, 'longitude', context)

  validateWGS84Range(safeLat, safeLon, context)
  validateIrishWGS84Range(safeLat, safeLon, context)

  return proj4('EPSG:4326', 'TM65', [safeLon, safeLat]) as [number, number]
}

/**
 * Converts ITM easting/northing coordinates into WGS84 latitude/longitude.
 *
 * Guards the ITM input against Ireland's projected extent, mirroring `tm65ToWgs84`.
 * This rejects GPS zero-fill faults: `itmToWgs84(0, 0)` would otherwise back-project to
 * a globally valid WGS84 point ~700 km out in the Atlantic and pass silently.
 */
export function itmToWgs84(easting: number, northing: number): [number, number] {
  const context = 'itm_to_wgs84'
  const safeEasting = validateNumeric(easting, 'easting', context)
  const safeNorthing = validateNumeric(northing, 'northing', context)

  validateITMRange(safeEasting, safeNorthing, context)

  const [lon, lat] = proj4('EPSG:2157', 'EPSG:4326', [safeEasting, safeNorthing]) as [
    number,
    number,
  ]

  validateWGS84Range(lat, lon, context)

  return [lat, lon]
}

/**
 * Converts TM65 easting/northing coordinates into WGS84 latitude/longitude.
 */
export function tm65ToWgs84(easting: number, northing: number): [number, number] {
  const context = 'tm65_to_wgs84'
  const safeEasting = validateNumeric(easting, 'easting', context)
  const safeNorthing = validateNumeric(northing, 'northing', context)

  if (safeEasting < TM65_EASTING_MIN || safeEasting >= TM65_EASTING_MAX) {
    throw new RangeError(`TM65 easting outside valid range during ${context}`)
  }
  if (safeNorthing < TM65_NORTHING_MIN || safeNorthing >= TM65_NORTHING_MAX) {
    throw new RangeError(`TM65 northing outside valid range during ${context}`)
  }

  const [lon, lat] = proj4('TM65', 'EPSG:4326', [safeEasting, safeNorthing]) as [number, number]

  validateWGS84Range(lat, lon, context)

  return [lat, lon]
}

/**
 * Formats TM65 easting/northing values as an Irish grid reference.
 */
export function formatIrishGridReference(
  easting: number,
  northing: number,
  digits = 5,
): string {
  const context = 'format_irish_grid_reference'
  const safeEasting = validateNumeric(easting, 'easting', context)
  const safeNorthing = validateNumeric(northing, 'northing', context)

  if (!Number.isInteger(digits) || digits <= 0) {
    throw new RangeError(`Invalid digit precision during ${context}: ${digits}`)
  }

  if (safeEasting < TM65_EASTING_MIN || safeEasting >= TM65_EASTING_MAX) {
    throw new RangeError(`TM65 easting outside valid range during ${context}`)
  }
  if (safeNorthing < TM65_NORTHING_MIN || safeNorthing >= TM65_NORTHING_MAX) {
    throw new RangeError(`TM65 northing outside valid range during ${context}`)
  }

  const e100k = (Math.floor(safeEasting) / IRISH_GRID_SIZE) | 0
  const n100k = (Math.floor(safeNorthing) / IRISH_GRID_SIZE) | 0
  const row = (IRISH_GRID_DIM - 1) - n100k
  const col = e100k
  const letter = IRISH_GRID_ROWS[row]?.[col]

  if (!letter) {
    throw new RangeError(`TM65 grid square outside valid range during ${context}`)
  }

  let eRemainder = Math.round(safeEasting - e100k * IRISH_GRID_SIZE)
  let nRemainder = Math.round(safeNorthing - n100k * IRISH_GRID_SIZE)
  if (eRemainder >= IRISH_GRID_SIZE) eRemainder = IRISH_GRID_SIZE - 1
  if (nRemainder >= IRISH_GRID_SIZE) nRemainder = IRISH_GRID_SIZE - 1

  return `${letter} ${eRemainder.toString().padStart(digits, '0')} ${nRemainder
    .toString()
    .padStart(digits, '0')}`
}

/**
 * Parses an Irish grid reference into TM65 easting/northing coordinates.
 */
export function parseIrishGridReference(value: string): [number, number] {
  const context = 'parse_irish_grid_reference'
  const normalized = value.trim().toUpperCase()
  const match = normalized.match(/^([A-HJ-Z])[\s,]+(\d{1,5})[\s,]+(\d{1,5})$/)
  if (match === null) {
    throw new Error('TM65 grid reference must look like "V 80245 84452".')
  }

  const letter = match[1]!
  const rawEasting = match[2]!
  const rawNorthing = match[3]!
  if (rawEasting.length !== rawNorthing.length) {
    throw new Error('TM65 grid reference must use the same precision for easting and northing.')
  }

  const gridPosition = findIrishGridLetterPosition(letter)
  if (gridPosition === null) {
    throw new Error(`TM65 grid square outside valid range during ${context}`)
  }

  const precision = rawEasting.length
  const scale = 10 ** (5 - precision)
  const eastingRemainder = Number(rawEasting) * scale
  const northingRemainder = Number(rawNorthing) * scale
  const easting = gridPosition.easting + eastingRemainder
  const northing = gridPosition.northing + northingRemainder

  if (easting < TM65_EASTING_MIN || easting >= TM65_EASTING_MAX) {
    throw new Error(`TM65 easting outside valid range during ${context}`)
  }
  if (northing < TM65_NORTHING_MIN || northing >= TM65_NORTHING_MAX) {
    throw new Error(`TM65 northing outside valid range during ${context}`)
  }

  return [easting, northing]
}

/**
 * Formats ITM coordinates for operator display.
 *
 * Guards the ITM range so an offshore-derived pair cannot be presented as a valid Irish
 * ITM coordinate. This restores symmetry with the TM65 (`formatIrishGridReference`)
 * formatter, which already enforces its domain bounds.
 */
export function formatITMCoordinates(easting: number, northing: number): string {
  const context = 'format_itm_coordinates'
  const safeEasting = validateNumeric(easting, 'easting', context)
  const safeNorthing = validateNumeric(northing, 'northing', context)

  validateITMRange(safeEasting, safeNorthing, context)

  return `${Math.round(safeEasting)}, ${Math.round(safeNorthing)}`
}

/**
 * Formats WGS84 latitude/longitude values with directional suffixes.
 */
export function formatWGS84Degrees(lat: number, lon: number, precision = 6): string {
  const context = 'format_wgs84_degrees'
  const safeLat = validateNumeric(lat, 'latitude', context)
  const safeLon = validateNumeric(lon, 'longitude', context)

  if (!Number.isInteger(precision) || precision < 0) {
    throw new RangeError(`Invalid precision during ${context}: ${precision}`)
  }

  validateWGS84Range(safeLat, safeLon, context)

  const latDir = safeLat >= 0 ? 'N' : 'S'
  const lonDir = safeLon >= 0 ? 'E' : 'W'

  return `${Math.abs(safeLat).toFixed(precision)}°${latDir}, ${Math.abs(safeLon).toFixed(
    precision,
  )}°${lonDir}`
}

/**
 * Formats WGS84 latitude/longitude as DMS coordinates with directional suffixes.
 */
export function formatWGS84Dms(lat: number, lon: number): string {
  const context = 'format_wgs84_dms'
  const safeLat = validateNumeric(lat, 'latitude', context)
  const safeLon = validateNumeric(lon, 'longitude', context)

  validateWGS84Range(safeLat, safeLon, context)

  return `${formatDmsCoordinate(safeLat, 'lat')}, ${formatDmsCoordinate(safeLon, 'lon')}`
}

/**
 * Formats the operator coordinate bar with both WGS84 and TM65 values.
 *
 * This is a live-display helper that tracks the cursor, which routinely moves out to
 * sea, so it never throws on an offshore point: the Irish Grid segment falls back to an
 * explicit "Outside Ireland" label rather than a fabricated grid reference.
 */
export function formatMapCoordinateBar(
  lat: number,
  lon: number,
  mode: CoordinateDisplayMode = 'wgs84_first',
): string {
  const wgs84 = formatWGS84Degrees(lat, lon)
  const tm65 = isWithinIreland(lat, lon)
    ? formatIrishGridReference(...wgs84ToTM65(lat, lon))
    : 'Outside Ireland'
  return mode === 'tm65_first' ? `${tm65}  |  ${wgs84}` : `${wgs84}  |  ${tm65}`
}

function formatDmsCoordinate(value: number, axis: 'lat' | 'lon'): string {
  const direction = axis === 'lat'
    ? value >= 0 ? 'N' : 'S'
    : value >= 0 ? 'E' : 'W'
  const totalSeconds = Math.round(Math.abs(value) * 3_600_000) / 1_000
  const degrees = Math.floor(totalSeconds / 3_600)
  const remainingSeconds = totalSeconds - degrees * 3_600
  const minutes = Math.floor(remainingSeconds / 60)
  const seconds = remainingSeconds - minutes * 60

  return `${degrees}°${minutes.toString().padStart(2, '0')}'${seconds
    .toFixed(3)
    .padStart(6, '0')}"${direction}`
}

function findIrishGridLetterPosition(letter: string): { easting: number; northing: number } | null {
  for (let row = 0; row < IRISH_GRID_ROWS.length; row += 1) {
    const letters = IRISH_GRID_ROWS[row]!
    const col = letters.indexOf(letter)
    if (col === -1) {
      continue
    }

    return {
      easting: col * IRISH_GRID_SIZE,
      northing: (IRISH_GRID_DIM - 1 - row) * IRISH_GRID_SIZE,
    }
  }

  return null
}
