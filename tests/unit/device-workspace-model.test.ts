import { describe, expect, it } from 'vitest'

import {
  buildDeviceWorkspaceRows,
  buildDeviceWorkspaceSummary,
  filterDeviceWorkspaceRows,
  resolveVisibleDeviceSelection,
} from '../../src/features/tracking/device-workspace-model'
import { formatOperatorLocalTimestamp } from '../../src/features/tracking/operator-time'
import type { TrackingConnectionStatus, TrackingSnapshot } from '../../src/features/tracking/tracking-types'

const SNAPSHOT: TrackingSnapshot = {
  devices: [
    {
      device_id: 'alpha',
      name: 'Alpha Team',
      status: 'online',
      last_seen: '2026-04-10T17:00:00.000Z',
      unique_id: null,
      category: null,
    },
    {
      device_id: 'bravo',
      name: 'Bravo Team',
      status: 'offline',
      last_seen: '2026-04-10T16:30:00.000Z',
      unique_id: null,
      category: null,
    },
  ],
  positions: [
    {
      id: 'pos-1',
      device_id: 'alpha',
      lat: 52,
      lon: -9.7,
      altitude: null,
      speed: 3.5,
      battery: 82,
      accuracy: 7.5,
      timestamp: '2026-04-10T17:00:00.000Z',
      source: null,
      data_origin: 'live',
      cache_age_seconds: null,
      device_cache_stale: false,
    },
    {
      id: 'pos-2',
      device_id: 'bravo',
      lat: 52.01,
      lon: -9.71,
      altitude: null,
      speed: null,
      battery: null,
      accuracy: null,
      timestamp: '2026-04-10T16:30:00.000Z',
      source: null,
      data_origin: 'cache',
      cache_age_seconds: 600,
      device_cache_stale: true,
    },
  ],
  breadcrumbs: [],
}

const STATUS: TrackingConnectionStatus = {
  mode: 'offline',
  consecutiveFailures: 1,
  recovered: false,
  lastSuccessAt: '2026-04-10T17:01:00.000Z',
  warning: 'OFFLINE MODE — showing last known positions.',
}

