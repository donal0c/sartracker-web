import { describe, expect, it, vi } from 'vitest'

import devicesFixture from '../fixtures/traccar-devices.json'
import positionsFixture from '../fixtures/traccar-positions.json'
import {
  normalizeTraccarDevice,
  normalizeTraccarPosition,
} from '../../src/features/tracking/traccar-normalization'
import type { TrackingConnectionStatus, TrackingSnapshot } from '../../src/features/tracking/tracking-types'
import { startTrackingRuntime } from '../../src/features/tracking/start-tracking-runtime'

const SNAPSHOT: TrackingSnapshot = {
  devices: devicesFixture.map((device) => normalizeTraccarDevice(device)),
  positions: positionsFixture.map((position) => normalizeTraccarPosition(position, 'live')),
  breadcrumbs: positionsFixture.map((position) => normalizeTraccarPosition(position, 'live')),
}

const CACHED_SNAPSHOT: TrackingSnapshot = {
  devices: SNAPSHOT.devices,
  positions: positionsFixture.map((position) => normalizeTraccarPosition(position, 'cache')),
  breadcrumbs: positionsFixture.map((position) => normalizeTraccarPosition(position, 'cache')),
}

describe('startTrackingRuntime', () => {
  it('does not start tracking when the runtime config is missing', async () => {
    const applySnapshot = vi.fn()
    const applyStatus = vi.fn()

    const stop = await startTrackingRuntime({
      config: null,
      createClient: vi.fn(),
      createPoller: vi.fn(),
      cache: { read: vi.fn(), write: vi.fn() },
      missionStore: createMissionStoreStub(),
      applySnapshot,
      applyStatus,
      now: () => new Date('2026-04-06T10:35:00.000Z'),
    })

    expect(applySnapshot).not.toHaveBeenCalled()
    expect(applyStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'idle',
      }),
    )

    stop()
  })

  // Regression for `sartracker-web-el9`: when a non-null tracking config arrives at
  // bootstrap (provider=traccar_http, auto_connect=true, secret present in OS keychain),
  // the runtime must construct AND start the poller. Without this assertion, a regression
  // that builds the poller but forgets to start it would silently produce the same
  // operator-visible "no devices, last success: never" failure mode as the original bug.
  it('starts the poller when the runtime config is present', async () => {
    const start = vi.fn()
    const stop = vi.fn()
    const createPoller = vi.fn().mockReturnValue({ start, stop })
    const applyStatus = vi.fn()

    await startTrackingRuntime({
      config: { baseUrl: 'http://test:8082' },
      createClient: vi.fn().mockReturnValue({}),
      createPoller,
      cache: { read: vi.fn().mockResolvedValue(null), write: vi.fn() },
      missionStore: createMissionStoreStub(),
      applySnapshot: vi.fn(),
      applyStatus,
      now: () => new Date('2026-04-06T10:35:00.000Z'),
    })

    expect(createPoller).toHaveBeenCalledTimes(1)
    expect(start).toHaveBeenCalledTimes(1)
    expect(applyStatus).not.toHaveBeenCalledWith(
      expect.objectContaining({
        warning: expect.stringMatching(/not configured/i),
      }),
    )
  })

  it('hydrates the UI from cache before polling starts', async () => {
    const applySnapshot = vi.fn()
    const createPoller = vi.fn().mockReturnValue({ start: vi.fn(), stop: vi.fn() })

    await startTrackingRuntime({
      config: { baseUrl: 'http://test:8082' },
      createClient: vi.fn(),
      createPoller,
      cache: {
        read: vi.fn().mockResolvedValue(
          JSON.stringify({
            cached_at: '2026-04-06T10:35:00.000Z',
            devices: CACHED_SNAPSHOT.devices,
            positions: CACHED_SNAPSHOT.positions,
            breadcrumbs: CACHED_SNAPSHOT.breadcrumbs,
          }),
        ),
        write: vi.fn(),
      },
      missionStore: createMissionStoreStub(),
      applySnapshot,
      applyStatus: vi.fn(),
      now: () => new Date('2026-04-06T10:35:00.000Z'),
    })

    expect(applySnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        devices: CACHED_SNAPSHOT.devices,
        positions: expect.arrayContaining([
          expect.objectContaining({
            data_origin: 'cache',
            cache_age_seconds: 0,
          }),
        ]),
      }),
    )
    expect(createPoller).toHaveBeenCalledTimes(1)
  })

  // V1 regression coverage (sartracker-web-8gw):
  // Cold-start-offline must show an unambiguous warning so operators do not silently
  // act on stale cached positions. Before this guard, the runtime hydrated cached
  // tracking but published no status warning, leaving the operator to assume live data.
  it('publishes an offline warning when cold-starting from cache before the first live poll succeeds', async () => {
    const applyStatus = vi.fn()

    await startTrackingRuntime({
      config: { baseUrl: 'http://test:8082' },
      createClient: vi.fn().mockReturnValue({}),
      createPoller: vi.fn().mockReturnValue({ start: vi.fn(), stop: vi.fn() }),
      cache: {
        read: vi.fn().mockResolvedValue(
          JSON.stringify({
            cached_at: '2026-04-06T10:33:00.000Z',
            devices: CACHED_SNAPSHOT.devices,
            positions: CACHED_SNAPSHOT.positions,
            breadcrumbs: CACHED_SNAPSHOT.breadcrumbs,
          }),
        ),
        write: vi.fn(),
      },
      missionStore: createMissionStoreStub(),
      applySnapshot: vi.fn(),
      applyStatus,
      now: () => new Date('2026-04-06T10:35:00.000Z'),
    })

    expect(applyStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'offline',
        warning: expect.stringMatching(/cache|cached|last known|offline/i),
        lastSuccessAt: '2026-04-06T10:33:00.000Z',
      }),
    )
  })

  it('does not publish an offline warning if no usable cache exists', async () => {
    const applyStatus = vi.fn()

    await startTrackingRuntime({
      config: { baseUrl: 'http://test:8082' },
      createClient: vi.fn().mockReturnValue({}),
      createPoller: vi.fn().mockReturnValue({ start: vi.fn(), stop: vi.fn() }),
      cache: {
        read: vi.fn().mockResolvedValue(null),
        write: vi.fn(),
      },
      missionStore: createMissionStoreStub(),
      applySnapshot: vi.fn(),
      applyStatus,
      now: () => new Date('2026-04-06T10:35:00.000Z'),
    })

    expect(applyStatus).not.toHaveBeenCalled()
  })

  it('ignores cache snapshots older than the max cache age', async () => {
    const applySnapshot = vi.fn()

    await startTrackingRuntime({
      config: { baseUrl: 'http://test:8082' },
      createClient: vi.fn(),
      createPoller: vi.fn().mockReturnValue({ start: vi.fn(), stop: vi.fn() }),
      cache: {
        read: vi.fn().mockResolvedValue(
          JSON.stringify({
            cached_at: '2026-04-06T06:00:00.000Z',
            devices: CACHED_SNAPSHOT.devices,
            positions: CACHED_SNAPSHOT.positions,
            breadcrumbs: CACHED_SNAPSHOT.breadcrumbs,
          }),
        ),
        write: vi.fn(),
      },
      missionStore: createMissionStoreStub(),
      applySnapshot,
      applyStatus: vi.fn(),
      now: () => new Date('2026-04-06T10:35:00.000Z'),
    })

    expect(applySnapshot).not.toHaveBeenCalled()
  })

  it('ignores malformed cache payloads and still starts the poller', async () => {
    const applySnapshot = vi.fn()
    const createPoller = vi.fn().mockReturnValue({ start: vi.fn(), stop: vi.fn() })

    await startTrackingRuntime({
      config: { baseUrl: 'http://test:8082' },
      createClient: vi.fn(),
      createPoller,
      cache: {
        read: vi.fn().mockResolvedValue('{not-valid-json'),
        write: vi.fn(),
      },
      missionStore: createMissionStoreStub(),
      applySnapshot,
      applyStatus: vi.fn(),
      now: () => new Date('2026-04-06T10:35:00.000Z'),
    })

    expect(applySnapshot).not.toHaveBeenCalled()
    expect(createPoller).toHaveBeenCalledTimes(1)
  })

  it('persists devices and deduplicated positions into the active mission on snapshot updates', async () => {
    const upsertDevice = vi.fn().mockResolvedValue(undefined)
    const addPosition = vi.fn().mockResolvedValue(undefined)
    let pollerHooks:
      | {
          onSnapshot: (snapshot: TrackingSnapshot) => void | Promise<void>
          onStatusChange: (status: TrackingConnectionStatus) => void
        }
      | undefined

    await startTrackingRuntime({
      config: { baseUrl: 'http://test:8082' },
      createClient: vi.fn().mockReturnValue({}),
      createPoller: vi.fn().mockImplementation((_client, hooks) => {
        pollerHooks = hooks
        return { start: vi.fn(), stop: vi.fn() }
      }),
      cache: {
        read: vi.fn().mockResolvedValue(null),
        write: vi.fn().mockResolvedValue('/tmp/tracking-cache.json'),
      },
      missionStore: createMissionStoreStub({
        getActiveMission: vi.fn().mockResolvedValue({ id: 'mission-1' }),
        listPositions: vi.fn().mockResolvedValue([
          {
            device_id: '1',
            timestamp: SNAPSHOT.positions[0].timestamp,
          },
        ]),
        upsertDevice,
        addPosition,
      }),
      applySnapshot: vi.fn(),
      applyStatus: vi.fn(),
      now: () => new Date('2026-04-06T10:35:00.000Z'),
    })

    await pollerHooks?.onSnapshot(SNAPSHOT)

    expect(upsertDevice).toHaveBeenCalledTimes(2)
    expect(addPosition).toHaveBeenCalledTimes(1)
    expect(addPosition).toHaveBeenCalledWith(
      expect.objectContaining({
        mission_id: 'mission-1',
        device_id: '2',
      }),
    )
  })

  it('persists same-second distinct Traccar positions when their upstream ids differ [DON-233]', async () => {
    const addPositionsBulk = vi.fn().mockResolvedValue(undefined)
    const sameSecondBreadcrumbs = [
      {
        ...SNAPSHOT.breadcrumbs[0]!,
        id: 'traccar-9001',
        device_id: '2',
        lat: 52.001,
        lon: -9.701,
        timestamp: '2026-04-06T10:00:05.000Z',
      },
      {
        ...SNAPSHOT.breadcrumbs[0]!,
        id: 'traccar-9002',
        device_id: '2',
        lat: 52.002,
        lon: -9.702,
        timestamp: '2026-04-06T10:00:05.000Z',
      },
    ] satisfies readonly TrackingSnapshot['breadcrumbs'][number][]
    let pollerHooks:
      | {
          onSnapshot: (snapshot: TrackingSnapshot) => void | Promise<void>
          onStatusChange: (status: TrackingConnectionStatus) => void
        }
      | undefined

    await startTrackingRuntime({
      config: { baseUrl: 'http://test:8082' },
      createClient: vi.fn().mockReturnValue({}),
      createPoller: vi.fn().mockImplementation((_client, hooks) => {
        pollerHooks = hooks
        return { start: vi.fn(), stop: vi.fn() }
      }),
      cache: {
        read: vi.fn().mockResolvedValue(null),
        write: vi.fn().mockResolvedValue('/tmp/tracking-cache.json'),
      },
      missionStore: createMissionStoreStub({
        getActiveMission: vi.fn().mockResolvedValue({ id: 'mission-1' }),
        listPositions: vi.fn().mockResolvedValue([]),
        addPositionsBulk,
      }),
      applySnapshot: vi.fn(),
      applyStatus: vi.fn(),
      writeCache: false,
      now: () => new Date('2026-04-06T10:35:00.000Z'),
    })

    await pollerHooks?.onSnapshot({
      ...SNAPSHOT,
      breadcrumbs: sameSecondBreadcrumbs,
      rawBreadcrumbsForPersistence: sameSecondBreadcrumbs,
      positions: [],
    })

    expect(addPositionsBulk).toHaveBeenCalledWith({
      mission_id: 'mission-1',
      positions: expect.arrayContaining([
        expect.objectContaining({ id: 'traccar-9001' }),
        expect.objectContaining({ id: 'traccar-9002' }),
      ]),
    })
    expect(addPositionsBulk.mock.calls[0]![0].positions).toHaveLength(2)
  })

  it('records diagnostic breadcrumbs for tracking status and snapshot summaries [DON-226]', async () => {
    const recordDiagnosticEvent = vi.fn().mockResolvedValue(undefined)
    let pollerHooks:
      | {
          onSnapshot: (snapshot: TrackingSnapshot) => void | Promise<void>
          onStatusChange: (status: TrackingConnectionStatus) => void
        }
      | undefined

    await startTrackingRuntime({
      config: { baseUrl: 'http://test:8082' },
      createClient: vi.fn().mockReturnValue({}),
      createPoller: vi.fn().mockImplementation((_client, hooks) => {
        pollerHooks = hooks
        return { start: vi.fn(), stop: vi.fn() }
      }),
      cache: {
        read: vi.fn().mockResolvedValue(null),
        write: vi.fn().mockResolvedValue('/tmp/tracking-cache.json'),
      },
      missionStore: createMissionStoreStub({
        getActiveMission: vi.fn().mockResolvedValue({ id: 'mission-1' }),
        listPositions: vi.fn().mockResolvedValue([]),
      }),
      applySnapshot: vi.fn(),
      applyStatus: vi.fn(),
      recordDiagnosticEvent,
      now: () => new Date('2026-04-06T10:35:00.000Z'),
    })

    pollerHooks?.onStatusChange({
      mode: 'offline',
      consecutiveFailures: 2,
      recovered: false,
      lastSuccessAt: null,
      warning: 'Tracking feed unavailable.',
    })
    await pollerHooks?.onSnapshot({
      ...SNAPSHOT,
      breadcrumbMetadata: {
        totalObserved: 100,
        totalRetained: 40,
        deviceBudgets: [
          {
            deviceId: '2',
            retained: 40,
            total: 100,
            firstTimestamp: '2026-04-06T09:00:00.000Z',
            lastTimestamp: '2026-04-06T10:30:00.000Z',
            truncated: true,
          },
        ],
      },
    })

    expect(recordDiagnosticEvent).toHaveBeenCalledWith({
      level: 'warn',
      category: 'tracking',
      event: 'tracking_status_changed',
      fields: {
        mode: 'offline',
        consecutiveFailures: 2,
        recovered: false,
        hasWarning: true,
      },
    })
    expect(recordDiagnosticEvent).toHaveBeenCalledWith({
      level: 'info',
      category: 'tracking',
      event: 'tracking_snapshot_applied',
      fields: {
        deviceCount: SNAPSHOT.devices.length,
        currentPositionCount: SNAPSHOT.positions.length,
        breadcrumbCount: SNAPSHOT.breadcrumbs.length,
        retainedBreadcrumbCount: 40,
        observedBreadcrumbCount: 100,
        truncatedDeviceCount: 1,
      },
    })
  })

  it('reuses persisted position keys across snapshots for the same active mission', async () => {
    const listPositions = vi.fn().mockResolvedValue([
      {
        device_id: SNAPSHOT.positions[0].device_id,
        timestamp: SNAPSHOT.positions[0].timestamp,
      },
    ])
    const addPosition = vi.fn().mockResolvedValue(undefined)
    let pollerHooks:
      | {
          onSnapshot: (snapshot: TrackingSnapshot) => void | Promise<void>
          onStatusChange: (status: TrackingConnectionStatus) => void
        }
      | undefined

    await startTrackingRuntime({
      config: { baseUrl: 'http://test:8082' },
      createClient: vi.fn().mockReturnValue({}),
      createPoller: vi.fn().mockImplementation((_client, hooks) => {
        pollerHooks = hooks
        return { start: vi.fn(), stop: vi.fn() }
      }),
      cache: {
        read: vi.fn().mockResolvedValue(null),
        write: vi.fn().mockResolvedValue('/tmp/tracking-cache.json'),
      },
      missionStore: createMissionStoreStub({
        getActiveMission: vi.fn().mockResolvedValue({ id: 'mission-1' }),
        listPositions,
        addPosition,
      }),
      applySnapshot: vi.fn(),
      applyStatus: vi.fn(),
      now: () => new Date('2026-04-06T10:35:00.000Z'),
    })

    await pollerHooks?.onSnapshot(SNAPSHOT)
    await pollerHooks?.onSnapshot(SNAPSHOT)

    expect(listPositions).toHaveBeenCalledTimes(1)
    expect(addPosition).toHaveBeenCalledTimes(1)
  })

  it('does not rewrite the tracking cache when the published snapshot payload is unchanged [DON-235]', async () => {
    const cacheWrite = vi.fn().mockResolvedValue('/tmp/tracking-cache.json')
    let pollerHooks:
      | {
          onSnapshot: (snapshot: TrackingSnapshot) => void | Promise<void>
          onStatusChange: (status: TrackingConnectionStatus) => void
        }
      | undefined

    await startTrackingRuntime({
      config: { baseUrl: 'http://test:8082' },
      createClient: vi.fn().mockReturnValue({}),
      createPoller: vi.fn().mockImplementation((_client, hooks) => {
        pollerHooks = hooks
        return { start: vi.fn(), stop: vi.fn() }
      }),
      cache: {
        read: vi.fn().mockResolvedValue(null),
        write: cacheWrite,
      },
      missionStore: createMissionStoreStub({
        getActiveMission: vi.fn().mockResolvedValue({ id: 'mission-1' }),
        listPositions: vi.fn().mockResolvedValue([]),
      }),
      applySnapshot: vi.fn(),
      applyStatus: vi.fn(),
      now: () => new Date('2026-04-06T10:35:00.000Z'),
    })

    await pollerHooks?.onSnapshot(SNAPSHOT)
    await pollerHooks?.onSnapshot(SNAPSHOT)

    expect(cacheWrite).toHaveBeenCalledTimes(1)
  })

  it('provides persisted mission positions as initial poller breadcrumbs', async () => {
    let pollerHooks:
      | {
          onSnapshot: (snapshot: TrackingSnapshot) => void | Promise<void>
          onStatusChange: (status: TrackingConnectionStatus) => void
          getInitialBreadcrumbs: () => Promise<readonly TrackingSnapshot['breadcrumbs'][number][]>
        }
      | undefined

    await startTrackingRuntime({
      config: { baseUrl: 'http://test:8082' },
      createClient: vi.fn().mockReturnValue({}),
      createPoller: vi.fn().mockImplementation((_client, hooks) => {
        pollerHooks = hooks
        return { start: vi.fn(), stop: vi.fn() }
      }),
      cache: {
        read: vi.fn().mockResolvedValue(null),
        write: vi.fn().mockResolvedValue('/tmp/tracking-cache.json'),
      },
      missionStore: createMissionStoreStub({
        getActiveMission: vi.fn().mockResolvedValue({ id: 'mission-1' }),
        listPositions: vi.fn().mockResolvedValue([
          {
            id: 'pos-1',
            device_id: '1',
            lat: 52.01,
            lon: -9.01,
            altitude: null,
            speed: null,
            battery: null,
            accuracy: null,
            source: 'traccar',
            timestamp: '2026-04-06T10:05:00.000Z',
            data_origin: 'live',
          },
          {
            id: 'pos-2',
            device_id: '2',
            lat: 52.02,
            lon: -9.02,
            altitude: null,
            speed: null,
            battery: null,
            accuracy: null,
            source: 'traccar',
            timestamp: '2026-04-06T10:03:00.000Z',
            data_origin: 'cache',
          },
        ]),
      }),
      applySnapshot: vi.fn(),
      applyStatus: vi.fn(),
      now: () => new Date('2026-04-06T10:35:00.000Z'),
    })

    await expect(
      pollerHooks?.getInitialBreadcrumbs(),
    ).resolves.toEqual([
      expect.objectContaining({
        id: 'pos-1',
        device_id: '1',
        lat: 52.01,
        lon: -9.01,
        timestamp: '2026-04-06T10:05:00.000Z',
        data_origin: 'live',
      }),
      expect.objectContaining({
        id: 'pos-2',
        device_id: '2',
        lat: 52.02,
        lon: -9.02,
        timestamp: '2026-04-06T10:03:00.000Z',
        data_origin: 'cache',
      }),
    ])
  })

  it('keeps the live snapshot applied when cache and mission persistence side effects fail', async () => {
    const applySnapshot = vi.fn()
    const logger = { warn: vi.fn() }
    let pollerHooks:
      | {
          onSnapshot: (snapshot: TrackingSnapshot) => void | Promise<void>
          onStatusChange: (status: TrackingConnectionStatus) => void
        }
      | undefined

    await startTrackingRuntime({
      config: { baseUrl: 'http://test:8082' },
      createClient: vi.fn().mockReturnValue({}),
      createPoller: vi.fn().mockImplementation((_client, hooks) => {
        pollerHooks = hooks
        return { start: vi.fn(), stop: vi.fn() }
      }),
      cache: {
        read: vi.fn().mockResolvedValue(null),
        write: vi.fn().mockRejectedValue(new Error('cache write failed')),
      },
      missionStore: createMissionStoreStub({
        getActiveMission: vi.fn().mockResolvedValue({ id: 'mission-1' }),
        listPositions: vi.fn().mockResolvedValue([]),
        upsertDevice: vi.fn().mockRejectedValue(new Error('device persistence failed')),
      }),
      applySnapshot,
      applyStatus: vi.fn(),
      logger,
      now: () => new Date('2026-04-06T10:35:00.000Z'),
    })

    await expect(pollerHooks?.onSnapshot(SNAPSHOT)).resolves.toBeUndefined()

    expect(applySnapshot).toHaveBeenCalledWith(SNAPSHOT)
    expect(logger.warn).toHaveBeenCalledWith(
      'Tracking cache update failed.',
      expect.any(Error),
    )
    expect(logger.warn).toHaveBeenCalledWith(
      'Tracking mission persistence failed.',
      expect.any(Error),
    )
  })

  it('can cap browser-only mission persistence without trimming the live map snapshot', async () => {
    const applySnapshot = vi.fn()
    const cacheWrite = vi.fn().mockResolvedValue('/tmp/tracking-cache.json')
    const addPosition = vi.fn().mockResolvedValue(undefined)
    const breadcrumbs = Array.from({ length: 5 }, (_, index) => ({
      ...SNAPSHOT.breadcrumbs[0]!,
      id: `breadcrumb-${index}`,
      timestamp: new Date(Date.UTC(2026, 3, 6, 10, index, 0)).toISOString(),
    }))
    const largeSnapshot = {
      ...SNAPSHOT,
      breadcrumbs,
    } satisfies TrackingSnapshot
    let pollerHooks:
      | {
          onSnapshot: (snapshot: TrackingSnapshot) => void | Promise<void>
          onStatusChange: (status: TrackingConnectionStatus) => void
        }
      | undefined

    await startTrackingRuntime({
      config: { baseUrl: 'http://test:8082' },
      createClient: vi.fn().mockReturnValue({}),
      createPoller: vi.fn().mockImplementation((_client, hooks) => {
        pollerHooks = hooks
        return { start: vi.fn(), stop: vi.fn() }
      }),
      cache: {
        read: vi.fn().mockResolvedValue(null),
        write: cacheWrite,
      },
      missionStore: createMissionStoreStub({
        getActiveMission: vi.fn().mockResolvedValue({ id: 'mission-1' }),
        listPositions: vi.fn().mockResolvedValue([]),
        addPosition,
      }),
      applySnapshot,
      applyStatus: vi.fn(),
      maxPersistedPositionsPerSnapshot: SNAPSHOT.positions.length + 2,
      writeCache: false,
      now: () => new Date('2026-04-06T10:35:00.000Z'),
    })

    await pollerHooks?.onSnapshot(largeSnapshot)

    expect(applySnapshot).toHaveBeenCalledWith(largeSnapshot)
    expect(cacheWrite).not.toHaveBeenCalled()
    expect(addPosition).toHaveBeenCalledTimes(SNAPSHOT.positions.length + 2)
    expect(addPosition.mock.calls.map((call) => call[0].timestamp)).toEqual([
      breadcrumbs[3]!.timestamp,
      breadcrumbs[4]!.timestamp,
      SNAPSHOT.positions[0]!.timestamp,
      SNAPSHOT.positions[1]!.timestamp,
    ])
  })

  it('leaves Electron mission persistence uncapped by default [DON-159]', async () => {
    const addPosition = vi.fn().mockResolvedValue(undefined)
    const noisyBreadcrumbs = Array.from({ length: 8 }, (_, index) => ({
      ...SNAPSHOT.breadcrumbs[0]!,
      id: `noisy-${index}`,
      device_id: '2',
      timestamp: new Date(Date.UTC(2026, 5, 13, 0, 0, index)).toISOString(),
    }))
    const quietBreadcrumbs = Array.from({ length: 3 }, (_, index) => ({
      ...SNAPSHOT.breadcrumbs[0]!,
      id: `quiet-${index}`,
      device_id: '25',
      timestamp: new Date(Date.UTC(2026, 5, 12, 12, 0, index)).toISOString(),
    }))
    const snapshot = {
      ...SNAPSHOT,
      breadcrumbs: [...quietBreadcrumbs, ...noisyBreadcrumbs],
    } satisfies TrackingSnapshot
    let pollerHooks:
      | {
          onSnapshot: (snapshot: TrackingSnapshot) => void | Promise<void>
          onStatusChange: (status: TrackingConnectionStatus) => void
        }
      | undefined

    await startTrackingRuntime({
      config: { baseUrl: 'http://test:8082' },
      createClient: vi.fn().mockReturnValue({}),
      createPoller: vi.fn().mockImplementation((_client, hooks) => {
        pollerHooks = hooks
        return { start: vi.fn(), stop: vi.fn() }
      }),
      cache: {
        read: vi.fn().mockResolvedValue(null),
        write: vi.fn().mockResolvedValue('/tmp/tracking-cache.json'),
      },
      missionStore: createMissionStoreStub({
        getActiveMission: vi.fn().mockResolvedValue({ id: 'mission-1' }),
        listPositions: vi.fn().mockResolvedValue([]),
        addPosition,
      }),
      applySnapshot: vi.fn(),
      applyStatus: vi.fn(),
      writeCache: false,
      now: () => new Date('2026-06-13T21:48:51.654Z'),
    })

    await pollerHooks?.onSnapshot(snapshot)

    expect(addPosition).toHaveBeenCalledWith(expect.objectContaining({ device_id: '2' }))
    expect(addPosition).toHaveBeenCalledWith(expect.objectContaining({ device_id: '25' }))
    expect(
      addPosition.mock.calls.filter(
        (call) => call[0].device_id === '2' && String(call[0].timestamp).startsWith('2026-06-13'),
      ),
    ).toHaveLength(8)
    expect(
      addPosition.mock.calls.filter(
        (call) => call[0].device_id === '25' && String(call[0].timestamp).startsWith('2026-06-12'),
      ),
    ).toHaveLength(3)
  })

  it('persists raw newly fetched breadcrumbs even when the render snapshot is budgeted [DON-159]', async () => {
    const addPosition = vi.fn().mockResolvedValue(undefined)
    const rawBreadcrumbs = Array.from({ length: 6_001 }, (_, index) => ({
      ...SNAPSHOT.breadcrumbs[0]!,
      id: `raw-eoc-${index}`,
      device_id: '2',
      timestamp: new Date(Date.UTC(2026, 5, 13, 0, 0, index)).toISOString(),
    }))
    const renderedBreadcrumbs = rawBreadcrumbs.filter((_position, index) => index % 2 === 0).slice(0, 5_000)
    const snapshot = {
      ...SNAPSHOT,
      breadcrumbs: renderedBreadcrumbs,
      rawBreadcrumbsForPersistence: rawBreadcrumbs,
    } satisfies TrackingSnapshot
    let pollerHooks:
      | {
          onSnapshot: (snapshot: TrackingSnapshot) => void | Promise<void>
          onStatusChange: (status: TrackingConnectionStatus) => void
        }
      | undefined

    await startTrackingRuntime({
      config: { baseUrl: 'http://test:8082' },
      createClient: vi.fn().mockReturnValue({}),
      createPoller: vi.fn().mockImplementation((_client, hooks) => {
        pollerHooks = hooks
        return { start: vi.fn(), stop: vi.fn() }
      }),
      cache: {
        read: vi.fn().mockResolvedValue(null),
        write: vi.fn().mockResolvedValue('/tmp/tracking-cache.json'),
      },
      missionStore: createMissionStoreStub({
        getActiveMission: vi.fn().mockResolvedValue({ id: 'mission-1' }),
        listPositions: vi.fn().mockResolvedValue([]),
        addPosition,
      }),
      applySnapshot: vi.fn(),
      applyStatus: vi.fn(),
      writeCache: false,
      now: () => new Date('2026-06-13T21:48:51.654Z'),
    })

    await pollerHooks?.onSnapshot(snapshot)

    expect(addPosition).toHaveBeenCalledTimes(rawBreadcrumbs.length + SNAPSHOT.positions.length)
    expect(
      addPosition.mock.calls.filter(
        (call) => call[0].device_id === '2' && String(call[0].timestamp).startsWith('2026-06-13'),
      ),
    ).toHaveLength(rawBreadcrumbs.length)
    expect(addPosition).toHaveBeenCalledWith(
      expect.objectContaining({
        device_id: '2',
        timestamp: rawBreadcrumbs[1]!.timestamp,
      }),
    )
  })

  it('bulk-persists raw tracking positions instead of issuing one SQLite write per position [DON-200]', async () => {
    const addPosition = vi.fn().mockResolvedValue(undefined)
    const addPositionsBulk = vi.fn().mockResolvedValue(undefined)
    const rawBreadcrumbs = Array.from({ length: 6_001 }, (_, index) => ({
      ...SNAPSHOT.breadcrumbs[0]!,
      id: `raw-bulk-${index}`,
      device_id: '2',
      timestamp: new Date(Date.UTC(2026, 5, 13, 0, 0, index)).toISOString(),
    }))
    const renderedBreadcrumbs = rawBreadcrumbs.filter((_position, index) => index % 2 === 0).slice(0, 5_000)
    const snapshot = {
      ...SNAPSHOT,
      breadcrumbs: renderedBreadcrumbs,
      rawBreadcrumbsForPersistence: rawBreadcrumbs,
    } satisfies TrackingSnapshot
    let pollerHooks:
      | {
          onSnapshot: (snapshot: TrackingSnapshot) => void | Promise<void>
          onStatusChange: (status: TrackingConnectionStatus) => void
        }
      | undefined

    await startTrackingRuntime({
      config: { baseUrl: 'http://test:8082' },
      createClient: vi.fn().mockReturnValue({}),
      createPoller: vi.fn().mockImplementation((_client, hooks) => {
        pollerHooks = hooks
        return { start: vi.fn(), stop: vi.fn() }
      }),
      cache: {
        read: vi.fn().mockResolvedValue(null),
        write: vi.fn().mockResolvedValue('/tmp/tracking-cache.json'),
      },
      missionStore: createMissionStoreStub({
        getActiveMission: vi.fn().mockResolvedValue({ id: 'mission-1' }),
        listPositions: vi.fn().mockResolvedValue([]),
        addPosition,
        addPositionsBulk,
      }),
      applySnapshot: vi.fn(),
      applyStatus: vi.fn(),
      writeCache: false,
      now: () => new Date('2026-06-13T21:48:51.654Z'),
    })

    await pollerHooks?.onSnapshot(snapshot)

    expect(addPosition).not.toHaveBeenCalled()
    expect(addPositionsBulk).toHaveBeenCalledOnce()
    expect(addPositionsBulk).toHaveBeenCalledWith({
      mission_id: 'mission-1',
      positions: expect.arrayContaining([
        expect.objectContaining({
          device_id: '2',
          timestamp: rawBreadcrumbs[1]!.timestamp,
        }),
        expect.objectContaining({
          device_id: SNAPSHOT.positions[0]!.device_id,
          timestamp: SNAPSHOT.positions[0]!.timestamp,
        }),
      ]),
    })
    expect(addPositionsBulk.mock.calls[0]![0].positions).toHaveLength(
      rawBreadcrumbs.length + SNAPSHOT.positions.length,
    )
  })
})

function createMissionStoreStub(overrides: Record<string, unknown> = {}) {
  return {
    getActiveMission: vi.fn().mockResolvedValue(null),
    listPositions: vi.fn().mockResolvedValue([]),
    upsertDevice: vi.fn().mockResolvedValue(undefined),
    addPosition: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}
