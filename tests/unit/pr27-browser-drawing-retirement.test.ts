import { afterEach, expect, it } from 'vitest'
import { getBrowserHarnessStore, readBrowserHarnessState, resetBrowserHarnessStore } from '../../src/features/browser-validation/browser-harness-store'

afterEach(() => resetBrowserHarnessStore())

it.each(['line', 'search_area'] as const)('rejects moving a retained %s identity between missions', async (type) => {
  const store = getBrowserHarnessStore()
  const first = await store.createMission({ name: 'Original mission' })
  const second = await store.createMission({ name: 'Other mission' })
  const input = { mission_id: first.id, type, name: 'Original', display_order: 0,
    geometry_json: type === 'search_area' ? '{"type":"Polygon","coordinates":[]}' : '{"type":"LineString","coordinates":[[-9,52],[-9.1,52.1]]}' }
  const drawing = await store.upsertDrawing(input)
  const before = structuredClone(readBrowserHarnessState())
  await expect(store.upsertDrawing({ ...input, id: drawing.id, mission_id: second.id })).rejects.toThrow(/between missions/i)
  expect(readBrowserHarnessState()).toEqual(before)
})

it.each(['line', 'range_ring', 'bearing_line', 'search_sector', 'text_label', 'search_area'] as const)(
  'retains %s identities and immutable retirement evidence across reload', async (type) => {
    let store = getBrowserHarnessStore()
    const mission = await store.createMission({ name: 'Retirement parity' })
    const input = { mission_id: mission.id, type, name: 'Original', display_order: 0,
      geometry_json: type === 'search_area' ? '{"type":"Polygon","coordinates":[]}' : '{"type":"LineString","coordinates":[[-9,52],[-9.1,52.1]]}' }
    const drawing = await store.upsertDrawing(input)
    await store.upsertDrawing({ ...input, id: drawing.id, name: 'Revised' })
    expect(await store.deleteDrawing(drawing.id)).toBe(true)
    expect(await store.listDrawings(mission.id)).toEqual([])
    const retained = structuredClone(readBrowserHarnessState())
    expect(retained.drawings.find((row) => row.id === drawing.id)).toMatchObject({ retired_at: expect.any(String), version_sequence: 3 })
    expect((retained.drawingVersions ?? []).filter((row) => row.object_type === 'drawing').map((row) => [row.operation, row.state.name]))
      .toEqual([['created', 'Original'], ['updated', 'Revised'], ['retired', 'Revised']])
    expect(retained.missionEvents.some((event) => event.event_type === 'drawing_deleted'
      && JSON.parse(event.details_json).retired === true)).toBe(true)
    if (type === 'search_area') {
      expect(retained.missionEvents.some((event) => event.event_type === 'search_area_retired')).toBe(true)
      expect((retained.drawingVersions ?? []).filter((row) => row.object_type === 'search_area')).toHaveLength(3)
    }
    const serialized = sessionStorage.getItem('sartracker:browser-harness')!
    resetBrowserHarnessStore()
    sessionStorage.setItem('sartracker:browser-harness', serialized)
    store = getBrowserHarnessStore()
    await expect(store.upsertDrawing({ ...input, id: drawing.id })).rejects.toThrow(/retired/i)
    expect(await store.deleteDrawing(drawing.id)).toBe(false)
    expect(readBrowserHarnessState()).toEqual(retained)
  },
)
