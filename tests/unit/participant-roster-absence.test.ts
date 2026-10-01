import { describe, expect, it, vi } from 'vitest'

import { startParticipantRuntime } from '../../src/features/participants/start-participant-runtime'
import type { ParticipantRuntimeState } from '../../src/features/participants/participant-store'
import type {
  GroupMembershipEvent,
  MissionParticipant,
} from '../../src/infrastructure/mission-store/tauri-mission-store'

const GROUP: MissionParticipant = {
  id: 'participant-group', mission_id: 'mission-1', kind: 'group', traccar_device_id: null,
  mission_team_id: 'team-1', traccar_group_id: 'group-1', team_name: 'KMRT', provenance: 'explicit',
  effective_from: '2026-10-01T10:00:00.000Z', added_at: '2026-10-01T10:00:00.000Z', added_by: 'Coordinator',
  removed_at: null, removed_by: null,
}
const MEMBERS: GroupMembershipEvent[] = ['device-1', 'device-2'].map((deviceId, index) => ({
  id: `m-${index}`, sequence: index + 1, mission_id: 'mission-1', mission_team_id: 'team-1',
  traccar_device_id: deviceId, change: 'member', observed_at: '2026-10-01T10:00:00.000Z',
}))

function device(deviceId: string, groupId: string | null) {
  return {
    device_id: deviceId, name: deviceId, status: 'online' as const, last_seen: '2026-10-01T11:00:00.000Z',
    unique_id: `unique-${deviceId}`, category: null, group_id: groupId,
  }
}

/** A runtime on an active mission whose KMRT group has two members. */
async function activeRuntime() {
  const recorded: Omit<GroupMembershipEvent, 'id' | 'sequence' | 'mission_id'>[] = []
  const store = {
    selectMissionParticipants: vi.fn().mockResolvedValue([GROUP]),
    addMissionParticipant: vi.fn(),
    removeMissionParticipant: vi.fn(),
    listMissionParticipants: vi.fn().mockResolvedValue([GROUP]),
    recordGroupMembershipEvents: vi.fn().mockImplementation(async (input: { events: typeof recorded }) => {
      recorded.push(...input.events)
      return input.events.map((event, index) => ({ ...event, id: `new-${recorded.length}-${index}`, sequence: 100 + recorded.length + index, mission_id: 'mission-1' }))
    }),
    listGroupMembershipEvents: vi.fn().mockResolvedValue(MEMBERS),
    listParticipantBackfillCheckpoints: vi.fn().mockResolvedValue([]),
  }
  const states: ParticipantRuntimeState[] = []
  const runtime = await startParticipantRuntime({ participantStore: store, applyRuntime: (state) => states.push(state) })
  await runtime.refreshMission('mission-1')
  await runtime.applyRoster([device('device-1', 'group-1'), device('device-2', 'group-1')], '2026-10-01T11:00:00.000Z')
  recorded.length = 0
  return { runtime, recorded, latest: () => states.at(-1)! }
}

const left = (events: readonly { change: string }[]) => events.filter((event) => event.change === 'left')

