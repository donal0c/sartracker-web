import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useStationaryAttentionStore } from '../../src/features/tracking/stationary-attention-store'
import { buildDeviceWorkspaceRows } from '../../src/features/tracking/device-workspace-model'
import type { NormalizedTrackingPosition, TrackingConnectionStatus, TrackingSnapshot } from '../../src/features/tracking/tracking-types'
import { describeTrackingHeadline } from '../../src/features/workspace/tracking-headline'

const base = {
  positions: [], ingestRejected: 0, evidenceState: 'healthy', evidenceLossAcknowledged: false, conflictCount: 0,
  stationaryCount: 0, notedCount: 0, coverageStatus: 'complete', hiddenLocationCount: 0, allLocationsHidden: false,
  mapUpdateFailed: false,
}
const online: TrackingConnectionStatus = { mode: 'online', consecutiveFailures: 0, recovered: false, lastSuccessAt: null, warning: null }

describe('the tracking line says once when not-moving warnings are off [DON-384]', () => {
  it('adds one plain line and one short word, and is not OK', () => {
    const headline = describeTrackingHeadline({
      ...base, phase: 'active', status: online,
      stationaryCheckOff: { count: 2, causes: ['storage'] },
    })
    expect(headline.condition).toBe('attention')
    expect(headline.tone).toBe('warning')
    expect(headline.issues).toContain(
      'Not-moving warnings are off for 2 people: their trail is not being recorded (possible cause: trail positions are not being saved)',
    )
    expect(headline.problems).toContain('2 not-moving off')
  })

  it('ranks the word with the person-safety words, ahead of connection and history', () => {
    const headline = describeTrackingHeadline({
      ...base, phase: 'active',
      status: { ...online, warning: 'BREADCRUMB HISTORY REFRESH FAILED — current fixes remain live; exact history will retry.', warningCodes: ['history_refresh_failed'] },
      stationaryCheckOff: { count: 1, causes: ['history'] },
    })
    expect(headline.problems.indexOf('1 not-moving off')).toBeLessThan(headline.problems.indexOf('History failed'))
  })

  it('stays quiet when nobody is affected', () => {
    const headline = describeTrackingHeadline({ ...base, phase: 'active', status: online, stationaryCheckOff: { count: 0, causes: [] } })
    expect(headline.condition).toBe('ok')
    expect(headline.issues.join(' ')).not.toMatch(/Not-moving warnings are off/)
  })
})

