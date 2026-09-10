import { afterEach, expect, it, vi } from 'vitest'
import { startTrackingRuntime, type StartTrackingRuntimeDependencies } from '../../src/features/tracking/start-tracking-runtime'
import { createPollingManager, type TrackingPollerClient } from '../../src/features/tracking/polling-manager'
import { useMissionStore } from '../../src/features/mission/mission-store'
import type { TrackingSnapshot } from '../../src/features/tracking/tracking-types'
import devicesFixture from '../fixtures/traccar-devices.json'
import positionsFixture from '../fixtures/traccar-positions.json'
import { normalizeTraccarDevice, normalizeTraccarPosition } from '../../src/features/tracking/traccar-normalization'
import { createDeferredMissionEvidenceQueue } from '../../src/features/tracking/deferred-mission-evidence'

afterEach(() => {
  useMissionStore.setState(useMissionStore.getInitialState())
  vi.useRealTimers()
})

it('revokes old rejection publication synchronously across queued response interleavings [A-R18]', async () => {
  const unsuppressedOffsets: number[] = []
  for (let offset = 0; offset < 16; offset++) {
    useMissionStore.setState({ phase: 'active', currentMission: {
      id: 'm', name: 'Retirement ordering', status: 'active',
      start_time: '2026-04-06T09:00:00Z', pause_time: null,
      finish_time: null, paused_seconds: 0, notes: null, schema_version: 1,
    } })
    const held = Promise.withResolvers<void>()
    let generation = 0
    let oldRequests = 0
    const dependencies: StartTrackingRuntimeDependencies = {
      config: { baseUrl: 'http://synthetic.invalid' }, createClient: () => ({}),
      createPoller: (_client, hooks) => {
        const mine = ++generation
        return createPollingManager({
          authenticate: async () => undefined, getDevices: async () => [], getBreadcrumbs: async () => [],
          getCurrentPositions: async () => {
            if (mine === 1) { oldRequests++; await held.promise }
            return []
          },
        }, { ...hooks, intervalMs: 5000, staleThresholdMs: 60000,
          getPollingMode: () => 'active', getHistoryResetKey: () => 'm',
          onCurrentPositionRejections: (_rows, context) => {
            if (mine !== generation && !context.suppressOperationalPublication) unsuppressedOffsets.push(offset)
          },
        })
      },
      cache: { read: async () => null, write: async (value) => value }, writeCache: false,
      missionStore: { getActiveMission: async () => ({ id: 'm' }), listPositions: async () => [],
        upsertDevice: async () => undefined, addPosition: async () => undefined },
      applySnapshot: () => undefined, applyStatus: () => undefined,
    }
    const stop = await startTrackingRuntime(dependencies)
    try {
      for (let turn = 0; turn < 30 && oldRequests === 0; turn++) await Promise.resolve()
      expect(oldRequests).toBe(1)
      held.resolve()
      for (let turn = 0; turn < offset; turn++) await Promise.resolve()
      await stop.reconfigure!(dependencies)
      for (let turn = 0; turn < 40; turn++) await Promise.resolve()
    } finally { held.resolve(); await stop() }
  }
  expect(unsuppressedOffsets).toEqual([])
})

it('does not reserve evidence capacity for a retired authentication request [AUD-13]', async () => {
  vi.useFakeTimers()
  const authentication = Promise.withResolvers<void>()
  const queue = createDeferredMissionEvidenceQueue<number>({ capacity: 8,
    beginObservation: (missionId) => ({ missionId, complete: () => undefined }),
    persist: async () => undefined, markEvidenceLoss: async () => undefined,
  })
  const current = vi.fn().mockResolvedValue([])
  const options = { intervalMs: 5000, staleThresholdMs: 60000,
    onSnapshot: () => undefined, onStatusChange: () => undefined,
    reserveCurrentEvidenceCapacity: (signal: AbortSignal) => queue.reserveCapacity(signal),
  }
  const client = { authenticate: () => authentication.promise, getCurrentPositions: current,
    getDevices: async () => [], getBreadcrumbs: async () => [],
  }
  for (let index = 0; index < 8; index++) {
    const old = createPollingManager(client, options)
    old.start()
    await vi.advanceTimersByTimeAsync(1)
    await old.stop()
  }
  const newest = createPollingManager({ ...client, authenticate: async () => undefined }, options)
  try {
    newest.start()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(current).toHaveBeenCalled()
  } finally {
    authentication.resolve()
    await vi.advanceTimersByTimeAsync(1)
    await newest.stop()
  }
})

for (const reload of [false, true]) {
  it(`retains a delayed source fix through saturated custody: ${reload ? 'reload' : 'control'} [AUD-13]`, async () => {
    vi.useFakeTimers()
    useMissionStore.setState({ phase: 'active', currentMission: {
      id: 'm', name: 'Synthetic custody', status: 'active',
      start_time: '2026-04-06T09:00:00.000Z', pause_time: null,
      finish_time: null, paused_seconds: 0, notes: null, schema_version: 1,
    } })
    const write = Promise.withResolvers<void>()
    const current = Promise.withResolvers<void>()
    let requests = 0
    const persisted: string[] = []
    const published: string[] = []
    const loss = vi.fn()
    const client: TrackingPollerClient = {
      authenticate: async () => undefined,
      getDevices: async () => devicesFixture.map(normalizeTraccarDevice),
      getCurrentPositions: async () => {
        const id = ++requests
        if (id === 1) await current.promise
        return [{ ...normalizeTraccarPosition(positionsFixture[0]!, 'live'),
          id: `fix-${id}`, timestamp: new Date(Date.UTC(2026, 3, 6, 10, 0, id)).toISOString() }]
      },
      getBreadcrumbs: async () => [],
    }
    const dependencies: StartTrackingRuntimeDependencies = {
      config: { baseUrl: 'http://synthetic.invalid' }, createClient: () => client,
      createPoller: (candidate, hooks) => createPollingManager(candidate as TrackingPollerClient, {
        ...hooks, intervalMs: 5000, staleThresholdMs: 60000,
        getPollingMode: () => 'active', getHistoryResetKey: () => 'm',
      }),
      cache: { read: async () => null, write: async (contents) => contents }, writeCache: false,
      missionStore: {
        getActiveMission: async () => ({ id: 'm' }), listPositions: async () => [],
        upsertDevice: async () => undefined, addPosition: async () => undefined,
        addPositionsBulk: async (input) => {
          await write.promise
          persisted.push(...input.positions.map((position) => position.source_position_id!))
          return []
        },
      },
      applySnapshot: (snapshot: TrackingSnapshot) => {
        const id = snapshot.positions[0]?.id
        if (id !== undefined) published.push(id)
      },
      applyStatus: () => undefined, recordMissionEvidenceLoss: loss,
    }
    const stop = await startTrackingRuntime(dependencies)
    try {
      await vi.advanceTimersByTimeAsync(1)
      if (reload) await stop.reconfigure!(dependencies)
      await vi.advanceTimersByTimeAsync(100_000)
      expect(requests).toBe(reload ? 8 : 1)
      current.resolve()
      await vi.advanceTimersByTimeAsync(1000)
      if (reload) expect(published).not.toContain('fix-1')
      expect(loss).not.toHaveBeenCalled()
      write.resolve()
      await vi.advanceTimersByTimeAsync(10_000)
      expect(persisted).toContain('fix-1')
      expect(loss).not.toHaveBeenCalled()
    } finally {
      current.resolve()
      write.resolve()
      await vi.advanceTimersByTimeAsync(1)
      await stop()
    }
  })
}
