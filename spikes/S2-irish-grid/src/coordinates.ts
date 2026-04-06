/**
 * Coordinate Conversion Utilities
 *
 * Convert between Irish Grid (ITM EPSG:2157), TM65, and WGS84 coordinate systems.
 *
 * LIFE-SAFETY CRITICAL: This module handles coordinate transformations used
 * in search and rescue operations. Invalid coordinates could lead rescue teams
 * to wrong locations. All inputs are validated before transformation.
 */

import proj4 from 'proj4';

// --- CRS Definitions ---

// ITM (Irish Transverse Mercator) — EPSG:2157
// Modern Irish projection, no datum shift issues
const ITM_PROJ =
  '+proj=tmerc +lat_0=53.5 +lon_0=-8 +k=0.99982 ' +
  '+x_0=600000 +y_0=750000 +ellps=GRS80 ' +
  '+towgs84=0,0,0,0,0,0,0 +units=m +no_defs';

// TM65 (Irish Grid) — display-only grid references
// Uses TOWGS84 7-parameter transform (same as QGIS plugin)
const TM65_PROJ =
  '+proj=tmerc +lat_0=53.5 +lon_0=-8 +k=1.000035 ' +
  '+x_0=200000 +y_0=250000 +a=6377340.189 +b=6356034.447 ' +
  '+towgs84=482.530,130.596,564.557,-1.042,-0.214,-0.631,8.15 ' +
  '+units=m +no_defs';

// Register CRS definitions with proj4
proj4.defs('EPSG:2157', ITM_PROJ);
proj4.defs('TM65', TM65_PROJ);
proj4.defs('EPSG:4326', '+proj=longlat +datum=WGS84 +no_defs');

// --- Validation Constants ---

const ITM_EASTING_MIN = 0;
const ITM_EASTING_MAX = 1_000_000;
const ITM_NORTHING_MIN = 0;
const ITM_NORTHING_MAX = 1_500_000;

const TM65_EASTING_MIN = 0;
const TM65_EASTING_MAX = 500_000;
const TM65_NORTHING_MIN = 0;
const TM65_NORTHING_MAX = 500_000;

const WGS84_LAT_MIN = -90;
const WGS84_LAT_MAX = 90;
const WGS84_LON_MIN = -180;
const WGS84_LON_MAX = 180;

// Irish Grid reference letter grid (north to south)
const IRISH_GRID_ROWS = ['ABCDE', 'FGHJK', 'LMNOP', 'QRSTU', 'VWXYZ'];
const IRISH_GRID_SIZE = 100_000;
const IRISH_GRID_DIM = 5;

// --- Validation Helpers ---

function validateNumeric(value: unknown, name: string, context: string): number {
  if (typeof value !== 'number') {
    throw new TypeError(
      `Invalid ${name} during ${context}: expected numeric, got ${typeof value}`
    );
  }
  const v = value as number;
  if (Number.isNaN(v)) {
    throw new RangeError(`Invalid ${name} during ${context}: value is NaN`);
  }
  if (!Number.isFinite(v)) {
    throw new RangeError(`Invalid ${name} during ${context}: value is Infinity`);
  }
  return v;
}

function validateITMRange(easting: number, northing: number, context: string): void {
  if (easting < ITM_EASTING_MIN || easting > ITM_EASTING_MAX) {
    throw new RangeError(
      `Invalid easting during ${context}: ${easting.toFixed(2)} is outside valid ITM range [${ITM_EASTING_MIN}, ${ITM_EASTING_MAX}]`
    );
  }
  if (northing < ITM_NORTHING_MIN || northing > ITM_NORTHING_MAX) {
    throw new RangeError(
      `Invalid northing during ${context}: ${northing.toFixed(2)} is outside valid ITM range [${ITM_NORTHING_MIN}, ${ITM_NORTHING_MAX}]`
    );
  }
}

function validateWGS84Range(lat: number, lon: number, context: string): void {
  if (lat < WGS84_LAT_MIN || lat > WGS84_LAT_MAX) {
    throw new RangeError(
      `Invalid latitude during ${context}: ${lat.toFixed(6)} is outside valid range [${WGS84_LAT_MIN}, ${WGS84_LAT_MAX}]`
    );
  }
  if (lon < WGS84_LON_MIN || lon > WGS84_LON_MAX) {
    throw new RangeError(
      `Invalid longitude during ${context}: ${lon.toFixed(6)} is outside valid range [${WGS84_LON_MIN}, ${WGS84_LON_MAX}]`
    );
  }
}

