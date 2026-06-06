import type { NormalizedTrackingPosition } from './tracking-types'

// Keep the live map snapshot bounded for long-running hosted sessions. Mission
// persistence still receives incremental positions before older live points
// fall out of this render budget.
const MAX_BREADCRUMB_POSITIONS = 20_000

/**
 * Appends new breadcrumb positions while deduplicating by device and timestamp.
 */
export function appendBreadcrumbPositions(
  existing: readonly NormalizedTrackingPosition[],
  incoming: readonly NormalizedTrackingPosition[],
): readonly NormalizedTrackingPosition[] {
  if (incoming.length === 0) {
    return existing
  }

  const deduplicated = new Map<string, NormalizedTrackingPosition>()

  for (const position of [...existing, ...incoming]) {
    deduplicated.set(createPositionKey(position), position)
  }

  return [...deduplicated.values()]
    .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp))
    .slice(-MAX_BREADCRUMB_POSITIONS)
}

/**
 * Splits breadcrumb positions into line segments when time gaps exceed the threshold.
 */
export function createBreadcrumbSegments(
  positions: readonly NormalizedTrackingPosition[],
  gapThresholdMs: number,
): readonly (readonly NormalizedTrackingPosition[])[] {
  if (positions.length === 0) {
    return []
  }

  const firstPosition = positions[0]
  if (firstPosition === undefined) {
    return []
  }

  const segments: NormalizedTrackingPosition[][] = []
  let currentSegment: NormalizedTrackingPosition[] = [firstPosition]
  let previous = firstPosition

  for (let index = 1; index < positions.length; index += 1) {
    const next = positions[index]
    if (next === undefined) {
      continue
    }

    const gapMs = Date.parse(next.timestamp) - Date.parse(previous.timestamp)

    if (gapMs > gapThresholdMs) {
      segments.push(currentSegment)
      currentSegment = [next]
    } else {
      currentSegment.push(next)
    }

    previous = next
  }

  segments.push(currentSegment)
  return segments
}

/**
 * Decimates breadcrumb points so dots don't pile up at high GPS sample rates.
 * Keeps the first and last point per device segment, skipping intermediate
 * points closer than `minDistanceM` metres to the previously kept point.
 */
export function decimateBreadcrumbsForDots(
  positions: readonly NormalizedTrackingPosition[],
  minDistanceM: number,
): readonly NormalizedTrackingPosition[] {
  if (positions.length <= 2 || minDistanceM <= 0) {
    return positions
  }

  const result: NormalizedTrackingPosition[] = []
  const byDevice = new Map<string, NormalizedTrackingPosition[]>()

  for (const position of positions) {
    const existing = byDevice.get(position.device_id)
    if (existing === undefined) {
      byDevice.set(position.device_id, [position])
    } else {
      existing.push(position)
    }
  }

  for (const [, devicePositions] of byDevice) {
    if (devicePositions.length === 0) {
      continue
    }

    const first = devicePositions[0]!
    result.push(first)
    let lastKept = first

    for (let i = 1; i < devicePositions.length - 1; i++) {
      const current = devicePositions[i]!
      const distance = haversineDistance(lastKept.lat, lastKept.lon, current.lat, current.lon)
      if (distance >= minDistanceM) {
        result.push(current)
        lastKept = current
      }
    }

    if (devicePositions.length > 1) {
      result.push(devicePositions[devicePositions.length - 1]!)
    }
  }

  return result
}

function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function createPositionKey(position: NormalizedTrackingPosition): string {
  return `${position.device_id}:${position.timestamp}`
}
