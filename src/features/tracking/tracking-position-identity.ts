import type { NormalizedTrackingPosition } from './tracking-types'

type TrackingPositionIdentity = Pick<
  NormalizedTrackingPosition,
  'id' | 'device_id' | 'lat' | 'lon' | 'timestamp'
>

type TrackingPositionCoordinateIdentity = Pick<
  NormalizedTrackingPosition,
  'device_id' | 'lat' | 'lon' | 'timestamp'
>

/**
 * Builds the strongest available identity for a normalized tracking fix.
 */
export function createTrackingPositionIdentityKey(position: TrackingPositionIdentity): string {
  const sourceId = position.id.trim()
  if (sourceId.length > 0) {
    return `${position.device_id}:id:${sourceId}`
  }

  return createTrackingPositionCoordinateKey(position)
}

/**
 * Builds a stable fallback key for stored rows that do not preserve source ids.
 */
export function createTrackingPositionCoordinateKey(
  position: TrackingPositionCoordinateIdentity,
): string {
  return [
    position.device_id,
    'fix',
    position.timestamp,
    formatCoordinateKeyPart(position.lat),
    formatCoordinateKeyPart(position.lon),
  ].join(':')
}

function formatCoordinateKeyPart(value: number): string {
  return value.toFixed(7)
}
