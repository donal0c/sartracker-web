import { describe, expect, it } from 'vitest'
import { createCurrentTransportFreshness } from '../../src/features/tracking/current-transport-freshness'
import type { TrackingSnapshot } from '../../src/features/tracking/tracking-types'

const snapshot: TrackingSnapshot = {
  devices: [{ device_id: 'alpha', name: 'Alpha', status: 'online', last_seen: null, unique_id: null, category: null }],
  positions: [{ id: 'fix', device_id: 'alpha', lat: 52, lon: -9.7, timestamp: '2026-09-10T10:00:00Z',
    altitude: null, speed: null, battery: null, accuracy: 4, source: 'traccar', data_origin: 'live',
    cache_age_seconds: null, device_cache_stale: false }], breadcrumbs: [],
}

describe('current transport freshness', () => {
  it('confirms each device separately when replacement current responses are incomplete', () => {
    const freshness = createCurrentTransportFreshness()
    const twoDevices: TrackingSnapshot = {
      ...snapshot,
      devices: [...snapshot.devices, { ...snapshot.devices[0]!, device_id: 'bravo' }],
      positions: [...snapshot.positions, { ...snapshot.positions[0]!, device_id: 'bravo' }],
    }
    freshness.reset()
    freshness.observeCurrent(snapshot)
    const result = freshness.decorate(twoDevices)
    expect(result.unconfirmedCurrentDeviceIds).toEqual(['bravo'])
    expect(result.devices.map((device) => device.status)).toEqual(['online', 'unknown'])
    expect(result.positions).toBe(twoDevices.positions)
  })

  it('keeps retained positions unconfirmed until current evidence arrives, without rewriting fixes', () => {
    const freshness = createCurrentTransportFreshness()
    expect(freshness.decorate(snapshot)).toBe(snapshot)
    freshness.reset()
    freshness.observeCurrent({ ...snapshot, positions: [] })
    const retained = freshness.decorate(snapshot)
    expect(retained.unconfirmedCurrentDeviceIds).toEqual(['alpha'])
    expect(retained.devices[0]?.status).toBe('unknown')
    expect(retained.positions[0]).toBe(snapshot.positions[0])
    expect(snapshot.devices[0]?.status).toBe('online')
    freshness.observeCurrent(snapshot)
    expect(freshness.decorate(snapshot).unconfirmedCurrentDeviceIds).toEqual([])
    expect(freshness.decorate(snapshot).devices[0]?.status).toBe('online')
    freshness.reset()
    expect(freshness.decorate(snapshot).unconfirmedCurrentDeviceIds).toEqual(['alpha'])
  })
})
