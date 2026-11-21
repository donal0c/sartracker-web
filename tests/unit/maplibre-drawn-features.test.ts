import { describe, expect, it } from 'vitest'

import {
  createDrawingRecorderMap,
  readDrawnFeatures,
  type RecordedFeature,
} from '../support/maplibre-drawn-features'

/**
 * Negative controls for the test helper itself [DON-338]: a paint expression
 * that evaluates to zero for a feature hides it in MapLibre, so the helper must
 * report it as not drawn, and an expression it cannot evaluate must throw.
 */

function line(deviceId: string): RecordedFeature {
  return {
    id: `line:${deviceId}`,
    geometry: { type: 'LineString', coordinates: [[-6.2, 53.3], [-6.21, 53.31]] },
    properties: { deviceId, featureKind: 'breadcrumbLine' },
  }
}

function dot(deviceId: string): RecordedFeature {
  return {
    id: `dot:${deviceId}`,
    geometry: { type: 'Point', coordinates: [-6.2, 53.3] },
    properties: { deviceId, featureKind: 'breadcrumb' },
  }
}

function mapWithTrails() {
  const map = createDrawingRecorderMap()
  map.addSource('trail', { data: { features: [line('A'), line('B')] } })
  map.addSource('dots', { data: { features: [dot('A'), dot('B')] } })
  map.addLayer({ id: 'trail-line', type: 'line', source: 'trail', paint: { 'line-width': 4, 'line-opacity': 0.92 } })
  map.addLayer({ id: 'trail-dots', type: 'circle', source: 'dots', paint: { 'circle-radius': 4, 'circle-opacity': 0.95 } })
  return map
}

function drawnDevices(map: ReturnType<typeof mapWithTrails>, layerId: string): string[] {
  return readDrawnFeatures(map, { layerIds: [layerId] })
    .map((entry) => String(entry.feature.properties.deviceId))
    .sort()
}

const HIDE_A = ['case', ['==', ['get', 'deviceId'], 'A'], 0, 0.9]

describe('readDrawnFeatures paint evaluation [DON-338]', () => {
  it('counts both devices with plain paint values and zoom expressions', () => {
    const map = mapWithTrails()
    expect(drawnDevices(map, 'trail-line')).toEqual(['A', 'B'])
    map.setPaintProperty('trail-line', 'line-width', ['interpolate', ['linear'], ['zoom'], 10, 2, 18, 8])
    expect(drawnDevices(map, 'trail-line')).toEqual(['A', 'B'])
  })

  it.each([
    ['trail-line', 'line-opacity'],
    ['trail-line', 'line-width'],
    ['trail-dots', 'circle-opacity'],
    ['trail-dots', 'circle-radius'],
  ])('reports nothing drawn when %s %s is a zero literal expression', (layerId, property) => {
    const map = mapWithTrails()
    map.setPaintProperty(layerId, property, ['literal', 0])
    expect(drawnDevices(map, layerId)).toEqual([])
  })

  it.each([
    ['trail-line', 'line-opacity'],
    ['trail-line', 'line-width'],
    ['trail-dots', 'circle-opacity'],
    ['trail-dots', 'circle-radius'],
  ])('reports only the hidden device as not drawn when %s %s is zero for it', (layerId, property) => {
    const map = mapWithTrails()
    map.setPaintProperty(layerId, property, HIDE_A)
    expect(drawnDevices(map, layerId)).toEqual(['B'])
  })

  it('throws rather than count a feature when a paint expression cannot be evaluated', () => {
    const map = mapWithTrails()
    map.setPaintProperty('trail-line', 'line-opacity', ['no-such-operator', 1])
    expect(() => readDrawnFeatures(map, { layerIds: ['trail-line'] })).toThrow(/line-opacity/u)
    map.setPaintProperty('trail-line', 'line-opacity', 0.9)
    map.setPaintProperty('trail-dots', 'circle-radius', ['get', 'deviceId'])
    expect(() => readDrawnFeatures(map, { layerIds: ['trail-dots'] })).toThrow(/circle-radius/u)
  })
})
