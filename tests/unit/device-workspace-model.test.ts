import { describe, expect, it } from 'vitest'

import {
  buildDeviceWorkspaceRows,
  buildDeviceWorkspaceSummary,
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
      accuracy: null,
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
    })
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
  })
})
