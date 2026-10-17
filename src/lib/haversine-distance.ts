/** Mean Earth radius in metres; the same constant Turf uses, so results match it exactly. */
const EARTH_RADIUS_M = 6_371_008.8

/** Converts degrees to radians with Turf's own normalisation, keeping results bit-identical. */
function degreesToRadians(degrees: number): number {
  return ((degrees % 360) * Math.PI) / 180
}

/** Throws when a WGS84 latitude/longitude pair is not finite or out of range. */
function assertValidWgs84(lat: number, lon: number): void {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    throw new RangeError(
      `haversineDistanceMetres: invalid WGS84 coordinate (lat ${String(lat)}, lon ${String(lon)}); ` +
        'latitude must be -90..90 and longitude -180..180.',
    )
  }
}

/**
 * Great-circle distance in metres between two WGS84 fixes, without allocating.
 *
 * Same haversine formula and radius as Turf `distance(point, point, { units: 'meters' })`,
 * which builds two GeoJSON points per call; hot tracking paths call this per fix pair,
 * so the allocation-free form keeps renderer garbage down [DON-312].
 */
export function haversineDistanceMetres(lat1: number, lon1: number, lat2: number, lon2: number): number {
  assertValidWgs84(lat1, lon1)
  assertValidWgs84(lat2, lon2)
  const dLat = degreesToRadians(lat2 - lat1)
  const dLon = degreesToRadians(lon2 - lon1)
  const a =
    Math.pow(Math.sin(dLat / 2), 2) +
    Math.pow(Math.sin(dLon / 2), 2) * Math.cos(degreesToRadians(lat1)) * Math.cos(degreesToRadians(lat2))
  return 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * EARTH_RADIUS_M
}
