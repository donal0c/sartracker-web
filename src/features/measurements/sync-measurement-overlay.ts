import type maplibregl from 'maplibre-gl'

import {
  createMapOverlayDataKey,
  ensureGeoJsonSource,
  ensureLayer,
} from '../map/map-overlay-primitives'
import { createMeasurementFeatureCollection, createMeasurementPreviewFeatureCollection } from './measurement-geojson'
import type { Measurement, MeasurementRuntimeState } from './measurement-types'

export const MEASUREMENT_SOURCE_ID = 'mission-measurements'
export const MEASUREMENT_PREVIEW_SOURCE_ID = 'mission-measurement-preview'
export const MEASUREMENT_LINE_LAYER_ID = 'mission-measurements-line'
export const MEASUREMENT_LABEL_LAYER_ID = 'mission-measurements-label'
export const MEASUREMENT_PREVIEW_LINE_LAYER_ID = 'mission-measurement-preview-line'
export const MEASUREMENT_PREVIEW_POINT_LAYER_ID = 'mission-measurement-preview-point'
export const MEASUREMENT_LABEL_TEXT_SIZE = 14

/**
 * Synchronizes completed measurement lines and labels into the current map style.
 * Filters out measurements whose IDs appear in `hiddenMeasurementIds`.
 */
export function syncMeasurementOverlay(
  map: maplibregl.Map,
  measurements: readonly Measurement[],
  hiddenMeasurementIds: readonly string[] = [],
): void {
  const visibleMeasurements =
    hiddenMeasurementIds.length === 0
      ? measurements
      : measurements.filter((m) => !hiddenMeasurementIds.includes(m.id))
  ensureGeoJsonSource(
    map,
    MEASUREMENT_SOURCE_ID,
    createMeasurementFeatureCollection(visibleMeasurements),
    {
      dataKey: createMapOverlayDataKey([
        'measurements',
        measurements,
        hiddenMeasurementIds,
      ]),
    },
  )
  ensureMeasurementLayers(map)
}

/**
 * Synchronizes the in-progress measurement preview into the current map style.
 */
export function syncMeasurementPreviewOverlay(
  map: maplibregl.Map,
  runtime: Pick<MeasurementRuntimeState, 'draftStart' | 'hoverPoint'>,
): void {
  ensureGeoJsonSource(
    map,
    MEASUREMENT_PREVIEW_SOURCE_ID,
    createMeasurementPreviewFeatureCollection(runtime),
    {
      dataKey: createMapOverlayDataKey([
        'measurement-preview',
        runtime.draftStart,
        runtime.hoverPoint,
      ]),
    },
  )
  ensureMeasurementPreviewLayers(map)
}

function ensureMeasurementLayers(map: maplibregl.Map): void {
  ensureLayer(map, {
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

  ensureLayer(map, {
    id: MEASUREMENT_LABEL_LAYER_ID,
    type: 'symbol',
    source: MEASUREMENT_SOURCE_ID,
    filter: ['==', ['get', 'featureKind'], 'label'],
    layout: {
      'text-field': ['get', 'label'],
      'text-size': MEASUREMENT_LABEL_TEXT_SIZE,
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

function ensureMeasurementPreviewLayers(map: maplibregl.Map): void {
  ensureLayer(map, {
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

  ensureLayer(map, {
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
