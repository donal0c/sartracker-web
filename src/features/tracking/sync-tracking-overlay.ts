import type maplibregl from 'maplibre-gl'
import type { ExpressionSpecification } from 'maplibre-gl'

import { buildTrackingLayerFilter } from '../layers/map-layer-filters'
import { createTrackingFeatureCollection } from './tracking-geojson'
import type { TrackingSnapshot } from './tracking-types'

export const TRACKING_SOURCE_ID = 'tracking'
export const TRACKING_DEVICE_LAYER_ID = 'tracking-devices-circle'
export const TRACKING_DEVICE_LABEL_LAYER_ID = 'tracking-devices-label'
export const TRACKING_BREADCRUMB_LAYER_ID = 'tracking-breadcrumbs-line'

/**
 * Synchronizes tracking source/layers and applies the current device visibility filters.
 */
export function syncTrackingOverlay(
  map: maplibregl.Map,
  snapshot: TrackingSnapshot,
  hiddenDeviceIds: readonly string[],
  breadcrumbsVisible: boolean,
): void {
  ensureTrackingSource(map, createTrackingFeatureCollection(snapshot, 5 * 60 * 1000))

  if (!map.getLayer(TRACKING_BREADCRUMB_LAYER_ID)) {
    map.addLayer({
      id: TRACKING_BREADCRUMB_LAYER_ID,
      type: 'line',
      source: TRACKING_SOURCE_ID,
      filter: ['==', '$type', 'LineString'],
      paint: {
        'line-color': ['get', 'color'],
        'line-width': 3,
        'line-opacity': 0.85,
      },
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
      },
    })
  }

  if (!map.getLayer(TRACKING_DEVICE_LAYER_ID)) {
    map.addLayer({
      id: TRACKING_DEVICE_LAYER_ID,
      type: 'circle',
      source: TRACKING_SOURCE_ID,
      filter: ['==', '$type', 'Point'],
      paint: {
        'circle-color': ['get', 'color'],
        'circle-radius': 7,
        'circle-stroke-color': [
          'case',
          ['boolean', ['get', 'stale'], false],
          '#FACC15',
          '#FFFFFF',
        ],
        'circle-stroke-width': [
          'case',
          ['boolean', ['get', 'stale'], false],
          3,
          2,
        ],
        'circle-opacity': [
          'case',
          ['==', ['get', 'dataOrigin'], 'cache'],
          0.85,
          1,
        ],
      },
    })
  }

  if (!map.getLayer(TRACKING_DEVICE_LABEL_LAYER_ID)) {
    map.addLayer({
      id: TRACKING_DEVICE_LABEL_LAYER_ID,
      type: 'symbol',
      source: TRACKING_SOURCE_ID,
      filter: ['==', '$type', 'Point'],
      layout: {
        'text-field': ['get', 'name'],
        'text-font': ['Open Sans Regular', 'Arial Unicode MS Regular'],
        'text-size': 12,
        'text-offset': [0, -1.4],
        'text-anchor': 'bottom',
        'text-allow-overlap': false,
        'text-ignore-placement': false,
      },
      paint: {
        'text-color': '#FDE68A',
        'text-halo-color': '#0f172a',
        'text-halo-width': 2,
      },
    })
  }

  const visibilityFilter = buildTrackingLayerFilter(hiddenDeviceIds)
  map.setFilter(
    TRACKING_BREADCRUMB_LAYER_ID,
    breadcrumbsVisible
      ? combineFilters(['==', '$type', 'LineString'], visibilityFilter)
      : ['==', ['get', 'deviceId'], '__hidden__'],
  )
  map.setFilter(TRACKING_DEVICE_LAYER_ID, combineFilters(['==', '$type', 'Point'], visibilityFilter))
  map.setFilter(
    TRACKING_DEVICE_LABEL_LAYER_ID,
    combineFilters(['==', '$type', 'Point'], visibilityFilter),
  )
}

function ensureTrackingSource(
  map: maplibregl.Map,
  data: GeoJSON.FeatureCollection,
): void {
  const source = map.getSource(TRACKING_SOURCE_ID) as maplibregl.GeoJSONSource | undefined
  if (source) {
    source.setData(data)
    return
  }

  map.addSource(TRACKING_SOURCE_ID, {
    type: 'geojson',
    data,
  })
}

function combineFilters(
  baseFilter: ExpressionSpecification,
  visibilityFilter: ExpressionSpecification | null,
): ExpressionSpecification {
  if (visibilityFilter === null) {
    return baseFilter
  }

  return ['all', baseFilter, visibilityFilter]
}
