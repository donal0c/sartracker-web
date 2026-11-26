import { describe, expect, it } from 'vitest'

import { DESKTOP_PANEL_ARRANGEMENT, panelOpenByDefault, panelSide } from '../../src/features/workspace/panel-arrangement'
import { buildPeopleRows, countPeopleNeedingAttention, formatLastHeard, selectExceptionsForMap } from '../../src/features/workspace/people-model'
import { describeTrackingHeadline, rememberLastConfirmedAt } from '../../src/features/workspace/tracking-headline'
import { labelTrackingWarning } from '../../src/features/workspace/tracking-problem-labels'
import { fitKeepingRemedy, fitProblemWords, problemWordsText } from '../../src/features/workspace/problem-word-fit'
import type { NormalizedTrackingPosition, TrackingConnectionStatus } from '../../src/features/tracking/tracking-types'
import { buildDeviceWorkspaceRows, type DeviceWorkspaceRow } from '../../src/features/tracking/device-workspace-model'
import type { TrackingSnapshot } from '../../src/features/tracking/tracking-types'

const NOW = Date.parse('2026-11-06T12:00:00.000Z')

function row(overrides: Partial<DeviceWorkspaceRow>): DeviceWorkspaceRow {
  return {
    deviceId: '1', name: 'Aoife', status: 'online', hidden: false, hasFix: true, latitude: 52, longitude: -9.7,
    dataOrigin: 'live', lastSeen: '2026-11-06T11:58:00.000Z', lastSeenDisplay: '', fixTimeDisplay: '', fixTime: '2026-11-06T11:58:00.000Z', sourceDisplay: 'Live',
    fixTimeUnverified: false, ingestWarning: null, stale: false, accuracyDisplay: '', batteryDisplay: '', speedDisplay: '',
    stationaryAttention: false, stationaryAttentionUnavailable: false, stationaryAttentionUnreliable: false,
    attentionAcknowledged: false, attentionElapsedDisplay: '', reportedStatus: 'online', currentUnconfirmed: false, ...overrides,
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
    mapUpdateFailed: false,
  }
  const status = (overrides: Partial<TrackingConnectionStatus>): TrackingConnectionStatus => ({
    mode: 'online', consecutiveFailures: 0, recovered: false, lastSuccessAt: null, warning: null, ...overrides,
  })

  it('raises the alarm when the map could not draw the latest positions, and keeps it in Tracking [DON-357]', () => {
    const headline = describeTrackingHeadline({ ...base, phase: 'active', mapUpdateFailed: true, status: status({}) })
    expect(headline.condition).toBe('map')
    expect(headline.tone).toBe('alert')
    expect(headline.problems[0]).toBe('MAP NOT UPDATING')
    expect(headline.alarm).toMatch(/^MAP NOT UPDATING: .*out of date/)
    expect(headline.issues).toContain('Map is not showing the latest positions')
    expect(headline.text).not.toBe('Tracking OK')
    // Healthy again once a later update is drawn.
    expect(describeTrackingHeadline({ ...base, phase: 'active', status: status({}) }).condition).toBe('ok')
  })

  it('still names the map failure when a lost connection leads the alarm [DON-357]', () => {
    const headline = describeTrackingHeadline({ ...base, phase: 'active', mapUpdateFailed: true, status: status({ mode: 'offline', warning: 'Traccar offline', warningCodes: ['offline_last_known'] }) })
    expect(headline.condition).toBe('lost')
    expect(headline.problems).toContain('Map not updating')
    expect(headline.issues).toContain('Map is not showing the latest positions')
  })

  it('never shows the top-bar tracking cell as OK while a warning is published online [M-22]', () => {
    for (const warning of [
      'MISSION BREADCRUMB STORAGE FAILED — new trail history will not survive a restart.',
      'TRACKING FALLBACK CACHE UPDATE FAILED — positions are live but will not be kept offline.',
    ]) {
      const headline = describeTrackingHeadline({ ...base, phase: 'active', status: status({ warning }) })
      expect(headline.tone).not.toBe('ok')
      expect(headline.text).not.toBe('Tracking OK')
    }
  })

  it('names each problem in short words before the reassuring sentence [DON-261]', () => {
    const headline = describeTrackingHeadline({
      ...base, phase: 'active', ingestRejected: 1,
      status: status({
        warning: 'Current fixes loaded; refreshing device roster. BREADCRUMB HISTORY REFRESH FAILED — current fixes remain live; exact history will retry.',
        warningCodes: ['roster_refreshing', 'history_refresh_failed'],
      }),
    })
    expect(headline.problems).toEqual(['1 rejected', 'History failed'])
    expect(headline.detail).toContain('Current fixes loaded')
    expect(headline.text).toContain('BREADCRUMB HISTORY REFRESH FAILED')
  })

  it('puts a person who is stale or not moving before cache and history problems [DON-261]', () => {
    const stale = { device_cache_stale: true } as unknown as NormalizedTrackingPosition
    const headline = describeTrackingHeadline({
      ...base, phase: 'active', positions: [stale], stationaryCount: 1, ingestRejected: 1,
      status: status({
        warning: 'Tracking cache could not be updated. BREADCRUMB HISTORY REFRESH FAILED — current fixes remain live; exact history will retry.',
        warningCodes: ['cache_update_failed', 'history_refresh_failed'],
      }),
    })
    expect(headline.problems).toEqual(['1 stale', '1 not moving', '1 rejected', 'History failed', 'Cache not updated'])
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

  describe('a mission whose tracking is not connected [DON-375]', () => {
    const kept = { device_cache_stale: false } as unknown as NormalizedTrackingPosition
    const notConfigured = status({
      mode: 'idle', warning: 'Tracking auto-connect is off. Use Save, Connect & Close to start live tracking.', warningCodes: ['tracking_not_configured'],
    })

    it('raises the alarm while old positions are drawn, and says where to connect', () => {
      const headline = describeTrackingHeadline({ ...base, phase: 'active', positions: [kept], status: notConfigured })
      expect(headline.condition).toBe('notConnected')
      expect(headline.tone).toBe('alert')
      expect(headline.problems[0]).toBe('TRACKING NOT CONNECTED')
      expect(headline.alarm).toMatch(/^TRACKING NOT CONNECTED: positions on the map are not updating/)
      expect(headline.alarm).toMatch(/Settings → Tracking sources/)
      expect(headline.remedy).toBe('Connect in Settings')
      expect(headline.problems).toContain('Connect in Settings')
      expect(headline.lastReceivedShown).toBe(true)
      expect(headline.leadInAlarm).toBe(true)
      expect(headline.text).not.toBe('Tracking not connected')
    })

    it('still raises the alarm for a running mission before any position arrives', () => {
      const headline = describeTrackingHeadline({ ...base, phase: 'active', status: notConfigured })
      expect(headline.condition).toBe('notConnected')
      expect(headline.tone).toBe('alert')
      expect(headline.alarm).toMatch(/^TRACKING NOT CONNECTED: no positions are coming in/)
      expect(headline.lastReceivedShown).toBe(false)
    })

    it('does not send a configured source waiting for its first poll to Settings', () => {
      // The bridge leaves an idle status until the first poll answers; that is
      // not "not configured", and must not flash red with a Settings fix.
      for (const waiting of [status({ mode: 'idle' }), status({ mode: 'idle', warning: 'Waiting for an active mission.', warningCodes: ['mission_waiting'] })]) {
        const headline = describeTrackingHeadline({ ...base, phase: 'active', positions: [kept], status: waiting })
        expect(headline.condition).toBe('disconnected')
        expect(headline.remedy).toBeUndefined()
      }
    })

    it('names a person who needs a radio check before the connect fix', () => {
      const stale = { device_cache_stale: true } as unknown as NormalizedTrackingPosition
      const headline = describeTrackingHeadline({ ...base, phase: 'active', positions: [stale], stationaryCount: 1, status: notConfigured })
      expect(headline.problems.slice(0, 4)).toEqual(['TRACKING NOT CONNECTED', '1 stale', '1 not moving', 'Connect in Settings'])
    })

    it('keeps the pause as the lead while paused, and adds where to connect', () => {
      const headline = describeTrackingHeadline({ ...base, phase: 'paused', positions: [kept], status: notConfigured })
      expect(headline.condition).toBe('paused')
      expect(headline.tone).toBe('alert')
      expect(headline.alarm).toMatch(/^MISSION PAUSED: positions are not updating/)
      expect(headline.alarm).toMatch(/Settings → Tracking sources/)
      expect(headline.remedy).toBe('Connect in Settings')
      // A plain pause, where tracking was connected, keeps its own words.
      const plain = describeTrackingHeadline({ ...base, phase: 'paused', positions: [kept], status: status({ mode: 'idle', warning: 'Live refresh suspended while mission is paused.' }) })
      expect(plain.alarm).toBe('MISSION PAUSED: positions are not updating')
      expect(plain.remedy).toBeUndefined()
    })

    it('reads a reconnect in progress as amber, never as grey, without clearing a map or record alarm', () => {
      const reconnecting = status({ mode: 'idle', warning: 'Reconnecting tracking — retained positions are last known until a fresh response arrives.', warningCodes: ['tracking_reconnecting'] })
      const headline = describeTrackingHeadline({ ...base, phase: 'active', positions: [kept], status: reconnecting })
      expect(headline.condition).toBe('reconnecting')
      expect(headline.tone).toBe('warning')
      expect(headline.problems[0]).toBe('Reconnecting')
      expect(headline.lastReceivedShown).toBe(true)
      const map = describeTrackingHeadline({ ...base, phase: 'active', positions: [kept], mapUpdateFailed: true, status: reconnecting })
      expect(map.condition).toBe('map')
      expect(map.tone).toBe('alert')
      const record = describeTrackingHeadline({ ...base, phase: 'active', positions: [kept], evidenceState: 'failed', status: reconnecting })
      expect(record.condition).toBe('record')
      expect(record.tone).toBe('alert')
      // Neither may call positions live while the feed is reconnecting.
      expect(record.alarm).not.toMatch(/positions are live/)
      expect(record.feedNotLive).toBe(true)
      expect(map.feedNotLive).toBe(true)
      expect(record.lastReceivedShown).toBe(true)
      const liveRecord = describeTrackingHeadline({ ...base, phase: 'active', positions: [kept], evidenceState: 'failed', status: status({}) })
      expect(liveRecord.alarm).toMatch(/positions are live/)
      expect(liveRecord.feedNotLive).toBeUndefined()
    })

    it('stays quiet with no mission running', () => {
      const headline = describeTrackingHeadline({ ...base, phase: 'idle', positions: [kept], status: notConfigured })
      expect(headline.condition).toBe('disconnected')
      expect(headline.tone).toBe('neutral')
      expect(headline.alarm).toBeUndefined()
    })
  })

  it('names a saved tracking password that must be re-entered, not a neutral "not connected" [DON-353]', () => {
    // The old layout's warning said what to do; the new bar must say it too.
    const warning = 'Stored Traccar credentials could not be decrypted. Re-enter the password or token in Settings.'
    // Before a mission starts, amber is enough: nobody is relying on the map yet.
    const idle = describeTrackingHeadline({
      ...base, phase: 'idle', status: status({ mode: 'idle', warning, warningCodes: ['tracking_credentials_unreadable'] }),
    })
    expect(idle.condition).toBe('credentials')
    expect(idle.tone).toBe('warning')
    expect(idle.alarm).toBeUndefined()
    expect(idle.problems[0]).toBe('Re-enter password')
    expect(idle.leadInAlarm).toBeUndefined()
    // The fix is named by identity, so its place in the ranking does not matter.
    expect(idle.remedy).toBe('Re-enter password')
    expect(idle.text).toMatch(/not connected/i)
    expect(idle.text).toMatch(/Settings/)
    expect(idle.issues).toContain(warning)
    expect(idle.lastReceivedShown).toBe(false)
    // Tracking that is simply not set up still reads as not connected.
    const plain = describeTrackingHeadline({
      ...base, phase: 'idle', status: status({ mode: 'idle', warning: 'Tracking is not configured.', warningCodes: ['tracking_not_configured'] }),
    })
    expect(plain.condition).toBe('disconnected')
    expect(plain.problems).toEqual(['Tracking not connected'])
  })

  it('raises the alarm when a mission loses its tracking password, keeping the credential advice [DON-353]', () => {
    // Tracking has stopped completely mid-mission: that is TRACKING LOST, not an
    // amber notice, but the fix is still to re-enter the password in Settings.
    const warning = 'Stored Traccar credentials are damaged. Tracking is disabled; re-enter the password or token in Settings.'
    const kept = { device_cache_stale: false } as unknown as NormalizedTrackingPosition
    for (const [phase, lead] of [['active', 'TRACKING LOST'], ['paused', 'MISSION PAUSED']] as const) {
      const headline = describeTrackingHeadline({
        ...base, phase, positions: [kept],
        status: status({ mode: 'idle', warning, warningCodes: ['tracking_credentials_unreadable'] }),
      })
      expect(headline.condition, phase).toBe('credentials')
      expect(headline.tone, phase).toBe('alert')
      expect(headline.alarm, phase).toMatch(new RegExp(`^${lead}`))
      expect(headline.alarm, phase).toMatch(/password or token/)
      expect(headline.problems.slice(0, 2), phase).toEqual([lead, 'Re-enter password'])
      // The alarm strip always says the lead, so the bar may drop it for the fix.
      expect(headline.leadInAlarm, phase).toBe(true)
      expect(headline.remedy, phase).toBe('Re-enter password')
      expect(headline.text, phase).toMatch(/Settings/)
      // The runtime keeps the positions already on the map; they are last received.
      expect(headline.lastReceivedShown, phase).toBe(true)
    }
    // A failed record does not hide that tracking itself has stopped.
    const recordToo = describeTrackingHeadline({
      ...base, phase: 'active', evidenceState: 'degraded',
      status: status({ mode: 'idle', warning, warningCodes: ['tracking_credentials_unreadable'] }),
    })
    expect(recordToo.condition).toBe('credentials')
    expect(recordToo.lastReceivedShown).toBe(false)
    // ...and the failed record is still named, in the words and in the issues.
    expect(recordToo.problems).toContain('Record not saved')
    expect(recordToo.issues).toContain('Mission record not fully saved')
    expect(recordToo.text).toContain('Mission record not fully saved')
  })


  it('names damaged saved settings and where to re-enter them, idle and mid-mission [M-47]', () => {
    const warning = 'Saved settings could not be read, so SAR Tracker set them aside and started with default settings. Tracking is off until you re-enter the Traccar settings (and any rosters or maps you rely on) in Settings and press Save.'
    const idle = describeTrackingHeadline({
      ...base, phase: 'idle', status: status({ mode: 'idle', warning, warningCodes: ['tracking_settings_unreadable'] }),
    })
    expect(idle.condition).toBe('settings')
    expect(idle.tone).toBe('warning')
    expect(idle.problems[0]).toBe('Re-enter settings')
    expect(idle.remedy).toBe('Re-enter settings')
    expect(idle.text).toMatch(/not connected/i)
    expect(idle.text).toMatch(/Traccar settings/)
    expect(idle.issues).toContain(warning)
    for (const [phase, lead] of [['active', 'TRACKING LOST'], ['paused', 'MISSION PAUSED']] as const) {
      const headline = describeTrackingHeadline({
        ...base, phase, status: status({ mode: 'idle', warning, warningCodes: ['tracking_settings_unreadable'] }),
      })
      expect(headline.condition, phase).toBe('settings')
      expect(headline.tone, phase).toBe('alert')
      expect(headline.alarm, phase).toMatch(new RegExp(`^${lead}`))
      expect(headline.alarm, phase).toMatch(/saved settings/)
      expect(headline.problems.slice(0, 2), phase).toEqual([lead, 'Re-enter settings'])
      expect(headline.leadInAlarm, phase).toBe(true)
    }
  })

  it('only the credential alarm lets its lead yield; lost and paused keep theirs [DON-353]', () => {
    const lost = describeTrackingHeadline({ ...base, phase: 'active', status: status({ mode: 'offline', warning: 'Traccar offline', warningCodes: ['offline_last_known'] }) })
    expect(lost.condition).toBe('lost')
    expect(lost.leadInAlarm).toBeUndefined()
    expect(lost.remedy).toBeUndefined()
    const paused = describeTrackingHeadline({ ...base, phase: 'paused', status: status({ mode: 'idle' }) })
    expect(paused.condition).toBe('paused')
    expect(paused.leadInAlarm).toBeUndefined()
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

  it('counts on the badge only people with a problem of their own while the mission is paused [DON-356]', () => {
    // Paused: everyone reads "Last known", but only Ciara, already out of date
    // before the pause, has a problem of her own. The alarm already says the
    // mission is paused.
    const stoppedRows = [
      row({ deviceId: '1', name: 'Aoife' }),
      row({ deviceId: '2', name: 'Brian' }),
      row({ deviceId: '4', name: 'Ciara', fixTime: '2026-11-06T11:30:00.000Z' }),
    ]
    const paused = buildPeopleRows(stoppedRows, NOW, { live: false, lastConfirmedAt: '2026-11-06T11:55:00.000Z', paused: true })
    expect(countPeopleNeedingAttention(paused)).toBe(1)
    // Everyone is still marked in the list; only the count changes.
    expect(paused.every((person) => person.tone === 'attention')).toBe(true)
    // With nobody singled out, the badge has nothing to count.
    const allFresh = buildPeopleRows([row({ deviceId: '1', name: 'Aoife' })], NOW, { live: false, lastConfirmedAt: '2026-11-06T11:59:00.000Z', paused: true })
    expect(countPeopleNeedingAttention(allFresh)).toBe(0)
    // A tracking outage is not a pause: everyone still counts.
    const outage = buildPeopleRows(stoppedRows, NOW, { live: false, lastConfirmedAt: '2026-11-06T11:55:00.000Z' })
    expect(countPeopleNeedingAttention(outage)).toBe(3)
  })

  it('keeps a person\'s own problem on the badge when the mission is paused [DON-356]', () => {
    // Recent fixes for all three, so nobody is "already out of date": Aoife's
    // current fix was never confirmed in the store and Brian was reported
    // offline. Both count while active and must still count while paused.
    const fix = (deviceId: string) => ({ id: `pos-${deviceId}`, device_id: deviceId, lat: 52, lon: -9.7, altitude: null, speed: 0, battery: 80, accuracy: 8, timestamp: '2026-11-06T11:58:00.000Z', source: 'osmand', data_origin: 'live' as const, cache_age_seconds: null, device_cache_stale: false })
    const snapshot = {
      devices: [
        { device_id: 'aoife', name: 'Aoife', status: 'online' as const, last_seen: '2026-11-06T11:58:00.000Z', unique_id: null, category: 'person' },
        { device_id: 'brian', name: 'Brian', status: 'offline' as const, last_seen: '2026-11-06T11:58:00.000Z', unique_id: null, category: 'person' },
        { device_id: 'ciara', name: 'Ciara', status: 'online' as const, last_seen: '2026-11-06T11:58:00.000Z', unique_id: null, category: 'person' },
      ],
      positions: [fix('aoife'), fix('brian'), fix('ciara')],
      breadcrumbs: [],
      unconfirmedCurrentDeviceIds: ['aoife'],
    } as unknown as TrackingSnapshot
    const confirmedAt = '2026-11-06T11:59:00.000Z'
    const active = buildPeopleRows(buildDeviceWorkspaceRows(snapshot, [], undefined, {}, 'online'), NOW, { live: true, lastConfirmedAt: confirmedAt })
    expect(countPeopleNeedingAttention(active)).toBe(2)
    // Paused: polling publishes "idle", so every row reads Last known.
    const paused = buildPeopleRows(buildDeviceWorkspaceRows(snapshot, [], undefined, {}, 'idle'), NOW, { live: false, lastConfirmedAt: confirmedAt, paused: true })
    expect(countPeopleNeedingAttention(paused)).toBe(2)
    expect(paused.find((person) => person.name === 'Aoife')?.statusText).toContain('position not confirmed before the pause')
    expect(paused.find((person) => person.name === 'Brian')?.statusText).toContain('reported offline before the pause')
    expect(paused.find((person) => person.name === 'Ciara')?.onlyPaused).toBe(true)
  })

  it('still counts a person whose current position is unconfirmed while tracking is live', () => {
    const [person] = buildPeopleRows([row({ sourceDisplay: 'Last known' })], NOW)
    expect(person?.tone).toBe('attention')
    expect(countPeopleNeedingAttention(person === undefined ? [] : [person])).toBe(1)
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
    // Every word fits, so no room is kept for a count that is not needed.
    expect(fitProblemWords([100, 40], 10, 60, 155)).toBe(2)
    expect(problemWordsText(['History failed', '2 stale', '1 rejected'], 3)).toBe('History failed · 2 stale · 1 rejected')
    expect(problemWordsText(['History failed', '2 stale', '1 rejected'], 2)).toBe('History failed · 2 stale · +1 more')
    expect(problemWordsText(['History failed', '2 stale', '1 rejected'], 0)).toBe('3 problems')
    // A lone word that does not fit is counted, never drawn past the bar (DON-353).
    expect(problemWordsText(['Re-enter password'], 0)).toBe('1 problem')
    expect(problemWordsText(['Re-enter password'], 0, true)).toBe('1 problem')
    expect(problemWordsText(['Re-enter password'], 1)).toBe('Re-enter password')
    // Before a mission: "Re-enter password" (154 px) in 100 px, and zero or negative room.
    for (const available of [100, 0, -20]) {
      const fit = fitKeepingRemedy([154], { remedy: 0, dropLead: false }, 16, 72, available, 28)
      expect(problemWordsText(['Re-enter password'], fit.shown, fit.compact === true)).toBe('1 problem')
    }
  })

  it('drops the alarm lead before anything else, and person-safety words win over the fix [DON-353]', () => {
    // Linux fonts: TRACKING LOST 137, 1 stale 70, 1 not moving 100, Re-enter password 154, separator 16, "+N more" 72.
    // "+N more" 72; the short "+N" 28.
    const fit = (widths: number[], remedy: number, dropLead: boolean, available: number) =>
      fitKeepingRemedy(widths, { remedy, dropLead }, 16, 72, available, 28)
    const words = ['TRACKING LOST', '1 stale', '1 not moving', 'Re-enter password']
    const text = (shown: { skipLead: boolean; shown: number; compact?: true }, from = words) =>
      problemWordsText(shown.skipLead ? from.slice(1) : from, shown.shown, shown.compact === true)
    // Everything fits: nothing changes.
    expect(fit([137, 154], 1, true, 420)).toEqual({ skipLead: false, shown: 2 })
    // The lead and the fix do not both fit: the lead, which the alarm strip shows, gives way.
    expect(fit([137, 154], 1, true, 280)).toEqual({ skipLead: true, shown: 1 })
    // The fix is found by identity: shown when it fits after the safety words ranked before it.
    expect(fit([137, 70, 154], 2, true, 330)).toEqual({ skipLead: true, shown: 2 })
    expect(fit([137, 70, 100, 154], 3, true, 360)).toEqual({ skipLead: true, shown: 3 })
    // Not enough room for all: the safety words win and the fix is counted (Tracking and the label name it).
    expect(text(fit([137, 70, 100, 154], 3, true, 330))).toBe('1 stale · 1 not moving · +1 more')
    // The 1024 px wide-font bar with people flagged has 221 px.
    expect(text(fit([137, 70, 100, 154], 3, true, 221))).toBe('1 stale · +2 more')
    // Settings open narrows the bar to 188 px: the safety word keeps its place beside a short count.
    const notMoving = ['TRACKING LOST', '1 not moving', 'Re-enter password']
    expect(fit([137, 111, 160], 2, true, 188)).toEqual({ skipLead: true, shown: 1, compact: true })
    expect(text(fit([137, 111, 160], 2, true, 188), notMoving)).toBe('1 not moving · +1')
    expect(text(fit([137, 111, 160], 2, true, 261), notMoving)).toBe('1 not moving · +1 more')
    // Too narrow for any whole word and a count: a count, never a clipped word.
    expect(text(fit([137, 70, 100, 154], 3, true, 100))).toBe('4 problems')
    expect(text(fit([137, 111, 160], 2, true, 120), notMoving)).toBe('3 problems')
    // Words after the fix are counted; the lead stays while it and the fix fit.
    expect(fit([137, 154, 100], 1, true, 250)).toEqual({ skipLead: true, shown: 1 })
    expect(fit([137, 154, 100], 1, true, 400)).toEqual({ skipLead: false, shown: 2 })
    // Before a mission there is no alarm lead to drop; ranking order holds.
    expect(fit([100, 154], 1, false, 200)).toEqual({ skipLead: false, shown: 1 })
    // A lone lead is never dropped: it is the whole message.
    expect(fit([137], 0, true, 100)).toEqual({ skipLead: false, shown: 0 })
  })

})
