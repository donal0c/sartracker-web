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
    expect(onSnapshot).toHaveBeenCalledTimes(2)

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

    expect(onSnapshot).toHaveBeenCalledTimes(2)
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
      shouldPoll: () => false,
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
    expect(onSnapshot.mock.calls[0]?.[0].breadcrumbs).toHaveLength(3)
    expect(onSnapshot.mock.calls[1]?.[0].breadcrumbs).toHaveLength(3)

    poller.stop()
  })
})