describe('a group member leaves only when two complete rosters agree [DON-300]', () => {
  // Donal, 1 Oct: the leave is dated at the confirming roster, never back-dated.
  it('ignores one complete roster that briefly omits the whole group', async () => {
    const { runtime, recorded, latest } = await activeRuntime()

    await runtime.applyRoster([], '2026-10-01T11:01:00.000Z')
    expect(left(recorded)).toEqual([])
    // One visible notice for the group, not one per device.
    expect(latest().membershipNotices.filter((notice) => notice.includes('KMRT'))).toHaveLength(1)
    expect(latest().membershipNotices.at(-1)).toMatch(/missing from the tracking server's roster/iu)

    await runtime.applyRoster([device('device-1', 'group-1'), device('device-2', 'group-1')], '2026-10-01T11:02:00.000Z')
    await runtime.applyRoster([device('device-1', 'group-1'), device('device-2', 'group-1')], '2026-10-01T11:03:00.000Z')
    expect(left(recorded)).toEqual([])
  })

  it('records the leave at the confirming roster once a second complete roster agrees', async () => {
    const { runtime, recorded } = await activeRuntime()

    await runtime.applyRoster([device('device-2', 'group-1')], '2026-10-01T11:01:00.000Z')
    expect(left(recorded)).toEqual([])
    await runtime.applyRoster([device('device-2', 'group-1')], '2026-10-01T11:02:00.000Z')

    expect(left(recorded)).toEqual([
      expect.objectContaining({ traccar_device_id: 'device-1', observed_at: '2026-10-01T11:02:00.000Z' }),
    ])
  })

  it('still records a genuine move to another group, one roster later', async () => {
    const { runtime, recorded } = await activeRuntime()
    const moved = [device('device-1', 'group-9'), device('device-2', 'group-1')]

    await runtime.applyRoster(moved, '2026-10-01T11:01:00.000Z')
    await runtime.applyRoster(moved, '2026-10-01T11:02:00.000Z')

    expect(left(recorded)).toEqual([expect.objectContaining({ traccar_device_id: 'device-1', observed_at: '2026-10-01T11:02:00.000Z' })])
  })

  it('does not count an incomplete roster as the confirming observation', async () => {
    const { runtime, recorded } = await activeRuntime()

    await runtime.applyRoster([device('device-2', 'group-1')], '2026-10-01T11:01:00.000Z')
    await runtime.applyRoster([], '2026-10-01T11:02:00.000Z', { complete: false })

    expect(left(recorded)).toEqual([])
  })

  it('cancels a held absence when an incomplete roster still shows the member', async () => {
    const { runtime, recorded } = await activeRuntime()

    await runtime.applyRoster([device('device-2', 'group-1')], '2026-10-01T11:01:00.000Z')
    await runtime.applyRoster([device('device-1', 'group-1')], '2026-10-01T11:02:00.000Z', { complete: false })
    await runtime.applyRoster([device('device-2', 'group-1')], '2026-10-01T11:03:00.000Z')
    expect(left(recorded)).toEqual([])

    await runtime.applyRoster([device('device-2', 'group-1')], '2026-10-01T11:04:00.000Z')
    expect(left(recorded)).toEqual([expect.objectContaining({ traccar_device_id: 'device-1', observed_at: '2026-10-01T11:04:00.000Z' })])
  })

  it('replaces the "still tracking" notice when the group comes back', async () => {
    const { runtime, latest } = await activeRuntime()

    await runtime.applyRoster([], '2026-10-01T11:01:00.000Z')
    await runtime.applyRoster([device('device-1', 'group-1'), device('device-2', 'group-1')], '2026-10-01T11:02:00.000Z')

    const notices = latest().membershipNotices
    expect(notices.some((notice) => /still tracking them/iu.test(notice))).toBe(false)
    expect(notices.at(-1)).toMatch(/KMRT devices are back on the tracking server's roster/iu)
  })

  it('replaces the "still tracking" notice with one leave notice when the absence is confirmed', async () => {
    const { runtime, latest } = await activeRuntime()

    await runtime.applyRoster([], '2026-10-01T11:01:00.000Z')
    await runtime.applyRoster([], '2026-10-01T11:02:00.000Z')

    const notices = latest().membershipNotices
    expect(notices.some((notice) => /still tracking them/iu.test(notice))).toBe(false)
    expect(notices.filter((notice) => notice.includes('KMRT'))).toHaveLength(1)
    expect(notices.at(-1)).toMatch(/2 devices left KMRT/iu)
  })

  it('updates the group notice when only some missing members come back', async () => {
    const { runtime, latest } = await activeRuntime()

    await runtime.applyRoster([], '2026-10-01T11:01:00.000Z')
    await runtime.applyRoster([device('device-1', 'group-1')], '2026-10-01T11:02:00.000Z', { complete: false })

    const notices = latest().membershipNotices
    expect(notices.some((notice) => notice.startsWith('All 2 devices'))).toBe(false)
    expect(notices.at(-1)).toMatch(/1 device in KMRT is missing from the tracking server's roster/iu)
  })

  it('clears a held absence and its notice once the mission finishes, inventing no leave', async () => {
    const { runtime, recorded, latest } = await activeRuntime()

    await runtime.applyRoster([], '2026-10-01T11:01:00.000Z')
    await runtime.runWithMembershipFinishFence('mission-1', async () => 'finished')

    expect(latest().membershipNotices.some((notice) => /still tracking them/iu.test(notice))).toBe(false)
    expect(left(recorded)).toEqual([])
  })
})
