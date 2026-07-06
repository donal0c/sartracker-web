import type {
  BreadcrumbSnapshotMetadata,
  NormalizedTrackingPosition,
} from './tracking-types'
import { createTrackingPositionIdentityKey } from './tracking-position-identity'

// Keep each live device trail bounded independently while preserving the shape
// of the full requested window. A high-frequency tracker must not evict another
// rescuer's route, and its own older route must not disappear just because the
// device keeps reporting later fixes.
const MAX_BREADCRUMB_POSITIONS_PER_DEVICE = 5_000
const MAX_SOURCE_POSITIONS_PER_DEVICE = MAX_BREADCRUMB_POSITIONS_PER_DEVICE * 2
const parsedTimestampByPosition = new WeakMap<NormalizedTrackingPosition, number>()

export type BreadcrumbAccumulationResult = {
  readonly positions: readonly NormalizedTrackingPosition[]
  readonly metadata: BreadcrumbSnapshotMetadata
}

export type BreadcrumbAccumulator = {
  readonly append: (
    incoming: readonly NormalizedTrackingPosition[],
  ) => BreadcrumbAccumulationResult
  readonly reset: (
    positions?: readonly NormalizedTrackingPosition[],
  ) => BreadcrumbAccumulationResult
  readonly snapshot: () => BreadcrumbAccumulationResult
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
  const accumulator = createBreadcrumbAccumulator(existing)
  return accumulator.append(incoming)
}

/**
 * Creates a stateful breadcrumb accumulator for steady-state polling.
 *
 * The poller receives small incremental breadcrumb batches after startup. Keeping
 * ordered per-device state means each normal append parses and merges only the
 * incoming fixes instead of rebuilding the whole retained incident history.
 */
export function createBreadcrumbAccumulator(
  initialPositions: readonly NormalizedTrackingPosition[] = [],
): BreadcrumbAccumulator {
  const deviceStates = new Map<string, DeviceTrailState>()
  let cachedSnapshot: BreadcrumbAccumulationResult | null = null

  const invalidate = () => {
    cachedSnapshot = null
  }

  const append = (
    incoming: readonly NormalizedTrackingPosition[],
  ): BreadcrumbAccumulationResult => {
    if (incoming.length === 0) {
      return snapshot()
    }

    for (const position of incoming) {
      mergePosition(deviceStates, decorateWithTimestamp(position))
    }
    invalidate()
    return snapshot()
  }

  const reset = (
    positions: readonly NormalizedTrackingPosition[] = [],
  ): BreadcrumbAccumulationResult => {
    deviceStates.clear()
    for (const position of positions) {
      mergePosition(deviceStates, decorateWithTimestamp(position))
    }
    invalidate()
    return snapshot()
  }

  const snapshot = (): BreadcrumbAccumulationResult => {
    if (cachedSnapshot !== null) {
      return cachedSnapshot
    }

    const deviceBudgets = [...deviceStates.values()]
      .sort((left, right) => left.deviceId.localeCompare(right.deviceId))
      .map((deviceState) => {
        const retained = retainDeviceTrailAcrossWindow(
          deviceState.chronological,
          MAX_BREADCRUMB_POSITIONS_PER_DEVICE,
        )
        deviceState.retained = retained
        compactDeviceTrailSource(deviceState, retained)

        return {
          deviceId: deviceState.deviceId,
          retained: retained.length,
          sourceRetained: deviceState.chronological.length,
          total: deviceState.totalObserved,
          firstTimestamp: retained[0]?.position.timestamp ?? null,
          lastTimestamp: retained.at(-1)?.position.timestamp ?? null,
          truncated: deviceState.totalObserved > retained.length,
        }
      })

    const positions = mergeRetainedDeviceTrails([...deviceStates.values()])

    cachedSnapshot = {
      positions,
      metadata: {
        totalRetained: positions.length,
        totalObserved: [...deviceStates.values()].reduce(
          (total, deviceState) => total + deviceState.totalObserved,
          0,
        ),
        deviceBudgets,
      },
    }
    return cachedSnapshot
  }

  reset(initialPositions)

  return {
    append,
    reset,
    snapshot,
  }
}

/** A breadcrumb position paired with its parsed timestamp, parsed once per poll. */
type TimestampedPosition = {
  readonly position: NormalizedTrackingPosition
  readonly timestampMs: number
}

type DeviceTrailState = {
  readonly deviceId: string
  readonly byKey: Map<string, TimestampedPosition>
  readonly chronological: TimestampedPosition[]
  totalObserved: number
  retained: readonly TimestampedPosition[]
}

