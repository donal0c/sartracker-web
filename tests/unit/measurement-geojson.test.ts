import { describe, expect, it } from 'vitest'

import {
  createMeasurementFeatureCollection,
  createMeasurementPreviewFeatureCollection,
} from '../../src/features/measurements/measurement-geojson'
import { createMeasurement, formatMeasurementLabel } from '../../src/features/measurements/start-measurement-runtime'

describe('measurement geojson', () => {
  it('creates line and label features for completed measurements', () => {
    const measurement = createMeasurement('mission-1', [-9.7, 51.97], [-9.68, 51.98])

    const collection = createMeasurementFeatureCollection([measurement])
    expect(collection.features).toHaveLength(2)
    expect(collection.features[0]?.geometry.type).toBe('LineString')
    expect(collection.features[1]?.geometry.type).toBe('Point')
    expect(collection.features[1]?.properties?.label).toBe(measurement.label)
  })

  it('creates start-point and preview-line features while a measurement is in progress', () => {
    const collection = createMeasurementPreviewFeatureCollection({
      draftStart: [-9.7, 51.97],
      hoverPoint: [-9.68, 51.98],
    })

    expect(collection.features).toHaveLength(2)
    expect(collection.features[0]?.properties?.featureKind).toBe('start')
    expect(collection.features[1]?.properties?.featureKind).toBe('preview')
  })

  it('formats the permanent measurement label with distance and true/magnetic bearings', () => {
    expect(formatMeasurementLabel(1532, 94.5, 90)).toBe('1.53 km · T 94.5° · M 90.0°')
  })
})
