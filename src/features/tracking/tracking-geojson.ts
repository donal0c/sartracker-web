import type { Feature, FeatureCollection, Geometry, LineString, Point } from 'geojson'

import { createBreadcrumbSegments } from './breadcrumb-accumulator'
import { createDeviceColor } from './tracking-color'
import type { TrackingSnapshot } from './tracking-types'

type GeoJsonPointFeature = Feature<
  Point,
  {
    readonly deviceId: string
    readonly color: string
    readonly stale: boolean
    readonly dataOrigin: string
  }
>

type GeoJsonLineFeature = Feature<
  LineString,
  {
    readonly deviceId: string
    readonly color: string
  }
>

export function createTrackingFeatureCollection(
  snapshot: TrackingSnapshot,
  gapThresholdMs: number,
): FeatureCollection<Geometry> {
  return {
    type: 'FeatureCollection',
    features: [
      ...createBreadcrumbFeatureCollection(snapshot, gapThresholdMs).features,
      ...createDeviceFeatureCollection(snapshot).features,
    ],
  }
}

/**
 * Creates GeoJSON point features for the current tracked device positions.
 */
export function createDeviceFeatureCollection(
  snapshot: TrackingSnapshot,
): FeatureCollection<Point> {
  const features: GeoJsonPointFeature[] = snapshot.positions.map((position) => ({
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [position.lon, position.lat],
    },
    properties: {
      deviceId: position.device_id,
      color: createDeviceColor(position.device_id),
      stale: position.device_cache_stale,
      dataOrigin: position.data_origin,
    },
  }))

  return {
    type: 'FeatureCollection',
    features,
  }
}

/**
 * Creates GeoJSON breadcrumb line features grouped by device and segmented by time gap.
 */
export function createBreadcrumbFeatureCollection(
  snapshot: TrackingSnapshot,
  gapThresholdMs: number,
): FeatureCollection<LineString> {
  const breadcrumbsByDevice = new Map<string, typeof snapshot.breadcrumbs>()
  for (const breadcrumb of snapshot.breadcrumbs) {
    const existing = breadcrumbsByDevice.get(breadcrumb.device_id) ?? []
    breadcrumbsByDevice.set(breadcrumb.device_id, [...existing, breadcrumb])
  }

  const features: GeoJsonLineFeature[] = []

  for (const [deviceId, breadcrumbs] of breadcrumbsByDevice.entries()) {
    const segments = createBreadcrumbSegments(breadcrumbs, gapThresholdMs)
    for (const segment of segments) {
      if (segment.length < 2) {
        continue
      }

      features.push({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: segment.map((position) => [position.lon, position.lat] as const),
        },
        properties: {
          deviceId,
          color: createDeviceColor(deviceId),
        },
      })
    }
  }

  return {
    type: 'FeatureCollection',
    features,
  }
}
