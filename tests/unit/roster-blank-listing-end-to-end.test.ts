import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import devicesFixture from '../fixtures/traccar-devices.json'
import positionsFixture from '../fixtures/traccar-positions.json'
import { useMissionStore } from '../../src/features/mission/mission-store'
import { startParticipantRuntime } from '../../src/features/participants/start-participant-runtime'
import type { ParticipantRuntimeState } from '../../src/features/participants/participant-store'
import { createPollingManager } from '../../src/features/tracking/polling-manager'
import { startTrackingRuntime } from '../../src/features/tracking/start-tracking-runtime'
import {
  normalizeTraccarDevice,
  normalizeTraccarPosition,
} from '../../src/features/tracking/traccar-normalization'
import type {
  GroupMembershipEvent,
  MissionParticipant,
} from '../../src/infrastructure/mission-store/tauri-mission-store'

/**
 * DON-300 item 8, end to end through the REAL poller (box run 5a, 2 Oct 2026):
 * one /api/devices listing that omits a selected group, followed by complete
 * listings, must record no "left" event and post no leave notice. a5485b22
 * tested the participant runtime with distinct rosters only; the real poller
 * hands one fetch to several snapshots, so one blank listing confirmed itself.
 */
const KMRT = '7'
const DEVICES = devicesFixture.map((device) => ({ ...normalizeTraccarDevice(device), group_id: KMRT }))
const POSITIONS = positionsFixture.map((position) => normalizeTraccarPosition(position, 'live'))
// Another team's device stays listed, as on the box: only KMRT goes missing.
const OTHER = { ...DEVICES[0]!, device_id: '99', name: 'Other Team', unique_id: 'unique-99', group_id: '8' }

const GROUP: MissionParticipant = {
  id: 'participant-group', mission_id: 'mission-1', kind: 'group', traccar_device_id: null,
  mission_team_id: 'team-1', traccar_group_id: KMRT, team_name: 'KMRT Hasty', provenance: 'explicit',
  effective_from: '2026-04-06T09:00:00.000Z', added_at: '2026-04-06T09:00:00.000Z', added_by: 'Coordinator',
  removed_at: null, removed_by: null,
}
// A second selected team stays listed and keeps history flowing, as on the box.
const SEARCH: MissionParticipant = {
  ...GROUP, id: 'participant-search', mission_team_id: 'team-2', traccar_group_id: '8', team_name: 'KMRT Search',
}
const MEMBERS: GroupMembershipEvent[] = [
  ...DEVICES.map((device, index) => ({
    id: `m-${index}`, sequence: index + 1, mission_id: 'mission-1', mission_team_id: 'team-1',
    traccar_device_id: device.device_id, change: 'member' as const, observed_at: '2026-04-06T09:00:00.000Z',
  })),
  { id: 'm-99', sequence: 99, mission_id: 'mission-1', mission_team_id: 'team-2',
    traccar_device_id: '99', change: 'member', observed_at: '2026-04-06T09:00:00.000Z' },
]

