import { describe, expect, it } from 'vitest'

import { DESKTOP_PANEL_ARRANGEMENT, panelOpenByDefault, panelSide } from '../../src/features/workspace/panel-arrangement'
import { buildPeopleRows, countPeopleNeedingAttention, formatLastHeard, selectExceptionsForMap } from '../../src/features/workspace/people-model'
import { describeTrackingHeadline, rememberLastConfirmedAt } from '../../src/features/workspace/tracking-headline'
import { labelTrackingWarning } from '../../src/features/workspace/tracking-problem-labels'
import { fitProblemWords, problemWordsText } from '../../src/features/workspace/problem-word-fit'
import type { TrackingConnectionStatus } from '../../src/features/tracking/tracking-types'
import type { DeviceWorkspaceRow } from '../../src/features/tracking/device-workspace-model'

const NOW = Date.parse('2026-11-06T12:00:00.000Z')

function row(overrides: Partial<DeviceWorkspaceRow>): DeviceWorkspaceRow {
  return {
    deviceId: '1', name: 'Aoife', status: 'online', hidden: false, hasFix: true, latitude: 52, longitude: -9.7,
    dataOrigin: 'live', lastSeen: '2026-11-06T11:58:00.000Z', lastSeenDisplay: '', fixTimeDisplay: '', fixTime: '2026-11-06T11:58:00.000Z', sourceDisplay: 'Live',
    fixTimeUnverified: false, ingestWarning: null, stale: false, accuracyDisplay: '', batteryDisplay: '', speedDisplay: '',
    stationaryAttention: false, stationaryAttentionUnavailable: false, stationaryAttentionUnreliable: false,
    attentionAcknowledged: false, attentionElapsedDisplay: '', ...overrides,
  }
}

describe('panel arrangement', () => {
  it('opens the desktop app on the panel-on-the-right arrangement until the team lead confirms otherwise', () => {
    expect(DESKTOP_PANEL_ARRANGEMENT).toBe('right')
    expect(panelSide(DESKTOP_PANEL_ARRANGEMENT)).toBe('right')
    expect(panelOpenByDefault(DESKTOP_PANEL_ARRANGEMENT)).toBe(true)
  })

  it('keeps the other trial arrangements one constant away', () => {
    expect(panelSide('left')).toBe('left')
    expect(panelOpenByDefault('left')).toBe(true)
    expect(panelSide('map-first')).toBe('right')
    expect(panelOpenByDefault('map-first')).toBe(false)
  })
})

describe('tracking headline', () => {
  const base = {
    positions: [], ingestRejected: 0, evidenceState: 'healthy', evidenceLossAcknowledged: false, conflictCount: 0,
    stationaryCount: 0, notedCount: 0, coverageStatus: 'complete', hiddenLocationCount: 0, allLocationsHidden: false,
  }
  const status = (overrides: Partial<TrackingConnectionStatus>): TrackingConnectionStatus => ({
    mode: 'online', consecutiveFailures: 0, recovered: false, lastSuccessAt: null, warning: null, ...overrides,
  })

  it('names each problem in short words before the reassuring sentence [DON-261]', () => {
    const headline = describeTrackingHeadline({
      ...base, phase: 'active', ingestRejected: 1,
      status: status({
        warning: 'Current fixes loaded; refreshing device roster. BREADCRUMB HISTORY REFRESH FAILED — current fixes remain live; exact history will retry.',
        warningCodes: ['roster_refreshing', 'history_refresh_failed'],
      }),
    })
    expect(headline.problems).toEqual(['History failed', '1 rejected'])
    expect(headline.detail).toContain('Current fixes loaded')
    expect(headline.text).toContain('BREADCRUMB HISTORY REFRESH FAILED')
  })

  it('names a warning that arrived without a code, and leaves progress notes unnamed [DON-261]', () => {
    expect(labelTrackingWarning('Something odd happened.', undefined)).toEqual(['Tracking warning'])
    expect(labelTrackingWarning('Current fixes loaded; loading breadcrumb history.', ['history_loading'])).toEqual([])
    expect(labelTrackingWarning(null, ['history_refresh_failed'])).toEqual([])
  })

  it('leads with TRACKING LOST and does not repeat Offline after it [DON-261]', () => {
    const headline = describeTrackingHeadline({
      ...base, phase: 'active', status: status({ mode: 'offline', warning: 'OFFLINE MODE — showing last known positions.', warningCodes: ['offline_last_known'] }),
    })
    expect(headline.problems).toEqual(['TRACKING LOST'])
  })

  it('treats the runtime pause notice as a pause, never as a lost connection', () => {
    const headline = describeTrackingHeadline({ ...base, phase: 'paused', status: status({ warning: 'Live refresh suspended while mission is paused.' }) })
    expect(headline.condition).toBe('paused')
    expect(headline.text).toBe('MISSION PAUSED')
    expect(headline.issues).toEqual([])
  })

  it('still reports a real outage as lost, and a hidden location however it is', () => {
    const headline = describeTrackingHeadline({ ...base, phase: 'active', hiddenLocationCount: 2, status: status({ mode: 'offline', warning: 'Traccar server is not answering.' }) })
    expect(headline.condition).toBe('lost')
    expect(headline.text).toContain("2 people's locations hidden")
    expect(headline.text).not.toContain('Traccar server')
  })

  it('keeps the last confirmed time through the null the runtime publishes on pause, per mission', () => {
    expect(rememberLastConfirmedAt('m1', '2026-11-06T11:55:00.000Z')).toBe('2026-11-06T11:55:00.000Z')
    expect(rememberLastConfirmedAt('m1', null)).toBe('2026-11-06T11:55:00.000Z')
    expect(rememberLastConfirmedAt('m2', null)).toBeNull()
  })

  it('raises a failed mission record, and keeps a noted person listed', () => {
    expect(describeTrackingHeadline({ ...base, phase: 'active', evidenceState: 'degraded', status: status({}) }).condition).toBe('record')
    expect(describeTrackingHeadline({ ...base, phase: 'active', notedCount: 1, status: status({}) }).text).toBe('1 person not moving (noted)')
  })
})

