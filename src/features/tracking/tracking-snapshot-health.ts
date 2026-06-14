import type {
  NormalizedTrackingPosition,
  TrackingSnapshot,
} from './tracking-types'

export const DEFAULT_DEVICE_STALE_THRESHOLD_MS = 60 * 60 * 1000
export const DEFAULT_CACHE_STALE_TTL_MS = 5 * 60 * 1000
export const DEFAULT_MAX_CACHE_AGE_MS = 4 * 60 * 60 * 1000

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

  return {
    devices: snapshot.devices,
    positions: snapshot.positions.map((position) =>
      annotatePositionHealth(position, options.now, deviceStaleThresholdMs, cacheAgeMs, cacheStaleTtlMs),
    ),
    breadcrumbs: snapshot.breadcrumbs.map((position) =>
      annotatePositionHealth(position, options.now, deviceStaleThresholdMs, cacheAgeMs, cacheStaleTtlMs),
    ),
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
  const positionAgeMs = Math.max(0, now.getTime() - Date.parse(position.timestamp))
  const cacheAgeSeconds = position.data_origin === 'cache' && cacheAgeMs !== null
    ? Math.floor(cacheAgeMs / 1000)
    : null
  const deviceCacheStale =
    positionAgeMs > deviceStaleThresholdMs ||
    (position.data_origin === 'cache' && cacheAgeMs !== null && cacheAgeMs > cacheStaleTtlMs)

  return {
    ...position,
    cache_age_seconds: cacheAgeSeconds,
    device_cache_stale: deviceCacheStale,
  }
}
