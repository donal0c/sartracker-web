import type maplibregl from 'maplibre-gl'
import type { GeoJSONSource, GeoJSONSourceDiff } from 'maplibre-gl'

import { buildTrackingLayerFilter } from '../layers/map-layer-filters'
import {
  combineMapFilters,
  createMapOverlayDataKey,
  ensureGeoJsonSource,
  ensureLayer,
  type MapOverlayFilter,
} from '../map/map-overlay-primitives'
import {
  DEFAULT_BREADCRUMB_LINE_GAP_THRESHOLD_MS,
  createBreadcrumbFeatureCollection,
  createDeviceFeatureCollection,
  createExactBreadcrumbDotFeatureCollection,
  createTrackingFeatureCollection,
  createTrackingStyleFeatureKey,
} from './tracking-geojson'
import type { ExactBreadcrumbDotState } from './exact-breadcrumb-dot-controller'
import {
  DEFAULT_BREADCRUMB_SIZE,
  DEFAULT_BREADCRUMB_TRAIL_MODE,
  clampBreadcrumbSize,
  type TrackingStylePreferences,
} from './tracking-style-store'
import type { TrackingSnapshot } from './tracking-types'
import type { DeviceStationaryAttention } from './stationary-attention-store'

export const TRACKING_SOURCE_ID = 'tracking'
export const TRACKING_EXACT_BREADCRUMB_DOTS_SOURCE_ID = 'tracking-breadcrumb-dots-exact'
export const TRACKING_BREADCRUMB_CASING_LAYER_ID = 'tracking-breadcrumbs-casing'
export const TRACKING_BREADCRUMB_DOTS_LAYER_ID = 'tracking-breadcrumbs-dots'
export const TRACKING_DEVICE_HALO_LAYER_ID = 'tracking-devices-halo'
export const TRACKING_DEVICE_ATTENTION_LAYER_ID = 'tracking-devices-attention'
export const TRACKING_DEVICE_LAYER_ID = 'tracking-devices-circle'
export const TRACKING_DEVICE_LABEL_LAYER_ID = 'tracking-devices-label'
export const TRACKING_BREADCRUMB_LAYER_ID = 'tracking-breadcrumbs-line'

/**
 * Modern expression-form geometry-kind selectors. The legacy `['==','$type',X]`
 * form is silently dropped by MapLibre 5 when nested inside `['all', …]`, so
 * these expression equivalents are used everywhere a filter may be combined.
 */
const IS_POINT_GEOMETRY: MapOverlayFilter = ['==', ['geometry-type'], 'Point']
const IS_LINE_GEOMETRY: MapOverlayFilter = ['==', ['geometry-type'], 'LineString']
const IS_DEVICE_POINT_FEATURE: MapOverlayFilter = [
  'all',
  IS_POINT_GEOMETRY,
  ['==', ['get', 'featureKind'], 'device'],
]
const IS_BREADCRUMB_POINT_FEATURE: MapOverlayFilter = [
  'all',
  IS_POINT_GEOMETRY,
  ['==', ['get', 'featureKind'], 'breadcrumb'],
]
const IS_BREADCRUMB_LINE_FEATURE: MapOverlayFilter = [
  'all',
  IS_LINE_GEOMETRY,
  ['==', ['get', 'featureKind'], 'breadcrumbLine'],
]
const HIDDEN_TRACKING_FEATURE_FILTER: MapOverlayFilter = ['==', ['get', 'deviceId'], '__hidden__']
const trackingSnapshotsWithoutBreadcrumbs = new WeakMap<TrackingSnapshot, TrackingSnapshot>()
type IncrementalTrackingSourceState = {
  readonly source: GeoJSONSource
  readonly snapshot: TrackingSnapshot
  readonly styleKey: string
  readonly attentionKey: string
  readonly deviceFeatureIds: readonly string[]
  readonly lineFeatureIdsByDevice: ReadonlyMap<string, readonly string[]>
}
const incrementalTrackingSourceStateByMap = new WeakMap<object, IncrementalTrackingSourceState>()

/**
 * Synchronizes tracking source/layers and applies the current device visibility filters.
 */
