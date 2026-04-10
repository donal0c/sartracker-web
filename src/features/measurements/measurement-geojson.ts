import type { GeoJsonProperties, Position } from 'geojson'

import type { Measurement, MeasurementRuntimeState } from './measurement-types'

/**
 * Builds map features for persisted in-memory measurements and their permanent labels.
 */
export function createMeasurementFeatureCollection(
  measurements: readonly Measurement[],
): GeoJSON.FeatureCollection<GeoJSON.Geometry, GeoJsonProperties> {
  return {
    type: 'FeatureCollection',
    features: measurements.flatMap((measurement) => [
      {
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [
            toPosition(measurement.start),
            toPosition(measurement.end),
          ],
        },
        properties: {
          featureKind: 'line',
          measurementId: measurement.id,
          label: measurement.label,
        },
      },
      {
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: toPosition(measurement.midpoint),
        },
        properties: {
          featureKind: 'label',
          measurementId: measurement.id,
          label: measurement.label,
        },
      },
    ]),
  }
}

/**
 * Builds the live preview overlay while the operator is placing a measurement.
 */
export function createMeasurementPreviewFeatureCollection(
  runtime: Pick<MeasurementRuntimeState, 'draftStart' | 'hoverPoint'>,
): GeoJSON.FeatureCollection<GeoJSON.Geometry, GeoJsonProperties> {
  if (runtime.draftStart === null) {
    return emptyFeatureCollection()
  }

  const features: GeoJSON.Feature<GeoJSON.Geometry, GeoJsonProperties>[] = [
    {
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: toPosition(runtime.draftStart),
      },
      properties: {
        featureKind: 'start',
      },
    },
  ]

  if (runtime.hoverPoint !== null) {
    features.push({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [toPosition(runtime.draftStart), toPosition(runtime.hoverPoint)],
      },
      properties: {
        featureKind: 'preview',
      },
    })
  }

  return {
    type: 'FeatureCollection',
    features,
  }
}

function toPosition(point: readonly [number, number]): Position {
  return [point[0], point[1]]
}

function emptyFeatureCollection(): GeoJSON.FeatureCollection<GeoJSON.Geometry, GeoJsonProperties> {
  return {
    type: 'FeatureCollection',
    features: [],
  }
}
