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
import { applyTrackingSnapshot, useTrackingStore } from '../../../../src/features/tracking/tracking-store'
import { useStationaryAttentionStore } from '../../../../src/features/tracking/stationary-attention-store'

type CapturedPollerHooks = Parameters<StartTrackingRuntimeDependencies['createPoller']>[1]
type RuntimeStop = Awaited<ReturnType<typeof startTrackingRuntime>>
type MissionStore = StartTrackingRuntimeDependencies['missionStore']
type PersistTrackingPositionsInput = Parameters<NonNullable<MissionStore['persistTrackingPositionsBulk']>>[0]

type PersistedTrackingWrite = {
  readonly missionId: string
  readonly positionIds: readonly string[]
}

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

/** Creates a stationary history with timestamps distinct from Mission A fixtures. */
function stationaryHistoryAfterMissionA(prefix: string): readonly NormalizedTrackingPosition[] {
  return [
    snapshot(`${prefix}-start`, { timestamp: '2026-04-06T10:10:00.000Z' }).positions[0]!,
    snapshot(`${prefix}-heartbeat`, { timestamp: '2026-04-06T10:30:00.000Z' }).positions[0]!,
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

/** Injects a stale publication only for the falsifiability control subprocess. */
function applyRepairControlBeforeOracle(staleSnapshot: TrackingSnapshot): void {
  if (process.env.WAR06_NEGATIVE_CONTROL !== 'inject-stale-publication') return
  applyCharacterizationSnapshot(staleSnapshot)
}

/** Asserts that no Mission A evidence crossed into the visible Mission B state. */
function assertNoMissionAUnderMissionB(input: {
  readonly oracle: string
  readonly stalePositionIds: readonly string[]
  readonly staleHistoryIds: readonly string[]
  readonly staleStationarySinceTimestamps: readonly string[]
  readonly publishedSnapshots?: readonly TrackingSnapshot[]
  readonly publishedStationarySinceTimestamps?: readonly (string | null)[]
}): void {
  const trackingSnapshot = useTrackingStore.getState().snapshot
  const stationary = useStationaryAttentionStore.getState()
  const positionIds = trackingSnapshot.positions.map((position) => position.id)
  const historyIds = trackingSnapshot.breadcrumbs.map((position) => position.id)
  expect(useMissionStore.getState().currentMission?.id, `${input.oracle}: active mission changed unexpectedly`)
    .toBe('mission-b')
  for (const staleId of input.stalePositionIds) {
    expect(positionIds, `${input.oracle}: stale Mission A current position ${staleId} remains visible under Mission B`)
      .not.toContain(staleId)
  }
  for (const staleId of input.staleHistoryIds) {
    expect(historyIds, `${input.oracle}: stale Mission A history ${staleId} remains visible under Mission B`)
      .not.toContain(staleId)
  }
  const stationarySinceTimestamps = Object.values(stationary.byDevice)
    .map((evaluation) => evaluation.sinceTimestamp)
  for (const staleTimestamp of input.staleStationarySinceTimestamps) {
    expect(stationarySinceTimestamps,
      `${input.oracle}: stale Mission A stationary evidence ${staleTimestamp} remains under Mission B`)
      .not.toContain(staleTimestamp)
  }
  for (const published of input.publishedSnapshots ?? []) {
    const publishedPositionIds = published.positions.map((position) => position.id)
    const publishedHistoryIds = published.breadcrumbs.map((position) => position.id)
    for (const staleId of input.stalePositionIds) {
      expect(publishedPositionIds,
        `${input.oracle}: stale Mission A current position ${staleId} was published under Mission B`)
        .not.toContain(staleId)
    }
    for (const staleId of input.staleHistoryIds) {
      expect(publishedHistoryIds,
        `${input.oracle}: stale Mission A history ${staleId} was published under Mission B`)
        .not.toContain(staleId)
    }
  }
  for (const publishedSinceTimestamp of input.publishedStationarySinceTimestamps ?? []) {
    for (const staleTimestamp of input.staleStationarySinceTimestamps) {
      expect(publishedSinceTimestamp,
        `${input.oracle}: stale Mission A stationary evidence ${staleTimestamp} was projected under Mission B`)
        .not.toBe(staleTimestamp)
    }
  }
}

/** Asserts that Mission B made progress after the stale producer settled. */
function assertFreshMissionBProgress(input: {
  readonly positionId: string
  readonly historyIds?: readonly string[]
}): void {
  const trackingSnapshot = useTrackingStore.getState().snapshot
  expect(trackingSnapshot.positions.map((position) => position.id)).toContain(input.positionId)
  for (const historyId of input.historyIds ?? []) {
    expect(trackingSnapshot.breadcrumbs.map((position) => position.id)).toContain(historyId)
  }
  expect(useStationaryAttentionStore.getState().missionId).toBe('mission-b')
}

/** Asserts that Mission B durable writes never adopted Mission A position ids. */
function assertNoCrossMissionPersistence(
  writes: readonly PersistedTrackingWrite[],
  stalePositionIds: readonly string[],
  oracle: string,
): void {
  for (const write of writes.filter((candidate) => candidate.missionId === 'mission-b')) {
    for (const staleId of stalePositionIds) {
      expect(write.positionIds,
        `${oracle}: stale Mission A position ${staleId} was persisted under Mission B`)
        .not.toContain(staleId)
    }
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

/** Drains settled publication continuations without waiting for unsafe output. */
async function drainMicrotasks(): Promise<void> {
  for (let index = 0; index < MAX_MICROTASK_TURNS; index += 1) {
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
  readonly missionStore?: Partial<MissionStore>
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
      ...input.missionStore,
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
 * These are repair oracles. They are expected to remain RED against the current
 * unrepaired production routes and turn GREEN only after production rejects
 * cross-mission publication. Keep each route description linked to
 * docs/assurance/findings/war-06/WAR-06.md.
 */
describe.sequential('WAR-06 reachable lifecycle repair oracles', () => {
it('rejects stale history publication at the real delayed poller flush [WAR-06-AUD-01-REPAIR]', async () => {
  const controller = await createMissionController()
  await controller.startMission({ name: 'Mission A' })
  useActiveMissionDevicesStore.getState().setDeviceActive('mission-a', 'device-1', true)
  let currentScope = scopeForMission('mission-a')
  const missionACurrent = snapshot('mission-a-current')
  const missionAHistory = stationaryHistory('mission-a-history')
  const missionALateCurrent = snapshot('mission-a-late-current')
  const missionBCurrent = snapshot('mission-b-current', {
    timestamp: '2026-04-06T10:35:00.000Z',
  })
  const pendingMissionALateCurrent = createDeferred<readonly NormalizedTrackingPosition[]>()
  pendingDeferredResolutions.add(() => pendingMissionALateCurrent.resolve(missionALateCurrent.positions))
  const missionBHistory = stationaryHistoryAfterMissionA('mission-b-history')
  const pendingSecondHistoryPersistence = createDeferred<void>()
  pendingDeferredResolutions.add(() => pendingSecondHistoryPersistence.resolve())
  let currentPollCount = 0
  let requestPollNow: () => void = () => undefined
  let requestPollNowCallCount = 0
  const scheduledDelays: number[] = []
  let initialHistoryPersistenceCount = 0
  const persistedWrites: PersistedTrackingWrite[] = []
  const persistTrackingPositionsBulk = vi.fn(async (input: PersistTrackingPositionsInput) => {
    persistedWrites.push({
      missionId: input.mission_id,
      positionIds: input.positions.map((position) => position.source_position_id ?? ''),
    })
    return {
      changedPositionCount: input.positions.length,
      insertedPositionCount: input.positions.length,
      skippedAmbiguousLegacyAdoptionCount: 0,
    }
  })
  const persistHistoryChunk = vi.fn((input: TrackingHistoryChunkPersistenceInput) => {
    if (input.phase !== 'initial') return Promise.resolve()
    initialHistoryPersistenceCount += 1
    return initialHistoryPersistenceCount === 1
      ? Promise.resolve({ changed: false })
      : pendingSecondHistoryPersistence.promise.then(() => ({ changed: false }))
  })
  let historyFetchCount = 0
  const client: TrackingPollerClient = {
    authenticate: vi.fn().mockResolvedValue(undefined),
    getDevices: vi.fn().mockResolvedValue(missionACurrent.devices),
    getCurrentPositions: vi.fn(() => {
      currentPollCount += 1
      return currentPollCount === 1
        ? Promise.resolve(missionACurrent.positions)
        : currentPollCount === 2
          ? pendingMissionALateCurrent.promise
          : Promise.resolve(missionBCurrent.positions)
    }),
    getBreadcrumbs: vi.fn(() => {
      historyFetchCount += 1
      return Promise.resolve(historyFetchCount === 1 ? missionAHistory : missionBHistory)
    }),
  }
  const { notifyScopeChanged } = await startCharacterizationRuntime({
    createClient: () => client,
    applySnapshot: applyCharacterizationSnapshot,
    missionStore: { persistTrackingPositionsBulk },
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
  await drainMicrotasks()
  const staleMissionASnapshot = {
    ...missionACurrent,
    breadcrumbs: missionAHistory,
  }
  applyRepairControlBeforeOracle(staleMissionASnapshot)
  assertNoMissionAUnderMissionB({
    oracle: 'WAR-06 AUD-01 repair safety oracle',
    stalePositionIds: missionACurrent.positions.map((position) => position.id),
    staleHistoryIds: missionAHistory.map((position) => position.id),
    staleStationarySinceTimestamps: missionAHistory.map((position) => position.timestamp),
  })

  pendingMissionALateCurrent.resolve(missionALateCurrent.positions)
  pendingSecondHistoryPersistence.resolve()
  await flushMicrotasksUntil(
    () => client.getCurrentPositions.mock.calls.length >= 3,
    'the fresh Mission B current-position request',
  )
  await flushMicrotasksUntil(
    () => useTrackingStore.getState().snapshot.positions.some((position) => position.id === missionBCurrent.positions[0]!.id),
    'the fresh Mission B current-position publication',
  )
  await vi.advanceTimersByTimeAsync(100)
  await flushMicrotasksUntil(
    () => useTrackingStore.getState().snapshot.breadcrumbs.some((position) => position.id === missionBHistory[0]!.id),
    'the fresh Mission B history publication',
  )
  assertFreshMissionBProgress({
    positionId: missionBCurrent.positions[0]!.id,
    historyIds: missionBHistory.map((position) => position.id),
  })
  assertNoMissionAUnderMissionB({
    oracle: 'WAR-06 AUD-01 repair safety oracle',
    stalePositionIds: missionACurrent.positions.map((position) => position.id),
    staleHistoryIds: missionAHistory.map((position) => position.id),
    staleStationarySinceTimestamps: missionAHistory.map((position) => position.timestamp),
  })
  assertNoCrossMissionPersistence(
    persistedWrites,
    missionACurrent.positions.map((position) => position.id),
    'WAR-06 AUD-01 repair safety oracle',
  )
  pendingDeferredResolutions.clear()
})

it('rejects deferred stale current-fix publication through finish-idle-start while a poll is in flight [WAR-06-AUD-02-REPAIR]', async () => {
  const controller = await createMissionController()
  await controller.startMission({ name: 'Mission A' })
  useActiveMissionDevicesStore.getState().setDeviceActive('mission-a', 'device-1', true)
  let scopeStatus: 'loading' | 'ready' = 'loading'
  let currentScope = scopeForMission('mission-a')
  const missionAHistory = stationaryHistory('mission-a-deferred-history')
  const missionACurrentFix = snapshot('mission-a-deferred-fix')
  const missionBHistory = stationaryHistoryAfterMissionA('mission-b-deferred-history')
  const missionBCurrentFix = snapshot('mission-b-fresh-fix', {
    timestamp: '2026-04-06T10:35:00.000Z',
  })
  const missionACurrent: TrackingSnapshot = {
    ...missionACurrentFix,
    positions: [...missionAHistory, ...missionACurrentFix.positions],
  }
  let finishRequested: Promise<Mission | null> | null = null
  let requestPollNowCallCount = 0
  const persistedWrites: PersistedTrackingWrite[] = []
  const persistTrackingPositionsBulk = vi.fn(async (input: PersistTrackingPositionsInput) => {
    persistedWrites.push({
      missionId: input.mission_id,
      positionIds: input.positions.map((position) => position.source_position_id ?? ''),
    })
    return {
      changedPositionCount: input.positions.length,
      insertedPositionCount: input.positions.length,
      skippedAmbiguousLegacyAdoptionCount: 0,
    }
  })
  let currentPollCount = 0
  const publishedSnapshots: TrackingSnapshot[] = []
  const publishedStationarySinceTimestamps: Array<string | null> = []
  const applySnapshot = (nextSnapshot: TrackingSnapshot): void => {
    publishedSnapshots.push(nextSnapshot)
    applyCharacterizationSnapshot(nextSnapshot)
    publishedStationarySinceTimestamps.push(
      Object.values(useStationaryAttentionStore.getState().byDevice)[0]?.sinceTimestamp ?? null,
    )
  }
  const client: TrackingPollerClient = {
    authenticate: vi.fn().mockResolvedValue(undefined),
    getDevices: vi.fn().mockResolvedValue(missionACurrent.devices),
    getCurrentPositions: vi.fn(() => {
      currentPollCount += 1
      return Promise.resolve(currentPollCount === 1 ? missionACurrent.positions : missionBCurrentFix.positions)
    }),
    getBreadcrumbs: vi.fn().mockResolvedValue(missionBHistory),
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
      applySnapshot,
      missionStore: { persistTrackingPositionsBulk },
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

    await drainMicrotasks()
    const staleMissionASnapshot = {
      ...missionACurrent,
      breadcrumbs: missionAHistory,
    }
    applyRepairControlBeforeOracle(staleMissionASnapshot)
    assertNoMissionAUnderMissionB({
      oracle: 'WAR-06 AUD-02 repair safety oracle',
      stalePositionIds: missionACurrent.positions.map((position) => position.id),
      staleHistoryIds: missionAHistory.map((position) => position.id),
      staleStationarySinceTimestamps: missionAHistory.map((position) => position.timestamp),
      publishedSnapshots,
      publishedStationarySinceTimestamps,
    })

    await flushMicrotasksUntil(
      () => useTrackingStore.getState().snapshot.positions.some((position) => position.id === missionBCurrentFix.positions[0]!.id),
      'the fresh Mission B current-fix publication',
    )
    await vi.advanceTimersByTimeAsync(100)
    await flushMicrotasksUntil(
      () => useTrackingStore.getState().snapshot.breadcrumbs.some((position) => position.id === missionBHistory[0]!.id),
      'the fresh Mission B history publication',
    )
    assertFreshMissionBProgress({
      positionId: missionBCurrentFix.positions[0]!.id,
      historyIds: missionBHistory.map((position) => position.id),
    })
    assertNoMissionAUnderMissionB({
      oracle: 'WAR-06 AUD-02 repair safety oracle',
      stalePositionIds: missionACurrent.positions.map((position) => position.id),
      staleHistoryIds: missionAHistory.map((position) => position.id),
      staleStationarySinceTimestamps: missionAHistory.map((position) => position.timestamp),
      publishedSnapshots,
      publishedStationarySinceTimestamps,
    })
    assertNoCrossMissionPersistence(
      persistedWrites,
      missionACurrent.positions.map((position) => position.id),
      'WAR-06 AUD-02 repair safety oracle',
    )

    pendingDeferredResolutions.clear()
  } finally {
    unsubscribeMissionTransition()
  }
})

it('rejects the unkeyed cached snapshot on Mission B cold start [WAR-06-CACHE-SIBLING-REPAIR]', async () => {
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
  // Keep this as a literal legacy fixture. A serializer that now requires an
  // explicit mission identity must not make the unkeyed-cache oracle disappear.
  const cachedContents = JSON.stringify({
    cached_at: '2026-04-06T10:34:00.000Z',
    devices: cachedSnapshot.devices,
    positions: cachedSnapshot.positions,
    breadcrumbs: cachedSnapshot.breadcrumbs,
  })
  const missionBHistory = stationaryHistoryAfterMissionA('mission-b-cache-history')
  const missionBCurrent = snapshot('mission-b-cache-fresh-fix', {
    timestamp: '2026-04-06T10:35:00.000Z',
    breadcrumbs: missionBHistory,
  })
  const publishedSnapshots: TrackingSnapshot[] = []
  const publishedStationarySinceTimestamps: Array<string | null> = []
  const persistedWrites: PersistedTrackingWrite[] = []
  const persistTrackingPositionsBulk = vi.fn(async (input: PersistTrackingPositionsInput) => {
    persistedWrites.push({
      missionId: input.mission_id,
      positionIds: input.positions.map((position) => position.source_position_id ?? ''),
    })
    return {
      changedPositionCount: input.positions.length,
      insertedPositionCount: input.positions.length,
      skippedAmbiguousLegacyAdoptionCount: 0,
    }
  })
  const applySnapshot = (nextSnapshot: TrackingSnapshot): void => {
    publishedSnapshots.push(nextSnapshot)
    applyCharacterizationSnapshot(nextSnapshot)
    publishedStationarySinceTimestamps.push(
      Object.values(useStationaryAttentionStore.getState().byDevice)[0]?.sinceTimestamp ?? null,
    )
  }
  const client: TrackingPollerClient = {
    authenticate: vi.fn().mockResolvedValue(undefined),
    getDevices: vi.fn().mockResolvedValue(missionBCurrent.devices),
    getCurrentPositions: vi.fn().mockResolvedValue(missionBCurrent.positions),
    getBreadcrumbs: vi.fn().mockResolvedValue(missionBHistory),
  }
  await startCharacterizationRuntime({
    cacheRead: vi.fn().mockResolvedValue(cachedContents),
    applySnapshot,
    missionStore: { persistTrackingPositionsBulk },
    scopeStatus: () => 'ready',
    readScope: () => currentScope,
    subscribeScope: () => () => undefined,
    createClient: () => client,
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
        getBreadcrumbDeviceIds: () => useActiveMissionDevicesStore.getState().getActiveDeviceIds(
          useMissionStore.getState().currentMission?.id ?? null,
        ),
        getParticipantDeviceIds: () => currentScope.historicalDeviceIdsThrough(FIXED_NOW.toISOString()),
        ...withoutHistoryPersistenceHooks(hooks),
        now: () => FIXED_NOW,
        setTimeout: globalThis.setTimeout,
        clearTimeout: globalThis.clearTimeout,
      },
    ),
  })

  // Electron has one global tracking-cache.json. This serialized payload is the
  // legacy unkeyed form and must be discarded when Mission B is already active.
  await flushMicrotasksUntil(
    () => useTrackingStore.getState().snapshot.positions.some((position) => position.id === missionBCurrent.positions[0]!.id),
    'the fresh Mission B current-position publication after cold start',
  )
  await vi.advanceTimersByTimeAsync(100)
  await flushMicrotasksUntil(
    () => useTrackingStore.getState().snapshot.breadcrumbs.some((position) => position.id === missionBHistory[0]!.id),
    'the fresh Mission B history publication after cold start',
  )
  const staleMissionASnapshot = cachedSnapshot
  applyRepairControlBeforeOracle(staleMissionASnapshot)
  assertNoMissionAUnderMissionB({
    oracle: 'WAR-06 CACHE-SIBLING repair safety oracle',
    stalePositionIds: cachedSnapshot.positions.map((position) => position.id),
    staleHistoryIds: cachedSnapshot.breadcrumbs.map((position) => position.id),
    staleStationarySinceTimestamps: cachedSnapshot.breadcrumbs.map((position) => position.timestamp),
    publishedSnapshots,
    publishedStationarySinceTimestamps,
  })
  assertFreshMissionBProgress({
    positionId: missionBCurrent.positions[0]!.id,
    historyIds: missionBHistory.map((position) => position.id),
  })
  assertNoCrossMissionPersistence(
    persistedWrites,
    cachedSnapshot.positions.map((position) => position.id),
    'WAR-06 CACHE-SIBLING repair safety oracle',
  )
})
})
