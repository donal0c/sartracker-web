import { describe, expect, it } from 'vitest'

import { createTrailSegments } from '../../src/features/tracking/trail-segmentation'
import type { NormalizedTrackingPosition } from '../../src/features/tracking/tracking-types'

describe('trail segmentation', () => {
  it('preserves the current half-hour live-trail behaviour', () => {
    const positions = [
      createPosition('1', '2026-08-24T10:00:00.000Z'),
      createPosition('2', '2026-08-24T10:30:00.000Z'),
      createPosition('3', '2026-08-24T11:00:00.001Z'),
    ]

    expect(createTrailSegments(positions, 30 * 60 * 1000)).toEqual([
      [positions[0], positions[1]],
      [positions[2]],
    ])
  })

  it('returns no segments for no fixes and one segment for one fix', () => {
    const position = createPosition('1', '2026-08-24T10:00:00.000Z')

    expect(createTrailSegments([], 30 * 60 * 1000)).toEqual([])
    expect(createTrailSegments([position], 30 * 60 * 1000)).toEqual([[position]])
  })
})

function createPosition(id: string, timestamp: string): NormalizedTrackingPosition {
  return {
    id,
    device_id: 'device-1',
    lat: 52,
    lon: -9.7,
    altitude: null,
    speed: null,
    battery: null,
    accuracy: null,
    timestamp,
    source: 'traccar',
    data_origin: 'live',
    cache_age_seconds: null,
    device_cache_stale: false,
  }
}
