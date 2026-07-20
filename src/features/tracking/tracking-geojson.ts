import type { Feature, FeatureCollection, Geometry, LineString, Point } from 'geojson'

import { createBreadcrumbSegments } from './breadcrumb-accumulator'
import { createDeviceColor } from './tracking-color'
import {
  DEFAULT_BREADCRUMB_TRAIL_MODE,
  type TrackingStylePreferences,
} from './tracking-style-store'
import type { NormalizedTrackingPosition, TrackingSnapshot } from './tracking-types'

export const DEFAULT_BREADCRUMB_LINE_GAP_THRESHOLD_MS = 30 * 60 * 1000

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

const breadcrumbLineFeaturesByInput = new WeakMap<
  readonly NormalizedTrackingPosition[],
  Map<string, readonly GeoJsonLineFeature[]>
>()
const breadcrumbPointFeaturesByInput = new WeakMap<
  readonly NormalizedTrackingPosition[],
  Map<string, readonly GeoJsonBreadcrumbPointFeature[]>
>()
const objectIdentityTokens = new WeakMap<object, number>()
let nextObjectIdentityToken = 1

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
 * Returns a cheap identity key for the current tracking source payload.
 */
export function createTrackingFeatureCollectionDataKey(
  snapshot: TrackingSnapshot,
  gapThresholdMs: number,
  style: TrackingStylePreferences = {
    deviceColors: {},
    breadcrumbSize: 8,
    breadcrumbTrailMode: DEFAULT_BREADCRUMB_TRAIL_MODE,
  },
): string {
  return [
    getObjectIdentityToken(snapshot.devices),
    getObjectIdentityToken(snapshot.positions),
    getObjectIdentityToken(snapshot.breadcrumbs),
    gapThresholdMs,
    createTrackingStyleFeatureKey(style),
  ].join(':')
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
  const cachedFeatures = getCachedBreadcrumbLineFeatures(
    snapshot.breadcrumbs,
    gapThresholdMs,
    style,
  )
  if (cachedFeatures !== null) {
    return {
      type: 'FeatureCollection',
      features: [...cachedFeatures],
    }
  }

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

  setCachedBreadcrumbLineFeatures(snapshot.breadcrumbs, gapThresholdMs, style, features)

  return {
    type: 'FeatureCollection',
    features,
  }
}

/**
 * Creates one breadcrumb point feature for every position in the bounded live snapshot.
 *
 * Mission storage remains the complete source of truth, while the accumulator enforces
 * the separate per-device live-render budget before this boundary. Dot rendering must not
 * silently omit additional accepted fixes or choose session-dependent representatives.
 */
export function createBreadcrumbPointFeatureCollection(
  snapshot: TrackingSnapshot,
  style: Pick<TrackingStylePreferences, 'deviceColors' | 'breadcrumbSize'> = {
    deviceColors: {},
    breadcrumbSize: 8,
  },
): FeatureCollection<Point> {
  const cachedFeatures = getCachedBreadcrumbPointFeatures(snapshot.breadcrumbs, style)
  if (cachedFeatures !== null) {
    return {
      type: 'FeatureCollection',
      features: [...cachedFeatures],
    }
  }

  const features: GeoJsonBreadcrumbPointFeature[] = snapshot.breadcrumbs.map((breadcrumb) => ({
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

  setCachedBreadcrumbPointFeatures(snapshot.breadcrumbs, style, features)

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

function getCachedBreadcrumbLineFeatures(
  breadcrumbs: readonly NormalizedTrackingPosition[],
  gapThresholdMs: number,
  style: Pick<TrackingStylePreferences, 'deviceColors'>,
): readonly GeoJsonLineFeature[] | null {
  return getBreadcrumbFeatureCache(breadcrumbLineFeaturesByInput, breadcrumbs).get(
    createLineFeatureCacheKey(gapThresholdMs, style),
  ) ?? null
}

function setCachedBreadcrumbLineFeatures(
  breadcrumbs: readonly NormalizedTrackingPosition[],
  gapThresholdMs: number,
  style: Pick<TrackingStylePreferences, 'deviceColors'>,
  features: readonly GeoJsonLineFeature[],
): void {
  getBreadcrumbFeatureCache(breadcrumbLineFeaturesByInput, breadcrumbs).set(
    createLineFeatureCacheKey(gapThresholdMs, style),
    features,
  )
}

function getCachedBreadcrumbPointFeatures(
  breadcrumbs: readonly NormalizedTrackingPosition[],
  style: Pick<TrackingStylePreferences, 'deviceColors' | 'breadcrumbSize'>,
): readonly GeoJsonBreadcrumbPointFeature[] | null {
  return getBreadcrumbFeatureCache(breadcrumbPointFeaturesByInput, breadcrumbs).get(
    createPointFeatureCacheKey(style),
  ) ?? null
}

function setCachedBreadcrumbPointFeatures(
  breadcrumbs: readonly NormalizedTrackingPosition[],
  style: Pick<TrackingStylePreferences, 'deviceColors' | 'breadcrumbSize'>,
  features: readonly GeoJsonBreadcrumbPointFeature[],
): void {
  getBreadcrumbFeatureCache(breadcrumbPointFeaturesByInput, breadcrumbs).set(
    createPointFeatureCacheKey(style),
    features,
  )
}

function getBreadcrumbFeatureCache<TFeature>(
  cache: WeakMap<readonly NormalizedTrackingPosition[], Map<string, readonly TFeature[]>>,
  breadcrumbs: readonly NormalizedTrackingPosition[],
): Map<string, readonly TFeature[]> {
  const existing = cache.get(breadcrumbs)
  if (existing !== undefined) {
    return existing
  }

  const nextCache = new Map<string, readonly TFeature[]>()
  cache.set(breadcrumbs, nextCache)
  return nextCache
}

function createLineFeatureCacheKey(
  gapThresholdMs: number,
  style: Pick<TrackingStylePreferences, 'deviceColors'>,
): string {
  return `line:${gapThresholdMs}:${createDeviceColorsKey(style.deviceColors)}`
}

function createPointFeatureCacheKey(
  style: Pick<TrackingStylePreferences, 'deviceColors' | 'breadcrumbSize'>,
): string {
  return `dots:${style.breadcrumbSize ?? 8}:${createDeviceColorsKey(style.deviceColors)}`
}

function createTrackingStyleFeatureKey(style: TrackingStylePreferences): string {
  return [
    style.breadcrumbTrailMode,
    style.breadcrumbSize,
    createDeviceColorsKey(style.deviceColors),
  ].join(':')
}

function createDeviceColorsKey(deviceColors: Readonly<Record<string, string>>): string {
  return Object.entries(deviceColors)
    .sort(([leftId], [rightId]) => leftId.localeCompare(rightId))
    .map(([deviceId, color]) => `${deviceId}=${color}`)
    .join(',')
}

function getObjectIdentityToken(value: object): number {
  const existing = objectIdentityTokens.get(value)
  if (existing !== undefined) {
    return existing
  }

  const nextToken = nextObjectIdentityToken
  nextObjectIdentityToken += 1
  objectIdentityTokens.set(value, nextToken)
  return nextToken
}
