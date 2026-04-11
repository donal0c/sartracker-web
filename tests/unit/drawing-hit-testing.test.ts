import { describe, expect, it } from 'vitest'

import type { Drawing } from '../../src/infrastructure/mission-store/tauri-mission-store'
import { findNearestDrawingId } from '../../src/features/drawings/drawing-hit-testing'

describe('drawing hit testing', () => {
  it('finds the nearest point-based drawing within the selection radius', () => {
    const map = {
      project: ({ lng, lat }: { lng: number; lat: number }) => ({ x: lng * 10, y: lat * 10 }),
    }

    const drawingId = findNearestDrawingId(
      map as never,
      { x: 100, y: 100 },
      [
        createPointDrawing('label-1', [10, 10]),
        createPointDrawing('label-2', [40, 40]),
      ],
    )

    expect(drawingId).toBe('label-1')
  })

  it('selects line drawings using projected segment distance when rendered feature picking misses', () => {
    const map = {
      project: ({ lng, lat }: { lng: number; lat: number }) => ({ x: lng * 10, y: lat * 10 }),
    }

    const drawingId = findNearestDrawingId(
      map as never,
      { x: 110, y: 110 },
      [
        createLineDrawing('line-1'),
        createPointDrawing('label-2', [30, 30]),
      ],
    )

    expect(drawingId).toBe('line-1')
  })

  it('ignores distant drawings outside the selection radius', () => {
    const map = {
      project: ({ lng, lat }: { lng: number; lat: number }) => ({ x: lng * 10, y: lat * 10 }),
    }

    const drawingId = findNearestDrawingId(
      map as never,
      { x: 300, y: 300 },
      [createLineDrawing('line-1'), createPointDrawing('label-2', [10, 10])],
    )

    expect(drawingId).toBeNull()
  })

  it('selects polygon drawings when clicking inside the polygon', () => {
    const map = {
      project: ({ lng, lat }: { lng: number; lat: number }) => ({ x: lng * 10, y: lat * 10 }),
    }

    const drawingId = findNearestDrawingId(
      map as never,
      { x: 50, y: 50 },
      [createPolygonDrawing('area-1')],
    )

    expect(drawingId).toBe('area-1')
  })

  it('ignores polygon drawings when clicking far outside', () => {
    const map = {
      project: ({ lng, lat }: { lng: number; lat: number }) => ({ x: lng * 10, y: lat * 10 }),
    }

    const drawingId = findNearestDrawingId(
      map as never,
      { x: 300, y: 300 },
      [createPolygonDrawing('area-1')],
    )

    expect(drawingId).toBeNull()
  })

  it('gracefully handles drawings with malformed geometry_json', () => {
    const map = {
      project: ({ lng, lat }: { lng: number; lat: number }) => ({ x: lng * 10, y: lat * 10 }),
    }

    const drawingId = findNearestDrawingId(
      map as never,
      { x: 100, y: 100 },
      [
        createPointDrawing('label-1', [10, 10]),
        {
          ...createPointDrawing('bad-json', [10, 10]),
          geometry_json: '{invalid json',
        },
      ],
    )

    expect(drawingId).toBe('label-1')
  })

  it('returns null for drawings with unsupported geometry types', () => {
    const map = {
      project: ({ lng, lat }: { lng: number; lat: number }) => ({ x: lng * 10, y: lat * 10 }),
    }

    const drawingId = findNearestDrawingId(
      map as never,
      { x: 50, y: 50 },
      [
        {
          ...createPointDrawing('multi', [5, 5]),
          geometry_json: JSON.stringify({ type: 'MultiPolygon', coordinates: [] }),
        },
      ],
    )

    expect(drawingId).toBeNull()
  })
})

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

function createLineDrawing(id: string): Drawing {
  return {
    id,
    mission_id: 'mission-1',
    type: 'line',
    name: id,
    description: null,
    color: '#ffffff',
    width: 2,
    distance_m: 10,
    temporary_measure: false,
    label: null,
    display_order: 1,
    geometry_json: JSON.stringify({
      type: 'LineString',
      coordinates: [
        [10, 10],
        [12, 12],
      ],
    }),
    metadata_json: null,
    created_at: '2026-04-10T10:00:00.000Z',
    updated_at: '2026-04-10T10:00:00.000Z',
  }
}
