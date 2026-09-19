const WGS84_A = 6_378_137.0
const WGS84_F = 1 / 298.257223563
const WGS84_B = WGS84_A * (1 - WGS84_F)

const DEG_TO_RAD = Math.PI / 180
const RAD_TO_DEG = 180 / Math.PI
const WGS84_LON_MIN = -180
const WGS84_LON_MAX = 180
const WGS84_LAT_MIN = -90
const WGS84_LAT_MAX = 90
const BEARING_MIN = 0
const BEARING_MAX = 360

/** Maximum number of synchronous segments accepted by one geodesic geometry call. */
export const MAX_GEODESIC_SEGMENTS = 4_096

export const IRELAND_MAGNETIC_DECLINATION = -4.5

export type LonLat = readonly [lon: number, lat: number]

/**
 * Validates a WGS84 longitude/latitude pair at a public drawing-math boundary.
 */
export function assertValidWgs84Coordinate(
  lon: number,
  lat: number,
  context: string = 'drawing math',
): void {
  assertFiniteNumber(lon, 'longitude', context)
  assertFiniteNumber(lat, 'latitude', context)

  if (lon < WGS84_LON_MIN || lon > WGS84_LON_MAX) {
    throw new RangeError(
      `${context}: longitude outside [${WGS84_LON_MIN}, ${WGS84_LON_MAX}]: ${lon}`,
    )
  }
  if (lat < WGS84_LAT_MIN || lat > WGS84_LAT_MAX) {
    throw new RangeError(
      `${context}: latitude outside [${WGS84_LAT_MIN}, ${WGS84_LAT_MAX}]: ${lat}`,
    )
  }
}

/**
 * Validates a compass bearing in the existing inclusive 0–360 degree contract.
 */
export function assertValidBearing(bearing: number, context: string = 'drawing math'): void {
  assertFiniteNumber(bearing, 'bearing', context)
  if (bearing < BEARING_MIN || bearing > BEARING_MAX) {
    throw new RangeError(
      `${context}: bearing outside [${BEARING_MIN}, ${BEARING_MAX}] degrees: ${bearing}`,
    )
  }
}

/**
 * Validates a positive distance or radius used to construct geometry.
 */
export function assertPositiveDistance(
  distanceM: number,
  name: 'distanceM' | 'radiusM',
  context: string,
): void {
  assertFiniteNumber(distanceM, name, context)
  if (distanceM <= 0) {
    throw new RangeError(`${context}: ${name} must be positive, got ${distanceM}`)
  }
}

/**
 * Validates a non-negative distance used by endpoint and measurement math.
 */
export function assertNonNegativeDistance(
  distanceM: number,
  context: string,
): void {
  assertFiniteNumber(distanceM, 'distanceM', context)
  if (distanceM < 0) {
    throw new RangeError(`${context}: distanceM must be non-negative, got ${distanceM}`)
  }
}

/**
 * Validates the bounded integer segment count used by synchronous geometry loops.
 */
export function assertValidGeodesicSegments(
  segments: number,
  context: string,
): void {
  assertFiniteNumber(segments, 'segments', context)
  if (!Number.isInteger(segments) || segments <= 0 || segments > MAX_GEODESIC_SEGMENTS) {
    throw new RangeError(
      `${context}: segments must be a positive integer <= ${MAX_GEODESIC_SEGMENTS}, got ${segments}`,
    )
  }
}

function assertFiniteNumber(value: number, name: string, context: string): void {
  if (typeof value !== 'number') {
    throw new TypeError(`${context}: ${name} must be a number, got ${typeof value}`)
  }
  if (!Number.isFinite(value)) {
    throw new RangeError(`${context}: ${name} must be finite, got ${String(value)}`)
  }
}

function normalizeLongitude(longitude: number): number {
  return ((longitude + 180) % 360 + 360) % 360 - 180
}

function earthRadiusAtLat(latRad: number): number {
  const cosLat = Math.cos(latRad)
  const sinLat = Math.sin(latRad)
  const numerator = (WGS84_A * WGS84_A * cosLat) ** 2 + (WGS84_B * WGS84_B * sinLat) ** 2
  const denominator = (WGS84_A * cosLat) ** 2 + (WGS84_B * sinLat) ** 2

  if (denominator < 1e-10) {
    return WGS84_B
  }

  return Math.sqrt(numerator / denominator)
}

export function normalizeBearing(bearing: number): number {
  assertFiniteNumber(bearing, 'bearing', 'normalizeBearing')
  return ((bearing % 360) + 360) % 360
}

export function magneticToTrue(magneticBearing: number): number {
  assertValidBearing(magneticBearing, 'magneticToTrue')
  return normalizeBearing(magneticBearing - IRELAND_MAGNETIC_DECLINATION)
}

export function trueToMagnetic(trueBearing: number): number {
  assertValidBearing(trueBearing, 'trueToMagnetic')
  return normalizeBearing(trueBearing + IRELAND_MAGNETIC_DECLINATION)
}

