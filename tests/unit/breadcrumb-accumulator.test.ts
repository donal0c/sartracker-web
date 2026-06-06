import { describe, expect, it } from 'vitest'

import breadcrumbsFixture from '../fixtures/traccar-breadcrumbs.json'
import {
  appendBreadcrumbPositions,
  createBreadcrumbSegments,
  decimateBreadcrumbsForDots,
} from '../../src/features/tracking/breadcrumb-accumulator'
import { normalizeTraccarPosition } from '../../src/features/tracking/traccar-normalization'

describe('breadcrumb accumulator', () => {
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
