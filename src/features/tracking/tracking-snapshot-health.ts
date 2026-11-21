import type {
  NormalizedTrackingPosition,
  TrackingSnapshot,
} from './tracking-types'

export const DEFAULT_DEVICE_STALE_THRESHOLD_MS = 5 * 60 * 1000
export const DEFAULT_CACHE_STALE_TTL_MS = 5 * 60 * 1000
export const DEFAULT_MAX_CACHE_AGE_MS = 4 * 60 * 60 * 1000
/**
 * How far a fix time may run ahead of this laptop's clock before it is treated
 * as a clock problem. A fix further ahead never looks fresh: it is marked
 * stale and flagged, so a tracker sending local time as UTC, a phone with a
 * wrong clock, or a laptop clock running behind cannot keep a silent device
 * labelled Live [DON-349 M-06].
 */
export const FIX_TIME_AHEAD_TOLERANCE_MS = 2 * 60 * 1000

type AnnotateSnapshotHealthOptions = {
  readonly now: Date
  readonly cacheAgeMs?: number | null
  readonly deviceStaleThresholdMs?: number
  readonly cacheStaleTtlMs?: number
}

/**
 * Applies stale/cache health metadata to a tracking snapshot.
 */
export function annotateTrackingSnapshotHealth(
  snapshot: TrackingSnapshot,
  options: AnnotateSnapshotHealthOptions,
): TrackingSnapshot {
  const cacheAgeMs = options.cacheAgeMs ?? null
  const deviceStaleThresholdMs =
    options.deviceStaleThresholdMs ?? DEFAULT_DEVICE_STALE_THRESHOLD_MS
  const cacheStaleTtlMs = options.cacheStaleTtlMs ?? DEFAULT_CACHE_STALE_TTL_MS
  const positions = annotatePositionsHealth(
    snapshot.positions,
    options.now,
    deviceStaleThresholdMs,
    cacheAgeMs,
    cacheStaleTtlMs,
  )

  return {
    devices: snapshot.devices,
    positions,
    breadcrumbs: snapshot.breadcrumbs,
    rawBreadcrumbsForPersistence: snapshot.rawBreadcrumbsForPersistence,
    breadcrumbMetadata: snapshot.breadcrumbMetadata,
  }
}

/**
 * Computes the age of a cached snapshot relative to the supplied clock.
 */
export function calculateCacheAgeMs(cachedAt: string, now: Date): number {
  return Math.max(0, now.getTime() - Date.parse(cachedAt))
}

/**
 * Returns whether a cached snapshot is still usable.
 */
export function isTrackingCacheUsable(
  cachedAt: string,
  now: Date,
  maxCacheAgeMs: number = DEFAULT_MAX_CACHE_AGE_MS,
): boolean {
  return calculateCacheAgeMs(cachedAt, now) <= maxCacheAgeMs
}

function annotatePositionHealth(
  position: NormalizedTrackingPosition,
  now: Date,
  deviceStaleThresholdMs: number,
  cacheAgeMs: number | null,
  cacheStaleTtlMs: number,
): NormalizedTrackingPosition {
  const fixTimeMs = Date.parse(position.timestamp)
  const positionAgeMs = Math.max(0, now.getTime() - fixTimeMs)
  const fixTimeAheadOfClock = fixTimeMs - now.getTime() > FIX_TIME_AHEAD_TOLERANCE_MS
  const cacheAgeSeconds = position.data_origin === 'cache' && cacheAgeMs !== null
    ? Math.floor(cacheAgeMs / 1000)
    : null
  const fixTimeUnverified =
    position.fix_time_unverified === true || position.timestamp_source !== 'fix'
  const deviceCacheStale =
    fixTimeAheadOfClock ||
    positionAgeMs > deviceStaleThresholdMs ||
    (position.data_origin === 'cache' && cacheAgeMs !== null && cacheAgeMs > cacheStaleTtlMs)

  if (
    position.cache_age_seconds === cacheAgeSeconds &&
    position.device_cache_stale === deviceCacheStale &&
    position.fix_time_unverified === fixTimeUnverified &&
    (position.fix_time_ahead_of_clock === true) === fixTimeAheadOfClock
  ) {
    return position
  }

  // The flag is present only while the fix is ahead, so ordinary positions
  // keep their exact shape.
  const { fix_time_ahead_of_clock: previousFlag, ...rest } = position
  void previousFlag
  return {
    ...rest,
    cache_age_seconds: cacheAgeSeconds,
    device_cache_stale: deviceCacheStale,
    fix_time_unverified: fixTimeUnverified,
    ...(fixTimeAheadOfClock ? { fix_time_ahead_of_clock: true } : {}),
  }
}

function annotatePositionsHealth(
  positions: readonly NormalizedTrackingPosition[],
  now: Date,
  deviceStaleThresholdMs: number,
  cacheAgeMs: number | null,
  cacheStaleTtlMs: number,
): readonly NormalizedTrackingPosition[] {
  let changed = false
  const annotated = positions.map((position) => {
    const nextPosition = annotatePositionHealth(
      position,
      now,
      deviceStaleThresholdMs,
      cacheAgeMs,
      cacheStaleTtlMs,
    )
    if (nextPosition !== position) {
      changed = true
    }
    return nextPosition
  })

  return changed ? annotated : positions
}
