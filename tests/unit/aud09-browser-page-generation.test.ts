import { afterEach, expect, it } from 'vitest'
import { buildBrowserSearchOperationPage, getBrowserHarnessStore, readBrowserHarnessState, resetBrowserHarnessStore } from '../../src/features/browser-validation/browser-harness-store'

afterEach(() => resetBrowserHarnessStore())

it('keeps browser page cursors valid across unrelated backup audit evidence [DON-279]', async () => {
  const store = getBrowserHarnessStore()
  const mission = await store.createMission({ name: 'Backup cursor' })
  for (const name of ['Alpha', 'Bravo']) await store.upsertDrawing({
    mission_id: mission.id, type: 'search_area', name, display_order: 0,
    geometry_json: '{"type":"Polygon","coordinates":[]}',
  })
  const state = readBrowserHarnessState()
  const first = buildBrowserSearchOperationPage(state, { missionId: mission.id, kind: 'areas', limit: 1 })
  const afterBackup = { ...state, missionEvents: [...state.missionEvents, {
    id: 'backup', mission_id: mission.id, event_type: 'mission_backup_synced',
    timestamp: new Date().toISOString(), details_json: '{}',
  }] }
  expect(buildBrowserSearchOperationPage(afterBackup, {
    missionId: mission.id, kind: 'areas', limit: 1, cursor: first.nextCursor ?? undefined,
  }).entries[0]).toMatchObject({ name: 'Bravo' })
})

it('retires deleted search-area drawings and expires their page chain [DON-279]', async () => {
  const store = getBrowserHarnessStore()
  const mission = await store.createMission({ name: 'Deleted area cursor' })
  const drawings = []
  for (const name of ['Alpha', 'Bravo']) drawings.push(await store.upsertDrawing({
    mission_id: mission.id, type: 'search_area', name, display_order: 0,
    geometry_json: '{"type":"Polygon","coordinates":[]}',
  }))
  const query = { missionId: mission.id, kind: 'areas' as const, limit: 1 }
  const first = buildBrowserSearchOperationPage(readBrowserHarnessState(), query)
  expect(await store.deleteDrawing(drawings[1]!.id)).toBe(true)
  const state = readBrowserHarnessState()
  expect(state.searchAreas.find((area) => area.id === drawings[1]!.id))
    .toMatchObject({ retired_at: expect.any(String), version_sequence: 2 })
  expect(() => buildBrowserSearchOperationPage(state, {
    ...query, cursor: first.nextCursor ?? undefined,
  })).toThrow(/return to the first page/i)
  expect(buildBrowserSearchOperationPage(state, query).entries.map((entry) => entry.name))
    .toEqual(['Alpha'])
})

it('rejects reuse of a retired search-area identity without changing retained evidence [DON-279]', async () => {
  const store = getBrowserHarnessStore()
  const mission = await store.createMission({ name: 'Retained area identity' })
  const input = {
    mission_id: mission.id, type: 'search_area' as const, name: 'Retained area', display_order: 0,
    geometry_json: '{"type":"Polygon","coordinates":[]}',
  }
  const drawing = await store.upsertDrawing(input)
  await store.deleteDrawing(drawing.id)
  const before = structuredClone(readBrowserHarnessState())

  await expect(store.upsertDrawing({ ...input, id: drawing.id, name: 'Reused area' }))
    .rejects.toThrow(/cannot update retired search area/i)

  expect(readBrowserHarnessState()).toEqual(before)
})
