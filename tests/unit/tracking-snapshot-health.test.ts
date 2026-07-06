import { describe, expect, it } from 'vitest'

import {
  annotateTrackingSnapshotHealth,
  calculateCacheAgeMs,
  isTrackingCacheUsable,
} from '../../src/features/tracking/tracking-snapshot-health'
import type { TrackingSnapshot } from '../../src/features/tracking/tracking-types'

const LIVE_SNAPSHOT: TrackingSnapshot = {
  devices: [
    {
      device_id: '1',
      name: 'Device 1',
      status: 'online',
      last_seen: '2026-04-06T10:30:00.000Z',
      unique_id: null,
      category: null,
    },
  ],
  positions: [
    {
      id: 'position-1',
      device_id: '1',
      lat: 52,
      lon: -9.7,
      altitude: null,
      speed: null,
      battery: null,
      accuracy: null,
      timestamp: '2026-04-06T10:30:00.000Z',
      source: 'traccar',
      data_origin: 'live',
      cache_age_seconds: null,
      device_cache_stale: false,
    },
  ],
  breadcrumbs: [],
}

describe('tracking snapshot health', () => {
  it('marks live positions stale when their age exceeds the device threshold', () => {
    const snapshot = annotateTrackingSnapshotHealth(LIVE_SNAPSHOT, {
      now: new Date('2026-04-06T11:31:00.000Z'),
      deviceStaleThresholdMs: 60 * 60 * 1000,
    })

    expect(snapshot.positions[0]?.device_cache_stale).toBe(true)
    expect(snapshot.positions[0]?.cache_age_seconds).toBeNull()
  })

  it('marks cached positions with cache age and stale state after cache ttl', () => {
    const snapshot = annotateTrackingSnapshotHealth(
      {
        ...LIVE_SNAPSHOT,
        positions: LIVE_SNAPSHOT.positions.map((position) => ({
          ...position,
          data_origin: 'cache' as const,
        })),
      },
      {
        now: new Date('2026-04-06T10:36:00.000Z'),
        cacheAgeMs: 6 * 60 * 1000,
        cacheStaleTtlMs: 5 * 60 * 1000,
      },
    )

    expect(snapshot.positions[0]?.cache_age_seconds).toBe(360)
    expect(snapshot.positions[0]?.device_cache_stale).toBe(true)
  })

  it('preserves breadcrumb array identity while annotating current-position health [DON-235]', () => {
    const breadcrumb = {
      ...LIVE_SNAPSHOT.positions[0]!,
      id: 'breadcrumb-1',
      timestamp: '2026-04-06T10:20:00.000Z',
    }
    const breadcrumbs = [breadcrumb]
    const snapshot = annotateTrackingSnapshotHealth(
      {
        ...LIVE_SNAPSHOT,
        breadcrumbs,
      },
      {
        now: new Date('2026-04-06T11:31:00.000Z'),
        deviceStaleThresholdMs: 60 * 60 * 1000,
      },
    )

    expect(snapshot.positions).not.toBe(LIVE_SNAPSHOT.positions)
    expect(snapshot.positions[0]?.device_cache_stale).toBe(true)
    expect(snapshot.breadcrumbs).toBe(breadcrumbs)
    expect(snapshot.breadcrumbs[0]).toBe(breadcrumb)
  })

  it('preserves current-position array identity when health metadata is unchanged [DON-235]', () => {
    const snapshot = annotateTrackingSnapshotHealth(LIVE_SNAPSHOT, {
      now: new Date('2026-04-06T10:31:00.000Z'),
      deviceStaleThresholdMs: 60 * 60 * 1000,
    })

    expect(snapshot.positions).toBe(LIVE_SNAPSHOT.positions)
  })

  it('rejects cache snapshots older than the max age', () => {
    expect(
      isTrackingCacheUsable(
        '2026-04-06T06:00:00.000Z',
        new Date('2026-04-06T10:36:00.000Z'),
      ),
    ).toBe(false)
  })

  it('calculates cache age relative to the supplied clock', () => {
    expect(
      calculateCacheAgeMs(
        '2026-04-06T10:30:00.000Z',
        new Date('2026-04-06T10:36:00.000Z'),
      ),
    ).toBe(6 * 60 * 1000)
  })
})
