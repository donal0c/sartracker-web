import proj4 from 'proj4'

const ITM_PROJ =
  '+proj=tmerc +lat_0=53.5 +lon_0=-8 +k=0.99982 ' +
  '+x_0=600000 +y_0=750000 +ellps=GRS80 ' +
  '+towgs84=0,0,0,0,0,0,0 +units=m +no_defs'

const TM65_PROJ =
  '+proj=tmerc +lat_0=53.5 +lon_0=-8 +k=1.000035 ' +
  '+x_0=200000 +y_0=250000 +a=6377340.189 +b=6356034.447 ' +
  '+towgs84=482.530,130.596,564.557,-1.042,-0.214,-0.631,8.15 ' +
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
 * Converts WGS84 latitude/longitude coordinates into ITM easting/northing.
 */
export function wgs84ToITM(lat: number, lon: number): [number, number] {
  const context = 'wgs84_to_itm'
  const safeLat = validateNumeric(lat, 'latitude', context)
  const safeLon = validateNumeric(lon, 'longitude', context)

  validateWGS84Range(safeLat, safeLon, context)

  return proj4('EPSG:4326', 'EPSG:2157', [safeLon, safeLat]) as [number, number]
}

/**
 * Converts WGS84 latitude/longitude coordinates into TM65 easting/northing.
 */
export function wgs84ToTM65(lat: number, lon: number): [number, number] {
  const context = 'wgs84_to_tm65'
  const safeLat = validateNumeric(lat, 'latitude', context)
  const safeLon = validateNumeric(lon, 'longitude', context)

  validateWGS84Range(safeLat, safeLon, context)

  return proj4('EPSG:4326', 'TM65', [safeLon, safeLat]) as [number, number]
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
 * Formats the operator coordinate bar with both WGS84 and TM65 values.
 */
export function formatMapCoordinateBar(
  lat: number,
  lon: number,
  mode: CoordinateDisplayMode = 'wgs84_first',
): string {
  const [easting, northing] = wgs84ToTM65(lat, lon)
  const wgs84 = formatWGS84Degrees(lat, lon)
  const tm65 = formatIrishGridReference(easting, northing)
  return mode === 'tm65_first' ? `${tm65}  |  ${wgs84}` : `${wgs84}  |  ${tm65}`
}
import type { CoordinateDisplayMode } from '../features/settings/settings-types'
