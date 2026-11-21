import {
  normalizeTraccarDevice,
  normalizeTraccarPosition,
} from './traccar-normalization'
import { thinDeviceTrailToBudget } from './breadcrumb-accumulator'
import {
  createCacheBreadcrumbMetadata,
  createUnknownCacheSimplificationMetadata,
  parseCacheBreadcrumbMetadata,
  type CacheDeviceThinning,
} from './tracking-cache-breadcrumb-disclosure'
import type {
  BreadcrumbSnapshotMetadata,
  NormalizedTrackingDevice,
  NormalizedTrackingPosition,
  TrackingSnapshot,
} from './tracking-types'
import { normalizeTrackingIsoTimestamp } from './tracking-timestamp'

export type TrackingCachePayload = {
  /** Missing means legacy/unknown identity; null explicitly identifies idle. */
  readonly mission_id?: string | null
  readonly cached_at: string
  readonly devices: readonly NormalizedTrackingDevice[]
  readonly positions: readonly NormalizedTrackingPosition[]
  readonly breadcrumbs: readonly NormalizedTrackingPosition[]
  /**
   * Simplification of the cached trail. Absent in older caches; null after
   * parsing means present but unreadable, which is disclosed as simplified.
   */
  readonly breadcrumb_metadata?: BreadcrumbSnapshotMetadata | null
}

export type TrackingCacheDroppedEntries = {
  readonly section: 'devices' | 'positions' | 'breadcrumbs'
  readonly droppedCount: number
  readonly totalCount: number
}

type TrackingCacheParseOptions = {
  readonly onDroppedEntries?: (summary: TrackingCacheDroppedEntries) => void
}

const MAX_TRACKING_CACHE_BREADCRUMBS = 5_000
const TRACKING_CACHE_SELECTION_WORK_CHUNK = 1_024

type TrackingCacheBreadcrumbLimitOptions = {
  readonly yieldControl?: () => Promise<void>
  /** Live simplification already applied to these breadcrumbs, if any. */
  readonly metadata?: BreadcrumbSnapshotMetadata | undefined
}

export type LimitedTrackingCacheBreadcrumbs = {
  readonly breadcrumbs: readonly NormalizedTrackingPosition[]
  /** Persisted so a restored trail is disclosed as simplified when it is. */
  readonly metadata: BreadcrumbSnapshotMetadata | undefined
}

