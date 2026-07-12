import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import devicesFixture from '../fixtures/traccar-devices.json'
import positionsFixture from '../fixtures/traccar-positions.json'
import breadcrumbsFixture from '../fixtures/traccar-breadcrumbs.json'
import type { NormalizedTrackingDevice, NormalizedTrackingPosition } from '../../src/features/tracking/tracking-types'
import {
  createPollingManager,
  type TrackingPollerClient,
} from '../../src/features/tracking/polling-manager'
import {
  normalizeTraccarDevice,
  normalizeTraccarPosition,
} from '../../src/features/tracking/traccar-normalization'

const NORMALIZED_DEVICES = devicesFixture.map((device) => normalizeTraccarDevice(device))
const NORMALIZED_POSITIONS = positionsFixture.map((position) =>
  normalizeTraccarPosition(position, 'live'),
)
const NORMALIZED_BREADCRUMBS = breadcrumbsFixture.map((position) =>
  normalizeTraccarPosition(position, 'live'),
)

function createClient(
  overrides: Partial<TrackingPollerClient> = {},
): TrackingPollerClient {
  return {
    authenticate: vi.fn().mockResolvedValue(undefined),
    getDevices: vi.fn().mockResolvedValue(NORMALIZED_DEVICES as readonly NormalizedTrackingDevice[]),
    getCurrentPositions: vi
      .fn()
      .mockResolvedValue(NORMALIZED_POSITIONS as readonly NormalizedTrackingPosition[]),
    getBreadcrumbs: vi
      .fn()
      .mockResolvedValue(NORMALIZED_BREADCRUMBS as readonly NormalizedTrackingPosition[]),
    ...overrides,
  }
}

function createDeferred<T>(): {
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
} {
  let resolvePromise: (value: T) => void = () => undefined
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve
  })
  return { promise, resolve: resolvePromise }
}

