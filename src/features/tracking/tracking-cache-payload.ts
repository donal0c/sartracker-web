import {
  normalizeTraccarDevice,
  normalizeTraccarPosition,
} from './traccar-normalization'
import type {
  NormalizedTrackingDevice,
  NormalizedTrackingPosition,
} from './tracking-types'

export type TrackingCachePayload = {
  readonly cached_at: string
  readonly devices: readonly NormalizedTrackingDevice[]
  readonly positions: readonly NormalizedTrackingPosition[]
  readonly breadcrumbs: readonly NormalizedTrackingPosition[]
}

/**
 * Parses persisted tracking cache JSON while dropping malformed entries individually.
 */
export function parseTrackingCachePayload(contents: string): TrackingCachePayload {
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
  const cachedAt = String(record.cached_at ?? '')
  if (Number.isNaN(Date.parse(cachedAt))) {
    throw new Error('Tracking cache must include a valid cached_at timestamp.')
  }

  return {
    cached_at: cachedAt,
    devices: normalizeEntries(record.devices, normalizeCachedDevice),
    positions: normalizeEntries(record.positions, normalizeCachedPosition),
    breadcrumbs: normalizeEntries(record.breadcrumbs, normalizeCachedPosition),
  }
}

/**
 * Serializes a tracking cache payload for persistence.
 */
export function serializeTrackingCachePayload(payload: TrackingCachePayload): string {
  return JSON.stringify(payload)
}

function normalizeEntries<T>(
  value: unknown,
  normalize: (entry: Record<string, unknown>) => T,
): readonly T[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((entry) => {
    try {
      if (entry == null || typeof entry !== 'object' || Array.isArray(entry)) {
        return []
      }

      return [normalize(entry as Record<string, unknown>)]
    } catch {
      return []
    }
  })
}

function normalizeCachedDevice(entry: Record<string, unknown>): NormalizedTrackingDevice {
  if ('device_id' in entry) {
    return {
      device_id: String(entry.device_id),
      name: String(entry.name ?? `Device ${entry.device_id}`),
      status:
        entry.status === 'online' || entry.status === 'offline' || entry.status === 'unknown'
          ? entry.status
          : 'unknown',
      last_seen: entry.last_seen == null ? null : String(entry.last_seen),
      unique_id: entry.unique_id == null ? null : String(entry.unique_id),
      category: entry.category == null ? null : String(entry.category),
    }
  }

  return normalizeTraccarDevice(entry)
}

function normalizeCachedPosition(
  entry: Record<string, unknown>,
): NormalizedTrackingPosition {
  if ('device_id' in entry && 'lat' in entry && 'lon' in entry) {
    const latitude = Number(entry.lat)
    const longitude = Number(entry.lon)
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
      throw new Error('Cached tracking position latitude is invalid.')
    }
    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      throw new Error('Cached tracking position longitude is invalid.')
    }

    return {
      id: String(entry.id),
      device_id: String(entry.device_id),
      lat: latitude,
      lon: longitude,
      altitude: entry.altitude == null ? null : Number(entry.altitude),
      speed: entry.speed == null ? null : Number(entry.speed),
      battery: entry.battery == null ? null : Number(entry.battery),
      accuracy: entry.accuracy == null ? null : Number(entry.accuracy),
      timestamp: String(entry.timestamp),
      source: entry.source == null ? null : String(entry.source),
      data_origin: 'cache',
      cache_age_seconds: entry.cache_age_seconds == null ? null : Number(entry.cache_age_seconds),
      device_cache_stale: Boolean(entry.device_cache_stale),
    }
  }

  return normalizeTraccarPosition(entry, 'cache')
}
