import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

import { afterEach, describe, expect, it, vi } from 'vitest'

import positionsFixture from '../fixtures/traccar-positions.json'
import { normalizeTraccarPosition } from '../../src/features/tracking/traccar-normalization'
import type {
  NormalizedTrackingDevice,
  NormalizedTrackingPosition,
  TrackingSnapshot,
} from '../../src/features/tracking/tracking-types'
import type { TrackingSnapshotContext } from '../../src/features/tracking/polling-manager'
import { startTrackingRuntime } from '../../src/features/tracking/start-tracking-runtime'
import { createParticipationScope, type ParticipationScope } from '../../src/features/participants/participation-scope'
import { useMissionStore } from '../../src/features/mission/mission-store'
import { buildDeviceWorkspaceRows } from '../../src/features/tracking/device-workspace-model'
import { buildPeopleRows } from '../../src/features/workspace/people-model'
import { createDeviceFeatureCollection } from '../../src/features/tracking/tracking-geojson'

// DON-374: after the team was removed from a running mission, the map still
// drew everyone with their trails, People still counted them and "No position
// yet" stayed. The map, the People list and its warnings must follow who is
// taking part as soon as a removal is saved, without waiting for a poll that
// may never come (tracking outage), while recorded history stays in the store.

type Participant = Parameters<typeof createParticipationScope>[0]['participants'][number]

type RealStore = {
  readonly close: () => void
  readonly createMission: (input: { readonly name: string; readonly start_time?: string }) => Promise<{ readonly id: string }>
  readonly upsertDevice: (input: Record<string, unknown>) => Promise<unknown>
  readonly listDevices: (missionId: string) => Promise<readonly { readonly device_id: string }[]>
  readonly persistTrackingPositionsBulk: (input: Record<string, unknown>) => Promise<Record<string, unknown>>
  readonly addMissionParticipant: (input: Record<string, unknown>) => Promise<{ readonly id: string }>
  readonly removeMissionParticipant: (input: Record<string, unknown>) => Promise<unknown>
  readonly listMissionParticipants: (missionId: string) => Promise<readonly Participant[]>
  readonly countPositions: (missionId: string, deviceId?: string) => Promise<number>
}

const require = createRequire(import.meta.url)
const { createElectronMissionStore } = require('../../electron/mission-store.cjs') as {
  readonly createElectronMissionStore: (options: { readonly userDataPath: string }) => RealStore
}

const TEMPLATE = normalizeTraccarPosition(positionsFixture[0]!, 'live')

let userDataPath: string | undefined
let store: RealStore | undefined
let stopRuntime: (() => Promise<void>) | undefined

afterEach(async () => {
  await stopRuntime?.()
  stopRuntime = undefined
  store?.close()
  store = undefined
  useMissionStore.setState(useMissionStore.getInitialState())
  if (userDataPath !== undefined) {
    await rm(userDataPath, { recursive: true, force: true })
    userDataPath = undefined
  }
})

/** A synthetic Traccar device row; never a real team member. */
function device(deviceId: string): NormalizedTrackingDevice {
  return {
    device_id: deviceId,
    name: `Tracker ${deviceId}`,
    status: 'online',
    last_seen: new Date().toISOString(),
    unique_id: null,
    category: null,
    group_id: null,
  }
}

/** A synthetic fix for one device at one time. */
function fix(deviceId: string, timestamp: string, suffix = 'a'): NormalizedTrackingPosition {
  return {
    ...TEMPLATE,
    id: `${deviceId}-${suffix}`,
    device_id: deviceId,
    lat: 52.1,
    lon: -9.6,
    timestamp,
    timestamp_source: 'fix',
    device_cache_stale: false,
  }
}

/** Sets the renderer's mission state the runtime checks before publishing to the map. */
function setActiveMission(missionId: string, startTime: string): void {
  useMissionStore.setState({
    phase: 'active',
    currentMission: {
      id: missionId, name: 'Removal', status: 'active', start_time: startTime,
      pause_time: null, finish_time: null, paused_seconds: 0, notes: null, schema_version: 1,
    },
  })
}

/** What the People list would show for one published snapshot. */
function peopleFor(snapshot: TrackingSnapshot, nowMs: number) {
  return buildPeopleRows(buildDeviceWorkspaceRows(snapshot, []), nowMs)
}

