import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Mission } from '../../../../src/infrastructure/mission-store/tauri-mission-store'
import { startMissionRuntime } from '../../../../src/features/mission/start-mission-runtime'
import { useMissionStore } from '../../../../src/features/mission/mission-store'
import { createParticipationScope } from '../../../../src/features/participants/participation-scope'
import {
  createPollingManager,
  type TrackingHistoryChunkPersistenceInput,
  type TrackingPollerClient,
} from '../../../../src/features/tracking/polling-manager'
import {
  startTrackingRuntime,
  type StartTrackingRuntimeDependencies,
} from '../../../../src/features/tracking/start-tracking-runtime'
import type {
  NormalizedTrackingPosition,
  TrackingSnapshot,
} from '../../../../src/features/tracking/tracking-types'
import { serializeTrackingCachePayload } from '../../../../src/features/tracking/tracking-cache-payload'
import { applyTrackingSnapshot, useTrackingStore } from '../../../../src/features/tracking/tracking-store'
import { useStationaryAttentionStore } from '../../../../src/features/tracking/stationary-attention-store'

type CapturedPollerHooks = Parameters<StartTrackingRuntimeDependencies['createPoller']>[1]
type RuntimeStop = Awaited<ReturnType<typeof startTrackingRuntime>>

const FIXED_NOW = new Date('2026-04-06T10:35:00.000Z')
const activeRuntimeStops = new Set<RuntimeStop>()
const pendingCurrentPositionResolutions = new Set<() => void>()

/** Stops a runtime and retries once when its first cleanup attempt remains incomplete. */
async function stopRuntimeWithRetry(stop: RuntimeStop): Promise<void> {
  try {
    await stop()
  } catch (firstError) {
    try {
      await stop()
    } catch (retryError) {
      throw new AggregateError([firstError, retryError], 'WAR-06 runtime cleanup retry failed.')
    }
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  useTrackingStore.setState(useTrackingStore.getInitialState())
  useStationaryAttentionStore.setState(useStationaryAttentionStore.getInitialState())
})

afterEach(async () => {
  for (const resolve of pendingCurrentPositionResolutions) resolve()
  pendingCurrentPositionResolutions.clear()
  const failures: unknown[] = []
  for (const stop of [...activeRuntimeStops]) {
    try {
      await stopRuntimeWithRetry(stop)
      activeRuntimeStops.delete(stop)
    } catch (error) {
      failures.push(error)
    }
  }
  vi.useRealTimers()
  useMissionStore.setState(useMissionStore.getInitialState())
  useTrackingStore.setState(useTrackingStore.getInitialState())
  useStationaryAttentionStore.setState(useStationaryAttentionStore.getInitialState())
  if (failures.length > 0) {
    throw new AggregateError(failures, 'WAR-06 characterization runtime cleanup failed.')
  }
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
function scopeForMission(missionId: string, deviceIds: readonly string[] = ['device-1']) {
  return createParticipationScope({
    participants: deviceIds.map((deviceId) => ({
      id: `participant-${missionId}-${deviceId}`,
      mission_id: missionId,
      kind: 'device' as const,
      traccar_device_id: deviceId,
      mission_team_id: null,
      traccar_group_id: null,
      team_name: null,
      provenance: 'explicit' as const,
      effective_from: '2026-04-06T09:00:00.000Z',
      added_at: '2026-04-06T09:00:00.000Z',
      added_by: 'WAR-06 characterization',
      removed_at: null,
      removed_by: null,
    })),
    membershipEvents: [],
  })
}

/** Omits durable-history hooks when the characterization owns its timing. */
function withoutHistoryPersistenceHooks(hooks: CapturedPollerHooks): CapturedPollerHooks {
  const filtered = { ...hooks } as Record<string, unknown>
  delete filtered.persistHistoryRequest
  delete filtered.persistHistoryChunk
  delete filtered.persistHistoryChunks
  return filtered as CapturedPollerHooks
}

/** Creates one fix whose source identity makes cross-mission leakage obvious. */
function snapshot(
  id: string,
  options: {
    readonly dataOrigin?: 'live' | 'cache'
    readonly timestamp?: string
    readonly breadcrumbs?: readonly NormalizedTrackingPosition[]
  } = {},
): TrackingSnapshot {
  const position: NormalizedTrackingPosition = {
    id,
    device_id: 'device-1',
    lat: 52.1001,
    lon: -9.7001,
    altitude: null,
    speed: null,
    battery: null,
    accuracy: 4,
    timestamp: options.timestamp ?? '2026-04-06T10:00:00.000Z',
    timestamp_source: 'fix',
    fix_time_unverified: false,
    source: 'war-06-provider',
    data_origin: options.dataOrigin ?? 'live',
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
    breadcrumbs: options.breadcrumbs ?? [],
  }
}

function createDeferred<T>(): {
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
  readonly reject: (error: Error) => void
} {
  let resolvePromise: (value: T) => void = () => undefined
  let rejectPromise: (error: Error) => void = () => undefined
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })
  return { promise, resolve: resolvePromise, reject: rejectPromise }
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 12; index += 1) {
    await Promise.resolve()
  }
}

