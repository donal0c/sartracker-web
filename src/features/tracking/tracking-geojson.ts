import type { Feature, FeatureCollection, Geometry, LineString, Point } from 'geojson'

import { BREADCRUMB_LINE_GAP_THRESHOLD_MS } from './breadcrumb-accumulator'
import { selectNewestKnownFixes } from './newest-known-fix'
import { createTrailSegments } from './trail-segmentation'
import { createDeviceColor } from './tracking-color'
import {
  DEFAULT_BREADCRUMB_TRAIL_MODE,
  type TrackingStylePreferences,
} from './tracking-style-store'
import type { NormalizedTrackingPosition, TrackingSnapshot } from './tracking-types'
import type { DeviceStationaryAttention } from './stationary-attention-store'

/** The live line's 30-minute break rule; owned by the accumulator so thinning preserves it. */
export const DEFAULT_BREADCRUMB_LINE_GAP_THRESHOLD_MS = BREADCRUMB_LINE_GAP_THRESHOLD_MS

type GeoJsonPointFeature = Feature<
  Point,
  {
    readonly deviceId: string
    readonly featureKind: 'device'
    readonly name: string
    readonly color: string
    readonly stale: boolean
    readonly dataOrigin: string
    readonly sourcePositionId: string
    readonly timestamp: string
    readonly attention: boolean
    readonly attentionAcknowledged: boolean
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

/**
 * A one-point trail segment (a fix between two silences longer than the
 * break rule, a device's only fix, or a segment whose fixes share one spot).
 * A line layer cannot draw it, so it is its own trail point. It is never a
 * current-position marker and carries no name, so it never gets a label
 * [DON-338] [LIV-5].
 */
type GeoJsonLoneFixFeature = Feature<
  Point,
  {
    readonly deviceId: string
    readonly featureKind: 'breadcrumbLoneFix'
    readonly color: string
  }
>

/** One live trail feature: a line segment, or a lone fix the line cannot draw. */
export type GeoJsonTrailFeature = GeoJsonLineFeature | GeoJsonLoneFixFeature

type GeoJsonBreadcrumbPointFeature = Feature<
  Point,
  {
    readonly deviceId: string
    readonly featureKind: 'breadcrumb'
    readonly color: string
  }
>

type GeoJsonExactBreadcrumbPointFeature = Feature<
  Point,
  {
    readonly deviceId: string
    readonly featureKind: 'breadcrumb'
    readonly color: string
    readonly sourcePositionId: string | null
    readonly timestamp: string
  }
>

const breadcrumbLineFeaturesByInput = new WeakMap<
  readonly NormalizedTrackingPosition[],
  Map<string, readonly GeoJsonTrailFeature[]>
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
  attentionByDevice: Readonly<Record<string, DeviceStationaryAttention>> = {},
): FeatureCollection<Geometry> {
  const breadcrumbFeatures =
    style.breadcrumbTrailMode === 'dots'
      ? createBreadcrumbPointFeatureCollection(snapshot, style).features
      : createBreadcrumbFeatureCollection(snapshot, gapThresholdMs, style).features

  return {
    type: 'FeatureCollection',
    features: [
      ...breadcrumbFeatures,
      ...createDeviceFeatureCollection(snapshot, style, attentionByDevice).features,
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
  attentionByDevice: Readonly<Record<string, DeviceStationaryAttention>> = {},
): string {
  return [
    getObjectIdentityToken(snapshot.devices),
    getObjectIdentityToken(snapshot.positions),
    getObjectIdentityToken(snapshot.breadcrumbs),
    gapThresholdMs,
    createTrackingStyleFeatureKey(style),
    getObjectIdentityToken(attentionByDevice),
  ].join(':')
}

/**
 * Creates GeoJSON point features at each device's newest known fix (current position or
 * breadcrumb), so the marker is never behind the end of its trail.
 */
export function createDeviceFeatureCollection(
  snapshot: TrackingSnapshot,
  style: Pick<TrackingStylePreferences, 'deviceColors'> = { deviceColors: {} },
  attentionByDevice: Readonly<Record<string, Pick<DeviceStationaryAttention, 'state' | 'acknowledged'>>> = {},
): FeatureCollection<Point> {
  const deviceNameById = new Map(
    snapshot.devices.map((device) => [device.device_id, device.name] as const),
  )

  const features: GeoJsonPointFeature[] = selectNewestKnownFixes(
    snapshot.positions,
    snapshot.breadcrumbs,
  ).map((position) => ({
    type: 'Feature',
    id: `device:${position.device_id}`,
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
      sourcePositionId: position.id,
      timestamp: position.timestamp,
      attention: attentionByDevice[position.device_id]?.state === 'attention',
      attentionAcknowledged: attentionByDevice[position.device_id]?.acknowledged === true,
    },
  }))

  return {
    type: 'FeatureCollection',
    features,
  }
}

/**
 * Creates GeoJSON live trail features grouped by device and segmented by time
 * gap: a line for every segment with two or more distinct places, and a
 * `breadcrumbLoneFix` point for every segment a line cannot draw, so every
 * fix in the live projection is drawn [DON-338] [LIV-5].
 */
export function createBreadcrumbFeatureCollection(
  snapshot: TrackingSnapshot,
  gapThresholdMs: number,
  style: Pick<TrackingStylePreferences, 'deviceColors'> = { deviceColors: {} },
): FeatureCollection<LineString | Point, GeoJsonTrailFeature['properties']> {
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

  const features: GeoJsonTrailFeature[] = []

  for (const [deviceId, breadcrumbs] of breadcrumbsByDevice.entries()) {
    const segments = createTrailSegments(breadcrumbs, gapThresholdMs)
    for (const [segmentIndex, segment] of segments.entries()) {
      const first = segment[0]
      if (first === undefined) {
        continue
      }
      if (!hasTwoDistinctPlaces(segment)) {
        // A zero-length line draws nothing, so the segment is a lone trail point.
        features.push({
          type: 'Feature',
          id: `breadcrumb-lone-fix:${deviceId}:${segmentIndex}`,
          geometry: { type: 'Point', coordinates: [first.lon, first.lat] },
          properties: {
            deviceId,
            featureKind: 'breadcrumbLoneFix',
            color: getStyledDeviceColor(deviceId, style.deviceColors),
          },
        })
        continue
      }

      features.push({
        type: 'Feature',
        id: `breadcrumb-line:${deviceId}:${segmentIndex}`,
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

/** True when a segment covers at least two different coordinates. */
function hasTwoDistinctPlaces(segment: readonly NormalizedTrackingPosition[]): boolean {
  const first = segment[0]
  if (first === undefined) return false
  return segment.some((position) => position.lat !== first.lat || position.lon !== first.lon)
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

/**
 * Creates one identifiable GeoJSON point for every authoritative fix in an
 * exact SQLite-backed dot page.
 */
export function createExactBreadcrumbDotFeatureCollection(
  positions: readonly (NormalizedTrackingPosition & {
    readonly source_position_id?: string | null
  })[],
  style: Pick<TrackingStylePreferences, 'deviceColors'> = { deviceColors: {} },
): FeatureCollection<Point> {
  const features: GeoJsonExactBreadcrumbPointFeature[] = positions.map((position) => {
    const sourcePositionId = position.source_position_id?.trim() || null
    return {
      type: 'Feature',
      id: sourcePositionId === null
        ? `${position.device_id}:stored:${position.id.trim()}`
        : `${position.device_id}:id:${sourcePositionId}`,
      geometry: {
        type: 'Point',
        coordinates: [position.lon, position.lat],
      },
      properties: {
        deviceId: position.device_id,
        featureKind: 'breadcrumb',
        color: getStyledDeviceColor(position.device_id, style.deviceColors),
        sourcePositionId,
        timestamp: position.timestamp,
      },
    }
  })

  return { type: 'FeatureCollection', features }
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
): readonly GeoJsonTrailFeature[] | null {
  return getBreadcrumbFeatureCache(breadcrumbLineFeaturesByInput, breadcrumbs).get(
    createLineFeatureCacheKey(gapThresholdMs, style),
  ) ?? null
}

function setCachedBreadcrumbLineFeatures(
  breadcrumbs: readonly NormalizedTrackingPosition[],
  gapThresholdMs: number,
  style: Pick<TrackingStylePreferences, 'deviceColors'>,
  features: readonly GeoJsonTrailFeature[],
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

/** Returns a deterministic key for style fields embedded in tracking features. */
export function createTrackingStyleFeatureKey(style: TrackingStylePreferences): string {
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
