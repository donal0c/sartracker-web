import { describe, expect, it, vi } from 'vitest'

import { startParticipantRuntime } from '../../src/features/participants/start-participant-runtime'
import type {
  GroupMembershipEvent,
  MissionParticipant,
} from '../../src/infrastructure/mission-store/tauri-mission-store'

const GROUP_PARTICIPANT: MissionParticipant = {
  id: 'participant-group',
  mission_id: 'mission-1',
  kind: 'group',
  traccar_device_id: null,
  mission_team_id: 'team-1',
  traccar_group_id: 'group-1',
  team_name: 'Hill Team',
  provenance: 'explicit',
  effective_from: '2026-08-23T10:00:00.000Z',
  added_at: '2026-08-23T10:00:00.000Z',
  added_by: 'Coordinator',
  removed_at: null,
  removed_by: null,
}

const INITIAL_MEMBERSHIP: GroupMembershipEvent = {
  id: 'membership-1',
  sequence: 1,
  mission_id: 'mission-1',
  mission_team_id: 'team-1',
  traccar_device_id: 'device-1',
  change: 'member',
  observed_at: '2026-08-23T10:00:00.000Z',
}

describe('startParticipantRuntime [DON-271]', () => {
  it('hydrates one immutable participation scope for current and history filtering', async () => {
    const states: Array<{ readonly scope: { includesAt: (id: string, at: string) => boolean } }> = []
    const runtime = await startParticipantRuntime({
      participantStore: createStore(),
      applyRuntime: (state) => states.push(state),
      now: () => new Date('2026-08-23T11:00:00.000Z'),
    })

    await runtime.refreshMission('mission-1')

    const state = states.at(-1)
    expect(state?.scope.includesAt('device-1', '2026-08-23T10:30:00.000Z')).toBe(true)
    expect(state?.scope.includesAt('device-2', '2026-08-23T10:30:00.000Z')).toBe(false)
  })

  it('records later server-side group changes at observation time without retrospective membership', async () => {
    const store = createStore()
    const runtime = await startParticipantRuntime({
      participantStore: store,
      applyRuntime: vi.fn(),
      now: () => new Date('2026-08-23T11:00:00.000Z'),
    })
    await runtime.refreshMission('mission-1')

    await runtime.applyRoster([
      device('device-2', 'group-1'),
    ], '2026-08-23T11:00:00.000Z')

    expect(store.recordGroupMembershipEvents).toHaveBeenCalledWith({
      mission_id: 'mission-1',
      events: [
        {
          mission_team_id: 'team-1',
          traccar_device_id: 'device-1',
          change: 'left',
          observed_at: '2026-08-23T11:00:00.000Z',
        },
        {
          mission_team_id: 'team-1',
          traccar_device_id: 'device-2',
          change: 'member',
          observed_at: '2026-08-23T11:00:00.000Z',
        },
      ],
    })
  })

  it('suppresses negative group deltas from an incomplete normalized roster', async () => {
    const store = createStore()
    const runtime = await startParticipantRuntime({
      participantStore: store,
      applyRuntime: vi.fn(),
      now: () => new Date('2026-08-23T11:00:00.000Z'),
    })
    await runtime.refreshMission('mission-1')

    await runtime.applyRoster([
      device('device-2', 'group-1'),
    ], '2026-08-23T11:00:00.000Z', { complete: false })

    expect(store.recordGroupMembershipEvents).toHaveBeenCalledWith({
      mission_id: 'mission-1',
      events: [{
        mission_team_id: 'team-1',
        traccar_device_id: 'device-2',
        change: 'member',
        observed_at: '2026-08-23T11:00:00.000Z',
      }],
    })
  })

  it('reconciles deferred group leaves when the same roster becomes complete', async () => {
    const store = createStore()
    const runtime = await startParticipantRuntime({
      participantStore: store,
      applyRuntime: vi.fn(),
    })
    await runtime.refreshMission('mission-1')
    const acceptedRoster = [device('device-2', 'group-1')]

    await runtime.applyRoster(
      acceptedRoster,
      '2026-08-23T11:00:00.000Z',
      { complete: false },
    )
    await runtime.applyRoster(
      acceptedRoster,
      '2026-08-23T11:01:00.000Z',
      { complete: true },
    )

    expect(store.recordGroupMembershipEvents).toHaveBeenNthCalledWith(2, {
      mission_id: 'mission-1',
      events: [{
        mission_team_id: 'team-1',
        traccar_device_id: 'device-1',
        change: 'left',
        observed_at: '2026-08-23T11:01:00.000Z',
      }],
    })
  })

  it('retries failed participant hydration on the next roster observation', async () => {
    const store = createStore()
    store.listMissionParticipants
      .mockRejectedValueOnce(new Error('temporary participant read failure'))
      .mockResolvedValue([GROUP_PARTICIPANT])
    const states: Array<{ readonly error: string | null }> = []
    const runtime = await startParticipantRuntime({
      participantStore: store,
      applyRuntime: (state) => states.push(state),
    })

    await runtime.refreshMission('mission-1')
    expect(states.at(-1)?.error).toMatch(/temporary participant read failure/i)
    await runtime.applyRoster([device('device-1', 'group-1')])

    expect(store.listMissionParticipants).toHaveBeenCalledTimes(2)
    expect(states.at(-1)?.error).toBeNull()
  })

  it('selects the start roster with group membership frozen from the observed roster', async () => {
    const store = createStore()
    const runtime = await startParticipantRuntime({
      participantStore: store,
      applyRuntime: vi.fn(),
    })
    runtime.applyGroups([{ group_id: 'group-1', name: 'Hill Team', parent_group_id: null }])
    await runtime.applyRoster([
      device('device-1', 'group-1'),
      device('device-2', null),
    ], '2026-08-23T10:00:00.000Z')
    runtime.toggleDraftGroup('group-1')
    runtime.toggleDraftDevice('device-2')

    await runtime.selectInitialParticipants('mission-1', 'Coordinator')

    expect(store.selectMissionParticipants).toHaveBeenCalledWith({
      mission_id: 'mission-1',
      groups: [{
        traccar_group_id: 'group-1',
        name: 'Hill Team',
        member_device_ids: ['device-1'],
      }],
      devices: [{ traccar_device_id: 'device-2' }],
      selected_by: 'Coordinator',
    })
  })

  it('propagates an initial participant write failure and preserves the operator draft', async () => {
    const store = createStore()
    store.selectMissionParticipants.mockRejectedValueOnce(new Error('participant write failed'))
    const states: Array<{ readonly draftDeviceIds: readonly string[]; readonly error: string | null }> = []
    const runtime = await startParticipantRuntime({
      participantStore: store,
      applyRuntime: (state) => states.push(state),
    })
    await runtime.applyRoster([device('device-2', null)])
    runtime.toggleDraftDevice('device-2')

    await expect(runtime.selectInitialParticipants('mission-1', 'Coordinator'))
      .rejects.toThrow(/participant write failed/i)

    expect(states.at(-1)).toMatchObject({
      draftDeviceIds: ['device-2'],
      error: 'participant write failed',
    })
  })

  it('removes a direct draft selection when its group becomes selected', async () => {
    const store = createStore()
    const runtime = await startParticipantRuntime({
      participantStore: store,
      applyRuntime: vi.fn(),
    })
    runtime.applyGroups([{ group_id: 'group-1', name: 'Hill Team', parent_group_id: null }])
    await runtime.applyRoster([device('device-1', 'group-1')])
    runtime.toggleDraftDevice('device-1')
    runtime.toggleDraftGroup('group-1')

    await runtime.selectInitialParticipants('mission-1', 'Coordinator')

    expect(store.selectMissionParticipants).toHaveBeenCalledWith(expect.objectContaining({
      devices: [],
      groups: [expect.objectContaining({ member_device_ids: ['device-1'] })],
    }))
  })

  it('passes the observed group roster into a later group-add duplicate check', async () => {
    const store = createStore({
      participants: [{
        ...GROUP_PARTICIPANT,
        id: 'participant-device',
        kind: 'device',
        mission_team_id: null,
        traccar_group_id: null,
        team_name: null,
        traccar_device_id: 'device-1',
      }],
      membershipEvents: [],
    })
    store.addMissionParticipant.mockRejectedValueOnce(
      new Error('Participant group already covers an active individual device.'),
    )
    const runtime = await startParticipantRuntime({
      participantStore: store,
      applyRuntime: vi.fn(),
    })
    await runtime.refreshMission('mission-1')
    await runtime.applyRoster([device('device-1', 'group-1')])

    const result = await runtime.addParticipant({
      kind: 'group',
      ref: { traccar_group_id: 'group-1', name: 'Hill Team' },
      confirmed_by: 'Coordinator',
    })

    expect(result).toBeNull()
    expect(store.addMissionParticipant).toHaveBeenCalledWith(expect.objectContaining({
      mission_id: 'mission-1',
      kind: 'group',
      ref: {
        traccar_group_id: 'group-1',
        name: 'Hill Team',
        member_device_ids: ['device-1'],
      },
    }))
  })

  it('does not republish a semantically unchanged discovery roster [DON-271]', async () => {
    const applyRuntime = vi.fn()
    const runtime = await startParticipantRuntime({
      participantStore: createStore({ participants: [], membershipEvents: [] }),
      applyRuntime,
    })
    const roster = [device('device-1', 'group-1'), device('device-2', null)]

    await runtime.applyRoster(roster)
    expect(applyRuntime).toHaveBeenCalledTimes(2)

    await runtime.applyRoster(roster.map((entry) => ({ ...entry })))
    expect(applyRuntime).toHaveBeenCalledTimes(2)
  })

  it('warns beyond 100 selected devices without truncating the active scope', async () => {
    const store = createStore({
      participants: Array.from({ length: 101 }, (_, index) => ({
        ...GROUP_PARTICIPANT,
        id: `participant-${index}`,
        kind: 'device' as const,
        mission_team_id: null,
        traccar_group_id: null,
        team_name: null,
        traccar_device_id: `device-${index}`,
      })),
      membershipEvents: [],
    })
    const states: Array<{ readonly envelope: { readonly activeDeviceCount: number; readonly warning: string | null } }> = []
    const runtime = await startParticipantRuntime({
      participantStore: store,
      applyRuntime: (state) => states.push(state),
      now: () => new Date('2026-08-23T11:00:00.000Z'),
    })

    await runtime.refreshMission('mission-1')

    expect(states.at(-1)?.envelope.activeDeviceCount).toBe(101)
    expect(states.at(-1)?.envelope.warning).toContain('all selected devices will still be included')
  })

  it('does not let a completed mutation for mission A replace mission B scope', async () => {
    const mutation = createDeferred<MissionParticipant>()
    const store = createStore({ participants: [], membershipEvents: [] })
    store.addMissionParticipant.mockReturnValueOnce(mutation.promise)
    store.listMissionParticipants.mockImplementation(async (missionId: string) =>
      missionId === 'mission-b'
        ? [{ ...GROUP_PARTICIPANT, id: 'participant-b', mission_id: 'mission-b' }]
        : [])
    const states: Array<{
      readonly activeMissionId: string | null
      readonly participants: readonly MissionParticipant[]
    }> = []
    const runtime = await startParticipantRuntime({
      participantStore: store,
      applyRuntime: (state) => states.push(state),
    })
    await runtime.refreshMission('mission-a')
    const pending = runtime.addParticipant({
      kind: 'device', ref: 'device-a', confirmed_by: 'Coordinator',
    })
    await runtime.refreshMission('mission-b')

    mutation.resolve({
      ...GROUP_PARTICIPANT,
      id: 'participant-a', mission_id: 'mission-a', kind: 'device',
      mission_team_id: null, traccar_group_id: null, team_name: null,
      traccar_device_id: 'device-a',
    })
    await pending

    expect(states.at(-1)?.activeMissionId).toBe('mission-b')
    expect(states.at(-1)?.participants).toEqual([
      expect.objectContaining({ id: 'participant-b', mission_id: 'mission-b' }),
    ])
  })
})

