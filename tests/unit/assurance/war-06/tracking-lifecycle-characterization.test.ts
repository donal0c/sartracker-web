import { afterEach, expect, it, vi } from 'vitest'
import { useMissionStore } from '../../../../src/features/mission/mission-store'
import { createParticipationScope } from '../../../../src/features/participants/participation-scope'
import {
  startTrackingRuntime,
  type StartTrackingRuntimeDependencies,
} from '../../../../src/features/tracking/start-tracking-runtime'
import type {
  TrackingSnapshot,
} from '../../../../src/features/tracking/tracking-types'

type CapturedPollerHooks = Parameters<StartTrackingRuntimeDependencies['createPoller']>[1]

afterEach(() => {
  useMissionStore.setState(useMissionStore.getInitialState())
})

/** Creates the minimum mission shape needed by the renderer mission store. */
function mission(id: string) {
  return {
    id,
    name: id,
    status: 'active' as const,
    start_time: '2026-04-06T09:00:00.000Z',
    pause_time: null,
    finish_time: null,
    paused_seconds: 0,
    notes: null,
    schema_version: 1,
  }
}

/** Creates a participant scope that authorizes one device for one mission. */
function scopeForMission(missionId: string) {
  return createParticipationScope({
    participants: [{
      id: `participant-${missionId}`,
      mission_id: missionId,
      kind: 'device',
      traccar_device_id: 'device-1',
      mission_team_id: null,
      traccar_group_id: null,
      team_name: null,
      provenance: 'explicit',
      effective_from: '2026-04-06T09:00:00.000Z',
      added_at: '2026-04-06T09:00:00.000Z',
      added_by: 'WAR-06 characterization',
      removed_at: null,
      removed_by: null,
    }],
    membershipEvents: [],
  })
}

/** Creates one live fix whose source identity makes cross-mission leakage obvious. */
function snapshot(id: string): TrackingSnapshot {
  const position = {
    id,
    device_id: 'device-1',
    lat: 52.1001,
    lon: -9.7001,
    altitude: null,
    speed: null,
    battery: null,
    accuracy: 4,
    timestamp: '2026-04-06T10:00:00.000Z',
    timestamp_source: 'fix' as const,
    fix_time_unverified: false,
    source: 'war-06-provider',
    data_origin: 'live' as const,
    cache_age_seconds: null,
    device_cache_stale: false,
  }
  return {
    devices: [{
      device_id: 'device-1',
      name: 'WAR-06 Device',
      status: 'online',
      last_seen: position.timestamp,
      unique_id: 'war-06-device',
      category: null,
      group_id: null,
    }],
    positions: [position],
    breadcrumbs: [],
  }
}

/** Builds a runtime with controllable participant hydration and captured hooks. */
async function startCharacterizationRuntime(input: {
  readonly applySnapshot: (snapshot: TrackingSnapshot) => void
  readonly scopeStatus: () => 'loading' | 'ready'
  readonly readScope: () => ReturnType<typeof scopeForMission>
  readonly subscribeScope: (listener: () => void) => () => void
}): Promise<{
  readonly stop: () => Promise<void>
  readonly hooks: CapturedPollerHooks
}> {
  let hooks: CapturedPollerHooks | undefined
  const dependencies: StartTrackingRuntimeDependencies = {
    config: { baseUrl: 'http://war-06.invalid' },
    createClient: vi.fn().mockReturnValue({}),
    createPoller: vi.fn((_client: unknown, candidateHooks: CapturedPollerHooks) => {
      hooks = candidateHooks
      return {
        start: vi.fn(),
        stop: vi.fn().mockResolvedValue(undefined),
        requestPollNow: vi.fn(),
      }
    }),
    cache: { read: vi.fn().mockResolvedValue(null), write: vi.fn() },
    missionStore: {
      getActiveMission: vi.fn().mockResolvedValue({ id: 'mission-b' }),
      listPositions: vi.fn().mockResolvedValue([]),
      upsertDevice: vi.fn().mockResolvedValue(undefined),
      addPosition: vi.fn().mockResolvedValue(undefined),
    },
    applySnapshot: input.applySnapshot,
    applyStatus: vi.fn(),
    missionModelEnabled: true,
    readParticipationScope: input.readScope,
    readParticipationScopeStatus: input.scopeStatus,
    subscribeParticipationScope: input.subscribeScope,
    writeCache: false,
    now: () => new Date('2026-04-06T10:35:00.000Z'),
  }
  const stop = await startTrackingRuntime(dependencies)
  if (hooks === undefined) {
    await stop()
    throw new Error('WAR-06 characterization did not capture tracking hooks.')
  }
  return { stop, hooks }
}

it('reproduces stale history publication across a mission switch [WAR-06-AUD-01]', async () => {
  useMissionStore.setState({ phase: 'active', currentMission: mission('mission-b') })
  const applySnapshot = vi.fn()
  const runtime = await startCharacterizationRuntime({
    applySnapshot,
    scopeStatus: () => 'ready',
    readScope: () => scopeForMission('mission-b'),
    subscribeScope: () => () => undefined,
  })

  await runtime.hooks.onSnapshot(snapshot('mission-a-fix'), {
    historyResetKey: 'mission-a',
    missionEvidenceId: null,
  })

  expect(applySnapshot).toHaveBeenCalledOnce()
  expect(applySnapshot.mock.calls[0]?.[0].positions.map(
    (position) => position.id,
  )).toEqual(['mission-a-fix'])

  await runtime.stop()
})

it('reproduces deferred stale publication after participant hydration follows a mission switch [WAR-06-AUD-02]', async () => {
  useMissionStore.setState({ phase: 'active', currentMission: mission('mission-a') })
  const applySnapshot = vi.fn()
  let scopeStatus: 'loading' | 'ready' = 'loading'
  let notifyScopeChanged = () => undefined
  const runtime = await startCharacterizationRuntime({
    applySnapshot,
    scopeStatus: () => scopeStatus,
    readScope: () => scopeForMission('mission-b'),
    subscribeScope: (listener) => {
      notifyScopeChanged = listener
      return () => undefined
    },
  })

  await runtime.hooks.onSnapshot(snapshot('mission-a-deferred-fix'), {
    historyResetKey: 'mission-a',
    missionEvidenceId: null,
  })
  expect(applySnapshot).not.toHaveBeenCalled()

  useMissionStore.setState({ phase: 'active', currentMission: mission('mission-b') })
  scopeStatus = 'ready'
  notifyScopeChanged()

  expect(applySnapshot).toHaveBeenCalledOnce()
  expect(applySnapshot.mock.calls[0]?.[0].positions.map(
    (position) => position.id,
  )).toEqual(['mission-a-deferred-fix'])

  await runtime.stop()
})
