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
const TARGET_BREADCRUMB_GEOMETRY_ERROR_METRES = 25
const METRES_PER_DEGREE_AT_EQUATOR = 111_320
const BASE_SPATIAL_BUCKET_WIDTH_DEGREES =
  TARGET_BREADCRUMB_GEOMETRY_ERROR_METRES /
  Math.SQRT2 /
  METRES_PER_DEGREE_AT_EQUATOR
const MAX_SELECTOR_ITERATIONS = 2_048
const parsedTimestampByPosition = new WeakMap<NormalizedTrackingPosition, number>()

export type BreadcrumbAccumulationResult = {
  readonly positions: readonly NormalizedTrackingPosition[]
  readonly metadata: BreadcrumbSnapshotMetadata
}

export type BreadcrumbAccumulator = {
  readonly ingest: (
    incoming: readonly NormalizedTrackingPosition[],
    options?: { readonly resolveObservedBaseline?: boolean },
  ) => void
  readonly append: (
    incoming: readonly NormalizedTrackingPosition[],
    options?: { readonly resolveObservedBaseline?: boolean },
  ) => BreadcrumbAccumulationResult
  readonly reset: (
    positions?: readonly NormalizedTrackingPosition[],
    totalObservedByDevice?: Readonly<Record<string, number>>,
    selectionMetadataByDevice?: Readonly<Record<string, BreadcrumbSelectionMetadata>>,
  ) => BreadcrumbAccumulationResult
  readonly compact: () => BreadcrumbAccumulationResult
  readonly snapshot: () => BreadcrumbAccumulationResult
}

