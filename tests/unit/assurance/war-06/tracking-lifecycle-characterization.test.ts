import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mission } from '../../../../src/infrastructure/mission-store/tauri-mission-store'
import { startMissionRuntime } from '../../../../src/features/mission/start-mission-runtime'
import { useMissionStore } from '../../../../src/features/mission/mission-store'
import { createParticipationScope } from '../../../../src/features/participants/participation-scope'
import { useActiveMissionDevicesStore } from '../../../../src/features/tracking/active-mission-devices-store'
import {
  createPollingManager,
  type TrackingHistoryChunkPersistenceInput,
  type TrackingPollerClient,
} from '../../../../src/features/tracking/polling-manager'
import { startMissionTrackingStatusBridge } from '../../../../src/features/tracking/mission-tracking-status-bridge'
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
const pendingDeferredResolutions = new Set<() => void>()
const MAX_MICROTASK_TURNS = 100

/** Stops a runtime and preserves a first-attempt failure even when retry succeeds. */
async function stopRuntimeWithRetry(stop: RuntimeStop): Promise<void> {
  try {
    await stop()
  } catch (firstError) {
    try {
      await stop()
    } catch (retryError) {
      throw new AggregateError([firstError, retryError], 'WAR-06 runtime cleanup retry failed.')
    }
    throw new AggregateError(
      [firstError],
      'WAR-06 runtime cleanup recovered on retry; inspect the first cleanup failure.',
    )
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  useTrackingStore.setState(useTrackingStore.getInitialState())
  useStationaryAttentionStore.setState(useStationaryAttentionStore.getInitialState())
  useActiveMissionDevicesStore.setState(useActiveMissionDevicesStore.getInitialState())
})