/**
 * Computes the initial true bearing (degrees, 0–360) from origin to destination.
 *
 * Returns `null` when origin and destination are the same location: the bearing of a
 * zero-length vector is mathematically undefined, and reporting `0` (due north) would
 * misrepresent a stationary device or a degenerate drawing as heading north. Callers
 * must handle the `null` case explicitly (e.g. show "–" rather than a fabricated heading).
 */
export function geodesicBearing(
  originLon: number,
  originLat: number,
  destLon: number,
  destLat: number,
): number | null {
  assertValidWgs84Coordinate(originLon, originLat, 'geodesicBearing')
  assertValidWgs84Coordinate(destLon, destLat, 'geodesicBearing')

  const lat1 = originLat * DEG_TO_RAD
  const lat2 = destLat * DEG_TO_RAD
  const dLon = (destLon - originLon) * DEG_TO_RAD

  const x = Math.sin(dLon) * Math.cos(lat2)
  const y =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon)

  if (x === 0 && y === 0) {
    return null
  }

  return normalizeBearing(Math.atan2(x, y) * RAD_TO_DEG)
}

/**
 * Computes the WGS84 endpoint reached by travelling `distanceM` metres along a great
 * circle from the origin at the given true bearing.
 *
 * A negative `distanceM` is rejected: it would reflect the endpoint to the opposite
 * side of the origin (because `sin(-d) = -sin(d)`), silently placing a computed point
 * in the wrong direction. A zero distance is allowed and returns the origin.
 */
export function geodesicBearingEndpoint(
  originLon: number,
  originLat: number,
  bearing: number,
  distanceM: number,
): LonLat {
  assertValidWgs84Coordinate(originLon, originLat, 'geodesicBearingEndpoint')
  assertValidBearing(bearing, 'geodesicBearingEndpoint')
  assertNonNegativeDistance(distanceM, 'geodesicBearingEndpoint')

  if (distanceM === 0) {
    return [originLon, originLat]
  }

  const bearingRad = bearing * DEG_TO_RAD
  const lat1 = originLat * DEG_TO_RAD
  const lon1 = originLon * DEG_TO_RAD
  const earthRadius = earthRadiusAtLat(lat1)
  const angularDistance = distanceM / earthRadius

  let sinLat2 =
    Math.sin(lat1) * Math.cos(angularDistance) +
    Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearingRad)
  sinLat2 = Math.max(-1, Math.min(1, sinLat2))
  const lat2 = Math.asin(sinLat2)
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(bearingRad) * Math.sin(angularDistance) * Math.cos(lat1),
      Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2),
    )

  return [normalizeLongitude(lon2 * RAD_TO_DEG), lat2 * RAD_TO_DEG]
}

export function geodesicDistance(
  lon1: number,
  lat1: number,
  lon2: number,
  lat2: number,
): number {
  assertValidWgs84Coordinate(lon1, lat1, 'geodesicDistance')
  assertValidWgs84Coordinate(lon2, lat2, 'geodesicDistance')

  const lat1Rad = lat1 * DEG_TO_RAD
  const lat2Rad = lat2 * DEG_TO_RAD
  const dLat = (lat2 - lat1) * DEG_TO_RAD
  const dLon = (lon2 - lon1) * DEG_TO_RAD
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1Rad) * Math.cos(lat2Rad) * Math.sin(dLon / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return earthRadiusAtLat((lat1Rad + lat2Rad) / 2) * c
}

/**
 * Generates the WGS84 ring of a geodesic circle of `radiusM` metres around the centre.
 *
 * `radiusM` must be strictly positive: a non-positive radius produces a degenerate or
 * mirrored ring with no visual cue that the geometry is wrong.
 */
export function geodesicCirclePoints(
  centerLon: number,
  centerLat: number,
  radiusM: number,
  segments: number = 64,
): readonly LonLat[] {
  assertValidWgs84Coordinate(centerLon, centerLat, 'geodesicCirclePoints')
  assertPositiveDistance(radiusM, 'radiusM', 'geodesicCirclePoints')
  assertValidGeodesicSegments(segments, 'geodesicCirclePoints')

  const latRad = centerLat * DEG_TO_RAD
  const earthRadius = earthRadiusAtLat(latRad)
  const angularDistance = radiusM / earthRadius
  const lonRad = centerLon * DEG_TO_RAD
  const points: LonLat[] = []

  for (let index = 0; index <= segments; index += 1) {
    const bearing = (360 * index) / segments
    const bearingRad = bearing * DEG_TO_RAD
    let sinLat2 =
      Math.sin(latRad) * Math.cos(angularDistance) +
      Math.cos(latRad) * Math.sin(angularDistance) * Math.cos(bearingRad)
    sinLat2 = Math.max(-1, Math.min(1, sinLat2))
    const lat2 = Math.asin(sinLat2)
    const lon2 =
      lonRad +
      Math.atan2(
        Math.sin(bearingRad) * Math.sin(angularDistance) * Math.cos(latRad),
        Math.cos(angularDistance) - Math.sin(latRad) * Math.sin(lat2),
      )

    points.push([normalizeLongitude(lon2 * RAD_TO_DEG), lat2 * RAD_TO_DEG])
  }

  return points
}