// --- Coordinate Transforms ---

/**
 * Convert WGS84 lat/lon to ITM easting/northing.
 */
export function wgs84ToITM(lat: number, lon: number): [easting: number, northing: number] {
  const context = 'wgs84_to_itm';
  lat = validateNumeric(lat, 'latitude', context);
  lon = validateNumeric(lon, 'longitude', context);
  validateWGS84Range(lat, lon, context);

  // proj4 expects [lon, lat] order
  const [easting, northing] = proj4('EPSG:4326', 'EPSG:2157', [lon, lat]);

  validateITMRange(easting, northing, context);
  return [easting, northing];
}

/**
 * Convert ITM easting/northing to WGS84 lat/lon.
 */
export function itmToWGS84(easting: number, northing: number): [lat: number, lon: number] {
  const context = 'itm_to_wgs84';
  easting = validateNumeric(easting, 'easting', context);
  northing = validateNumeric(northing, 'northing', context);
  validateITMRange(easting, northing, context);

  // proj4 returns [lon, lat]
  const [lon, lat] = proj4('EPSG:2157', 'EPSG:4326', [easting, northing]);

  validateWGS84Range(lat, lon, context);
  return [lat, lon];
}

/**
 * Convert WGS84 lat/lon to TM65 easting/northing.
 */
export function wgs84ToTM65(lat: number, lon: number): [easting: number, northing: number] {
  const context = 'wgs84_to_tm65';
  lat = validateNumeric(lat, 'latitude', context);
  lon = validateNumeric(lon, 'longitude', context);
  validateWGS84Range(lat, lon, context);

  const [easting, northing] = proj4('EPSG:4326', 'TM65', [lon, lat]);
  return [easting, northing];
}

/**
 * Convert TM65 easting/northing to WGS84 lat/lon.
 */
export function tm65ToWGS84(easting: number, northing: number): [lat: number, lon: number] {
  const context = 'tm65_to_wgs84';
  easting = validateNumeric(easting, 'easting', context);
  northing = validateNumeric(northing, 'northing', context);

  const [lon, lat] = proj4('TM65', 'EPSG:4326', [easting, northing]);

  validateWGS84Range(lat, lon, context);
  return [lat, lon];
}

// --- Irish Grid Reference Formatting ---

/**
 * Format TM65 easting/northing as Irish Grid reference string.
 * Returns format like "Q 99840 04018".
 *
 * Direct port of Python format_irish_grid_reference.
 */
export function formatIrishGridReference(
  easting: number,
  northing: number,
  digits: number = 5
): string {
  const context = 'format_irish_grid_reference';

  if (!Number.isInteger(digits) || digits <= 0) {
    throw new RangeError(`Invalid digit precision during ${context}: ${digits}`);
  }

  easting = validateNumeric(easting, 'easting', context);
  northing = validateNumeric(northing, 'northing', context);

  if (easting < TM65_EASTING_MIN || easting >= TM65_EASTING_MAX) {
    throw new RangeError(
      `TM65 easting outside valid range during ${context}: ${easting.toFixed(2)}`
    );
  }
  if (northing < TM65_NORTHING_MIN || northing >= TM65_NORTHING_MAX) {
    throw new RangeError(
      `TM65 northing outside valid range during ${context}: ${northing.toFixed(2)}`
    );
  }

  const e100k = Math.floor(easting) / IRISH_GRID_SIZE | 0;
  const n100k = Math.floor(northing) / IRISH_GRID_SIZE | 0;

  if (e100k < 0 || e100k >= IRISH_GRID_DIM || n100k < 0 || n100k >= IRISH_GRID_DIM) {
    throw new RangeError(
      `TM65 grid square outside valid range during ${context}: E=${easting.toFixed(2)}, N=${northing.toFixed(2)}`
    );
  }

  const row = (IRISH_GRID_DIM - 1) - n100k;
  const col = e100k;
  const letter = IRISH_GRID_ROWS[row][col];

  let eRemainder = Math.round(easting - e100k * IRISH_GRID_SIZE);
  let nRemainder = Math.round(northing - n100k * IRISH_GRID_SIZE);
  if (eRemainder >= IRISH_GRID_SIZE) eRemainder = IRISH_GRID_SIZE - 1;
  if (nRemainder >= IRISH_GRID_SIZE) nRemainder = IRISH_GRID_SIZE - 1;

  const eStr = eRemainder.toString().padStart(digits, '0');
  const nStr = nRemainder.toString().padStart(digits, '0');

  return `${letter} ${eStr} ${nStr}`;
}