afterEach(async () => {
  for (const resolve of pendingDeferredResolutions) resolve()
  pendingDeferredResolutions.clear()
  vi.clearAllTimers()
  vi.useRealTimers()
  const failures: unknown[] = []
  for (const stop of [...activeRuntimeStops]) {
    try {
      await stopRuntimeWithRetry(stop)
      activeRuntimeStops.delete(stop)
    } catch (error) {
      failures.push(error)
    } finally {
      activeRuntimeStops.delete(stop)
    }
  }
  useMissionStore.setState(useMissionStore.getInitialState())
  useTrackingStore.setState(useTrackingStore.getInitialState())
  useStationaryAttentionStore.setState(useStationaryAttentionStore.getInitialState())
  useActiveMissionDevicesStore.setState(useActiveMissionDevicesStore.getInitialState())
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

/** Creates two same-location historical fixes that make stationary projection observable. */
function stationaryHistory(prefix: string): readonly NormalizedTrackingPosition[] {
  return [
    snapshot(`${prefix}-start`, { timestamp: '2026-04-06T09:00:00.000Z' }).positions[0]!,
    snapshot(`${prefix}-heartbeat`, { timestamp: '2026-04-06T09:20:00.000Z' }).positions[0]!,
  ]
}

/** Applies the same mission-scoped device-selection boundary as the production app runtime. */
function applyCharacterizationSnapshot(nextSnapshot: TrackingSnapshot): void {
  const missionId = useMissionStore.getState().currentMission?.id ?? null
  applyTrackingSnapshot(
    nextSnapshot,
    missionId,
    useActiveMissionDevicesStore.getState().getActiveDeviceIds(missionId),
  )
}

/** Erases the visible publication only for the falsifiability control subprocess. */
function applyNegativeControlBeforeOracle(): void {
  if (process.env.WAR06_NEGATIVE_CONTROL !== 'drop-visible-publication') return
  useTrackingStore.setState(useTrackingStore.getInitialState())
  useStationaryAttentionStore.setState(useStationaryAttentionStore.getInitialState())
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

/** Waits for a named observable state and fails loudly if the chain never reaches it. */
async function flushMicrotasksUntil(
  predicate: () => boolean,
  description: string,
): Promise<void> {
  for (let index = 0; index < MAX_MICROTASK_TURNS; index += 1) {
    if (predicate()) return
    await Promise.resolve()
  }
  throw new Error(`WAR-06 harness did not reach ${description} after ${MAX_MICROTASK_TURNS} microtask turns.`)
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
    writeCache: true,
    now: () => new Date('2026-04-06T10:35:00.000Z'),
  }
  const trackingStop = await startTrackingRuntime(dependencies)
  const stopTrackingStatusBridge = startMissionTrackingStatusBridge({
    applySnapshot: dependencies.applySnapshot,
    applyStatus: dependencies.applyStatus,
  })
  const stop: RuntimeStop = async () => {
    stopTrackingStatusBridge()
    await trackingStop()
  }
  activeRuntimeStops.add(stop)
  if (hooks === undefined) {
    try {
      await stopRuntimeWithRetry(stop)
    } finally {
      activeRuntimeStops.delete(stop)
    }
    throw new Error('WAR-06 characterization did not capture tracking hooks.')
  }
  return { stop, hooks, notifyScopeChanged }
}

/**
 * These are intentionally red characterization tests, not acceptance gates.
 * When WAR-06.md is repaired, invert each defect assertion into a non-regression
 * guard rather than weakening it to an empty-result assertion. Keep the route
 * description and the repair evidence linked to docs/assurance/findings/war-06/WAR-06.md.
 */
describe.sequential('WAR-06 reachable lifecycle characterization (intentional red)', () => {
it('reproduces stale history publication at the real delayed poller flush [WAR-06-AUD-01]', async () => {
  const controller = await createMissionController()
  await controller.startMission({ name: 'Mission A' })
  useActiveMissionDevicesStore.getState().setDeviceActive('mission-a', 'device-1', true)
  let currentScope = scopeForMission('mission-a')
  const missionACurrent = snapshot('mission-a-current')
  const missionAHistory = stationaryHistory('mission-a-history')
  const missionBCurrent = snapshot('mission-b-current')
  const pendingMissionBCurrent = createDeferred<readonly NormalizedTrackingPosition[]>()
  pendingDeferredResolutions.add(() => pendingMissionBCurrent.resolve(missionBCurrent.positions))
  const pendingSecondHistoryPersistence = createDeferred<void>()
  pendingDeferredResolutions.add(() => pendingSecondHistoryPersistence.resolve())
  let currentPollCount = 0
  let requestPollNow: () => void = () => undefined
  let requestPollNowCallCount = 0
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
    getBreadcrumbs: vi.fn().mockResolvedValue(missionAHistory),
  }
  const { notifyScopeChanged } = await startCharacterizationRuntime({
    createClient: () => client,
    applySnapshot: applyCharacterizationSnapshot,
    scopeStatus: () => 'ready',
    readScope: () => currentScope,
    subscribeScope: () => () => undefined,
    createPoller: (pollerClient, hooks) => {
      const poller = createPollingManager(
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
          getBreadcrumbDeviceIds: () => useActiveMissionDevicesStore.getState().getActiveDeviceIds(
            useMissionStore.getState().currentMission?.id ?? null,
          ),
          getParticipantDeviceIds: () => currentScope.historicalDeviceIdsThrough(FIXED_NOW.toISOString()),
          persistHistoryChunk,
          ...withoutHistoryPersistenceHooks(hooks),
          now: () => FIXED_NOW,
          setTimeout: (callback, delay, ...args) => {
            scheduledDelays.push(delay)
            return globalThis.setTimeout(callback, delay, ...args)
          },
          clearTimeout: globalThis.clearTimeout,
        },
      )
      requestPollNow = () => {
        requestPollNowCallCount += 1
        poller.requestPollNow()
      }
      return { ...poller, requestPollNow }
    },
  })
  expect(notifyScopeChanged).toBeTypeOf('function')

  await vi.advanceTimersByTimeAsync(0)
  await flushMicrotasksUntil(() => scheduledDelays.includes(100), 'the delayed history publication timer')
  expect(client.getBreadcrumbs).toHaveBeenCalled()

  // The harness invokes the poller's wake wrapper to start a second poll while
  // the real 100 ms history publication timer is pending. The second poll
  // blocks on the Traccar current-position response; the real finish → idle →
  // start Mission B wakes therefore hit the real pollInFlight early return
  // before the timer publishes Mission A history.
  requestPollNow()
  await flushMicrotasksUntil(
    () => client.getCurrentPositions.mock.calls.length === 2,
    'the pending replacement current-position request',
  )
  expect(client.getCurrentPositions).toHaveBeenCalledTimes(2)
  await controller.finishMission()
  useActiveMissionDevicesStore.getState().setDeviceActive('mission-b', 'device-1', true)
  await controller.startMission({ name: 'Mission B' })
  currentScope = scopeForMission('mission-b')
  expect(useMissionStore.getState().phase).toBe('active')
  expect(useMissionStore.getState().currentMission?.id).toBe('mission-b')
  expect(requestPollNowCallCount).toBe(3)
  expect(client.getCurrentPositions).toHaveBeenCalledTimes(2)
  await vi.advanceTimersByTimeAsync(100)
  await flushMicrotasksUntil(
    () => useTrackingStore.getState().snapshot.breadcrumbs.some((position) => position.id === missionAHistory[0]!.id),
    'the stale Mission A history publication',
  )
  applyNegativeControlBeforeOracle()

  expect(useTrackingStore.getState().snapshot.positions.map((position) => position.id),
    'WAR-06 AUD-01 safety oracle: stale Mission A current coordinates remain visible under Mission B')
    .toContain(missionACurrent.positions[0]!.id)
  expect(useTrackingStore.getState().snapshot.breadcrumbs.map((position) => position.id),
    'WAR-06 AUD-01 safety oracle: stale Mission A history remains visible under Mission B')
    .toContain(missionAHistory[0]!.id)
  expect(useStationaryAttentionStore.getState(),
    'WAR-06 AUD-01 safety oracle: stale Mission A fix feeds Mission B stationary projection')
    .toMatchObject({
      missionId: 'mission-b',
      byDevice: { 'device-1': { state: 'attention', sinceTimestamp: missionAHistory[0]!.timestamp } },
    })

  pendingMissionBCurrent.resolve(missionBCurrent.positions)
  pendingSecondHistoryPersistence.resolve()
  pendingDeferredResolutions.clear()
})

it('reproduces deferred stale current-fix publication through finish-idle-start while a poll is in flight [WAR-06-AUD-02]', async () => {
  const controller = await createMissionController()
  await controller.startMission({ name: 'Mission A' })
  useActiveMissionDevicesStore.getState().setDeviceActive('mission-a', 'device-1', true)
  let scopeStatus: 'loading' | 'ready' = 'loading'
  let currentScope = scopeForMission('mission-a')
  const missionAHistory = stationaryHistory('mission-a-deferred-history')
  const missionACurrentFix = snapshot('mission-a-deferred-fix')
  const missionACurrent: TrackingSnapshot = {
    ...missionACurrentFix,
    positions: [...missionAHistory, ...missionACurrentFix.positions],
  }
  let finishRequested: Promise<Mission | null> | null = null
  let requestPollNowCallCount = 0
  const client: TrackingPollerClient = {
    authenticate: vi.fn().mockResolvedValue(undefined),
    getDevices: vi.fn().mockResolvedValue(missionACurrent.devices),
    getCurrentPositions: vi.fn().mockResolvedValue(missionACurrent.positions),
    getBreadcrumbs: vi.fn().mockResolvedValue(missionAHistory),
  }
  let replacement: Promise<Mission> | null = null
  const unsubscribeMissionTransition = useMissionStore.subscribe((state) => {
    if (state.phase === 'idle' && replacement === null) {
      useActiveMissionDevicesStore.getState().setDeviceActive('mission-b', 'device-1', true)
      replacement = controller.startMission({ name: 'Mission B' })
    }
  })
  try {
    const runtime = await startCharacterizationRuntime({
      createClient: () => client,
      applySnapshot: applyCharacterizationSnapshot,
      scopeStatus: () => scopeStatus,
      readScope: () => currentScope,
      subscribeScope: () => () => undefined,
      createPoller: (pollerClient, pollerHooks) => {
        let poller: ReturnType<typeof createPollingManager> | null = null
        const wrappedHooks: CapturedPollerHooks = {
          ...pollerHooks,
          onCurrentSnapshot: (nextSnapshot, context, observation) => {
            pollerHooks.onCurrentSnapshot(nextSnapshot, context, observation)
            if (finishRequested === null) {
              // Request the replacement turn while this real poll is still
              // in flight; the subsequent Mission A -> idle -> Mission B
              // wakes exercise the same production coalescing path.
              poller?.requestPollNow()
              finishRequested = controller.finishMission()
            }
          },
        }
        poller = createPollingManager(
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
            getBreadcrumbDeviceIds: () => useActiveMissionDevicesStore.getState().getActiveDeviceIds(
              useMissionStore.getState().currentMission?.id ?? null,
            ),
            getParticipantDeviceIds: () => currentScope.historicalDeviceIdsThrough(FIXED_NOW.toISOString()),
            ...withoutHistoryPersistenceHooks(wrappedHooks),
            now: () => FIXED_NOW,
            setTimeout: globalThis.setTimeout,
            clearTimeout: globalThis.clearTimeout,
          },
        )
        const requestPollNow = () => {
          requestPollNowCallCount += 1
          poller.requestPollNow()
        }
        return { ...poller, requestPollNow }
      },
    })
    await flushMicrotasksUntil(() => finishRequested !== null, 'the real Mission A current-fix callback')
    expect(client.getCurrentPositions).toHaveBeenCalledTimes(1)

    if (finishRequested === null) throw new Error('The real poller did not publish Mission A.')
    await finishRequested
    if (replacement === null) throw new Error('Mission controller did not publish idle.')
    await replacement
    expect(requestPollNowCallCount).toBe(2)
    expect(client.getCurrentPositions).toHaveBeenCalledTimes(1)
    expect(useMissionStore.getState().phase).toBe('active')
    expect(useMissionStore.getState().currentMission?.id).toBe('mission-b')
    currentScope = scopeForMission('mission-b')
    scopeStatus = 'ready'
    runtime.notifyScopeChanged()

    await flushMicrotasksUntil(
      () => useTrackingStore.getState().snapshot.positions.some((position) => position.id === 'mission-a-deferred-fix'),
      'the deferred Mission A current-fix publication',
    )
    applyNegativeControlBeforeOracle()
    expect(useTrackingStore.getState().snapshot.positions.map((position) => position.id),
      'WAR-06 AUD-02 safety oracle: deferred Mission A current fix remains visible under Mission B')
      .toContain('mission-a-deferred-fix')
    expect(useStationaryAttentionStore.getState(),
      'WAR-06 AUD-02 safety oracle: deferred Mission A fix feeds Mission B stationary projection')
      .toMatchObject({
        missionId: 'mission-b',
        byDevice: { 'device-1': { state: 'attention', sinceTimestamp: missionAHistory[0]!.timestamp } },
      })

    pendingDeferredResolutions.clear()
  } finally {
    unsubscribeMissionTransition()
  }
})

it('characterizes the unkeyed cached snapshot on Mission B cold start [WAR-06-CACHE-SIBLING]', async () => {
  const controller = await createMissionController()
  await controller.startMission({ name: 'Mission A' })
  await controller.finishMission()
  await controller.startMission({ name: 'Mission B' })
  useActiveMissionDevicesStore.getState().setDeviceActive('mission-b', 'device-1', true)
  const currentScope = scopeForMission('mission-b')
  const cachedSnapshot = snapshot('mission-a-cached-fix', {
    dataOrigin: 'cache',
    timestamp: '2026-04-06T10:34:00.000Z',
    breadcrumbs: stationaryHistory('mission-a-cached-history'),
  })
  const cachedContents = serializeTrackingCachePayload({
    cached_at: '2026-04-06T10:34:00.000Z',
    devices: cachedSnapshot.devices,
    positions: cachedSnapshot.positions,
    breadcrumbs: cachedSnapshot.breadcrumbs,
  })
  await startCharacterizationRuntime({
    cacheRead: vi.fn().mockResolvedValue(cachedContents),
    applySnapshot: applyCharacterizationSnapshot,
    scopeStatus: () => 'ready',
    readScope: () => currentScope,
    subscribeScope: () => () => undefined,
  })

  // Electron has one global tracking-cache.json. A relaunch while Mission B is
  // already active rehydrates Mission A's cached fix without any lifecycle
  // choreography or participant-scope delay.
  expect(useMissionStore.getState().currentMission?.id).toBe('mission-b')
  applyNegativeControlBeforeOracle()

  expect(useTrackingStore.getState().snapshot.positions.map((position) => position.id),
    'WAR-06 CACHE-SIBLING safety oracle: Mission A cache remains visible under Mission B')
    .toEqual(['mission-a-cached-fix'])
  expect(useStationaryAttentionStore.getState(),
    'WAR-06 CACHE-SIBLING safety oracle: Mission A cache feeds Mission B stationary projection')
    .toMatchObject({
      missionId: 'mission-b',
      byDevice: { 'device-1': { state: 'attention', sinceTimestamp: cachedSnapshot.breadcrumbs[0]!.timestamp } },
    })
})
})
