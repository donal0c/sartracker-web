import type {
  NormalizedTrackingPosition,
  TrackingSnapshot,
} from './tracking-types'
import { getNewestBreadcrumbMsByDevice } from './newest-known-fix'

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

/**
 * True when an annotated position is stale because it is old (or its cache
 * is), not merely because its fix time is ahead of this laptop's clock. A fix
 * ahead of the clock is labelled and shown as stale, but it is the newest
 * thing known about the device, so retention and scope keep it like a fresh
 * fix [DON-349 M-06].
 *
 * @param position a position annotated by annotateTrackingSnapshotHealth
 * @param cacheStaleTtlMs the cache freshness limit used when annotating
 * @returns whether the position should be treated as expired
 */
export function isPositionExpired(
  position: NormalizedTrackingPosition,
  cacheStaleTtlMs: number = DEFAULT_CACHE_STALE_TTL_MS,
): boolean {
  if (!position.device_cache_stale) return false
  if (position.fix_time_ahead_of_clock !== true) return true
  return position.data_origin === 'cache'
    && position.cache_age_seconds !== null
    && position.cache_age_seconds * 1000 > cacheStaleTtlMs
}

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
    snapshot.breadcrumbs.length === 0 ? null : getNewestBreadcrumbMsByDevice(snapshot.breadcrumbs),
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

/**
 * Re-assesses one position against the clock. A device whose newest breadcrumb
 * is ahead of the clock is flagged too, because that breadcrumb wins the marker
 * [DON-349 M-06].
 */
function annotatePositionHealth(
  position: NormalizedTrackingPosition,
  newestBreadcrumbMs: number | undefined,
  now: Date,
  deviceStaleThresholdMs: number,
  cacheAgeMs: number | null,
  cacheStaleTtlMs: number,
): NormalizedTrackingPosition {
  const fixTimeMs = Date.parse(position.timestamp)
  const positionAgeMs = Math.max(0, now.getTime() - fixTimeMs)
  const fixTimeAheadOfClock =
    fixTimeMs - now.getTime() > FIX_TIME_AHEAD_TOLERANCE_MS ||
    (newestBreadcrumbMs !== undefined && newestBreadcrumbMs - now.getTime() > FIX_TIME_AHEAD_TOLERANCE_MS)
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
  newestBreadcrumbMsByDevice: ReadonlyMap<string, number> | null,
  now: Date,
  deviceStaleThresholdMs: number,
  cacheAgeMs: number | null,
  cacheStaleTtlMs: number,
): readonly NormalizedTrackingPosition[] {
  let changed = false
  const annotated = positions.map((position) => {
    const nextPosition = annotatePositionHealth(
      position,
      newestBreadcrumbMsByDevice?.get(position.device_id),
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
