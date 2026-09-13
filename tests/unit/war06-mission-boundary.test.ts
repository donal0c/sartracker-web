import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import devicesFixture from '../fixtures/traccar-devices.json'
import positionsFixture from '../fixtures/traccar-positions.json'
import {
  createPollingManager,
  type TrackingPollerClient,
  type TrackingSnapshotContext,
} from '../../src/features/tracking/polling-manager'
import {
  normalizeTraccarDevice,
  normalizeTraccarPosition,
} from '../../src/features/tracking/traccar-normalization'
import {
  startTrackingRuntime,
  type StartTrackingRuntimeDependencies,
} from '../../src/features/tracking/start-tracking-runtime'
import { useMissionStore } from '../../src/features/mission/mission-store'
import { createParticipationScope } from '../../src/features/participants/participation-scope'
import type { Mission } from '../../src/infrastructure/mission-store/tauri-mission-store'
import type {
  NormalizedTrackingPosition,
  TrackingSnapshot,
  TrackingConnectionStatus,
} from '../../src/features/tracking/tracking-types'

type RuntimeHooks = Parameters<StartTrackingRuntimeDependencies['createPoller']>[1]
type RuntimeStop = Awaited<ReturnType<typeof startTrackingRuntime>>

const NOW = new Date('2026-04-06T10:35:00.000Z')
const BASE_DEVICE = normalizeTraccarDevice(devicesFixture[0]!)
const BASE_POSITION = normalizeTraccarPosition(positionsFixture[0]!, 'live')
const BASE_CACHE_POSITION = normalizeTraccarPosition(positionsFixture[0]!, 'cache')
const activeRuntimeStops = new Set<RuntimeStop>()
const activePollers = new Set<ReturnType<typeof createPollingManager>>()
const pendingDeferredResolutions = new Set<() => void>()

beforeEach(() => {
  vi.useFakeTimers()
  useMissionStore.setState(useMissionStore.getInitialState())
})

afterEach(async () => {
  for (const resolve of pendingDeferredResolutions) resolve()
  pendingDeferredResolutions.clear()
  const failures: unknown[] = []
  for (const stop of [...activeRuntimeStops]) {
    try {
      await stop()
    } catch (error) {
      failures.push(error)
    } finally {
      activeRuntimeStops.delete(stop)
    }
  }
  for (const poller of [...activePollers]) {
    try {
      await poller.stop()
    } catch (error) {
      failures.push(error)
    } finally {
      activePollers.delete(poller)
    }
  }
  useMissionStore.setState(useMissionStore.getInitialState())
  vi.clearAllTimers()
  vi.useRealTimers()
  if (failures.length > 0) throw new AggregateError(failures, 'WAR-06 runtime cleanup failed.')
})

/** Creates the mission shape used by the runtime store in these boundary tests. */
function mission(id: string): Mission {
  return {
    id,
    name: id,
    status: 'active',
    start_time: '2026-04-06T09:00:00.000Z',
    pause_time: null,
    finish_time: null,
    paused_seconds: 0,
    notes: null,
    schema_version: 1,
  }
}

/** Selects an active mission or the explicit idle state. */
function setCurrentMission(id: string | null): void {
  useMissionStore.setState({
    phase: id === null ? 'idle' : 'active',
    currentMission: id === null ? null : mission(id),
  })
}

/** Creates a mission scope that authorizes the fixture device for its mission. */
function scopeForMission(missionId: string) {
  return createParticipationScope({
    participants: [{
      id: `participant-${missionId}`,
      mission_id: missionId,
      kind: 'device',
      traccar_device_id: BASE_DEVICE.device_id,
      mission_team_id: null,
      traccar_group_id: null,
      team_name: null,
      provenance: 'explicit',
      effective_from: '2026-04-06T09:00:00.000Z',
      added_at: '2026-04-06T09:00:00.000Z',
      added_by: 'WAR-06 boundary test',
      removed_at: null,
      removed_by: null,
    }],
    membershipEvents: [],
  })
}

