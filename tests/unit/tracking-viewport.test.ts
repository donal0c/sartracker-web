import { describe, expect, it } from 'vitest'

import type { NormalizedTrackingPosition, TrackingSnapshot } from '../../src/features/tracking/tracking-types'
import {
  buildPositionsExtent,
  buildTrackingInitialExtent,
} from '../../src/features/tracking/tracking-viewport'

describe('tracking viewport', () => {
  const position = (overrides: {
    readonly id: string
    readonly device_id: string
    readonly lat: number
    readonly lon: number
  }): NormalizedTrackingPosition => ({
    id: overrides.id,
    device_id: overrides.device_id,
    lat: overrides.lat,
    lon: overrides.lon,
    altitude: null,
    speed: null,
    battery: null,
    accuracy: null,
    timestamp: '2026-04-11T10:00:00.000Z',
    source: null,
    data_origin: 'live',
    cache_age_seconds: null,
    device_cache_stale: false,
  })

  it('returns null when no positions are provided', () => {
    const extent = buildPositionsExtent([])
    expect(extent).toBeNull()
  })

  it('builds a buffered extent for a single point', () => {
    const single = buildPositionsExtent([position({ id: 'position-1', device_id: 'device-1', lat: 52.4, lon: -8.9 })])

    expect(single).not.toBeNull()
    expect(single![0]).toEqual([expect.closeTo(-8.905), expect.closeTo(52.395)])
    expect(single![1]).toEqual([expect.closeTo(-8.895), expect.closeTo(52.405)])
  })

  it('builds min and max extent for multiple points', () => {
    const extent = buildPositionsExtent([
      position({ id: 'position-1', device_id: 'device-1', lat: 52.45, lon: -8.91 }),
      position({ id: 'position-2', device_id: 'device-2', lat: 52.51, lon: -8.82 }),
      position({ id: 'position-3', device_id: 'device-3', lat: 52.33, lon: -8.97 }),
    ])

    expect(extent).toEqual([
      [-8.97, 52.33],
      [-8.82, 52.51],
    ])
  })

  it('uses position-bearing snapshot to compute initial extent', () => {
    const snapshot: TrackingSnapshot = {
      devices: [],
      positions: [
        position({ id: 'position-1', device_id: 'device-1', lat: 52.55, lon: -8.78 }),
        position({ id: 'position-2', device_id: 'device-2', lat: 52.57, lon: -8.8 }),
      ],
      breadcrumbs: [],
    }

    const extent = buildTrackingInitialExtent(snapshot)
    expect(extent).toEqual([
      [-8.8, 52.55],
      [-8.78, 52.57],
    ])
  })
})
