import type {
  NormalizedTrackingDevice,
  NormalizedTrackingPosition,
  TrackingDataOrigin,
  TrackingDeviceStatus,
} from './tracking-types'
import { normalizeTrackingIsoTimestamp } from './tracking-timestamp'

type RawTraccarDevice = {
  readonly id?: unknown
  readonly name?: unknown
  readonly status?: unknown
  readonly lastUpdate?: unknown
  readonly uniqueId?: unknown
  readonly category?: unknown
}

type RawTraccarPosition = {
  readonly id?: unknown
  readonly deviceId?: unknown
  readonly latitude?: unknown
  readonly longitude?: unknown
  readonly altitude?: unknown
  readonly speed?: unknown
  readonly accuracy?: unknown
  readonly fixTime?: unknown
  readonly serverTime?: unknown
  readonly deviceTime?: unknown
  readonly valid?: unknown
  readonly protocol?: unknown
  readonly attributes?: unknown
}

/**
 * Normalizes a Traccar device payload into the internal tracking shape.
 */
export function normalizeTraccarDevice(raw: RawTraccarDevice): NormalizedTrackingDevice {
  const deviceId = String(asPositiveInteger(raw.id, 'Traccar device id'))
  const lastSeen = raw.lastUpdate == null ? null : asIsoTimestamp(raw.lastUpdate, 'device lastUpdate')

  return {
    device_id: deviceId,
    name: asOptionalString(raw.name)?.trim() || `Device ${deviceId}`,
    status: normalizeDeviceStatus(raw.status),
    last_seen: lastSeen,
    unique_id: asOptionalString(raw.uniqueId),
    category: asOptionalString(raw.category),
  }
}

/**
 * Normalizes a Traccar position payload into the internal tracking shape.
 */
export function normalizeTraccarPosition(
  raw: RawTraccarPosition,
  dataOrigin: TrackingDataOrigin,
): NormalizedTrackingPosition {
  const latitude = asFiniteNumber(raw.latitude, 'Traccar position latitude')
  if (latitude < -90 || latitude > 90) {
    throw new Error('Traccar position latitude must be between -90 and 90.')
  }

  const longitude = asFiniteNumber(raw.longitude, 'Traccar position longitude')
  if (longitude < -180 || longitude > 180) {
    throw new Error('Traccar position longitude must be between -180 and 180.')
  }

  const id = String(asPositiveInteger(raw.id, 'Traccar position id'))
  const deviceId = String(asPositiveInteger(raw.deviceId, 'Traccar position deviceId'))
  const timestamp = resolveTimestamp(raw)
  const attributes = asRecord(raw.attributes)
  const battery = readOptionalBattery(attributes)
  const valid = normalizeValidity(raw.valid)

  if (!valid) {
    throw new Error('Traccar position is marked invalid.')
  }

  return {
    id,
    device_id: deviceId,
    lat: latitude,
    lon: longitude,
    altitude: asOptionalNumber(raw.altitude),
    speed: normalizeApiSpeedKmh(raw.speed),
    battery,
    accuracy: asOptionalNumber(raw.accuracy),
    timestamp,
    source: asOptionalString(raw.protocol),
    data_origin: dataOrigin,
    cache_age_seconds: null,
    device_cache_stale: false,
  }
}

function resolveTimestamp(raw: RawTraccarPosition): string {
  if (raw.fixTime != null) {
    return asIsoTimestamp(raw.fixTime, 'position fixTime')
  }

  if (raw.deviceTime != null) {
    return asIsoTimestamp(raw.deviceTime, 'position deviceTime')
  }

  if (raw.serverTime != null) {
    return asIsoTimestamp(raw.serverTime, 'position serverTime')
  }

  throw new Error('Traccar position must provide fixTime, deviceTime, or serverTime.')
}

function normalizeDeviceStatus(value: unknown): TrackingDeviceStatus {
  const status = asOptionalString(value)?.toLowerCase()

  if (status === 'online' || status === 'offline' || status === 'unknown') {
    return status
  }

  return 'unknown'
}

function asFiniteNumber(value: unknown, label: string): number {
  if (
    (typeof value !== 'number' && typeof value !== 'string') ||
    (typeof value === 'string' && value.trim().length === 0)
  ) {
    throw new Error(`${label} must be a finite number.`)
  }

  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} must be a finite number.`)
  }

  return parsed
}

function asPositiveInteger(value: unknown, label: string): number {
  const parsed = asFiniteNumber(value, label)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive safe integer.`)
  }

  return parsed
}

function asOptionalNumber(value: unknown): number | null {
  if (value == null || value === '') {
    return null
  }

  return asFiniteNumber(value, 'Numeric field')
}

function asOptionalString(value: unknown): string | null {
  if (value == null || value === '') {
    return null
  }

  if (typeof value !== 'string') {
    throw new Error('Text field must be a string.')
  }
  return value
}

function asIsoTimestamp(value: unknown, label: string): string {
  return normalizeTrackingIsoTimestamp(value, label)
}

function normalizeValidity(value: unknown): boolean {
  if (value == null) {
    return true
  }
  if (typeof value !== 'boolean') {
    throw new Error('Traccar position validity flag is invalid; expected a boolean.')
  }

  return value
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  return value as Record<string, unknown>
}

function readOptionalBattery(attributes: Record<string, unknown>): number | null {
  if (!('batteryLevel' in attributes)) {
    return null
  }

  return asFiniteNumber(attributes.batteryLevel, 'Traccar batteryLevel')
}

function normalizeApiSpeedKmh(value: unknown): number | null {
  const speedKnots = asOptionalNumber(value)
  if (speedKnots === null) {
    return null
  }

  return speedKnots * 1.852
}
