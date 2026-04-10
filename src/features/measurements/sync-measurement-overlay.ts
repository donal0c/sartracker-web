import type maplibregl from 'maplibre-gl'

import { createMeasurementFeatureCollection, createMeasurementPreviewFeatureCollection } from './measurement-geojson'
import type { Measurement, MeasurementRuntimeState } from './measurement-types'

export const MEASUREMENT_SOURCE_ID = 'mission-measurements'
export const MEASUREMENT_PREVIEW_SOURCE_ID = 'mission-measurement-preview'
export const MEASUREMENT_LINE_LAYER_ID = 'mission-measurements-line'
export const MEASUREMENT_LABEL_LAYER_ID = 'mission-measurements-label'
export const MEASUREMENT_PREVIEW_LINE_LAYER_ID = 'mission-measurement-preview-line'
export const MEASUREMENT_PREVIEW_POINT_LAYER_ID = 'mission-measurement-preview-point'

/**
 * Synchronizes completed measurement lines and labels into the current map style.
 */
export function syncMeasurementOverlay(
  map: maplibregl.Map,
  measurements: readonly Measurement[],
): void {
  ensureMeasurementSource(map, createMeasurementFeatureCollection(measurements))
  ensureMeasurementLayers(map)
}

/**
 * Synchronizes the in-progress measurement preview into the current map style.
 */
export function syncMeasurementPreviewOverlay(
  map: maplibregl.Map,
  runtime: Pick<MeasurementRuntimeState, 'draftStart' | 'hoverPoint'>,
): void {
  ensureMeasurementPreviewSource(map, createMeasurementPreviewFeatureCollection(runtime))
  ensureMeasurementPreviewLayers(map)
}

function ensureMeasurementSource(
  map: maplibregl.Map,
  data: GeoJSON.FeatureCollection,
): void {
  const source = map.getSource(MEASUREMENT_SOURCE_ID) as maplibregl.GeoJSONSource | undefined
  if (source !== undefined) {
    source.setData(data)
    return
  }

  map.addSource(MEASUREMENT_SOURCE_ID, {
    type: 'geojson',
    data,
  })
}

function ensureMeasurementPreviewSource(
  map: maplibregl.Map,
  data: GeoJSON.FeatureCollection,
): void {
  const source = map.getSource(MEASUREMENT_PREVIEW_SOURCE_ID) as
    | maplibregl.GeoJSONSource
    | undefined
  if (source !== undefined) {
    source.setData(data)
    return
  }

  map.addSource(MEASUREMENT_PREVIEW_SOURCE_ID, {
    type: 'geojson',
    data,
  })
}

function ensureMeasurementLayers(map: maplibregl.Map): void {
  if (!map.getLayer(MEASUREMENT_LINE_LAYER_ID)) {
    map.addLayer({
      id: MEASUREMENT_LINE_LAYER_ID,
      type: 'line',
      source: MEASUREMENT_SOURCE_ID,
      filter: ['==', ['get', 'featureKind'], 'line'],
      paint: {
        'line-color': '#22D3EE',
        'line-width': 2.5,
        'line-dasharray': [1, 1.4],
      },
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
      },
    })
  }

  if (!map.getLayer(MEASUREMENT_LABEL_LAYER_ID)) {
    map.addLayer({
      id: MEASUREMENT_LABEL_LAYER_ID,
      type: 'symbol',
      source: MEASUREMENT_SOURCE_ID,
      filter: ['==', ['get', 'featureKind'], 'label'],
      layout: {
        'text-field': ['get', 'label'],
        'text-size': 11,
        'text-font': ['Open Sans Semibold', 'Arial Unicode MS Bold'],
        'text-anchor': 'top',
        'text-offset': [0, 1],
        'text-allow-overlap': true,
        'text-ignore-placement': true,
      },
      paint: {
        'text-color': '#CFFAFE',
        'text-halo-color': '#082F49',
        'text-halo-width': 1.5,
      },
    })
  }
}

function ensureMeasurementPreviewLayers(map: maplibregl.Map): void {
  if (!map.getLayer(MEASUREMENT_PREVIEW_LINE_LAYER_ID)) {
    map.addLayer({
      id: MEASUREMENT_PREVIEW_LINE_LAYER_ID,
      type: 'line',
      source: MEASUREMENT_PREVIEW_SOURCE_ID,
      filter: ['==', ['get', 'featureKind'], 'preview'],
      paint: {
        'line-color': '#67E8F9',
        'line-width': 2,
        'line-dasharray': [1, 1.4],
      },
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
      },
    })
  }

  if (!map.getLayer(MEASUREMENT_PREVIEW_POINT_LAYER_ID)) {
    map.addLayer({
      id: MEASUREMENT_PREVIEW_POINT_LAYER_ID,
      type: 'circle',
      source: MEASUREMENT_PREVIEW_SOURCE_ID,
      filter: ['==', ['get', 'featureKind'], 'start'],
      paint: {
        'circle-radius': 5,
        'circle-color': '#22D3EE',
        'circle-stroke-color': '#082F49',
        'circle-stroke-width': 1.5,
      },
    })
  }
}
