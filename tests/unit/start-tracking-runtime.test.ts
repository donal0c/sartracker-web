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

  it('wires request attempts and poll cycles into the bounded tracking ledger [DON-229]', async () => {
    const recordTrackingPollDiagnostic = vi.fn()
    const createClient = vi.fn().mockReturnValue({})
    const createPoller = vi.fn().mockReturnValue({ start: vi.fn(), stop: vi.fn() })

    await startTrackingRuntime({
      config: { baseUrl: 'https://tracking.example.test' },
      createClient,
      createPoller,
      cache: { read: vi.fn().mockResolvedValue(null), write: vi.fn() },
      missionStore: createMissionStoreStub(),
      applySnapshot: vi.fn(),
      applyStatus: vi.fn(),
      recordTrackingPollDiagnostic,
    })

    const clientConfig = createClient.mock.calls[0]?.[0]
    clientConfig.recordRequestDiagnostic({
      ts: '2026-07-12T09:52:01.000Z',
      kind: 'request_attempt',
      outcome: 'failure',
      phase: 'current_positions',
      durationMs: 10_000,
      attempt: 1,
      maxAttempts: 4,
      failureKind: 'timeout',
      httpStatus: null,
    })
    const hooks = createPoller.mock.calls[0]?.[1]
    hooks.onPollDiagnostic({
      ts: '2026-07-12T09:52:01.000Z',
      kind: 'poll_cycle',
      outcome: 'failure',
      phase: 'current_positions',
      durationMs: 47_000,
      consecutiveFailures: 1,
      retryDelayMs: 1_000,
      failureKind: 'timeout',
    })

    expect(recordTrackingPollDiagnostic).toHaveBeenCalledTimes(2)
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
    const logger = { warn: vi.fn() }

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
      logger,
      now: () => new Date('2026-04-06T10:35:00.000Z'),
    })

    expect(applySnapshot).not.toHaveBeenCalled()
    expect(createPoller).toHaveBeenCalledTimes(1)
    expect(logger.warn).toHaveBeenCalledWith(
      'Tracking cache payload was ignored.',
      expect.any(Error),
    )
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
            source_position_id: SNAPSHOT.positions[0].id,
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
    expect(addPosition).toHaveBeenCalledTimes(4)
    expect(addPosition).toHaveBeenCalledWith(
      expect.objectContaining({
        mission_id: 'mission-1',
        device_id: '2',
      }),
    )
  })

  it('batches all device upserts into a single upsertDevicesBulk call when available [DON-240]', async () => {
    // Regression guard for the beta.9 field freeze: at synchronous=FULL, one fsync per commit,
    // a per-device upsert loop meant N fsync'd writes on the main process every poll. With many
    // devices on a slow disk this blocked the event loop for tens of seconds. Persistence must
    // issue ONE batched write, not one per device.
    const upsertDevice = vi.fn().mockResolvedValue(undefined)
    const upsertDevicesBulk = vi.fn().mockResolvedValue(undefined)
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
        upsertDevice,
        upsertDevicesBulk,
      }),
      applySnapshot: vi.fn(),
      applyStatus: vi.fn(),
      writeCache: false,
      now: () => new Date('2026-04-06T10:35:00.000Z'),
    })

    await pollerHooks?.onSnapshot(SNAPSHOT)

    // SNAPSHOT has 2 devices; one batched call, zero per-device calls.
    expect(upsertDevicesBulk).toHaveBeenCalledTimes(1)
    expect(upsertDevice).not.toHaveBeenCalled()
    const call = upsertDevicesBulk.mock.calls[0]![0]
    expect(call.mission_id).toBe('mission-1')
    expect(call.devices).toHaveLength(2)
    expect(call.devices.map((device: { device_id: string }) => device.device_id)).toEqual(['1', '2'])
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
        expect.objectContaining({ source_position_id: 'traccar-9001' }),
        expect.objectContaining({ source_position_id: 'traccar-9002' }),
      ]),
    })
    expect(addPositionsBulk.mock.calls[0]![0].positions).toHaveLength(2)
  })

  it('forwards a sourced fix to storage when only its exact legacy fallback is cached [DON-260]', async () => {
    const addPositionsBulk = vi.fn().mockResolvedValue([])
    let pollerHooks:
      | {
          onSnapshot: (snapshot: TrackingSnapshot) => void | Promise<void>
        }
      | undefined
    const sourceFix = {
      ...SNAPSHOT.breadcrumbs[0]!,
      id: 'traccar-position-1',
      device_id: '2',
      lat: 52.0599,
      lon: -9.5045,
      timestamp: '2026-07-28T10:00:00.000Z',
    }

    await startTrackingRuntime({
      config: { baseUrl: 'http://test:8082' },
      createClient: vi.fn().mockReturnValue({}),
      createPoller: vi.fn().mockImplementation((_client, hooks) => {
        pollerHooks = hooks
        return { start: vi.fn(), stop: vi.fn() }
      }),
      cache: {
        read: vi.fn().mockResolvedValue(null),
        write: vi.fn(),
      },
      missionStore: createMissionStoreStub({
        getActiveMission: vi.fn().mockResolvedValue({ id: 'mission-1' }),
        listRecentPositions: vi.fn().mockResolvedValue([
          {
            id: 'local-legacy-row',
            source_position_id: null,
            device_id: sourceFix.device_id,
            lat: sourceFix.lat,
            lon: sourceFix.lon,
            timestamp: sourceFix.timestamp,
            data_origin: 'live',
          },
        ]),
        addPositionsBulk,
      }),
      applySnapshot: vi.fn(),
      applyStatus: vi.fn(),
      writeCache: false,
    })

    await pollerHooks?.onSnapshot({
      ...SNAPSHOT,
      positions: [],
      breadcrumbs: [sourceFix],
      rawBreadcrumbsForPersistence: [sourceFix],
    })

    expect(addPositionsBulk).toHaveBeenCalledWith({
      mission_id: 'mission-1',
      positions: [
        expect.objectContaining({
          source_position_id: 'traccar-position-1',
        }),
      ],
    })
  })

  it('does not let a queued snapshot cross into a different active mission [DON-260]', async () => {
    const addPositionsBulk = vi.fn().mockResolvedValue([])
    const getActiveMission = vi.fn().mockResolvedValue({ id: 'mission-b' })
    let pollerHooks:
      | {
          onSnapshot: (
            snapshot: TrackingSnapshot,
            context: { readonly historyResetKey: string | null },
          ) => void | Promise<void>
        }
      | undefined

    await startTrackingRuntime({
      config: { baseUrl: 'http://test:8082' },
      createClient: vi.fn().mockReturnValue({}),
      createPoller: vi.fn().mockImplementation((_client, hooks) => {
        pollerHooks = hooks
        return { start: vi.fn(), stop: vi.fn() }
      }),
      cache: { read: vi.fn().mockResolvedValue(null), write: vi.fn() },
      missionStore: createMissionStoreStub({
        getActiveMission,
        addPositionsBulk,
      }),
      applySnapshot: vi.fn(),
      applyStatus: vi.fn(),
      writeCache: false,
    })

    await pollerHooks?.onSnapshot(SNAPSHOT, { historyResetKey: 'mission-a' })

    expect(getActiveMission).toHaveBeenCalled()
    expect(addPositionsBulk).not.toHaveBeenCalled()
  })

  it('serializes persistence across replacement runtimes so an older fix cannot win last [DON-260]', async () => {
    let releaseOlderWrite: (() => void) | null = null
    let sharedAddPositionsBulk: ReturnType<typeof vi.fn> | undefined
    const olderWriteStarted = new Promise<void>((resolve) => {
      const addPositionsBulk = vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise<void>((writeResolve) => {
              releaseOlderWrite = writeResolve
              resolve()
            }),
        )
        .mockResolvedValue(undefined)
      sharedAddPositionsBulk = addPositionsBulk
    })
    let olderHooks:
      | {
          onSnapshot: (
            snapshot: TrackingSnapshot,
            context: { readonly historyResetKey: string | null },
          ) => void | Promise<void>
        }
      | undefined
    let replacementHooks: typeof olderHooks
    const missionStore = createMissionStoreStub({
      getActiveMission: vi.fn().mockResolvedValue({ id: 'mission-1' }),
      listRecentPositions: vi.fn().mockResolvedValue([]),
      addPositionsBulk: (...args) => sharedAddPositionsBulk?.(...args),
    })

    const stopOlder = await startTrackingRuntime({
      config: { baseUrl: 'http://test:8082' },
      createClient: vi.fn().mockReturnValue({}),
      createPoller: vi.fn().mockImplementation((_client, hooks) => {
        olderHooks = hooks
        return { start: vi.fn(), stop: vi.fn() }
      }),
      cache: { read: vi.fn().mockResolvedValue(null), write: vi.fn() },
      missionStore,
      applySnapshot: vi.fn(),
      applyStatus: vi.fn(),
      writeCache: false,
    })

    const olderFix = {
      ...SNAPSHOT.breadcrumbs[0]!,
      id: 'source-1',
      lat: 52.1,
    }
    const olderPersistence = olderHooks?.onSnapshot(
      {
        ...SNAPSHOT,
        devices: [],
        positions: [],
        breadcrumbs: [olderFix],
        rawBreadcrumbsForPersistence: [olderFix],
      },
      { historyResetKey: 'mission-1' },
    )
    await olderWriteStarted
    stopOlder()

    const stopReplacement = await startTrackingRuntime({
      config: { baseUrl: 'http://test:8082' },
      createClient: vi.fn().mockReturnValue({}),
      createPoller: vi.fn().mockImplementation((_client, hooks) => {
        replacementHooks = hooks
        return { start: vi.fn(), stop: vi.fn() }
      }),
      cache: { read: vi.fn().mockResolvedValue(null), write: vi.fn() },
      missionStore,
      applySnapshot: vi.fn(),
      applyStatus: vi.fn(),
      writeCache: false,
    })
    const correctedFix = { ...olderFix, lat: 52.2 }
    const replacementPersistence = replacementHooks?.onSnapshot(
      {
        ...SNAPSHOT,
        devices: [],
        positions: [],
        breadcrumbs: [correctedFix],
        rawBreadcrumbsForPersistence: [correctedFix],
      },
      { historyResetKey: 'mission-1' },
    )

    for (let flush = 0; flush < 10; flush += 1) {
      await Promise.resolve()
    }
    expect(sharedAddPositionsBulk).toHaveBeenCalledTimes(1)
    releaseOlderWrite?.()
    await Promise.all([olderPersistence, replacementPersistence])
    expect(sharedAddPositionsBulk).toHaveBeenCalledTimes(2)
    expect(sharedAddPositionsBulk).toHaveBeenLastCalledWith({
      mission_id: 'mission-1',
      positions: [expect.objectContaining({ source_position_id: 'source-1', lat: 52.2 })],
    })
    stopReplacement()
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

  it('reuses persisted legacy coordinate keys while revalidating sourced fixes for corrections', async () => {
    const listPositions = vi.fn().mockResolvedValue([
      {
        source_position_id: SNAPSHOT.positions[0].id,
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
    expect(addPosition).toHaveBeenCalledTimes(8)
  })

  it('forwards a changed sourced fix even when its identity was already persisted [DON-260]', async () => {
    const addPositionsBulk = vi.fn().mockResolvedValue([])
    let pollerHooks:
      | {
          onSnapshot: (snapshot: TrackingSnapshot) => void | Promise<void>
        }
      | undefined
    const original = SNAPSHOT.positions[0]!
    const corrected = { ...original, lat: original.lat + 0.01 }

    await startTrackingRuntime({
      config: { baseUrl: 'http://test:8082' },
      createClient: vi.fn().mockReturnValue({}),
      createPoller: vi.fn().mockImplementation((_client, hooks) => {
        pollerHooks = hooks
        return { start: vi.fn(), stop: vi.fn() }
      }),
      cache: { read: vi.fn().mockResolvedValue(null), write: vi.fn() },
      missionStore: createMissionStoreStub({
        getActiveMission: vi.fn().mockResolvedValue({ id: 'mission-1' }),
        listRecentPositions: vi.fn().mockResolvedValue([
          {
            source_position_id: original.id,
            device_id: original.device_id,
            lat: original.lat,
            lon: original.lon,
            timestamp: original.timestamp,
          },
        ]),
        addPositionsBulk,
      }),
      applySnapshot: vi.fn(),
      applyStatus: vi.fn(),
      writeCache: false,
    })

    await pollerHooks?.onSnapshot({
      ...SNAPSHOT,
      breadcrumbs: [],
      positions: [corrected],
    })

    expect(addPositionsBulk).toHaveBeenCalledWith({
      mission_id: 'mission-1',
      positions: [
        expect.objectContaining({
          source_position_id: original.id,
          lat: corrected.lat,
        }),
      ],
    })
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
        id: '',
        device_id: '1',
        lat: 52.01,
        lon: -9.01,
        timestamp: '2026-04-06T10:05:00.000Z',
        data_origin: 'live',
      }),
      expect.objectContaining({
        id: '',
        device_id: '2',
        lat: 52.02,
        lon: -9.02,
        timestamp: '2026-04-06T10:03:00.000Z',
        data_origin: 'cache',
      }),
    ])
  })

  it('uses the bounded per-device restart query instead of loading full mission history [DON-246]', async () => {
    let pollerHooks:
      | {
          getInitialBreadcrumbs: () => Promise<readonly TrackingSnapshot['breadcrumbs'][number][]>
          onSnapshot: (snapshot: TrackingSnapshot) => void | Promise<void>
        }
      | undefined
    const listPositions = vi.fn().mockRejectedValue(new Error('unbounded query must not run'))
    const listRecentPositions = vi.fn().mockResolvedValue([
      {
        id: 'recent-1',
        source_position_id: SNAPSHOT.positions[0]!.id,
        device_id: SNAPSHOT.positions[0]!.device_id,
        lat: SNAPSHOT.positions[0]!.lat,
        lon: SNAPSHOT.positions[0]!.lon,
        timestamp: SNAPSHOT.positions[0]!.timestamp,
        data_origin: 'live',
      },
    ])
    const addPosition = vi.fn().mockResolvedValue(undefined)

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
        listRecentPositions,
        addPosition,
      }),
      applySnapshot: vi.fn(),
      applyStatus: vi.fn(),
    })

    await expect(pollerHooks?.getInitialBreadcrumbs()).resolves.toHaveLength(1)
    await pollerHooks?.onSnapshot(SNAPSHOT)
    expect(listRecentPositions).toHaveBeenCalledWith('mission-1', 5_000)
    expect(listPositions).not.toHaveBeenCalled()
    expect(addPosition).toHaveBeenCalledTimes(4)
  })

  it('hydrates restart breadcrumbs from the deterministic whole-route query [DON-260]', async () => {
    let pollerHooks:
      | {
          getInitialBreadcrumbs: () => Promise<readonly TrackingSnapshot['breadcrumbs'][number][]>
        }
      | undefined
    const listBreadcrumbPositions = vi.fn().mockResolvedValue({
      positions: [
        {
          id: 'local-row-1',
          source_position_id: 'source-1',
          device_id: '1',
          lat: 52.01,
          lon: -9.01,
          timestamp: '2026-04-06T10:05:00.000Z',
          data_origin: 'live',
        },
      ],
      deviceTotals: [{ device_id: '1', total: 25_000 }],
    })
    const listRecentPositions = vi.fn().mockRejectedValue(
      new Error('tail query must not run'),
    )

    await startTrackingRuntime({
      config: { baseUrl: 'http://test:8082' },
      createClient: vi.fn().mockReturnValue({}),
      createPoller: vi.fn().mockImplementation((_client, hooks) => {
        pollerHooks = hooks
        return { start: vi.fn(), stop: vi.fn() }
      }),
      cache: { read: vi.fn().mockResolvedValue(null), write: vi.fn() },
      missionStore: createMissionStoreStub({
        getActiveMission: vi.fn().mockResolvedValue({ id: 'mission-1' }),
        listBreadcrumbPositions,
        listRecentPositions,
      }),
      applySnapshot: vi.fn(),
      applyStatus: vi.fn(),
    })

    await expect(pollerHooks?.getInitialBreadcrumbs()).resolves.toEqual([
      expect.objectContaining({ id: 'source-1' }),
    ])
    expect(listBreadcrumbPositions).toHaveBeenCalledWith('mission-1', 5_000)
    expect(listRecentPositions).not.toHaveBeenCalled()
  })

  it('keeps malformed legacy breadcrumb drops operator-visible while restoring valid history [DON-260]', async () => {
    let pollerHooks:
      | {
          getInitialBreadcrumbs: () => Promise<
            readonly TrackingSnapshot['breadcrumbs'][number][]
          >
          onStatusChange: (status: TrackingConnectionStatus) => void
        }
      | undefined
    const applyStatus = vi.fn()
    const recordDiagnosticEvent = vi.fn()

    await startTrackingRuntime({
      config: { baseUrl: 'http://test:8082' },
      createClient: vi.fn().mockReturnValue({}),
      createPoller: vi.fn().mockImplementation((_client, hooks) => {
        pollerHooks = hooks
        return { start: vi.fn(), stop: vi.fn() }
      }),
      cache: { read: vi.fn().mockResolvedValue(null), write: vi.fn() },
      missionStore: createMissionStoreStub({
        getActiveMission: vi.fn().mockResolvedValue({ id: 'mission-1' }),
        listBreadcrumbPositions: vi.fn().mockResolvedValue({
          positions: [
            {
              source_position_id: 'source-valid',
              device_id: '1',
              lat: 52.01,
              lon: -9.01,
              timestamp: '2026-02-28T10:05:00.000Z',
              data_origin: 'live',
            },
          ],
          deviceTotals: [{ device_id: '1', total: 2 }],
          droppedPositionCount: 1,
        }),
      }),
      applySnapshot: vi.fn(),
      applyStatus,
      recordDiagnosticEvent,
    })

    await expect(pollerHooks?.getInitialBreadcrumbs()).resolves.toHaveLength(1)
    pollerHooks?.onStatusChange({
      mode: 'online',
      consecutiveFailures: 0,
      recovered: false,
      lastSuccessAt: '2026-07-28T10:05:00.000Z',
      warning: null,
    })

    expect(applyStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({
        mode: 'online',
        warning: expect.stringMatching(/1 unreadable stored breadcrumb fix was ignored/i),
      }),
    )
    expect(recordDiagnosticEvent).toHaveBeenCalledWith({
      level: 'warn',
      category: 'tracking',
      event: 'tracking_breadcrumb_rows_dropped',
      fields: {
        droppedPositionCount: 1,
      },
    })
  })

  it('rejects ambiguous and calendar-invalid persisted breadcrumb timestamps [DON-260]', async () => {
    let pollerHooks:
      | {
          getInitialBreadcrumbs: () => Promise<readonly TrackingSnapshot['breadcrumbs'][number][]>
        }
      | undefined
    const listBreadcrumbPositions = vi.fn().mockResolvedValue({
      positions: [
        {
          id: 'valid',
          source_position_id: 'source-valid',
          device_id: '1',
          lat: 52.01,
          lon: -9.01,
          timestamp: '2026-02-28T10:05:00.000Z',
          data_origin: 'live',
        },
        {
          id: 'impossible-date',
          source_position_id: 'source-impossible',
          device_id: '1',
          lat: 52.02,
          lon: -9.02,
          timestamp: '2026-02-30T10:05:00.000Z',
          data_origin: 'live',
        },
        {
          id: 'date-only',
          source_position_id: 'source-date-only',
          device_id: '1',
          lat: 52.03,
          lon: -9.03,
          timestamp: '2026-02-28',
          data_origin: 'live',
        },
      ],
      deviceTotals: [{ device_id: '1', total: 3 }],
    })

    await startTrackingRuntime({
      config: { baseUrl: 'http://test:8082' },
      createClient: vi.fn().mockReturnValue({}),
      createPoller: vi.fn().mockImplementation((_client, hooks) => {
        pollerHooks = hooks
        return { start: vi.fn(), stop: vi.fn() }
      }),
      cache: { read: vi.fn().mockResolvedValue(null), write: vi.fn() },
      missionStore: createMissionStoreStub({
        getActiveMission: vi.fn().mockResolvedValue({ id: 'mission-1' }),
        listBreadcrumbPositions,
      }),
      applySnapshot: vi.fn(),
      applyStatus: vi.fn(),
    })

    await expect(pollerHooks?.getInitialBreadcrumbs()).resolves.toEqual([
      expect.objectContaining({
        id: 'source-valid',
        timestamp: '2026-02-28T10:05:00.000Z',
      }),
    ])
  })

  it('reloads persisted breadcrumb seed data when the active mission changes [DON-260]', async () => {
    let pollerHooks:
      | {
          getInitialBreadcrumbs: () => Promise<
            readonly TrackingSnapshot['breadcrumbs'][number][]
          >
        }
      | undefined
    const getActiveMission = vi
      .fn()
      .mockResolvedValueOnce({ id: 'mission-a' })
      .mockResolvedValueOnce({ id: 'mission-b' })
    const listBreadcrumbPositions = vi
      .fn()
      .mockImplementation(async (missionId: string) => ({
        positions: [
          {
            id: `local-${missionId}`,
            source_position_id: `source-${missionId}`,
            device_id: '1',
            lat: 52.01,
            lon: -9.01,
            timestamp: '2026-07-28T10:00:00.000Z',
            data_origin: 'live',
          },
        ],
        deviceTotals: [{ device_id: '1', total: 1 }],
      }))

    await startTrackingRuntime({
      config: { baseUrl: 'http://test:8082' },
      createClient: vi.fn().mockReturnValue({}),
      createPoller: vi.fn().mockImplementation((_client, hooks) => {
        pollerHooks = hooks
        return { start: vi.fn(), stop: vi.fn() }
      }),
      cache: { read: vi.fn().mockResolvedValue(null), write: vi.fn() },
      missionStore: createMissionStoreStub({
        getActiveMission,
        listBreadcrumbPositions,
      }),
      applySnapshot: vi.fn(),
      applyStatus: vi.fn(),
    })

    await expect(pollerHooks?.getInitialBreadcrumbs()).resolves.toEqual([
      expect.objectContaining({ id: 'source-mission-a' }),
    ])
    await expect(pollerHooks?.getInitialBreadcrumbs()).resolves.toEqual([
      expect.objectContaining({ id: 'source-mission-b' }),
    ])
    expect(listBreadcrumbPositions.mock.calls.map(([missionId]) => missionId)).toEqual([
      'mission-a',
      'mission-b',
    ])
  })

  it('retries a transient persisted breadcrumb hydration failure for the same mission [DON-260]', async () => {
    let pollerHooks:
      | {
          getInitialBreadcrumbs: () => Promise<
            readonly TrackingSnapshot['breadcrumbs'][number][]
          >
        }
      | undefined
    const listBreadcrumbPositions = vi
      .fn()
      .mockRejectedValueOnce(new Error('temporary worker timeout'))
      .mockResolvedValueOnce({
        positions: [
          {
            id: 'local-row-1',
            source_position_id: 'source-1',
            device_id: '1',
            lat: 52.01,
            lon: -9.01,
            timestamp: '2026-07-28T10:00:00.000Z',
            data_origin: 'live',
          },
        ],
        deviceTotals: [{ device_id: '1', total: 1 }],
      })

    await startTrackingRuntime({
      config: { baseUrl: 'http://test:8082' },
      createClient: vi.fn().mockReturnValue({}),
      createPoller: vi.fn().mockImplementation((_client, hooks) => {
        pollerHooks = hooks
        return { start: vi.fn(), stop: vi.fn() }
      }),
      cache: { read: vi.fn().mockResolvedValue(null), write: vi.fn() },
      missionStore: createMissionStoreStub({
        getActiveMission: vi.fn().mockResolvedValue({ id: 'mission-1' }),
        listBreadcrumbPositions,
      }),
      applySnapshot: vi.fn(),
      applyStatus: vi.fn(),
    })

    await expect(pollerHooks?.getInitialBreadcrumbs()).rejects.toThrow(
      /temporary worker timeout/iu,
    )
    await expect(pollerHooks?.getInitialBreadcrumbs()).resolves.toEqual([
      expect.objectContaining({ id: 'source-1' }),
    ])
    expect(listBreadcrumbPositions).toHaveBeenCalledTimes(2)
  })

  it('keeps the live snapshot applied when cache and mission persistence side effects fail', async () => {
    const applySnapshot = vi.fn()
    const applyStatus = vi.fn()
    const logger = { warn: vi.fn() }
    const recordDiagnosticEvent = vi.fn()
    const cacheWrite = vi
      .fn()
      .mockRejectedValueOnce(new Error('cache write failed'))
      .mockResolvedValue('/tmp/tracking-cache.json')
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
        upsertDevice: vi
          .fn()
          .mockRejectedValueOnce(new Error('device persistence failed'))
          .mockResolvedValue(undefined),
      }),
      applySnapshot,
      applyStatus,
      logger,
      recordDiagnosticEvent,
      now: () => new Date('2026-04-06T10:35:00.000Z'),
    })

    pollerHooks?.onStatusChange({
      mode: 'online',
      consecutiveFailures: 0,
      recovered: false,
      lastSuccessAt: '2026-04-06T10:35:00.000Z',
      warning: null,
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
    expect(applyStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({
        mode: 'online',
        warning: expect.stringMatching(
          /tracking fallback cache update failed.*mission breadcrumb storage failed/i,
        ),
      }),
    )

    await expect(pollerHooks?.onSnapshot(SNAPSHOT)).resolves.toBeUndefined()
    expect(cacheWrite).toHaveBeenCalledTimes(2)
    expect(applyStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({
        mode: 'online',
        warning: null,
      }),
    )
    expect(recordDiagnosticEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'tracking_cache_write_failed' }),
    )
    expect(recordDiagnosticEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'tracking_cache_write_recovered' }),
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

  it('persists no breadcrumbs when the browser-only cap is consumed by current fixes [DON-260]', async () => {
    const addPosition = vi.fn().mockResolvedValue(undefined)
    const breadcrumbs = Array.from({ length: 3 }, (_, index) => ({
      ...SNAPSHOT.breadcrumbs[0]!,
      id: `zero-budget-breadcrumb-${index}`,
      timestamp: new Date(Date.UTC(2026, 3, 6, 9, index, 0)).toISOString(),
    }))
    let pollerHooks:
      | {
          onSnapshot: (snapshot: TrackingSnapshot) => void | Promise<void>
        }
      | undefined

    await startTrackingRuntime({
      config: { baseUrl: 'http://test:8082' },
      createClient: vi.fn().mockReturnValue({}),
      createPoller: vi.fn().mockImplementation((_client, hooks) => {
        pollerHooks = hooks
        return { start: vi.fn(), stop: vi.fn() }
      }),
      cache: { read: vi.fn().mockResolvedValue(null), write: vi.fn() },
      missionStore: createMissionStoreStub({
        getActiveMission: vi.fn().mockResolvedValue({ id: 'mission-1' }),
        listPositions: vi.fn().mockResolvedValue([]),
        addPosition,
      }),
      applySnapshot: vi.fn(),
      applyStatus: vi.fn(),
      maxPersistedPositionsPerSnapshot: SNAPSHOT.positions.length,
      writeCache: false,
    })

    await pollerHooks?.onSnapshot({
      ...SNAPSHOT,
      breadcrumbs,
    })

    expect(addPosition).toHaveBeenCalledTimes(SNAPSHOT.positions.length)
    expect(addPosition.mock.calls.map((call) => call[0].timestamp)).toEqual(
      SNAPSHOT.positions.map((position) => position.timestamp),
    )
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
