import { describe, expect, it } from 'vitest'

import {
  createDrawingRecorderMap,
  OPERATOR_ZOOMS,
  readDrawnFeatures,
  readDrawnFeaturesAtEveryOperatorZoom,
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

function drawnDevices(map: ReturnType<typeof mapWithTrails>, layerId: string, zoom = 14): string[] {
  return readDrawnFeatures(map, { zoom, layerIds: [layerId] })
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
    expect(() => readDrawnFeatures(map, { zoom: 14, layerIds: ['trail-line'] })).toThrow(/line-opacity/u)
    map.setPaintProperty('trail-line', 'line-opacity', 0.9)
    map.setPaintProperty('trail-dots', 'circle-radius', ['get', 'deviceId'])
    expect(() => readDrawnFeatures(map, { zoom: 14, layerIds: ['trail-dots'] })).toThrow(/circle-radius/u)
  })

  it('evaluates zoom expressions at the zoom the caller is testing', () => {
    const map = mapWithTrails()
    map.setPaintProperty('trail-line', 'line-opacity', ['step', ['zoom'], 0, 14, 1])
    expect(drawnDevices(map, 'trail-line', 12)).toEqual([])
    expect(drawnDevices(map, 'trail-line', 14)).toEqual(['A', 'B'])
  })

  it('requires the zoom being tested', () => {
    const map = mapWithTrails()
    expect(() => readDrawnFeatures(map, { layerIds: ['trail-line'] } as never)).toThrow(/zoom/u)
    expect(() => readDrawnFeatures(map, { zoom: Number.NaN, layerIds: ['trail-line'] })).toThrow(/zoom/u)
  })

  it('enforces layer minzoom and maxzoom', () => {
    const map = createDrawingRecorderMap()
    map.addSource('trail', { data: { features: [line('A')] } })
    map.addLayer({ id: 'min', type: 'line', source: 'trail', minzoom: 15, paint: { 'line-width': 4 } })
    map.addLayer({ id: 'max', type: 'line', source: 'trail', maxzoom: 13, paint: { 'line-width': 4 } })
    expect(readDrawnFeatures(map, { zoom: 12, layerIds: ['min'] })).toHaveLength(0)
    expect(readDrawnFeatures(map, { zoom: 14, layerIds: ['min'] })).toHaveLength(0)
    expect(readDrawnFeatures(map, { zoom: 15, layerIds: ['min'] })).toHaveLength(1)
    expect(readDrawnFeatures(map, { zoom: 12, layerIds: ['max'] })).toHaveLength(1)
    expect(readDrawnFeatures(map, { zoom: 13, layerIds: ['max'] })).toHaveLength(0)
  })

  it.each([
    ['trail-line', 'line-color'],
    ['trail-dots', 'circle-color'],
  ])('reports a transparent %s %s as not drawn, per feature', (layerId, property) => {
    const map = mapWithTrails()
    map.setPaintProperty(layerId, property, 'rgba(0,0,0,0)')
    expect(drawnDevices(map, layerId)).toEqual([])
    map.setPaintProperty(layerId, property, ['case', ['==', ['get', 'deviceId'], 'A'], 'rgba(56,189,248,0)', '#38BDF8'])
    expect(drawnDevices(map, layerId)).toEqual(['B'])
  })

  it('counts a dot only when its fill is visible, not its dark stroke alone', () => {
    const map = mapWithTrails()
    map.setPaintProperty('trail-dots', 'circle-stroke-width', 2)
    map.setPaintProperty('trail-dots', 'circle-opacity', 0)
    expect(drawnDevices(map, 'trail-dots')).toEqual([])
  })

  it.each([
    ['trail-line', 'line-dasharray', [0, 2]],
    ['trail-line', 'line-gap-width', 3],
    ['trail-line', 'line-blur', 4],
    ['trail-line', 'line-offset', 2],
    ['trail-line', 'line-translate', [5, 5]],
    ['trail-line', 'line-pattern', 'dash'],
    ['trail-line', 'line-gradient', ['interpolate', ['linear'], ['line-progress'], 0, 'red', 1, 'blue']],
    ['trail-dots', 'circle-blur', 1],
    ['trail-dots', 'circle-translate', [5, 5]],
    ['trail-dots', 'circle-made-up', 1],
  ])('throws on %s %s, which it does not judge', (layerId, property, value) => {
    const map = mapWithTrails()
    map.setPaintProperty(layerId, property, value)
    expect(() => readDrawnFeatures(map, { zoom: 14, layerIds: [layerId] })).toThrow(new RegExp(property, 'u'))
  })

  it('accepts a judged-elsewhere property set to its default', () => {
    const map = mapWithTrails()
    map.setPaintProperty('trail-line', 'line-translate', [0, 0])
    map.setPaintProperty('trail-dots', 'circle-blur', 0)
    expect(drawnDevices(map, 'trail-line')).toEqual(['A', 'B'])
    expect(drawnDevices(map, 'trail-dots')).toEqual(['A', 'B'])
  })

  it('throws on a layout property it does not understand', () => {
    const map = mapWithTrails()
    map.setLayoutProperty('trail-line', 'line-made-up', 1)
    expect(() => readDrawnFeatures(map, { zoom: 14, layerIds: ['trail-line'] })).toThrow(/line-made-up/u)
  })

  it('fails the operator-zoom read when the trail disappears at any operator zoom', () => {
    expect(OPERATOR_ZOOMS).toEqual([10, 14, 18])
    const map = mapWithTrails()
    expect(readDrawnFeaturesAtEveryOperatorZoom(map, { layerIds: ['trail-line'] })).toHaveLength(2)
    map.setPaintProperty('trail-line', 'line-opacity', ['step', ['zoom'], 0, 12, 1])
    expect(() => readDrawnFeaturesAtEveryOperatorZoom(map, { layerIds: ['trail-line'] })).toThrow(/zoom 10/u)
    map.setPaintProperty('trail-line', 'line-opacity', 0.92)
    map.setLayerZoomRange('trail-line', 0, 16)
    expect(() => readDrawnFeaturesAtEveryOperatorZoom(map, { layerIds: ['trail-line'] })).toThrow(/zoom 18/u)
  })
})
