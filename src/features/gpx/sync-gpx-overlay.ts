import type maplibregl from 'maplibre-gl'

import type { GpxTrackImport } from '../../infrastructure/mission-store/tauri-mission-store'
import { buildGpxLayerFilter } from '../layers/map-layer-filters'
import { createGpxFeatureCollection } from './gpx-geojson'

export const GPX_SOURCE_ID = 'mission-gpx-imports'
export const GPX_LINE_LAYER_ID = 'mission-gpx-imports-line'

/**
 * Synchronizes persisted GPX track imports into the current map style.
 */
export function syncGpxOverlay(
  map: maplibregl.Map,
  imports: readonly GpxTrackImport[],
  hiddenImportIds: readonly string[],
): void {
  ensureGpxSource(map, createGpxFeatureCollection(imports))
  ensureGpxLayers(map)
  map.setFilter(GPX_LINE_LAYER_ID, buildGpxLayerFilter(hiddenImportIds))
}

function ensureGpxSource(map: maplibregl.Map, data: GeoJSON.FeatureCollection): void {
  const source = map.getSource(GPX_SOURCE_ID) as maplibregl.GeoJSONSource | undefined
  if (source !== undefined) {
    source.setData(data)
    return
  }

  map.addSource(GPX_SOURCE_ID, {
    type: 'geojson',
    data,
  })
}

function ensureGpxLayers(map: maplibregl.Map): void {
  if (map.getLayer(GPX_LINE_LAYER_ID)) {
    return
  }

  map.addLayer({
    id: GPX_LINE_LAYER_ID,
    type: 'line',
    source: GPX_SOURCE_ID,
    paint: {
      'line-color': '#f59e0b',
      'line-width': 3,
      'line-opacity': 0.9,
      'line-dasharray': [1.2, 1],
    },
    layout: {
      'line-cap': 'round',
      'line-join': 'round',
    },
  })
}
