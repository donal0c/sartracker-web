/**
 * Coordinate conversion for SAR Tracker map display.
 *
 * Converts WGS84 (MapLibre native) to Irish Grid (TM65) for display.
 * Ported from the S2-irish-grid spike.
 */

import proj4 from 'proj4';

// TM65 (Irish Grid) — display-only grid references
const TM65_PROJ =
  '+proj=tmerc +lat_0=53.5 +lon_0=-8 +k=1.000035 ' +
  '+x_0=200000 +y_0=250000 +a=6377340.189 +b=6356034.447 ' +
  '+towgs84=482.530,130.596,564.557,-1.042,-0.214,-0.631,8.15 ' +
  '+units=m +no_defs';

proj4.defs('TM65', TM65_PROJ);
proj4.defs('EPSG:4326', '+proj=longlat +datum=WGS84 +no_defs');

const IRISH_GRID_ROWS = ['ABCDE', 'FGHJK', 'LMNOP', 'QRSTU', 'VWXYZ'];
const IRISH_GRID_SIZE = 100_000;
const IRISH_GRID_DIM = 5;

/**
 * Convert WGS84 lat/lon to TM65 easting/northing.
 */
export function wgs84ToTM65(lat: number, lon: number): [easting: number, northing: number] {
  const [easting, northing] = proj4('EPSG:4326', 'TM65', [lon, lat]);
  return [easting, northing];
}

/**
 * Format TM65 easting/northing as Irish Grid reference string.
 * Returns format like "V 82345 84123".
 */
export function formatIrishGridReference(easting: number, northing: number, digits = 5): string {
  if (easting < 0 || easting >= 500_000 || northing < 0 || northing >= 500_000) {
    return '—';
  }

  const e100k = Math.floor(easting / IRISH_GRID_SIZE);
  const n100k = Math.floor(northing / IRISH_GRID_SIZE);

  if (e100k < 0 || e100k >= IRISH_GRID_DIM || n100k < 0 || n100k >= IRISH_GRID_DIM) {
    return '—';
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
 * Format WGS84 lat/lon for display: "51.970000°N, 9.700000°W"
 */
export function formatWGS84(lat: number, lon: number): string {
  const latDir = lat >= 0 ? 'N' : 'S';
  const lonDir = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(6)}\u00b0${latDir}, ${Math.abs(lon).toFixed(6)}\u00b0${lonDir}`;
}