function device(deviceId: string, groupId: string | null) {
  return {
    device_id: deviceId,
    name: deviceId,
    status: 'online' as const,
    last_seen: '2026-08-23T11:00:00.000Z',
    unique_id: `unique-${deviceId}`,
    category: null,
    group_id: groupId,
  }
}

function createStore(overrides: {
  readonly participants?: readonly MissionParticipant[]
  readonly membershipEvents?: readonly GroupMembershipEvent[]
} = {}) {
  const participants = overrides.participants ?? [GROUP_PARTICIPANT]
  const membershipEvents = overrides.membershipEvents ?? [INITIAL_MEMBERSHIP]
  return {
    selectMissionParticipants: vi.fn().mockResolvedValue(participants),
    addMissionParticipant: vi.fn(),
    removeMissionParticipant: vi.fn(),
    listMissionParticipants: vi.fn().mockResolvedValue(participants),
    recordGroupMembershipEvents: vi.fn().mockImplementation(async (input) =>
      input.events.map((
        event: Omit<GroupMembershipEvent, 'id' | 'sequence' | 'mission_id'>,
        index: number,
      ) => ({
        ...event,
        id: `new-${index}`,
        sequence: membershipEvents.length + index + 1,
        mission_id: 'mission-1',
      }))),
    listGroupMembershipEvents: vi.fn().mockResolvedValue(membershipEvents),
    listParticipantBackfillCheckpoints: vi.fn().mockResolvedValue([]),
  }
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}
