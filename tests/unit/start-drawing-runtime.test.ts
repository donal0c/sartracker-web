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
      },
      applyRuntime,
    })

    await runtime.refreshMission('mission-1')

    expect(applyRuntime).toHaveBeenLastCalledWith({
      activeMissionId: 'mission-1',
      drawings: [drawing],
      loading: false,
      error: null,
    })
  })

  it('clears drawings when the mission becomes null', async () => {
    const applyRuntime = vi.fn()
    const runtime = await startDrawingRuntime({
      drawingStore: {
        listDrawings: vi.fn().mockResolvedValue([]),
      },
      applyRuntime,
    })

    await runtime.refreshMission(null)

    expect(applyRuntime).toHaveBeenLastCalledWith({
      activeMissionId: null,
      drawings: [],
      loading: false,
      error: null,
    })
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