export type BreadcrumbSelectionMetadata = {
  readonly geometryErrorBoundMetres: number | null
  readonly targetGeometryErrorSatisfied: boolean
  readonly timeBucketWidthMs?: number | null
  readonly spatialBucketWidthDegrees?: number | null
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

    const changed = ingestPositions(incoming, options)
    if (!changed) {
      return snapshot()
    }
    invalidate()
    return snapshot()
  }

  const ingest = (
    incoming: readonly NormalizedTrackingPosition[],
    options: { readonly resolveObservedBaseline?: boolean } = {},
  ): void => {
    if (ingestPositions(incoming, options)) {
      invalidate()
    }
  }

  const ingestPositions = (
    incoming: readonly NormalizedTrackingPosition[],
    options: { readonly resolveObservedBaseline?: boolean },
  ): boolean => {
    let changed = false
    for (const position of incoming) {
      changed =
        mergePosition(
          deviceStates,
          decorateWithTimestamp(position),
          options.resolveObservedBaseline === true,
        ) || changed
    }
    return changed
  }

  const reset = (
    positions: readonly NormalizedTrackingPosition[] = [],
    totalObservedByDevice: Readonly<Record<string, number>> = {},
    selectionMetadataByDevice: Readonly<Record<string, BreadcrumbSelectionMetadata>> = {},
  ): BreadcrumbAccumulationResult => {
    deviceStates.clear()
    for (const position of positions) {
      mergePosition(deviceStates, decorateWithTimestamp(position))
    }
    for (const deviceState of deviceStates.values()) {
      deviceState.canonicalBaselineLatestTimestampMs =
        deviceState.chronological.at(-1)?.timestampMs ?? null
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
    for (const [deviceId, selection] of Object.entries(selectionMetadataByDevice)) {
      const deviceState = deviceStates.get(deviceId)
      if (deviceState !== undefined) {
        deviceState.baselineGeometryErrorBoundMetres =
          selection.geometryErrorBoundMetres
        deviceState.baselineTargetGeometryErrorSatisfied =
          selection.targetGeometryErrorSatisfied
        deviceState.selectorTimeBucketWidthMs =
          normalizeSelectorWidth(selection.timeBucketWidthMs)
        deviceState.selectorSpatialBucketWidthDegrees =
          normalizeSelectorWidth(selection.spatialBucketWidthDegrees)
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
        )
        const retained = retention.positions
        deviceState.retained = retained
        const geometryErrorBoundMetres = combineGeometryErrorBounds(
          deviceState.baselineGeometryErrorBoundMetres,
          retention.geometryErrorBoundMetres,
        )

        return {
          deviceId: deviceState.deviceId,
          retained: retained.length,
          sourceRetained: deviceState.chronological.length,
          total: deviceState.totalObserved,
          firstTimestamp: retained[0]?.position.timestamp ?? null,
          lastTimestamp: retained.at(-1)?.position.timestamp ?? null,
          truncated: deviceState.totalObserved > retained.length,
          geometryErrorBoundMetres,
          targetGeometryErrorSatisfied:
            deviceState.baselineTargetGeometryErrorSatisfied &&
            geometryErrorBoundMetres !== null &&
            geometryErrorBoundMetres <= TARGET_BREADCRUMB_GEOMETRY_ERROR_METRES,
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

  const compact = (): BreadcrumbAccumulationResult => {
    let changed = false
    for (const deviceState of deviceStates.values()) {
      const retention = retainDeviceTrailAcrossWindow(
        deviceState.chronological,
        MAX_BREADCRUMB_POSITIONS_PER_DEVICE,
        deviceState.selectorTimeBucketWidthMs === null ||
          deviceState.selectorSpatialBucketWidthDegrees === null
          ? undefined
          : {
              timeBucketWidthMs: deviceState.selectorTimeBucketWidthMs,
              spatialBucketWidthDegrees:
                deviceState.selectorSpatialBucketWidthDegrees,
            },
      )
      if (
        retention.positions.length === deviceState.chronological.length &&
        retention.positions.every(
          (entry, index) => entry === deviceState.chronological[index],
        )
      ) {
        continue
      }
      deviceState.baselineGeometryErrorBoundMetres = combineGeometryErrorBounds(
        deviceState.baselineGeometryErrorBoundMetres,
        retention.geometryErrorBoundMetres,
      )
      deviceState.baselineTargetGeometryErrorSatisfied =
        deviceState.baselineTargetGeometryErrorSatisfied &&
        deviceState.baselineGeometryErrorBoundMetres !== null &&
        deviceState.baselineGeometryErrorBoundMetres <=
          TARGET_BREADCRUMB_GEOMETRY_ERROR_METRES
      deviceState.selectorTimeBucketWidthMs = retention.timeBucketWidthMs
      deviceState.selectorSpatialBucketWidthDegrees =
        retention.spatialBucketWidthDegrees
      deviceState.chronological.splice(
        0,
        deviceState.chronological.length,
        ...retention.positions,
      )
      deviceState.byKey.clear()
      for (const entry of retention.positions) {
        deviceState.byKey.set(createPositionKey(entry.position), entry)
      }
      changed = true
    }
    if (changed) {
      invalidate()
    }
    return snapshot()
  }

  reset(initialPositions)

  return {
    ingest,
    append,
    compact,
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
  baselineGeometryErrorBoundMetres: number | null
  baselineTargetGeometryErrorSatisfied: boolean
  unresolvedObservedCount: number
  canonicalBaselineLatestTimestampMs: number | null
  selectorTimeBucketWidthMs: number | null
  selectorSpatialBucketWidthDegrees: number | null
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
      baselineGeometryErrorBoundMetres: 0,
      baselineTargetGeometryErrorSatisfied: true,
      unresolvedObservedCount: 0,
      canonicalBaselineLatestTimestampMs: null,
      selectorTimeBucketWidthMs: null,
      selectorSpatialBucketWidthDegrees: null,
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
  const baselineResolutionRequested =
    resolveObservedBaseline || deviceState.unresolvedObservedCount > 0
  // A canonical projection may omit authoritative fixes from its <=5k
  // representatives. Only unseen identities inside that canonical time
  // boundary can discharge the unresolved persisted total; an identity after
  // the boundary is genuinely new and must increase the observed total even
  // when it shares a reconciliation batch with omitted baseline fixes.
  if (
    baselineResolutionRequested &&
    deviceState.unresolvedObservedCount > 0 &&
    deviceState.canonicalBaselineLatestTimestampMs !== null &&
    entry.timestampMs <= deviceState.canonicalBaselineLatestTimestampMs
  ) {
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
  selector?: {
    readonly timeBucketWidthMs: number
    readonly spatialBucketWidthDegrees: number
  },
): {
  readonly positions: readonly TimestampedPosition[]
  readonly geometryErrorBoundMetres: number | null
  readonly timeBucketWidthMs: number | null
  readonly spatialBucketWidthDegrees: number | null
} {
  if (chronological.length <= maxPositions && selector === undefined) {
    return {
      positions: chronological,
      geometryErrorBoundMetres: 0,
      timeBucketWidthMs: null,
      spatialBucketWidthDegrees: null,
    }
  }
  if (maxPositions <= 0) {
    return {
      positions: [],
      geometryErrorBoundMetres: null,
      timeBucketWidthMs: null,
      spatialBucketWidthDegrees: null,
    }
  }
  if (maxPositions === 1) {
    return {
      positions: [chronological[chronological.length - 1]!],
      geometryErrorBoundMetres: null,
      timeBucketWidthMs: null,
      spatialBucketWidthDegrees: null,
    }
  }

  let bucketWidthMs = selector?.timeBucketWidthMs ?? 1
  let spatialBucketWidthDegrees =
    selector?.spatialBucketWidthDegrees ?? BASE_SPATIAL_BUCKET_WIDTH_DEGREES
  const fullWindowMs = Math.max(
    1,
    chronological.at(-1)!.timestampMs - chronological[0]!.timestampMs + 1,
  )

  // Work from complete ordered truth. Time is coarsened first while retaining
  // the 25m target cell. If route complexity still exceeds the render budget,
  // spatial resolution is relaxed deterministically and the achieved cell
  // diagonal is reported in metadata instead of silently claiming 25m.
  for (let iteration = 0; iteration < MAX_SELECTOR_ITERATIONS; iteration += 1) {
    const retainedByKey = new Map<string, TimestampedPosition>()
    addSpatiotemporalRunBoundaries(
      chronological,
      bucketWidthMs,
      spatialBucketWidthDegrees,
      retainedByKey,
    )
    addRouteEndpoints(chronological, retainedByKey)
    const retained = [...retainedByKey.values()].sort(compareTimestampedPositions)
    if (retained.length <= maxPositions) {
      return {
        positions: retained,
        geometryErrorBoundMetres:
          spatialBucketWidthDegrees *
          Math.SQRT2 *
          METRES_PER_DEGREE_AT_EQUATOR,
        timeBucketWidthMs: bucketWidthMs,
        spatialBucketWidthDegrees,
      }
    }

    if (bucketWidthMs < fullWindowMs) {
      bucketWidthMs *= 2
    } else {
      spatialBucketWidthDegrees *= 2
    }
  }

  return {
    positions: retainUniformlyAcrossWindow(chronological, maxPositions),
    geometryErrorBoundMetres: null,
    timeBucketWidthMs: null,
    spatialBucketWidthDegrees: null,
  }
}

function normalizeSelectorWidth(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : null
}

/** Retains both ends of every contiguous spatiotemporal-cell visit. */
function addSpatiotemporalRunBoundaries(
  chronological: readonly TimestampedPosition[],
  bucketWidthMs: number,
  spatialBucketWidthDegrees: number,
  retainedByKey: Map<string, TimestampedPosition>,
): void {
  let runBucket: string | null = null
  let runFirst: TimestampedPosition | null = null
  let runLast: TimestampedPosition | null = null

  const retainRun = () => {
    if (runFirst !== null && runLast !== null) {
      retainedByKey.set(createPositionKey(runFirst.position), runFirst)
      retainedByKey.set(createPositionKey(runLast.position), runLast)
    }
  }

  for (const entry of chronological) {
    const bucket = createSpatiotemporalBucketKey(
      entry,
      bucketWidthMs,
      spatialBucketWidthDegrees,
    )
    if (bucket !== runBucket) {
      retainRun()
      runBucket = bucket
      runFirst = entry
    }
    runLast = entry
  }
  retainRun()
}

/** Returns an epoch- and world-anchored hierarchical cell identity. */
function createSpatiotemporalBucketKey(
  entry: TimestampedPosition,
  bucketWidthMs: number,
  spatialBucketWidthDegrees: number,
): string {
  const timeBucket = Math.floor(entry.timestampMs / bucketWidthMs)
  const latitudeBucket = Math.floor(
    (entry.position.lat + 90) / spatialBucketWidthDegrees,
  )
  const longitudeBucket = Math.floor(
    (entry.position.lon + 180) / spatialBucketWidthDegrees,
  )
  return `${timeBucket}:${latitudeBucket}:${longitudeBucket}`
}

/** Preserves the first and latest known fixes for the mission trail. */
function addRouteEndpoints(
  chronological: readonly TimestampedPosition[],
  retainedByKey: Map<string, TimestampedPosition>,
): void {
  const first = chronological[0]
  const latest = chronological.at(-1)
  if (first === undefined || latest === undefined) {
    return
  }
  retainedByKey.set(createPositionKey(first.position), first)
  retainedByKey.set(createPositionKey(latest.position), latest)
}

/** Returns a deterministic endpoint-preserving finite fallback. */
function retainUniformlyAcrossWindow(
  chronological: readonly TimestampedPosition[],
  maxPositions: number,
): readonly TimestampedPosition[] {
  if (chronological.length <= maxPositions) {
    return chronological
  }
  return Array.from({ length: maxPositions }, (_, index) => {
    const sourceIndex = Math.round(
      (index * (chronological.length - 1)) / (maxPositions - 1),
    )
    return chronological[sourceIndex]!
  })
}

/** Combines a persisted canonical bound with any newer live simplification. */
function combineGeometryErrorBounds(
  persistedBound: number | null,
  liveBound: number | null,
): number | null {
  if (persistedBound === null || liveBound === null) {
    return null
  }
  return Math.max(persistedBound, liveBound)
}

function createPositionKey(position: NormalizedTrackingPosition): string {
  return createTrackingPositionIdentityKey(position)
}