/**
 * Parse an Irish Grid TM65 reference string into easting/northing meters.
 * Supports formats like "Q 99840 04018" and "Q9984004018".
 *
 * Direct port of Python parse_irish_grid_reference.
 */
export function parseIrishGridReference(gridRef: string): [easting: number, northing: number] {
  const context = 'parse_irish_grid_reference';

  if (typeof gridRef !== 'string') {
    throw new TypeError(`Invalid Irish Grid reference during ${context}: expected string`);
  }

  const compact = gridRef.toUpperCase().replace(/\s+/g, '');
  if (compact.length < 3) {
    throw new RangeError(`Invalid Irish Grid reference during ${context}: "${gridRef}"`);
  }

  const letter = compact[0];
  if (letter === 'I') {
    throw new RangeError(`Invalid Irish Grid letter during ${context}: ${letter}`);
  }

  const digitStr = compact.slice(1);
  if (!/^\d+$/.test(digitStr) || digitStr.length % 2 !== 0) {
    throw new RangeError(`Invalid Irish Grid reference during ${context}: "${gridRef}"`);
  }

  const precision = digitStr.length / 2;
  if (precision < 3 || precision > 5) {
    throw new RangeError(`Invalid Irish Grid reference during ${context}: "${gridRef}"`);
  }

  const ePart = digitStr.slice(0, precision);
  const nPart = digitStr.slice(precision);

  let rowIdx = -1;
  let colIdx = -1;
  for (let r = 0; r < IRISH_GRID_ROWS.length; r++) {
    const c = IRISH_GRID_ROWS[r].indexOf(letter);
    if (c !== -1) {
      rowIdx = r;
      colIdx = c;
      break;
    }
  }

  if (rowIdx === -1) {
    throw new RangeError(`Invalid Irish Grid letter during ${context}: ${letter}`);
  }

  const n100k = (IRISH_GRID_DIM - 1) - rowIdx;
  const e100k = colIdx;

  const scale = Math.pow(10, 5 - precision);
  const easting = e100k * IRISH_GRID_SIZE + parseInt(ePart, 10) * scale;
  const northing = n100k * IRISH_GRID_SIZE + parseInt(nPart, 10) * scale;

  if (easting < TM65_EASTING_MIN || easting >= TM65_EASTING_MAX) {
    throw new RangeError(
      `TM65 easting outside valid range during ${context}: ${easting.toFixed(2)}`
    );
  }
  if (northing < TM65_NORTHING_MIN || northing >= TM65_NORTHING_MAX) {
    throw new RangeError(
      `TM65 northing outside valid range during ${context}: ${northing.toFixed(2)}`
    );
  }

  return [easting, northing];
}

/**
 * Format WGS84 coordinates with degree symbols and directional suffixes.
 * Returns format like "52.274681N, 9.530912W".
 */
export function formatWGS84Degrees(lat: number, lon: number, precision: number = 6): string {
  const context = 'format_wgs84_degrees';

  if (!Number.isInteger(precision) || precision < 0) {
    throw new RangeError(`Invalid precision during ${context}: ${precision}`);
  }

  lat = validateNumeric(lat, 'latitude', context);
  lon = validateNumeric(lon, 'longitude', context);

  const latDir = lat >= 0 ? 'N' : 'S';
  const lonDir = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(precision)}\u00b0${latDir}, ${Math.abs(lon).toFixed(precision)}\u00b0${lonDir}`;
}

// Export CRS definitions for testing/inspection
export const CRS_DEFINITIONS = {
  ITM_PROJ,
  TM65_PROJ,
} as const;
