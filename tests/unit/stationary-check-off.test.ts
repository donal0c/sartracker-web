import { describe, expect, it } from 'vitest'

import {
  STATIONARY_CHECK_OFF_GRACE_MS,
  describeStationaryCheckOff,
  nextStationaryCheckOffDue,
  stationaryCheckOffGraceMs,
  summarizeStationaryCheckOff,
  trackStationaryCheckOffSince,
} from '../../src/features/tracking/stationary-check-off'
import type { NormalizedTrackingPosition } from '../../src/features/tracking/tracking-types'

const NOW = 1_000_000
const GRACE = STATIONARY_CHECK_OFF_GRACE_MS

function position(deviceId: string, overrides: Partial<NormalizedTrackingPosition> = {}): NormalizedTrackingPosition {
  return {
    id: `${deviceId}-fix`, device_id: deviceId, lat: 52, lon: -9.7, altitude: null, speed: null, battery: null,
    accuracy: 5, timestamp: '2026-11-26T10:00:00.000Z', timestamp_source: 'fix', source: 'osmand',
    data_origin: 'live', cache_age_seconds: null, device_cache_stale: false, ...overrides,
  }
}

const open = { graceMs: GRACE, gateOpenedAtMs: 0, warningCodes: [] } as const

describe('who is timed: a live position and fewer than two kept trail positions [DON-384]', () => {
  it('times a person by kept positions, not by the stationary evaluation', () => {
    const kept = new Map([['oneKept', 1], ['noneKept', 0], ['twoKept', 2], ['noPosition', 0]])
    const since = trackStationaryCheckOffSince({}, kept,
      [position('oneKept'), position('noneKept'), position('twoKept')], NOW)
    expect(since).toEqual({ oneKept: NOW, noneKept: NOW })
  })

  it('does not time a position restored from the saved cache', () => {
    expect(trackStationaryCheckOffSince({}, new Map([['a', 1]]), [position('a', { data_origin: 'cache' })], NOW)).toEqual({})
  })

  it('keeps the first time, and forgets it once a second position is kept or the live position goes', () => {
    const first = trackStationaryCheckOffSince({}, new Map([['a', 1]]), [position('a')], NOW)
    const later = trackStationaryCheckOffSince(first, new Map([['a', 1]]), [position('a')], NOW + 90_000)
    expect(later).toEqual({ a: NOW })
    expect(trackStationaryCheckOffSince(later, new Map([['a', 2]]), [position('a')], NOW + 120_000)).toEqual({})
    expect(trackStationaryCheckOffSince(later, new Map([['a', 1]]), [], NOW + 120_000)).toEqual({})
  })
})