async function createMissionController(): Promise<Awaited<ReturnType<typeof startMissionRuntime>>> {
  let nextMissionIndex = 0
  const missions = new Map<string, Mission>()
  const createMission = vi.fn(async (input: { readonly name: string }) => {
    const id = `mission-${nextMissionIndex === 0 ? 'a' : 'b'}`
    nextMissionIndex += 1
    const created = { ...mission(id), name: input.name }
    missions.set(id, created)
    return created
  })
  const finishMission = vi.fn(async (missionId: string) => {
    const current = missions.get(missionId)
    if (current === undefined) throw new Error(`Unknown mission ${missionId}`)
    const finished = {
      ...current,
      status: 'finished' as const,
      finish_time: FIXED_NOW.toISOString(),
    }
    missions.set(missionId, finished)
    return finished
  })
  return startMissionRuntime({
    missionStore: {
      createMission,
      listMissions: vi.fn().mockResolvedValue([]),
      getRecoverableMission: vi.fn().mockResolvedValue(null),
      pauseMission: vi.fn(async (missionId: string) => missions.get(missionId) ?? null),
      resumeMission: vi.fn(async (missionId: string) => missions.get(missionId) ?? null),
      finishMission,
    },
    applyRuntime: (runtime) => useMissionStore.getState().applyRuntime(runtime),
    now: () => FIXED_NOW,
  })
}

/** Builds a runtime with controllable participant hydration and captured hooks. */
async function startCharacterizationRuntime(input: {
  readonly applySnapshot?: (snapshot: TrackingSnapshot) => void
  readonly scopeStatus: () => 'loading' | 'ready'
  readonly readScope: () => ReturnType<typeof scopeForMission>
  readonly subscribeScope: (listener: () => void) => () => void
  readonly cacheRead?: () => Promise<string | null>
  readonly createPoller?: StartTrackingRuntimeDependencies['createPoller']
  readonly createClient?: () => unknown
}): Promise<{
  readonly stop: RuntimeStop
  readonly hooks: CapturedPollerHooks
  readonly notifyScopeChanged: () => void
}> {
  let hooks: CapturedPollerHooks | undefined
  let notifyScopeChanged = () => undefined
  const createPoller = input.createPoller === undefined
    ? vi.fn((_client: unknown, candidateHooks: CapturedPollerHooks) => {
        hooks = candidateHooks
        return {
          start: vi.fn(),
          stop: vi.fn().mockResolvedValue(undefined),
          requestPollNow: vi.fn(),
        }
      })
    : (client: unknown, candidateHooks: CapturedPollerHooks) => {
        hooks = candidateHooks
        return input.createPoller!(client, candidateHooks)
      }
  const dependencies: StartTrackingRuntimeDependencies = {
    config: { baseUrl: 'http://war-06.invalid' },
    createClient: input.createClient === undefined
      ? vi.fn().mockReturnValue({})
      : input.createClient,
    createPoller,
    cache: { read: input.cacheRead ?? vi.fn().mockResolvedValue(null), write: vi.fn() },
    missionStore: {
      getActiveMission: vi.fn(async () => {
        const currentMission = useMissionStore.getState().currentMission
        return currentMission === null ? null : { id: currentMission.id }
      }),
      listPositions: vi.fn().mockResolvedValue([]),
      upsertDevice: vi.fn().mockResolvedValue(undefined),
      addPosition: vi.fn().mockResolvedValue(undefined),
      persistTrackingPositionsBulk: vi.fn().mockResolvedValue({
        changedPositionCount: 0,
        insertedPositionCount: 0,
        skippedAmbiguousLegacyAdoptionCount: 0,
      }),
    },
    applySnapshot: input.applySnapshot ?? vi.fn(),
    applyStatus: vi.fn(),
    recordMissionEvidenceLoss: vi.fn().mockResolvedValue(undefined),
    missionModelEnabled: true,
    readParticipationScope: input.readScope,
    readParticipationScopeStatus: input.scopeStatus,
    subscribeParticipationScope: (listener) => {
      notifyScopeChanged = listener
      return input.subscribeScope(listener)
    },
    writeCache: false,
    now: () => new Date('2026-04-06T10:35:00.000Z'),
  }
  const stop = await startTrackingRuntime(dependencies)
  activeRuntimeStops.add(stop)
  if (hooks === undefined) {
    await stop()
    activeRuntimeStops.delete(stop)
    throw new Error('WAR-06 characterization did not capture tracking hooks.')
  }
  return { stop, hooks, notifyScopeChanged }
}

