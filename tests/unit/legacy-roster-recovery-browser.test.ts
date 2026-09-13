import { afterEach, expect, it, vi } from 'vitest'
import { getBrowserHarnessStore, readBrowserHarnessState, resetBrowserHarnessStore } from '../../src/features/browser-validation/browser-harness-store'

afterEach(() => { resetBrowserHarnessStore(); vi.useRealTimers() })

it.each([{ ids: [] }, { ids: ['11'] }])('recovers removed unknown legacy group $ids with an explicit audit and original window', async ({ ids }) => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-08-20T09:00:00.000Z'))
  let store = getBrowserHarnessStore()
  const mission = await store.createMission({ name: 'Legacy', start_time: '2026-08-20T08:00:00.000Z' })
  const [group] = await store.selectMissionParticipants({ mission_id: mission.id, groups: [
    { traccar_group_id: '101', name: 'Team', member_device_ids: [] }], devices: [], selected_by: 'A' })
  await store.removeMissionParticipant({ mission_id: mission.id, participant_id: group!.id, removed_by: 'A' })
  const legacy = structuredClone(readBrowserHarnessState())
  legacy.missionParticipants = legacy.missionParticipants.map((row) => ({ ...row, starting_member_device_ids_json: null }))
  resetBrowserHarnessStore()
  sessionStorage.setItem('sartracker:browser-harness', JSON.stringify(legacy))
  store = getBrowserHarnessStore()
  await expect(store.finishMission(mission.id)).rejects.toThrow(/unknown/i)
  const input = { mission_id: mission.id, participant_id: group!.id, member_device_ids: ids,
    resolution: ids.length === 0 ? 'attested-empty' as const : 'supplied-members' as const,
    confirmed: true as const, confirmed_by: 'Coordinator Jane', reason: 'Reviewed incident roster' }
  await expect(store.resolveLegacyParticipantRoster({ ...input, reason: '' })).rejects.toThrow(/reason/i)
  const resolved = await store.resolveLegacyParticipantRoster(input)
  expect(resolved).toMatchObject({ backfill_member_count: ids.length, backfill_completed_count: 0, backfill_scope_error: null })
  await expect(store.resolveLegacyParticipantRoster(input)).rejects.toThrow(/already|correction/i)
  expect(readBrowserHarnessState().missionParticipants[0]?.starting_member_device_ids_json).toBeNull()
  expect(readBrowserHarnessState().groupMembershipEvents).toEqual([])
  for (const checkpoint of await store.listParticipantBackfillCheckpoints(mission.id)) {
    await expect(store.finishMission(mission.id)).rejects.toThrow(/backfill/i)
    await store.upsertParticipantBackfillCheckpoint({ ...checkpoint, completed: true, reconciled_until: checkpoint.window_to })
  }
  const serialized = sessionStorage.getItem('sartracker:browser-harness')!
  resetBrowserHarnessStore()
  sessionStorage.setItem('sartracker:browser-harness', serialized)
  store = getBrowserHarnessStore()
  expect(await store.listMissionParticipants(mission.id)).toContainEqual(expect.objectContaining({ backfill_scope_attested: true }))
  await expect(store.finishMission(mission.id)).resolves.toMatchObject({ status: 'finished' })
})