/**
 * Returns the angular sweep (0–360°) of a search sector from `startBearing` to
 * `endBearing`, measured clockwise.
 *
 * When the two normalised bearings coincide the sweep is ambiguous between a zero-arc
 * and a full circle. A raw difference of exactly 360° (e.g. `360 → 0` or `0 → 360`,
 * the natural ways an operator expresses a full search circle) is treated as a full
 * circle and returns 360; a true zero-length input (e.g. `45 → 45`) returns 0.
 */
export function calculateSectorArcLength(startBearing: number, endBearing: number): number {
  assertValidBearing(startBearing, 'calculateSectorArcLength')
  assertValidBearing(endBearing, 'calculateSectorArcLength')

  const start = normalizeBearing(startBearing)
  const end = normalizeBearing(endBearing)

  if (start === end) {
    // The two bearings normalise to the same heading, so their raw difference is always
    // a multiple of 360. A non-zero multiple (e.g. 360→0, 0→360) is the operator's way
    // of expressing a full search circle and sweeps 360°; an exact zero difference
    // (e.g. 45→45) is a genuine zero-length arc. Using the absolute difference avoids
    // the previous bug where a strict `< 360` range check excluded a startBearing of 360.
    return Math.abs(endBearing - startBearing) >= 360 ? 360 : 0
  }

  const adjustedEnd = end < start ? end + 360 : end
  const arcLength = adjustedEnd - start

  if (arcLength < 0 || arcLength > 360) {
    throw new Error(`Invalid arc length: ${arcLength}`)
  }

  return arcLength
}

/**
 * Generates the closed WGS84 polygon ring of a search sector: centre → arc → centre.
 *
 * `radiusM` must be strictly positive. A non-positive radius mirrors the sector across
 * the origin into the opposite quadrant (~10 km displacement for a 5 km sector) while
 * still producing a valid-looking, well-formed polygon — exactly the kind of silent,
 * confident error this guard exists to prevent.
 */
export function geodesicSectorPoints(
  centerLon: number,
  centerLat: number,
  startBearing: number,
  endBearing: number,
  radiusM: number,
  segments: number = 36,
): readonly LonLat[] {
  assertValidWgs84Coordinate(centerLon, centerLat, 'geodesicSectorPoints')
  assertValidBearing(startBearing, 'geodesicSectorPoints')
  assertValidBearing(endBearing, 'geodesicSectorPoints')
  assertPositiveDistance(radiusM, 'radiusM', 'geodesicSectorPoints')
  assertValidGeodesicSegments(segments, 'geodesicSectorPoints')

  const angleRange = calculateSectorArcLength(startBearing, endBearing)
  const lat1 = centerLat * DEG_TO_RAD
  const lon1 = centerLon * DEG_TO_RAD
  const earthRadius = earthRadiusAtLat(lat1)
  const angularDistance = radiusM / earthRadius
  const points: LonLat[] = [[centerLon, centerLat]]

  for (let index = 0; index <= segments; index += 1) {
    const angle = startBearing + (angleRange * index) / segments
    const angleRad = normalizeBearing(angle) * DEG_TO_RAD
    let sinLat2 =
      Math.sin(lat1) * Math.cos(angularDistance) +
      Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(angleRad)
    sinLat2 = Math.max(-1, Math.min(1, sinLat2))
    const lat2 = Math.asin(sinLat2)
    const lon2 =
      lon1 +
      Math.atan2(
        Math.sin(angleRad) * Math.sin(angularDistance) * Math.cos(lat1),
        Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2),
      )

    points.push([normalizeLongitude(lon2 * RAD_TO_DEG), lat2 * RAD_TO_DEG])
  }

  points.push([centerLon, centerLat])
  return points
}

export function geodesicPolygonArea(ring: readonly LonLat[]): number {
  for (const [lon, lat] of ring) {
    assertValidWgs84Coordinate(lon, lat, 'geodesicPolygonArea')
  }

  if (ring.length < 3) {
    return 0
  }

  let area = 0
  for (let index = 0; index < ring.length; index += 1) {
    const nextIndex = (index + 1) % ring.length
    const current = ring[index]!
    const next = ring[nextIndex]!
    const [lon1, lat1] = current
    const [lon2, lat2] = next
    area +=
      (lon2 - lon1) *
      DEG_TO_RAD *
      (2 + Math.sin(lat1 * DEG_TO_RAD) + Math.sin(lat2 * DEG_TO_RAD))
  }

  const meanEarthRadius = 6_371_008.8
  return Math.abs((area * meanEarthRadius * meanEarthRadius) / 2)
}

export function formatDistance(distanceM: number): string {
  assertNonNegativeDistance(distanceM, 'formatDistance')
  return distanceM >= 1000 ? `${(distanceM / 1000).toFixed(2)} km` : `${distanceM.toFixed(0)} m`
}
