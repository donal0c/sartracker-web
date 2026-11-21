import { describe, expect, it, vi } from 'vitest'

import type { Marker } from '../../src/infrastructure/mission-store/tauri-mission-store'
import { startMarkerRuntime } from '../../src/features/markers/start-marker-runtime'
import { createMarkerDraftAtCoordinate } from '../../src/features/markers/marker-draft'

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
  updated_by: null,
  coordinator_ids: null,
  attachment_path: null,
}

describe('startMarkerRuntime', () => {
  it('loads markers when the mission context changes', async () => {
    const applyRuntime = vi.fn()
    const runtime = await startMarkerRuntime({
      markerStore: createMarkerStoreStub({
        listMarkers: vi.fn().mockResolvedValue([MARKER]),
      }),
      attachmentStore: { ingest: vi.fn() },
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
      attachmentStore: { ingest: vi.fn() },
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

  it('records a sanitized diagnostic breadcrumb when a marker is saved [DON-226]', async () => {
    const recordDiagnosticEvent = vi.fn().mockResolvedValue(undefined)
    const upsertMarker = vi.fn().mockResolvedValue({
      ...MARKER,
      id: 'marker-2',
      type: 'hazard',
      display_order: 3,
    })
    const runtime = await startMarkerRuntime({
      markerStore: createMarkerStoreStub({
        listMarkers: vi.fn().mockResolvedValue([MARKER]),
        upsertMarker,
      }),
      attachmentStore: { ingest: vi.fn() },
      applyRuntime: vi.fn(),
      recordDiagnosticEvent,
    })

    await runtime.refreshMission('mission-1')
    runtime.beginCreateAt(52.0602, -9.5048, 'hazard')
    runtime.updateDraft({ name: 'Steep ground', hazardType: 'Terrain' })
    await runtime.saveDraft()

    expect(recordDiagnosticEvent).toHaveBeenCalledWith({
      level: 'info',
      category: 'marker',
      event: 'marker_saved',
      fields: {
        mode: 'create',
        markerType: 'hazard',
        markerCount: 2,
        hasAttachment: false,
      },
    })
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
      attachmentStore: { ingest: vi.fn() },
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
      attachmentStore: { ingest: vi.fn() },
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

  it('surfaces mission refresh errors without leaving stale marker state behind', async () => {
    const applyRuntime = vi.fn()
    const runtime = await startMarkerRuntime({
      markerStore: createMarkerStoreStub({
        listMarkers: vi.fn().mockRejectedValue(new Error('marker load failed')),
      }),
      attachmentStore: { ingest: vi.fn() },
      applyRuntime,
    })

    await runtime.refreshMission('mission-1')

    expect(applyRuntime).toHaveBeenLastCalledWith(
      expect.objectContaining({
        activeMissionId: 'mission-1',
        markers: [],
        loading: false,
        loadError: 'marker load failed',
      }),
    )
  })

  it('keeps a load failure when a valid marker draft is opened [DON-348 M-68]', async () => {
    const applyRuntime = vi.fn()
    const runtime = await startMarkerRuntime({
      markerStore: createMarkerStoreStub({
        listMarkers: vi.fn().mockRejectedValue(new Error('marker load failed')),
      }),
      attachmentStore: { ingest: vi.fn() },
      applyRuntime,
    })
    await runtime.refreshMission('mission-1')

    runtime.beginCreateFromDraft(createMarkerDraftAtCoordinate(52.0602, -9.5048))

    expect(applyRuntime).toHaveBeenLastCalledWith(expect.objectContaining({
      loadError: 'marker load failed',
      error: null,
      dialog: expect.objectContaining({ mode: 'create' }),
    }))
  })

  it('keeps the dialog open and reports an error when delete fails', async () => {
    const deleteMarker = vi.fn().mockRejectedValue(new Error('delete failed'))
    const applyRuntime = vi.fn()
    const runtime = await startMarkerRuntime({
      markerStore: createMarkerStoreStub({
        listMarkers: vi.fn().mockResolvedValue([MARKER]),
        deleteMarker,
      }),
      attachmentStore: { ingest: vi.fn() },
      applyRuntime,
    })

    await runtime.refreshMission('mission-1')
    runtime.beginEdit('marker-1')

    await expect(runtime.deleteEditingMarker()).rejects.toThrow('delete failed')

    expect(applyRuntime).toHaveBeenLastCalledWith(
      expect.objectContaining({
        saving: false,
        error: 'delete failed',
        dialog: expect.objectContaining({
          mode: 'edit',
        }),
      }),
    )
  })
})

describe('startMarkerRuntime mission switch during a dialog [DON-348]', () => {
  it('keeps a save that resolves after a mission switch out of the new mission', async () => {
    let resolveUpsert: (marker: Marker) => void = () => {}
    const upsertMarker = vi.fn().mockReturnValue(new Promise<Marker>((resolve) => { resolveUpsert = resolve }))
    const listMarkers = vi.fn().mockImplementation(async (missionId: string) => (missionId === 'mission-1' ? [MARKER] : []))
    const recordDiagnosticEvent = vi.fn().mockResolvedValue(undefined)
    const applyRuntime = vi.fn()
    const runtime = await startMarkerRuntime({
      markerStore: createMarkerStoreStub({ listMarkers, upsertMarker }),
      attachmentStore: { ingest: vi.fn() },
      applyRuntime,
      recordDiagnosticEvent,
    })

    await runtime.refreshMission('mission-1')
    runtime.beginCreateAt(52.0602, -9.5048, 'hazard')
    runtime.updateDraft({ name: 'Steep ground', hazardType: 'Terrain' })
    const save = runtime.saveDraft()
    await runtime.refreshMission('mission-2')
    resolveUpsert({ ...MARKER, id: 'marker-2', type: 'hazard', name: 'Steep ground', display_order: 3 })

    await expect(save).resolves.toMatchObject({ id: 'marker-2', mission_id: 'mission-1' })
    expect(upsertMarker).toHaveBeenCalledWith(expect.objectContaining({ mission_id: 'mission-1' }))
    expect(applyRuntime).toHaveBeenLastCalledWith(expect.objectContaining({
      activeMissionId: 'mission-2',
      markers: [],
      saving: false,
      error: null,
      loadError: null,
      dialog: null,
    }))
    expect(recordDiagnosticEvent).toHaveBeenCalledWith(expect.objectContaining({
      event: 'marker_saved',
      fields: expect.objectContaining({ mode: 'create', markerType: 'hazard' }),
    }))
  })

  it('still reports a save that fails after a mission switch', async () => {
    let rejectUpsert: (error: Error) => void = () => {}
    const upsertMarker = vi.fn().mockReturnValue(new Promise<Marker>((_resolve, reject) => { rejectUpsert = reject }))
    const applyRuntime = vi.fn()
    const runtime = await startMarkerRuntime({
      markerStore: createMarkerStoreStub({ upsertMarker }),
      attachmentStore: { ingest: vi.fn() },
      applyRuntime,
      recordDiagnosticEvent: vi.fn().mockResolvedValue(undefined),
    })

    await runtime.refreshMission('mission-1')
    runtime.beginCreateAt(52.0602, -9.5048, 'hazard')
    runtime.updateDraft({ name: 'Steep ground', hazardType: 'Terrain' })
    const save = runtime.saveDraft()
    await runtime.refreshMission('mission-2')
    rejectUpsert(new Error('database busy'))

    await expect(save).rejects.toThrow('database busy')
    const last = applyRuntime.mock.lastCall?.[0]
    expect(last).toMatchObject({ activeMissionId: 'mission-2', markers: [], saving: false, dialog: null })
    expect(last.error).toMatch(/database busy/)
    expect(last.error).not.toMatch(/Cannot read properties/)
  })

  it('says so visibly when a mission refresh discards unsaved marker changes', async () => {
    const applyRuntime = vi.fn()
    const runtime = await startMarkerRuntime({
      markerStore: createMarkerStoreStub(),
      attachmentStore: { ingest: vi.fn() },
      applyRuntime,
    })

    await runtime.refreshMission('mission-1')
    runtime.beginCreateAt(52.0602, -9.5048, 'casualty')
    runtime.updateDraft({ name: 'Subject Alpha' })
    runtime.updatePendingTreatmentUpdate('Gave 2 puffs salbutamol 14:05')
    await runtime.refreshMission('mission-2')

    const last = applyRuntime.mock.lastCall?.[0]
    expect(last.dialog).toBeNull()
    expect(last.error).toMatch(/Unsaved changes to marker "Subject Alpha" were discarded/)
    expect(last.error).toMatch(/treatment update/)
  })

  it('still warns when a mission refresh discards a draft while evidence is being attached', async () => {
    let resolveIngest: (attachment: { storedPath: string; fileName: string }) => void = () => {}
    const ingest = vi.fn().mockReturnValue(new Promise((resolve) => { resolveIngest = resolve }))
    const upsertMarker = vi.fn()
    const applyRuntime = vi.fn()
    const runtime = await startMarkerRuntime({
      markerStore: createMarkerStoreStub({ upsertMarker }),
      attachmentStore: { ingest },
      applyRuntime,
    })

    await runtime.refreshMission('mission-1')
    runtime.beginCreateAt(52.0602, -9.5048, 'casualty')
    runtime.updateDraft({ name: 'Subject Alpha' })
    runtime.updatePendingTreatmentUpdate('Gave 2 puffs salbutamol 14:05')
    const attach = runtime.attachEvidence(new File(['photo'], 'scene.jpg', { type: 'image/jpeg' }))
    await runtime.refreshMission('mission-2')

    const afterRefresh = applyRuntime.mock.lastCall?.[0]
    expect(afterRefresh.dialog).toBeNull()
    expect(afterRefresh.error).toMatch(/Unsaved changes to marker "Subject Alpha" were discarded/)
    expect(afterRefresh.error).toMatch(/treatment update/)

    resolveIngest({ storedPath: 'attachments/scene.jpg', fileName: 'scene.jpg' })
    await attach

    const last = applyRuntime.mock.lastCall?.[0]
    expect(upsertMarker).not.toHaveBeenCalled()
    expect(last).toMatchObject({ activeMissionId: 'mission-2', saving: false, dialog: null })
    expect(last.error).toMatch(/Unsaved changes to marker "Subject Alpha" were discarded/)
  })

  it('keeps the discard notice when evidence ingestion fails after the refresh', async () => {
    let rejectIngest: (error: Error) => void = () => {}
    const ingest = vi.fn().mockReturnValue(new Promise((_resolve, reject) => { rejectIngest = reject }))
    const applyRuntime = vi.fn()
    const runtime = await startMarkerRuntime({
      markerStore: createMarkerStoreStub(),
      attachmentStore: { ingest },
      applyRuntime,
    })

    await runtime.refreshMission('mission-1')
    runtime.beginCreateAt(52.0602, -9.5048, 'casualty')
    runtime.updateDraft({ name: 'Subject Alpha' })
    const attach = runtime.attachEvidence(new File(['photo'], 'scene.jpg', { type: 'image/jpeg' }))
    await runtime.refreshMission('mission-2')
    rejectIngest(new Error('disk full'))
    await attach

    const last = applyRuntime.mock.lastCall?.[0]
    expect(last).toMatchObject({ activeMissionId: 'mission-2', saving: false, dialog: null })
    expect(last.error).toMatch(/Unsaved changes to marker "Subject Alpha" were discarded/)
  })

  it('does not warn when a mission refresh closes an unchanged marker dialog', async () => {
    const applyRuntime = vi.fn()
    const runtime = await startMarkerRuntime({
      markerStore: createMarkerStoreStub(),
      attachmentStore: { ingest: vi.fn() },
      applyRuntime,
    })

    await runtime.refreshMission('mission-1')
    runtime.beginCreateAt(52.0602, -9.5048, 'clue')
    await runtime.refreshMission('mission-2')

    expect(applyRuntime).toHaveBeenLastCalledWith(expect.objectContaining({ dialog: null, error: null }))
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
