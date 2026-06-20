import type maplibregl from 'maplibre-gl'

import type { Drawing } from '../../infrastructure/mission-store/tauri-mission-store'
import { buildDrawingLayerFilter } from '../layers/map-layer-filters'
import {
  combineMapFilters,
  createMapOverlayDataKey,
  ensureGeoJsonSource,
  ensureLayer,
  type MapOverlayFilter,
} from '../map/map-overlay-primitives'
import type { DrawingRuntimeState } from './drawing-store'
import { createDrawingFeatureCollection, createDrawingPreviewFeatureCollection } from './drawing-geojson'

export const DRAWING_SOURCE_ID = 'mission-drawings'
export const DRAWING_PREVIEW_SOURCE_ID = 'mission-drawing-preview'
export const DRAWING_FILL_LAYER_ID = 'mission-drawings-fill'
export const DRAWING_LINE_CASING_LAYER_ID = 'mission-drawings-line-casing'
export const DRAWING_LINE_LAYER_ID = 'mission-drawings-line'
export const DRAWING_LABEL_LAYER_ID = 'mission-drawings-label'
export const DRAWING_POINT_LAYER_ID = 'mission-drawings-point'
export const DRAWING_POINT_HITBOX_LAYER_ID = 'mission-drawings-point-hitbox'
export const DRAWING_LINE_HITBOX_LAYER_ID = 'mission-drawings-line-hitbox'
export const DRAWING_FILL_HITBOX_LAYER_ID = 'mission-drawings-fill-hitbox'
export const DRAWING_PREVIEW_FILL_LAYER_ID = 'mission-drawing-preview-fill'
export const DRAWING_PREVIEW_LINE_LAYER_ID = 'mission-drawing-preview-line'
export const DRAWING_PREVIEW_POINT_LAYER_ID = 'mission-drawing-preview-point'

/**
 * Modern expression-form geometry-kind selectors.
 *
 * MapLibre 5 silently DROPS a filter that nests the legacy `['==','$type',X]`
 * selector inside an `['all', …]` expression (setFilter does not throw, but
 * getFilter then returns undefined and the layer renders unfiltered). The
 * expression form below survives nesting, so visibility and geometry-kind
 * filters actually apply.
 */
const IS_POINT_GEOMETRY: MapOverlayFilter = ['==', ['geometry-type'], 'Point']
const IS_LINE_GEOMETRY: MapOverlayFilter = ['==', ['geometry-type'], 'LineString']
const IS_POLYGON_GEOMETRY: MapOverlayFilter = ['==', ['geometry-type'], 'Polygon']
const IS_GEOMETRY_KIND: MapOverlayFilter = ['==', ['get', 'featureKind'], 'geometry']

export function syncDrawingOverlay(
  map: maplibregl.Map,
  drawings: readonly Drawing[],
  hiddenDrawingIds: readonly string[],
  drawingTypeVisibility: Record<Drawing['type'], boolean>,
  selectedDrawingId: string | null,
): void {
  ensureGeoJsonSource(
    map,
    DRAWING_SOURCE_ID,
    createDrawingFeatureCollection(drawings, selectedDrawingId),
    {
      dataKey: createMapOverlayDataKey(['drawings', drawings, selectedDrawingId]),
    },
  )
  ensureDrawingLayers(map)

  const geometryVisibilityFilter = buildDrawingLayerFilter(
    drawingTypeVisibility,
    hiddenDrawingIds,
    'geometry',
  )
  const labelVisibilityFilter = buildDrawingLayerFilter(
    drawingTypeVisibility,
    hiddenDrawingIds,
    'label',
  )

  map.setFilter(DRAWING_FILL_LAYER_ID, combineMapFilters(IS_POLYGON_GEOMETRY, geometryVisibilityFilter))
  map.setFilter(
    DRAWING_FILL_HITBOX_LAYER_ID,
    combineMapFilters(IS_POLYGON_GEOMETRY, geometryVisibilityFilter),
  )
  // Both the casing and the coloured line render every geometry feature so that
  // polygon boundaries (search areas, sectors) get the same crisp, haloed
  // outline as plain lines and range rings.
  map.setFilter(
    DRAWING_LINE_CASING_LAYER_ID,
    combineMapFilters(IS_GEOMETRY_KIND, geometryVisibilityFilter),
  )
  map.setFilter(
    DRAWING_LINE_LAYER_ID,
    combineMapFilters(IS_GEOMETRY_KIND, geometryVisibilityFilter),
  )
  map.setFilter(
    DRAWING_LINE_HITBOX_LAYER_ID,
    combineMapFilters(IS_LINE_GEOMETRY, geometryVisibilityFilter),
  )
  map.setFilter(
    DRAWING_LABEL_LAYER_ID,
    combineMapFilters(['==', ['get', 'featureKind'], 'label'], labelVisibilityFilter),
  )
  const geometryPointFilter = ['all', IS_POINT_GEOMETRY, IS_GEOMETRY_KIND] as MapOverlayFilter
  map.setFilter(
    DRAWING_POINT_LAYER_ID,
    combineMapFilters(geometryPointFilter, geometryVisibilityFilter),
  )
  map.setFilter(
    DRAWING_POINT_HITBOX_LAYER_ID,
    combineMapFilters(geometryPointFilter, geometryVisibilityFilter),
  )
}

export function syncDrawingPreviewOverlay(
  map: maplibregl.Map,
  runtime: Pick<DrawingRuntimeState, 'sketch' | 'activeTool'>,
): void {
  ensureGeoJsonSource(
    map,
    DRAWING_PREVIEW_SOURCE_ID,
    createDrawingPreviewFeatureCollection(runtime.sketch, runtime.activeTool),
    {
      dataKey: createMapOverlayDataKey(['drawing-preview', runtime.sketch, runtime.activeTool]),
    },
  )
  ensurePreviewLayers(map)
}

