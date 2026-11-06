import { describe, expect, it } from 'vitest'

import { parseLayoutTrialChoice, withLayoutTrialChoice } from '../../src/features/layout-trial/layout-trial-store'
import { buildPeopleRows, countPeopleNeedingAttention, formatLastHeard, selectExceptionsForMap } from '../../src/features/layout-trial/people-model'
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

describe('layout trial choice', () => {
  it('is off unless the link asks for a known version, so desktop launches never change', () => {
    expect(parseLayoutTrialChoice('')).toBeNull()
    expect(parseLayoutTrialChoice('?layout=z')).toBeNull()
    expect(parseLayoutTrialChoice('?missionHarness=1&layout=b')).toBe('b')
    expect(parseLayoutTrialChoice('?layout=current')).toBe('current')
  })

  it('keeps other link parameters when switching', () => {
    expect(withLayoutTrialChoice('https://x.test/?missionHarness=1&layout=a', 'c')).toBe('https://x.test/?missionHarness=1&layout=c')
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
    const [person] = buildPeopleRows([row({})], NOW, false)
    expect(person?.statusText).toContain('Last known position')
    expect(person?.tone).toBe('attention')
  })

  it('names own problems on the map, not the outage the alarm already shouts about', () => {
    const lost = buildPeopleRows([
      row({ deviceId: '1', name: 'Aoife' }),
      row({ deviceId: '2', name: 'Zoe', stationaryAttention: true, attentionElapsedDisplay: '30 min without meaningful movement' }),
      row({ deviceId: '3', name: 'Brian', hasFix: false, latitude: null, longitude: null }),
    ], NOW, false)
    expect(selectExceptionsForMap(lost).map((person) => person.name)).toEqual(['Zoe', 'Brian'])
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
