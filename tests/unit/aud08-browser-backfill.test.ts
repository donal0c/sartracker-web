import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  getBrowserHarnessStore,
  readBrowserHarnessState,
  resetBrowserHarnessStore,
} from '../../src/features/browser-validation/browser-harness-store'
import { evaluateParticipantBackfill } from '../../shared/participant-backfill-completeness.mjs'

const missionStart = '2026-08-20T08:00:00.000Z'
const harnessStorageKey = 'sartracker:browser-harness'

describe('AUD-08 browser participant backfill completeness [DON-271]', () => {
  beforeEach(() => {
    resetBrowserHarnessStore()
  })

  afterEach(() => {
    vi.useRealTimers()
    resetBrowserHarnessStore()
  })

  it('rejects an omitted initial group roster like the native participant store', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-20T09:00:00.000Z'))
    const store = getBrowserHarnessStore()
    const mission = await store.createMission({
      name: 'Browser missing initial roster mission',
      start_time: missionStart,
    })

    await expect(store.selectMissionParticipants({
      mission_id: mission.id,
      groups: [{
        traccar_group_id: '101',
        name: 'Kerry MRT',
      } as never],
      devices: [],
      selected_by: 'Coordinator A',
    })).rejects.toThrow(/current group member device ids are required/i)
  })

  it('accepts an explicit empty initial roster as known-empty and finishable', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-20T09:00:00.000Z'))
    const store = getBrowserHarnessStore()
    const mission = await store.createMission({
      name: 'Browser explicit empty initial roster mission',
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
    vi.setSystemTime(new Date('2026-08-20T09:00:00.000Z'))
    const store = getBrowserHarnessStore()
    const mission = await store.createMission({
      name: 'Browser unknown legacy group scope mission',
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
    replaceHarnessState((state) => {
      state.missionParticipants = state.missionParticipants.map((participant) =>
        participant.id === group!.id
          ? { ...participant, starting_member_device_ids_json: null }
          : participant)
    })

    const restartedStore = getBrowserHarnessStore()
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
    vi.setSystemTime(new Date('2026-08-20T09:00:00.000Z'))
    const store = getBrowserHarnessStore()
    const mission = await store.createMission({
      name: 'Browser legacy pre-insertion left-only scope mission',
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
        mission_team_id: group!.mission_team_id!,
        traccar_device_id: '11',
        change: 'left',
        observed_at: '2026-08-20T08:30:00.000Z',
      }],
    })
    replaceHarnessState((state) => {
      state.missionParticipants = state.missionParticipants.map((participant) =>
        participant.id === group!.id
          ? { ...participant, starting_member_device_ids_json: null }
          : participant)
    })

    const restartedStore = getBrowserHarnessStore()
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

  it('rejects browser checkpoint windows before mission start like native validation', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-20T09:00:00.000Z'))
    const store = getBrowserHarnessStore()
    const mission = await store.createMission({
      name: 'Browser checkpoint mission boundary parity mission',
      start_time: missionStart,
    })
    await store.selectMissionParticipants({
      mission_id: mission.id,
      groups: [],
      devices: [{ traccar_device_id: '11' }],
      selected_by: 'Coordinator A',
    })

    await expect(store.upsertParticipantBackfillCheckpoint({
      mission_id: mission.id,
      traccar_device_id: '11',
      window_from: '2026-08-20T07:00:00.000Z',
      window_to: '2026-08-20T09:00:00.000Z',
      reconciled_until: '2026-08-20T07:00:00.000Z',
      completed: false,
    })).rejects.toThrow(/outside the mission boundary/i)
  })

  it('rejects browser completed checkpoint cursors beyond their fixed window', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-20T09:00:00.000Z'))
    const store = getBrowserHarnessStore()
    const mission = await store.createMission({
      name: 'Browser checkpoint cursor parity mission',
      start_time: missionStart,
    })
    await store.selectMissionParticipants({
      mission_id: mission.id,
      groups: [],
      devices: [{ traccar_device_id: '11' }],
      selected_by: 'Coordinator A',
    })

    await expect(store.upsertParticipantBackfillCheckpoint({
      mission_id: mission.id,
      traccar_device_id: '11',
      window_from: missionStart,
      window_to: '2026-08-20T09:00:00.000Z',
      reconciled_until: '2026-08-20T10:00:00.000Z',
      completed: true,
    })).rejects.toThrow(/cursor must stay inside its fixed window/i)
  })

  it('refuses finish when a snapshot member has no checkpoint row', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-20T09:00:00.000Z'))
    const store = getBrowserHarnessStore()
    const mission = await store.createMission({
      name: 'Browser missing member checkpoint mission',
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
    replaceHarnessState((state) => {
      state.participantBackfillCheckpoints = state.participantBackfillCheckpoints
        .filter((checkpoint) => checkpoint.traccar_device_id !== '12')
    })

    const restartedStore = getBrowserHarnessStore()
    const currentGroup = (await restartedStore.listMissionParticipants(mission.id))
      .find((participant) => participant.id === group!.id)
    expect(currentGroup).toMatchObject({
      backfill_member_count: 2,
      backfill_completed_count: 1,
    })
    await expect(restartedStore.finishMission(mission.id)).rejects.toThrow(
      /history backfill.*incomplete|incomplete.*history backfill|participant.*checkpoint|unknown.*scope/i,
    )
  })

  it('refuses finish when completed checkpoint windows leave an interior gap', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-20T11:00:00.000Z'))
    const store = getBrowserHarnessStore()
    const mission = await store.createMission({
      name: 'Browser interior checkpoint gap mission',
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
    replaceHarnessState((state) => {
      state.participantBackfillCheckpoints = [
        ...state.participantBackfillCheckpoints.filter((checkpoint) =>
          checkpoint.traccar_device_id !== '11'),
        {
          mission_id: mission.id,
          traccar_device_id: '11',
          window_from: missionStart,
          window_to: '2026-08-20T09:00:00.000Z',
          reconciled_until: '2026-08-20T09:00:00.000Z',
          completed: 1,
          updated_at: '2026-08-20T11:00:00.000Z',
        },
        {
          mission_id: mission.id,
          traccar_device_id: '11',
          window_from: '2026-08-20T10:00:00.000Z',
          window_to: '2026-08-20T11:00:00.000Z',
          reconciled_until: '2026-08-20T11:00:00.000Z',
          completed: 1,
          updated_at: '2026-08-20T11:00:00.000Z',
        },
      ]
    })

    const restartedStore = getBrowserHarnessStore()
    const currentGroup = (await restartedStore.listMissionParticipants(mission.id))
      .find((participant) => participant.id === group!.id)
    expect(currentGroup).toMatchObject({
      backfill_member_count: 1,
      backfill_completed_count: 0,
    })
    await expect(restartedStore.finishMission(mission.id)).rejects.toThrow(
      /history backfill.*incomplete|incomplete.*history backfill|participant.*checkpoint|unknown.*scope/i,
    )
  })

  it('retains a same-boundary legacy member when sequence history ends in left', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-20T09:00:00.000Z'))
    const store = getBrowserHarnessStore()
    const mission = await store.createMission({
      name: 'Browser legacy same-boundary member mission',
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
        mission_team_id: group!.mission_team_id!,
        traccar_device_id: '11',
        change: 'left',
        observed_at: '2026-08-20T09:00:00.000Z',
      }],
    })
    replaceHarnessState((state) => {
      state.missionParticipants = state.missionParticipants.map((participant) =>
        participant.id === group!.id
          ? { ...participant, starting_member_device_ids_json: null }
          : participant)
      state.participantBackfillCheckpoints = state.participantBackfillCheckpoints
        .filter((checkpoint) => checkpoint.traccar_device_id !== '11')
    })

    const restartedStore = getBrowserHarnessStore()
    const currentGroup = (await restartedStore.listMissionParticipants(mission.id))
      .find((participant) => participant.id === group!.id)
    expect(currentGroup).toMatchObject({
      backfill_member_count: 1,
      backfill_completed_count: 0,
      backfill_scope_inferred: true,
    })
    await expect(restartedStore.finishMission(mission.id)).rejects.toThrow(
      /history backfill.*incomplete|incomplete.*history backfill|participant.*checkpoint|unknown.*scope/i,
    )
  })

  it('accepts adjacent and superset completed windows as full coverage', () => {
    const participant = {
      missionId: 'mission-coverage',
      kind: 'group' as const,
      teamId: 'team-coverage',
      effectiveFrom: missionStart,
      addedAt: '2026-08-20T11:00:00.000Z',
      startingMemberDeviceIdsJson: '["11"]',
    }
    const adjacent = evaluateParticipantBackfill({
      participant,
      checkpoints: [
        checkpoint('06:00', '06:00'),
        checkpoint('08:00', '09:00'),
        checkpoint('09:00', '11:00'),
      ],
      membershipEvents: [],
    })
    const superset = evaluateParticipantBackfill({
      participant,
      checkpoints: [checkpoint('07:00', '12:00')],
      membershipEvents: [],
    })

    expect(adjacent).toMatchObject({
      scope: 'exact',
      memberDeviceIds: ['11'],
      completedMemberDeviceIds: ['11'],
      complete: true,
    })
    expect(superset).toMatchObject({
      scope: 'exact',
      memberDeviceIds: ['11'],
      completedMemberDeviceIds: ['11'],
      complete: true,
    })
  })

  it('fails closed for legacy left-only history while retaining positive inferred membership', () => {
    const participant = {
      missionId: 'mission-legacy-scope',
      kind: 'group' as const,
      teamId: 'team-legacy-scope',
      effectiveFrom: missionStart,
      addedAt: '2026-08-20T09:00:00.000Z',
      startingMemberDeviceIdsJson: null,
    }
    const leftOnly = evaluateParticipantBackfill({
      participant,
      checkpoints: [],
      membershipEvents: [{
        missionId: participant.missionId,
        teamId: participant.teamId,
        deviceId: '11',
        change: 'left',
        observedAt: '2026-08-20T08:30:00.000Z',
        sequence: 1,
      }],
    })
    const positive = evaluateParticipantBackfill({
      participant,
      checkpoints: [],
      membershipEvents: [{
        missionId: participant.missionId,
        teamId: participant.teamId,
        deviceId: '11',
        change: 'member',
        observedAt: '2026-08-20T08:30:00.000Z',
        sequence: 1,
      }],
    })

    expect(leftOnly).toMatchObject({
      scope: 'unknown',
      memberDeviceIds: [],
      complete: false,
    })
    expect(positive).toMatchObject({
      scope: 'inferred',
      memberDeviceIds: ['11'],
      complete: false,
    })
  })

  it('does not report complete when an overlapping pending window remains', () => {
    const participant = {
      missionId: 'mission-pending-overlap',
      kind: 'group' as const,
      teamId: 'team-pending-overlap',
      effectiveFrom: missionStart,
      addedAt: '2026-08-20T11:00:00.000Z',
      startingMemberDeviceIdsJson: '["11"]',
    }
    const evaluation = evaluateParticipantBackfill({
      participant,
      checkpoints: [
        {
          ...checkpointFor('mission-pending-overlap', '11', '08:00', '10:00'),
          completed: 1,
        },
        {
          ...checkpointFor('mission-pending-overlap', '11', '09:00', '10:00'),
          reconciledUntil: '2026-08-20T09:00:00.000Z',
          completed: 0,
        },
        {
          ...checkpointFor('mission-pending-overlap', '11', '10:00', '11:00'),
          completed: 1,
        },
      ],
      membershipEvents: [],
    })

    expect(evaluation).toMatchObject({
      completedMemberDeviceIds: [],
      complete: false,
    })
  })

  it('rejects a completed window whose cursor lies outside its fixed window', () => {
    const evaluation = evaluateParticipantBackfill({
      participant: {
        missionId: 'mission-invalid-cursor',
        kind: 'group',
        teamId: 'team-invalid-cursor',
        effectiveFrom: missionStart,
        addedAt: '2026-08-20T11:00:00.000Z',
        startingMemberDeviceIdsJson: '["11"]',
      },
      checkpoints: [{
        ...checkpointFor('mission-invalid-cursor', '11', '08:00', '11:00'),
        reconciledUntil: '2026-08-20T12:00:00.000Z',
        completed: 1,
      }],
      membershipEvents: [],
    })

    expect(evaluation).toMatchObject({
      completedMemberDeviceIds: [],
      complete: false,
    })
  })

  it('rejects a completed window whose cursor stops before its fixed end', () => {
    const evaluation = evaluateParticipantBackfill({
      participant: {
        missionId: 'mission-partial-cursor',
        kind: 'group',
        teamId: 'team-partial-cursor',
        effectiveFrom: missionStart,
        addedAt: '2026-08-20T11:00:00.000Z',
        startingMemberDeviceIdsJson: '["11"]',
      },
      checkpoints: [{
        ...checkpointFor('mission-partial-cursor', '11', '08:00', '11:00'),
        reconciledUntil: '2026-08-20T10:00:00.000Z',
        completed: 1,
      }],
      membershipEvents: [],
    })

    expect(evaluation).toMatchObject({
      completedMemberDeviceIds: [],
      complete: false,
    })
  })
})

/** Mutates persisted browser-harness state, then resets the singleton to simulate restart. */
function replaceHarnessState(mutator: (state: ReturnType<typeof readBrowserHarnessState>) => void): void {
  const state = readBrowserHarnessState()
  mutator(state)
  window.sessionStorage.setItem(harnessStorageKey, JSON.stringify(state))
  resetBrowserHarnessStore(false)
}

/** Creates one completed helper input window from compact UTC hour notation. */
function checkpoint(windowFrom: string, windowTo: string) {
  return checkpointFor('mission-coverage', '11', windowFrom, windowTo)
}

/** Creates one completed helper input window for an arbitrary mission/device pair. */
function checkpointFor(
  missionId: string,
  deviceId: string,
  windowFrom: string,
  windowTo: string,
) {
  const timestamp = (value: string) => `2026-08-20T${value}:00.000Z`
  return {
    missionId,
    deviceId,
    windowFrom: timestamp(windowFrom),
    windowTo: timestamp(windowTo),
    reconciledUntil: timestamp(windowTo),
    completed: 1,
  }
}
