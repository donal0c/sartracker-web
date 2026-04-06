/**
 * Geodesic helpers for drawing operations.
 *
 * Pure TypeScript math utilities (no proj4 imports) to allow unit testing
 * without CRS dependencies. Direct port of Python drawing_math.py.
 *
 * All functions return [lon, lat] tuples to match GeoJSON convention.
 */

// WGS84 ellipsoid constants
const WGS84_A = 6378137.0; // semi-major axis
const WGS84_F = 1 / 298.257223563;
const WGS84_B = WGS84_A * (1 - WGS84_F); // semi-minor axis

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

/**
 * Compute Earth radius at a given latitude using WGS84 ellipsoid.
 */
function earthRadiusAtLat(latRad: number): number {
  const cosLat = Math.cos(latRad);
  const sinLat = Math.sin(latRad);

  const numerator = (WGS84_A * WGS84_A * cosLat) ** 2 + (WGS84_B * WGS84_B * sinLat) ** 2;
  const denominator = (WGS84_A * cosLat) ** 2 + (WGS84_B * sinLat) ** 2;

  if (denominator < 1e-10) return WGS84_B;

  return Math.sqrt(numerator / denominator);
}

/**
 * Calculate the initial geodesic bearing from origin to destination.
 *
 * Uses spherical trigonometry formula for forward azimuth, which provides
 * accuracy better than 0.1 deg for distances under 100km at mid-latitudes.
 *
 * @returns Initial bearing in degrees (0-360, where 0 = North)
 */
export function geodesicBearing(
  originLon: number,
  originLat: number,
  destLon: number,
  destLat: number
): number {
  const lat1 = originLat * DEG_TO_RAD;
  const lat2 = destLat * DEG_TO_RAD;
  const dlon = (destLon - originLon) * DEG_TO_RAD;

  const x = Math.sin(dlon) * Math.cos(lat2);
  const y =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dlon);

  const bearingRad = Math.atan2(x, y);
  return ((bearingRad * RAD_TO_DEG) + 360) % 360;
}

/**
 * Compute the endpoint from an origin, bearing, and distance using WGS84.
 *
 * @returns [lon, lat] of the endpoint
 */
export function geodesicBearingEndpoint(
  originLon: number,
  originLat: number,
  bearing: number,
  distanceM: number
): [lon: number, lat: number] {
  const bearingRad = bearing * DEG_TO_RAD;
  const lat1 = originLat * DEG_TO_RAD;
  const lon1 = originLon * DEG_TO_RAD;

  const R = earthRadiusAtLat(lat1);
  const angularDist = distanceM / R;

  let sinLat2 =
    Math.sin(lat1) * Math.cos(angularDist) +
    Math.cos(lat1) * Math.sin(angularDist) * Math.cos(bearingRad);
  sinLat2 = Math.max(-1, Math.min(1, sinLat2));
  const lat2 = Math.asin(sinLat2);

  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(bearingRad) * Math.sin(angularDist) * Math.cos(lat1),
      Math.cos(angularDist) - Math.sin(lat1) * Math.sin(lat2)
    );

  return [lon2 * RAD_TO_DEG, lat2 * RAD_TO_DEG];
}

/**
 * Generate geodesic circle points around a center.
 *
 * @returns Array of [lon, lat] points
 */
export function geodesicCirclePoints(
  centerLon: number,
  centerLat: number,
  radiusM: number,
  segments: number = 64
): Array<[lon: number, lat: number]> {
  const latRad = centerLat * DEG_TO_RAD;
  const R = earthRadiusAtLat(latRad);
  const angularDist = radiusM / R;

  const points: Array<[number, number]> = [];
  for (let i = 0; i <= segments; i++) {
    const bearing = (360.0 * i) / segments;
    const bearingRad = bearing * DEG_TO_RAD;
    const lonRad = centerLon * DEG_TO_RAD;

    let sinLat2 =
      Math.sin(latRad) * Math.cos(angularDist) +
      Math.cos(latRad) * Math.sin(angularDist) * Math.cos(bearingRad);
    sinLat2 = Math.max(-1, Math.min(1, sinLat2));
    const lat2 = Math.asin(sinLat2);

    const lon2 =
      lonRad +
      Math.atan2(
        Math.sin(bearingRad) * Math.sin(angularDist) * Math.cos(latRad),
        Math.cos(angularDist) - Math.sin(latRad) * Math.sin(lat2)
      );

    points.push([lon2 * RAD_TO_DEG, lat2 * RAD_TO_DEG]);
  }

  return points;
}

/**
 * Calculate the clockwise arc length between two bearings.
 *
 * CRITICAL FOR SAR OPERATIONS: This calculation determines search area size.
 */
export function calculateSectorArcLength(
  startBearing: number,
  endBearing: number
): number {
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
  if (end < start) {
    adjustedEnd += 360;
  }

  const arcLength = adjustedEnd - start;

  if (arcLength < 0 || arcLength > 360) {
    throw new Error(
      `Invalid arc length calculated: ${arcLength} deg (start=${startBearing} deg, end=${endBearing} deg)`
    );
  }

  return arcLength;
}

/**
 * Generate sector (wedge) points starting at center, sweeping bearings, closing to center.
 *
 * @returns Array of [lon, lat] points
 */
export function geodesicSectorPoints(
  centerLon: number,
  centerLat: number,
  startBearing: number,
  endBearing: number,
  radiusM: number,
  numSegments: number = 36
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

    let sinLat2 =
      Math.sin(lat1) * Math.cos(angularDist) +
      Math.cos(lat1) * Math.sin(angularDist) * Math.cos(angleRad);
    sinLat2 = Math.max(-1, Math.min(1, sinLat2));
    const lat2 = Math.asin(sinLat2);

    const lon2 =
      lon1 +
      Math.atan2(
        Math.sin(angleRad) * Math.sin(angularDist) * Math.cos(lat1),
        Math.cos(angularDist) - Math.sin(lat1) * Math.sin(lat2)
      );

    points.push([lon2 * RAD_TO_DEG, lat2 * RAD_TO_DEG]);
  }

  points.push([centerLon, centerLat]);
  return points;
}
