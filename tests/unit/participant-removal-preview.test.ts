import { describe, expect, it, vi } from 'vitest'

import { previewWhileRosterCurrent, removalPromptText } from '../../src/features/participants/participant-removal-prompt'
import { startParticipantRuntime } from '../../src/features/participants/start-participant-runtime'
import type {
  GroupMembershipEvent,
  MissionParticipant,
} from '../../src/infrastructure/mission-store/tauri-mission-store'

const NOW = '2026-11-26T11:00:00.000Z'

const KMRT: MissionParticipant = {
  id: 'part-kmrt', mission_id: 'mission-1', kind: 'group', traccar_device_id: null,
  mission_team_id: 'team-kmrt', traccar_group_id: 'group-kmrt', team_name: 'KMRT',
  provenance: 'explicit', effective_from: '2026-11-26T10:00:00.000Z',
  added_at: '2026-11-26T10:00:00.000Z', added_by: 'Coordinator', removed_at: null, removed_by: null,
}

const ALICE: MissionParticipant = {
  id: 'part-alice', mission_id: 'mission-1', kind: 'device', traccar_device_id: 'd1',
  mission_team_id: null, traccar_group_id: null, team_name: null,
  provenance: 'explicit', effective_from: '2026-11-26T10:00:00.000Z',
  added_at: '2026-11-26T10:00:00.000Z', added_by: 'Coordinator', removed_at: null, removed_by: null,
}

function member(deviceId: string, sequence: number): GroupMembershipEvent {
  return {
    id: `m-${deviceId}`, sequence, mission_id: 'mission-1', mission_team_id: 'team-kmrt',
    traccar_device_id: deviceId, change: 'member', observed_at: '2026-11-26T10:00:00.000Z',
  }
}

function device(deviceId: string, groupId: string | null) {
  return {
    device_id: deviceId, name: deviceId, status: 'online' as const, last_seen: NOW,
    unique_id: `u-${deviceId}`, category: null, group_id: groupId,
  }
}

async function runtimeWith(
  participants: readonly MissionParticipant[],
  events: readonly GroupMembershipEvent[],
  options: {
    readonly membershipWriteFails?: boolean
    readonly holdLeaveWrites?: boolean
    /** Each write waits here until the test resolves it. */
    readonly manualWrites?: { resolve: () => void; events: readonly { readonly change: string }[] }[]
    /** Called on every runtime publish, as an open prompt re-renders. */
    readonly onPublish?: () => void
  } = {},
) {
  const store = {
    selectMissionParticipants: vi.fn().mockResolvedValue(participants),
    addMissionParticipant: vi.fn(),
    removeMissionParticipant: vi.fn(),
    listMissionParticipants: vi.fn().mockResolvedValue(participants),
    recordGroupMembershipEvents: vi.fn().mockImplementation(async (input: {
      readonly events: readonly Omit<GroupMembershipEvent, 'id' | 'sequence' | 'mission_id'>[]
    }) => {
      if (options.membershipWriteFails === true) throw new Error('disk full')
      if (options.holdLeaveWrites === true && input.events.some((event) => event.change === 'left')) {
        return new Promise<never>(() => undefined)
      }
      if (options.manualWrites !== undefined) {
        await new Promise<void>((resolve) => options.manualWrites!.push({ resolve, events: input.events }))
      }
      return input.events.map((event, index) => ({
        ...event, id: `new-${index}`, sequence: events.length + index + 1, mission_id: 'mission-1',
      }))
    }),
    listGroupMembershipEvents: vi.fn().mockResolvedValue(events),
    listParticipantBackfillCheckpoints: vi.fn().mockResolvedValue([]),
  }
  const runtime = await startParticipantRuntime({
    participantStore: store, applyRuntime: () => options.onPublish?.(), now: () => new Date(NOW),
  })
  await runtime.refreshMission('mission-1')
  return runtime
}

