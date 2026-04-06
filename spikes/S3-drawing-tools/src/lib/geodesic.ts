/**
 * Geodesic helpers for drawing operations.
 *
 * Pure TypeScript math utilities — direct port of Python drawing_math.py.
 * Copied from S2 spike with zero modifications to preserve accuracy parity.
 *
 * All functions use [lon, lat] tuples to match GeoJSON convention.
 */

// WGS84 ellipsoid constants
const WGS84_A = 6378137.0; // semi-major axis
const WGS84_F = 1 / 298.257223563;
const WGS84_B = WGS84_A * (1 - WGS84_F); // semi-minor axis

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

/** Compute Earth radius at a given latitude using WGS84 ellipsoid. */
function earthRadiusAtLat(latRad: number): number {
  const cosLat = Math.cos(latRad);
  const sinLat = Math.sin(latRad);

  const numerator = (WGS84_A * WGS84_A * cosLat) ** 2 + (WGS84_B * WGS84_B * sinLat) ** 2;
  const denominator = (WGS84_A * cosLat) ** 2 + (WGS84_B * sinLat) ** 2;

  if (denominator < 1e-10) return WGS84_B;

  return Math.sqrt(numerator / denominator);
}

/** Calculate initial geodesic bearing from origin to destination. */
export function geodesicBearing(
  originLon: number, originLat: number,
  destLon: number, destLat: number
): number {
  const lat1 = originLat * DEG_TO_RAD;
  const lat2 = destLat * DEG_TO_RAD;
  const dlon = (destLon - originLon) * DEG_TO_RAD;

  const x = Math.sin(dlon) * Math.cos(lat2);
  const y = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dlon);

  const bearingRad = Math.atan2(x, y);
  return ((bearingRad * RAD_TO_DEG) + 360) % 360;
}

/** Compute endpoint from origin, bearing, and distance using WGS84. */
export function geodesicBearingEndpoint(
  originLon: number, originLat: number,
  bearing: number, distanceM: number
): [lon: number, lat: number] {
  const bearingRad = bearing * DEG_TO_RAD;
  const lat1 = originLat * DEG_TO_RAD;
  const lon1 = originLon * DEG_TO_RAD;

  const R = earthRadiusAtLat(lat1);
  const angularDist = distanceM / R;

  let sinLat2 = Math.sin(lat1) * Math.cos(angularDist) +
    Math.cos(lat1) * Math.sin(angularDist) * Math.cos(bearingRad);
  sinLat2 = Math.max(-1, Math.min(1, sinLat2));
  const lat2 = Math.asin(sinLat2);

  const lon2 = lon1 + Math.atan2(
    Math.sin(bearingRad) * Math.sin(angularDist) * Math.cos(lat1),
    Math.cos(angularDist) - Math.sin(lat1) * Math.sin(lat2)
  );

  return [lon2 * RAD_TO_DEG, lat2 * RAD_TO_DEG];
}

/** Generate geodesic circle points around a center. */
export function geodesicCirclePoints(
  centerLon: number, centerLat: number,
  radiusM: number, segments: number = 64
): Array<[lon: number, lat: number]> {
  const latRad = centerLat * DEG_TO_RAD;
  const R = earthRadiusAtLat(latRad);
  const angularDist = radiusM / R;

  const points: Array<[number, number]> = [];
  for (let i = 0; i <= segments; i++) {
    const bearing = (360.0 * i) / segments;
    const bearingRad = bearing * DEG_TO_RAD;
    const lonRad = centerLon * DEG_TO_RAD;

    let sinLat2 = Math.sin(latRad) * Math.cos(angularDist) +
      Math.cos(latRad) * Math.sin(angularDist) * Math.cos(bearingRad);
    sinLat2 = Math.max(-1, Math.min(1, sinLat2));
    const lat2 = Math.asin(sinLat2);

    const lon2 = lonRad + Math.atan2(
      Math.sin(bearingRad) * Math.sin(angularDist) * Math.cos(latRad),
      Math.cos(angularDist) - Math.sin(latRad) * Math.sin(lat2)
    );

    points.push([lon2 * RAD_TO_DEG, lat2 * RAD_TO_DEG]);
  }

  return points;
}

