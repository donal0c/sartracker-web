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

const MAX_TRACKING_CACHE_BREADCRUMBS = 5_000
const TRACKING_CACHE_SELECTION_WORK_CHUNK = 1_024

type TrackingCacheBreadcrumbLimitOptions = {
  readonly yieldControl?: () => Promise<void>
}

/** Yields cache-only projection work so current-position timers can run. */
function yieldTrackingCacheSelection(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/**
 * Keeps restart cache serialization globally bounded while sharing the budget
 * across device trails where capacity permits. A one-row quota keeps the
 * latest breadcrumb; trails beyond the global budget receive no breadcrumb.
 * Current positions are retained separately by the cache payload.
 */
export async function limitTrackingCacheBreadcrumbs(
  breadcrumbs: readonly NormalizedTrackingPosition[],
  options: TrackingCacheBreadcrumbLimitOptions = {},
): Promise<readonly NormalizedTrackingPosition[]> {
  if (breadcrumbs.length <= MAX_TRACKING_CACHE_BREADCRUMBS) return breadcrumbs

  const yieldControl = options.yieldControl ?? yieldTrackingCacheSelection
  const deviceIndexById = new Map<string, number>()
  const positionCountByDevice: number[] = []
  const quotas: number[] = []
  const nextOrdinalByDevice: number[] = []
  for (let index = 0; index < breadcrumbs.length; index += 1) {
    const deviceId = breadcrumbs[index]!.device_id
    let deviceIndex = deviceIndexById.get(deviceId)
    if (deviceIndex === undefined) {
      deviceIndex = positionCountByDevice.length
      deviceIndexById.set(deviceId, deviceIndex)
      positionCountByDevice.push(0)
      quotas.push(0)
      nextOrdinalByDevice.push(0)
    }
    positionCountByDevice[deviceIndex]! += 1
    if ((index + 1) % TRACKING_CACHE_SELECTION_WORK_CHUNK === 0) {
      await yieldControl()
    }
  }

  let remaining = MAX_TRACKING_CACHE_BREADCRUMBS
  let allocationWork = 0
  while (remaining > 0) {
    let progressed = false
    for (
      let index = 0;
      index < positionCountByDevice.length && remaining > 0;
      index += 1
    ) {
      if (quotas[index]! < positionCountByDevice[index]!) {
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

  const retainedOrdinalsByDevice: Array<Set<number> | null> = []
  let targetWork = 0
  for (let deviceIndex = 0; deviceIndex < quotas.length; deviceIndex += 1) {
    targetWork += 1
    if (targetWork % TRACKING_CACHE_SELECTION_WORK_CHUNK === 0) {
      await yieldControl()
    }
    const quota = quotas[deviceIndex]!
    const positionCount = positionCountByDevice[deviceIndex]!
    if (quota === 1) {
      retainedOrdinalsByDevice.push(new Set([positionCount - 1]))
    } else if (quota > 1) {
      const retainedOrdinals = new Set<number>()
      for (let index = 0; index < quota; index += 1) {
        retainedOrdinals.add(Math.round(
          (index * (positionCount - 1)) / (quota - 1),
        ))
        targetWork += 1
        if (targetWork % TRACKING_CACHE_SELECTION_WORK_CHUNK === 0) {
          await yieldControl()
        }
      }
      retainedOrdinalsByDevice.push(retainedOrdinals)
    } else {
      retainedOrdinalsByDevice.push(null)
    }
  }

  const retained: NormalizedTrackingPosition[] = []
  for (let index = 0; index < breadcrumbs.length; index += 1) {
    const position = breadcrumbs[index]!
    const deviceIndex = deviceIndexById.get(position.device_id)!
    const ordinal = nextOrdinalByDevice[deviceIndex]!
    nextOrdinalByDevice[deviceIndex]! += 1
    if (retainedOrdinalsByDevice[deviceIndex]?.has(ordinal) === true) {
      retained.push(position)
    }
    if ((index + 1) % TRACKING_CACHE_SELECTION_WORK_CHUNK === 0) {
      await yieldControl()
    }
  }
  return retained
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