describe('Remove counts who would stop being recorded [DON-373]', () => {
  it('counts every recorded group member from a complete roster', async () => {
    const runtime = await runtimeWith([KMRT], [member('d1', 1), member('d2', 2), member('d3', 3)])
    await runtime.applyRoster(['d1', 'd2', 'd3'].map((id) => device(id, 'group-kmrt')), NOW)
    expect(runtime.previewRemoval('part-kmrt')).toEqual({ stopsTrackingCount: 3, rosterConfirmed: true })
  })

  it('counts members the runtime still holds after a first complete roster omits them', async () => {
    const runtime = await runtimeWith([KMRT], [member('d1', 1), member('d2', 2), member('d3', 3)])
    // One complete roster without them is not yet a confirmed leave [DON-300].
    await runtime.applyRoster([], NOW)
    expect(runtime.previewRemoval('part-kmrt')?.stopsTrackingCount).toBe(3)
  })

  it('counts a member who joined since Start once the live roster shows them', async () => {
    const runtime = await runtimeWith([KMRT], [member('d1', 1)])
    await runtime.applyRoster([device('d1', 'group-kmrt'), device('d2', 'group-kmrt')], NOW)
    expect(runtime.previewRemoval('part-kmrt')?.stopsTrackingCount).toBe(2)
  })

  it('does not count a person still covered by another row', async () => {
    const runtime = await runtimeWith([KMRT, ALICE], [member('d1', 1), member('d2', 2)])
    await runtime.applyRoster([device('d1', 'group-kmrt'), device('d2', 'group-kmrt')], NOW)
    // Alice is also in KMRT, so removing her own row stops nobody.
    expect(runtime.previewRemoval('part-alice')?.stopsTrackingCount).toBe(0)
    // Removing KMRT keeps Alice through her own row: only d2 stops.
    expect(runtime.previewRemoval('part-kmrt')?.stopsTrackingCount).toBe(1)
  })

  it('marks the count unconfirmed before any roster and while the roster is incomplete', async () => {
    const runtime = await runtimeWith([KMRT], [member('d1', 1)])
    expect(runtime.previewRemoval('part-kmrt')).toEqual({ stopsTrackingCount: 1, rosterConfirmed: false })
    await runtime.applyRoster([device('d1', 'group-kmrt')], NOW, { complete: false })
    expect(runtime.previewRemoval('part-kmrt')?.rosterConfirmed).toBe(false)
  })

  it('does not treat an unsaved group join as recording coverage, and marks the count unconfirmed', async () => {
    const runtime = await runtimeWith([KMRT, ALICE], [member('d2', 1)], { membershipWriteFails: true })
    // Alice joins KMRT on the live roster, but saving that membership fails.
    await runtime.applyRoster([device('d1', 'group-kmrt'), device('d2', 'group-kmrt')], NOW).catch(() => undefined)
    expect(runtime.previewRemoval('part-alice')).toEqual({ stopsTrackingCount: 1, rosterConfirmed: false })
  })

  it('marks a queued group departure unconfirmed, so a covered person is not promised continued recording', async () => {
    const runtime = await runtimeWith([KMRT, ALICE], [member('d1', 1), member('d2', 2)], { holdLeaveWrites: true })
    // Two complete rosters confirm Alice left KMRT; the leave write is still in flight.
    await runtime.applyRoster([device('d1', null), device('d2', 'group-kmrt')], NOW)
    void runtime.applyRoster([device('d1', null), device('d2', 'group-kmrt')], '2026-11-26T11:01:00.000Z')
    await vi.waitFor(() => expect(runtime.previewRemoval('part-alice')?.rosterConfirmed).toBe(false))
    expect(removalPromptText('Alice', 'device', runtime.previewRemoval('part-alice')))
      .not.toContain('No one stops being tracked')
  })

  it('stays unconfirmed between membership writes while a later roster change is still queued', async () => {
    const writes: { resolve: () => void; events: readonly { readonly change: string }[] }[] = []
    const shownAtPublish: string[] = []
    let ready = false
    const runtime: Awaited<ReturnType<typeof runtimeWith>> = await runtimeWith([KMRT, ALICE], [member('d1', 1)], {
      manualWrites: writes,
      // What an open prompt for Alice would say after each publish.
      onPublish: () => { if (ready) shownAtPublish.push(removalPromptText('Alice', 'device', runtime.previewRemoval('part-alice'))) },
    })
    ready = true
    // Bob joins KMRT: that write is held open.
    void runtime.applyRoster([device('d1', 'group-kmrt'), device('d2', 'group-kmrt')], NOW)
    await vi.waitFor(() => expect(writes).toHaveLength(1))
    // Two complete rosters then confirm Alice left KMRT; they queue behind Bob's write.
    void runtime.applyRoster([device('d1', null), device('d2', 'group-kmrt')], '2026-11-26T11:01:00.000Z')
    void runtime.applyRoster([device('d1', null), device('d2', 'group-kmrt')], '2026-11-26T11:02:00.000Z')
    writes[0]!.resolve()
    await vi.waitFor(() => expect(writes.length).toBeGreaterThan(1))
    expect(shownAtPublish.length).toBeGreaterThan(0)
    // Until Alice's departure is saved, no publish may promise she stays recorded.
    expect(shownAtPublish.filter((text) => text.includes('No one stops being tracked'))).toEqual([])
  })

  it('returns null for a row that is not an active participant', async () => {
    const runtime = await runtimeWith([KMRT], [member('d1', 1)])
    expect(runtime.previewRemoval('no-such-row')).toBeNull()
  })
})