export function syncTrackingOverlay(
  map: maplibregl.Map,
  snapshot: TrackingSnapshot,
  hiddenDeviceIds: readonly string[],
  hiddenBreadcrumbDeviceIds: readonly string[],
  breadcrumbsVisible: boolean,
  style: TrackingStylePreferences = {
    deviceColors: {},
    breadcrumbSize: DEFAULT_BREADCRUMB_SIZE,
    breadcrumbTrailMode: DEFAULT_BREADCRUMB_TRAIL_MODE,
  },
  exactBreadcrumbDotState: ExactBreadcrumbDotState = { status: 'inactive' },
  attentionByDevice: Readonly<Record<string, DeviceStationaryAttention>> = {},
): void {
  const breadcrumbSize = clampBreadcrumbSize(style.breadcrumbSize)
  const breadcrumbDotRadius = breadcrumbSize / 2
  const baselineSnapshot =
    style.breadcrumbTrailMode === 'dots'
      ? withoutBreadcrumbs(snapshot)
      : snapshot
  syncIncrementalTrackingSource(
    map,
    baselineSnapshot,
    style,
    attentionByDevice,
  )
  const exactDotPositions =
    exactBreadcrumbDotState.status === 'ready'
      ? exactBreadcrumbDotState.positions
      : []
  ensureGeoJsonSource(
    map,
    TRACKING_EXACT_BREADCRUMB_DOTS_SOURCE_ID,
    {
      build: () =>
        createExactBreadcrumbDotFeatureCollection(exactDotPositions, style),
    },
    {
      dataKey: createMapOverlayDataKey([
        'tracking-exact-breadcrumb-dots',
        exactBreadcrumbDotState.status,
        exactBreadcrumbDotState.status === 'ready'
          ? exactBreadcrumbDotState.positions
          : exactBreadcrumbDotState.status === 'unavailable'
            ? exactBreadcrumbDotState.message
            : exactBreadcrumbDotState.status === 'loading'
              ? exactBreadcrumbDotState.missionId
              : '',
        style.deviceColors,
      ]),
    },
  )

  ensureLayer(map, {
    id: TRACKING_BREADCRUMB_CASING_LAYER_ID,
    type: 'line',
    source: TRACKING_SOURCE_ID,
    filter: IS_BREADCRUMB_LINE_FEATURE,
    paint: {
      'line-color': '#020617',
      'line-width': breadcrumbSize + 1,
      'line-opacity': 0.42,
    },
    layout: {
      'line-cap': 'round',
      'line-join': 'round',
    },
  })
  map.setPaintProperty(TRACKING_BREADCRUMB_CASING_LAYER_ID, 'line-width', breadcrumbSize + 1)

  ensureLayer(map, {
    id: TRACKING_BREADCRUMB_LAYER_ID,
    type: 'line',
    source: TRACKING_SOURCE_ID,
    filter: IS_BREADCRUMB_LINE_FEATURE,
    paint: {
      'line-color': ['get', 'color'],
      'line-width': breadcrumbSize,
      'line-opacity': 0.92,
    },
    layout: {
      'line-cap': 'round',
      'line-join': 'round',
    },
  })
  map.setPaintProperty(TRACKING_BREADCRUMB_LAYER_ID, 'line-width', breadcrumbSize)

  ensureLayer(map, {
    id: TRACKING_BREADCRUMB_DOTS_LAYER_ID,
    type: 'circle',
    source: TRACKING_EXACT_BREADCRUMB_DOTS_SOURCE_ID,
    filter: IS_BREADCRUMB_POINT_FEATURE,
    paint: {
      'circle-color': ['get', 'color'],
      'circle-radius': breadcrumbDotRadius,
      'circle-stroke-color': '#020617',
      'circle-stroke-width': Math.max(1, breadcrumbDotRadius * 0.2),
      'circle-stroke-opacity': 0.48,
      'circle-opacity': 0.95,
    },
  })
  map.setPaintProperty(TRACKING_BREADCRUMB_DOTS_LAYER_ID, 'circle-radius', breadcrumbDotRadius)
  map.setPaintProperty(
    TRACKING_BREADCRUMB_DOTS_LAYER_ID,
    'circle-stroke-width',
    Math.max(1, breadcrumbDotRadius * 0.2),
  )
  map.setPaintProperty(TRACKING_BREADCRUMB_DOTS_LAYER_ID, 'circle-stroke-opacity', 0.48)

  ensureLayer(map, {
    id: TRACKING_DEVICE_ATTENTION_LAYER_ID,
    type: 'circle',
    source: TRACKING_SOURCE_ID,
    filter: combineMapFilters(
      IS_DEVICE_POINT_FEATURE,
      ['==', ['get', 'attention'], true],
    ),
    paint: {
      'circle-color': '#F59E0B',
      'circle-radius': 23,
      'circle-opacity': [
        'case',
        ['boolean', ['get', 'attentionAcknowledged'], false],
        0.28,
        0.68,
      ],
      'circle-stroke-color': '#FEF3C7',
      'circle-stroke-width': 2,
    },
  })

  ensureLayer(map, {
    id: TRACKING_DEVICE_HALO_LAYER_ID,
    type: 'circle',
    source: TRACKING_SOURCE_ID,
    filter: IS_DEVICE_POINT_FEATURE,
    paint: {
      'circle-color': '#020617',
      'circle-radius': 17,
      'circle-opacity': 0.82,
    },
  })

  ensureLayer(map, {
    id: TRACKING_DEVICE_LAYER_ID,
    type: 'circle',
    source: TRACKING_SOURCE_ID,
    filter: IS_DEVICE_POINT_FEATURE,
    paint: {
      'circle-color': ['get', 'color'],
      'circle-radius': 12,
      'circle-stroke-color': [
        'case',
        ['boolean', ['get', 'stale'], false],
        '#FACC15',
        '#FFFFFF',
      ],
      'circle-stroke-width': [
        'case',
        ['boolean', ['get', 'stale'], false],
        4,
        3,
      ],
      'circle-opacity': [
        'case',
        ['==', ['get', 'dataOrigin'], 'cache'],
        0.85,
        1,
      ],
    },
  })

  ensureLayer(map, {
    id: TRACKING_DEVICE_LABEL_LAYER_ID,
    type: 'symbol',
    source: TRACKING_SOURCE_ID,
    filter: IS_DEVICE_POINT_FEATURE,
    layout: {
      'text-field': ['get', 'name'],
      'text-font': ['Open Sans Regular', 'Arial Unicode MS Regular'],
      'text-size': 12,
      'text-offset': [1.2, 0],
      'text-anchor': 'left',
      'text-allow-overlap': true,
      'text-ignore-placement': false,
    },
    paint: {
      'text-color': '#111827',
      'text-halo-color': '#FFFFFF',
      'text-halo-width': 6,
      'text-halo-blur': 0.5,
    },
  })

  const currentLocationVisibilityFilter = buildTrackingLayerFilter(hiddenDeviceIds)
  const breadcrumbVisibilityFilter = buildTrackingLayerFilter(hiddenBreadcrumbDeviceIds)
  const lineTrailsVisible = breadcrumbsVisible && style.breadcrumbTrailMode === 'line'
  const dotTrailsVisible = breadcrumbsVisible && style.breadcrumbTrailMode === 'dots'
  map.setFilter(
    TRACKING_BREADCRUMB_CASING_LAYER_ID,
    lineTrailsVisible
      ? combineMapFilters(IS_BREADCRUMB_LINE_FEATURE, breadcrumbVisibilityFilter)
      : HIDDEN_TRACKING_FEATURE_FILTER,
  )
  map.setFilter(
    TRACKING_BREADCRUMB_LAYER_ID,
    lineTrailsVisible
      ? combineMapFilters(IS_BREADCRUMB_LINE_FEATURE, breadcrumbVisibilityFilter)
      : HIDDEN_TRACKING_FEATURE_FILTER,
  )
  map.setFilter(
    TRACKING_BREADCRUMB_DOTS_LAYER_ID,
    dotTrailsVisible
      ? combineMapFilters(IS_BREADCRUMB_POINT_FEATURE, breadcrumbVisibilityFilter)
      : HIDDEN_TRACKING_FEATURE_FILTER,
  )
  map.setFilter(
    TRACKING_DEVICE_ATTENTION_LAYER_ID,
    combineMapFilters(
      combineMapFilters(IS_DEVICE_POINT_FEATURE, ['==', ['get', 'attention'], true]),
      currentLocationVisibilityFilter,
    ),
  )
  map.setFilter(
    TRACKING_DEVICE_HALO_LAYER_ID,
    combineMapFilters(IS_DEVICE_POINT_FEATURE, currentLocationVisibilityFilter),
  )
  map.setFilter(
    TRACKING_DEVICE_LAYER_ID,
    combineMapFilters(IS_DEVICE_POINT_FEATURE, currentLocationVisibilityFilter),
  )
  map.setFilter(
    TRACKING_DEVICE_LABEL_LAYER_ID,
    combineMapFilters(IS_DEVICE_POINT_FEATURE, currentLocationVisibilityFilter),
  )
}