describe('when the line counts someone [DON-384]', () => {
  it('waits two minutes, or two refreshes when tracking refreshes less often', () => {
    expect(stationaryCheckOffGraceMs(30_000)).toBe(GRACE)
    expect(stationaryCheckOffGraceMs(5 * 60_000)).toBe(10 * 60_000)
    expect(stationaryCheckOffGraceMs(Number.NaN)).toBe(GRACE)
    const sinceByDevice = { a: NOW }
    const fiveMinute = { ...open, graceMs: stationaryCheckOffGraceMs(5 * 60_000) }
    expect(summarizeStationaryCheckOff({ ...fiveMinute, sinceByDevice, positions: [position('a')], nowMs: NOW + 9 * 60_000 }).count).toBe(0)
    expect(summarizeStationaryCheckOff({ ...fiveMinute, sinceByDevice, positions: [position('a')], nowMs: NOW + 10 * 60_000 }).count).toBe(1)
  })

  it('counts nobody before the grace period ends', () => {
    const sinceByDevice = { a: NOW }
    expect(summarizeStationaryCheckOff({ ...open, sinceByDevice, positions: [position('a')], nowMs: NOW + GRACE - 1 }).count).toBe(0)
    expect(summarizeStationaryCheckOff({ ...open, sinceByDevice, positions: [position('a')], nowMs: NOW + GRACE }).count).toBe(1)
  })

  it('counts nobody while paused or disconnected, and restarts the wait when tracking runs again', () => {
    const sinceByDevice = { a: NOW }
    const late = NOW + 10 * GRACE
    expect(summarizeStationaryCheckOff({ ...open, gateOpenedAtMs: null, sinceByDevice, positions: [position('a')], nowMs: late }).count).toBe(0)
    const resumed = late - 60_000
    expect(summarizeStationaryCheckOff({ ...open, gateOpenedAtMs: resumed, sinceByDevice, positions: [position('a')], nowMs: late }).count).toBe(0)
    expect(summarizeStationaryCheckOff({ ...open, gateOpenedAtMs: resumed, sinceByDevice, positions: [position('a')], nowMs: resumed + GRACE }).count).toBe(1)
  })

  it('leaves people with no live position out of the count', () => {
    const summary = summarizeStationaryCheckOff({
      ...open, sinceByDevice: { a: NOW, gone: NOW, cached: NOW },
      positions: [position('a'), position('cached', { data_origin: 'cache' })], nowMs: NOW + 10 * 60_000,
    })
    expect(summary.count).toBe(1)
  })

  it('schedules the next due time from the later of first seen and gate opening', () => {
    expect(nextStationaryCheckOffDue({ a: NOW }, null, GRACE, NOW)).toBeNull()
    expect(nextStationaryCheckOffDue({ a: NOW, b: NOW + 5_000 }, 0, GRACE, NOW)).toBe(NOW + GRACE)
    expect(nextStationaryCheckOffDue({ a: NOW }, NOW + 30_000, GRACE, NOW)).toBe(NOW + 30_000 + GRACE)
    expect(nextStationaryCheckOffDue({ a: NOW }, 0, GRACE, NOW + GRACE)).toBeNull()
  })
})

describe('possible causes [DON-384]', () => {
  const late = NOW + 10 * 60_000
  const summary = (warningCodes: Parameters<typeof summarizeStationaryCheckOff>[0]['warningCodes'], positions = [position('a')]) =>
    summarizeStationaryCheckOff({ ...open, warningCodes, sinceByDevice: { a: NOW }, positions, nowMs: late }).causes

  it('names a failed history fetch, an incomplete history and failed trail writes', () => {
    expect(summary(['history_refresh_failed'])).toEqual(['history'])
    expect(summary(['participant_history_unavailable'])).toEqual(['history'])
    expect(summary(['history_incomplete'])).toEqual(['incomplete'])
    expect(summary(['mission_storage_failed'])).toEqual(['storage'])
    expect(summary(['mission_storage_rows_rejected'])).toEqual(['storage'])
    expect(summary(['evidence_backpressure'])).toEqual(['storage'])
  })

  it('does not blame a saved-history read or an unreadable old breadcrumb on new positions', () => {
    expect(summary(['history_storage_failed', 'persisted_breadcrumbs_dropped'])).toEqual([])
  })

  it('names unverified times only for an affected person', () => {
    expect(summary([], [position('a', { fix_time_unverified: true, timestamp_source: 'device' })])).toEqual(['fixTime'])
    expect(summary([], [position('a'), position('b', { fix_time_unverified: true, timestamp_source: 'device' })])).toEqual([])
  })
})

describe('the words [DON-384]', () => {
  it('says it once, in plain words, with the possible cause', () => {
    expect(describeStationaryCheckOff({ count: 0, causes: [] })).toBeNull()
    expect(describeStationaryCheckOff({ count: 1, causes: [] }))
      .toBe('Not-moving warnings are off for 1 person: their trail is not being recorded')
    expect(describeStationaryCheckOff({ count: 3, causes: ['history', 'storage', 'fixTime'] }))
      .toBe('Not-moving warnings are off for 3 people: their trail is not being recorded (possible cause: tracking history could not be fetched; trail positions are not being saved; position times are not verified)')
  })
})
