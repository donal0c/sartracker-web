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

  it('uses the configured floor when accuracy is missing and clears on movement', () => {
    expect(evaluateStationaryAttention([
      fix('a', 0, 52, -9.7, null), fix('b', 20, 52.00001, -9.7, null),
    ], DEFAULT_STATIONARY_ATTENTION_CONFIG).state).toBe('attention')
    expect(evaluateStationaryAttention([
      fix('a', 0, 52, -9.7, null), fix('b', 20, 52.001, -9.7, null),
    ], DEFAULT_STATIONARY_ATTENTION_CONFIG).state).toBe('none')
  })

  it('reports sparse or invalid time data explicitly as insufficient', () => {
    expect(evaluateStationaryAttention([fix('a', 0, 52, -9.7, 4)], DEFAULT_STATIONARY_ATTENTION_CONFIG).state).toBe('insufficient-data')
    expect(evaluateStationaryAttention([{ ...fix('a', 0, 52, -9.7, 4), timestamp: 'bad' }], DEFAULT_STATIONARY_ATTENTION_CONFIG).state).toBe('insufficient-data')
  })

  it('sanitizes corrupt settings deterministically to named defaults', () => {
    expect(sanitizeStationaryAttentionConfig({ heartbeatWindowMs: -1, movementFloorM: Number.NaN, accuracyFactor: 99, outlierRejectM: 'bad' })).toEqual(DEFAULT_STATIONARY_ATTENTION_CONFIG)
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
