import { describe, expect, it } from 'vitest'

import { resolveClickedMapTarget } from '../../src/features/map/map-click-target-resolver'
import type { Drawing, GpxTrackImport, Marker } from '../../src/infrastructure/mission-store/tauri-mission-store'

const projectingMap = {
  project: (input: { lng: number; lat: number } | [number, number]) => {
    const [lng, lat] = Array.isArray(input) ? input : [input.lng, input.lat]
    return { x: lng * 10, y: lat * 10 }
  },
  getLayer: () => undefined,
  queryRenderedFeatures: () => [],
} as never

describe('resolveClickedMapTarget — priority and outcomes', () => {
  it('returns "empty" when no marker, drawing, or GPX track is near the click', () => {
    const result = resolveClickedMapTarget({
      map: projectingMap,
      point: { x: 9999, y: 9999 },
      markers: [createMarker('marker-1', -9.7, 52)],
      drawings: [createPointDrawing('label-1', [10, 10])],
      gpxImports: [createMultiLineImport('track-1', [[[10, 10], [12, 12]]])],
    })

    expect(result).toEqual({ kind: 'empty', id: null, gpxNearbyImportId: null })
  })

  it('selects a marker when a marker is alone near the click', () => {
    const result = resolveClickedMapTarget({
      map: projectingMap,
      point: { x: 100, y: 120 },
      markers: [createMarker('marker-1', 10, 12)],
      drawings: [],
      gpxImports: [],
    })

    expect(result).toEqual({ kind: 'marker', id: 'marker-1', gpxNearbyImportId: null })
  })

  it('selects a drawing when a drawing is alone near the click', () => {
    const result = resolveClickedMapTarget({
      map: projectingMap,
      point: { x: 100, y: 100 },
      markers: [],
      drawings: [createPointDrawing('drawing-1', [10, 10])],
      gpxImports: [],
    })

    expect(result).toEqual({ kind: 'drawing', id: 'drawing-1', gpxNearbyImportId: null })
  })

  it('prefers the marker when a marker sits inside a polygon drawing (headline bug fix)', () => {
    const result = resolveClickedMapTarget({
      map: projectingMap,
      point: { x: 50, y: 50 },
      markers: [createMarker('marker-inside', 5, 5)],
      drawings: [createPolygonDrawing('search-area-1')],
      gpxImports: [],
    })

    expect(result.kind).toBe('marker')
    expect(result.id).toBe('marker-inside')
  })

  it('prefers the marker when a marker sits next to a line drawing', () => {
    const result = resolveClickedMapTarget({
      map: projectingMap,
      point: { x: 110, y: 110 },
      markers: [createMarker('marker-near-line', 11, 11)],
      drawings: [createLineDrawing('line-1', [[10, 10], [12, 12]])],
      gpxImports: [],
    })

    expect(result.kind).toBe('marker')
    expect(result.id).toBe('marker-near-line')
  })

  it('selects the drawing when it is the only feature within the marker pick radius', () => {
    const result = resolveClickedMapTarget({
      map: projectingMap,
      point: { x: 110, y: 110 },
      markers: [createMarker('marker-far', 30, 30)],
      drawings: [createLineDrawing('line-1', [[10, 10], [12, 12]])],
      gpxImports: [],
    })

    expect(result.kind).toBe('drawing')
    expect(result.id).toBe('line-1')
  })

  it('does not let GPX outrank a marker', () => {
    const result = resolveClickedMapTarget({
      map: projectingMap,
      point: { x: 110, y: 110 },
      markers: [createMarker('marker-near', 11, 11)],
      drawings: [],
      gpxImports: [createMultiLineImport('track-1', [[[10, 11], [12, 11]]])],
    })

    expect(result.kind).toBe('marker')
    expect(result.id).toBe('marker-near')
  })

  it('does not let GPX outrank a drawing', () => {
    const result = resolveClickedMapTarget({
      map: projectingMap,
      point: { x: 110, y: 110 },
      markers: [],
      drawings: [createLineDrawing('drawing-line', [[10, 11], [12, 11]])],
      gpxImports: [createMultiLineImport('track-1', [[[10, 11], [12, 11]]])],
    })

    expect(result.kind).toBe('drawing')
    expect(result.id).toBe('drawing-line')
  })

  it('reports "empty" with a soft GPX signal when only a GPX track is near the click', () => {
    const result = resolveClickedMapTarget({
      map: projectingMap,
      point: { x: 110, y: 110 },
      markers: [],
      drawings: [],
      gpxImports: [createMultiLineImport('track-1', [[[10, 11], [12, 11]]])],
    })

    expect(result).toEqual({
      kind: 'empty',
      id: null,
      gpxNearbyImportId: 'track-1',
    })
  })

  it('still surfaces the GPX soft signal when a marker is selected nearby', () => {
    const result = resolveClickedMapTarget({
      map: projectingMap,
      point: { x: 110, y: 110 },
      markers: [createMarker('marker-near', 11, 11)],
      drawings: [],
      gpxImports: [createMultiLineImport('track-1', [[[10, 11], [12, 11]]])],
    })

    expect(result.kind).toBe('marker')
    expect(result.gpxNearbyImportId).toBe('track-1')
  })

  it('uses the rendered feature id from queryRenderedFeatures when one is provided for drawings', () => {
    const map = {
      project: (input: { lng: number; lat: number } | [number, number]) => {
        const [lng, lat] = Array.isArray(input) ? input : [input.lng, input.lat]
        return { x: lng * 10, y: lat * 10 }
      },
      getLayer: (id: string) => (id === 'mission-drawings-fill' ? {} : undefined),
      queryRenderedFeatures: () => [
        { properties: { drawingId: 'rendered-drawing' } } as never,
      ],
    } as never

    const result = resolveClickedMapTarget({
      map,
      point: { x: 50, y: 50 },
      markers: [],
      drawings: [createPolygonDrawing('search-area-1')],
      gpxImports: [],
    })

    expect(result.kind).toBe('drawing')
    expect(result.id).toBe('rendered-drawing')
  })

  it('uses the rendered feature id from queryRenderedFeatures when one is provided for markers', () => {
    const map = {
      project: (input: { lng: number; lat: number } | [number, number]) => {
        const [lng, lat] = Array.isArray(input) ? input : [input.lng, input.lat]
        return { x: lng * 10, y: lat * 10 }
      },
      getLayer: (id: string) => (id === 'mission-markers-hitbox' ? {} : undefined),
      queryRenderedFeatures: () => [
        { properties: { markerId: 'rendered-marker' } } as never,
      ],
    } as never

    const result = resolveClickedMapTarget({
      map,
      point: { x: 100, y: 120 },
      markers: [createMarker('fallback-marker', 10, 12)],
      drawings: [],
      gpxImports: [],
    })

    expect(result.kind).toBe('marker')
    expect(result.id).toBe('rendered-marker')
  })

  it('tolerates malformed drawing geometry without throwing', () => {
    const result = resolveClickedMapTarget({
      map: projectingMap,
      point: { x: 100, y: 100 },
      markers: [],
      drawings: [
        { ...createPointDrawing('broken', [10, 10]), geometry_json: '{not-json' },
      ],
      gpxImports: [],
    })

    expect(result).toEqual({ kind: 'empty', id: null, gpxNearbyImportId: null })
  })

  it('tolerates malformed GPX geometry without throwing', () => {
    const result = resolveClickedMapTarget({
      map: projectingMap,
      point: { x: 100, y: 100 },
      markers: [],
      drawings: [],
      gpxImports: [
        { ...createMultiLineImport('broken', [[[10, 10], [12, 12]]]), geometry_json: '{not-json' },
      ],
    })

    expect(result).toEqual({ kind: 'empty', id: null, gpxNearbyImportId: null })
  })
})

