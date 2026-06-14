import { afterEach, describe, expect, it, vi } from 'vitest'

import breadcrumbsFixture from '../fixtures/traccar-breadcrumbs.json'
import {
  accumulateBreadcrumbPositions,
  appendBreadcrumbPositions,
  createBreadcrumbSegments,
  decimateBreadcrumbsForDots,
} from '../../src/features/tracking/breadcrumb-accumulator'
import { normalizeTraccarPosition } from '../../src/features/tracking/traccar-normalization'

describe('breadcrumb accumulator', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('deduplicates by device and timestamp while keeping chronological order', () => {
    const positions = breadcrumbsFixture.map((position) =>
      normalizeTraccarPosition(position, 'live'),
    )

    const accumulated = appendBreadcrumbPositions([], positions)

    expect(accumulated).toHaveLength(3)
    expect(accumulated[0].timestamp).toBe('2026-04-06T10:00:00.000Z')
    expect(accumulated[2].timestamp).toBe('2026-04-06T10:30:00.000Z')

    const deduplicated = appendBreadcrumbPositions(accumulated, positions)
    expect(deduplicated).toHaveLength(3)
  })

  it('does not rebuild breadcrumb history when an incremental poll has no new positions', () => {
    const positions = breadcrumbsFixture.map((position) =>
      normalizeTraccarPosition(position, 'live'),
    )

    expect(appendBreadcrumbPositions(positions, [])).toBe(positions)
  })

  it('does not let a noisy device evict another device from the live breadcrumb budget [DON-159]', () => {
    const noisyDeviceBreadcrumbs = Array.from({ length: 25_000 }, (_, index) =>
      normalizeTraccarPosition(
        {
          id: index + 1,
          deviceId: 2,
          latitude: 52 + index / 1_000_000,
          longitude: -9.7 - index / 1_000_000,
          fixTime: new Date(Date.UTC(2026, 5, 13, 0, 0, index)).toISOString(),
        },
        'live',
      ),
    )
    const quietDeviceBreadcrumbs = Array.from({ length: 3_280 }, (_, index) =>
      normalizeTraccarPosition(
        {
          id: 50_000 + index,
          deviceId: 25,
          latitude: 51.99 + index / 1_000_000,
          longitude: -9.74 - index / 1_000_000,
          fixTime: new Date(Date.UTC(2026, 5, 12, 12, 0, index)).toISOString(),
        },
        'live',
      ),
    )

    const result = accumulateBreadcrumbPositions(
      [],
      [...quietDeviceBreadcrumbs, ...noisyDeviceBreadcrumbs],
    )

    expect(result.positions.some((position) => position.device_id === '25')).toBe(true)
    expect(result.positions.filter((position) => position.device_id === '25')).toHaveLength(3_280)
    expect(result.metadata.deviceBudgets).toContainEqual(
      expect.objectContaining({
        deviceId: '2',
        retained: 5_000,
        total: 25_000,
        firstTimestamp: noisyDeviceBreadcrumbs[0]!.timestamp,
        lastTimestamp: noisyDeviceBreadcrumbs.at(-1)!.timestamp,
        truncated: true,
      }),
    )
    expect(result.metadata.deviceBudgets).toContainEqual(
      expect.objectContaining({
        deviceId: '25',
        retained: 3_280,
        total: 3_280,
        truncated: false,
      }),
    )
  })

  it('does not re-sort the entire retained history on a steady-state incremental poll [DON-165]', () => {
    // A real incident: one device with a long, already-accumulated trail. Each
    // poll appends only a few fresh fixes. The accumulator must integrate the
    // increment incrementally, not re-sort the whole retained set every poll —
    // otherwise per-poll cost grows with cumulative history (the DON-151 class).
    const baseMs = Date.UTC(2026, 5, 13, 0, 0, 0)
    const existing = Array.from({ length: 4_000 }, (_, index) =>
      normalizeTraccarPosition(
        {
          id: index + 1,
          deviceId: 7,
          latitude: 52 + index / 1_000_000,
          longitude: -9.7 - index / 1_000_000,
          fixTime: new Date(baseMs + index * 1_000).toISOString(),
        },
        'live',
      ),
    )
    // Seed the accumulator so `existing` is in the same shape it has across polls.
    const seeded = accumulateBreadcrumbPositions([], existing).positions

    const incoming = Array.from({ length: 5 }, (_, index) =>
      normalizeTraccarPosition(
        {
          id: 10_000 + index,
          deviceId: 7,
          latitude: 52.01 + index / 1_000_000,
          longitude: -9.71 - index / 1_000_000,
          fixTime: new Date(baseMs + (4_000 + index) * 1_000).toISOString(),
        },
        'live',
      ),
    )

    const parseSpy = vi.spyOn(Date, 'parse')
    const result = accumulateBreadcrumbPositions(seeded, incoming)
    const parseCalls = parseSpy.mock.calls.length

    // Correctness: increment integrated, no loss, global chronological order
    // preserved (the established contract — see tracking-geojson DON-159 test).
    expect(result.positions).toHaveLength(4_005)
    expect(result.positions.at(-1)!.id).toBe('10004')
    const timestamps = result.positions.map((position) => Date.parse(position.timestamp))
    expect(timestamps).toEqual([...timestamps].sort((left, right) => left - right))

    // Scaling guard: the old implementation called Date.parse inside two
    // O(n log n) sort comparators, so per-poll parse cost grew with the whole
    // retained set times a log factor (~16k calls here). The fix parses each
    // breadcrumb's timestamp at most once per poll — bounded by the combined
    // set size, with no log multiplier. This is the invariant that keeps
    // per-poll cost from scaling with cumulative history.
    expect(parseCalls).toBeLessThanOrEqual(seeded.length + incoming.length)
  })

  it('segments trails when time gaps exceed the configured threshold', () => {
    const positions = [
      normalizeTraccarPosition(
        {
          id: 1,
          deviceId: 1,
          latitude: 52.0,
          longitude: -9.7,
          fixTime: '2026-04-06T10:00:00.000Z',
        },
        'live',
      ),
      normalizeTraccarPosition(
        {
          id: 2,
          deviceId: 1,
          latitude: 52.0001,
          longitude: -9.7001,
          fixTime: '2026-04-06T10:03:00.000Z',
        },
        'live',
      ),
      normalizeTraccarPosition(
        {
          id: 3,
          deviceId: 1,
          latitude: 52.0002,
          longitude: -9.7002,
          fixTime: '2026-04-06T10:12:00.000Z',
        },
        'live',
      ),
    ]

    const segments = createBreadcrumbSegments(positions, 5 * 60 * 1000)

    expect(segments).toHaveLength(2)
    expect(segments[0]).toHaveLength(2)
    expect(segments[1]).toHaveLength(1)
  })
})

