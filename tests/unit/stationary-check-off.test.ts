import { describe, expect, it } from 'vitest'

import {
  STATIONARY_CHECK_OFF_GRACE_MS,
  describeStationaryCheckOff,
  summarizeStationaryCheckOff,
  trackStationaryCheckOffSince,
} from '../../src/features/tracking/stationary-check-off'
import type { NormalizedTrackingPosition } from '../../src/features/tracking/tracking-types'

const NOW = Date.parse('2026-11-26T10:00:00.000Z')

function position(deviceId: string, overrides: Partial<NormalizedTrackingPosition> = {}): NormalizedTrackingPosition {
  return {
    id: `${deviceId}-fix`, device_id: deviceId, lat: 52, lon: -9.7, altitude: null, speed: null, battery: null,
    accuracy: 5, timestamp: new Date(NOW).toISOString(), timestamp_source: 'fix', source: 'osmand',
    data_origin: 'live', cache_age_seconds: null, device_cache_stale: false, ...overrides,
  }
}

const healthy = { warningCodes: [], evidenceState: 'healthy', coverageStatus: 'ready' } as const

describe('not-moving check off for a person with a position [DON-384]', () => {
  it('starts the clock only for a person who has a current position but too few positions on record', () => {
    const since = trackStationaryCheckOffSince({}, {
      withPosition: { state: 'insufficient-data' },
      noPosition: { state: 'insufficient-data' },
      checked: { state: 'none' },
    }, [position('withPosition'), position('checked')], NOW)
    expect(since).toEqual({ withPosition: NOW })
  })

  it('keeps the first time the check went off, and forgets it once two positions are on record', () => {
    const first = trackStationaryCheckOffSince({}, { a: { state: 'insufficient-data' } }, [position('a')], NOW)
    const later = trackStationaryCheckOffSince(first, { a: { state: 'insufficient-data' } }, [position('a')], NOW + 90_000)
    expect(later).toEqual({ a: NOW })
    expect(trackStationaryCheckOffSince(later, { a: { state: 'none' } }, [position('a')], NOW + 120_000)).toEqual({})
    expect(trackStationaryCheckOffSince(later, { a: { state: 'insufficient-data' } }, [], NOW + 120_000)).toEqual({})
  })

  it('counts nobody during the first two minutes, which a phone reporting every 15-60 s always clears', () => {
    const sinceByDevice = { a: NOW }
    expect(summarizeStationaryCheckOff({ ...healthy, sinceByDevice, positions: [position('a')], nowMs: NOW + STATIONARY_CHECK_OFF_GRACE_MS - 1 }).count).toBe(0)
    expect(summarizeStationaryCheckOff({ ...healthy, sinceByDevice, positions: [position('a')], nowMs: NOW + STATIONARY_CHECK_OFF_GRACE_MS }).count).toBe(1)
  })

  it('leaves people with no position out of the count', () => {
    const summary = summarizeStationaryCheckOff({
      ...healthy, sinceByDevice: { a: NOW, gone: NOW }, positions: [position('a')], nowMs: NOW + 10 * 60_000,
    })
    expect(summary.count).toBe(1)
  })

  it('names each cause it can see: history, storage and fix time', () => {
    const late = NOW + 10 * 60_000
    const positions = [position('a'), position('b', { fix_time_unverified: true, timestamp_source: 'device' })]
    const sinceByDevice = { a: NOW, b: NOW }
    expect(summarizeStationaryCheckOff({ ...healthy, sinceByDevice, positions, nowMs: late, warningCodes: ['history_refresh_failed'] }).causes)
      .toEqual(['history', 'fixTime'])
    expect(summarizeStationaryCheckOff({ ...healthy, sinceByDevice: { a: NOW }, positions, nowMs: late, warningCodes: ['mission_storage_failed'] }).causes)
      .toEqual(['storage'])
    expect(summarizeStationaryCheckOff({ ...healthy, sinceByDevice: { a: NOW }, positions, nowMs: late, evidenceState: 'degraded' }).causes)
      .toEqual(['storage'])
    expect(summarizeStationaryCheckOff({ ...healthy, sinceByDevice: { a: NOW }, positions, nowMs: late, coverageStatus: 'error' }).causes)
      .toEqual(['history'])
    expect(summarizeStationaryCheckOff({ ...healthy, sinceByDevice: { a: NOW }, positions, nowMs: late }).causes).toEqual([])
  })

  it('says it once, in plain words, with the cause', () => {
    expect(describeStationaryCheckOff({ count: 0, causes: [] })).toBeNull()
    expect(describeStationaryCheckOff({ count: 1, causes: [] }))
      .toBe('Not-moving warnings are off for 1 person: their trail is not being recorded')
    expect(describeStationaryCheckOff({ count: 3, causes: ['history', 'storage', 'fixTime'] }))
      .toBe('Not-moving warnings are off for 3 people: their trail is not being recorded (cause: tracking history could not be fetched; trail positions are not being saved; position times are not verified)')
  })
})