/** Creates one position-bearing snapshot with a recognizable source identity. */
function snapshot(
  id: string,
  dataOrigin: 'live' | 'cache' = 'live',
): TrackingSnapshot {
  const position: NormalizedTrackingPosition = {
    ...BASE_POSITION,
    id,
    data_origin: dataOrigin,
    timestamp: '2026-04-06T10:34:00.000Z',
  }
  return {
    devices: [{ ...BASE_DEVICE, last_seen: position.timestamp }],
    positions: [position],
    breadcrumbs: [],
  }
}

/** Creates a cache JSON payload while allowing the pre-repair shape to be tested. */
function cacheContents(missionId: string | null | undefined): string {
  const payload: Record<string, unknown> = {
    cached_at: '2026-04-06T10:34:00.000Z',
    devices: [{ ...BASE_DEVICE }],
    positions: [BASE_CACHE_POSITION],
    breadcrumbs: [],
  }
  if (missionId !== undefined) payload.mission_id = missionId
  return JSON.stringify(payload)
}

/** Resolves a deferred promise from a test without retaining a mutable resolver. */
function createDeferred<T>(): {
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
} {
  let settled = false
  let resolvePromise: (value: T) => void = () => undefined
  const release = (): void => {
    if (settled) return
    settled = true
    pendingDeferredResolutions.delete(release)
    resolvePromise(undefined as T)
  }
  const promise = new Promise<T>((resolve) => {
    resolvePromise = (value) => {
      if (settled) return
      settled = true
      pendingDeferredResolutions.delete(release)
      resolve(value)
    }
  })
  pendingDeferredResolutions.add(release)
  return { promise, resolve: resolvePromise }
}

/** Lets runtime queue lanes complete their bounded promise turns. */
async function flushMicrotasks(turns = 8): Promise<void> {
  for (let index = 0; index < turns; index += 1) await Promise.resolve()
}

/** Builds a small runtime with captured poller hooks and safe test cleanup. */
async function startRuntime(input: {
  readonly now?: () => Date
  readonly missionStore?: Partial<StartTrackingRuntimeDependencies['missionStore']>
  readonly cacheRead?: () => Promise<string | null>
  readonly cacheWrite?: (contents: string) => Promise<string>
  readonly applySnapshot?: (snapshot: TrackingSnapshot) => void
  readonly applyStatus?: (status: TrackingConnectionStatus) => void
  readonly missionModelEnabled?: boolean
  readonly readParticipationScope?: () => ReturnType<typeof scopeForMission>
  readonly readParticipationScopeStatus?: () => 'loading' | 'ready' | 'error'
  readonly subscribeParticipationScope?: (listener: () => void) => () => void
  readonly writeCache?: boolean
  readonly recordMissionEvidenceLoss?: (missionId: string, reason: string) => Promise<void>
} = {}): Promise<{
  readonly stop: RuntimeStop
  readonly hooks: RuntimeHooks
  readonly requestPollNow: ReturnType<typeof vi.fn>
  readonly cacheWrite: ReturnType<typeof vi.fn>
  readonly applyStatus: ReturnType<typeof vi.fn>
}> {
  let hooks: RuntimeHooks | undefined
  const requestPollNow = vi.fn()
  const cacheWrite = vi.fn(input.cacheWrite ?? (async () => '/tmp/tracking-cache.json'))
  const applyStatus = vi.fn(input.applyStatus)
  const createPoller = vi.fn((_client: unknown, candidateHooks: RuntimeHooks) => {
    hooks = candidateHooks
    return {
      start: vi.fn(),
      stop: vi.fn().mockResolvedValue(undefined),
      requestPollNow,
    }
  })
  const dependencies: StartTrackingRuntimeDependencies = {
    config: { baseUrl: 'http://war-06.invalid' },
    createClient: vi.fn().mockReturnValue({}),
    createPoller,
    cache: {
      read: input.cacheRead ?? vi.fn().mockResolvedValue(null),
      write: cacheWrite,
    },
    missionStore: {
      getActiveMission: vi.fn(async () => {
        const currentMission = useMissionStore.getState().currentMission
        return currentMission === null ? null : { id: currentMission.id }
      }),
      listPositions: vi.fn().mockResolvedValue([]),
      upsertDevice: vi.fn().mockResolvedValue(undefined),
      addPosition: vi.fn().mockResolvedValue(undefined),
      ...input.missionStore,
    },
    applySnapshot: input.applySnapshot ?? vi.fn(),
    applyStatus,
    missionModelEnabled: input.missionModelEnabled,
    readParticipationScope: input.readParticipationScope,
    readParticipationScopeStatus: input.readParticipationScopeStatus,
    subscribeParticipationScope: input.subscribeParticipationScope,
    writeCache: input.writeCache,
    recordMissionEvidenceLoss: input.recordMissionEvidenceLoss,
    now: input.now ?? (() => NOW),
  }
  const stop = await startTrackingRuntime(dependencies)
  activeRuntimeStops.add(stop)
  if (hooks === undefined) throw new Error('WAR-06 boundary test did not capture runtime hooks.')
  return { stop, hooks, requestPollNow, cacheWrite, applyStatus }
}

