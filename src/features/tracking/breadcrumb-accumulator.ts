import type {
  BreadcrumbSnapshotMetadata,
  NormalizedTrackingPosition,
} from './tracking-types'

// Keep each live device trail bounded independently while preserving the shape
// of the full requested window. A high-frequency tracker must not evict another
// rescuer's route, and its own older route must not disappear just because the
// device keeps reporting later fixes.
const MAX_BREADCRUMB_POSITIONS_PER_DEVICE = 5_000

export type BreadcrumbAccumulationResult = {
  readonly positions: readonly NormalizedTrackingPosition[]
  readonly metadata: BreadcrumbSnapshotMetadata
}

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

  return accumulateBreadcrumbPositions(existing, incoming).positions
}

/**
 * Appends new breadcrumb positions with per-device render-budget metadata.
 */
export function accumulateBreadcrumbPositions(
  existing: readonly NormalizedTrackingPosition[],
  incoming: readonly NormalizedTrackingPosition[],
): BreadcrumbAccumulationResult {
  // Parse each timestamp exactly once. The previous implementation called
  // Date.parse inside two O(n log n) sort comparators, so per-poll parse cost
  // grew with the entire retained history times a log factor — fine in tests,
  // a hot-path scaling failure during a long multi-device incident [DON-165].
  // Decorating with a precomputed numeric timestamp keeps the same output and
  // ordering while bounding parse calls to the combined set size.
  const deduplicated = new Map<string, TimestampedPosition>()

  for (const position of existing) {
    deduplicated.set(createPositionKey(position), decorateWithTimestamp(position))
  }
  for (const position of incoming) {
    deduplicated.set(createPositionKey(position), decorateWithTimestamp(position))
  }

  const retained: TimestampedPosition[] = []
  const deviceBudgets = [...groupTimestampedByDevice([...deduplicated.values()]).entries()]
    .sort(([leftDeviceId], [rightDeviceId]) => leftDeviceId.localeCompare(rightDeviceId))
    .map(([deviceId, positions]) => {
      const chronological = positions.sort(byTimestampMs)
      const deviceRetained = retainDeviceTrailAcrossWindow(
        chronological,
        MAX_BREADCRUMB_POSITIONS_PER_DEVICE,
      )
      retained.push(...deviceRetained)

      return {
        deviceId,
        retained: deviceRetained.length,
        total: chronological.length,
        firstTimestamp: deviceRetained[0]?.position.timestamp ?? null,
        lastTimestamp: deviceRetained.at(-1)?.position.timestamp ?? null,
        truncated: chronological.length > deviceRetained.length,
      }
    })

  const positions = retained.sort(byTimestampMs).map((entry) => entry.position)

  return {
    positions,
    metadata: {
      totalRetained: positions.length,
      totalObserved: deduplicated.size,
      deviceBudgets,
    },
  }
}

/** A breadcrumb position paired with its parsed timestamp, parsed once per poll. */
type TimestampedPosition = {
  readonly position: NormalizedTrackingPosition
  readonly timestampMs: number
}

function decorateWithTimestamp(position: NormalizedTrackingPosition): TimestampedPosition {
  return { position, timestampMs: Date.parse(position.timestamp) }
}

function byTimestampMs(left: TimestampedPosition, right: TimestampedPosition): number {
  return left.timestampMs - right.timestampMs
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

function groupTimestampedByDevice(
  positions: readonly TimestampedPosition[],
): Map<string, TimestampedPosition[]> {
  const byDevice = new Map<string, TimestampedPosition[]>()
  for (const entry of positions) {
    const existing = byDevice.get(entry.position.device_id)
    if (existing === undefined) {
      byDevice.set(entry.position.device_id, [entry])
    } else {
      existing.push(entry)
    }
  }
  return byDevice
}

function retainDeviceTrailAcrossWindow(
  chronological: readonly TimestampedPosition[],
  maxPositions: number,
): readonly TimestampedPosition[] {
  if (chronological.length <= maxPositions) {
    return chronological
  }
  if (maxPositions <= 0) {
    return []
  }
  if (maxPositions === 1) {
    return [chronological[chronological.length - 1]!]
  }

  const retained: TimestampedPosition[] = []
  let previousIndex = -1
  for (let retainedIndex = 0; retainedIndex < maxPositions; retainedIndex += 1) {
    const sourceIndex = Math.round(
      (retainedIndex * (chronological.length - 1)) / (maxPositions - 1),
    )
    if (sourceIndex === previousIndex) {
      continue
    }
    const position = chronological[sourceIndex]
    if (position !== undefined) {
      retained.push(position)
      previousIndex = sourceIndex
    }
  }

  return retained
}

function createPositionKey(position: NormalizedTrackingPosition): string {
  return `${position.device_id}:${position.timestamp}`
}
