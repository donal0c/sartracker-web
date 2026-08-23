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

  it('preserves unchanged per-device history when one breadcrumb trail changes', () => {
    const evaluate = vi.fn((fixes: readonly NormalizedTrackingPosition[]): StationaryAttentionEvaluation => ({
      state: fixes.length >= 2 ? 'attention' : 'insufficient-data',
    }))
    const projector = createStationaryAttentionProjector(evaluate)
    const devices = [device('device-1'), device('device-2')]
    const first: TrackingSnapshot = {
      devices,
      breadcrumbs: [fix('device-1', 'one-a', 0), fix('device-2', 'two-a', 0)],
      positions: [],
    }
    const firstProjection = projector.project(first, config())
    const deviceTwoEvaluation = firstProjection.get('device-2')

    const secondProjection = projector.project({
      ...first,
      breadcrumbs: [...first.breadcrumbs, fix('device-1', 'one-b', 20)],
    }, config())

    expect(evaluate).toHaveBeenCalledTimes(3)
    expect(secondProjection.get('device-2')).toBe(deviceTwoEvaluation)
  })

  it('re-evaluates when one retained identity carries changed stationary inputs', () => {
    const evaluate = vi.fn((): StationaryAttentionEvaluation => ({ state: 'attention' }))
    const projector = createStationaryAttentionProjector(evaluate)
    const original = fix('device-1', 'latest', 20)
    const snapshot: TrackingSnapshot = {
      devices: [device('device-1')],
      breadcrumbs: [original],
      positions: [],
    }
    projector.project(snapshot, config())

    projector.project({
      ...snapshot,
      breadcrumbs: [{ ...original, lat: original.lat + 0.001 }],
    }, config())

    expect(evaluate).toHaveBeenCalledTimes(2)
  })

  it('preserves unchanged devices when one compacted trail changes inside interleaved history', () => {
    const evaluate = vi.fn((): StationaryAttentionEvaluation => ({ state: 'attention' }))
    const projector = createStationaryAttentionProjector(evaluate)
    const devices = [device('device-1'), device('device-2')]
    const oneA = fix('device-1', 'one-a', 0)
    const oneB = fix('device-1', 'one-b', 1)
    const oneC = fix('device-1', 'one-c', 2)
    const twoA = fix('device-2', 'two-a', 0)
    const twoB = fix('device-2', 'two-b', 1)
    const twoC = fix('device-2', 'two-c', 2)
    const first: TrackingSnapshot = {
      devices,
      breadcrumbs: [oneA, twoA, oneB, twoB, oneC, twoC],
      positions: [],
    }
    const firstProjection = projector.project(first, config())
    const deviceTwoEvaluation = firstProjection.get('device-2')

    const secondProjection = projector.project({
      ...first,
      breadcrumbs: [
        oneA,
        twoA,
        twoB,
        oneC,
        twoC,
        fix('device-1', 'one-d', 3),
      ],
    }, config())

    expect(evaluate).toHaveBeenCalledTimes(3)
    expect(secondProjection.get('device-2')).toBe(deviceTwoEvaluation)
  })

  it('keeps a one-device update inside the 100-by-5,000 stationary projection gate', () => {
    const projector = createStationaryAttentionProjector(() => ({ state: 'attention' }))
    const devices = Array.from({ length: 100 }, (_, index) => device(`device-${index}`))
    const breadcrumbs = devices.flatMap((entry, deviceIndex) =>
      Array.from({ length: 5_000 }, (_, fixIndex) =>
        fix(entry.device_id, `${deviceIndex}-${fixIndex}`, fixIndex),
      ),
    )
    projector.project({ devices, breadcrumbs, positions: [] }, config())

    const startedAt = performance.now()
    projector.project({
      devices,
      breadcrumbs: [...breadcrumbs, fix('device-0', 'changed', 5_001)],
      positions: [],
    }, config())

    expect(performance.now() - startedAt).toBeLessThan(200)
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
