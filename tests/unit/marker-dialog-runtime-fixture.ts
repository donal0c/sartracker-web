import { vi } from 'vitest'

import { createMarkerDraftAtCoordinate } from '../../src/features/markers/marker-draft'
import { applyMarkerController, applyMarkerRuntime } from '../../src/features/markers/marker-store'
import { startMarkerRuntime } from '../../src/features/markers/start-marker-runtime'
import type { Marker, UpsertMarkerInput } from '../../src/infrastructure/mission-store/tauri-mission-store'

/** Wires the real marker runtime to a recording persistence boundary. */
export async function createMarkerDialogRuntime() {
  const listMarkers = vi.fn<(missionId: string) => Promise<readonly Marker[]>>().mockResolvedValue([])
  let nextMarkerId = 0
  const upsertMarker = vi.fn(async (input: UpsertMarkerInput): Promise<Marker> => ({
    description: null,
    subject_category: null,
    clue_type: null,
    confidence: null,
    found_by: null,
    hazard_type: null,
    severity: null,
    condition: null,
    treatment: null,
    evacuation_priority: null,
    updated_by: null,
    coordinator_ids: null,
    attachment_path: null,
    ...input,
    id: input.id ?? `marker-${++nextMarkerId}`,
    created_at: '2026-11-21T14:00:00.000Z',
    updated_at: '2026-11-21T14:00:00.000Z',
  }))
  const recordDiagnosticEvent = vi.fn()
  const controller = await startMarkerRuntime({
    markerStore: { listMarkers, upsertMarker, deleteMarker: vi.fn() },
    attachmentStore: { ingest: vi.fn() },
    applyRuntime: applyMarkerRuntime,
    recordDiagnosticEvent,
  })
  applyMarkerController(controller)
  await controller.refreshMission('mission-1')
  return { controller, listMarkers, upsertMarker, recordDiagnosticEvent }
}

/** Supplies a casualty draft with all required operator fields filled in. */
export function casualtyDraft(name = 'Casualty A') {
  return {
    ...createMarkerDraftAtCoordinate(52.179337, -9.464944, 'casualty'),
    name,
    condition: 'Medical Emergency',
    evacuationPriority: 'Urgent',
    updatedBy: 'Coordinator',
  }
}