/** Calculate clockwise arc length between two bearings. CRITICAL FOR SAR OPERATIONS. */
export function calculateSectorArcLength(startBearing: number, endBearing: number): number {
  const start = ((startBearing % 360) + 360) % 360;
  const end = ((endBearing % 360) + 360) % 360;

  if (start === end) {
    const angleDiff = Math.abs(endBearing - startBearing);
    const startNormalized = startBearing >= 0 && startBearing < 360;
    const endNormalized = endBearing >= 0 && endBearing < 360;

    if (angleDiff === 360 && startNormalized && !endNormalized) {
      return 360.0;
    } else if (angleDiff > 180 && angleDiff < 360) {
      return 360.0;
    } else {
      return 0.0;
    }
  }

  let adjustedEnd = end;
  if (end < start) adjustedEnd += 360;

  const arcLength = adjustedEnd - start;

  if (arcLength < 0 || arcLength > 360) {
    throw new Error(`Invalid arc length: ${arcLength}° (start=${startBearing}°, end=${endBearing}°)`);
  }

  return arcLength;
}

/** Generate sector (wedge) polygon points. */
export function geodesicSectorPoints(
  centerLon: number, centerLat: number,
  startBearing: number, endBearing: number,
  radiusM: number, numSegments: number = 36
): Array<[lon: number, lat: number]> {
  let angleRange = endBearing - startBearing;
  if (angleRange < 0) angleRange += 360;

  const lat1 = centerLat * DEG_TO_RAD;
  const lon1 = centerLon * DEG_TO_RAD;
  const R = earthRadiusAtLat(lat1);
  const angularDist = radiusM / R;

  const points: Array<[number, number]> = [[centerLon, centerLat]];
  for (let i = 0; i <= numSegments; i++) {
    const angle = startBearing + (angleRange * i) / numSegments;
    const angleRad = angle * DEG_TO_RAD;

    let sinLat2 = Math.sin(lat1) * Math.cos(angularDist) +
      Math.cos(lat1) * Math.sin(angularDist) * Math.cos(angleRad);
    sinLat2 = Math.max(-1, Math.min(1, sinLat2));
    const lat2 = Math.asin(sinLat2);

    const lon2 = lon1 + Math.atan2(
      Math.sin(angleRad) * Math.sin(angularDist) * Math.cos(lat1),
      Math.cos(angularDist) - Math.sin(lat1) * Math.sin(lat2)
    );

    points.push([lon2 * RAD_TO_DEG, lat2 * RAD_TO_DEG]);
  }

  points.push([centerLon, centerLat]);
  return points;
}

/** Compute geodesic distance between two WGS84 points in metres. */
export function geodesicDistance(
  lon1: number, lat1: number,
  lon2: number, lat2: number
): number {
  const lat1Rad = lat1 * DEG_TO_RAD;
  const lat2Rad = lat2 * DEG_TO_RAD;
  const dLat = (lat2 - lat1) * DEG_TO_RAD;
  const dLon = (lon2 - lon1) * DEG_TO_RAD;

  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1Rad) * Math.cos(lat2Rad) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  const R = earthRadiusAtLat((lat1Rad + lat2Rad) / 2);
  return R * c;
}

/** Compute area of a polygon on WGS84 ellipsoid using spherical excess formula (sq metres). */
export function geodesicPolygonArea(ring: Array<[number, number]>): number {
  // Use the shoelface formula on a sphere (simplified)
  // For better accuracy we use the same approach as Turf.js
  const n = ring.length;
  if (n < 3) return 0;

  let area = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const [lon1, lat1] = ring[i];
    const [lon2, lat2] = ring[j];

    area += (lon2 - lon1) * DEG_TO_RAD *
      (2 + Math.sin(lat1 * DEG_TO_RAD) + Math.sin(lat2 * DEG_TO_RAD));
  }

  const R = 6371008.8; // mean earth radius
  area = Math.abs(area * R * R / 2);
  return area;
}