function ensureDrawingLayers(map: maplibregl.Map): void {
  ensureLayer(map, {
    id: DRAWING_FILL_LAYER_ID,
    type: 'fill',
    source: DRAWING_SOURCE_ID,
    paint: {
      'fill-color': ['get', 'fillColor'],
      'fill-opacity': ['case', ['boolean', ['get', 'selected'], false], 0.32, 0.18],
    },
  })

  ensureLayer(map, {
    id: DRAWING_FILL_HITBOX_LAYER_ID,
    type: 'fill',
    source: DRAWING_SOURCE_ID,
    paint: {
      'fill-color': '#000000',
      'fill-opacity': 0,
    },
  })

  // Dark casing drawn underneath the coloured stroke so any drawing colour
  // stays legible against busy topographic terrain (matches the tracking
  // breadcrumb casing treatment).
  ensureLayer(map, {
    id: DRAWING_LINE_CASING_LAYER_ID,
    type: 'line',
    source: DRAWING_SOURCE_ID,
    paint: {
      'line-color': '#020617',
      'line-width': [
        'case',
        ['boolean', ['get', 'selected'], false],
        ['+', ['get', 'width'], 4.5],
        ['+', ['get', 'width'], 3],
      ],
      'line-opacity': 0.85,
    },
    layout: {
      'line-cap': 'round',
      'line-join': 'round',
    },
  })

  ensureLayer(map, {
    id: DRAWING_LINE_LAYER_ID,
    type: 'line',
    source: DRAWING_SOURCE_ID,
    paint: {
      'line-color': ['get', 'strokeColor'],
      'line-width': [
        'case',
        ['boolean', ['get', 'selected'], false],
        ['+', ['get', 'width'], 1.5],
        ['get', 'width'],
      ],
    },
    layout: {
      'line-cap': 'round',
      'line-join': 'round',
    },
  })

  ensureLayer(map, {
    id: DRAWING_LINE_HITBOX_LAYER_ID,
    type: 'line',
    source: DRAWING_SOURCE_ID,
    paint: {
      'line-color': '#000000',
      'line-width': 18,
      'line-opacity': 0,
    },
    layout: {
      'line-cap': 'round',
      'line-join': 'round',
    },
  })

  ensureLayer(map, {
    id: DRAWING_POINT_LAYER_ID,
    type: 'circle',
    source: DRAWING_SOURCE_ID,
    paint: {
      'circle-radius': ['case', ['boolean', ['get', 'selected'], false], 5.5, 4],
      'circle-color': ['coalesce', ['get', 'strokeColor'], ['get', 'labelColor']],
      'circle-opacity': ['case', ['boolean', ['get', 'selected'], false], 0.95, 0.75],
      'circle-stroke-color': '#0C0A09',
      'circle-stroke-width': 1.5,
    },
  })

  ensureLayer(map, {
    id: DRAWING_POINT_HITBOX_LAYER_ID,
    type: 'circle',
    source: DRAWING_SOURCE_ID,
    paint: {
      'circle-radius': [
        'case',
        ['==', ['get', 'drawingType'], 'text_label'],
        16,
        12,
      ],
      'circle-color': '#000000',
      'circle-opacity': 0,
    },
  })

  ensureLayer(map, {
    id: DRAWING_LABEL_LAYER_ID,
    type: 'symbol',
    source: DRAWING_SOURCE_ID,
    layout: {
      'text-field': ['get', 'label'],
      'text-size': ['coalesce', ['get', 'fontSize'], 11],
      'text-font': ['Open Sans Semibold', 'Arial Unicode MS Bold'],
      'text-offset': [
        'case',
        ['==', ['get', 'drawingType'], 'text_label'],
        ['literal', [0, 0]],
        ['literal', [0, 1.2]],
      ],
      'text-anchor': [
        'case',
        ['==', ['get', 'drawingType'], 'text_label'],
        'center',
        'top',
      ],
      'text-rotate': ['coalesce', ['get', 'rotation'], 0],
      'text-allow-overlap': true,
      'text-ignore-placement': true,
    },
    paint: {
      'text-color': ['get', 'labelColor'],
      'text-halo-color': '#0C0A09',
      'text-halo-width': 1.3,
    },
  })
}

function ensurePreviewLayers(map: maplibregl.Map): void {
  ensureLayer(map, {
    id: DRAWING_PREVIEW_FILL_LAYER_ID,
    type: 'fill',
    source: DRAWING_PREVIEW_SOURCE_ID,
    paint: {
      'fill-color': ['get', 'fillColor'],
      'fill-opacity': 0.14,
    },
    filter: ['==', '$type', 'Polygon'],
  })

  ensureLayer(map, {
    id: DRAWING_PREVIEW_LINE_LAYER_ID,
    type: 'line',
    source: DRAWING_PREVIEW_SOURCE_ID,
    paint: {
      'line-color': ['get', 'strokeColor'],
      'line-width': ['get', 'width'],
      'line-dasharray': [1, 1.5],
    },
    layout: {
      'line-cap': 'round',
      'line-join': 'round',
    },
    filter: ['==', '$type', 'LineString'],
  })

  ensureLayer(map, {
    id: DRAWING_PREVIEW_POINT_LAYER_ID,
    type: 'circle',
    source: DRAWING_PREVIEW_SOURCE_ID,
    paint: {
      'circle-radius': 4.5,
      'circle-color': ['get', 'strokeColor'],
      'circle-stroke-color': '#0C0A09',
      'circle-stroke-width': 1.2,
    },
    filter: ['==', '$type', 'Point'],
  })
}