describe('one blank roster listing through the real poller [DON-300]', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-06T10:35:00.000Z'))
    useMissionStore.setState({
      phase: 'active',
      currentMission: {
        id: 'mission-1', name: 'Mission', status: 'active', start_time: '2026-04-06T09:00:00Z',
        pause_time: null, finish_time: null, paused_seconds: 0, notes: null, schema_version: 1,
      },
    } as never)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('records no leave and posts no leave notice', async () => {
    const recorded: { change: string }[] = []
    const participantStore = {
      selectMissionParticipants: vi.fn().mockResolvedValue([GROUP, SEARCH]),
      addMissionParticipant: vi.fn(),
      removeMissionParticipant: vi.fn(),
      listMissionParticipants: vi.fn().mockResolvedValue([GROUP, SEARCH]),
      recordGroupMembershipEvents: vi.fn().mockImplementation(async (input: { events: { change: string }[] }) => {
        recorded.push(...input.events)
        return input.events.map((event, index) => ({ ...event, id: `new-${index}`, sequence: 100 + recorded.length + index, mission_id: 'mission-1' }))
      }),
      listGroupMembershipEvents: vi.fn().mockResolvedValue(MEMBERS),
      listParticipantBackfillCheckpoints: vi.fn().mockResolvedValue([]),
    }
    const states: ParticipantRuntimeState[] = []
    // Real clocks move between the deliveries of one poll; fake timers do not.
    let tick = 0
    const participants = await startParticipantRuntime({
      participantStore, applyRuntime: (state: ParticipantRuntimeState) => states.push(state),
      now: () => new Date(Date.now() + (tick += 1)),
    } as never)
    await participants.refreshMission('mission-1')

    // Walkers keep moving, so every poll also has new history to publish,
    // as on the box; that history snapshot re-delivers the poll's roster.
    const fixesNow = () => [...POSITIONS, { ...POSITIONS[0]!, device_id: '99' }].map((position) => ({
      ...position,
      id: `${position.device_id}-${Date.now()}`,
      timestamp: new Date(Date.now() - 5_000).toISOString(),
    }))
    // Listing 2 omits the whole KMRT group; every listing is complete.
    let listing = 0
    const getDevicesWithReport = vi.fn(async () => {
      listing += 1
      return { accepted: listing === 2 ? [OTHER] : [...DEVICES, OTHER], complete: true }
    })
    const client = {
      authenticate: vi.fn().mockResolvedValue(undefined),
      getDevices: vi.fn(async () => (await getDevicesWithReport()).accepted),
      getDevicesWithReport,
      // A server that stops listing a device also stops reporting its latest
      // fix, as the team-smoke mock does, until the next listing.
      getCurrentPositions: vi.fn(async () => (listing === 2 ? fixesNow().filter((fix) => fix.device_id === '99') : fixesNow())),
      getBreadcrumbs: vi.fn(async () => fixesNow()),
    }
    const stop = await startTrackingRuntime({
      config: { baseUrl: 'http://synthetic.invalid', pollIntervalMs: 30_000 },
      createClient: () => client,
      // Mission-aware options as start-app-runtime gives the real poller.
      createPoller: (pollerClient, hooks) => createPollingManager(pollerClient as never, {
        intervalMs: 30_000,
        staleThresholdMs: 60 * 60 * 1000,
        getPollingMode: () => 'active',
        getHistoryResetKey: () => useMissionStore.getState().currentMission?.id ?? null,
        getInitialBreadcrumbFrom: () => new Date('2026-04-06T09:00:00Z'),
        ...hooks,
      }),
      cache: { read: async () => null, write: async () => undefined },
      missionStore: {
        getActiveMission: vi.fn().mockResolvedValue(useMissionStore.getState().currentMission),
        listPositions: vi.fn().mockResolvedValue([]),
        upsertDevice: vi.fn().mockResolvedValue(undefined),
        addPosition: vi.fn().mockResolvedValue(undefined),
        persistTrackingPositionsBulk: vi.fn(async (input: { positions: readonly unknown[] }) => ({
          insertedCount: input.positions.length, duplicateCount: 0, changedPositionCount: input.positions.length,
        })),
      },
      applySnapshot: vi.fn(),
      applyStatus: vi.fn(),
      missionModelEnabled: true,
      writeCache: false,
      // As the app wires it: scope comes from the participant runtime.
      readParticipationScope: () => states.at(-1)!.scope,
      readParticipationScopeStatus: () => 'ready',
      applyParticipantRoster: (devices, options) => participants.applyRoster(devices, undefined, options),
    } as never)

    for (let poll = 0; poll < 4; poll += 1) await vi.advanceTimersByTimeAsync(30_000)
    await vi.advanceTimersByTimeAsync(1_000)
    await stop()

    expect(getDevicesWithReport.mock.calls.length).toBeGreaterThanOrEqual(3)
    // The blank listing did reach the runtime: it was held, not ignored.
    expect(states.some((state) => state.membershipNotices.some((notice) =>
      /missing from the tracking server's roster/iu.test(notice)))).toBe(true)
    expect(recorded.filter((event) => event.change === 'left')).toEqual([])
    expect(states.at(-1)?.membershipNotices.some((notice) => /devices? left/iu.test(notice))).toBe(false)
  })
})
