import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')
const { createElectronMissionStore } = require('../../electron/mission-store.cjs') as {
  readonly createElectronMissionStore: (options: {
    readonly userDataPath: string
  }) => ParticipantStore
}

type Participant = {
  readonly id: string
  readonly kind: 'device' | 'group'
  readonly traccar_device_id: string | null
  readonly mission_team_id: string | null
  readonly starting_member_device_ids_json?: string | null
  readonly backfill_member_count?: number | null
  readonly backfill_completed_count?: number | null
  readonly backfill_scope_inferred?: boolean | null
}

type BackfillCheckpoint = {
  readonly traccar_device_id: string
  readonly window_from: string
  readonly window_to: string
  readonly completed: number
}

type MembershipEvent = {
  readonly change: 'member' | 'left'
  readonly observed_at: string
  readonly sequence: number
}

type ParticipantStore = {
  readonly prepareClose: () => Promise<void>
  readonly close: () => void
  readonly createMission: (input: {
    readonly name: string
    readonly start_time: string
  }) => Promise<{ readonly id: string }>
  readonly info: () => Promise<{ readonly database_path: string }>
  readonly selectMissionParticipants: (input: unknown) => Promise<readonly Participant[]>
  readonly addMissionParticipant: (input: unknown) => Promise<Participant>
  readonly removeMissionParticipant: (input: unknown) => Promise<Participant>
  readonly listMissionParticipants: (missionId: string) => Promise<readonly Participant[]>
  readonly listGroupMembershipEvents: (missionId: string, teamId?: string) => Promise<readonly MembershipEvent[]>
  readonly recordGroupMembershipEvents: (input: unknown) => Promise<readonly MembershipEvent[]>
  readonly listParticipantBackfillCheckpoints: (missionId: string) => Promise<readonly BackfillCheckpoint[]>
  readonly upsertParticipantBackfillCheckpoint: (input: unknown) => Promise<unknown>
  readonly finishMission: (missionId: string) => Promise<{ readonly status: string }>
}

const missionStart = '2026-08-20T08:00:00.000Z'

let stores: ParticipantStore[] = []
let directories: string[] = []

afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(stores.map((store) => store.prepareClose()))
  for (const store of stores) store.close()
  stores = []
  await Promise.all(directories.map((directory) => rm(directory, { recursive: true, force: true })))
  directories = []
})