function createMarker(id: string, lon: number, lat: number): Marker {
  return {
    id,
    mission_id: 'mission-1',
    type: 'clue',
    name: id,
    description: null,
    lat,
    lon,
    irish_grid_e: 0,
    irish_grid_n: 0,
    subject_category: null,
    clue_type: null,
    confidence: null,
    found_by: null,
    hazard_type: null,
    severity: null,
    condition: null,
    treatment: null,
    evacuation_priority: null,
    updated_by: null,
    coordinator_ids: null,
    attachment_path: null,
    display_order: 1,
    created_at: '2026-04-10T10:00:00.000Z',
    updated_at: '2026-04-10T10:00:00.000Z',
  }
}

function createPointDrawing(id: string, coordinates: [number, number]): Drawing {
  return {
    id,
    mission_id: 'mission-1',
    type: 'text_label',
    name: id,
    description: null,
    color: '#ffffff',
    width: null,
    distance_m: null,
    temporary_measure: false,
    label: id,
    display_order: 1,
    geometry_json: JSON.stringify({ type: 'Point', coordinates }),
    metadata_json: null,
    created_at: '2026-04-10T10:00:00.000Z',
    updated_at: '2026-04-10T10:00:00.000Z',
  }
}

function createLineDrawing(id: string, coordinates: ReadonlyArray<[number, number]>): Drawing {
  return {
    id,
    mission_id: 'mission-1',
    type: 'line',
    name: id,
    description: null,
    color: '#ffffff',
    width: 2,
    distance_m: null,
    temporary_measure: false,
    label: null,
    display_order: 1,
    geometry_json: JSON.stringify({ type: 'LineString', coordinates }),
    metadata_json: null,
    created_at: '2026-04-10T10:00:00.000Z',
    updated_at: '2026-04-10T10:00:00.000Z',
  }
}

function createPolygonDrawing(id: string): Drawing {
  return {
    id,
    mission_id: 'mission-1',
    type: 'search_area',
    name: id,
    description: null,
    color: '#ffffff',
    width: null,
    distance_m: null,
    temporary_measure: false,
    label: null,
    display_order: 1,
    geometry_json: JSON.stringify({
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
          [0, 0],
        ],
      ],
    }),
    metadata_json: null,
    created_at: '2026-04-10T10:00:00.000Z',
    updated_at: '2026-04-10T10:00:00.000Z',
  }
}

function createMultiLineImport(
  id: string,
  lineStrings: ReadonlyArray<ReadonlyArray<readonly [number, number]>>,
): GpxTrackImport {
  return {
    id,
    mission_id: 'mission-1',
    source_path: `/tmp/${id}.gpx`,
    file_name: `${id}.gpx`,
    display_name: id,
    geometry_json: JSON.stringify({
      type: 'MultiLineString',
      coordinates: lineStrings.map((line) => line.map(([lng, lat]) => [lng, lat])),
    }),
    metadata_json: null,
    imported_at: '2026-04-10T10:00:00.000Z',
    updated_at: '2026-04-10T10:00:00.000Z',
  }
}
