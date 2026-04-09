import { describe, expect, it, vi } from 'vitest'

import type { Marker } from '../../src/infrastructure/mission-store/tauri-mission-store'
import { startMarkerRuntime } from '../../src/features/markers/start-marker-runtime'

const MARKER: Marker = {
  id: 'marker-1',
  mission_id: 'mission-1',
  type: 'clue',
  name: 'Boot print',
  description: null,
  lat: 52.0599,
  lon: -9.5045,
  irish_grid_e: 496584,
  irish_grid_n: 591256,
  created_at: '2026-04-09T10:00:00.000Z',
  updated_at: '2026-04-09T10:00:00.000Z',
  display_order: 2,
  subject_category: null,
  clue_type: 'Footprint',
  confidence: 0.5,
  found_by: 'Team 2',
  hazard_type: null,
  severity: null,
  condition: null,
  treatment: null,
  evacuation_priority: null,
}

describe('startMarkerRuntime', () => {
  it('loads markers when the mission context changes', async () => {
    const applyRuntime = vi.fn()
    const runtime = await startMarkerRuntime({
      markerStore: createMarkerStoreStub({
        listMarkers: vi.fn().mockResolvedValue([MARKER]),
      }),
      applyRuntime,
    })

    await runtime.refreshMission('mission-1')

    expect(applyRuntime).toHaveBeenLastCalledWith(
      expect.objectContaining({
        activeMissionId: 'mission-1',
        markers: [MARKER],
      }),
    )
  })

  it('creates a new marker using the next display order', async () => {
    const upsertMarker = vi.fn().mockResolvedValue({
      ...MARKER,
      id: 'marker-2',
      name: 'New clue',
      display_order: 3,
    })
    const applyRuntime = vi.fn()
    const runtime = await startMarkerRuntime({
      markerStore: createMarkerStoreStub({
        listMarkers: vi.fn().mockResolvedValue([MARKER]),
        upsertMarker,
      }),
      applyRuntime,
    })

    await runtime.refreshMission('mission-1')
    runtime.beginCreateAt(52.0602, -9.5048)
    runtime.updateDraft({
      type: 'clue',
      name: 'New clue',
      clueType: 'Equipment',
    })
    await runtime.saveDraft()

    expect(upsertMarker).toHaveBeenCalledWith(
      expect.objectContaining({
        mission_id: 'mission-1',
        display_order: 3,
        clue_type: 'Equipment',
      }),
    )
  })

  it('updates an existing marker without changing its display order', async () => {
    const upsertMarker = vi.fn().mockResolvedValue({
      ...MARKER,
      name: 'Updated print',
    })
    const runtime = await startMarkerRuntime({
      markerStore: createMarkerStoreStub({
        listMarkers: vi.fn().mockResolvedValue([MARKER]),
        upsertMarker,
      }),
      applyRuntime: vi.fn(),
    })

    await runtime.refreshMission('mission-1')
    runtime.beginEdit('marker-1')
    runtime.updateDraft({ name: 'Updated print' })
    await runtime.saveDraft()

    expect(upsertMarker).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'marker-1',
        display_order: 2,
        name: 'Updated print',
      }),
    )
  })

  it('deletes the marker currently open in edit mode', async () => {
    const deleteMarker = vi.fn().mockResolvedValue(true)
    const applyRuntime = vi.fn()
    const runtime = await startMarkerRuntime({
      markerStore: createMarkerStoreStub({
        listMarkers: vi.fn().mockResolvedValue([MARKER]),
        deleteMarker,
      }),
      applyRuntime,
    })

    await runtime.refreshMission('mission-1')
    runtime.beginEdit('marker-1')
    await runtime.deleteEditingMarker()

    expect(deleteMarker).toHaveBeenCalledWith('marker-1')
    expect(applyRuntime).toHaveBeenLastCalledWith(
      expect.objectContaining({
        markers: [],
        dialog: null,
      }),
    )
  })
})

function createMarkerStoreStub(overrides: Record<string, unknown> = {}) {
  return {
    listMarkers: vi.fn().mockResolvedValue([]),
    upsertMarker: vi.fn(),
    deleteMarker: vi.fn(),
    ...overrides,
  }
}