describe('AUD-08 re-added group backfill completeness [DON-271]', () => {
  it('rejects an omitted initial group roster instead of normalizing it to known-empty', async () => {
    vi.useFakeTimers()
    setClock('2026-08-20T09:00:00.000Z')
    const store = await createStore()
    const mission = await store.createMission({
      name: 'Missing initial roster mission',
      start_time: missionStart,
    })

    await expect(store.selectMissionParticipants({
      mission_id: mission.id,
      groups: [{
        traccar_group_id: '101',
        name: 'Kerry MRT',
      }],
      devices: [],
      selected_by: 'Coordinator A',
    })).rejects.toThrow(/current group member device ids are required/i)
  })

  it('accepts an explicit empty initial roster as known-empty and finishable', async () => {
    vi.useFakeTimers()
    setClock('2026-08-20T09:00:00.000Z')
    const store = await createStore()
    const mission = await store.createMission({
      name: 'Explicit empty initial roster mission',
      start_time: missionStart,
    })
    const [group] = await store.selectMissionParticipants({
      mission_id: mission.id,
      groups: [{
        traccar_group_id: '101',
        name: 'Kerry MRT',
        member_device_ids: [],
      }],
      devices: [],
      selected_by: 'Coordinator A',
    })

    await expect(store.listMissionParticipants(mission.id)).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({
        id: group!.id,
        backfill_member_count: 0,
        backfill_completed_count: 0,
        backfill_scope_inferred: false,
        backfill_scope_unknown: false,
      })]),
    )
    await expect(store.finishMission(mission.id)).resolves.toMatchObject({ status: 'finished' })
  })

  it('blocks an old group row whose roster has no retained events or checkpoints', async () => {
    vi.useFakeTimers()
    setClock('2026-08-20T09:00:00.000Z')
    const store = await createStore()
    const mission = await store.createMission({
      name: 'Unknown legacy group scope mission',
      start_time: missionStart,
    })
    const [group] = await store.selectMissionParticipants({
      mission_id: mission.id,
      groups: [{
        traccar_group_id: '101',
        name: 'Kerry MRT',
        member_device_ids: [],
      }],
      devices: [],
      selected_by: 'Coordinator A',
    })
    const databasePath = (await store.info()).database_path
    const directory = directories.at(-1)!
    await store.prepareClose()
    store.close()
    stores = stores.filter((candidate) => candidate !== store)
    const database = new Database(databasePath)
    database.prepare(`UPDATE mission_participants
      SET starting_member_device_ids_json = NULL WHERE id = ?`).run(group!.id)
    database.close()

    const restartedStore = await reopenStore(directory)
    const currentGroup = (await restartedStore.listMissionParticipants(mission.id))
      .find((participant) => participant.id === group!.id)
    expect(currentGroup).toMatchObject({
      backfill_member_count: null,
      backfill_completed_count: null,
      backfill_scope_inferred: false,
      backfill_scope_unknown: true,
    })
    await expect(restartedStore.finishMission(mission.id)).rejects.toThrow(
      /legacy group history scope is unknown/i,
    )
  })

  it('keeps a legacy left-only event before participant insertion unknown and unfinishable', async () => {
    vi.useFakeTimers()
    setClock('2026-08-20T09:00:00.000Z')
    const store = await createStore()
    const mission = await store.createMission({
      name: 'Legacy pre-insertion left-only scope mission',
      start_time: missionStart,
    })
    const [group] = await store.selectMissionParticipants({
      mission_id: mission.id,
      groups: [{
        traccar_group_id: '101',
        name: 'Kerry MRT',
        member_device_ids: [],
      }],
      devices: [],
      selected_by: 'Coordinator A',
    })
    await store.recordGroupMembershipEvents({
      mission_id: mission.id,
      events: [{
        mission_team_id: group!.mission_team_id,
        traccar_device_id: '11',
        change: 'left',
        observed_at: '2026-08-20T08:30:00.000Z',
      }],
    })

    const databasePath = (await store.info()).database_path
    const directory = directories.at(-1)!
    await store.prepareClose()
    store.close()
    stores = stores.filter((candidate) => candidate !== store)
    const database = new Database(databasePath)
    database.prepare(`UPDATE mission_participants
      SET starting_member_device_ids_json = NULL WHERE id = ?`).run(group!.id)
    database.close()

    const restartedStore = await reopenStore(directory)
    const currentGroup = (await restartedStore.listMissionParticipants(mission.id))
      .find((participant) => participant.id === group!.id)
    expect(currentGroup).toMatchObject({
      backfill_member_count: null,
      backfill_completed_count: null,
      backfill_scope_inferred: false,
      backfill_scope_unknown: true,
    })
    await expect(restartedStore.finishMission(mission.id)).rejects.toThrow(
      /legacy group history scope is unknown/i,
    )
  })

  it('refuses finish when a snapshot member has no checkpoint row', async () => {
    vi.useFakeTimers()
    setClock('2026-08-20T09:00:00.000Z')
    const store = await createStore()
    const mission = await store.createMission({
      name: 'Missing member checkpoint mission',
      start_time: missionStart,
    })
    const [group] = await store.selectMissionParticipants({
      mission_id: mission.id,
      groups: [{
        traccar_group_id: '101',
        name: 'Kerry MRT',
        member_device_ids: ['11', '12'],
      }],
      devices: [],
      selected_by: 'Coordinator A',
    })
    const memberCheckpoint = (await store.listParticipantBackfillCheckpoints(mission.id))
      .find((checkpoint) => checkpoint.traccar_device_id === '11')
    await store.upsertParticipantBackfillCheckpoint({
      mission_id: mission.id,
      traccar_device_id: '11',
      window_from: memberCheckpoint!.window_from,
      window_to: memberCheckpoint!.window_to,
      reconciled_until: memberCheckpoint!.window_to,
      completed: true,
    })
    const databasePath = (await store.info()).database_path
    const directory = directories.at(-1)!
    await store.prepareClose()
    store.close()
    stores = stores.filter((candidate) => candidate !== store)
    const database = new Database(databasePath)
    database.prepare(`DELETE FROM participant_backfill_checkpoints
      WHERE mission_id = ? AND traccar_device_id = ?`).run(mission.id, '12')
    database.close()

    const restartedStore = await reopenStore(directory)
    const currentGroup = (await restartedStore.listMissionParticipants(mission.id))
      .find((participant) => participant.id === group!.id)
    expect(currentGroup).toMatchObject({
      backfill_member_count: 2,
      backfill_completed_count: 1,
    })
    await expect(restartedStore.finishMission(mission.id)).rejects.toThrow(
      /history backfill.*incomplete|participant.*checkpoint/i,
    )
  })

  it('refuses finish when completed checkpoint windows leave an interior gap', async () => {
    vi.useFakeTimers()
    setClock('2026-08-20T11:00:00.000Z')
    const store = await createStore()
    const mission = await store.createMission({
      name: 'Interior checkpoint gap mission',
      start_time: missionStart,
    })
    const [group] = await store.selectMissionParticipants({
      mission_id: mission.id,
      groups: [{
        traccar_group_id: '101',
        name: 'Kerry MRT',
        member_device_ids: ['11'],
      }],
      devices: [],
      selected_by: 'Coordinator A',
    })
    const databasePath = (await store.info()).database_path
    const directory = directories.at(-1)!
    await store.prepareClose()
    store.close()
    stores = stores.filter((candidate) => candidate !== store)
    const database = new Database(databasePath)
    database.prepare(`DELETE FROM participant_backfill_checkpoints
      WHERE mission_id = ? AND traccar_device_id = ?`).run(mission.id, '11')
    database.prepare(`INSERT INTO participant_backfill_checkpoints (
        mission_id, traccar_device_id, window_from, window_to,
        reconciled_until, completed, updated_at
      ) VALUES (?, ?, ?, ?, ?, 1, ?), (?, ?, ?, ?, ?, 1, ?)`)
      .run(
        mission.id, '11', missionStart, '2026-08-20T09:00:00.000Z',
        '2026-08-20T09:00:00.000Z', '2026-08-20T11:00:00.000Z',
        mission.id, '11', '2026-08-20T10:00:00.000Z', '2026-08-20T11:00:00.000Z',
        '2026-08-20T11:00:00.000Z', '2026-08-20T11:00:00.000Z',
      )
    database.close()

    const restartedStore = await reopenStore(directory)
    const currentGroup = (await restartedStore.listMissionParticipants(mission.id))
      .find((participant) => participant.id === group!.id)
    expect(currentGroup).toMatchObject({
      backfill_member_count: 1,
      backfill_completed_count: 0,
    })
    await expect(restartedStore.finishMission(mission.id)).rejects.toThrow(
      /history backfill.*incomplete|participant.*checkpoint/i,
    )
  })

  it('retains a same-boundary legacy member when sequence history ends in left', async () => {
    vi.useFakeTimers()
    setClock('2026-08-20T09:00:00.000Z')
    const store = await createStore()
    const mission = await store.createMission({
      name: 'Legacy same-boundary member mission',
      start_time: missionStart,
    })
    const [group] = await store.selectMissionParticipants({
      mission_id: mission.id,
      groups: [{
        traccar_group_id: '101',
        name: 'Kerry MRT',
        member_device_ids: ['11'],
      }],
      devices: [],
      selected_by: 'Coordinator A',
    })
    await store.recordGroupMembershipEvents({
      mission_id: mission.id,
      events: [{
        mission_team_id: group!.mission_team_id,
        traccar_device_id: '11',
        change: 'left',
        observed_at: '2026-08-20T09:00:00.000Z',
      }],
    })
    const databasePath = (await store.info()).database_path
    const directory = directories.at(-1)!
    await store.prepareClose()
    store.close()
    stores = stores.filter((candidate) => candidate !== store)
    const database = new Database(databasePath)
    database.prepare(`UPDATE mission_participants
      SET starting_member_device_ids_json = NULL WHERE id = ?`).run(group!.id)
    database.prepare(`DELETE FROM participant_backfill_checkpoints
      WHERE mission_id = ? AND traccar_device_id = ?`).run(mission.id, '11')
    database.close()

    const restartedStore = await reopenStore(directory)
    const currentGroup = (await restartedStore.listMissionParticipants(mission.id))
      .find((participant) => participant.id === group!.id)
    expect(currentGroup).toMatchObject({
      backfill_member_count: 1,
      backfill_completed_count: 0,
      backfill_scope_inferred: true,
    })
    await expect(restartedStore.finishMission(mission.id)).rejects.toThrow(
      /history backfill.*incomplete|participant.*checkpoint/i,
    )
  })

  it('counts every required member after a removed group is re-added', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-20T09:00:00.000Z'))
    const store = await createStore()
    const mission = await store.createMission({
      name: 'Re-added group completeness mission',
      start_time: missionStart,
    })

    const [initialGroup] = await store.selectMissionParticipants({
      mission_id: mission.id,
      groups: [{
        traccar_group_id: '101',
        name: 'Kerry MRT',
        member_device_ids: ['11'],
      }],
      devices: [],
      selected_by: 'Coordinator A',
    })
    const initialCheckpoint = (await store.listParticipantBackfillCheckpoints(mission.id))[0]
    await store.upsertParticipantBackfillCheckpoint({
      mission_id: mission.id,
      traccar_device_id: initialCheckpoint!.traccar_device_id,
      window_from: initialCheckpoint!.window_from,
      window_to: initialCheckpoint!.window_to,
      reconciled_until: initialCheckpoint!.window_to,
      completed: true,
    })

    vi.setSystemTime(new Date('2026-08-20T10:00:00.000Z'))
    await store.removeMissionParticipant({
      mission_id: mission.id,
      participant_id: initialGroup!.id,
      removed_by: 'Coordinator A',
      reason: 'Team stood down',
    })

    vi.setSystemTime(new Date('2026-08-20T11:00:00.000Z'))
    const readdedGroup = await store.addMissionParticipant({
      mission_id: mission.id,
      kind: 'group',
      ref: {
        traccar_group_id: '101',
        name: 'Kerry MRT',
        member_device_ids: ['11', '12'],
      },
      effective_from: missionStart,
      confirmed_by: 'Coordinator A',
    })

    const bCheckpoint = (await store.listParticipantBackfillCheckpoints(mission.id))
      .find((checkpoint) => checkpoint.traccar_device_id === '12')
    expect(bCheckpoint).toEqual(expect.objectContaining({
      window_from: missionStart,
      window_to: '2026-08-20T11:00:00.000Z',
      completed: 0,
    }))
    await store.upsertParticipantBackfillCheckpoint({
      mission_id: mission.id,
      traccar_device_id: bCheckpoint!.traccar_device_id,
      window_from: bCheckpoint!.window_from,
      window_to: bCheckpoint!.window_to,
      reconciled_until: bCheckpoint!.window_to,
      completed: true,
    })

    const currentGroup = (await store.listMissionParticipants(mission.id))
      .find((participant) => participant.id === readdedGroup.id)
    await expect(store.finishMission(mission.id)).rejects.toThrow(
      /history backfill.*incomplete|complete.*history backfill/i,
    )
    expect(currentGroup).toMatchObject({
      kind: 'group',
      backfill_member_count: 2,
      backfill_completed_count: 1,
    })
  })

  it('keeps a sole unchanged member visible as pending after group re-addition', async () => {
    vi.useFakeTimers()
    setClock('2026-08-20T09:00:00.000Z')
    const store = await createStore()
    const mission = await store.createMission({
      name: 'Sole unchanged group member mission',
      start_time: missionStart,
    })
    const [initialGroup] = await store.selectMissionParticipants({
      mission_id: mission.id,
      groups: [{
        traccar_group_id: '101',
        name: 'Kerry MRT',
        member_device_ids: ['11'],
      }],
      devices: [],
      selected_by: 'Coordinator A',
    })
    await completeLatestPendingCheckpoint(store, mission.id, '11')

    setClock('2026-08-20T10:00:00.000Z')
    await store.removeMissionParticipant({
      mission_id: mission.id,
      participant_id: initialGroup!.id,
      removed_by: 'Coordinator A',
    })
    setClock('2026-08-20T11:00:00.000Z')
    const readdedGroup = await store.addMissionParticipant({
      mission_id: mission.id,
      kind: 'group',
      ref: {
        traccar_group_id: '101',
        name: 'Kerry MRT',
        member_device_ids: ['11'],
      },
      effective_from: missionStart,
      confirmed_by: 'Coordinator A',
    })

    await expect(store.finishMission(mission.id)).rejects.toThrow(
      /history backfill.*incomplete|complete.*history backfill/i,
    )
    const currentGroup = (await store.listMissionParticipants(mission.id))
      .find((participant) => participant.id === readdedGroup.id)
    expect(currentGroup).toMatchObject({
      kind: 'group',
      backfill_member_count: 1,
      backfill_completed_count: 0,
    })
  })

  it('excludes a removed member while including a newly added member in the denominator', async () => {
    vi.useFakeTimers()
    setClock('2026-08-20T09:00:00.000Z')
    const store = await createStore()
    const mission = await store.createMission({
      name: 'Changed group membership mission',
      start_time: missionStart,
    })
    const [initialGroup] = await store.selectMissionParticipants({
      mission_id: mission.id,
      groups: [{
        traccar_group_id: '101',
        name: 'Kerry MRT',
        member_device_ids: ['11', '12'],
      }],
      devices: [],
      selected_by: 'Coordinator A',
    })
    await completeLatestPendingCheckpoint(store, mission.id, '11')
    await completeLatestPendingCheckpoint(store, mission.id, '12')

    setClock('2026-08-20T10:00:00.000Z')
    await store.removeMissionParticipant({
      mission_id: mission.id,
      participant_id: initialGroup!.id,
      removed_by: 'Coordinator A',
    })
    setClock('2026-08-20T11:00:00.000Z')
    const readdedGroup = await store.addMissionParticipant({
      mission_id: mission.id,
      kind: 'group',
      ref: {
        traccar_group_id: '101',
        name: 'Kerry MRT',
        member_device_ids: ['12', '13'],
      },
      effective_from: missionStart,
      confirmed_by: 'Coordinator A',
    })
    await completeLatestPendingCheckpoint(store, mission.id, '13')

    await expect(store.finishMission(mission.id)).rejects.toThrow(
      /history backfill.*incomplete|complete.*history backfill/i,
    )
    const currentGroup = (await store.listMissionParticipants(mission.id))
      .find((participant) => participant.id === readdedGroup.id)
    expect(currentGroup).toMatchObject({
      kind: 'group',
      backfill_member_count: 2,
      backfill_completed_count: 1,
    })
  })

  it('does not expand the re-added denominator after a later membership observation', async () => {
    vi.useFakeTimers()
    setClock('2026-08-20T09:00:00.000Z')
    const store = await createStore()
    const mission = await store.createMission({
      name: 'Late membership observation mission',
      start_time: missionStart,
    })
    const [initialGroup] = await store.selectMissionParticipants({
      mission_id: mission.id,
      groups: [{
        traccar_group_id: '101',
        name: 'Kerry MRT',
        member_device_ids: ['11', '12'],
      }],
      devices: [],
      selected_by: 'Coordinator A',
    })
    await completeLatestPendingCheckpoint(store, mission.id, '11')
    await completeLatestPendingCheckpoint(store, mission.id, '12')

    setClock('2026-08-20T10:00:00.000Z')
    await store.removeMissionParticipant({
      mission_id: mission.id,
      participant_id: initialGroup!.id,
      removed_by: 'Coordinator A',
    })
    setClock('2026-08-20T11:00:00.000Z')
    const readdedGroup = await store.addMissionParticipant({
      mission_id: mission.id,
      kind: 'group',
      ref: {
        traccar_group_id: '101',
        name: 'Kerry MRT',
        member_device_ids: ['11', '12'],
      },
      effective_from: missionStart,
      confirmed_by: 'Coordinator A',
    })
    await completeLatestPendingCheckpoint(store, mission.id, '12')

    setClock('2026-08-20T12:00:00.000Z')
    await store.recordGroupMembershipEvents({
      mission_id: mission.id,
      events: [{
        mission_team_id: readdedGroup.mission_team_id,
        traccar_device_id: '13',
        change: 'member',
        observed_at: '2026-08-20T12:00:00.000Z',
      }],
    })

    await expect(store.finishMission(mission.id)).rejects.toThrow(
      /history backfill.*incomplete|complete.*history backfill/i,
    )
    const currentGroup = (await store.listMissionParticipants(mission.id))
      .find((participant) => participant.id === readdedGroup.id)
    expect(currentGroup).toMatchObject({
      kind: 'group',
      backfill_member_count: 2,
      backfill_completed_count: 1,
    })
  })

  it('uses sequence order when removal and re-add membership events share a timestamp', async () => {
    vi.useFakeTimers()
    setClock('2026-08-20T09:00:00.000Z')
    const store = await createStore()
    const mission = await store.createMission({
      name: 'Same timestamp membership mission',
      start_time: missionStart,
    })
    const [initialGroup] = await store.selectMissionParticipants({
      mission_id: mission.id,
      groups: [{
        traccar_group_id: '101',
        name: 'Kerry MRT',
        member_device_ids: ['11'],
      }],
      devices: [],
      selected_by: 'Coordinator A',
    })
    await completeLatestPendingCheckpoint(store, mission.id, '11')

    setClock('2026-08-20T10:00:00.000Z')
    await store.removeMissionParticipant({
      mission_id: mission.id,
      participant_id: initialGroup!.id,
      removed_by: 'Coordinator A',
    })
    await store.recordGroupMembershipEvents({
      mission_id: mission.id,
      events: [{
        mission_team_id: initialGroup!.mission_team_id,
        traccar_device_id: '11',
        change: 'left',
        observed_at: '2026-08-20T10:00:00.000Z',
      }],
    })
    const readdedGroup = await store.addMissionParticipant({
      mission_id: mission.id,
      kind: 'group',
      ref: {
        traccar_group_id: '101',
        name: 'Kerry MRT',
        member_device_ids: ['11', '12'],
      },
      effective_from: missionStart,
      confirmed_by: 'Coordinator A',
    })
    await completeLatestPendingCheckpoint(store, mission.id, '12')

    const events = await store.listGroupMembershipEvents(
      mission.id,
      readdedGroup.mission_team_id ?? undefined,
    )
    expect(events.filter((event) => event.observed_at === '2026-08-20T10:00:00.000Z'))
      .toEqual([
        expect.objectContaining({ change: 'left', observed_at: '2026-08-20T10:00:00.000Z', sequence: 2 }),
        expect.objectContaining({ change: 'member', observed_at: '2026-08-20T10:00:00.000Z', sequence: 3 }),
        expect.objectContaining({ change: 'member', observed_at: '2026-08-20T10:00:00.000Z', sequence: 4 }),
      ])
    await expect(store.finishMission(mission.id)).rejects.toThrow(
      /history backfill.*incomplete|complete.*history backfill/i,
    )
    await expect(store.listMissionParticipants(mission.id)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: readdedGroup.id,
          backfill_member_count: 2,
          backfill_completed_count: 1,
        }),
      ]),
    )
  })

  it('retains truthful re-added group progress after a native store restart', async () => {
    vi.useFakeTimers()
    setClock('2026-08-20T09:00:00.000Z')
    const store = await createStore()
    const mission = await store.createMission({
      name: 'Restarted group progress mission',
      start_time: missionStart,
    })
    const [initialGroup] = await store.selectMissionParticipants({
      mission_id: mission.id,
      groups: [{
        traccar_group_id: '101',
        name: 'Kerry MRT',
        member_device_ids: ['11'],
      }],
      devices: [],
      selected_by: 'Coordinator A',
    })
    await completeLatestPendingCheckpoint(store, mission.id, '11')

    setClock('2026-08-20T10:00:00.000Z')
    await store.removeMissionParticipant({
      mission_id: mission.id,
      participant_id: initialGroup!.id,
      removed_by: 'Coordinator A',
    })
    setClock('2026-08-20T11:00:00.000Z')
    const readdedGroup = await store.addMissionParticipant({
      mission_id: mission.id,
      kind: 'group',
      ref: {
        traccar_group_id: '101',
        name: 'Kerry MRT',
        member_device_ids: ['11', '12'],
      },
      effective_from: missionStart,
      confirmed_by: 'Coordinator A',
    })
    await completeLatestPendingCheckpoint(store, mission.id, '12')
    await expect(store.finishMission(mission.id)).rejects.toThrow(
      /history backfill.*incomplete|complete.*history backfill/i,
    )

    const directory = directories.at(-1)!
    await store.prepareClose()
    store.close()
    stores = stores.filter((candidate) => candidate !== store)
    const restartedStore = await reopenStore(directory)
    const restartedGroup = (await restartedStore.listMissionParticipants(mission.id))
      .find((participant) => participant.id === readdedGroup.id)
    await expect(restartedStore.finishMission(mission.id)).rejects.toThrow(
      /history backfill.*incomplete|complete.*history backfill/i,
    )
    expect(restartedGroup).toMatchObject({
      kind: 'group',
      backfill_member_count: 2,
      backfill_completed_count: 1,
    })
  })

  it('moves from pending to complete only after every re-added member is reconciled', async () => {
    vi.useFakeTimers()
    setClock('2026-08-20T09:00:00.000Z')
    const store = await createStore()
    const mission = await store.createMission({
      name: 'Re-added group completion progression mission',
      start_time: missionStart,
    })
    const [initialGroup] = await store.selectMissionParticipants({
      mission_id: mission.id,
      groups: [{
        traccar_group_id: '101',
        name: 'Kerry MRT',
        member_device_ids: ['11'],
      }],
      devices: [],
      selected_by: 'Coordinator A',
    })
    await completeLatestPendingCheckpoint(store, mission.id, '11')

    setClock('2026-08-20T10:00:00.000Z')
    await store.removeMissionParticipant({
      mission_id: mission.id,
      participant_id: initialGroup!.id,
      removed_by: 'Coordinator A',
    })
    setClock('2026-08-20T11:00:00.000Z')
    const readdedGroup = await store.addMissionParticipant({
      mission_id: mission.id,
      kind: 'group',
      ref: {
        traccar_group_id: '101',
        name: 'Kerry MRT',
        member_device_ids: ['11', '12'],
      },
      effective_from: missionStart,
      confirmed_by: 'Coordinator A',
    })
    await expect(store.finishMission(mission.id)).rejects.toThrow(
      /history backfill.*incomplete|complete.*history backfill/i,
    )
    await completeLatestPendingCheckpoint(store, mission.id, '11')
    await completeLatestPendingCheckpoint(store, mission.id, '12')
    await expect(store.finishMission(mission.id)).resolves.toMatchObject({ status: 'finished' })

    await expect(store.listMissionParticipants(mission.id)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: readdedGroup.id,
          backfill_member_count: 2,
          backfill_completed_count: 2,
        }),
      ]),
    )
  })

  it('recreates the nullable snapshot column and preserves legacy scope after restart', async () => {
    vi.useFakeTimers()
    setClock('2026-08-20T09:00:00.000Z')
    const store = await createStore()
    const mission = await store.createMission({
      name: 'Legacy participant snapshot migration mission',
      start_time: missionStart,
    })
    const [group] = await store.selectMissionParticipants({
      mission_id: mission.id,
      groups: [{
        traccar_group_id: '101',
        name: 'Kerry MRT',
        member_device_ids: ['11', '12'],
      }],
      devices: [],
      selected_by: 'Coordinator A',
    })
    await completeLatestPendingCheckpoint(store, mission.id, '11')

    const databasePath = (await store.info()).database_path
    const directory = directories.at(-1)!
    await store.prepareClose()
    store.close()
    stores = stores.filter((candidate) => candidate !== store)

    const legacyDatabase = new Database(databasePath)
    const beforeDrop = legacyDatabase.prepare('PRAGMA table_info(mission_participants)').all() as {
      readonly name: string
    }[]
    expect(beforeDrop.some((column) => column.name === 'starting_member_device_ids_json')).toBe(true)
    legacyDatabase.exec('ALTER TABLE mission_participants DROP COLUMN starting_member_device_ids_json')
    const afterDrop = legacyDatabase.prepare('PRAGMA table_info(mission_participants)').all() as {
      readonly name: string
    }[]
    expect(afterDrop.some((column) => column.name === 'starting_member_device_ids_json')).toBe(false)
    legacyDatabase.close()

    const restartedStore = await reopenStore(directory)
    const migratedDatabase = new Database(databasePath, { readonly: true })
    const migratedColumns = migratedDatabase.prepare('PRAGMA table_info(mission_participants)').all() as {
      readonly name: string
    }[]
    expect(migratedColumns.some((column) => column.name === 'starting_member_device_ids_json')).toBe(true)
    migratedDatabase.close()

    const migratedGroup = (await restartedStore.listMissionParticipants(mission.id))
      .find((participant) => participant.id === group!.id)
    expect(migratedGroup).toMatchObject({
      kind: 'group',
      backfill_member_count: 2,
      backfill_completed_count: 1,
      backfill_scope_inferred: true,
    })
  })

  it('fails visibly when a stored group snapshot is malformed', async () => {
    vi.useFakeTimers()
    setClock('2026-08-20T09:00:00.000Z')
    const store = await createStore()
    const mission = await store.createMission({
      name: 'Malformed participant snapshot mission',
      start_time: missionStart,
    })
    const [group] = await store.selectMissionParticipants({
      mission_id: mission.id,
      groups: [{
        traccar_group_id: '101',
        name: 'Kerry MRT',
        member_device_ids: ['11'],
      }],
      devices: [],
      selected_by: 'Coordinator A',
    })

    const databasePath = (await store.info()).database_path
    await store.prepareClose()
    store.close()
    stores = stores.filter((candidate) => candidate !== store)
    const database = new Database(databasePath)
    database.prepare(`UPDATE mission_participants
      SET starting_member_device_ids_json = ? WHERE id = ?`)
      .run('{malformed-json', group!.id)
    database.close()

    const restartedStore = await reopenStore(directories.at(-1)!)
    await expect(restartedStore.listMissionParticipants(mission.id))
      .rejects.toThrow(/starting-member snapshot is invalid/i)
  })
})

