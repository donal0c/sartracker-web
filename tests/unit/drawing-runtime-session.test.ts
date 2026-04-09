import { describe, expect, it } from 'vitest'

import type { Drawing } from '../../src/infrastructure/mission-store/tauri-mission-store'
import {
  applyDrawingDeleteSuccess,
  applyDrawingMissionRefreshFailure,
  applyDrawingMissionRefreshSuccess,
  applyDrawingSaveSuccess,
  beginDrawingMissionRefresh,
  beginDrawingSave,
  createDrawingRuntimeMutableState,
  getNextDrawingDisplayOrder,
  snapshotDrawingRuntimeState,
} from '../../src/features/drawings/drawing-runtime-session'

describe('drawing runtime session', () => {
  it('enters loading state when refreshing a mission', () => {
    const state = createDrawingRuntimeMutableState()

    beginDrawingMissionRefresh(state, 'mission-1')

    expect(snapshotDrawingRuntimeState(state)).toEqual(
      expect.objectContaining({
        activeMissionId: 'mission-1',
        loading: true,
        dialog: null,
        sketch: null,
        selectedDrawingId: null,
      }),
    )
  })

  it('applies loaded drawings to the active mission', () => {
    const state = createDrawingRuntimeMutableState()
    const drawing = createDrawing()

    beginDrawingMissionRefresh(state, 'mission-1')
    applyDrawingMissionRefreshSuccess(state, [drawing])

    expect(snapshotDrawingRuntimeState(state)).toEqual(
      expect.objectContaining({
        drawings: [drawing],
        loading: false,
        error: null,
      }),
    )
  })

  it('records refresh failures and clears stale drawings', () => {
    const state = createDrawingRuntimeMutableState({
      drawings: [createDrawing()],
    })

    beginDrawingMissionRefresh(state, 'mission-1')
    applyDrawingMissionRefreshFailure(state, 'Load failed')

    expect(snapshotDrawingRuntimeState(state)).toEqual(
      expect.objectContaining({
        drawings: [],
        loading: false,
        error: 'Load failed',
      }),
    )
  })

  it('uses the highest display order when saving edits', () => {
    const state = createDrawingRuntimeMutableState({
      drawings: [
        createDrawing({ id: 'drawing-1', display_order: 2 }),
        createDrawing({ id: 'drawing-2', display_order: 6 }),
      ],
    })

    expect(getNextDrawingDisplayOrder(state, null)).toBe(7)
    expect(getNextDrawingDisplayOrder(state, 'drawing-2')).toBe(6)
  })

  it('resets save state and selects the saved drawing', () => {
    const state = createDrawingRuntimeMutableState({
      activeMissionId: 'mission-1',
    })
    const drawing = createDrawing()

    beginDrawingSave(state)
    applyDrawingSaveSuccess(state, drawing)

    expect(snapshotDrawingRuntimeState(state)).toEqual(
      expect.objectContaining({
        drawings: [drawing],
        saving: false,
        activeTool: 'select',
        dialog: null,
        selectedDrawingId: drawing.id,
      }),
    )
  })

  it('removes the selected drawing after delete', () => {
    const drawing = createDrawing()
    const state = createDrawingRuntimeMutableState({
      drawings: [drawing],
      selectedDrawingId: drawing.id,
    })

    applyDrawingDeleteSuccess(state)

    expect(snapshotDrawingRuntimeState(state)).toEqual(
      expect.objectContaining({
        drawings: [],
        selectedDrawingId: null,
        activeTool: 'select',
        dialog: null,
      }),
    )
  })
})

function createDrawing(overrides: Partial<Drawing> = {}): Drawing {
  return {
    id: 'drawing-1',
    mission_id: 'mission-1',
    type: 'line',
    name: 'Track line',
    description: null,
    color: null,
    width: null,
    distance_m: 1000,
    temporary_measure: null,
    label: '1.0 km',
    display_order: 1,
    geometry_json: '{"type":"LineString","coordinates":[[-9.7,52],[-9.69,52.01]]}',
    metadata_json: '{"kind":"line"}',
    created_at: '2026-04-09T00:00:00.000Z',
    updated_at: '2026-04-09T00:00:00.000Z',
    ...overrides,
  }
}
