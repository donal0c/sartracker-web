import type { NormalizedTrackingPosition, TrackingSnapshot } from './tracking-types'

const INITIAL_ZOOM_BUFFER_DEGREES = 0.01
const INITIAL_ZOOM_MIN_EXTENT_DEGREES = 0.02

export type TrackingExtent = [
  [number, number],
  [number, number],
]

/**
 * Builds a safe initial map extent for tracked device positions.
 */
export function buildTrackingInitialExtent(snapshot: TrackingSnapshot): TrackingExtent | null {
  if (snapshot.positions.length === 0) {
    return null
  }

  return buildPositionsExtent(snapshot.positions)
}

/**
 * Builds a buffered extent from a point feature collection in WGS84 order.
 */
export function buildPositionsExtent(
  positions: readonly NormalizedTrackingPosition[],
): TrackingExtent | null {
  if (positions.length === 0) {
    return null
  }

  const lons = positions.map((position) => position.lon)
  const lats = positions.map((position) => position.lat)

  let minLon = Math.min(...lons)
  let maxLon = Math.max(...lons)
  let minLat = Math.min(...lats)
  let maxLat = Math.max(...lats)

  const width = maxLon - minLon
  const height = maxLat - minLat

  if (width < INITIAL_ZOOM_MIN_EXTENT_DEGREES || height < INITIAL_ZOOM_MIN_EXTENT_DEGREES) {
    const lonBuffer = INITIAL_ZOOM_BUFFER_DEGREES / 2
    const latBuffer = INITIAL_ZOOM_BUFFER_DEGREES / 2

    minLon -= lonBuffer
    maxLon += lonBuffer
    minLat -= latBuffer
    maxLat += latBuffer
  }

  return [
    [minLon, minLat],
    [maxLon, maxLat],
  ] as const
}