describe('device workspace model', () => {
  it('never labels a fix ahead of the laptop clock as Live [DON-349 M-06]', () => {
    const rows = buildDeviceWorkspaceRows(
      {
        ...SNAPSHOT,
        positions: SNAPSHOT.positions.map((position) => position.device_id === 'alpha'
          ? { ...position, device_cache_stale: true, fix_time_ahead_of_clock: true }
          : position),
      },
      [],
      undefined,
      {},
      'online',
    )
    expect(rows[0]).toMatchObject({
      deviceId: 'alpha',
      // Marked stale so it is never live; the label says both [M-21].
      sourceDisplay: 'Stale · Fix time ahead of laptop clock',
      stale: true,
    })
  })

  it('labels retained live-origin fixes as last known while reconnecting [AUD-13]', () => {
    const rows = buildDeviceWorkspaceRows(SNAPSHOT, [], undefined, {}, 'idle')
    expect(rows[0]).toMatchObject({ status: 'unknown', sourceDisplay: 'Last known' })
  })

  it('builds readable roster rows from the tracking snapshot', () => {
    const rows = buildDeviceWorkspaceRows(SNAPSHOT, ['bravo'])

    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      deviceId: 'alpha',
      sourceDisplay: 'Live',
      hidden: false,
      batteryDisplay: '82%',
      accuracyDisplay: '7.5 m',
    })
    expect(rows[0]?.fixTimeDisplay).not.toBe('N/A')
    expect(rows[0]?.lastSeenDisplay).toMatch(
      /^10\/04\/2026, \d{2}:00:00 GMT[+-]\d{2}:\d{2} \(.+\)$/u,
    )
    expect(rows[1]).toMatchObject({
      deviceId: 'bravo',
      sourceDisplay: 'Stale',
      hidden: true,
      speedDisplay: '—',
    })
  })

  it('shows per-device rejection health and server-only timestamp provenance [DON-267]', () => {
    const rows = buildDeviceWorkspaceRows(
      {
        ...SNAPSHOT,
        positions: SNAPSHOT.positions.map((position) => position.device_id === 'alpha'
          ? {
              ...position,
              timestamp_source: 'server' as const,
              fix_time_unverified: true,
              device_cache_stale: true,
            }
          : position),
      },
      [],
      {
        totalRejected: 1,
        affectedDeviceCount: 1,
        unidentifiedRejected: 0,
        byDevice: {
          alpha: { count: 1, lastReason: 'invalid_coordinates' },
        },
      },
    )

    expect(rows[0]).toMatchObject({
      deviceId: 'alpha',
      // A stale fix stays visibly stale whatever its time provenance [M-21].
      sourceDisplay: 'Stale · Fix time unverified',
      fixTimeUnverified: true,
      ingestWarning: '1 position row rejected — invalid coordinates.',
    })
  })

  it('keeps a stale fix visibly stale when its time is unverified or tracking is offline [M-21]', () => {
    const hourOld = (overrides: Partial<TrackingSnapshot['positions'][number]>) => ({
      ...SNAPSHOT.positions[0]!, data_origin: 'live' as const, device_cache_stale: true, ...overrides,
    })
    const unverifiedOnline = buildDeviceWorkspaceRows(
      { ...SNAPSHOT, positions: [hourOld({ fix_time_unverified: true }), SNAPSHOT.positions[1]!] }, [], undefined, {}, 'online',
    ).find((row) => row.deviceId === 'alpha')!
    expect(unverifiedOnline.sourceDisplay).toMatch(/Stale/)
    expect(unverifiedOnline.sourceDisplay).toMatch(/unverified/)
    expect(unverifiedOnline.stale).toBe(true)

    const staleOffline = buildDeviceWorkspaceRows(
      { ...SNAPSHOT, positions: [hourOld({}), SNAPSHOT.positions[1]!] }, [], undefined, {}, 'offline',
    ).find((row) => row.deviceId === 'alpha')!
    const freshOffline = buildDeviceWorkspaceRows(
      { ...SNAPSHOT, positions: [hourOld({ device_cache_stale: false }), SNAPSHOT.positions[1]!] }, [], undefined, {}, 'offline',
    ).find((row) => row.deviceId === 'alpha')!
    expect(staleOffline.sourceDisplay).toBe('Stale · Last known')
    expect(freshOffline.sourceDisplay).toBe('Last known')
  })

  it('never calls the feed healthy while positions are stale or unverified [M-20]', () => {
    const online: TrackingConnectionStatus = { mode: 'online', consecutiveFailures: 0, recovered: false, lastSuccessAt: null, warning: null }
    const staleRows = buildDeviceWorkspaceRows(
      { ...SNAPSHOT, positions: SNAPSHOT.positions.map((position) => ({ ...position, device_cache_stale: true })) }, [],
    )
    const stale = buildDeviceWorkspaceSummary(staleRows, online)
    expect(stale.headline).not.toBe('Tracking feed healthy.')
    expect(stale.headline).toContain('2 positions out of date')
    expect(stale.tone).toBe('warning')

    const unverified = buildDeviceWorkspaceSummary(buildDeviceWorkspaceRows(
      { ...SNAPSHOT, positions: [{ ...SNAPSHOT.positions[0]!, fix_time_unverified: true }] }, [],
    ), online)
    expect(unverified.tone).toBe('warning')
    expect(unverified.headline).toContain('1 position time not verified')

    const fresh = buildDeviceWorkspaceSummary(buildDeviceWorkspaceRows(
      { ...SNAPSHOT, positions: [SNAPSHOT.positions[0]!] }, [],
    ), online)
    expect(fresh).toMatchObject({ headline: 'Tracking feed healthy.', tone: 'success' })

    const warned = buildDeviceWorkspaceSummary(buildDeviceWorkspaceRows(
      { ...SNAPSHOT, positions: [SNAPSHOT.positions[0]!] }, [],
    ), { ...online, warning: 'MISSION BREADCRUMB STORAGE FAILED — new trail history will not survive a restart.' })
    expect(warned).toMatchObject({ headline: 'MISSION BREADCRUMB STORAGE FAILED — new trail history will not survive a restart.', tone: 'warning' })
  })

  it('adds derived stationary attention without changing fix truth [DON-269]', () => {
    const rows = buildDeviceWorkspaceRows(SNAPSHOT, [], undefined, {
      alpha: { state: 'attention', acknowledged: false, elapsedMs: 1_200_000 },
    })
    expect(rows[0]).toMatchObject({
      deviceId: 'alpha', stationaryAttention: true,
      attentionAcknowledged: false, latitude: 52, longitude: -9.7,
    })
  })

  it('distinguishes unavailable and uncorroborated stationary evaluation', () => {
    expect(buildDeviceWorkspaceRows(SNAPSHOT, [], undefined, {
      alpha: { state: 'insufficient-data', acknowledged: false },
    })[0]).toMatchObject({
      stationaryAttention: false,
      stationaryAttentionUnavailable: true,
      stationaryAttentionUnreliable: false,
    })

    expect(buildDeviceWorkspaceRows(SNAPSHOT, [], undefined, {
      alpha: {
        state: 'attention',
        acknowledged: false,
        latestFixUnreliable: true,
      },
    })[0]).toMatchObject({
      stationaryAttention: true,
      stationaryAttentionUnavailable: false,
      stationaryAttentionUnreliable: true,
    })
  })

  it('builds workspace summary counters aligned with tracking status', () => {
    const rows = buildDeviceWorkspaceRows(SNAPSHOT, ['bravo'])
    const summary = buildDeviceWorkspaceSummary(rows, STATUS)

    expect(summary).toMatchObject({
      totalDevices: 2,
      onlineDevices: 1,
      hiddenDevices: 1,
      staleDevices: 1,
      cachedDevices: 1,
      mode: 'offline',
      warning: 'OFFLINE MODE — showing last known positions.',
    })
    expect(summary.lastSuccessAtDisplay).not.toBe('N/A')
    expect(summary.lastSuccessAtDisplay).toMatch(
      /^10\/04\/2026, \d{2}:01:00 GMT[+-]\d{2}:\d{2} \(.+\)$/u,
    )
  })

  it('scopes device search to the selected filter', () => {
    const rows = buildDeviceWorkspaceRows(SNAPSHOT, ['bravo'])

    expect(filterDeviceWorkspaceRows(rows, 'hidden', 'Alpha').map((row) => row.deviceId)).toEqual([])
    expect(filterDeviceWorkspaceRows(rows, 'hidden', 'Bravo').map((row) => row.deviceId)).toEqual([
      'bravo',
    ])
    expect(filterDeviceWorkspaceRows(rows, 'all', 'Alpha').map((row) => row.deviceId)).toEqual([
      'alpha',
    ])
  })

  it('resolves selection to the first visible device when the current device is outside the list', () => {
    const rows = buildDeviceWorkspaceRows(SNAPSHOT, ['bravo'])
    const hiddenRows = filterDeviceWorkspaceRows(rows, 'hidden', '')
    const noFixRows = filterDeviceWorkspaceRows(rows, 'nofix', '')

    expect(resolveVisibleDeviceSelection(hiddenRows, 'alpha')).toBe('bravo')
    expect(resolveVisibleDeviceSelection(hiddenRows, 'bravo')).toBe('bravo')
    expect(resolveVisibleDeviceSelection(noFixRows, 'alpha')).toBeNull()
  })
})