it('reproduces stale history publication at the real delayed poller flush [WAR-06-AUD-01]', async () => {
  const controller = await createMissionController()
  await controller.startMission({ name: 'Mission A' })
  let currentScope = scopeForMission('mission-a')
  const missionACurrent = snapshot('mission-a-current')
  const missionAHistory = snapshot('mission-a-history').positions[0]!
  const missionBCurrent = snapshot('mission-b-current')
  const pendingMissionBCurrent = createDeferred<readonly NormalizedTrackingPosition[]>()
  pendingCurrentPositionResolutions.add(() => pendingMissionBCurrent.resolve(missionBCurrent.positions))
  const pendingSecondHistoryPersistence = createDeferred<void>()
  pendingCurrentPositionResolutions.add(() => pendingSecondHistoryPersistence.resolve())
  let currentPollCount = 0
  let switchMissionAfterHistoryFlush = () => undefined
  const scheduledDelays: number[] = []
  let initialHistoryPersistenceCount = 0
  const persistHistoryChunk = vi.fn((input: TrackingHistoryChunkPersistenceInput) => {
    if (input.phase !== 'initial') return Promise.resolve()
    initialHistoryPersistenceCount += 1
    return initialHistoryPersistenceCount === 1
      ? Promise.resolve({ changed: false })
      : pendingSecondHistoryPersistence.promise.then(() => ({ changed: false }))
  })
  const client: TrackingPollerClient = {
    authenticate: vi.fn().mockResolvedValue(undefined),
    getDevices: vi.fn().mockResolvedValue(missionACurrent.devices),
    getCurrentPositions: vi.fn(() => {
      currentPollCount += 1
      return currentPollCount === 1
        ? Promise.resolve(missionACurrent.positions)
        : pendingMissionBCurrent.promise
    }),
    getBreadcrumbs: vi.fn().mockResolvedValue([missionAHistory]),
  }
  const { notifyScopeChanged } = await startCharacterizationRuntime({
    createClient: () => client,
    applySnapshot: (nextSnapshot) => {
      applyTrackingSnapshot(
        nextSnapshot,
        useMissionStore.getState().currentMission?.id ?? null,
        ['device-1'],
      )
    },
    scopeStatus: () => 'ready',
    readScope: () => currentScope,
    subscribeScope: () => () => undefined,
    createPoller: (pollerClient, hooks) => createPollingManager(
      pollerClient as TrackingPollerClient,
      {
        intervalMs: 5_000,
        staleThresholdMs: 60 * 60 * 1000,
        getPollingMode: () => {
          const phase = useMissionStore.getState().phase
          return phase === 'active' || phase === 'paused' ? phase : 'idle'
        },
        getHistoryResetKey: () => useMissionStore.getState().currentMission?.id ?? null,
        getInitialBreadcrumbFrom: () => new Date('2026-04-06T00:00:00.000Z'),
        getParticipantDeviceIds: () => currentScope.historicalDeviceIdsThrough(FIXED_NOW.toISOString()),
        persistHistoryChunk,
        ...withoutHistoryPersistenceHooks(hooks),
        now: () => FIXED_NOW,
        setTimeout: (callback, delay, ...args) => {
          scheduledDelays.push(delay)
          return globalThis.setTimeout(() => {
            callback(...args)
            if (delay === 100) {
              switchMissionAfterHistoryFlush()
            }
          }, delay)
        },
        clearTimeout: globalThis.clearTimeout,
      },
    ),
  })
  expect(notifyScopeChanged).toBeTypeOf('function')

  await vi.advanceTimersByTimeAsync(0)
  for (let index = 0; index < 20 && !scheduledDelays.includes(100); index += 1) {
    await Promise.resolve()
  }
  expect(scheduledDelays).toContain(100)
  expect(client.getBreadcrumbs).toHaveBeenCalled()

  // Mission B becomes current while the real 100 ms history publication timer
  // is pending. The poller's async replacement turn has not yet reached its
  // stale-key discard, so the delayed flush can expose the old history.
  switchMissionAfterHistoryFlush = () => {
    currentScope = scopeForMission('mission-b')
    useMissionStore.setState({ phase: 'active', currentMission: mission('mission-b') })
  }
  await vi.advanceTimersByTimeAsync(100)
  await flushMicrotasks()

  expect(useTrackingStore.getState().snapshot.breadcrumbs.map((position) => position.id))
    .toContain(missionAHistory.id)
  expect(useStationaryAttentionStore.getState().missionId).toBe('mission-b')

  pendingMissionBCurrent.resolve(missionBCurrent.positions)
  pendingSecondHistoryPersistence.resolve()
  pendingCurrentPositionResolutions.clear()
  await flushMicrotasks()
})

