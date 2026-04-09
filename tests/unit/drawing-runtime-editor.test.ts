import { describe, expect, it } from 'vitest'

import type { Drawing } from '../../src/infrastructure/mission-store/tauri-mission-store'
import {
  appendDrawingSketchPoint,
  beginDrawingDialogAtPoint,
  beginDrawingEdit,
  cancelActiveDrawingTool,
  completeDrawingSketch,
  createDrawingRuntimeMutableState,
  setActiveDrawingTool,
  snapshotDrawingRuntimeState,
} from '../../src/features/drawings/drawing-runtime-editor'

describe('drawing runtime editor', () => {
  it('starts a line sketch and accumulates points', () => {
    const state = createDrawingRuntimeMutableState()

    setActiveDrawingTool(state, 'line')
    appendDrawingSketchPoint(state, -9.744, 51.999)
    appendDrawingSketchPoint(state, -9.734, 52.009)

    expect(snapshotDrawingRuntimeState(state).sketch).toEqual({
      tool: 'line',
      points: [
        [-9.744, 51.999],
        [-9.734, 52.009],
      ],
    })
  })

  it('creates a dialog from a completed search area sketch', () => {
    const state = createDrawingRuntimeMutableState()

    setActiveDrawingTool(state, 'search_area')
    appendDrawingSketchPoint(state, -9.744, 51.999)
    appendDrawingSketchPoint(state, -9.734, 51.999)
    appendDrawingSketchPoint(state, -9.734, 52.009)
    completeDrawingSketch(state)

    expect(snapshotDrawingRuntimeState(state).dialog).toEqual(
      expect.objectContaining({
        mode: 'create',
        draft: expect.objectContaining({
          type: 'search_area',
        }),
      }),
    )
  })

  it('opens point-based dialogs at the clicked coordinate', () => {
    const state = createDrawingRuntimeMutableState()

    beginDrawingDialogAtPoint(state, 'bearing_line', -9.744, 51.999)

    expect(snapshotDrawingRuntimeState(state).dialog).toEqual(
      expect.objectContaining({
        draft: expect.objectContaining({
          type: 'bearing_line',
          origin: [-9.744, 51.999],
        }),
      }),
    )
  })

  it('loads edit mode from an existing drawing', () => {
    const state = createDrawingRuntimeMutableState({
      drawings: [createDrawing()],
    })

    beginDrawingEdit(state, 'drawing-1')

    expect(snapshotDrawingRuntimeState(state)).toEqual(
      expect.objectContaining({
        selectedDrawingId: 'drawing-1',
        dialog: expect.objectContaining({
          mode: 'edit',
          draft: expect.objectContaining({
            id: 'drawing-1',
            type: 'line',
          }),
        }),
      }),
    )
  })

  it('returns to select mode when cancelling the active tool', () => {
    const state = createDrawingRuntimeMutableState()

    setActiveDrawingTool(state, 'range_ring')
    beginDrawingDialogAtPoint(state, 'range_ring', -9.744, 51.999)
    cancelActiveDrawingTool(state)

    expect(snapshotDrawingRuntimeState(state)).toEqual(
      expect.objectContaining({
        activeTool: 'select',
        dialog: null,
        sketch: null,
      }),
    )
  })
})

function createDrawing(): Drawing {
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
  }
}