describe('removal question wording [DON-373]', () => {
  it('names who and how many', () => {
    expect(removalPromptText('KMRT', 'group', { stopsTrackingCount: 34, rosterConfirmed: true }))
      .toBe('Stop tracking KMRT (34 people)? Their positions stop being recorded.')
    expect(removalPromptText('Alice', 'device', { stopsTrackingCount: 1, rosterConfirmed: false }))
      .toBe('Stop tracking Alice (1 person)? Their positions stop being recorded.')
  })

  it('gives a group count from an unconfirmed roster as a minimum, or as not known', () => {
    expect(removalPromptText('KMRT', 'group', { stopsTrackingCount: 3, rosterConfirmed: false }))
      .toBe('Stop tracking KMRT (at least 3 people)? Their positions stop being recorded.')
    expect(removalPromptText('KMRT', 'group', { stopsTrackingCount: 0, rosterConfirmed: false }))
      .toBe('Stop tracking KMRT (number of people not known)? Their positions stop being recorded.')
    expect(removalPromptText('KMRT', 'group', null))
      .toBe('Stop tracking KMRT (number of people not known)? Their positions stop being recorded.')
  })

  it('never presents a count as confirmed while tracking is offline or the device list is not current', () => {
    const confirmed = { stopsTrackingCount: 3, rosterConfirmed: true }
    expect(previewWhileRosterCurrent(confirmed, { mode: 'online' })).toEqual(confirmed)
    expect(previewWhileRosterCurrent(confirmed, { mode: 'offline' })?.rosterConfirmed).toBe(false)
    expect(previewWhileRosterCurrent(confirmed, { mode: 'online', warningCodes: ['roster_unavailable'] })?.rosterConfirmed)
      .toBe(false)
    expect(previewWhileRosterCurrent(null, { mode: 'offline' })).toBeNull()
  })

  it('never says no one stops being tracked from an unconfirmed count', () => {
    expect(removalPromptText('Alice', 'device', { stopsTrackingCount: 0, rosterConfirmed: false }))
      .toBe('Stop tracking Alice (number of people not known)? Their positions stop being recorded.')
  })

  it('says when removing the row stops tracking nobody', () => {
    expect(removalPromptText('Alice', 'device', { stopsTrackingCount: 0, rosterConfirmed: true }))
      .toBe('Remove Alice from this mission? No one stops being tracked: nobody is tracked only through Alice.')
  })
})
