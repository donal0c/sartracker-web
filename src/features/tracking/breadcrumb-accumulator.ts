import type {
  BreadcrumbSnapshotMetadata,
  NormalizedTrackingPosition,
} from './tracking-types'
import {
  createTrackingPositionCoordinateKey,
  createTrackingPositionIdentityKey,
} from './tracking-position-identity'
import {
  createBreadcrumbIdentityIndex,
  type BreadcrumbIdentityIndex,
} from './breadcrumb-identity-index'
import { compareStringsByCodeUnit } from '../../lib/deterministic-string-order'

// Keep each live device trail bounded independently while preserving the shape
// of the full requested window. A high-frequency tracker must not evict another
// rescuer's route, and its own older route must not disappear just because the
// device keeps reporting later fixes.
const MAX_BREADCRUMB_POSITIONS_PER_DEVICE = 5_000
const parsedTimestampByPosition = new WeakMap<NormalizedTrackingPosition, number>()

export type BreadcrumbAccumulationResult = {
  readonly positions: readonly NormalizedTrackingPosition[]
  readonly metadata: BreadcrumbSnapshotMetadata
}

export type BreadcrumbAccumulator = {
  readonly append: (
    incoming: readonly NormalizedTrackingPosition[],
    options?: { readonly resolveObservedBaseline?: boolean },
  ) => BreadcrumbAccumulationResult
  readonly reset: (
    positions?: readonly NormalizedTrackingPosition[],
    totalObservedByDevice?: Readonly<Record<string, number>>,
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
    options: { readonly resolveObservedBaseline?: boolean } = {},
  ): BreadcrumbAccumulationResult => {
    if (incoming.length === 0) {
      return snapshot()
    }

    let changed = false
    for (const position of incoming) {
      changed =
        mergePosition(
          deviceStates,
          decorateWithTimestamp(position),
          options.resolveObservedBaseline === true,
        ) || changed
    }
    if (!changed) {
      return snapshot()
    }
    invalidate()
    return snapshot()
  }

  const reset = (
    positions: readonly NormalizedTrackingPosition[] = [],
    totalObservedByDevice: Readonly<Record<string, number>> = {},
  ): BreadcrumbAccumulationResult => {
    deviceStates.clear()
    for (const position of positions) {
      mergePosition(deviceStates, decorateWithTimestamp(position))
    }
    for (const [deviceId, totalObserved] of Object.entries(totalObservedByDevice)) {
      const deviceState = deviceStates.get(deviceId)
      if (
        deviceState !== undefined &&
        Number.isSafeInteger(totalObserved) &&
        totalObserved >= deviceState.totalObserved
      ) {
        deviceState.totalObserved = totalObserved
        deviceState.unresolvedObservedCount =
          totalObserved - deviceState.seenIdentities.getStorageStats().identityCount
      }
    }
    invalidate()
    return snapshot()
  }

  const snapshot = (): BreadcrumbAccumulationResult => {
    if (cachedSnapshot !== null) {
      return cachedSnapshot
    }

    const deviceBudgets = [...deviceStates.values()]
      .sort((left, right) => compareStringsByCodeUnit(left.deviceId, right.deviceId))
      .map((deviceState) => {
        const retention = retainDeviceTrailAcrossWindow(
          deviceState.chronological,
          MAX_BREADCRUMB_POSITIONS_PER_DEVICE,
          deviceState.bucketWidthMs,
        )
        const retained = retention.positions
        deviceState.bucketWidthMs = retention.bucketWidthMs
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
  readonly seenIdentities: BreadcrumbIdentityIndex
  readonly chronological: TimestampedPosition[]
  totalObserved: number
  retained: readonly TimestampedPosition[]
  bucketWidthMs: number | null
  unresolvedObservedCount: number
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

function mergePosition(
  deviceStates: Map<string, DeviceTrailState>,
  entry: TimestampedPosition,
  resolveObservedBaseline = false,
): boolean {
  const key = createPositionKey(entry.position)
  let deviceState = deviceStates.get(entry.position.device_id)
  if (deviceState === undefined) {
    deviceState = {
      deviceId: entry.position.device_id,
      byKey: new Map(),
      seenIdentities: createBreadcrumbIdentityIndex(),
      chronological: [],
      totalObserved: 0,
      retained: [],
      bucketWidthMs: null,
      unresolvedObservedCount: 0,
    }
    deviceStates.set(entry.position.device_id, deviceState)
  }

  const existingEntry = deviceState.byKey.get(key)
  if (existingEntry !== undefined) {
    if (positionsEqual(existingEntry.position, entry.position)) {
      return false
    }
    replaceExistingPosition(deviceState, key, entry)
    return true
  }

  if (deviceState.seenIdentities.has(entry.position)) {
    // The source identity was seen before compaction but is not currently a
    // bucket representative. Reconsider it so a corrected timestamp/coordinate
    // can become visible, without counting a reconciliation repeat as new.
    deviceState.byKey.set(key, entry)
    const insertionIndex = findInsertionIndex(deviceState.chronological, entry)
    deviceState.chronological.splice(insertionIndex, 0, entry)
    return true
  }

  const legacyKey =
    entry.position.id.trim() === ''
      ? null
      : createTrackingPositionCoordinateKey(entry.position)
  const legacyEntry = legacyKey === null ? undefined : deviceState.byKey.get(legacyKey)
  if (
    legacyKey !== null &&
    legacyEntry !== undefined &&
    legacyEntry.position.id.trim() === ''
  ) {
    replaceExistingPosition(deviceState, legacyKey, entry, key)
    deviceState.seenIdentities.delete(legacyEntry.position)
    deviceState.seenIdentities.add(entry.position)
    return true
  }

  const legacyIdentityPosition =
    legacyKey === null ? null : { ...entry.position, id: '' }
  if (
    legacyIdentityPosition !== null &&
    deviceState.seenIdentities.has(legacyIdentityPosition)
  ) {
    deviceState.seenIdentities.delete(legacyIdentityPosition)
    deviceState.seenIdentities.add(entry.position)
    deviceState.byKey.set(key, entry)
    const insertionIndex = findInsertionIndex(deviceState.chronological, entry)
    deviceState.chronological.splice(insertionIndex, 0, entry)
    return true
  }

  deviceState.byKey.set(key, entry)
  deviceState.seenIdentities.add(entry.position)
  if (resolveObservedBaseline && deviceState.unresolvedObservedCount > 0) {
    deviceState.unresolvedObservedCount -= 1
  } else {
    deviceState.totalObserved += 1
  }
  const lastEntry = deviceState.chronological.at(-1)
  if (lastEntry === undefined || compareTimestampedPositions(lastEntry, entry) <= 0) {
    deviceState.chronological.push(entry)
    return true
  }

  const insertionIndex = findInsertionIndex(deviceState.chronological, entry)
  deviceState.chronological.splice(insertionIndex, 0, entry)
  return true
}

/**
 * Every field of {@link NormalizedTrackingPosition} that {@link positionsEqual} compares to
 * decide whether an incoming fix is a true duplicate. This gates whether a re-fetched
 * (overlap-window) fix is dropped as a no-op, so an omitted field would silently discard a
 * genuine position update from the live trail and from persistence — a life-safety data-loss
 * vector. The `satisfies` guard rejects any key that is not a real position field; the
 * `AllPositionFieldsCompared` guard below rejects any position field that is missing here.
 */
export const COMPARED_POSITION_KEYS = [
  'id',
  'device_id',
  'lat',
  'lon',
  'altitude',
  'speed',
  'battery',
  'accuracy',
  'timestamp',
  'source',
  'data_origin',
  'cache_age_seconds',
  'device_cache_stale',
] as const satisfies readonly (keyof NormalizedTrackingPosition)[]

// Compile-time exhaustiveness: if a field is added to NormalizedTrackingPosition without being
// added to COMPARED_POSITION_KEYS, `UncomparedPositionField` becomes a non-`never` union and
// this assignment fails to type-check, forcing the new field into the comparison.
type UncomparedPositionField = Exclude<
  keyof NormalizedTrackingPosition,
  (typeof COMPARED_POSITION_KEYS)[number]
>
const AllPositionFieldsCompared: UncomparedPositionField extends never ? true : never = true
void AllPositionFieldsCompared

/**
 * Returns true when two normalized positions are identical across every persisted/rendered
 * field. Used to treat overlap-window re-fetches of an unchanged fix as a no-op.
 */
export function positionsEqual(
  left: NormalizedTrackingPosition,
  right: NormalizedTrackingPosition,
): boolean {
  for (const key of COMPARED_POSITION_KEYS) {
    if (left[key] !== right[key]) {
      return false
    }
  }
  return true
}

function replaceExistingPosition(
  deviceState: DeviceTrailState,
  existingKey: string,
  entry: TimestampedPosition,
  replacementKey: string = existingKey,
): void {
  if (replacementKey !== existingKey) {
    deviceState.byKey.delete(existingKey)
  }
  deviceState.byKey.set(replacementKey, entry)
  const existingIndex = deviceState.chronological.findIndex(
    (existing) => createPositionKey(existing.position) === existingKey,
  )
  if (existingIndex === -1) {
    const insertionIndex = findInsertionIndex(deviceState.chronological, entry)
    deviceState.chronological.splice(insertionIndex, 0, entry)
    return
  }

  deviceState.chronological.splice(existingIndex, 1)
  const insertionIndex = findInsertionIndex(deviceState.chronological, entry)
  deviceState.chronological.splice(insertionIndex, 0, entry)
}

function compactDeviceTrailSource(
  deviceState: DeviceTrailState,
  retained: readonly TimestampedPosition[],
): void {
  if (
    deviceState.chronological.length <= MAX_BREADCRUMB_POSITIONS_PER_DEVICE &&
    deviceState.bucketWidthMs === null
  ) {
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
  entry: TimestampedPosition,
): number {
  let low = 0
  let high = chronological.length
  while (low < high) {
    const mid = Math.floor((low + high) / 2)
    if (compareTimestampedPositions(chronological[mid]!, entry) <= 0) {
      low = mid + 1
    } else {
      high = mid
    }
  }
  return low
}

function compareTimestampedPositions(
  left: TimestampedPosition,
  right: TimestampedPosition,
): number {
  return (
    left.timestampMs - right.timestampMs ||
    compareStringsByCodeUnit(
      createPositionKey(left.position),
      createPositionKey(right.position),
    )
  )
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
          compareStringsByCodeUnit(
            candidate.deviceState.deviceId,
            current.deviceState.deviceId,
          ) < 0
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
  minimumBucketWidthMs: number | null,
): {
  readonly positions: readonly TimestampedPosition[]
  readonly bucketWidthMs: number | null
} {
  if (chronological.length <= maxPositions && minimumBucketWidthMs === null) {
    return { positions: chronological, bucketWidthMs: null }
  }
  if (maxPositions <= 0) {
    return { positions: [], bucketWidthMs: minimumBucketWidthMs ?? 1 }
  }
  if (maxPositions === 1) {
    return {
      positions: [chronological[chronological.length - 1]!],
      bucketWidthMs: minimumBucketWidthMs ?? 1,
    }
  }

  const latest = chronological.at(-1)!
  let bucketWidthMs = minimumBucketWidthMs ?? 1

  // Epoch-anchored, power-of-two time buckets make the retained trail a pure
  // function of the complete set of fixes. When the window grows, every
  // coarser bucket winner is already a winner of one of its two child buckets,
  // so a bounded accumulator can promote without needing discarded fixes.
  // This is what makes one large history response, many incremental responses,
  // and a restart from persisted truth select the same identities.
  while (true) {
    const bucketWinners = new Map<number, TimestampedPosition>()
    for (const entry of chronological) {
      const bucket = Math.floor(entry.timestampMs / bucketWidthMs)
      const existing = bucketWinners.get(bucket)
      if (existing === undefined || compareTimestampedPositions(entry, existing) < 0) {
        bucketWinners.set(bucket, entry)
      }
    }

    const retained = [...bucketWinners.values()].sort(compareTimestampedPositions)
    if (createPositionKey(retained.at(-1)!.position) !== createPositionKey(latest.position)) {
      retained.push(latest)
    }
    if (retained.length <= maxPositions) {
      return { positions: retained, bucketWidthMs }
    }

    bucketWidthMs *= 2
  }
}

function createPositionKey(position: NormalizedTrackingPosition): string {
  return createTrackingPositionIdentityKey(position)
}
