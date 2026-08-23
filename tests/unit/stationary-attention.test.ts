import { describe, expect, it } from 'vitest'

import {
  DEFAULT_STATIONARY_ATTENTION_CONFIG,
  evaluateStationaryAttention,
  sanitizeStationaryAttentionConfig,
} from '../../src/features/tracking/stationary-attention'
import type { NormalizedTrackingPosition } from '../../src/features/tracking/tracking-types'

describe('stationary attention policy [DON-269]', () => {
  it('fires on the second accepted fix after twenty minutes without meaningful movement', () => {
    expect(evaluateStationaryAttention([
      fix('a', 0, 52, -9.7, 4),
      fix('b', 20, 52.00001, -9.7, 5),
    ], DEFAULT_STATIONARY_ATTENTION_CONFIG)).toMatchObject({
      state: 'attention', sinceTimestamp: '2026-08-22T10:00:00.000Z',
      elapsedMs: 20 * 60_000, movementThresholdM: 15,
    })
  })

  it('uses the named ten-percent heartbeat tolerance without accepting an earlier pair', () => {
    expect(evaluateStationaryAttention([
      fix('a', 0, 52, -9.7, 4),
      fix('boundary', 18, 52.00001, -9.7, 4),
    ], DEFAULT_STATIONARY_ATTENTION_CONFIG)).toMatchObject({
      state: 'attention',
      elapsedMs: 18 * 60_000,
    })

    expect(evaluateStationaryAttention([
      fix('a', 0, 52, -9.7, 4),
      {
        ...fix('too-early', 18, 52.00001, -9.7, 4),
        timestamp: '2026-08-22T10:17:59.999Z',
      },
    ], DEFAULT_STATIONARY_ATTENTION_CONFIG).state).toBe('none')
  })

  it('accounts for reported accuracy jitter', () => {
    const result = evaluateStationaryAttention([
      fix('a', 0, 52, -9.7, 10), fix('b', 20, 52.00015, -9.7, 12),
    ], DEFAULT_STATIONARY_ATTENTION_CONFIG)
    expect(result.state).toBe('attention')
    expect(result.movementThresholdM).toBe(24)
  })

  it('does not flag slow meaningful walking beyond the threshold', () => {
    expect(evaluateStationaryAttention([
      fix('a', 0, 52, -9.7, 4), fix('b', 20, 52.0003, -9.7, 4),
    ], DEFAULT_STATIONARY_ATTENTION_CONFIG).state).toBe('none')
  })

  it('ignores one gross mid-stream outlier when the accepted endpoints remain stationary', () => {
    expect(evaluateStationaryAttention([
      fix('a', 0, 52, -9.7, 4),
      fix('outlier', 10, 52.02, -9.7, 4),
      fix('b', 20, 52.00001, -9.7, 4),
    ], DEFAULT_STATIONARY_ATTENTION_CONFIG).state).toBe('attention')
  })

  it('treats the movement floor as assumed accuracy when accuracy is unknown', () => {
    const unknownAccuracy = evaluateStationaryAttention([
      fix('a', 0, 52, -9.7, null), fix('b', 20, 52.00018, -9.7, null),
    ], DEFAULT_STATIONARY_ATTENTION_CONFIG)
    expect(unknownAccuracy).toMatchObject({
      state: 'attention',
      movementThresholdM: 30,
    })

    expect(evaluateStationaryAttention([
      fix('a', 0, 52, -9.7, null), fix('b', 20, 52.001, -9.7, null),
    ], DEFAULT_STATIONARY_ATTENTION_CONFIG).state).toBe('none')
  })

  it('preserves attention for one terminal outlier and clears after corroborated movement', () => {
    const stationaryWithOutlier = [
      fix('a', 0, 52, -9.7, 4),
      fix('b', 20, 52.00001, -9.7, 4),
      fix('c', 40, 52.00001, -9.7, 4),
      fix('outlier', 41, 52.02, -9.7, 4),
    ]
    expect(evaluateStationaryAttention(
      stationaryWithOutlier,
      DEFAULT_STATIONARY_ATTENTION_CONFIG,
    )).toMatchObject({ state: 'attention', latestFixUnreliable: true })

    expect(evaluateStationaryAttention([
      fix('a', 0, 52, -9.7, 4),
      fix('b', 20, 52.00001, -9.7, 4),
      fix('c', 40, 52.00001, -9.7, 4),
      fix('uncorroborated-move', 41, 52.001, -9.7, 4),
    ], DEFAULT_STATIONARY_ATTENTION_CONFIG)).toMatchObject({
      state: 'attention',
      latestFixUnreliable: true,
    })

    expect(evaluateStationaryAttention([
      ...stationaryWithOutlier,
      fix('movement-confirmed', 42, 52.02001, -9.7, 4),
    ], DEFAULT_STATIONARY_ATTENTION_CONFIG).state).toBe('none')
  })

  it('reports sparse or invalid time data explicitly as insufficient', () => {
    expect(evaluateStationaryAttention([fix('a', 0, 52, -9.7, 4)], DEFAULT_STATIONARY_ATTENTION_CONFIG).state).toBe('insufficient-data')
    expect(evaluateStationaryAttention([{ ...fix('a', 0, 52, -9.7, 4), timestamp: 'bad' }], DEFAULT_STATIONARY_ATTENTION_CONFIG).state).toBe('insufficient-data')
  })

  it('sanitizes corrupt settings deterministically to named defaults', () => {
    expect(sanitizeStationaryAttentionConfig({ heartbeatWindowMs: -1, heartbeatToleranceMs: 99_999_999, movementFloorM: Number.NaN, accuracyFactor: 99, outlierRejectM: 'bad' })).toEqual(DEFAULT_STATIONARY_ATTENTION_CONFIG)
  })
})

function fix(id: string, minutes: number, lat: number, lon: number, accuracy: number | null): NormalizedTrackingPosition {
  return {
    id, device_id: 'device-1', lat, lon, accuracy,
    timestamp: new Date(Date.parse('2026-08-22T10:00:00.000Z') + minutes * 60_000).toISOString(),
    altitude: null, speed: null, battery: null, source: 'osmand', data_origin: 'live',
    cache_age_seconds: null, device_cache_stale: false,
  }
}
