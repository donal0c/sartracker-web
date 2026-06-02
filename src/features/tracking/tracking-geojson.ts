import type { Feature, FeatureCollection, Geometry, LineString, Point } from 'geojson'

import { createBreadcrumbSegments } from './breadcrumb-accumulator'
import { createDeviceColor } from './tracking-color'
import type { TrackingStylePreferences } from './tracking-style-store'
import type { TrackingSnapshot } from './tracking-types'

type GeoJsonPointFeature = Feature<
  Point,
  {
    readonly deviceId: string
    readonly name: string
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
  style: TrackingStylePreferences = { deviceColors: {}, breadcrumbSize: 4 },
): FeatureCollection<Geometry> {
  return {
    type: 'FeatureCollection',
    features: [
      ...createBreadcrumbFeatureCollection(snapshot, gapThresholdMs, style).features,
      ...createDeviceFeatureCollection(snapshot, style).features,
    ],
  }
}

/**
 * Creates GeoJSON point features for the current tracked device positions.
 */
export function createDeviceFeatureCollection(
  snapshot: TrackingSnapshot,
  style: Pick<TrackingStylePreferences, 'deviceColors'> = { deviceColors: {} },
): FeatureCollection<Point> {
  const deviceNameById = new Map(
    snapshot.devices.map((device) => [device.device_id, device.name] as const),
  )

  const features: GeoJsonPointFeature[] = snapshot.positions.map((position) => ({
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [position.lon, position.lat],
    },
    properties: {
      deviceId: position.device_id,
      name: deviceNameById.get(position.device_id) ?? position.device_id,
      color: getStyledDeviceColor(position.device_id, style.deviceColors),
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
  style: Pick<TrackingStylePreferences, 'deviceColors'> = { deviceColors: {} },
): FeatureCollection<LineString> {
  const breadcrumbsByDevice = new Map<string, TrackingSnapshot['breadcrumbs'][number][]>()
  for (const breadcrumb of snapshot.breadcrumbs) {
    const existing = breadcrumbsByDevice.get(breadcrumb.device_id)
    if (existing === undefined) {
      breadcrumbsByDevice.set(breadcrumb.device_id, [breadcrumb])
      continue
    }

    existing.push(breadcrumb)
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
          color: getStyledDeviceColor(deviceId, style.deviceColors),
        },
      })
    }
  }

  return {
    type: 'FeatureCollection',
    features,
  }
}

function getStyledDeviceColor(
  deviceId: string,
  deviceColors: Readonly<Record<string, string>>,
): string {
  return deviceColors[deviceId] ?? createDeviceColor(deviceId)
}
