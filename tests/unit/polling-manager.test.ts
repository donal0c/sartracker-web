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
    expect(onSnapshot).toHaveBeenCalledTimes(4)

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
    expect(onSnapshot.mock.calls[1]?.[0].breadcrumbs).toHaveLength(3)
    expect(onSnapshot.mock.calls[3]?.[0].breadcrumbs).toHaveLength(3)

    poller.stop()
  })
})
