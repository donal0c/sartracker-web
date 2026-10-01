import { describe, expect, it, vi } from 'vitest'

import { startParticipantRuntime } from '../../src/features/participants/start-participant-runtime'
import type { ParticipantRuntimeState } from '../../src/features/participants/participant-store'

const KMRT = { group_id: 'group-kmrt', name: 'KMRT', parent_group_id: null }
const OTHER = { group_id: 'group-other', name: 'Other team', parent_group_id: null }

/** A store boundary that records the pre-start selection. */
function createStore() {
  return {
    selectMissionParticipants: vi.fn().mockResolvedValue([]),
    addMissionParticipant: vi.fn(),
    removeMissionParticipant: vi.fn(),
    listMissionParticipants: vi.fn().mockResolvedValue([]),
    recordGroupMembershipEvents: vi.fn().mockResolvedValue([]),
    listGroupMembershipEvents: vi.fn().mockResolvedValue([]),
    listParticipantBackfillCheckpoints: vi.fn().mockResolvedValue([]),
  }
}

function device(deviceId: string, groupId: string | null) {
  return {
    device_id: deviceId, name: deviceId, status: 'online' as const, last_seen: '2026-10-01T11:00:00.000Z',
    unique_id: `unique-${deviceId}`, category: null, group_id: groupId,
  }
}

/** Starts an idle runtime that has seen a complete roster and the server's groups. */
async function idleRuntime(groups = [KMRT, OTHER]) {
  const states: ParticipantRuntimeState[] = []
  const runtime = await startParticipantRuntime({
    participantStore: createStore(),
    applyRuntime: (state) => states.push(state),
  })
  await runtime.applyRoster([device('kmrt-1', KMRT.group_id), device('solo-1', null)], '2026-10-01T11:00:00.000Z')
  runtime.applyGroups(groups)
  return { runtime, latest: () => states.at(-1)! }
}

describe('team default group pre-ticked at Start [DON-296]', () => {
  it('pre-ticks the configured default group in the Start step', async () => {
    const { runtime, latest } = await idleRuntime()

    runtime.setDefaultGroup(KMRT.group_id)

    expect(latest().draftGroupIds).toEqual([KMRT.group_id])
    expect(latest().defaultGroupId).toBe(KMRT.group_id)
    expect(latest().defaultGroupMissing).toBe(false)
  })

  it('keeps the default unticked once the coordinator unticks it', async () => {
    const { runtime, latest } = await idleRuntime()
    runtime.setDefaultGroup(KMRT.group_id)

    runtime.toggleDraftGroup(KMRT.group_id)
    runtime.applyGroups([KMRT, OTHER])
    await runtime.applyRoster([device('kmrt-1', KMRT.group_id)], '2026-10-01T11:01:00.000Z')

    expect(latest().draftGroupIds).toEqual([])
  })

  it('does not pre-tick while the roster is incomplete, because Start would refuse a group', async () => {
    const states: ParticipantRuntimeState[] = []
    const runtime = await startParticipantRuntime({ participantStore: createStore(), applyRuntime: (state) => states.push(state) })
    await runtime.applyRoster([device('kmrt-1', KMRT.group_id)], '2026-10-01T11:00:00.000Z', { complete: false })
    runtime.applyGroups([KMRT])

    runtime.setDefaultGroup(KMRT.group_id)
    expect(states.at(-1)!.draftGroupIds).toEqual([])

    await runtime.applyRoster([device('kmrt-1', KMRT.group_id)], '2026-10-01T11:01:00.000Z', { complete: true })
    expect(states.at(-1)!.draftGroupIds).toEqual([KMRT.group_id])
  })

  it('says so when the default group is not on the tracking server, and ticks nothing', async () => {
    const { runtime, latest } = await idleRuntime([OTHER])

    runtime.setDefaultGroup(KMRT.group_id)

    expect(latest().draftGroupIds).toEqual([])
    expect(latest().defaultGroupMissing).toBe(true)
  })

  it('pre-ticks again for the next mission after the previous one started', async () => {
    const { runtime, latest } = await idleRuntime()
    runtime.setDefaultGroup(KMRT.group_id)
    runtime.toggleDraftGroup(KMRT.group_id)

    runtime.clearDraft()

    expect(latest().draftGroupIds).toEqual([KMRT.group_id])
  })

  it('never enrols anyone in a running mission; the default only shapes the next Start draft', async () => {
    const store = createStore()
    const runtime = await startParticipantRuntime({ participantStore: store, applyRuntime: () => undefined })
    await runtime.applyRoster([device('kmrt-1', KMRT.group_id)], '2026-10-01T11:00:00.000Z')
    runtime.applyGroups([KMRT])
    await runtime.refreshMission('mission-1')

    runtime.setDefaultGroup(KMRT.group_id)

    expect(store.selectMissionParticipants).not.toHaveBeenCalled()
    expect(store.addMissionParticipant).not.toHaveBeenCalled()
  })

  it('replaces the automatic tick when Settings changes the default', async () => {
    const { runtime, latest } = await idleRuntime()
    runtime.setDefaultGroup(KMRT.group_id)

    runtime.setDefaultGroup(OTHER.group_id)
    expect(latest().draftGroupIds).toEqual([OTHER.group_id])

    runtime.setDefaultGroup(null)
    expect(latest().draftGroupIds).toEqual([])
  })

  it('keeps a group the coordinator ticked themselves when the default changes', async () => {
    const { runtime, latest } = await idleRuntime()
    runtime.setDefaultGroup(KMRT.group_id)
    runtime.toggleDraftGroup(OTHER.group_id)

    runtime.setDefaultGroup(null)

    expect(latest().draftGroupIds).toEqual([KMRT.group_id, OTHER.group_id])
  })

  it('pre-ticks the default for the next mission after the previous one finished', async () => {
    const { runtime, latest } = await idleRuntime()
    runtime.setDefaultGroup(KMRT.group_id)
    // Start and Finish leave the runtime pointed at the finished mission while
    // the next Start step is shown.
    await runtime.refreshMission('mission-1')
    await runtime.refreshMission('mission-1-finished-view')

    expect(latest().draftGroupIds).toEqual([KMRT.group_id])
  })
})
