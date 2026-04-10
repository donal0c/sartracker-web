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

  it('ignores non-point drawings and distant point drawings', () => {
    const map = {
      project: ({ lng, lat }: { lng: number; lat: number }) => ({ x: lng * 10, y: lat * 10 }),
    }

    const drawingId = findNearestDrawingId(
      map as never,
      { x: 100, y: 100 },
      [
        createLineDrawing('line-1'),
        createPointDrawing('label-2', [30, 30]),
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