/**
 * Uses stable feature IDs and MapLibre source diffs so one device's new
 * breadcrumb never retransfers every retained trail through the renderer.
 */
function syncIncrementalTrackingSource(
  map: maplibregl.Map,
  snapshot: TrackingSnapshot,
  style: TrackingStylePreferences,
  attentionByDevice: Readonly<Record<string, DeviceStationaryAttention>>,
): void {
  const source = map.getSource(TRACKING_SOURCE_ID) as GeoJSONSource | undefined
  const styleKey = createTrackingStyleFeatureKey(style)
  const attentionKey = createAttentionFeatureKey(attentionByDevice)
  const previous = incrementalTrackingSourceStateByMap.get(map)
  if (source === undefined) {
    const data = createTrackingFeatureCollection(
      snapshot,
      DEFAULT_BREADCRUMB_LINE_GAP_THRESHOLD_MS,
      style,
      attentionByDevice,
    )
    map.addSource(TRACKING_SOURCE_ID, { type: 'geojson', data })
    const addedSource = map.getSource(TRACKING_SOURCE_ID) as GeoJSONSource | undefined
    if (addedSource !== undefined) {
      incrementalTrackingSourceStateByMap.set(
        map,
        createIncrementalSourceState(addedSource, snapshot, styleKey, attentionKey, data),
      )
    }
    return
  }

  if (
    previous === undefined ||
    previous.source !== source ||
    previous.styleKey !== styleKey ||
    typeof source.updateData !== 'function'
  ) {
    const data = createTrackingFeatureCollection(
      snapshot,
      DEFAULT_BREADCRUMB_LINE_GAP_THRESHOLD_MS,
      style,
      attentionByDevice,
    )
    source.setData(data)
    incrementalTrackingSourceStateByMap.set(
      map,
      createIncrementalSourceState(source, snapshot, styleKey, attentionKey, data),
    )
    return
  }

  const changedBreadcrumbDeviceIds = findChangedBreadcrumbDeviceIds(
    previous.snapshot.breadcrumbs,
    snapshot.breadcrumbs,
  )
  const deviceFeaturesChanged = previous.snapshot.devices !== snapshot.devices ||
    previous.snapshot.positions !== snapshot.positions ||
    previous.attentionKey !== attentionKey
  if (!deviceFeaturesChanged && changedBreadcrumbDeviceIds.size === 0) return

  const remove: Array<string | number> = []
  const add: GeoJSON.Feature[] = []
  let deviceFeatureIds = previous.deviceFeatureIds
  if (deviceFeaturesChanged) {
    remove.push(...previous.deviceFeatureIds)
    const deviceFeatures = createDeviceFeatureCollection(
      snapshot,
      style,
      attentionByDevice,
    ).features
    add.push(...deviceFeatures)
    deviceFeatureIds = readFeatureIds(deviceFeatures)
  }

  const lineFeatureIdsByDevice = new Map(previous.lineFeatureIdsByDevice)
  for (const deviceId of changedBreadcrumbDeviceIds) {
    remove.push(...(previous.lineFeatureIdsByDevice.get(deviceId) ?? []))
    const deviceBreadcrumbs = snapshot.breadcrumbs.filter(
      (breadcrumb) => breadcrumb.device_id === deviceId,
    )
    const lineFeatures = createBreadcrumbFeatureCollection(
      { ...snapshot, breadcrumbs: deviceBreadcrumbs },
      DEFAULT_BREADCRUMB_LINE_GAP_THRESHOLD_MS,
      style,
    ).features
    add.push(...lineFeatures)
    const ids = readFeatureIds(lineFeatures)
    if (ids.length === 0) lineFeatureIdsByDevice.delete(deviceId)
    else lineFeatureIdsByDevice.set(deviceId, ids)
  }

  const diff: GeoJSONSourceDiff = {
    ...(remove.length === 0 ? {} : { remove }),
    ...(add.length === 0 ? {} : { add }),
  }
  source.updateData(diff)
  incrementalTrackingSourceStateByMap.set(map, {
    source,
    snapshot,
    styleKey,
    attentionKey,
    deviceFeatureIds,
    lineFeatureIdsByDevice,
  })
}

