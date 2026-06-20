import type maplibregl from 'maplibre-gl'

import type { GpxTrackImport } from '../../infrastructure/mission-store/tauri-mission-store'
import { buildGpxLayerFilter } from '../layers/map-layer-filters'
import { ensureGeoJsonSource, ensureLayer } from '../map/map-overlay-primitives'
import { createGpxFeatureCollection } from './gpx-geojson'
import { DEFAULT_GPX_TRACK_COLOR } from './gpx-style'

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
  ensureGeoJsonSource(map, GPX_SOURCE_ID, createGpxFeatureCollection(imports))
  ensureLayer(map, {
    id: GPX_LINE_LAYER_ID,
    type: 'line',
    source: GPX_SOURCE_ID,
    paint: {
      'line-color': ['coalesce', ['get', 'color'], DEFAULT_GPX_TRACK_COLOR],
      'line-width': 3,
      'line-opacity': 0.9,
      'line-dasharray': [1.2, 1],
    },
    layout: {
      'line-cap': 'round',
      'line-join': 'round',
    },
  })
  map.setFilter(GPX_LINE_LAYER_ID, buildGpxLayerFilter(hiddenImportIds))
}
