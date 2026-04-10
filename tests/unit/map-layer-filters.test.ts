import { describe, expect, it } from 'vitest'

import {
  buildDrawingVisibilitySummary,
  buildMarkerLayerFilter,
  buildTrackingLayerFilter,
} from '../../src/features/layers/map-layer-filters'
import type { Drawing } from '../../src/infrastructure/mission-store/tauri-mission-store'

describe('map layer filter helpers', () => {
  it('returns no tracking filter when all devices are visible', () => {
    expect(buildTrackingLayerFilter([])).toBeNull()
  })

  it('builds a tracking exclusion filter when some devices are hidden', () => {
    expect(buildTrackingLayerFilter(['alpha', 'bravo'])).toEqual([
      '!',
      ['in', ['get', 'deviceId'], ['literal', ['alpha', 'bravo']]],
    ])
  })

  it('builds a marker type filter and a hidden marker filter', () => {
    expect(buildMarkerLayerFilter('clue', true, [])).toEqual(['==', ['get', 'markerType'], 'clue'])
    expect(buildMarkerLayerFilter('clue', false, [])).toEqual(['==', ['get', 'markerId'], '__hidden__'])
    expect(buildMarkerLayerFilter('clue', true, ['marker-1'])).toEqual([
      'all',
      ['==', ['get', 'markerType'], 'clue'],
      ['!', ['in', ['get', 'markerId'], ['literal', ['marker-1']]]],
    ])
  })

  it('summarizes visible drawings after type and item hiding', () => {
    const drawings = [createDrawing('drawing-1', 'line'), createDrawing('drawing-2', 'search_area')]

    expect(
      buildDrawingVisibilitySummary(
        drawings,
        {
          line: true,
          search_area: false,
          range_ring: true,
          bearing_line: true,
          search_sector: true,
          text_label: true,
        },
        ['drawing-1'],
      ),
    ).toEqual({
      visibleCount: 0,
      totalCount: 2,
    })
  })
})

function createDrawing(id: string, type: Drawing['type']): Drawing {
  return {
    id,
    mission_id: 'mission-1',
    type,
    name: id,
    description: null,
    color: null,
    width: null,
    distance_m: null,
    temporary_measure: null,
    label: null,
    display_order: 1,
    geometry_json: '{}',
    metadata_json: null,
    created_at: '2026-04-09T00:00:00.000Z',
    updated_at: '2026-04-09T00:00:00.000Z',
  }
}
