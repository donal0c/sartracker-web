import { describe, expect, it, vi } from 'vitest'

import type { Drawing } from '../../src/infrastructure/mission-store/tauri-mission-store'
import { startDrawingRuntime } from '../../src/features/drawings/start-drawing-runtime'

describe('startDrawingRuntime', () => {
  it('loads drawings for the active mission', async () => {
    const drawing = createDrawing()
    const applyRuntime = vi.fn()
    const runtime = await startDrawingRuntime({
      drawingStore: {
        listDrawings: vi.fn().mockResolvedValue([drawing]),
        upsertDrawing: vi.fn(),
        deleteDrawing: vi.fn(),
      },
      applyRuntime,
    })

    await runtime.refreshMission('mission-1')

    expect(applyRuntime).toHaveBeenLastCalledWith({
      activeMissionId: 'mission-1',
      drawings: [drawing],
      loading: false,
      saving: false,
      error: null,
      activeTool: 'select',
      sketch: null,
      dialog: null,
      selectedDrawingId: null,
    })
  })

  it('clears drawings when the mission becomes null', async () => {
    const applyRuntime = vi.fn()
    const runtime = await startDrawingRuntime({
      drawingStore: {
        listDrawings: vi.fn().mockResolvedValue([]),
        upsertDrawing: vi.fn(),
        deleteDrawing: vi.fn(),
      },
      applyRuntime,
    })

    await runtime.refreshMission(null)

    expect(applyRuntime).toHaveBeenLastCalledWith({
      activeMissionId: null,
      drawings: [],
      loading: false,
      saving: false,
      error: null,
      activeTool: 'select',
      sketch: null,
      dialog: null,
      selectedDrawingId: null,
    })
  })

  it('creates a line draft from sketch points and persists it', async () => {
    const upsertDrawing = vi.fn().mockResolvedValue({
      ...createDrawing(),
      type: 'line',
      name: 'Track line',
    })
    const runtime = await startDrawingRuntime({
      drawingStore: {
        listDrawings: vi.fn().mockResolvedValue([]),
        upsertDrawing,
        deleteDrawing: vi.fn(),
      },
      applyRuntime: vi.fn(),
    })

    await runtime.refreshMission('mission-1')
    runtime.setActiveTool('line')
    runtime.appendSketchPoint(-9.744, 51.999)
    runtime.appendSketchPoint(-9.734, 52.009)
    runtime.completeSketch()
    runtime.updateDraft({
      id: null,
      type: 'line',
      name: 'Track line',
      description: '',
      points: [
        [-9.744, 51.999],
        [-9.734, 52.009],
      ],
    })
    await runtime.saveDialog()

    expect(upsertDrawing).toHaveBeenCalledWith(
      expect.objectContaining({
        mission_id: 'mission-1',
        type: 'line',
        name: 'Track line',
      }),
    )
  })

  it('opens range ring dialogs from a clicked center point', async () => {
    const applyRuntime = vi.fn()
    const runtime = await startDrawingRuntime({
      drawingStore: {
        listDrawings: vi.fn().mockResolvedValue([]),
        upsertDrawing: vi.fn(),
        deleteDrawing: vi.fn(),
      },
      applyRuntime,
    })

    await runtime.refreshMission('mission-1')
    runtime.beginDialogAtPoint('range_ring', -9.744, 51.999)

    expect(applyRuntime).toHaveBeenLastCalledWith(
      expect.objectContaining({
        dialog: expect.objectContaining({
          draft: expect.objectContaining({
            type: 'range_ring',
            center: [-9.744, 51.999],
          }),
        }),
      }),
    )
  })

  it('surfaces delete failures and clears the saving state', async () => {
    const applyRuntime = vi.fn()
    const deleteDrawing = vi.fn().mockRejectedValue(new Error('Delete failed.'))
    const runtime = await startDrawingRuntime({
      drawingStore: {
        listDrawings: vi.fn().mockResolvedValue([createDrawing()]),
        upsertDrawing: vi.fn(),
        deleteDrawing,
      },
      applyRuntime,
    })

    await runtime.refreshMission('mission-1')
    runtime.selectDrawing('drawing-1')

    await expect(runtime.deleteSelectedDrawing()).rejects.toThrow('Delete failed.')

    expect(deleteDrawing).toHaveBeenCalledWith('drawing-1')
    expect(applyRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        selectedDrawingId: 'drawing-1',
        saving: true,
        error: null,
      }),
    )
    expect(applyRuntime).toHaveBeenLastCalledWith(
      expect.objectContaining({
        selectedDrawingId: 'drawing-1',
        saving: false,
        error: 'Delete failed.',
      }),
    )
  })
})

function createDrawing(): Drawing {
  return {
    id: 'drawing-1',
    mission_id: 'mission-1',
    type: 'search_area',
    name: 'Sector Alpha',
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