describe('removing participants from a running mission [DON-374]', () => {
  it('takes removed people off the map, People and warnings at once, and keeps their saved history', async () => {
    userDataPath = await mkdtemp(path.join(tmpdir(), 'sartracker-don-374-'))
    const realStore = createElectronMissionStore({ userDataPath })
    store = realStore
    const nowMs = Date.now()
    const startTime = new Date(nowMs - 60 * 60_000).toISOString()
    const mission = await realStore.createMission({ name: 'Removal', start_time: startTime })
    for (const ref of ['alpha', 'bravo', 'charlie']) {
      await realStore.addMissionParticipant({
        mission_id: mission.id,
        kind: 'device',
        ref,
        confirmed_by: 'Coordinator',
        effective_from: new Date(nowMs - 30 * 60_000).toISOString(),
      })
    }
    setActiveMission(mission.id, startTime)

    let scope: ParticipationScope = createParticipationScope({
      participants: await realStore.listMissionParticipants(mission.id),
      membershipEvents: [],
    })
    let notifyScope: (reason?: 'scope' | 'status') => void = () => undefined
    let hooks: {
      readonly onSnapshot: (snapshot: TrackingSnapshot, context?: TrackingSnapshotContext) => void | Promise<void>
      readonly onStatusChange: (status: Record<string, unknown>) => void
    } | undefined
    const applySnapshot = vi.fn<(snapshot: TrackingSnapshot) => void>()
    stopRuntime = await startTrackingRuntime({
      config: { baseUrl: 'http://synthetic.invalid' },
      createClient: vi.fn().mockReturnValue({}),
      createPoller: vi.fn().mockImplementation((_client, pollerHooks) => {
        hooks = pollerHooks
        return { start: vi.fn(), stop: vi.fn() }
      }),
      cache: { read: vi.fn().mockResolvedValue(null), write: vi.fn() },
      missionStore: {
        getActiveMission: vi.fn().mockResolvedValue({ id: mission.id }),
        listPositions: vi.fn().mockResolvedValue([]),
        listDevices: (missionId) => realStore.listDevices(missionId),
        upsertDevice: (input) => realStore.upsertDevice(input),
        addPosition: vi.fn().mockRejectedValue(new Error('per-row writer must not be used')),
        persistTrackingPositionsBulk: (input) => realStore.persistTrackingPositionsBulk(input) as never,
      },
      applySnapshot,
      applyStatus: vi.fn(),
      writeCache: false,
      missionModelEnabled: true,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      readParticipationScope: () => scope,
      readParticipationScopeMissionId: () => mission.id,
      readParticipationScopeStatus: () => 'ready',
      subscribeParticipationScope: (listener) => {
        notifyScope = listener
        return () => undefined
      },
    })
    hooks!.onStatusChange({
      mode: 'online', consecutiveFailures: 0, recovered: false, lastSuccessAt: null, warning: null,
    })

    // Alpha and Bravo report; Charlie has not reported yet ("No position yet").
    const earlier = new Date(nowMs - 4 * 60_000).toISOString()
    const latest = new Date(nowMs - 60_000).toISOString()
    const trail = [fix('alpha', earlier, 'a1'), fix('alpha', latest, 'a2'), fix('bravo', earlier, 'b1'), fix('bravo', latest, 'b2')]
    const firstPoll: TrackingSnapshot = {
      devices: [device('alpha'), device('bravo'), device('charlie')],
      positions: [fix('alpha', latest, 'a2'), fix('bravo', latest, 'b2')],
      breadcrumbs: trail,
      rawBreadcrumbsForPersistence: trail,
    }
    await hooks!.onSnapshot(firstPoll, { historyResetKey: mission.id })
    await vi.waitFor(async () =>
      expect(await realStore.countPositions(mission.id, 'bravo')).toBe(2), { timeout: 3_000 })
    const before = applySnapshot.mock.calls.at(-1)![0]
    expect(peopleFor(before, nowMs).map((person) => person.deviceId).sort()).toEqual(['alpha', 'bravo', 'charlie'])

    // The coordinator removes Bravo and Charlie. No poll follows (tracking may be down).
    for (const participant of await realStore.listMissionParticipants(mission.id)) {
      if (participant.traccar_device_id === 'alpha') continue
      await realStore.removeMissionParticipant({
        mission_id: mission.id, participant_id: participant.id, removed_by: 'Coordinator',
      })
    }
    scope = createParticipationScope({
      participants: await realStore.listMissionParticipants(mission.id),
      membershipEvents: [],
    })
    const publishedBeforeRemoval = applySnapshot.mock.calls.length
    notifyScope('scope')

    expect(applySnapshot.mock.calls.length).toBeGreaterThan(publishedBeforeRemoval)
    const afterRemoval = applySnapshot.mock.calls.at(-1)![0]
    const people = peopleFor(afterRemoval, nowMs)
    expect(people.map((person) => person.deviceId)).toEqual(['alpha'])
    expect(people.some((person) => person.statusText === 'No position yet')).toBe(false)
    expect(createDeviceFeatureCollection(afterRemoval).features.map((feature) => feature.properties.deviceId))
      .toEqual(['alpha'])
    expect(afterRemoval.breadcrumbs.every((breadcrumb) => breadcrumb.device_id === 'alpha')).toBe(true)

    // A scope refresh that leaves the same people taking part does not redraw the map.
    const publishedAfterRemoval = applySnapshot.mock.calls.length
    scope = createParticipationScope({
      participants: await realStore.listMissionParticipants(mission.id),
      membershipEvents: [],
    })
    notifyScope('scope')
    expect(applySnapshot.mock.calls.length).toBe(publishedAfterRemoval)

    // A later poll still carries Bravo's pre-removal fix; Bravo stays off the map.
    await hooks!.onSnapshot(firstPoll, { historyResetKey: mission.id })
    const afterPoll = applySnapshot.mock.calls.at(-1)![0]
    expect(peopleFor(afterPoll, nowMs).map((person) => person.deviceId)).toEqual(['alpha'])
    expect(createDeviceFeatureCollection(afterPoll).features.map((feature) => feature.properties.deviceId))
      .toEqual(['alpha'])

    // Recorded history stays in the mission record for Review.
    expect(await realStore.countPositions(mission.id, 'bravo')).toBe(2)
    expect(await realStore.listMissionParticipants(mission.id)).toHaveLength(3)

    // Adding Bravo back never replays an old snapshot: no stale fix comes
    // back. Bravo appears with the next poll's own data.
    await realStore.addMissionParticipant({
      mission_id: mission.id, kind: 'device', ref: 'bravo', confirmed_by: 'Coordinator',
      effective_from: new Date().toISOString(),
    })
    scope = createParticipationScope({
      participants: await realStore.listMissionParticipants(mission.id),
      membershipEvents: [],
    })
    const publishedBeforeReAdd = applySnapshot.mock.calls.length
    notifyScope('scope')
    expect(applySnapshot.mock.calls.length).toBe(publishedBeforeReAdd)
  })

  describe('the live map still narrows after runtime transitions', () => {
    const MISSION = 'mission-don-374'

    /** Two device participants; Bravo optionally removed. */
    function scopeWith(bravoRemoved: boolean, nowMs: number): ParticipationScope {
      const from = new Date(nowMs - 30 * 60_000).toISOString()
      const base = {
        mission_id: MISSION, kind: 'device' as const, display_name: null, traccar_group_id: null,
        effective_from: from, effective_to: null, confirmed_by: 'Coordinator', confirmed_at: from,
        removed_by: null, removed_at: null, mission_team_id: null,
      }
      const participants = [
        { ...base, id: 'p-alpha', ref: 'alpha', traccar_device_id: 'alpha' },
        {
          ...base, id: 'p-bravo', ref: 'bravo', traccar_device_id: 'bravo',
          ...(bravoRemoved ? { effective_to: new Date(nowMs - 1_000).toISOString(), removed_by: 'Coordinator', removed_at: new Date(nowMs - 1_000).toISOString() } : {}),
        },
      ] as unknown as Participant[]
      return createParticipationScope({ participants, membershipEvents: [] })
    }

    /** Starts the runtime with a controllable scope, status and optional cache. */
    async function start(options: { readonly cache?: string }) {
      const nowMs = Date.now()
      setActiveMission(MISSION, new Date(nowMs - 60 * 60_000).toISOString())
      const state = {
        scope: scopeWith(false, nowMs),
        status: 'ready' as 'ready' | 'loading',
        notify: (() => undefined) as (reason?: 'scope' | 'status') => void,
        hooks: undefined as undefined | {
          readonly onSnapshot: (snapshot: TrackingSnapshot, context?: TrackingSnapshotContext) => void | Promise<void>
          readonly onStatusChange: (status: Record<string, unknown>) => void
        },
      }
      const applySnapshot = vi.fn<(snapshot: TrackingSnapshot) => void>()
      const dependencies = {
        config: { baseUrl: 'http://synthetic.invalid' },
        createClient: vi.fn().mockReturnValue({}),
        createPoller: vi.fn().mockImplementation((_client: unknown, pollerHooks: typeof state.hooks) => {
          state.hooks = pollerHooks
          return { start: vi.fn(), stop: vi.fn() }
        }),
        cache: { read: vi.fn().mockResolvedValue(options.cache ?? null), write: vi.fn() },
        missionStore: {
          getActiveMission: vi.fn().mockResolvedValue({ id: MISSION }),
          listPositions: vi.fn().mockResolvedValue([]),
          listDevices: vi.fn().mockResolvedValue([]),
          upsertDevice: vi.fn().mockResolvedValue(undefined),
          addPosition: vi.fn().mockResolvedValue(undefined),
          persistTrackingPositionsBulk: vi.fn().mockResolvedValue({ inserted: 0 }),
        },
        applySnapshot,
        applyStatus: vi.fn(),
        writeCache: false,
        missionModelEnabled: true,
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        readParticipationScope: () => state.scope,
        readParticipationScopeMissionId: () => MISSION,
        readParticipationScopeStatus: () => state.status,
        subscribeParticipationScope: (listener: (reason?: 'scope' | 'status') => void) => {
          state.notify = listener
          return () => undefined
        },
      }
      const runtime = await startTrackingRuntime(dependencies as never)
      stopRuntime = runtime
      const latest = new Date(nowMs - 60_000).toISOString()
      const snapshot: TrackingSnapshot = {
        devices: [device('alpha'), device('bravo')],
        positions: [fix('alpha', latest), fix('bravo', latest)],
        breadcrumbs: [fix('alpha', latest), fix('bravo', latest)],
      }
      return { nowMs, state, applySnapshot, runtime, dependencies, snapshot }
    }

    /** Device ids drawn as markers by the last published snapshot. */
    function drawn(applySnapshot: ReturnType<typeof vi.fn<(snapshot: TrackingSnapshot) => void>>): string[] {
      return createDeviceFeatureCollection(applySnapshot.mock.calls.at(-1)![0]).features
        .map((feature) => feature.properties.deviceId).sort()
    }

    it('after a reconnect to the same server', async () => {
      const { nowMs, state, applySnapshot, runtime, dependencies, snapshot } = await start({})
      await state.hooks!.onSnapshot(snapshot, { historyResetKey: MISSION })
      expect(drawn(applySnapshot)).toEqual(['alpha', 'bravo'])
      await runtime.reconfigure!(dependencies as never)
      state.scope = scopeWith(true, nowMs)
      state.notify('scope')
      expect(drawn(applySnapshot)).toEqual(['alpha'])
    })

    it('after a change to another server that has not answered yet', async () => {
      const { nowMs, state, applySnapshot, runtime, dependencies, snapshot } = await start({})
      await state.hooks!.onSnapshot(snapshot, { historyResetKey: MISSION })
      await runtime.reconfigure!({ ...dependencies, config: { baseUrl: 'http://other-synthetic.invalid' } } as never)
      expect(drawn(applySnapshot)).toEqual(['alpha', 'bravo'])
      state.scope = scopeWith(true, nowMs)
      state.notify('scope')
      expect(drawn(applySnapshot)).toEqual(['alpha'])
    })

    it('when the map shows the startup cache and no poll has arrived', async () => {
      const cachedAt = new Date().toISOString()
      const latest = new Date(Date.now() - 60_000).toISOString()
      const { nowMs, state, applySnapshot } = await start({
        cache: JSON.stringify({
          mission_id: MISSION,
          cached_at: cachedAt,
          devices: [device('alpha'), device('bravo')],
          positions: [fix('alpha', latest), fix('bravo', latest)],
          breadcrumbs: [],
        }),
      })
      await vi.waitFor(() => expect(drawn(applySnapshot)).toEqual(['alpha', 'bravo']))
      state.scope = scopeWith(true, nowMs)
      state.notify('scope')
      expect(drawn(applySnapshot)).toEqual(['alpha'])
    })

    it('when a later poll falls back to the trusted scope while participation reloads', async () => {
      const { nowMs, state, applySnapshot, snapshot } = await start({})
      await state.hooks!.onSnapshot(snapshot, { historyResetKey: MISSION })
      state.scope = scopeWith(true, nowMs)
      state.notify('scope')
      expect(drawn(applySnapshot)).toEqual(['alpha'])
      // Participation reloads; the poll uses the last trusted scope.
      state.status = 'loading'
      await state.hooks!.onSnapshot(snapshot, { historyResetKey: MISSION })
      expect(drawn(applySnapshot)).toEqual(['alpha'])
    })
  })
})
