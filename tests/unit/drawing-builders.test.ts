import { describe, expect, it } from 'vitest'

import {
  buildDrawingInput,
  createBearingLineDraft,
  createLineDraft,
  createRangeRingDraft,
  createSearchAreaDraft,
  createSearchSectorDraft,
  createTextLabelDraft,
  parsePersistedDrawing,
} from '../../src/features/drawings/drawing-builders'

describe('drawing builders', () => {
  it('builds persisted line input with computed distance label', () => {
    const input = buildDrawingInput({
      missionId: 'mission-1',
      displayOrder: 1,
      draft: {
        ...createLineDraft([
          [-9.744, 51.999],
          [-9.734, 52.009],
        ]),
        name: 'Track line',
      },
    })

    expect(input.type).toBe('line')
    expect(input.distance_m).toBeGreaterThan(1000)
    expect(input.label).toContain('km')
  })

  it('builds search area input with metadata and polygon geometry', () => {
    const input = buildDrawingInput({
      missionId: 'mission-1',
      displayOrder: 2,
      draft: {
        ...createSearchAreaDraft([
          [-9.744, 51.999],
          [-9.734, 51.999],
          [-9.734, 52.009],
        ]),
        name: 'Area Alpha',
        team: 'Team 1',
        poaPercent: '45',
      },
    })

    expect(input.type).toBe('search_area')
    expect(input.metadata_json).toContain('"team":"Team 1"')
    expect(input.geometry_json).toContain('"Polygon"')
  })

  it('builds LPB range rings using the locked category data', () => {
    const input = buildDrawingInput({
      missionId: 'mission-1',
      displayOrder: 3,
      draft: {
        ...createRangeRingDraft([-9.744, 51.999]),
        name: 'LPB Hiker',
        mode: 'lpb',
        lpbCategory: 'hiker',
      },
    })

    expect(input.type).toBe('range_ring')
    expect(input.geometry_json).toContain('"MultiPolygon"')
    expect(input.metadata_json).toContain('"lpbCategory":"hiker"')
    expect(input.metadata_json).toContain('8000')
  })

  it('builds bearing lines from magnetic bearings by converting to true', () => {
    const input = buildDrawingInput({
      missionId: 'mission-1',
      displayOrder: 4,
      draft: {
        ...createBearingLineDraft([-9.744, 51.999]),
        name: 'Bearing 90M',
        inputBearingType: 'magnetic',
        inputBearing: '90',
        distanceM: '1000',
      },
    })

    expect(input.type).toBe('bearing_line')
    expect(input.label).toContain('94.5°T')
  })

  it('builds search sectors with polygon geometry', () => {
    const input = buildDrawingInput({
      missionId: 'mission-1',
      displayOrder: 5,
      draft: {
        ...createSearchSectorDraft([-9.744, 51.999]),
        name: 'Sector North',
      },
    })

    expect(input.type).toBe('search_sector')
    expect(input.geometry_json).toContain('"Polygon"')
  })

  it('builds text labels with persisted style metadata', () => {
    const input = buildDrawingInput({
      missionId: 'mission-1',
      displayOrder: 6,
      draft: {
        ...createTextLabelDraft([-9.744, 51.999]),
        text: 'Landing Zone',
        fontSize: '18',
        color: '#FFCC00',
        rotation: '15',
      },
    })

    expect(input.type).toBe('text_label')
    expect(input.name).toBe('Landing Zone')
    expect(input.label).toBe('Landing Zone')
    expect(input.color).toBe('#FFCC00')
    expect(input.geometry_json).toContain('"Point"')
    expect(input.metadata_json).toContain('"fontSize":18')
    expect(input.metadata_json).toContain('"rotation":15')
  })

  it('parses persisted drawing geometry and metadata', () => {
    const parsed = parsePersistedDrawing({
      id: 'drawing-1',
      mission_id: 'mission-1',
      type: 'line',
      name: 'Track line',
      description: null,
      color: null,
      width: null,
      distance_m: 1000,
      temporary_measure: null,
      label: '1.00 km',
      display_order: 1,
      geometry_json: '{"type":"LineString","coordinates":[[-9.7,52],[-9.69,52.01]]}',
      metadata_json: '{"kind":"line"}',
      created_at: '2026-04-09T00:00:00.000Z',
      updated_at: '2026-04-09T00:00:00.000Z',
    })

    expect(parsed.parsedGeometry.type).toBe('LineString')
    expect(parsed.metadata).toEqual({ kind: 'line' })
  })
})