/** Sets the deterministic wall clock used by the native store fixture. */
function setClock(timestamp: string): void {
  vi.setSystemTime(new Date(timestamp))
}

/** Completes the newest incomplete checkpoint for one participant device. */
async function completeLatestPendingCheckpoint(
  store: ParticipantStore,
  missionId: string,
  deviceId: string,
): Promise<void> {
  const checkpoint = (await store.listParticipantBackfillCheckpoints(missionId))
    .filter((candidate) => candidate.traccar_device_id === deviceId && candidate.completed === 0)
    .at(-1)
  expect(checkpoint).toBeDefined()
  await store.upsertParticipantBackfillCheckpoint({
    mission_id: missionId,
    traccar_device_id: checkpoint!.traccar_device_id,
    window_from: checkpoint!.window_from,
    window_to: checkpoint!.window_to,
    reconciled_until: checkpoint!.window_to,
    completed: true,
  })
}

/** Reopens one native mission store from its existing user-data directory. */
async function reopenStore(directory: string): Promise<ParticipantStore> {
  const store = createElectronMissionStore({ userDataPath: directory })
  stores.push(store)
  return store
}

/** Creates a disposable native mission store and registers it for teardown. */
async function createStore(): Promise<ParticipantStore> {
  const directory = await mkdtemp(path.join(tmpdir(), 'sartracker-aud08-'))
  directories.push(directory)
  const store = createElectronMissionStore({ userDataPath: directory })
  stores.push(store)
  return store
}