describe('people list', () => {
  it('says how long ago in words and never invents a time', () => {
    expect(formatLastHeard('2026-11-06T11:59:50.000Z', NOW)).toBe('just now')
    expect(formatLastHeard('2026-11-06T11:40:00.000Z', NOW)).toBe('20 min ago')
    expect(formatLastHeard('2026-11-06T10:30:00.000Z', NOW)).toBe('1 hr 30 min ago')
    expect(formatLastHeard(null, NOW)).toBeNull()
    expect(formatLastHeard('not a time', NOW)).toBeNull()
  })

  it('never reports a healthy line for a person whose position cannot be trusted', () => {
    const cases: readonly [Partial<DeviceWorkspaceRow>, RegExp][] = [
      [{ hasFix: false, latitude: null, longitude: null }, /No position yet/],
      [{ stationaryAttention: true, attentionElapsedDisplay: '23 min without meaningful movement' }, /Not moving 23 min/],
      [{ sourceDisplay: 'Last known', status: 'unknown' }, /Last known position/],
      [{ fixTimeUnverified: true }, /time not verified/],
      [{ stale: true }, /Out of date/],
      [{ status: 'offline' }, /Offline/],
      [{ status: 'unknown' }, /Not confirmed/],
    ]
    for (const [overrides, expected] of cases) {
      const [person] = buildPeopleRows([row(overrides)], NOW)
      expect(person?.statusText).toMatch(expected)
      expect(person?.tone).toBe('attention')
    }
  })

  it('ages the position being shown, not the last contact with the device', () => {
    const [person] = buildPeopleRows([row({ lastSeen: '2026-11-06T11:59:30.000Z', fixTime: '2026-11-06T11:20:00.000Z' })], NOW)
    expect(person?.statusText).toBe('Position 40 min ago')
  })

  it('keeps every problem in the line rather than only the first', () => {
    const [person] = buildPeopleRows([row({ stationaryAttention: true, attentionElapsedDisplay: '25 min without meaningful movement', stale: true, fixTimeUnverified: true })], NOW)
    expect(person?.statusText).toMatch(/Not moving 25 min · Out of date.*position time not verified/)
  })

  it('never reads as current while positions are not updating', () => {
    const [person] = buildPeopleRows([row({})], NOW, { live: false, lastConfirmedAt: null })
    expect(person?.statusText).toContain('Last known position')
    expect(person?.tone).toBe('attention')
  })

  it('names own problems on the map, not the outage the alarm already shouts about', () => {
    const lost = buildPeopleRows([
      row({ deviceId: '1', name: 'Aoife' }),
      row({ deviceId: '2', name: 'Zoe', stationaryAttention: true, attentionElapsedDisplay: '30 min without meaningful movement' }),
      row({ deviceId: '3', name: 'Brian', hasFix: false, latitude: null, longitude: null }),
      row({ deviceId: '4', name: 'Ciara', fixTime: '2026-11-06T11:30:00.000Z' }),
    ], NOW, { live: false, lastConfirmedAt: '2026-11-06T11:55:00.000Z' })
    expect(selectExceptionsForMap(lost).map((person) => person.name)).toEqual(['Zoe', 'Brian', 'Ciara'])
    expect(lost.find((person) => person.name === 'Ciara')?.statusText).toContain('Already out of date when updates stopped')
  })

  it('keeps an acknowledged stationary warning visible until movement clears it', () => {
    const [person] = buildPeopleRows([row({ stationaryAttention: true, attentionAcknowledged: true, attentionElapsedDisplay: '30 min without meaningful movement' })], NOW)
    expect(person?.tone).toBe('attention')
    expect(person?.statusText).toContain('noted')
    expect(person?.canAcknowledge).toBe(false)
  })

  it('puts people needing a look first, then everyone by name', () => {
    const people = buildPeopleRows([
      row({ deviceId: '1', name: 'Aoife' }),
      row({ deviceId: '2', name: 'Zoe', status: 'offline' }),
      row({ deviceId: '3', name: 'Brian' }),
    ], NOW)
    expect(people.map((person) => person.name)).toEqual(['Zoe', 'Aoife', 'Brian'])
    expect(countPeopleNeedingAttention(people)).toBe(1)
  })
})

describe('tracking problem words', () => {
  it('shows every whole word that fits, and counts the rest instead of cutting one short [DON-261]', () => {
    // words 100, 50, 70; separator 10; "+N more" 60
    expect(fitProblemWords([100, 50, 70], 10, 60, 240)).toBe(3)
    expect(fitProblemWords([100, 50, 70], 10, 60, 239)).toBe(2)
    expect(fitProblemWords([100, 50, 70], 10, 60, 170)).toBe(1)
    expect(fitProblemWords([100, 50, 70], 10, 60, 100)).toBe(0)
    expect(problemWordsText(['History failed', '2 stale', '1 rejected'], 3)).toBe('History failed · 2 stale · 1 rejected')
    expect(problemWordsText(['History failed', '2 stale', '1 rejected'], 2)).toBe('History failed · 2 stale · +1 more')
    expect(problemWordsText(['History failed', '2 stale', '1 rejected'], 0)).toBe('3 problems')
  })
})
