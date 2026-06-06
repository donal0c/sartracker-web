import type { Feature, FeatureCollection, Geometry, LineString, Point } from 'geojson'

import { createBreadcrumbSegments, decimateBreadcrumbsForDots } from './breadcrumb-accumulator'
import { createDeviceColor } from './tracking-color'
import {
  DEFAULT_BREADCRUMB_TRAIL_MODE,
  type TrackingStylePreferences,
} from './tracking-style-store'
import type { TrackingSnapshot } from './tracking-types'

type GeoJsonPointFeature = Feature<
  Point,
  {
    readonly deviceId: string
    readonly featureKind: 'device'
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
    readonly featureKind: 'breadcrumbLine'
    readonly color: string
  }
>

type GeoJsonBreadcrumbPointFeature = Feature<
  Point,
  {
    readonly deviceId: string
    readonly featureKind: 'breadcrumb'
    readonly color: string
  }
>

export function createTrackingFeatureCollection(
  snapshot: TrackingSnapshot,
  gapThresholdMs: number,
  style: TrackingStylePreferences = {
    deviceColors: {},
    breadcrumbSize: 8,
    breadcrumbTrailMode: DEFAULT_BREADCRUMB_TRAIL_MODE,
  },
): FeatureCollection<Geometry> {
  const breadcrumbFeatures =
    style.breadcrumbTrailMode === 'dots'
      ? createBreadcrumbPointFeatureCollection(snapshot, style).features
      : createBreadcrumbFeatureCollection(snapshot, gapThresholdMs, style).features

  return {
    type: 'FeatureCollection',
    features: [
      ...breadcrumbFeatures,
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
      featureKind: 'device',
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
          featureKind: 'breadcrumbLine',
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

/**
 * Minimum inter-point distance (metres) per pixel of dot diameter.
 * At 8px default, this gives ~40m spacing — close to real GPS sample intervals.
 */
const DOT_SPACING_FACTOR_M_PER_PX = 5

/**
 * Creates decimated breadcrumb point features for dot-mode rendering.
 * Points closer than a size-proportional threshold are skipped to prevent
 * visual pileup at high GPS sample rates.
 */
export function createBreadcrumbPointFeatureCollection(
  snapshot: TrackingSnapshot,
  style: Pick<TrackingStylePreferences, 'deviceColors' | 'breadcrumbSize'> = {
    deviceColors: {},
    breadcrumbSize: 8,
  },
): FeatureCollection<Point> {
  const minDistanceM = (style.breadcrumbSize ?? 8) * DOT_SPACING_FACTOR_M_PER_PX
  const decimated = decimateBreadcrumbsForDots(snapshot.breadcrumbs, minDistanceM)

  const features: GeoJsonBreadcrumbPointFeature[] = decimated.map((breadcrumb) => ({
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [breadcrumb.lon, breadcrumb.lat],
    },
    properties: {
      deviceId: breadcrumb.device_id,
      featureKind: 'breadcrumb',
      color: getStyledDeviceColor(breadcrumb.device_id, style.deviceColors),
    },
  }))

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
