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

  it('moves a text label and persists the new anchor via the upsert path', async () => {
    const existingLabel: Drawing = {
      ...createDrawing(),
      id: 'label-1',
      type: 'text_label',
      name: 'Command Post',
      label: 'Command Post',
      color: '#FFCC00',
      display_order: 4,
      geometry_json: JSON.stringify({ type: 'Point', coordinates: [-9.7, 52.0] }),
      metadata_json: JSON.stringify({
        kind: 'text_label',
        text: 'Command Post',
        fontSize: 14,
        color: '#FFCC00',
        rotation: 25,
        point: [-9.7, 52.0],
      }),
    }
    const upsertDrawing = vi.fn().mockImplementation(async (input) => ({
      ...existingLabel,
      geometry_json: input.geometry_json,
      metadata_json: input.metadata_json,
    }))
    const runtime = await startDrawingRuntime({
      drawingStore: {
        listDrawings: vi.fn().mockResolvedValue([existingLabel]),
        upsertDrawing,
        deleteDrawing: vi.fn(),
      },
      applyRuntime: vi.fn(),
    })

    await runtime.refreshMission('mission-1')
    const moved = await runtime.moveTextLabel('label-1', -9.65, 52.05)

    expect(upsertDrawing).toHaveBeenCalledTimes(1)
    const input = upsertDrawing.mock.calls[0]![0]
    expect(input.id).toBe('label-1')
    expect(input.type).toBe('text_label')
    expect(input.display_order).toBe(4)
    // Text/style preserved; only the anchor moved.
    expect(input.name).toBe('Command Post')
    expect(JSON.parse(input.geometry_json)).toEqual({
      type: 'Point',
      coordinates: [-9.65, 52.05],
    })
    expect(JSON.parse(input.metadata_json)).toMatchObject({
      kind: 'text_label',
      text: 'Command Post',
      fontSize: 14,
      color: '#FFCC00',
      rotation: 25,
      point: [-9.65, 52.05],
    })
    expect(moved?.id).toBe('label-1')
  })

  it('ignores text-label moves for non-text-label drawings', async () => {
    const upsertDrawing = vi.fn()
    const runtime = await startDrawingRuntime({
      drawingStore: {
        listDrawings: vi.fn().mockResolvedValue([createDrawing()]),
        upsertDrawing,
        deleteDrawing: vi.fn(),
      },
      applyRuntime: vi.fn(),
    })

    await runtime.refreshMission('mission-1')
    const result = await runtime.moveTextLabel('drawing-1', -9.65, 52.05)

    expect(result).toBeNull()
    expect(upsertDrawing).not.toHaveBeenCalled()
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
