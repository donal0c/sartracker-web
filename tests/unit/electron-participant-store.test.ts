import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

import { afterEach, describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')
const { createElectronMissionStore } = require('../../electron/mission-store.cjs') as {
  readonly createElectronMissionStore: (options: {
    readonly userDataPath: string
    readonly participantFaultInjection?: { readonly afterMutation?: boolean }
  }) => ElectronParticipantStore
}

type Participant = {
  readonly id: string
  readonly kind: 'device' | 'group'
  readonly provenance: 'explicit' | 'grandfathered' | 'legacy_auto'
  readonly traccar_device_id: string | null
  readonly traccar_group_id: string | null
  readonly mission_team_id: string | null
  readonly effective_from: string
  readonly removed_at: string | null
  readonly backfill_member_count?: number | null
  readonly backfill_completed_count?: number | null
}

type ElectronParticipantStore = {
  readonly close: () => void
  readonly createMission: (input: { readonly name: string; readonly start_time: string }) => Promise<{ readonly id: string }>
  readonly selectMissionParticipants: (input: unknown) => Promise<readonly Participant[]>
  readonly addMissionParticipant: (input: unknown) => Promise<Participant>
  readonly removeMissionParticipant: (input: unknown) => Promise<Participant>
  readonly listMissionParticipants: (missionId: string) => Promise<readonly Participant[]>
  readonly recordGroupMembershipEvents: (input: unknown) => Promise<readonly unknown[]>
  readonly listGroupMembershipEvents: (missionId: string, teamId?: string) => Promise<readonly {
    readonly change: string
    readonly sequence: number
  }[]>
  readonly upsertParticipantBackfillCheckpoint: (input: unknown) => Promise<unknown>
  readonly listParticipantBackfillCheckpoints: (missionId: string) => Promise<readonly {
    readonly traccar_device_id: string
    readonly window_from: string
    readonly window_to: string
    readonly reconciled_until: string
    readonly completed: number
  }[]>
  readonly listMissionEvents: (missionId: string) => Promise<readonly {
    readonly event_type: string
    readonly timestamp: string
  }[]>
  readonly upsertDevicesBulk: (input: unknown) => Promise<unknown>
  readonly finishMission: (missionId: string) => Promise<{ readonly status: string }>
}

let stores: ElectronParticipantStore[] = []
let directories: string[] = []

afterEach(async () => {
  vi.useRealTimers()
  for (const store of stores) store.close()
  stores = []
  await Promise.all(directories.map((directory) => rm(directory, { recursive: true, force: true })))
  directories = []
})

describe('Electron participant store [DON-271]', () => {
  it('selects frozen groups and devices at mission start in one audited transaction', async () => {
    const store = await createStore()
    const mission = await store.createMission({
      name: 'Participant mission',
      start_time: '2026-08-20T08:00:00.000Z',
    })

    const participants = await store.selectMissionParticipants({
      mission_id: mission.id,
      groups: [{
        traccar_group_id: '101',
        name: 'Kerry MRT',
        member_device_ids: ['11', '12'],
      }],
      devices: [{ traccar_device_id: '20' }],
      selected_by: 'Coordinator A',
    })

    expect(participants).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'group', provenance: 'explicit', traccar_group_id: '101',
        effective_from: '2026-08-20T08:00:00.000Z', removed_at: null,
      }),
      expect.objectContaining({
        kind: 'device', provenance: 'explicit', traccar_device_id: '20',
        effective_from: '2026-08-20T08:00:00.000Z', removed_at: null,
      }),
    ]))
    await expect(store.listGroupMembershipEvents(mission.id)).resolves.toHaveLength(2)
    await expect(store.listParticipantBackfillCheckpoints(mission.id)).resolves.toEqual([
      expect.objectContaining({
        traccar_device_id: '11',
        window_from: '2026-08-20T08:00:00.000Z',
        completed: 0,
      }),
      expect.objectContaining({
        traccar_device_id: '12',
        window_from: '2026-08-20T08:00:00.000Z',
        completed: 0,
      }),
    ])
    expect((await store.listMissionEvents(mission.id)).map((event) => event.event_type))
      .toContain('participants_selected')
  })

  it('reports aggregate group-member backfill progress on the selected group row', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-20T10:00:00.000Z'))
    const store = await createStore()
    const mission = await store.createMission({
      name: 'Group backfill visibility mission',
      start_time: '2026-08-20T08:00:00.000Z',
    })
    await store.selectMissionParticipants({
      mission_id: mission.id,
      groups: [{
        traccar_group_id: '101',
        name: 'Kerry MRT',
        member_device_ids: ['11', '12'],
      }],
      devices: [],
      selected_by: 'Coordinator A',
    })

    await expect(store.listMissionParticipants(mission.id)).resolves.toEqual([
      expect.objectContaining({
        kind: 'group',
        backfill_member_count: 2,
        backfill_completed_count: 0,
      }),
    ])

    await store.upsertParticipantBackfillCheckpoint({
      mission_id: mission.id,
      traccar_device_id: '11',
      window_from: '2026-08-20T08:00:00.000Z',
      window_to: '2026-08-20T10:00:00.000Z',
      reconciled_until: '2026-08-20T10:00:00.000Z',
      completed: true,
    })
    await expect(store.listMissionParticipants(mission.id)).resolves.toEqual([
      expect.objectContaining({
        backfill_member_count: 2,
        backfill_completed_count: 1,
      }),
    ])
  })

  it('rejects an initial selection that covers one device directly and through a group', async () => {
    const store = await createStore()
    const mission = await store.createMission({
      name: 'Non-duplicated participant mission',
      start_time: '2026-08-20T08:00:00.000Z',
    })

    await expect(store.selectMissionParticipants({
      mission_id: mission.id,
      groups: [{
        traccar_group_id: '101',
        name: 'Kerry MRT',
        member_device_ids: ['11'],
      }],
      devices: [{ traccar_device_id: '11' }],
      selected_by: 'Coordinator A',
    })).rejects.toThrow(/device.*group|covered.*group|select.*once/i)

    await expect(store.listMissionParticipants(mission.id)).resolves.toEqual([])
    await expect(store.listGroupMembershipEvents(mission.id)).resolves.toEqual([])
  })

  it('rejects a second active selection of the same participant', async () => {
    const store = await createStore()
    const mission = await store.createMission({
      name: 'Unique participant mission',
      start_time: '2026-08-20T08:00:00.000Z',
    })
    const selection = {
      mission_id: mission.id,
      groups: [],
      devices: [{ traccar_device_id: '20' }],
      selected_by: 'Coordinator A',
    }

    await store.selectMissionParticipants(selection)
    await expect(store.selectMissionParticipants(selection)).rejects.toThrow(/already active/i)
    await expect(store.listMissionParticipants(mission.id)).resolves.toHaveLength(1)
  })

  it('rejects adding a direct participant already covered by a selected group', async () => {
    const store = await createStore()
    const mission = await store.createMission({
      name: 'Group-covered participant mission',
      start_time: '2026-08-20T08:00:00.000Z',
    })
    await store.selectMissionParticipants({
      mission_id: mission.id,
      groups: [{
        traccar_group_id: '101', name: 'Kerry MRT', member_device_ids: ['11'],
      }],
      devices: [],
      selected_by: 'Coordinator A',
    })

    await expect(store.addMissionParticipant({
      mission_id: mission.id,
      kind: 'device',
      ref: '11',
      confirmed_by: 'Coordinator A',
    })).rejects.toThrow(/active.*group|covered.*group/i)
    await expect(store.listMissionParticipants(mission.id)).resolves.toHaveLength(1)
  })

  it('rejects adding a group that currently covers an active direct participant', async () => {
    const store = await createStore()
    const mission = await store.createMission({
      name: 'Direct-before-group participant mission',
      start_time: '2026-08-20T08:00:00.000Z',
    })
    await store.selectMissionParticipants({
      mission_id: mission.id,
      groups: [],
      devices: [{ traccar_device_id: '11' }],
      selected_by: 'Coordinator A',
    })

    await expect(store.addMissionParticipant({
      mission_id: mission.id,
      kind: 'group',
      ref: {
        traccar_group_id: '101',
        name: 'Kerry MRT',
        member_device_ids: ['11'],
      },
      confirmed_by: 'Coordinator A',
    })).rejects.toThrow(/covers.*active.*individual|individual.*active.*group/i)
    await expect(store.listMissionParticipants(mission.id)).resolves.toHaveLength(1)
    await expect(store.listGroupMembershipEvents(mission.id)).resolves.toEqual([])
  })

  it('records the observation-time roster when a later group selection is unique', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-20T11:00:00.000Z'))
    const store = await createStore()
    const mission = await store.createMission({
      name: 'Later group roster mission',
      start_time: '2026-08-20T08:00:00.000Z',
    })

    const added = await store.addMissionParticipant({
      mission_id: mission.id,
      kind: 'group',
      ref: {
        traccar_group_id: '101',
        name: 'Kerry MRT',
        member_device_ids: ['11'],
      },
      effective_from: '2026-08-20T09:00:00.000Z',
      confirmed_by: 'Coordinator A',
    })

    await expect(store.listGroupMembershipEvents(mission.id)).resolves.toEqual([
      expect.objectContaining({
        mission_team_id: added.mission_team_id,
        traccar_device_id: '11',
        change: 'member',
        observed_at: added.added_at,
      }),
    ])
    await expect(store.listParticipantBackfillCheckpoints(mission.id)).resolves.toEqual([
      expect.objectContaining({
        traccar_device_id: '11',
        window_from: '2026-08-20T09:00:00.000Z',
        window_to: '2026-08-20T11:00:00.000Z',
        reconciled_until: '2026-08-20T09:00:00.000Z',
        completed: 0,
      }),
    ])
  })

  it('closes windows append-only and creates a new row when re-added', async () => {
    const store = await createStore()
    const mission = await store.createMission({
      name: 'Window mission',
      start_time: '2026-08-20T08:00:00.000Z',
    })
    const added = await store.addMissionParticipant({
      mission_id: mission.id,
      kind: 'device',
      ref: '20',
      effective_from: '2026-08-20T09:00:00.000Z',
      confirmed_by: 'Coordinator A',
    })
    const removed = await store.removeMissionParticipant({
      mission_id: mission.id,
      participant_id: added.id,
      removed_by: 'Coordinator A',
      reason: 'Team stood down',
    })
    const readded = await store.addMissionParticipant({
      mission_id: mission.id,
      kind: 'device',
      ref: '20',
      effective_from: '2026-08-20T10:00:00.000Z',
      confirmed_by: 'Coordinator A',
    })

    expect(removed.removed_at).not.toBeNull()
    expect(readded.id).not.toBe(added.id)
    await expect(store.listMissionParticipants(mission.id)).resolves.toHaveLength(2)
  })

  it('rejects participant, membership, and checkpoint writes as soon as a mission is finished', async () => {
    const store = await createStore()
    const mission = await store.createMission({
      name: 'Finished participant fence mission',
      start_time: '2026-08-20T08:00:00.000Z',
    })
    const [participant] = await store.selectMissionParticipants({
      mission_id: mission.id,
      groups: [],
      devices: [{ traccar_device_id: '20' }],
      selected_by: 'Coordinator A',
    })
    await store.finishMission(mission.id)

    await expect(store.addMissionParticipant({
      mission_id: mission.id,
      kind: 'device',
      ref: '21',
      confirmed_by: 'Coordinator A',
    })).rejects.toThrow(/finished.*read-only|finished mission/i)
    await expect(store.removeMissionParticipant({
      mission_id: mission.id,
      participant_id: participant!.id,
      removed_by: 'Coordinator A',
    })).rejects.toThrow(/finished.*read-only|finished mission/i)
    await expect(store.recordGroupMembershipEvents({
      mission_id: mission.id,
      events: [],
    })).rejects.toThrow(/finished.*read-only|finished mission/i)
    await expect(store.upsertParticipantBackfillCheckpoint({
      mission_id: mission.id,
      traccar_device_id: '20',
      window_from: '2026-08-20T08:00:00.000Z',
      window_to: '2026-08-20T09:00:00.000Z',
      reconciled_until: '2026-08-20T08:00:00.000Z',
      completed: false,
    })).rejects.toThrow(/finished.*read-only|finished mission/i)
  })

  it('change-gates append-only group membership observations', async () => {
    const store = await createStore()
    const mission = await store.createMission({
      name: 'Membership mission',
      start_time: '2026-08-20T08:00:00.000Z',
    })
    const [group] = await store.selectMissionParticipants({
      mission_id: mission.id,
      groups: [{ traccar_group_id: '101', name: 'Kerry MRT', member_device_ids: [] }],
      devices: [],
      selected_by: 'Coordinator A',
    })
    const event = {
      mission_team_id: group.mission_team_id,
      traccar_device_id: '11',
      change: 'member',
      observed_at: '2026-08-20T09:00:00.000Z',
    }

    await store.recordGroupMembershipEvents({ mission_id: mission.id, events: [event] })
    await store.recordGroupMembershipEvents({ mission_id: mission.id, events: [event] })
    await store.recordGroupMembershipEvents({
      mission_id: mission.id,
      events: [{ ...event, change: 'left', observed_at: '2026-08-20T10:00:00.000Z' }],
    })

    await expect(store.listGroupMembershipEvents(mission.id, group.mission_team_id ?? undefined)).resolves.toMatchObject([
      { change: 'member' },
      { change: 'left' },
    ])
  })

  it('keeps late-add backfill window edges immutable while advancing its cursor', async () => {
    const store = await createStore()
    const mission = await store.createMission({
      name: 'Backfill mission',
      start_time: '2026-08-20T08:00:00.000Z',
    })
    const initial = {
      mission_id: mission.id,
      traccar_device_id: '20',
      window_from: '2026-08-20T09:00:00.000Z',
      window_to: '2026-08-20T11:00:00.000Z',
      reconciled_until: '2026-08-20T09:00:00.000Z',
      completed: false,
    }
    await store.upsertParticipantBackfillCheckpoint(initial)
    await store.upsertParticipantBackfillCheckpoint({
      ...initial,
      reconciled_until: '2026-08-20T11:00:00.000Z',
      completed: true,
    })
    await expect(store.upsertParticipantBackfillCheckpoint({
      ...initial,
      window_to: '2026-08-20T12:00:00.000Z',
    })).rejects.toThrow(/window.*immutable/i)

    await expect(store.listParticipantBackfillCheckpoints(mission.id)).resolves.toEqual([
      expect.objectContaining({ completed: 1, reconciled_until: '2026-08-20T11:00:00.000Z' }),
    ])
  })

  it('enforces monotonic and irreversible participant backfill truth', async () => {
    const store = await createStore()
    const mission = await store.createMission({
      name: 'Monotonic backfill mission',
      start_time: '2026-08-20T08:00:00.000Z',
    })
    const checkpoint = {
      mission_id: mission.id,
      traccar_device_id: '20',
      window_from: '2026-08-20T09:00:00.000Z',
      window_to: '2026-08-20T11:00:00.000Z',
      reconciled_until: '2026-08-20T09:00:00.000Z',
      completed: false,
    }
    await store.upsertParticipantBackfillCheckpoint(checkpoint)

    await expect(store.upsertParticipantBackfillCheckpoint({
      ...checkpoint,
      reconciled_until: '2026-08-20T09:30:00.000Z',
      completed: true,
    })).rejects.toThrow(/complete.*window end|completed.*window end/i)
    await store.upsertParticipantBackfillCheckpoint({
      ...checkpoint,
      reconciled_until: '2026-08-20T10:00:00.000Z',
    })
    await expect(store.upsertParticipantBackfillCheckpoint(checkpoint))
      .rejects.toThrow(/cursor.*decrease|backfill.*rewind/i)
    await store.upsertParticipantBackfillCheckpoint({
      ...checkpoint,
      reconciled_until: checkpoint.window_to,
      completed: true,
    })
    await expect(store.upsertParticipantBackfillCheckpoint({
      ...checkpoint,
      reconciled_until: '2026-08-20T10:00:00.000Z',
      completed: false,
    })).rejects.toThrow(/completion.*irreversible|completed.*irreversible/i)

    expect((await store.listMissionEvents(mission.id)).filter((event) =>
      event.event_type === 'participant_backfill_completed')).toHaveLength(1)
  })

  it('rolls back checkpoint completion when its required audit append fails', async () => {
    const store = await createStore()
    const mission = await store.createMission({
      name: 'Atomic backfill completion mission',
      start_time: '2026-08-20T08:00:00.000Z',
    })
    const checkpoint = {
      mission_id: mission.id,
      traccar_device_id: '20',
      window_from: '2026-08-20T09:00:00.000Z',
      window_to: '2026-08-20T11:00:00.000Z',
      reconciled_until: '2026-08-20T09:00:00.000Z',
      completed: false,
    }
    await store.upsertParticipantBackfillCheckpoint(checkpoint)
    const database = new Database(path.join(directories.at(-1)!, 'mission-store.sqlite'))
    database.exec(`CREATE TRIGGER reject_backfill_completion_audit
      BEFORE INSERT ON mission_events
      WHEN NEW.event_type = 'participant_backfill_completed'
      BEGIN SELECT RAISE(FAIL, 'injected completion audit failure'); END;`)

    await expect(store.upsertParticipantBackfillCheckpoint({
      ...checkpoint,
      reconciled_until: checkpoint.window_to,
      completed: true,
    })).rejects.toThrow(/injected completion audit failure/i)

    await expect(store.listParticipantBackfillCheckpoints(mission.id)).resolves.toEqual([
      expect.objectContaining({ completed: 0, reconciled_until: checkpoint.window_from }),
    ])
    expect((await store.listMissionEvents(mission.id)).map((event) => event.event_type))
      .not.toContain('participant_backfill_completed')
    database.close()
  })

  it('rolls back selection and its audit event on an injected failure', async () => {
    const store = await createStore({ failAfterMutation: true })
    const mission = await store.createMission({
      name: 'Rollback mission',
      start_time: '2026-08-20T08:00:00.000Z',
    })

    await expect(store.selectMissionParticipants({
      mission_id: mission.id,
      groups: [],
      devices: [{ traccar_device_id: '20' }],
      selected_by: 'Coordinator A',
    })).rejects.toThrow(/Injected participant transaction failure/u)
    await expect(store.listMissionParticipants(mission.id)).resolves.toEqual([])
    expect((await store.listMissionEvents(mission.id)).map((event) => event.event_type))
      .not.toContain('participants_selected')
  })

  it('repairs candidate-v9 membership rows with deterministic append sequence', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-20T09:00:00.000Z'))
    let store = await createStore()
    const mission = await store.createMission({
      name: 'Candidate v9 membership repair mission',
      start_time: '2026-08-20T08:00:00.000Z',
    })
    const participants = await store.selectMissionParticipants({
      mission_id: mission.id,
      groups: [{
        traccar_group_id: '101', name: 'Kerry MRT', member_device_ids: ['11'],
      }],
      devices: [],
      selected_by: 'Coordinator A',
    })
    const teamId = participants[0]?.mission_team_id
    store.close()
    stores = stores.filter((candidate) => candidate !== store)

    const databasePath = path.join(directories.at(-1)!, 'mission-store.sqlite')
    const database = new Database(databasePath)
    database.exec(`
      DROP INDEX idx_group_membership_sequence;
      DROP INDEX idx_group_membership_mission_team;
      ALTER TABLE mission_group_membership_events DROP COLUMN sequence;
      CREATE INDEX idx_group_membership_mission_team
        ON mission_group_membership_events(mission_id, mission_team_id, observed_at);
    `)
    database.close()

    store = createElectronMissionStore({ userDataPath: directories.at(-1)! })
    stores.push(store)
    await expect(store.listGroupMembershipEvents(mission.id)).resolves.toEqual([
      expect.objectContaining({ traccar_device_id: '11', sequence: 1 }),
    ])
    await store.recordGroupMembershipEvents({
      mission_id: mission.id,
      events: [{
        mission_team_id: teamId,
        traccar_device_id: '11',
        change: 'left',
        observed_at: '2026-08-20T09:00:00.000Z',
      }],
    })
    await expect(store.listGroupMembershipEvents(mission.id)).resolves.toEqual([
      expect.objectContaining({ change: 'member', sequence: 1 }),
      expect.objectContaining({ change: 'left', sequence: 2 }),
    ])
  })

  it('records flag-off first-contact devices as legacy_auto in the same bulk write', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-20T10:00:00.000Z'))
    const store = await createStore()
    const mission = await store.createMission({
      name: 'Legacy flag-off mission',
      start_time: '2026-08-20T08:00:00.000Z',
    })
    await store.upsertDevicesBulk({
      mission_id: mission.id,
      participant_provenance: 'legacy_auto',
      devices: [{
        device_id: '31', name: 'Legacy Alpha', color: '#fff', status: 'online',
        last_seen: '2026-08-20T09:00:00.000Z', group_id: '101', unique_id: 'alpha-31',
      }],
    })
    await store.upsertDevicesBulk({
      mission_id: mission.id,
      participant_provenance: 'legacy_auto',
      devices: [{
        device_id: '31', name: 'Legacy Alpha', color: '#fff', status: 'online',
        last_seen: '2026-08-20T09:01:00.000Z', group_id: '101', unique_id: 'alpha-31',
      }],
    })

    await expect(store.listMissionParticipants(mission.id)).resolves.toEqual([
      expect.objectContaining({
        traccar_device_id: '31', provenance: 'legacy_auto',
        effective_from: '2026-08-20T10:00:00.000Z',
      }),
    ])
    expect((await store.listMissionEvents(mission.id)).filter((event) =>
      event.event_type === 'device_created' || event.event_type === 'participant_added'))
      .toEqual([
        expect.objectContaining({ event_type: 'participant_added', timestamp: '2026-08-20T10:00:00.000Z' }),
        expect.objectContaining({ event_type: 'device_created', timestamp: '2026-08-20T10:00:00.000Z' }),
      ])
  })
})

async function createStore(options: { readonly failAfterMutation?: boolean } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'sartracker-participants-'))
  directories.push(directory)
  const store = createElectronMissionStore({
    userDataPath: directory,
    ...(options.failAfterMutation === true
      ? { participantFaultInjection: { afterMutation: true } }
      : {}),
  })
  stores.push(store)
  return store
}
