import { describe, expect, it } from 'vitest'

import {
  buildDeviceWorkspaceRows,
  buildDeviceWorkspaceSummary,
  filterDeviceWorkspaceRows,
  resolveVisibleDeviceSelection,
} from '../../src/features/tracking/device-workspace-model'
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
  it('builds readable roster rows from the tracking snapshot', () => {
    const rows = buildDeviceWorkspaceRows(SNAPSHOT, ['bravo'], ['alpha'])

    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      deviceId: 'alpha',
      sourceDisplay: 'Live',
      hidden: false,
      active: true,
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
      active: false,
      speedDisplay: '—',
    })
  })

  it('splits active mission devices from the full roster without hiding names', () => {
    const rows = buildDeviceWorkspaceRows(SNAPSHOT, [], ['bravo'])
    const activeRows = rows.filter((row) => row.active)

    expect(activeRows).toHaveLength(1)
    expect(activeRows[0]).toMatchObject({
      deviceId: 'bravo',
      name: 'Bravo Team',
      active: true,
    })
    expect(rows.map((row) => row.name)).toEqual(['Alpha Team', 'Bravo Team'])
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
      sourceDisplay: 'Fix time unverified',
      fixTimeUnverified: true,
      ingestWarning: '1 position row rejected — invalid coordinates.',
    })
  })

  it('adds derived stationary attention without changing fix truth [DON-269]', () => {
    const rows = buildDeviceWorkspaceRows(SNAPSHOT, [], [], undefined, {
      alpha: { state: 'attention', acknowledged: false, elapsedMs: 1_200_000 },
    })
    expect(rows[0]).toMatchObject({
      deviceId: 'alpha', stationaryAttention: true,
      attentionAcknowledged: false, latitude: 52, longitude: -9.7,
    })
  })

  it('distinguishes unavailable and uncorroborated stationary evaluation', () => {
    expect(buildDeviceWorkspaceRows(SNAPSHOT, [], [], undefined, {
      alpha: { state: 'insufficient-data', acknowledged: false },
    })[0]).toMatchObject({
      stationaryAttention: false,
      stationaryAttentionUnavailable: true,
      stationaryAttentionUnreliable: false,
    })

    expect(buildDeviceWorkspaceRows(SNAPSHOT, [], [], undefined, {
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
    const rows = buildDeviceWorkspaceRows(SNAPSHOT, ['bravo'], ['alpha'])
    const summary = buildDeviceWorkspaceSummary(rows, STATUS)

    expect(summary).toMatchObject({
      totalDevices: 2,
      activeDevices: 1,
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

  it('scopes device search to the active list filter', () => {
    const rows = buildDeviceWorkspaceRows(SNAPSHOT, [], ['bravo'])

    expect(filterDeviceWorkspaceRows(rows, 'active', 'Alpha').map((row) => row.deviceId)).toEqual([])
    expect(filterDeviceWorkspaceRows(rows, 'active', 'Bravo').map((row) => row.deviceId)).toEqual([
      'bravo',
    ])
    expect(filterDeviceWorkspaceRows(rows, 'all', 'Alpha').map((row) => row.deviceId)).toEqual([
      'alpha',
    ])
  })

  it('resolves selection to the first visible device when the current device is outside the list', () => {
    const rows = buildDeviceWorkspaceRows(SNAPSHOT, [], ['bravo'])
    const activeRows = filterDeviceWorkspaceRows(rows, 'active', '')
    const noFixRows = filterDeviceWorkspaceRows(rows, 'nofix', '')

    expect(resolveVisibleDeviceSelection(activeRows, 'alpha')).toBe('bravo')
    expect(resolveVisibleDeviceSelection(activeRows, 'bravo')).toBe('bravo')
    expect(resolveVisibleDeviceSelection(noFixRows, 'alpha')).toBeNull()
  })
})
