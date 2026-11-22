import { describe, expect, it } from 'vitest'

import {
  annotateTrackingSnapshotHealth,
  calculateCacheAgeMs,
  isTrackingCacheUsable,
} from '../../src/features/tracking/tracking-snapshot-health'
import { selectNewestKnownFixes } from '../../src/features/tracking/newest-known-fix'
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
      timestamp_source: 'fix',
      fix_time_unverified: false,
      source: 'traccar',
      data_origin: 'live',
      cache_age_seconds: null,
      device_cache_stale: false,
    },
  ],
  breadcrumbs: [],
}

describe('tracking snapshot health', () => {
  it('marks a fix timestamped well ahead of the laptop clock as stale and flags the clock difference [DON-349 M-06]', () => {
    // The tracker sends local summer time as UTC, or the laptop clock runs behind.
    const snapshot = annotateTrackingSnapshotHealth(LIVE_SNAPSHOT, {
      now: new Date('2026-04-06T09:30:00.000Z'),
      deviceStaleThresholdMs: 5 * 60 * 1000,
    })

    expect(snapshot.positions[0]?.device_cache_stale).toBe(true)
    expect(snapshot.positions[0]?.fix_time_ahead_of_clock).toBe(true)
    // Display health only: the fix itself is unchanged.
    expect(snapshot.positions[0]?.timestamp).toBe('2026-04-06T10:30:00.000Z')
    expect(snapshot.positions[0]?.fix_time_unverified).toBe(false)
  })

  it('tolerates small clock differences and clears the flag once the clock catches up [DON-349 M-06]', () => {
    const slightlyAhead = annotateTrackingSnapshotHealth(LIVE_SNAPSHOT, {
      now: new Date('2026-04-06T10:29:00.000Z'),
    })
    expect(slightlyAhead.positions[0]?.device_cache_stale).toBe(false)
    expect(slightlyAhead.positions[0]?.fix_time_ahead_of_clock).toBeUndefined()

    const flagged = annotateTrackingSnapshotHealth(LIVE_SNAPSHOT, {
      now: new Date('2026-04-06T10:00:00.000Z'),
    })
    const caughtUp = annotateTrackingSnapshotHealth(flagged, {
      now: new Date('2026-04-06T10:31:00.000Z'),
    })
    expect(caughtUp.positions[0]?.device_cache_stale).toBe(false)
    expect(caughtUp.positions[0]?.fix_time_ahead_of_clock).toBeUndefined()
  })

  it('flags a device whose newest breadcrumb is ahead of the clock, so the marker it wins is never Live [DON-349 M-06 review]', () => {
    // A wrong 11:00 fix was stored; the tracker clock was then corrected and
    // now reports 10:30. The 11:00 breadcrumb still wins marker selection.
    const futureBreadcrumb = { ...LIVE_SNAPSHOT.positions[0]!, id: 'crumb-future', lat: 52.5, timestamp: '2026-04-06T11:00:00.000Z' }
    const snapshot = annotateTrackingSnapshotHealth(
      { ...LIVE_SNAPSHOT, breadcrumbs: [futureBreadcrumb] },
      { now: new Date('2026-04-06T10:30:30.000Z'), deviceStaleThresholdMs: 5 * 60 * 1000 },
    )

    const [marker] = selectNewestKnownFixes(snapshot.positions, snapshot.breadcrumbs)
    expect(marker?.id).toBe('crumb-future')
    expect(marker?.device_cache_stale).toBe(true)
    expect(marker?.fix_time_ahead_of_clock).toBe(true)
    expect(snapshot.positions[0]?.fix_time_ahead_of_clock).toBe(true)
  })

  it('uses the operational five-minute stale threshold by default [DON-260]', () => {
    const snapshot = annotateTrackingSnapshotHealth(LIVE_SNAPSHOT, {
      now: new Date('2026-04-06T10:35:01.000Z'),
    })

    expect(snapshot.positions[0]?.device_cache_stale).toBe(true)
  })

  it('marks live positions stale when their age exceeds the device threshold', () => {
    const snapshot = annotateTrackingSnapshotHealth(LIVE_SNAPSHOT, {
      now: new Date('2026-04-06T11:31:00.000Z'),
      deviceStaleThresholdMs: 60 * 60 * 1000,
    })

    expect(snapshot.positions[0]?.device_cache_stale).toBe(true)
    expect(snapshot.positions[0]?.cache_age_seconds).toBeNull()
  })

  it('marks server-time-only positions as unverified without conflating that with age [DON-267]', () => {
    const snapshot = annotateTrackingSnapshotHealth(
      {
        ...LIVE_SNAPSHOT,
        positions: LIVE_SNAPSHOT.positions.map((position) => ({
          ...position,
          timestamp_source: 'server' as const,
        })),
      },
      {
        now: new Date('2026-04-06T10:30:01.000Z'),
        deviceStaleThresholdMs: 60 * 60 * 1000,
      },
    )

    expect(snapshot.positions[0]?.fix_time_unverified).toBe(true)
    expect(snapshot.positions[0]?.device_cache_stale).toBe(false)
  })

  it('preserves an explicit unverified fix-time flag from cache normalization [DON-267]', () => {
    const snapshot = annotateTrackingSnapshotHealth(
      {
        ...LIVE_SNAPSHOT,
        positions: LIVE_SNAPSHOT.positions.map((position) => ({
          ...position,
          timestamp_source: 'device' as const,
          fix_time_unverified: true,
        })),
      },
      {
        now: new Date('2026-04-06T10:30:01.000Z'),
        deviceStaleThresholdMs: 60 * 60 * 1000,
      },
    )

    expect(snapshot.positions[0]?.fix_time_unverified).toBe(true)
  })

  it('marks a location with missing timestamp provenance explicitly unverified [DON-267] [SAR-QA-021]', () => {
    const snapshot = annotateTrackingSnapshotHealth(
      {
        ...LIVE_SNAPSHOT,
        positions: LIVE_SNAPSHOT.positions.map((position) => {
          const withoutSource = { ...position }
          delete withoutSource.timestamp_source
          return withoutSource
        }),
      },
      {
        now: new Date('2026-04-06T10:30:01.000Z'),
        deviceStaleThresholdMs: 60 * 60 * 1000,
      },
    )

    expect(snapshot.positions[0]?.fix_time_unverified).toBe(true)
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