describe('WAR-06 mission boundary repair contract', () => {
  it.each(['snapshot', 'history'] as const)('never silently acknowledges queued accepted %s evidence after runtime replacement', async (route) => {
    setCurrentMission('mission-a')
    const heldWrite = createDeferred<void>()
    const firstStarted = createDeferred<void>()
    const addPosition = vi.fn().mockImplementationOnce(async () => {
      firstStarted.resolve()
      await heldWrite.promise
    }).mockResolvedValue(undefined)
    const recordMissionEvidenceLoss = vi.fn().mockResolvedValue(undefined)
    const runtime = await startRuntime({ missionStore: { addPosition }, recordMissionEvidenceLoss, writeCache: false })
    const first = runtime.hooks.onSnapshot(snapshot('accepted-first'), { historyResetKey: 'mission-a' })
    await firstStarted.promise
    const second = route === 'snapshot'
      ? runtime.hooks.onSnapshot(snapshot('accepted-second'), { historyResetKey: 'mission-a' })
      : runtime.hooks.persistHistoryChunk({ phase: 'initial', expectedMissionId: 'mission-a',
        deviceId: BASE_DEVICE.device_id, historyFrom: '2026-04-06T09:00:00Z',
        reconciledUntil: NOW.toISOString(), positions: snapshot('accepted-second').positions })
    const settledSecond = Promise.resolve(second).then(() => 'fulfilled', () => 'rejected')
    await flushMicrotasks()
    await startRuntime({ writeCache: false })
    heldWrite.resolve()
    await first
    const result = await settledSecond
    expect(addPosition).toHaveBeenCalledTimes(1)
    expect(recordMissionEvidenceLoss).toHaveBeenCalledWith('mission-a', 'mission_persistence_failed')
    if (route === 'history') expect(result).toBe('rejected')
  })

  it.each(['recovery', 'active'] as const)('preserves matching %s cache positions when an empty current poll arrives during participant loading', async (phase) => {
    useMissionStore.setState({ phase, currentMission: phase === 'active' ? mission('mission-a') : null,
      recoverableMission: phase === 'recovery' ? mission('mission-a') : null })
    let status: 'loading' | 'ready' = 'loading'
    let notify = (): void => undefined
    const applySnapshot = vi.fn()
    const runtime = await startRuntime({
      cacheRead: async () => cacheContents('mission-a'), applySnapshot, missionModelEnabled: true,
      readParticipationScope: () => scopeForMission('mission-a'), readParticipationScopeStatus: () => status,
      subscribeParticipationScope: (listener) => { notify = listener; return () => undefined },
    })
    useMissionStore.setState({ phase: 'active', currentMission: mission('mission-a'), recoverableMission: null })
    runtime.hooks.onCurrentSnapshot({ devices: [], positions: [], breadcrumbs: [] },
      { historyResetKey: 'mission-a', missionEvidenceId: null },
      { missionId: null, claim: vi.fn(), complete: vi.fn() })
    status = 'ready'
    notify()
    expect(applySnapshot).toHaveBeenLastCalledWith(expect.objectContaining({
      positions: [expect.objectContaining({ id: BASE_CACHE_POSITION.id, data_origin: 'cache' })],
    }))
  })

  it.each(['mission-a', null])('keeps omitted adapter context bound to its original %s identity', async (initialMission) => {
    setCurrentMission(initialMission)
    const applySnapshot = vi.fn()
    const runtime = await startRuntime({ applySnapshot })
    await runtime.hooks.onSnapshot(snapshot('initial-context'))
    expect(applySnapshot).toHaveBeenLastCalledWith(expect.objectContaining({
      positions: [expect.objectContaining({ id: 'initial-context' })],
    }))
    setCurrentMission(initialMission === null ? 'mission-a' : 'mission-b')
    applySnapshot.mockClear()
    runtime.cacheWrite.mockClear()
    await runtime.hooks.onSnapshot(snapshot('late-contextless'))
    expect(applySnapshot).not.toHaveBeenCalled()
    expect(runtime.cacheWrite).not.toHaveBeenCalled()
    await runtime.hooks.onSnapshot(snapshot('explicit-idle'), { historyResetKey: null })
    expect(applySnapshot).not.toHaveBeenCalled()
    expect(runtime.cacheWrite).not.toHaveBeenCalled()
  })

  it.each([10 * 60_000, 5 * 60 * 60_000])('rechecks recovery cache age after waiting %i ms before Resume', async (elapsed) => {
    useMissionStore.setState({ phase: 'recovery', currentMission: null, recoverableMission: mission('mission-a') })
    let currentTime = NOW
    const applySnapshot = vi.fn()
    await startRuntime({ cacheRead: async () => cacheContents('mission-a'), applySnapshot,
      now: () => currentTime, missionModelEnabled: true,
      readParticipationScope: () => scopeForMission('mission-a'), readParticipationScopeStatus: () => 'ready' })
    currentTime = new Date(NOW.getTime() + elapsed)
    useMissionStore.setState({ phase: 'active', currentMission: mission('mission-a'), recoverableMission: null })
    const positions = applySnapshot.mock.calls.at(-1)?.[0].positions ?? []
    if (elapsed > 4 * 60 * 60_000) expect(positions).toEqual([])
    else expect(positions).toEqual([expect.objectContaining({ cache_age_seconds: 60 + elapsed / 1000,
      device_cache_stale: true })])
  })

  it.each([
    ['matching active mission', 'mission-a', 'mission-a', true],
    ['different active mission', 'mission-b', 'mission-a', false],
    ['legacy cache without identity', 'mission-a', undefined, false],
    ['explicit idle cache', null, null, true],
    ['legacy cache while idle', null, undefined, false],
  ] as const)('accepts cache only for an explicit identity: %s', async (
    _label,
    currentMissionId,
    cachedMissionId,
    shouldApply,
  ) => {
    setCurrentMission(currentMissionId)
    const applySnapshot = vi.fn()
    const runtime = await startRuntime({
      cacheRead: vi.fn().mockResolvedValue(cacheContents(cachedMissionId)),
      applySnapshot,
      writeCache: false,
    })

    expect(applySnapshot).toHaveBeenCalledTimes(shouldApply ? 1 : 0)
    await runtime.stop()
    activeRuntimeStops.delete(runtime.stop)
  })

  it('keeps a cache mismatch warning visible through offline status until fresh current data arrives', async () => {
    setCurrentMission('mission-b')
    const runtime = await startRuntime({
      cacheRead: vi.fn().mockResolvedValue(cacheContents('mission-a')),
      writeCache: false,
    })

    runtime.hooks.onStatusChange({
      mode: 'offline',
      consecutiveFailures: 1,
      recovered: false,
      lastSuccessAt: null,
      warning: 'OFFLINE MODE — showing last known positions.',
    })
    expect(runtime.applyStatus).toHaveBeenLastCalledWith(expect.objectContaining({
      mode: 'offline',
      warning: expect.stringMatching(/could not be matched.*this mission/i),
    }))

    runtime.hooks.onCurrentSnapshot(
      snapshot('mission-b-current'),
      { historyResetKey: 'mission-b', missionEvidenceId: null },
      { missionId: null, claim: vi.fn(), complete: vi.fn() },
    )
    runtime.hooks.onStatusChange({
      mode: 'online',
      consecutiveFailures: 0,
      recovered: true,
      lastSuccessAt: NOW.toISOString(),
      warning: null,
    })
    expect(runtime.applyStatus).toHaveBeenLastCalledWith(expect.objectContaining({
      mode: 'online',
      warning: null,
    }))

    await runtime.stop()
    activeRuntimeStops.delete(runtime.stop)
  })

  it('holds a recovery cache until Mission A resumes, then discards it on Mission B', async () => {
    useMissionStore.setState({
      phase: 'recovery',
      currentMission: null,
      recoverableMission: mission('mission-a'),
    })
    let scopeStatus: 'loading' | 'ready' = 'loading'
    let notifyScopeChanged: () => void = () => undefined
    const applySnapshot = vi.fn()
    const runtime = await startRuntime({
      cacheRead: vi.fn().mockResolvedValue(cacheContents('mission-a')),
      applySnapshot,
      missionModelEnabled: true,
      readParticipationScope: () => scopeForMission('mission-a'),
      readParticipationScopeStatus: () => scopeStatus,
      subscribeParticipationScope: (listener) => {
        notifyScopeChanged = listener
        return () => undefined
      },
    })

    expect(applySnapshot).not.toHaveBeenCalled()
    await runtime.hooks.onSnapshot(
      { devices: [], positions: [], breadcrumbs: [] },
      { historyResetKey: null, missionEvidenceId: null },
    )
    expect(runtime.cacheWrite).not.toHaveBeenCalled()

    scopeStatus = 'ready'
    useMissionStore.setState({
      phase: 'active',
      currentMission: mission('mission-a'),
      recoverableMission: null,
    })
    notifyScopeChanged()
    await flushMicrotasks()

    expect(applySnapshot).toHaveBeenLastCalledWith(expect.objectContaining({
      positions: [expect.objectContaining({
        data_origin: 'cache',
        cache_age_seconds: 60,
      })],
    }))
    expect(runtime.applyStatus).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'offline',
      warning: expect.stringMatching(/last known positions from cache/i),
    }))

    const callsBeforeReplacement = applySnapshot.mock.calls.length
    useMissionStore.setState({
      phase: 'active',
      currentMission: mission('mission-b'),
      recoverableMission: null,
    })
    expect(applySnapshot).toHaveBeenLastCalledWith({
      devices: [], positions: [], breadcrumbs: [],
    })
    notifyScopeChanged()
    await flushMicrotasks()
    expect(applySnapshot.mock.calls.slice(callsBeforeReplacement).flatMap(([next]) =>
      next.positions.map((position: NormalizedTrackingPosition) => position.id),
    )).not.toContain(BASE_CACHE_POSITION.id)

    await runtime.stop()
    activeRuntimeStops.delete(runtime.stop)
  })

  it('discards a cache read admitted for Mission A when Mission B is active before it settles', async () => {
    setCurrentMission('mission-a')
    const cacheRead = createDeferred<string | null>()
    const applySnapshot = vi.fn()
    const starting = startRuntime({
      cacheRead: () => cacheRead.promise,
      applySnapshot,
      writeCache: false,
    })

    await flushMicrotasks()
    setCurrentMission('mission-b')
    cacheRead.resolve(cacheContents('mission-a'))
    const runtime = await starting

    expect(applySnapshot).not.toHaveBeenCalled()
    await runtime.stop()
    activeRuntimeStops.delete(runtime.stop)
  })

  it('clears the visible state at a direct active Mission A to Mission B switch and rejects stale callbacks', async () => {
    setCurrentMission('mission-a')
    let scope = scopeForMission('mission-a')
    const applySnapshot = vi.fn()
    const runtime = await startRuntime({
      applySnapshot,
      missionModelEnabled: true,
      readParticipationScope: () => scope,
      readParticipationScopeStatus: () => 'ready',
      writeCache: false,
    })

    runtime.hooks.onSnapshot(snapshot('mission-a-current'), {
      historyResetKey: 'mission-a',
      missionEvidenceId: null,
    })
    await flushMicrotasks()
    expect(applySnapshot.mock.calls.at(-1)?.[0].positions.map((position) => position.id))
      .toEqual(['mission-a-current'])

    scope = scopeForMission('mission-b')
    setCurrentMission('mission-b')
    const boundaryCallCount = applySnapshot.mock.calls.length
    expect(applySnapshot.mock.calls.at(-1)?.[0].positions).toEqual([])
    expect(runtime.requestPollNow).toHaveBeenCalled()

    await runtime.hooks.onSnapshot(snapshot('mission-a-stale'), {
      historyResetKey: 'mission-a',
      missionEvidenceId: null,
    })
    expect(applySnapshot.mock.calls.slice(boundaryCallCount).flatMap(([next]) =>
      next.positions.map((position: NormalizedTrackingPosition) => position.id)))
      .not.toContain('mission-a-stale')
    await runtime.stop()
    activeRuntimeStops.delete(runtime.stop)
  })

  it('does not let a stale callback update cache or retention while accepted evidence still settles', async () => {
    setCurrentMission('mission-a')
    let scope = scopeForMission('mission-a')
    const applySnapshot = vi.fn()
    const recordMissionEvidenceLoss = vi.fn().mockResolvedValue(undefined)
    const runtime = await startRuntime({
      applySnapshot,
      missionModelEnabled: true,
      readParticipationScope: () => scope,
      readParticipationScopeStatus: () => 'ready',
      recordMissionEvidenceLoss,
    })

    runtime.hooks.onCurrentSnapshot(
      snapshot('mission-a-current'),
      { historyResetKey: 'mission-a', missionEvidenceId: null },
      { missionId: null, claim: vi.fn(), complete: vi.fn() },
    )
    await flushMicrotasks()
    runtime.cacheWrite.mockClear()

    scope = scopeForMission('mission-b')
    setCurrentMission('mission-b')
    const boundaryCallCount = applySnapshot.mock.calls.length
    const staleObservation = {
      missionId: 'mission-a',
      claim: vi.fn(),
      complete: vi.fn(),
    }
    runtime.hooks.onCurrentSnapshot(
      snapshot('mission-a-stale'),
      { historyResetKey: 'mission-a', missionEvidenceId: 'mission-a' },
      staleObservation,
    )
    expect(staleObservation.claim).toHaveBeenCalledOnce()
    await flushMicrotasks()

    expect(runtime.cacheWrite).not.toHaveBeenCalled()
    expect(applySnapshot.mock.calls.slice(boundaryCallCount).flatMap(([next]) =>
      next.positions.map((position: NormalizedTrackingPosition) => position.id)))
      .not.toContain('mission-a-stale')

    await runtime.stop()
    activeRuntimeStops.delete(runtime.stop)
    expect(staleObservation.complete).toHaveBeenCalledOnce()
  })

  it('keeps the original mission identity on pending cache writes and scopes dedupe by mission', async () => {
    setCurrentMission('mission-a')
    const firstWrite = createDeferred<string>()
    const cacheWrite = vi.fn()
      .mockImplementationOnce(() => firstWrite.promise)
      .mockResolvedValue('/tmp/tracking-cache.json')
    const runtime = await startRuntime({ cacheWrite })
    const sharedSnapshot = snapshot('same-snapshot')
    const firstAdmission = runtime.hooks.onSnapshot(snapshot('first-snapshot'), {
      historyResetKey: 'mission-a',
      missionEvidenceId: null,
    })
    await flushMicrotasks()
    expect(cacheWrite).toHaveBeenCalledTimes(1)

    const pendingAdmission = runtime.hooks.onSnapshot(sharedSnapshot, {
      historyResetKey: 'mission-a',
      missionEvidenceId: null,
    })
    await flushMicrotasks()
    expect(cacheWrite).toHaveBeenCalledTimes(1)

    setCurrentMission('mission-b')
    firstWrite.resolve('/tmp/tracking-cache.json')
    await Promise.all([firstAdmission, pendingAdmission])
    await flushMicrotasks(12)

    const pendingPayload = JSON.parse(cacheWrite.mock.calls[1]![0] as string) as Record<string, unknown>
    expect(pendingPayload.mission_id).toBe('mission-a')

    const replacementAdmission = runtime.hooks.onSnapshot(sharedSnapshot, {
      historyResetKey: 'mission-b',
      missionEvidenceId: null,
    })
    await replacementAdmission
    await flushMicrotasks(12)

    expect(cacheWrite).toHaveBeenCalledTimes(3)
    expect(JSON.parse(cacheWrite.mock.calls[2]![0] as string).mission_id)
      .toBe('mission-b')
    await runtime.stop()
    activeRuntimeStops.delete(runtime.stop)
  })
})

