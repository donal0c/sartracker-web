import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createCoverageController } from '../../src/features/tracking/coverage-controller'
import { createExactBreadcrumbDotController } from '../../src/features/tracking/exact-breadcrumb-dot-controller'
import {
  createPollingManager,
  type TrackingPollerClient,
} from '../../src/features/tracking/polling-manager'
import type {
  NormalizedTrackingDevice,
  NormalizedTrackingPosition,
} from '../../src/features/tracking/tracking-types'

describe('coverage current-position isolation [DON-276]', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('publishes a new current fix within one poll while coverage and exact Dots are both blocked', async () => {
    const never = new Promise<never>(() => undefined)
    const coverage = createCoverageController({
      readManifest: () => never,
      readChunk: () => never,
      readClaim: () => never,
      applyChunk: () => never,
      publish: vi.fn(),
    })
    void coverage.updateContext({ missionId: 'mission-1', rendererGeneration: 'r1' })
    const dots = createExactBreadcrumbDotController({
      limit: 10_000,
      queryPage: () => never,
      publish: vi.fn(),
    })
    dots.updateContext({ missionId: 'mission-1', trailMode: 'dots', activeDeviceIds: ['device-1'] })

    const onSnapshot = vi.fn()
    const client: TrackingPollerClient = {
      authenticate: vi.fn(async () => undefined),
      getDevices: vi.fn(async () => [device()]),
      getCurrentPositions: vi.fn(async () => [position()]),
      getBreadcrumbs: vi.fn(() => never),
    }
    const poller = createPollingManager(client, {
      intervalMs: 5_000,
      staleThresholdMs: 60_000,
      onSnapshot,
      onStatusChange: vi.fn(),
      now: () => new Date('2026-08-24T10:00:00.000Z'),
    })

    poller.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(onSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        positions: [expect.objectContaining({ id: 'current-1' })],
      }),
      expect.any(Object),
    )
    poller.stop()
    coverage.stop()
    dots.stop()
  })
})

function device(): NormalizedTrackingDevice {
  return {
    id: 'device-1', name: 'Device 1', status: 'online', last_update: null,
    category: null, group_id: null, unique_id: null,
  }
}

function position(): NormalizedTrackingPosition {
  return {
    id: 'current-1', device_id: 'device-1', lat: 52, lon: -9.7,
    altitude: null, speed: null, battery: null, accuracy: null,
    timestamp: '2026-08-24T10:00:00.000Z', source: 'traccar', data_origin: 'live',
    cache_age_seconds: null, device_cache_stale: false,
  }
}
