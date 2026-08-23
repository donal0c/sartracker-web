import { describe, expect, it, vi } from 'vitest'

import { createStationaryAttentionProjector } from '../../src/features/tracking/stationary-attention-projection'
import type { StationaryAttentionEvaluation } from '../../src/features/tracking/stationary-attention'
import type { NormalizedTrackingPosition, TrackingSnapshot } from '../../src/features/tracking/tracking-types'

describe('stationary attention projection [DON-269]', () => {
  it('reuses an unchanged device evaluation when another current fix changes', () => {
    const evaluate = vi.fn((fixes: readonly NormalizedTrackingPosition[]): StationaryAttentionEvaluation => ({
      state: fixes.length >= 2 ? 'attention' : 'insufficient-data',
    }))
    const projector = createStationaryAttentionProjector(evaluate)
    const history = [fix('device-1', 'one-a', 0), fix('device-2', 'two-a', 0)]
    const devices = [device('device-1'), device('device-2')]
    const first: TrackingSnapshot = {
      devices,
      breadcrumbs: history,
      positions: [fix('device-1', 'one-b', 20), fix('device-2', 'two-b', 20)],
    }
    const firstProjection = projector.project(first, config())
    const deviceTwoEvaluation = firstProjection.get('device-2')

    const secondProjection = projector.project({
      ...first,
      positions: [fix('device-1', 'one-c', 21), first.positions[1]!],
    }, config())

    expect(evaluate).toHaveBeenCalledTimes(3)
    expect(secondProjection.get('device-2')).toBe(deviceTwoEvaluation)
  })
})

function device(deviceId: string) {
  return {
    device_id: deviceId,
    name: deviceId,
    status: 'online' as const,
    last_seen: null,
    unique_id: null,
    category: null,
  }
}

function fix(
  deviceId: string,
  id: string,
  minutes: number,
): NormalizedTrackingPosition {
  return {
    id,
    device_id: deviceId,
    lat: 52,
    lon: -9.7,
    altitude: null,
    speed: null,
    battery: null,
    accuracy: 4,
    timestamp: new Date(
      Date.parse('2026-08-22T10:00:00.000Z') + minutes * 60_000,
    ).toISOString(),
    source: 'osmand',
    data_origin: 'live',
    cache_age_seconds: null,
    device_cache_stale: false,
  }
}

function config() {
  return {
    heartbeatWindowMs: 20 * 60_000,
    heartbeatToleranceMs: 2 * 60_000,
    movementFloorM: 15,
    accuracyFactor: 2,
    outlierRejectM: 500,
  }
}