/** Yields cache-only projection work so current-position timers can run. */
function yieldTrackingCacheSelection(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/**
 * Keeps restart cache serialization near a global budget shared across device
 * trails, thinning each trail with the live line's selector [DON-338]. Every
 * device keeps its first and last fix, both sides of every real silence and
 * the continuity anchors, so the restored line never gains or loses a break;
 * the budget is exceeded rather than drop one of those points. Current
 * positions are retained separately by the cache payload.
 */
export async function limitTrackingCacheBreadcrumbs(
  breadcrumbs: readonly NormalizedTrackingPosition[],
  options: TrackingCacheBreadcrumbLimitOptions = {},
): Promise<LimitedTrackingCacheBreadcrumbs> {
  const yieldControl = options.yieldControl ?? yieldTrackingCacheSelection
  const trails = new Map<string, NormalizedTrackingPosition[]>()
  for (let index = 0; index < breadcrumbs.length; index += 1) {
    const position = breadcrumbs[index]!
    const trail = trails.get(position.device_id)
    if (trail === undefined) trails.set(position.device_id, [position])
    else trail.push(position)
    if ((index + 1) % TRACKING_CACHE_SELECTION_WORK_CHUNK === 0) {
      await yieldControl()
    }
  }

  if (breadcrumbs.length <= MAX_TRACKING_CACHE_BREADCRUMBS) {
    const unchanged = [...trails].map(([deviceId, trail]): CacheDeviceThinning => ({
      deviceId, inputCount: trail.length, retained: trail, geometryErrorBoundMetres: 0,
    }))
    return {
      breadcrumbs,
      metadata: unchanged.length === 0
        ? options.metadata : createCacheBreadcrumbMetadata(unchanged, options.metadata),
    }
  }

  const deviceTrails = [...trails]
  const quotas = deviceTrails.map(() => 0)
  let remaining = MAX_TRACKING_CACHE_BREADCRUMBS
  let allocationWork = 0
  while (remaining > 0) {
    let progressed = false
    for (let index = 0; index < deviceTrails.length && remaining > 0; index += 1) {
      if (quotas[index]! < deviceTrails[index]![1].length) {
        quotas[index]! += 1
        remaining -= 1
        progressed = true
      }
      allocationWork += 1
      if (allocationWork % TRACKING_CACHE_SELECTION_WORK_CHUNK === 0) {
        await yieldControl()
      }
    }
    if (!progressed) break
  }

  const thinned: CacheDeviceThinning[] = []
  const retainedPositions = new Set<NormalizedTrackingPosition>()
  let thinningWork = 0
  for (let index = 0; index < deviceTrails.length; index += 1) {
    const [deviceId, trail] = deviceTrails[index]!
    const result = thinDeviceTrailToBudget(trail, quotas[index]!)
    for (const position of result.positions) retainedPositions.add(position)
    thinned.push({
      deviceId,
      inputCount: trail.length,
      retained: result.positions,
      geometryErrorBoundMetres: result.geometryErrorBoundMetres,
    })
    thinningWork += trail.length
    if (thinningWork >= TRACKING_CACHE_SELECTION_WORK_CHUNK) {
      thinningWork = 0
      await yieldControl()
    }
  }

  const retained: NormalizedTrackingPosition[] = []
  for (let index = 0; index < breadcrumbs.length; index += 1) {
    const position = breadcrumbs[index]!
    if (retainedPositions.has(position)) retained.push(position)
    if ((index + 1) % TRACKING_CACHE_SELECTION_WORK_CHUNK === 0) {
      await yieldControl()
    }
  }
  return {
    breadcrumbs: retained,
    metadata: createCacheBreadcrumbMetadata(thinned, options.metadata),
  }
}

/**
 * Builds the snapshot a cache restore publishes. A trail the cache (or the
 * live line before it) simplified carries metadata, so the panel discloses it
 * as simplified; an older cache at the old cap is disclosed as simplified with
 * no geometry promise rather than presented as exact [DON-338].
 */
export function createCachedTrackingSnapshot(payload: TrackingCachePayload): TrackingSnapshot {
  const breadcrumbMetadata = payload.breadcrumb_metadata ?? (
    payload.breadcrumbs.length >= MAX_TRACKING_CACHE_BREADCRUMBS ||
    payload.breadcrumb_metadata === null
      ? createUnknownCacheSimplificationMetadata(payload.breadcrumbs)
      : undefined
  )
  return {
    devices: payload.devices,
    positions: payload.positions,
    breadcrumbs: payload.breadcrumbs,
    ...(breadcrumbMetadata === undefined ? {} : { breadcrumbMetadata }),
  }
}

/**
 * Parses persisted tracking cache JSON while dropping malformed entries individually.
 */
export function parseTrackingCachePayload(
  contents: string,
  options: TrackingCacheParseOptions = {},
): TrackingCachePayload {
  let parsed: unknown

  try {
    parsed = JSON.parse(contents)
  } catch {
    throw new Error('Tracking cache contains invalid JSON.')
  }

  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Tracking cache must be a JSON object.')
  }

  const record = parsed as Record<string, unknown>
  const missionId = record.mission_id
  validateTrackingCacheMissionId(missionId)
  const cachedAt = readIsoTimestamp(
    record.cached_at,
    'Tracking cache cached_at timestamp',
  )

  return {
    ...(missionId === undefined ? {} : { mission_id: missionId }),
    cached_at: cachedAt,
    devices: normalizeEntries(
      record.devices,
      normalizeCachedDevice,
      'devices',
      options.onDroppedEntries,
    ),
    positions: normalizeEntries(
      record.positions,
      normalizeCachedPosition,
      'positions',
      options.onDroppedEntries,
    ),
    breadcrumbs: normalizeEntries(
      record.breadcrumbs,
      normalizeCachedPosition,
      'breadcrumbs',
      options.onDroppedEntries,
    ),
    ...('breadcrumb_metadata' in record
      ? { breadcrumb_metadata: parseCacheBreadcrumbMetadata(record.breadcrumb_metadata) }
      : {}),
  }
}

/**
 * Serializes a tracking cache payload for persistence.
 */
export function serializeTrackingCachePayload(payload: TrackingCachePayload): string {
  validateTrackingCacheMissionId(payload.mission_id)
  return JSON.stringify(payload)
}

/** Enforces identical mission identity rules at both disk boundaries. */
function validateTrackingCacheMissionId(value: unknown): asserts value is string | null | undefined {
  if (value !== undefined && value !== null && (
    typeof value !== 'string' || value.trim().length === 0 || value.trim() !== value
  )) throw new Error('Tracking cache mission_id is invalid.')
}

function normalizeEntries<T>(
  value: unknown,
  normalize: (entry: Record<string, unknown>) => T,
  section: TrackingCacheDroppedEntries['section'],
  onDroppedEntries: TrackingCacheParseOptions['onDroppedEntries'],
): readonly T[] {
  if (!Array.isArray(value)) {
    return []
  }

  let droppedCount = 0
  const normalized = value.flatMap((entry) => {
    try {
      if (entry == null || typeof entry !== 'object' || Array.isArray(entry)) {
        droppedCount += 1
        return []
      }

      return [normalize(entry as Record<string, unknown>)]
    } catch {
      droppedCount += 1
      return []
    }
  })
  if (droppedCount > 0) {
    onDroppedEntries?.({
      section,
      droppedCount,
      totalCount: value.length,
    })
  }
  return normalized
}

