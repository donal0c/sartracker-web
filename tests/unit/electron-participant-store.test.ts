import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
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
}

type ElectronParticipantStore = {
  readonly close: () => void
  readonly createMission: (input: { readonly name: string; readonly start_time: string }) => Promise<{ readonly id: string }>
  readonly selectMissionParticipants: (input: unknown) => Promise<readonly Participant[]>
  readonly addMissionParticipant: (input: unknown) => Promise<Participant>
  readonly removeMissionParticipant: (input: unknown) => Promise<Participant>
  readonly listMissionParticipants: (missionId: string) => Promise<readonly Participant[]>
  readonly recordGroupMembershipEvents: (input: unknown) => Promise<readonly unknown[]>
  readonly listGroupMembershipEvents: (missionId: string, teamId?: string) => Promise<readonly { readonly change: string }[]>
  readonly upsertParticipantBackfillCheckpoint: (input: unknown) => Promise<unknown>
  readonly listParticipantBackfillCheckpoints: (missionId: string) => Promise<readonly unknown[]>
  readonly listMissionEvents: (missionId: string) => Promise<readonly { readonly event_type: string }[]>
  readonly upsertDevicesBulk: (input: unknown) => Promise<unknown>
}

let stores: ElectronParticipantStore[] = []
let directories: string[] = []

afterEach(async () => {
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
    expect((await store.listMissionEvents(mission.id)).map((event) => event.event_type))
      .toContain('participants_selected')
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

  it('records flag-off first-contact devices as legacy_auto in the same bulk write', async () => {
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
        effective_from: '2026-08-20T09:00:00.000Z',
      }),
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