describe('buildDeviceWorkspaceRows newest known fix [DON-328]', () => {
  it('shows the newer breadcrumb location and time while keeping position-derived stale and cache flags', () => {
    const base = SNAPSHOT.positions[1]!
    const snapshot: TrackingSnapshot = {
      ...SNAPSHOT,
      breadcrumbs: [
        {
          ...base,
          id: 'crumb-newer',
          lat: 52.5,
          lon: -9.9,
          timestamp: '2026-04-10T16:45:00.000Z',
          data_origin: 'live',
          cache_age_seconds: null,
          device_cache_stale: false,
        },
      ],
    }

    const bravo = buildDeviceWorkspaceRows(snapshot, []).find((row) => row.deviceId === 'bravo')!

    expect(bravo.latitude).toBe(52.5)
    expect(bravo.longitude).toBe(-9.9)
    expect(bravo.fixTimeDisplay).toBe(formatOperatorLocalTimestamp('2026-04-10T16:45:00.000Z'))
    expect(bravo.stale).toBe(true)
    expect(bravo.dataOrigin).toBe('cache')
    expect(bravo.sourceDisplay).toBe('Stale')
  })

  it('keeps the current position when no breadcrumb is newer', () => {
    const alpha = buildDeviceWorkspaceRows(SNAPSHOT, []).find((row) => row.deviceId === 'alpha')!
    expect(alpha.latitude).toBe(52)
  })
})