describe('decimateBreadcrumbsForDots [DON-126]', () => {
  function makePosition(deviceId: string, lat: number, lon: number, ts: string) {
    return {
      id: `${deviceId}-${ts}`,
      device_id: deviceId,
      lat,
      lon,
      altitude: null,
      speed: null,
      battery: null,
      accuracy: null,
      timestamp: ts,
      source: null,
      data_origin: 'live' as const,
      cache_age_seconds: null,
      device_cache_stale: false,
    }
  }

  it('preserves all points when below distance threshold', () => {
    const positions = [
      makePosition('d1', 52.0, -9.7, '2026-01-01T10:00:00Z'),
      makePosition('d1', 52.001, -9.7, '2026-01-01T10:01:00Z'),
      makePosition('d1', 52.002, -9.7, '2026-01-01T10:02:00Z'),
    ]
    // ~111m between each point — all above 40m threshold
    const result = decimateBreadcrumbsForDots(positions, 40)
    expect(result).toHaveLength(3)
  })

  it('removes close intermediate points while keeping first and last', () => {
    const positions = [
      makePosition('d1', 52.0, -9.7, '2026-01-01T10:00:00Z'),
      makePosition('d1', 52.00001, -9.7, '2026-01-01T10:00:05Z'),
      makePosition('d1', 52.00002, -9.7, '2026-01-01T10:00:10Z'),
      makePosition('d1', 52.001, -9.7, '2026-01-01T10:01:00Z'),
    ]
    // Points 2 and 3 are ~1-2m from point 1 — should be skipped (40m threshold)
    const result = decimateBreadcrumbsForDots(positions, 40)
    expect(result).toHaveLength(2) // first + last kept; intermediate points too close
  })

  it('returns all points when minDistanceM is 0', () => {
    const positions = [
      makePosition('d1', 52.0, -9.7, '2026-01-01T10:00:00Z'),
      makePosition('d1', 52.0, -9.7, '2026-01-01T10:00:05Z'),
    ]
    const result = decimateBreadcrumbsForDots(positions, 0)
    expect(result).toHaveLength(2)
  })

  it('handles multiple devices independently', () => {
    const positions = [
      makePosition('d1', 52.0, -9.7, '2026-01-01T10:00:00Z'),
      makePosition('d1', 52.00001, -9.7, '2026-01-01T10:00:05Z'),
      makePosition('d2', 52.0, -9.7, '2026-01-01T10:00:00Z'),
      makePosition('d2', 52.001, -9.7, '2026-01-01T10:01:00Z'),
    ]
    const result = decimateBreadcrumbsForDots(positions, 40)
    // d1: first + last (close points) = 2
    // d2: first + last (far apart) = 2
    expect(result).toHaveLength(4)
  })
})