/** Ireland magnetic declination (approximate, 2024). */
export const IRELAND_MAGNETIC_DECLINATION = -4.5;

/** Convert magnetic bearing to true bearing. */
export function magneticToTrue(magneticBearing: number): number {
  return ((magneticBearing - IRELAND_MAGNETIC_DECLINATION) + 360) % 360;
}

/** Convert true bearing to magnetic bearing. */
export function trueToMagnetic(trueBearing: number): number {
  return ((trueBearing + IRELAND_MAGNETIC_DECLINATION) + 360) % 360;
}

// ============================================================================
// Irish Transverse Mercator (ITM) — EPSG:2157
// ============================================================================

// ITM projection parameters
const ITM_LAT0 = 53.5 * DEG_TO_RAD;       // latitude of origin
const ITM_LON0 = -8.0 * DEG_TO_RAD;       // central meridian
const ITM_K0 = 0.99982;                    // scale factor
const ITM_FALSE_EASTING = 600000;          // false easting (m)
const ITM_FALSE_NORTHING = 750000;         // false northing (m)

// WGS84 eccentricity squared
const WGS84_E2 = 2 * WGS84_F - WGS84_F * WGS84_F;
const WGS84_E4 = WGS84_E2 * WGS84_E2;
const WGS84_E6 = WGS84_E4 * WGS84_E2;

/** Meridional arc from equator to latitude (Helmert series). */
function meridionalArc(lat: number): number {
  const n = (WGS84_A - WGS84_B) / (WGS84_A + WGS84_B);
  const n2 = n * n;
  const n3 = n2 * n;

  const A0 = 1 + n2 / 4 + n2 * n2 / 64;
  const A2 = 1.5 * (n - n3 / 8);
  const A4 = 15 / 16 * (n2 - n2 * n2 / 4);
  const A6 = 35 / 48 * n3;

  return ((WGS84_A + WGS84_B) / 2) * (A0 * lat - A2 * Math.sin(2 * lat) + A4 * Math.sin(4 * lat) - A6 * Math.sin(6 * lat));
}

/** Convert WGS84 (lon, lat) in degrees to Irish Transverse Mercator (easting, northing) in metres. */
export function wgs84ToITM(lon: number, lat: number): { easting: number; northing: number } {
  const latRad = lat * DEG_TO_RAD;
  const lonRad = lon * DEG_TO_RAD;

  const sinLat = Math.sin(latRad);
  const cosLat = Math.cos(latRad);
  const tanLat = Math.tan(latRad);

  const nu = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);
  const rho = WGS84_A * (1 - WGS84_E2) / Math.pow(1 - WGS84_E2 * sinLat * sinLat, 1.5);
  const eta2 = nu / rho - 1;

  const dLon = lonRad - ITM_LON0;
  const dLon2 = dLon * dLon;

  const M = meridionalArc(latRad);
  const M0 = meridionalArc(ITM_LAT0);

  const T = tanLat * tanLat;
  const C = WGS84_E2 * cosLat * cosLat / (1 - WGS84_E2);
  const A = dLon * cosLat;
  const A2 = A * A;

  const easting = ITM_FALSE_EASTING + ITM_K0 * nu * (
    A + (1 - T + C) * A2 * A / 6 +
    (5 - 18 * T + T * T + 72 * C - 58 * eta2) * A2 * A2 * A / 120
  );

  const northing = ITM_FALSE_NORTHING + ITM_K0 * (
    M - M0 +
    nu * tanLat * (
      A2 / 2 +
      (5 - T + 9 * C + 4 * C * C) * A2 * A2 / 24 +
      (61 - 58 * T + T * T + 600 * C - 330 * eta2) * A2 * A2 * A2 / 720
    )
  );

  return { easting, northing };
}

/** Format ITM coordinates as a readable string. */
export function formatITM(easting: number, northing: number): string {
  return `E ${Math.round(easting)}, N ${Math.round(northing)}`;
}
