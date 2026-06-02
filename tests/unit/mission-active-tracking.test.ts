import { describe, expect, it } from 'vitest'

import {
  selectMissionTrackingSnapshot,
} from '../../src/features/tracking/mission-active-tracking'
import type { TrackingSnapshot } from '../../src/features/tracking/tracking-types'

describe('selectMissionTrackingSnapshot', () => {
  it('keeps the full tracking snapshot when no mission-active devices are selected yet', () => {
    const snapshot = createSnapshot()

    expect(selectMissionTrackingSnapshot(snapshot, [])).toEqual(snapshot)
  })

  it('filters devices, current positions, and breadcrumbs to selected mission-active devices', () => {
    const filtered = selectMissionTrackingSnapshot(createSnapshot(), ['bravo'])

    expect(filtered.devices.map((device) => device.device_id)).toEqual(['bravo'])
    expect(filtered.positions.map((position) => position.device_id)).toEqual(['bravo'])
    expect(filtered.breadcrumbs.map((position) => position.device_id)).toEqual(['bravo'])
  })
})

function createSnapshot(): TrackingSnapshot {
  return {
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
        last_seen: '2026-04-10T16:40:00.000Z',
        unique_id: null,
        category: null,
      },
    ],
    positions: [
      createPosition('pos-alpha', 'alpha'),
      createPosition('pos-bravo', 'bravo'),
    ],
    breadcrumbs: [
      createPosition('crumb-alpha', 'alpha'),
      createPosition('crumb-bravo', 'bravo'),
    ],
  }
}

function createPosition(id: string, deviceId: string): TrackingSnapshot['positions'][number] {
  return {
    id,
    device_id: deviceId,
    lat: deviceId === 'alpha' ? 51.99917 : 52.05944,
    lon: deviceId === 'alpha' ? -9.74406 : -9.50722,
    altitude: null,
    speed: null,
    battery: null,
    accuracy: null,
    timestamp: '2026-04-10T17:00:00.000Z',
    source: null,
    data_origin: 'live',
    cache_age_seconds: null,
    device_cache_stale: false,
  }
}