describe('WAR-06 polling fallback boundary', () => {
  function createClient(
    currentPositions: ReturnType<typeof vi.fn>,
  ): TrackingPollerClient {
    return {
      authenticate: vi.fn().mockResolvedValue(undefined),
      getDevices: vi.fn().mockResolvedValue([BASE_DEVICE]),
      getCurrentPositions: currentPositions,
      getBreadcrumbs: vi.fn().mockResolvedValue([]),
    }
  }

  function pollingOptions(
    missionId: () => string,
    onSnapshot: (snapshot: TrackingSnapshot, context: TrackingSnapshotContext) => void,
  ) {
    return {
      intervalMs: 5_000,
      staleThresholdMs: 60 * 60 * 1000,
      getPollingMode: () => 'active' as const,
      getHistoryResetKey: missionId,
      onSnapshot,
      onStatusChange: vi.fn<(
        status: TrackingConnectionStatus,
      ) => void>(),
      now: () => NOW,
    }
  }

  it('does not republish Mission A current positions under Mission B after a direct switch and B fetch failure', async () => {
    let missionId = 'mission-a'
    const missionACurrent = snapshot('mission-a-current').positions
    const client = createClient(vi.fn()
      .mockResolvedValueOnce(missionACurrent)
      .mockRejectedValueOnce(new Error('Mission B provider unavailable')))
    const onSnapshot = vi.fn()
    const poller = createPollingManager(
      client,
      pollingOptions(() => missionId, onSnapshot),
    )
    activePollers.add(poller)

    poller.start()
    await vi.advanceTimersByTimeAsync(0)
    missionId = 'mission-b'
    poller.requestPollNow()
    await vi.advanceTimersByTimeAsync(0)

    const missionBPublications = onSnapshot.mock.calls.filter(([, context]) =>
      context.historyResetKey === 'mission-b')
    expect(client.getCurrentPositions).toHaveBeenCalledTimes(2)
    expect(missionBPublications.flatMap(([next]) =>
      next.positions.map((position: NormalizedTrackingPosition) => position.id)))
      .not.toContain('mission-a-current')
    await poller.stop()
    activePollers.delete(poller)
  })

  it('retains a legitimate current position on a same-mission fetch failure', async () => {
    const missionId = 'mission-a'
    const missionACurrent = snapshot('mission-a-current').positions
    const client = createClient(vi.fn()
      .mockResolvedValueOnce(missionACurrent)
      .mockRejectedValueOnce(new Error('temporary provider outage')))
    const onSnapshot = vi.fn()
    const poller = createPollingManager(
      client,
      pollingOptions(() => missionId, onSnapshot),
    )
    activePollers.add(poller)

    poller.start()
    await vi.advanceTimersByTimeAsync(0)
    poller.requestPollNow()
    await vi.advanceTimersByTimeAsync(0)

    const fallback = onSnapshot.mock.calls.at(-1)
    expect(fallback?.[1].historyResetKey).toBe('mission-a')
    expect(fallback?.[0].positions.map((position: NormalizedTrackingPosition) => position.id))
      .toContain('mission-a-current')
    await poller.stop()
    activePollers.delete(poller)
  })
})