/** Creates the source state used for later bounded diffs. */
function createIncrementalSourceState(
  source: GeoJSONSource,
  snapshot: TrackingSnapshot,
  styleKey: string,
  attentionKey: string,
  data: GeoJSON.FeatureCollection,
): IncrementalTrackingSourceState {
  const deviceFeatureIds: string[] = []
  const lineFeatureIdsByDevice = new Map<string, string[]>()
  for (const feature of data.features) {
    if (typeof feature.id !== 'string') continue
    if (feature.properties?.featureKind === 'device') {
      deviceFeatureIds.push(feature.id)
      continue
    }
    if (feature.properties?.featureKind !== 'breadcrumbLine') continue
    const deviceId = feature.properties.deviceId
    if (typeof deviceId !== 'string') continue
    const ids = lineFeatureIdsByDevice.get(deviceId) ?? []
    ids.push(feature.id)
    lineFeatureIdsByDevice.set(deviceId, ids)
  }
  return { source, snapshot, styleKey, attentionKey, deviceFeatureIds, lineFeatureIdsByDevice }
}

/** Finds only devices touched by an immutable-array prefix/suffix delta. */
function findChangedBreadcrumbDeviceIds(
  previous: TrackingSnapshot['breadcrumbs'],
  next: TrackingSnapshot['breadcrumbs'],
): ReadonlySet<string> {
  if (previous === next) return new Set()
  const shortestLength = Math.min(previous.length, next.length)
  let prefixLength = 0
  while (prefixLength < shortestLength && previous[prefixLength] === next[prefixLength]) {
    prefixLength += 1
  }
  let suffixLength = 0
  while (
    suffixLength < shortestLength - prefixLength &&
    previous[previous.length - 1 - suffixLength] === next[next.length - 1 - suffixLength]
  ) {
    suffixLength += 1
  }
  return new Set([
    ...previous.slice(prefixLength, previous.length - suffixLength).map((fix) => fix.device_id),
    ...next.slice(prefixLength, next.length - suffixLength).map((fix) => fix.device_id),
  ])
}

/** Reads the stable IDs required by MapLibre's incremental source contract. */
function readFeatureIds(features: readonly GeoJSON.Feature[]): string[] {
  return features.flatMap((feature) => typeof feature.id === 'string' ? [feature.id] : [])
}

/** Creates a deterministic small key for attention properties on current markers. */
function createAttentionFeatureKey(
  attentionByDevice: Readonly<Record<string, DeviceStationaryAttention>>,
): string {
  return Object.entries(attentionByDevice)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([deviceId, attention]) => `${deviceId}:${attention.state}:${attention.acknowledged}`)
    .join('|')
}

function withoutBreadcrumbs(snapshot: TrackingSnapshot): TrackingSnapshot {
  const existing = trackingSnapshotsWithoutBreadcrumbs.get(snapshot)
  if (existing !== undefined) {
    return existing
  }
  const next: TrackingSnapshot = {
    ...snapshot,
    breadcrumbs: [],
    rawBreadcrumbsForPersistence: [],
  }
  trackingSnapshotsWithoutBreadcrumbs.set(snapshot, next)
  return next
}