function decorateWithTimestamp(position: NormalizedTrackingPosition): TimestampedPosition {
  return { position, timestampMs: getParsedTimestamp(position) }
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

    const gapMs = getParsedTimestamp(next) - getParsedTimestamp(previous)

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

function getParsedTimestamp(position: NormalizedTrackingPosition): number {
  const cached = parsedTimestampByPosition.get(position)
  if (cached !== undefined) {
    return cached
  }

  const timestampMs = Date.parse(position.timestamp)
  parsedTimestampByPosition.set(position, timestampMs)
  return timestampMs
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

function mergePosition(
  deviceStates: Map<string, DeviceTrailState>,
  entry: TimestampedPosition,
): void {
  const key = createPositionKey(entry.position)
  let deviceState = deviceStates.get(entry.position.device_id)
  if (deviceState === undefined) {
    deviceState = {
      deviceId: entry.position.device_id,
      byKey: new Map(),
      chronological: [],
      totalObserved: 0,
      retained: [],
    }
    deviceStates.set(entry.position.device_id, deviceState)
  }

  if (deviceState.byKey.has(key)) {
    replaceExistingPosition(deviceState, key, entry)
    return
  }

  deviceState.byKey.set(key, entry)
  deviceState.totalObserved += 1
  const lastEntry = deviceState.chronological.at(-1)
  if (lastEntry === undefined || entry.timestampMs >= lastEntry.timestampMs) {
    deviceState.chronological.push(entry)
    return
  }

  const insertionIndex = findInsertionIndex(deviceState.chronological, entry.timestampMs)
  deviceState.chronological.splice(insertionIndex, 0, entry)
}

function replaceExistingPosition(
  deviceState: DeviceTrailState,
  key: string,
  entry: TimestampedPosition,
): void {
  deviceState.byKey.set(key, entry)
  const existingIndex = deviceState.chronological.findIndex(
    (existing) => createPositionKey(existing.position) === key,
  )
  if (existingIndex === -1) {
    const insertionIndex = findInsertionIndex(deviceState.chronological, entry.timestampMs)
    deviceState.chronological.splice(insertionIndex, 0, entry)
    return
  }

  deviceState.chronological[existingIndex] = entry
}

function compactDeviceTrailSource(
  deviceState: DeviceTrailState,
  retained: readonly TimestampedPosition[],
): void {
  if (deviceState.chronological.length <= MAX_SOURCE_POSITIONS_PER_DEVICE) {
    return
  }

  deviceState.chronological.splice(0, deviceState.chronological.length, ...retained)
  deviceState.byKey.clear()
  for (const entry of retained) {
    deviceState.byKey.set(createPositionKey(entry.position), entry)
  }
}

function findInsertionIndex(
  chronological: readonly TimestampedPosition[],
  timestampMs: number,
): number {
  let low = 0
  let high = chronological.length
  while (low < high) {
    const mid = Math.floor((low + high) / 2)
    if (chronological[mid]!.timestampMs <= timestampMs) {
      low = mid + 1
    } else {
      high = mid
    }
  }
  return low
}

function mergeRetainedDeviceTrails(
  deviceStates: readonly DeviceTrailState[],
): readonly NormalizedTrackingPosition[] {
  const cursors = deviceStates
    .filter((deviceState) => deviceState.retained.length > 0)
    .map((deviceState) => ({ deviceState, index: 0 }))
  const positions: NormalizedTrackingPosition[] = []

  while (cursors.length > 0) {
    let earliestCursorIndex = 0
    for (let index = 1; index < cursors.length; index += 1) {
      const candidate = cursors[index]!
      const current = cursors[earliestCursorIndex]!
      const candidateEntry = candidate.deviceState.retained[candidate.index]!
      const currentEntry = current.deviceState.retained[current.index]!
      if (
        candidateEntry.timestampMs < currentEntry.timestampMs ||
        (
          candidateEntry.timestampMs === currentEntry.timestampMs &&
          candidate.deviceState.deviceId.localeCompare(current.deviceState.deviceId) < 0
        )
      ) {
        earliestCursorIndex = index
      }
    }

    const cursor = cursors[earliestCursorIndex]!
    const entry = cursor.deviceState.retained[cursor.index]!
    positions.push(entry.position)
    cursor.index += 1
    if (cursor.index >= cursor.deviceState.retained.length) {
      cursors.splice(earliestCursorIndex, 1)
    }
  }

  return positions
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
  return createTrackingPositionIdentityKey(position)
}