describe('polling manager', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('authenticates once and polls immediately, then on interval', async () => {
    const client = createClient()
    const onSnapshot = vi.fn()

    const poller = createPollingManager(client, {
      intervalMs: 5_000,
      staleThresholdMs: 60 * 60 * 1000,
      onSnapshot,
      onStatusChange: vi.fn(),
      now: () => new Date('2026-04-06T10:35:00.000Z'),
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(5_000)

    expect(client.authenticate).toHaveBeenCalledTimes(1)
    expect(client.getDevices).toHaveBeenCalledTimes(2)
    expect(client.getCurrentPositions).toHaveBeenCalledTimes(2)
    expect(client.getBreadcrumbs).toHaveBeenCalled()
    expect(onSnapshot).toHaveBeenCalledTimes(3)

    poller.stop()
  })

  // V1 regression coverage (sartracker-web-8gw): a healthy poll cycle must never
  // briefly flip to 'offline'. A previous regression published an 'offline'
  // intermediate status in some healthy paths, which made operators see a
  // transport-failure warning even while the poll was succeeding. This guard
  // pins the contract that a successful single poll cycle only publishes
  // 'online' modes (and possibly 'idle' before the mission is active).
  it('never publishes an offline status during a single healthy poll cycle', async () => {
    const client = createClient()
    const onStatusChange = vi.fn()

    const poller = createPollingManager(client, {
      intervalMs: 5_000,
      staleThresholdMs: 60 * 60 * 1000,
      onSnapshot: vi.fn(),
      onStatusChange,
      now: () => new Date('2026-04-06T10:35:00.000Z'),
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)

    const modes = onStatusChange.mock.calls.map((call) => call[0]?.mode)
    expect(modes).not.toContain('offline')
    expect(modes).toContain('online')

    poller.stop()
  })

  it('serves the last-good snapshot on fetch failure without clearing data', async () => {
    const client = createClient()
    const onSnapshot = vi.fn()
    const onStatusChange = vi.fn()

    const poller = createPollingManager(client, {
      intervalMs: 5_000,
      staleThresholdMs: 60 * 60 * 1000,
      onSnapshot,
      onStatusChange,
      now: () => new Date('2026-04-06T10:35:00.000Z'),
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)

    vi.mocked(client.getDevices).mockRejectedValueOnce(new Error('network down'))

    await vi.advanceTimersByTimeAsync(5_000)

    expect(onSnapshot).toHaveBeenCalledTimes(3)
    expect(onStatusChange).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'offline',
        warning: 'OFFLINE MODE — showing last known positions.',
      }),
    )

    poller.stop()
  })

  it('backs off after failures and reports recovery', async () => {
    const client = createClient({
      getDevices: vi
        .fn()
        .mockRejectedValueOnce(new Error('offline'))
        .mockRejectedValueOnce(new Error('still offline'))
        .mockResolvedValue(NORMALIZED_DEVICES as readonly NormalizedTrackingDevice[]),
    })
    const onStatusChange = vi.fn()

    const poller = createPollingManager(client, {
      intervalMs: 5_000,
      staleThresholdMs: 60 * 60 * 1000,
      onSnapshot: vi.fn(),
      onStatusChange,
      retryBaseMs: 1_000,
      now: () => new Date('2026-04-06T10:35:00.000Z'),
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(1_000)
    await vi.advanceTimersByTimeAsync(2_000)

    expect(onStatusChange).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'offline', consecutiveFailures: 1 }),
    )
    expect(onStatusChange).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'offline', consecutiveFailures: 2 }),
    )
    expect(onStatusChange).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'online',
        recovered: true,
        warning: 'CONNECTION RESTORED',
      }),
    )

    poller.stop()
  })

  it('records a sanitized failed poll and its recovery in the tracking ledger [DON-229]', async () => {
    const client = createClient({
      getDevices: vi
        .fn()
        .mockRejectedValueOnce(new DOMException('request aborted', 'AbortError'))
        .mockResolvedValue(NORMALIZED_DEVICES as readonly NormalizedTrackingDevice[]),
    })
    const onPollDiagnostic = vi.fn()
    const times = [
      '2026-07-12T09:51:14.000Z',
      '2026-07-12T09:52:01.000Z',
      '2026-07-12T09:52:02.000Z',
      '2026-07-12T09:52:02.250Z',
    ]

    const poller = createPollingManager(client, {
      intervalMs: 5_000,
      staleThresholdMs: 60 * 60 * 1000,
      onSnapshot: vi.fn(),
      onStatusChange: vi.fn(),
      onPollDiagnostic,
      retryBaseMs: 1_000,
      now: () => new Date(times.shift() ?? '2026-07-12T09:52:02.250Z'),
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(1_000)

    expect(onPollDiagnostic).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'poll_cycle',
        outcome: 'failure',
        phase: 'devices',
        failureKind: 'timeout',
        consecutiveFailures: 1,
        retryDelayMs: 1_000,
      }),
    )
    expect(onPollDiagnostic).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'poll_cycle',
        outcome: 'recovered',
        phase: 'breadcrumbs',
        consecutiveFailures: 0,
        outageDurationMs: expect.any(Number),
      }),
    )

    poller.stop()
  })

  it('fetches breadcrumbs incrementally per device after the first poll', async () => {
    const client = createClient()
    const onSnapshot = vi.fn()

    const poller = createPollingManager(client, {
      intervalMs: 5_000,
      staleThresholdMs: 60 * 60 * 1000,
      onSnapshot,
      onStatusChange: vi.fn(),
      now: () => new Date('2026-04-06T10:35:00.000Z'),
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(5_000)

    expect(client.getBreadcrumbs).toHaveBeenCalledWith(
      '1',
      expect.any(Date),
      expect.any(Date),
    )
    expect(client.getBreadcrumbs).toHaveBeenCalledWith(
      '2',
      expect.any(Date),
      expect.any(Date),
    )

    const latestSnapshot = onSnapshot.mock.calls.at(-1)?.[0]
    expect(latestSnapshot?.breadcrumbs.length).toBeGreaterThan(0)

    poller.stop()
  })

  it('publishes a bounded current-fixes snapshot and breadcrumb snapshot per successful poll', async () => {
    const client = createClient({
      getDevices: vi.fn().mockResolvedValue(NORMALIZED_DEVICES as readonly NormalizedTrackingDevice[]),
      getCurrentPositions: vi.fn().mockResolvedValue(NORMALIZED_POSITIONS),
      getBreadcrumbs: vi.fn().mockResolvedValue(NORMALIZED_POSITIONS),
    })
    const onSnapshot = vi.fn()
    const poller = createPollingManager(client, {
      intervalMs: 30_000,
      staleThresholdMs: 60 * 60 * 1000,
      onSnapshot,
      onStatusChange: vi.fn(),
      setTimeout: vi.fn(),
      clearTimeout: vi.fn(),
      now: () => new Date('2026-04-06T10:35:00.000Z'),
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(onSnapshot).toHaveBeenCalledTimes(2)
    expect(onSnapshot.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        devices: NORMALIZED_DEVICES,
        positions: expect.arrayContaining([
          expect.objectContaining({ device_id: NORMALIZED_POSITIONS[0]!.device_id }),
        ]),
        breadcrumbs: [],
      }),
    )
    expect(onSnapshot.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        devices: NORMALIZED_DEVICES,
        positions: expect.arrayContaining([
          expect.objectContaining({ device_id: NORMALIZED_POSITIONS[0]!.device_id }),
        ]),
        breadcrumbs: expect.arrayContaining([
          expect.objectContaining({ device_id: NORMALIZED_POSITIONS[0]!.device_id }),
        ]),
      }),
    )

    poller.stop()
  })

  it('publishes current fixes before slow breadcrumb history resolves', async () => {
    const deferredBreadcrumbs = createDeferred<readonly NormalizedTrackingPosition[]>()
    const client = createClient({
      getDevices: vi.fn().mockResolvedValue(NORMALIZED_DEVICES as readonly NormalizedTrackingDevice[]),
      getCurrentPositions: vi.fn().mockResolvedValue(NORMALIZED_POSITIONS),
      getBreadcrumbs: vi.fn().mockReturnValue(deferredBreadcrumbs.promise),
    })
    const onSnapshot = vi.fn()
    const onStatusChange = vi.fn()
    const poller = createPollingManager(client, {
      intervalMs: 30_000,
      staleThresholdMs: 60 * 60 * 1000,
      onSnapshot,
      onStatusChange,
      setTimeout: vi.fn(),
      clearTimeout: vi.fn(),
      now: () => new Date('2026-04-06T10:35:00.000Z'),
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(client.getBreadcrumbs).toHaveBeenCalled()
    expect(onSnapshot).toHaveBeenCalledTimes(1)
    expect(onSnapshot.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        devices: NORMALIZED_DEVICES,
        positions: expect.arrayContaining([
          expect.objectContaining({ device_id: NORMALIZED_POSITIONS[0]!.device_id }),
        ]),
        breadcrumbs: [],
      }),
    )
    expect(onStatusChange).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'online',
        warning: 'Current fixes loaded; loading breadcrumb history.',
      }),
    )

    deferredBreadcrumbs.resolve(NORMALIZED_BREADCRUMBS)
    await vi.advanceTimersByTimeAsync(0)

    expect(onSnapshot).toHaveBeenCalledTimes(2)
    expect(onSnapshot.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        breadcrumbs: expect.arrayContaining([
          expect.objectContaining({ device_id: NORMALIZED_BREADCRUMBS[0]!.device_id }),
        ]),
      }),
    )

    poller.stop()
  })

  it('skips the breadcrumb snapshot when an overlap poll contains no new breadcrumb state', async () => {
    const client = createClient({
      getBreadcrumbs: vi.fn().mockResolvedValue(NORMALIZED_BREADCRUMBS),
    })
    const onSnapshot = vi.fn()
    const poller = createPollingManager(client, {
      intervalMs: 5_000,
      staleThresholdMs: 60 * 60 * 1000,
      onSnapshot,
      onStatusChange: vi.fn(),
      now: () => new Date('2026-04-06T10:35:00.000Z'),
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(5_000)

    expect(onSnapshot).toHaveBeenCalledTimes(3)
    expect(onSnapshot.mock.calls[0]?.[0].breadcrumbs).toHaveLength(0)
    expect(onSnapshot.mock.calls[1]?.[0].breadcrumbs.length).toBeGreaterThan(0)
    expect(onSnapshot.mock.calls[2]?.[0].breadcrumbs).toBe(onSnapshot.mock.calls[1]?.[0].breadcrumbs)

    poller.stop()
  })

  it('uses persisted breadcrumbs for the first history fetch and published trail', async () => {
    const client = createClient({
      getBreadcrumbs: vi.fn().mockResolvedValue([]),
    })
    const persistedBreadcrumbs = [
      {
        ...NORMALIZED_BREADCRUMBS[0]!,
        device_id: '1',
        timestamp: '2026-04-06T10:10:00.000Z',
      },
      {
        ...NORMALIZED_BREADCRUMBS[1]!,
        device_id: '2',
        timestamp: '2026-04-06T10:20:00.000Z',
      },
    ] satisfies readonly NormalizedTrackingPosition[]
    const onSnapshot = vi.fn()

    const poller = createPollingManager(client, {
      intervalMs: 5_000,
      staleThresholdMs: 60 * 60 * 1000,
      onSnapshot,
      onStatusChange: vi.fn(),
      getInitialBreadcrumbFrom: () => new Date('2026-04-06T07:00:00.000Z'),
      getInitialBreadcrumbs: async () => persistedBreadcrumbs,
      now: () => new Date('2026-04-06T10:35:00.000Z'),
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(client.getBreadcrumbs).toHaveBeenCalledWith(
      '1',
      new Date('2026-04-06T10:05:00.000Z'),
      expect.any(Date),
    )
    expect(client.getBreadcrumbs).toHaveBeenCalledWith(
      '2',
      new Date('2026-04-06T10:15:00.000Z'),
      expect.any(Date),
    )
    expect(client.getBreadcrumbs).not.toHaveBeenCalledWith(
      '1',
      new Date('2026-04-06T07:00:00.000Z'),
      expect.any(Date),
    )
    expect(onSnapshot.mock.calls[0]?.[0].breadcrumbs).toEqual(persistedBreadcrumbs)

    poller.stop()
  })

  it('overlaps incremental breadcrumb fetches so buffered older fixes are not skipped [DON-233]', async () => {
    const firstBatch = [
      {
        ...NORMALIZED_POSITIONS[0],
        id: 'newest-first-poll',
        timestamp: '2026-04-06T10:20:00.000Z',
      },
    ] satisfies readonly NormalizedTrackingPosition[]
    const bufferedOlderFix = {
      ...NORMALIZED_POSITIONS[0],
      id: 'buffered-older-fix',
      timestamp: '2026-04-06T10:16:00.000Z',
    } satisfies NormalizedTrackingPosition
    const client = createClient({
      getBreadcrumbs: vi.fn()
        .mockResolvedValueOnce(firstBatch)
        .mockResolvedValueOnce([bufferedOlderFix]),
    })
    const onSnapshot = vi.fn()
    let currentTime = new Date('2026-04-06T10:20:00.000Z')

    const poller = createPollingManager(client, {
      intervalMs: 5_000,
      staleThresholdMs: 60 * 60 * 1000,
      onSnapshot,
      onStatusChange: vi.fn(),
      getBreadcrumbDeviceIds: () => ['1'],
      now: () => currentTime,
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)
    currentTime = new Date('2026-04-06T10:25:00.000Z')
    await vi.advanceTimersByTimeAsync(5_000)

    const secondFetchFrom = vi.mocked(client.getBreadcrumbs).mock.calls[1]?.[1]
    expect(secondFetchFrom?.getTime()).toBeLessThan(Date.parse('2026-04-06T10:16:00.000Z'))
    expect(
      onSnapshot.mock.calls
        .map((call) => call[0] as TrackingSnapshot)
        .some((snapshot) =>
          snapshot.breadcrumbs.some((breadcrumb) => breadcrumb.id === 'buffered-older-fix'),
        ),
    ).toBe(true)

    poller.stop()
  })

  it('clamps future breadcrumb timestamps to the completed fetch window [DON-233]', async () => {
    const futureBreadcrumb = {
      ...NORMALIZED_POSITIONS[0],
      id: 'future-clock-skew',
      timestamp: '2026-04-06T10:45:00.000Z',
    } satisfies NormalizedTrackingPosition
    const client = createClient({
      getBreadcrumbs: vi.fn()
        .mockResolvedValueOnce([futureBreadcrumb])
        .mockResolvedValueOnce([]),
    })
    let currentTime = new Date('2026-04-06T10:20:00.000Z')

    const poller = createPollingManager(client, {
      intervalMs: 5_000,
      staleThresholdMs: 60 * 60 * 1000,
      onSnapshot: vi.fn(),
      onStatusChange: vi.fn(),
      getBreadcrumbDeviceIds: () => ['1'],
      now: () => currentTime,
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)
    currentTime = new Date('2026-04-06T10:25:00.000Z')
    await vi.advanceTimersByTimeAsync(5_000)

    const secondFetchFrom = vi.mocked(client.getBreadcrumbs).mock.calls[1]?.[1]
    const secondFetchTo = vi.mocked(client.getBreadcrumbs).mock.calls[1]?.[2]
    expect(secondFetchFrom?.getTime()).toBeLessThanOrEqual(secondFetchTo!.getTime())
    expect(secondFetchFrom?.getTime()).toBeLessThan(Date.parse('2026-04-06T10:25:00.000Z'))

    poller.stop()
  })

  it('advances breadcrumb cursors by the maximum timestamp in an unsorted batch [DON-233]', async () => {
    const unsortedBatch = [
      {
        ...NORMALIZED_POSITIONS[0],
        id: 'later-first',
        timestamp: '2026-04-06T10:20:00.000Z',
      },
      {
        ...NORMALIZED_POSITIONS[0],
        id: 'earlier-second',
        timestamp: '2026-04-06T10:05:00.000Z',
      },
    ] satisfies readonly NormalizedTrackingPosition[]
    const client = createClient({
      getBreadcrumbs: vi.fn()
        .mockResolvedValueOnce(unsortedBatch)
        .mockResolvedValueOnce([]),
    })
    let currentTime = new Date('2026-04-06T10:20:00.000Z')

    const poller = createPollingManager(client, {
      intervalMs: 5_000,
      staleThresholdMs: 60 * 60 * 1000,
      onSnapshot: vi.fn(),
      onStatusChange: vi.fn(),
      getBreadcrumbDeviceIds: () => ['1'],
      now: () => currentTime,
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)
    currentTime = new Date('2026-04-06T10:25:00.000Z')
    await vi.advanceTimersByTimeAsync(5_000)

    const secondFetchFrom = vi.mocked(client.getBreadcrumbs).mock.calls[1]?.[1]
    expect(secondFetchFrom?.getTime()).toBeGreaterThan(Date.parse('2026-04-06T10:05:00.000Z'))
    expect(secondFetchFrom?.getTime()).toBeLessThan(Date.parse('2026-04-06T10:20:00.000Z'))

    poller.stop()
  })

  it('does not continue with a truncated fallback history window after seed failure [DON-233]', async () => {
    const client = createClient({
      getBreadcrumbs: vi.fn().mockResolvedValue([]),
    })
    const logger = { warn: vi.fn() }

    const poller = createPollingManager(client, {
      intervalMs: 5_000,
      staleThresholdMs: 60 * 60 * 1000,
      onSnapshot: vi.fn(),
      onStatusChange: vi.fn(),
      getInitialBreadcrumbs: async () => {
        throw new Error('sqlite read failed')
      },
      logger,
      now: () => new Date('2026-04-06T10:35:00.000Z'),
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(client.getBreadcrumbs).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledWith(
      'Tracking breadcrumb cursor load failed.',
      expect.objectContaining({ error: 'sqlite read failed' }),
    )

    poller.stop()
  })

  it('classifies authentication failures without keeping the poller authenticated [DON-234]', async () => {
    const authenticationError = new Error('Session expired')
    authenticationError.name = 'TraccarAuthenticationError'
    const client = createClient({
      getDevices: vi
        .fn()
        .mockRejectedValueOnce(authenticationError)
        .mockResolvedValue(NORMALIZED_DEVICES as readonly NormalizedTrackingDevice[]),
      getBreadcrumbs: vi.fn().mockResolvedValue([]),
    })
    const onStatusChange = vi.fn()

    const poller = createPollingManager(client, {
      intervalMs: 5_000,
      staleThresholdMs: 60 * 60 * 1000,
      onSnapshot: vi.fn(),
      onStatusChange,
      retryBaseMs: 1_000,
      now: () => new Date('2026-04-06T10:35:00.000Z'),
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(1_000)

    expect(client.authenticate).toHaveBeenCalledTimes(2)
    expect(onStatusChange).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'offline',
        warning: 'TRACKING AUTHENTICATION FAILED — check Traccar credentials.',
      }),
    )

    poller.stop()
  })

  it('does not skip sub-second breadcrumbs immediately after the previous cursor', async () => {
    const firstBatch = [
      {
        ...NORMALIZED_POSITIONS[0],
        id: 'breadcrumb-before-boundary',
        timestamp: '2026-04-06T10:00:04.900Z',
      },
      {
        ...NORMALIZED_POSITIONS[0],
        id: 'breadcrumb-at-boundary',
        timestamp: '2026-04-06T10:00:05.000Z',
      },
    ] satisfies readonly NormalizedTrackingPosition[]
    const secondBatch = [
      {
        ...NORMALIZED_POSITIONS[0],
        id: 'breadcrumb-at-boundary',
        timestamp: '2026-04-06T10:00:05.000Z',
      },
      {
        ...NORMALIZED_POSITIONS[0],
        id: 'breadcrumb-after-boundary',
        timestamp: '2026-04-06T10:00:05.500Z',
      },
    ] satisfies readonly NormalizedTrackingPosition[]
    const client = createClient({
      getBreadcrumbs: vi.fn()
        .mockResolvedValueOnce(firstBatch)
        .mockResolvedValueOnce(secondBatch),
    })
    const onSnapshot = vi.fn()
    const onPollDiagnostic = vi.fn()
    let currentTime = new Date('2026-04-06T10:00:05.000Z')

    const poller = createPollingManager(client, {
      intervalMs: 5_000,
      staleThresholdMs: 60 * 60 * 1000,
      onSnapshot,
      onStatusChange: vi.fn(),
      onPollDiagnostic,
      getBreadcrumbDeviceIds: () => ['1'],
      now: () => currentTime,
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)
    currentTime = new Date('2026-04-06T10:00:10.000Z')
    await vi.advanceTimersByTimeAsync(5_000)

    expect(client.getBreadcrumbs).toHaveBeenNthCalledWith(
      2,
      '1',
      new Date('2026-04-06T09:55:05.000Z'),
      expect.any(Date),
    )
    expect(
      onSnapshot.mock.calls
        .map((call) => call[0] as TrackingSnapshot)
        .some((snapshot) =>
          snapshot.breadcrumbs.some((breadcrumb) => breadcrumb.id === 'breadcrumb-after-boundary'),
        ),
    ).toBe(true)
    const latestSnapshot = onSnapshot.mock.calls.at(-1)?.[0] as TrackingSnapshot | undefined
    expect(
      latestSnapshot?.breadcrumbs.filter(
        (breadcrumb) => breadcrumb.timestamp === '2026-04-06T10:00:05.000Z',
      ),
    ).toHaveLength(1)
    expect(onPollDiagnostic).toHaveBeenLastCalledWith(
      expect.objectContaining({
        breadcrumbReturnedCount: 2,
        breadcrumbAcceptedCount: 1,
        breadcrumbDuplicateCount: 1,
        breadcrumbWindow: {
          previousCursorEarliest: '2026-04-06T10:00:05.000Z',
          previousCursorLatest: '2026-04-06T10:00:05.000Z',
          requestedFromEarliest: '2026-04-06T09:55:05.000Z',
          requestedFromLatest: '2026-04-06T09:55:05.000Z',
          requestedTo: '2026-04-06T10:00:10.000Z',
          newestReturnedEarliest: '2026-04-06T10:00:05.500Z',
          newestReturnedLatest: '2026-04-06T10:00:05.500Z',
        },
      }),
    )

    poller.stop()
  })

  it('marks aged live positions as stale in published snapshots', async () => {
    const client = createClient({
      getCurrentPositions: vi.fn().mockResolvedValue([
        {
          ...NORMALIZED_POSITIONS[0],
          timestamp: '2026-04-06T08:00:00.000Z',
        },
      ] satisfies readonly NormalizedTrackingPosition[]),
      getBreadcrumbs: vi.fn().mockResolvedValue([]),
    })
    const onSnapshot = vi.fn()

    const poller = createPollingManager(client, {
      intervalMs: 5_000,
      staleThresholdMs: 60 * 60 * 1000,
      onSnapshot,
      onStatusChange: vi.fn(),
      now: () => new Date('2026-04-06T10:35:00.000Z'),
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(onSnapshot.mock.calls[0]?.[0].positions[0]?.device_cache_stale).toBe(true)

    poller.stop()
  })

  it('keeps the polling timer alive while suppressing refresh during mission pause', async () => {
    const client = createClient()
    const onStatusChange = vi.fn()

    const poller = createPollingManager(client, {
      intervalMs: 5_000,
      staleThresholdMs: 60 * 60 * 1000,
      onSnapshot: vi.fn(),
      onStatusChange,
      getPollingMode: () => 'paused',
      now: () => new Date('2026-04-06T10:35:00.000Z'),
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(5_000)

    expect(client.authenticate).not.toHaveBeenCalled()
    expect(client.getDevices).not.toHaveBeenCalled()
    expect(onStatusChange).toHaveBeenCalledWith(
      expect.objectContaining({
        warning: 'Live refresh suspended while mission is paused.',
      }),
    )

    poller.stop()
  })

  it('stays idle without authenticating before a mission starts', async () => {
    const client = createClient()
    const onStatusChange = vi.fn()

    const poller = createPollingManager(client, {
      intervalMs: 5_000,
      staleThresholdMs: 60 * 60 * 1000,
      onSnapshot: vi.fn(),
      onStatusChange,
      getPollingMode: () => 'idle',
      now: () => new Date('2026-04-06T10:35:00.000Z'),
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(5_000)

    expect(client.authenticate).not.toHaveBeenCalled()
    expect(client.getDevices).not.toHaveBeenCalled()
    expect(onStatusChange).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'idle',
        warning: 'Waiting for an active mission.',
      }),
    )

    poller.stop()
  })

  it('does not publish a fresh online snapshot if the mission becomes inactive mid-poll', async () => {
    let pollingMode: 'active' | 'paused' | 'idle' = 'active'
    const client = createClient({
      getCurrentPositions: vi.fn().mockImplementation(() => {
        pollingMode = 'idle'
        return Promise.resolve(NORMALIZED_POSITIONS as readonly NormalizedTrackingPosition[])
      }),
    })
    const onSnapshot = vi.fn()
    const onStatusChange = vi.fn()

    const poller = createPollingManager(client, {
      intervalMs: 5_000,
      staleThresholdMs: 60 * 60 * 1000,
      onSnapshot,
      onStatusChange,
      getPollingMode: () => pollingMode,
      now: () => new Date('2026-04-06T10:35:00.000Z'),
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(onSnapshot).toHaveBeenCalledWith({
      devices: [],
      positions: [],
      breadcrumbs: [],
    })
    expect(onStatusChange).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'idle',
        warning: 'Waiting for an active mission.',
      }),
    )
    expect(onStatusChange).not.toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'online' }),
    )

    poller.stop()
  })

  it('clamps the retry delay to maxBackoffMs once the unbounded value would exceed it', async () => {
    const client = createClient({
      getDevices: vi.fn().mockRejectedValue(new Error('offline')),
    })
    const setTimeoutSpy = vi.fn(window.setTimeout.bind(window)) as unknown as typeof window.setTimeout
    const onStatusChange = vi.fn()

    const poller = createPollingManager(client, {
      intervalMs: 30_000,
      staleThresholdMs: 60 * 60 * 1000,
      onSnapshot: vi.fn(),
      onStatusChange,
      retryBaseMs: 1_000,
      maxBackoffMs: 60_000,
      now: () => new Date('2026-04-06T10:35:00.000Z'),
      setTimeout: setTimeoutSpy,
    })

    poller.start()

    // Drain enough failures to cross the cap. Failure 7 would compute 64_000 ms unclamped.
    for (let i = 0; i < 10; i += 1) {
      // Each iteration: advance the currently scheduled retry, then let the next
      // poll/await chain settle so the next setTimeout is scheduled.
      const lastDelay = (setTimeoutSpy as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)?.[1] as number
      await vi.advanceTimersByTimeAsync(lastDelay ?? 1)
    }

    const recordedDelays = (setTimeoutSpy as unknown as { mock: { calls: [() => void, number][] } }).mock.calls.map(
      (call) => call[1],
    )

    // Failure 1 -> 1_000, 2 -> 2_000, 3 -> 4_000, 4 -> 8_000, 5 -> 16_000, 6 -> 32_000.
    // Failure 7 onwards -> clamped at 60_000.
    expect(recordedDelays.slice(0, 6)).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 32_000])
    expect(recordedDelays.slice(6)).toEqual(recordedDelays.slice(6).map(() => 60_000))
    expect(recordedDelays.length).toBeGreaterThanOrEqual(7)

    poller.stop()
  })

  it('normalizes invalid success-poll intervals before scheduling the next poll [DON-208]', async () => {
    const client = createClient()
    const setTimeoutSpy = vi.fn(window.setTimeout.bind(window)) as unknown as typeof window.setTimeout

    const poller = createPollingManager(client, {
      intervalMs: Number.NaN,
      staleThresholdMs: 60 * 60 * 1000,
      onSnapshot: vi.fn(),
      onStatusChange: vi.fn(),
      now: () => new Date('2026-04-06T10:35:00.000Z'),
      setTimeout: setTimeoutSpy,
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)

    const recordedDelays = (setTimeoutSpy as unknown as { mock: { calls: [() => void, number][] } }).mock.calls.map(
      (call) => call[1],
    )
    expect(recordedDelays.at(-1)).toBe(30_000)

    poller.stop()
  })

  it('clamps too-short success-poll intervals to five seconds [DON-208]', async () => {
    const client = createClient()
    const setTimeoutSpy = vi.fn(window.setTimeout.bind(window)) as unknown as typeof window.setTimeout

    const poller = createPollingManager(client, {
      intervalMs: 0,
      staleThresholdMs: 60 * 60 * 1000,
      onSnapshot: vi.fn(),
      onStatusChange: vi.fn(),
      now: () => new Date('2026-04-06T10:35:00.000Z'),
      setTimeout: setTimeoutSpy,
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)

    const recordedDelays = (setTimeoutSpy as unknown as { mock: { calls: [() => void, number][] } }).mock.calls.map(
      (call) => call[1],
    )
    expect(recordedDelays.at(-1)).toBe(5_000)

    poller.stop()
  })

  it('honours an explicit validation-only minimum without changing the production default [DON-246]', async () => {
    const client = createClient()
    const poller = createPollingManager(client, {
      intervalMs: 25,
      minimumIntervalMs: 25,
      staleThresholdMs: 60 * 60 * 1000,
      onSnapshot: vi.fn(),
      onStatusChange: vi.fn(),
      now: () => new Date('2026-04-06T10:35:00.000Z'),
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(25)

    expect(client.getDevices).toHaveBeenCalledTimes(2)
    poller.stop()
  })

  it('clamps too-long success-poll intervals to one hour [DON-208]', async () => {
    const client = createClient()
    const setTimeoutSpy = vi.fn(window.setTimeout.bind(window)) as unknown as typeof window.setTimeout

    const poller = createPollingManager(client, {
      intervalMs: 24 * 60 * 60 * 1000,
      staleThresholdMs: 60 * 60 * 1000,
      onSnapshot: vi.fn(),
      onStatusChange: vi.fn(),
      now: () => new Date('2026-04-06T10:35:00.000Z'),
      setTimeout: setTimeoutSpy,
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)

    const recordedDelays = (setTimeoutSpy as unknown as { mock: { calls: [() => void, number][] } }).mock.calls.map(
      (call) => call[1],
    )
    expect(recordedDelays.at(-1)).toBe(60 * 60 * 1000)

    poller.stop()
  })

  it('continues aggregating breadcrumbs from healthy devices when one device fails', async () => {
    const onSnapshot = vi.fn()
    const onStatusChange = vi.fn()
    const logger = { warn: vi.fn() }
    const devices = [
      NORMALIZED_DEVICES[0],
      NORMALIZED_DEVICES[1],
      { ...NORMALIZED_DEVICES[0], device_id: '3', name: 'Hill team' },
    ] satisfies readonly NormalizedTrackingDevice[]
    const deviceOneBreadcrumb = {
      ...NORMALIZED_BREADCRUMBS[0],
      id: 'breadcrumb-device-1',
      device_id: '1',
    } satisfies NormalizedTrackingPosition
    const deviceThreeBreadcrumb = {
      ...NORMALIZED_BREADCRUMBS[0],
      id: 'breadcrumb-device-3',
      device_id: '3',
    } satisfies NormalizedTrackingPosition

    const client = createClient({
      getDevices: vi.fn().mockResolvedValue(devices),
      getBreadcrumbs: vi.fn().mockImplementation((deviceId: string) => {
        if (deviceId === '2') {
          return Promise.reject(new Error('HTTP 500'))
        }
        if (deviceId === '3') {
          return Promise.resolve([deviceThreeBreadcrumb])
        }
        return Promise.resolve([deviceOneBreadcrumb])
      }),
    })

    const poller = createPollingManager(client, {
      intervalMs: 5_000,
      staleThresholdMs: 60 * 60 * 1000,
      onSnapshot,
      onStatusChange,
      retryBaseMs: 1_000,
      maxBackoffMs: 60_000,
      logger,
      now: () => new Date('2026-04-06T10:35:00.000Z'),
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)

    const firstSnapshotWithBreadcrumbs = onSnapshot.mock.calls.at(-1)?.[0] as {
      breadcrumbs: readonly NormalizedTrackingPosition[]
    }
    expect(firstSnapshotWithBreadcrumbs.breadcrumbs.map((breadcrumb) => breadcrumb.device_id)).toEqual([
      '1',
      '3',
    ])

    expect(onStatusChange).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'online', consecutiveFailures: 0 }),
    )
    expect(onStatusChange).not.toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'offline' }),
    )

    expect(logger.warn).toHaveBeenCalledTimes(1)
    const warnCall = logger.warn.mock.calls[0]
    expect(warnCall?.[0]).toContain('breadcrumb')
    expect(warnCall?.[1]).toEqual(
      expect.objectContaining({ deviceId: '2' }),
    )

    poller.stop()
  })

  it('keeps quiet-device breadcrumbs when another device exceeds the render budget [DON-159]', async () => {
    const onSnapshot = vi.fn()
    const devices = [
      { ...NORMALIZED_DEVICES[0]!, device_id: '2', name: 'Eamonn O Connor' },
      { ...NORMALIZED_DEVICES[1]!, device_id: '25', name: 'Richard Morrison' },
    ] satisfies readonly NormalizedTrackingDevice[]
    const noisyDeviceBreadcrumbs = Array.from({ length: 25_000 }, (_, index) => ({
      ...NORMALIZED_BREADCRUMBS[0]!,
      id: `eoc-${index}`,
      device_id: '2',
      lat: 52 + index / 1_000_000,
      lon: -9.7 - index / 1_000_000,
      timestamp: new Date(Date.UTC(2026, 5, 13, 0, 0, index)).toISOString(),
    }))
    const quietDeviceBreadcrumbs = Array.from({ length: 3_280 }, (_, index) => ({
      ...NORMALIZED_BREADCRUMBS[0]!,
      id: `richard-${index}`,
      device_id: '25',
      lat: 51.99 + index / 1_000_000,
      lon: -9.74 - index / 1_000_000,
      timestamp: new Date(Date.UTC(2026, 5, 12, 12, 0, index)).toISOString(),
    }))
    const client = createClient({
      getDevices: vi.fn().mockResolvedValue(devices),
      getBreadcrumbs: vi.fn().mockImplementation((deviceId: string) => {
        if (deviceId === '2') {
          return Promise.resolve(noisyDeviceBreadcrumbs)
        }
        if (deviceId === '25') {
          return Promise.resolve(quietDeviceBreadcrumbs)
        }
        return Promise.resolve([])
      }),
    })

    const poller = createPollingManager(client, {
      intervalMs: 5_000,
      staleThresholdMs: 60 * 60 * 1000,
      onSnapshot,
      onStatusChange: vi.fn(),
      now: () => new Date('2026-06-13T21:48:51.654Z'),
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)

    const latestSnapshot = onSnapshot.mock.calls.at(-1)?.[0]
    expect(latestSnapshot?.breadcrumbs.some((position) => position.device_id === '25')).toBe(true)
    expect(latestSnapshot?.breadcrumbs).toHaveLength(8_280)
    expect(latestSnapshot?.rawBreadcrumbsForPersistence).toHaveLength(28_280)
    expect(
      latestSnapshot?.rawBreadcrumbsForPersistence?.filter((position) => position.device_id === '2'),
    ).toHaveLength(25_000)
    expect(
      latestSnapshot?.rawBreadcrumbsForPersistence?.filter((position) => position.device_id === '25'),
    ).toHaveLength(3_280)
    expect(latestSnapshot?.breadcrumbMetadata?.deviceBudgets).toContainEqual(
      expect.objectContaining({
        deviceId: '2',
        firstTimestamp: noisyDeviceBreadcrumbs[0]!.timestamp,
        lastTimestamp: noisyDeviceBreadcrumbs.at(-1)!.timestamp,
        truncated: true,
      }),
    )
    expect(latestSnapshot?.breadcrumbMetadata?.deviceBudgets).toContainEqual(
      expect.objectContaining({ deviceId: '25', retained: 3_280, truncated: false }),
    )

    poller.stop()
  })

  it('can restrict breadcrumb history fetches to requested device ids [DON-159]', async () => {
    const devices = [
      { ...NORMALIZED_DEVICES[0]!, device_id: '2', name: 'Eamonn O Connor' },
      { ...NORMALIZED_DEVICES[1]!, device_id: '25', name: 'Richard Morrison' },
      { ...NORMALIZED_DEVICES[0]!, device_id: '99', name: 'Cold roster device' },
    ] satisfies readonly NormalizedTrackingDevice[]
    const client = createClient({
      getDevices: vi.fn().mockResolvedValue(devices),
      getBreadcrumbs: vi.fn().mockResolvedValue([]),
    })

    const poller = createPollingManager(client, {
      intervalMs: 5_000,
      staleThresholdMs: 60 * 60 * 1000,
      onSnapshot: vi.fn(),
      onStatusChange: vi.fn(),
      getBreadcrumbDeviceIds: () => ['2', '25'],
      now: () => new Date('2026-06-13T21:48:51.654Z'),
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(client.getBreadcrumbs).toHaveBeenCalledWith('2', expect.any(Date), expect.any(Date))
    expect(client.getBreadcrumbs).toHaveBeenCalledWith('25', expect.any(Date), expect.any(Date))
    expect(client.getBreadcrumbs).not.toHaveBeenCalledWith('99', expect.any(Date), expect.any(Date))

    poller.stop()
  })

  it('routes per-device breadcrumb failures through logger.warn rather than console.error', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const logger = { warn: vi.fn() }
      const client = createClient({
        getBreadcrumbs: vi.fn().mockRejectedValue(new Error('HTTP 500')),
      })

      const poller = createPollingManager(client, {
        intervalMs: 5_000,
        staleThresholdMs: 60 * 60 * 1000,
        onSnapshot: vi.fn(),
        onStatusChange: vi.fn(),
        logger,
        now: () => new Date('2026-04-06T10:35:00.000Z'),
      })

      poller.start()
      await vi.advanceTimersByTimeAsync(0)

      expect(logger.warn).toHaveBeenCalled()
      expect(consoleErrorSpy).not.toHaveBeenCalled()

      poller.stop()
    } finally {
      consoleErrorSpy.mockRestore()
    }
  })

  it('resets breadcrumb history when a new mission session starts', async () => {
    const client = createClient()
    const onSnapshot = vi.fn()
    let historyResetKey: string | null = 'mission-1'
    let initialBreadcrumbFrom = new Date('2026-04-06T07:00:00.000Z')

    const poller = createPollingManager(client, {
      intervalMs: 5_000,
      staleThresholdMs: 60 * 60 * 1000,
      onSnapshot,
      onStatusChange: vi.fn(),
      getHistoryResetKey: () => historyResetKey,
      getInitialBreadcrumbFrom: () => initialBreadcrumbFrom,
      now: () => new Date('2026-04-06T10:35:00.000Z'),
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)

    historyResetKey = 'mission-2'
    initialBreadcrumbFrom = new Date('2026-04-06T09:00:00.000Z')
    await vi.advanceTimersByTimeAsync(5_000)

    expect(client.getBreadcrumbs).toHaveBeenCalledWith(
      '1',
      new Date('2026-04-06T07:00:00.000Z'),
      expect.any(Date),
    )
    expect(client.getBreadcrumbs).toHaveBeenCalledWith(
      '1',
      new Date('2026-04-06T09:00:00.000Z'),
      expect.any(Date),
    )
    expect(onSnapshot.mock.calls[0]?.[0].breadcrumbs).toHaveLength(0)
    expect(onSnapshot.mock.calls[1]?.[0].breadcrumbs).toHaveLength(3)
    expect(onSnapshot.mock.calls[2]?.[0].breadcrumbs).toHaveLength(0)
    expect(onSnapshot.mock.calls[3]?.[0].breadcrumbs).toHaveLength(3)

    poller.stop()
  })
})
