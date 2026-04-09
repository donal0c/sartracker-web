import type maplibregl from 'maplibre-gl'
import type { FeatureCollection, Geometry, GeoJsonProperties } from 'geojson'

import { createBreadcrumbFeatureCollection, createDeviceFeatureCollection } from './tracking-geojson'
import type { TrackingSnapshot } from './tracking-types'

const TRACKING_DEVICE_SOURCE_ID = 'tracking-devices'
const TRACKING_BREADCRUMB_SOURCE_ID = 'tracking-breadcrumbs'
const TRACKING_DEVICE_LAYER_ID = 'tracking-devices-circle'
const TRACKING_BREADCRUMB_LAYER_ID = 'tracking-breadcrumbs-line'

/**
 * Synchronizes tracking sources and layers into the current map style.
 */
export function syncTrackingOverlay(
  map: maplibregl.Map,
  snapshot: TrackingSnapshot,
): void {
  ensureTrackingSource(
    map,
    TRACKING_BREADCRUMB_SOURCE_ID,
    createBreadcrumbFeatureCollection(snapshot, 5 * 60 * 1000),
  )
  ensureTrackingSource(map, TRACKING_DEVICE_SOURCE_ID, createDeviceFeatureCollection(snapshot))

  if (!map.getLayer(TRACKING_BREADCRUMB_LAYER_ID)) {
    map.addLayer({
      id: TRACKING_BREADCRUMB_LAYER_ID,
      type: 'line',
      source: TRACKING_BREADCRUMB_SOURCE_ID,
      paint: {
        'line-color': ['get', 'color'],
        'line-width': 1.5,
        'line-dasharray': [1, 1.5],
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
      source: TRACKING_DEVICE_SOURCE_ID,
      paint: {
        'circle-color': ['get', 'color'],
        'circle-radius': 5,
        'circle-stroke-color': [
          'case',
          ['boolean', ['get', 'stale'], false],
          '#FACC15',
          '#0F172A',
        ],
        'circle-stroke-width': [
          'case',
          ['boolean', ['get', 'stale'], false],
          2.5,
          1.5,
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
}

function ensureTrackingSource(
  map: maplibregl.Map,
  sourceId: string,
  data: FeatureCollection<Geometry, GeoJsonProperties>,
): void {
  const source = map.getSource(sourceId) as maplibregl.GeoJSONSource | undefined
  if (source) {
    source.setData(data)
    return
  }

  map.addSource(sourceId, {
    type: 'geojson',
    data,
  })
}