function normalizeCachedDevice(entry: Record<string, unknown>): NormalizedTrackingDevice {
  if ('device_id' in entry) {
    const deviceId = readRequiredString(
      entry.device_id,
      'Cached tracking device id',
    )
    return {
      device_id: deviceId,
      name:
        readOptionalString(entry.name, 'Cached tracking device name') ??
        `Device ${deviceId}`,
      status:
        entry.status === 'online' || entry.status === 'offline' || entry.status === 'unknown'
          ? entry.status
          : 'unknown',
      last_seen:
        entry.last_seen == null
          ? null
          : readIsoTimestamp(
              entry.last_seen,
              'Cached tracking device last-seen timestamp',
            ),
      unique_id: readOptionalString(
        entry.unique_id,
        'Cached tracking device unique id',
      ),
      category: readOptionalString(
        entry.category,
        'Cached tracking device category',
      ),
      group_id: readOptionalString(
        entry.group_id,
        'Cached tracking device group id',
      ),
    }
  }

  return normalizeTraccarDevice(entry)
}

function normalizeCachedPosition(
  entry: Record<string, unknown>,
): NormalizedTrackingPosition {
  if ('device_id' in entry && 'lat' in entry && 'lon' in entry) {
    const id = readRequiredString(entry.id, 'Cached tracking position id')
    const deviceId = readRequiredString(
      entry.device_id,
      'Cached tracking position device id',
    )
    const latitude = readRequiredFiniteNumber(
      entry.lat,
      'Cached tracking position latitude',
    )
    const longitude = readRequiredFiniteNumber(
      entry.lon,
      'Cached tracking position longitude',
    )
    if (latitude < -90 || latitude > 90) {
      throw new Error('Cached tracking position latitude is invalid.')
    }
    if (longitude < -180 || longitude > 180) {
      throw new Error('Cached tracking position longitude is invalid.')
    }
    const timestamp = readIsoTimestamp(
      entry.timestamp,
      'Cached tracking position timestamp',
    )

    return {
      id,
      device_id: deviceId,
      lat: latitude,
      lon: longitude,
      altitude: readOptionalFiniteNumber(entry.altitude, 'Cached tracking altitude'),
      speed: readOptionalFiniteNumber(entry.speed, 'Cached tracking speed'),
      battery: readOptionalFiniteNumber(entry.battery, 'Cached tracking battery'),
      accuracy: readOptionalFiniteNumber(entry.accuracy, 'Cached tracking accuracy'),
      timestamp,
      ...readTimestampProvenance(entry),
      source: readOptionalString(entry.source, 'Cached tracking source'),
      data_origin: 'cache',
      cache_age_seconds: readOptionalFiniteNumber(
        entry.cache_age_seconds,
        'Cached tracking cache age',
      ),
      device_cache_stale: readOptionalBoolean(
        entry.device_cache_stale,
        'Cached tracking stale flag',
      ) ?? false,
    }
  }

  return normalizeTraccarPosition(entry, 'cache')
}

function readTimestampProvenance(
  entry: Record<string, unknown>,
): Pick<NormalizedTrackingPosition, 'timestamp_source' | 'fix_time_unverified'> {
  if (entry.timestamp_source == null) {
    return { fix_time_unverified: true }
  }
  if (
    entry.timestamp_source !== 'fix' &&
    entry.timestamp_source !== 'device' &&
    entry.timestamp_source !== 'server'
  ) {
    throw new Error('Cached tracking timestamp provenance is invalid.')
  }

  return {
    timestamp_source: entry.timestamp_source,
    fix_time_unverified:
      entry.timestamp_source !== 'fix' ||
      readOptionalBoolean(
        entry.fix_time_unverified,
        'Cached tracking unverified-fix-time flag',
      ) === true,
  }
}

function readRequiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} is invalid.`)
  }

  return value.trim()
}

function readOptionalString(value: unknown, label: string): string | null {
  if (value == null) {
    return null
  }
  if (typeof value !== 'string') {
    throw new Error(`${label} is invalid.`)
  }

  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed
}

function readRequiredFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} is invalid.`)
  }

  return value
}

function readOptionalFiniteNumber(value: unknown, label: string): number | null {
  if (value == null) {
    return null
  }

  return readRequiredFiniteNumber(value, label)
}

function readIsoTimestamp(value: unknown, label: string): string {
  try {
    return normalizeTrackingIsoTimestamp(value, label)
  } catch {
    throw new Error(`${label} is invalid.`)
  }
}

function readOptionalBoolean(value: unknown, label: string): boolean | null {
  if (value == null) {
    return null
  }
  if (typeof value !== 'boolean') {
    throw new Error(`${label} is invalid.`)
  }

  return value
}