describe('the stationary store times people by kept trail positions [DON-384]', () => {
  beforeEach(() => useStationaryAttentionStore.setState(useStationaryAttentionStore.getInitialState()))
  const since = () => useStationaryAttentionStore.getState().checkOffSinceByDevice

  it('times a person with one kept position, and not a person with no position', () => {
    useStationaryAttentionStore.getState().applySnapshot(snapshot([fix('one', 'a', 0)], ['one', 'none']), 'mission-1')
    expect(Object.keys(since())).toEqual(['one'])
  })

  it('keeps timing when the only other position is a live one that was not kept', () => {
    // The live fix makes the stationary check evaluable, but the trail still has one kept fix.
    const kept = fix('one', 'a', 0)
    const unsaved = fix('one', 'b', 1)
    useStationaryAttentionStore.getState().applySnapshot({ ...snapshot([kept], ['one']), positions: [unsaved] }, 'mission-1')
    expect(Object.keys(since())).toEqual(['one'])
  })

  it('keeps timing while newer fixes carry an unverified time and are not kept', () => {
    const kept = fix('one', 'a', 0)
    const unverified = { ...fix('one', 'b', 1), fix_time_unverified: true, timestamp_source: 'device' as const }
    useStationaryAttentionStore.getState().applySnapshot({ ...snapshot([kept], ['one']), positions: [unverified] }, 'mission-1')
    expect(Object.keys(since())).toEqual(['one'])
  })

  it('does not time a "Last known" position the current connection has not confirmed', () => {
    useStationaryAttentionStore.getState().applySnapshot(
      { ...snapshot([fix('one', 'a', 0)], ['one']), unconfirmedCurrentDeviceIds: ['one'] }, 'mission-1')
    expect(since()).toEqual({})
  })

  it('keeps the clock through a not-moving warning, so a brief warning cannot restart the wait', () => {
    // One kept fix plus an unverified fix at the same spot 18 minutes later raises the warning itself.
    const kept = fix('one', 'a', 0)
    const later = { ...fix('one', 'b', 18), fix_time_unverified: true, timestamp_source: 'device' as const }
    useStationaryAttentionStore.getState().applySnapshot(snapshot([kept], ['one']), 'mission-1')
    const first = since().one
    useStationaryAttentionStore.getState().applySnapshot({ ...snapshot([kept], ['one']), positions: [later] }, 'mission-1')
    expect(useStationaryAttentionStore.getState().byDevice.one?.state).toBe('attention')
    expect(since().one).toBe(first)
  })

  it('reacts to a change in which positions the connection has confirmed alone', () => {
    const base = snapshot([fix('one', 'a', 0)], ['one'])
    useStationaryAttentionStore.getState().applySnapshot(base, 'mission-1')
    expect(Object.keys(since())).toEqual(['one'])
    useStationaryAttentionStore.getState().applySnapshot({ ...base, unconfirmedCurrentDeviceIds: ['one'] }, 'mission-1')
    expect(since()).toEqual({})
  })

  it('does not time a position restored from the saved cache', () => {
    const cached = { ...fix('one', 'a', 0), data_origin: 'cache' as const }
    useStationaryAttentionStore.getState().applySnapshot({ ...snapshot([], ['one']), positions: [cached] }, 'mission-1')
    expect(since()).toEqual({})
  })

  it('restarts the time on a new mission, and clears once a second position is kept', () => {
    vi.spyOn(performance, 'now').mockReturnValueOnce(1_000).mockReturnValueOnce(5_000)
    useStationaryAttentionStore.getState().applySnapshot(snapshot([fix('one', 'a', 0)], ['one']), 'mission-1')
    expect(since()).toEqual({ one: 1_000 })
    useStationaryAttentionStore.getState().applySnapshot(snapshot([fix('one', 'a', 0)], ['one']), 'mission-2')
    expect(since()).toEqual({ one: 5_000 })
    vi.restoreAllMocks()
    useStationaryAttentionStore.getState().applySnapshot(snapshot([fix('one', 'a', 0), fix('one', 'b', 1)], ['one']), 'mission-2')
    expect(since()).toEqual({})
  })

  it('waits two refreshes when tracking refreshes less often than every minute', () => {
    useStationaryAttentionStore.getState().setPollInterval(5 * 60_000)
    expect(useStationaryAttentionStore.getState().checkOffGraceMs).toBe(10 * 60_000)
    useStationaryAttentionStore.getState().setPollInterval(30_000)
    expect(useStationaryAttentionStore.getState().checkOffGraceMs).toBe(2 * 60_000)
  })
})

describe('no per-row "check unavailable" text [DON-384]', () => {
  it('drops the per-row flag from the device rows', () => {
    const rows = buildDeviceWorkspaceRows(snapshot([fix('one', 'a', 0)], ['one']), [], undefined, {
      one: { state: 'insufficient-data', acknowledged: false },
    })
    expect(rows[0]).not.toHaveProperty('stationaryAttentionUnavailable')
  })
})

function snapshot(fixes: readonly NormalizedTrackingPosition[], deviceIds: readonly string[]): TrackingSnapshot {
  const latest = new Map(fixes.map((entry) => [entry.device_id, entry]))
  return {
    devices: deviceIds.map((device_id) => ({ device_id, name: device_id, status: 'online', last_seen: null, unique_id: null, category: null })),
    positions: [...latest.values()],
    breadcrumbs: fixes,
  }
}

function fix(deviceId: string, id: string, minutes: number): NormalizedTrackingPosition {
  return { id, device_id: deviceId, lat: 52, lon: -9.7, altitude: null, speed: null, battery: null, accuracy: 4, timestamp: new Date(Date.parse('2026-11-26T10:00:00.000Z') + minutes * 60_000).toISOString(), timestamp_source: 'fix', source: 'osmand', data_origin: 'live', cache_age_seconds: null, device_cache_stale: false }
}