it('reproduces deferred stale current-fix publication through finish-idle-start [WAR-06-AUD-02]', async () => {
  const controller = await createMissionController()
  await controller.startMission({ name: 'Mission A' })
  let scopeStatus: 'loading' | 'ready' = 'loading'
  let currentScope = scopeForMission('mission-a')
  const missionACurrent = snapshot('mission-a-deferred-fix')
  let replacement: Promise<Mission> | null = null
  const unsubscribeMissionTransition = useMissionStore.subscribe((state) => {
    if (state.phase === 'idle' && replacement === null) {
      replacement = controller.startMission({ name: 'Mission B' })
    }
  })
  try {
    const runtime = await startCharacterizationRuntime({
      applySnapshot: (nextSnapshot) => {
        applyTrackingSnapshot(
          nextSnapshot,
          useMissionStore.getState().currentMission?.id ?? null,
          ['device-1'],
        )
      },
      scopeStatus: () => scopeStatus,
      readScope: () => currentScope,
      subscribeScope: () => () => undefined,
    })

    const observation = {
      missionId: null,
      complete: vi.fn(),
      claim: vi.fn(),
    }
    runtime.hooks.onCurrentSnapshot(
      missionACurrent,
      { historyResetKey: 'mission-a', missionEvidenceId: null },
      observation,
    )
    expect(useTrackingStore.getState().snapshot.positions).toHaveLength(0)

    await controller.finishMission()
    if (replacement === null) throw new Error('Mission controller did not publish idle.')
    await replacement
    expect(useMissionStore.getState().phase).toBe('active')
    expect(useMissionStore.getState().currentMission?.id).toBe('mission-b')
    currentScope = scopeForMission('mission-b')
    scopeStatus = 'ready'
    runtime.notifyScopeChanged()

    expect(useTrackingStore.getState().snapshot.positions.map((position) => position.id))
      .toEqual(['mission-a-deferred-fix'])
    expect(useStationaryAttentionStore.getState().missionId).toBe('mission-b')

    pendingCurrentPositionResolutions.clear()
    await flushMicrotasks()
  } finally {
    unsubscribeMissionTransition()
  }
})

it('characterizes the unkeyed cached snapshot across finish-idle-start [WAR-06-CACHE-SIBLING]', async () => {
  const controller = await createMissionController()
  await controller.startMission({ name: 'Mission A' })
  let scopeStatus: 'loading' | 'ready' = 'loading'
  let currentScope = scopeForMission('mission-a')
  const cachedSnapshot = snapshot('mission-a-cached-fix', {
    dataOrigin: 'cache',
    timestamp: '2026-04-06T10:34:00.000Z',
  })
  const cachedContents = serializeTrackingCachePayload({
    cached_at: '2026-04-06T10:34:00.000Z',
    devices: cachedSnapshot.devices,
    positions: cachedSnapshot.positions,
    breadcrumbs: cachedSnapshot.breadcrumbs,
  })
  const { notifyScopeChanged } = await startCharacterizationRuntime({
    cacheRead: vi.fn().mockResolvedValue(cachedContents),
    applySnapshot: (nextSnapshot) => {
      applyTrackingSnapshot(
        nextSnapshot,
        useMissionStore.getState().currentMission?.id ?? null,
        ['device-1'],
      )
    },
    scopeStatus: () => scopeStatus,
    readScope: () => currentScope,
    subscribeScope: () => () => undefined,
  })

  // Cache hydration is held while participant scope is unresolved. The
  // current mission then finishes and a replacement starts before hydration
  // resumes, matching the runtime ordering that makes the cache key relevant.
  expect(useTrackingStore.getState().snapshot.positions).toHaveLength(0)
  await controller.finishMission()
  expect(useMissionStore.getState().phase).toBe('idle')
  await controller.startMission({ name: 'Mission B' })
  expect(useMissionStore.getState().currentMission?.id).toBe('mission-b')

  currentScope = scopeForMission('mission-b')
  scopeStatus = 'ready'
  notifyScopeChanged()

  expect(useTrackingStore.getState().snapshot.positions.map((position) => position.id))
    .toEqual(['mission-a-cached-fix'])
  expect(useStationaryAttentionStore.getState().missionId).toBe('mission-b')
})
