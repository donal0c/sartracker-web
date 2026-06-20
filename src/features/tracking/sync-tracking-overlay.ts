import type maplibregl from 'maplibre-gl'

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
  createTrackingFeatureCollectionDataKey,
  createTrackingFeatureCollection,
} from './tracking-geojson'
import {
  DEFAULT_BREADCRUMB_SIZE,
  DEFAULT_BREADCRUMB_TRAIL_MODE,
  clampBreadcrumbSize,
  type TrackingStylePreferences,
} from './tracking-style-store'
import type { TrackingSnapshot } from './tracking-types'

export const TRACKING_SOURCE_ID = 'tracking'
export const TRACKING_BREADCRUMB_CASING_LAYER_ID = 'tracking-breadcrumbs-casing'
export const TRACKING_BREADCRUMB_DOTS_LAYER_ID = 'tracking-breadcrumbs-dots'
export const TRACKING_DEVICE_HALO_LAYER_ID = 'tracking-devices-halo'
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
): void {
  const breadcrumbSize = clampBreadcrumbSize(style.breadcrumbSize)
  const breadcrumbDotRadius = breadcrumbSize / 2
  ensureGeoJsonSource(
    map,
    TRACKING_SOURCE_ID,
    createTrackingFeatureCollection(snapshot, DEFAULT_BREADCRUMB_LINE_GAP_THRESHOLD_MS, style),
    {
      dataKey: createMapOverlayDataKey([
        'tracking',
        createTrackingFeatureCollectionDataKey(
          snapshot,
          DEFAULT_BREADCRUMB_LINE_GAP_THRESHOLD_MS,
          style,
        ),
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
    source: TRACKING_SOURCE_ID,
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
      'text-halo-width': 4,
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
