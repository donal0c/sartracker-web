import { describe, expect, it } from 'vitest'

import {
  createDrawingFeatureCollection,
  createDrawingPreviewFeatureCollection,
} from '../../src/features/drawings/drawing-geojson'
import type { Drawing } from '../../src/infrastructure/mission-store/tauri-mission-store'

describe('drawing geojson', () => {
  it('creates geometry and label features for line drawings', () => {
    const collection = createDrawingFeatureCollection(
      [
        createDrawing({
          id: 'drawing-line',
          type: 'line',
          geometry_json: JSON.stringify({
            type: 'LineString',
            coordinates: [
              [-9.744, 51.999],
              [-9.734, 52.009],
            ],
          }),
          label: '1.57 km',
          metadata_json: JSON.stringify({ kind: 'line' }),
        }),
      ],
      'drawing-line',
    )

    expect(collection.features).toHaveLength(2)
    expect(collection.features[0]?.properties?.selected).toBe(true)
    expect(collection.features[1]?.geometry.type).toBe('Point')
    expect(collection.features[1]?.properties?.label).toBe('1.57 km')
  })

  it('creates one line feature per LPB ring plus labels', () => {
    const collection = createDrawingFeatureCollection(
      [
        createDrawing({
          id: 'drawing-range',
          type: 'range_ring',
          geometry_json: JSON.stringify({
            type: 'MultiPolygon',
            coordinates: [
              [[[-9.7, 52.0], [-9.69, 52.0], [-9.69, 52.01], [-9.7, 52.01], [-9.7, 52.0]]],
              [[[-9.71, 51.99], [-9.68, 51.99], [-9.68, 52.02], [-9.71, 52.02], [-9.71, 51.99]]],
            ],
          }),
          metadata_json: JSON.stringify({
            kind: 'range_ring',
            mode: 'lpb',
            center: [-9.7, 52.0],
            radiiM: [800, 2000],
            colors: ['#22C55E', '#EAB308'],
            labels: ['25%', '50%'],
            lpbCategory: 'hiker',
          }),
        }),
      ],
      null,
    )

    expect(collection.features.filter((feature) => feature.geometry.type === 'LineString')).toHaveLength(2)
    expect(collection.features.filter((feature) => feature.geometry.type === 'Polygon')).toHaveLength(0)
    expect(collection.features.filter((feature) => feature.geometry.type === 'Point')).toHaveLength(2)
  })

  it('creates text labels as label-only point features so the visible point layer does not draw a marker dot', () => {
    const collection = createDrawingFeatureCollection(
      [
        createDrawing({
          id: 'text-label',
          type: 'text_label',
          name: 'Landing Zone',
          color: '#FFCC00',
          geometry_json: JSON.stringify({
            type: 'Point',
            coordinates: [-9.7, 52.0],
          }),
          metadata_json: JSON.stringify({
            kind: 'text_label',
            text: 'Landing Zone',
            fontSize: 18,
            color: '#FFCC00',
            rotation: 25,
            point: [-9.7, 52.0],
          }),
          label: 'Landing Zone',
        }),
      ],
      null,
    )

    expect(collection.features).toHaveLength(1)
    expect(collection.features[0]?.geometry.type).toBe('Point')
    expect(collection.features[0]?.properties?.featureKind).toBe('label')
    expect(collection.features[0]?.properties).toMatchObject({
      drawingId: 'text-label',
      drawingType: 'text_label',
      label: 'Landing Zone',
      labelColor: '#FFCC00',
      fontSize: 18,
      rotation: 25,
    })
  })

  it('applies persisted search-area fill and label styling to map features', () => {
    const collection = createDrawingFeatureCollection(
      [
        createDrawing({
          id: 'search-area-styled',
          type: 'search_area',
          name: 'Sector Alpha',
          color: '#0EA5E9',
          label: 'Sector Alpha',
          metadata_json: JSON.stringify({
            kind: 'search_area',
            team: 'Team 1',
            status: 'Assigned',
            poaPercent: 35,
            terrain: 'Rocky ground',
            notes: null,
            areaSqM: 100,
            labelFontSize: 16,
            fillColor: '#0EA5E9',
          }),
        }),
      ],
      null,
    )

    const geometry = collection.features.find((feature) => feature.properties?.featureKind === 'geometry')
    const label = collection.features.find((feature) => feature.properties?.featureKind === 'label')

    expect(geometry?.properties).toMatchObject({
      drawingId: 'search-area-styled',
      strokeColor: '#0EA5E9',
      fillColor: '#0EA5E922',
    })
    expect(label?.properties).toMatchObject({
      drawingId: 'search-area-styled',
      label: 'Sector Alpha',
      labelColor: '#0EA5E9',
      fontSize: 16,
    })
  })

  it('uses a high-contrast default stroke and wider line for range rings', () => {
    const collection = createDrawingFeatureCollection(
      [
        createDrawing({
          id: 'range-default',
          type: 'range_ring',
          color: null,
          width: null,
          geometry_json: JSON.stringify({
            type: 'MultiPolygon',
            coordinates: [
              [[[-9.7, 52.0], [-9.69, 52.0], [-9.69, 52.01], [-9.7, 52.01], [-9.7, 52.0]]],
            ],
          }),
          metadata_json: JSON.stringify({
            kind: 'range_ring',
            mode: 'manual',
            center: [-9.7, 52.0],
            radiiM: [800],
            colors: [],
            labels: ['800 m'],
            lpbCategory: null,
          }),
        }),
      ],
      null,
    )

    const ring = collection.features.find((feature) => feature.geometry.type === 'LineString')
    // Muddy green is illegible on the topo basemap; the default must be a
    // higher-contrast colour and the stroke must be wide enough to carry over
    // contour clutter.
    expect(ring?.properties?.strokeColor).not.toBe('#22C55E')
    expect(ring?.properties?.width).toBeGreaterThanOrEqual(3)
  })

  it('uses an operationally legible default stroke width for search sectors', () => {
    const collection = createDrawingFeatureCollection(
      [
        createDrawing({
          id: 'sector-default',
          type: 'search_sector',
          color: null,
          width: null,
          geometry_json: JSON.stringify({
            type: 'Polygon',
            coordinates: [[[-9.7, 52.0], [-9.69, 52.0], [-9.69, 52.01], [-9.7, 52.0]]],
          }),
          metadata_json: JSON.stringify({
            kind: 'search_sector',
            center: [-9.7, 52.0],
            startBearing: 0,
            endBearing: 90,
            radiusM: 1000,
          }),
        }),
      ],
      null,
    )

    const geometry = collection.features.find((feature) => feature.properties?.featureKind === 'geometry')
    expect(geometry?.properties?.width).toBeGreaterThanOrEqual(3)
  })

  it('creates preview line and vertex features while sketching', () => {
    const collection = createDrawingPreviewFeatureCollection(
      {
        tool: 'line',
        points: [
          [-9.744, 51.999],
          [-9.734, 52.009],
        ],
      },
      'line',
    )

    expect(collection.features.some((feature) => feature.geometry.type === 'LineString')).toBe(true)
    expect(collection.features.filter((feature) => feature.geometry.type === 'Point')).toHaveLength(2)
  })
})

function createDrawing(overrides: Partial<Drawing>): Drawing {
  return {
    id: 'drawing-1',
    mission_id: 'mission-1',
    type: 'search_area',
    name: 'Drawing',
    description: null,
    color: null,
    width: null,
    distance_m: null,
    temporary_measure: null,
    label: null,
    display_order: 1,
    geometry_json: JSON.stringify({
      type: 'Polygon',
      coordinates: [[[-9.7, 52.0], [-9.69, 52.0], [-9.69, 52.01], [-9.7, 52.0]]],
    }),
    metadata_json: JSON.stringify({
      kind: 'search_area',
      team: null,
      status: 'Planned',
      poaPercent: null,
      terrain: null,
      notes: null,
      areaSqM: 100,
    }),
    created_at: '2026-04-09T00:00:00.000Z',
    updated_at: '2026-04-09T00:00:00.000Z',
    ...overrides,
  }
}
