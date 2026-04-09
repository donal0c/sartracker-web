const WGS84_A = 6_378_137.0
const WGS84_F = 1 / 298.257223563
const WGS84_B = WGS84_A * (1 - WGS84_F)

const DEG_TO_RAD = Math.PI / 180
const RAD_TO_DEG = 180 / Math.PI

export const IRELAND_MAGNETIC_DECLINATION = -4.5

export type LonLat = readonly [lon: number, lat: number]

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
  return ((bearing % 360) + 360) % 360
}

export function magneticToTrue(magneticBearing: number): number {
  return normalizeBearing(magneticBearing - IRELAND_MAGNETIC_DECLINATION)
}

export function trueToMagnetic(trueBearing: number): number {
  return normalizeBearing(trueBearing + IRELAND_MAGNETIC_DECLINATION)
}

export function geodesicBearing(
  originLon: number,
  originLat: number,
  destLon: number,
  destLat: number,
): number {
  const lat1 = originLat * DEG_TO_RAD
  const lat2 = destLat * DEG_TO_RAD
  const dLon = (destLon - originLon) * DEG_TO_RAD

  const x = Math.sin(dLon) * Math.cos(lat2)
  const y =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon)

  return normalizeBearing(Math.atan2(x, y) * RAD_TO_DEG)
}

export function geodesicBearingEndpoint(
  originLon: number,
  originLat: number,
  bearing: number,
  distanceM: number,
): LonLat {
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

  return [lon2 * RAD_TO_DEG, lat2 * RAD_TO_DEG]
}

export function geodesicDistance(
  lon1: number,
  lat1: number,
  lon2: number,
  lat2: number,
): number {
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

export function geodesicCirclePoints(
  centerLon: number,
  centerLat: number,
  radiusM: number,
  segments: number = 64,
): readonly LonLat[] {
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

    points.push([lon2 * RAD_TO_DEG, lat2 * RAD_TO_DEG])
  }

  return points
}

export function calculateSectorArcLength(startBearing: number, endBearing: number): number {
  const start = normalizeBearing(startBearing)
  const end = normalizeBearing(endBearing)

  if (start === end) {
    const difference = Math.abs(endBearing - startBearing)
    const startNormalized = startBearing >= 0 && startBearing < 360
    const endNormalized = endBearing >= 0 && endBearing < 360

    if (difference === 360 && startNormalized && !endNormalized) {
      return 360
    }

    if (difference > 180 && difference < 360) {
      return 360
    }

    return 0
  }

  const adjustedEnd = end < start ? end + 360 : end
  const arcLength = adjustedEnd - start

  if (arcLength < 0 || arcLength > 360) {
    throw new Error(`Invalid arc length: ${arcLength}`)
  }

  return arcLength
}

export function geodesicSectorPoints(
  centerLon: number,
  centerLat: number,
  startBearing: number,
  endBearing: number,
  radiusM: number,
  segments: number = 36,
): readonly LonLat[] {
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

    points.push([lon2 * RAD_TO_DEG, lat2 * RAD_TO_DEG])
  }

  points.push([centerLon, centerLat])
  return points
}

export function geodesicPolygonArea(ring: readonly LonLat[]): number {
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
  return distanceM >= 1000 ? `${(distanceM / 1000).toFixed(2)} km` : `${distanceM.toFixed(0)} m`
}
