import {
  normalizeTraccarDevice,
  normalizeTraccarPosition,
} from './traccar-normalization'
import type {
  NormalizedTrackingDevice,
  NormalizedTrackingPosition,
} from './tracking-types'
import { normalizeTrackingIsoTimestamp } from './tracking-timestamp'

export type TrackingCachePayload = {
  readonly cached_at: string
  readonly devices: readonly NormalizedTrackingDevice[]
  readonly positions: readonly NormalizedTrackingPosition[]
  readonly breadcrumbs: readonly NormalizedTrackingPosition[]
}

export type TrackingCacheDroppedEntries = {
  readonly section: 'devices' | 'positions' | 'breadcrumbs'
  readonly droppedCount: number
  readonly totalCount: number
}

type TrackingCacheParseOptions = {
  readonly onDroppedEntries?: (summary: TrackingCacheDroppedEntries) => void
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
  const cachedAt = readIsoTimestamp(
    record.cached_at,
    'Tracking cache cached_at timestamp',
  )

  return {
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
    return {}
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
      entry.timestamp_source === 'server' ||
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
