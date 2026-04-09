import { describe, expect, it } from 'vitest'

import devicesFixture from '../fixtures/traccar-devices.json'
import positionsFixture from '../fixtures/traccar-positions.json'
import {
  parseTrackingCachePayload,
  serializeTrackingCachePayload,
} from '../../src/features/tracking/tracking-cache-payload'
import {
  normalizeTraccarDevice,
  normalizeTraccarPosition,
} from '../../src/features/tracking/traccar-normalization'

describe('tracking cache payload', () => {
  it('serializes and parses a normalized tracking snapshot', () => {
    const devices = devicesFixture.map((device) => normalizeTraccarDevice(device))
    const positions = positionsFixture.map((position) =>
      normalizeTraccarPosition(position, 'live'),
    )

    const serialized = serializeTrackingCachePayload({
      cached_at: '2026-04-06T10:35:00.000Z',
      devices,
      positions,
      breadcrumbs: positions,
    })
    const parsed = parseTrackingCachePayload(serialized)

    expect(parsed.cached_at).toBe('2026-04-06T10:35:00.000Z')
    expect(parsed.devices).toHaveLength(2)
    expect(parsed.positions).toHaveLength(2)
    expect(parsed.breadcrumbs).toHaveLength(2)
  })

  it('drops malformed entries rather than rejecting the full cache', () => {
    const parsed = parseTrackingCachePayload(
      JSON.stringify({
        cached_at: '2026-04-06T10:35:00.000Z',
        devices: [devicesFixture[0], { id: 'bad-device' }],
        positions: [positionsFixture[0], { id: 1, deviceId: 2, latitude: 999, longitude: 0 }],
        breadcrumbs: [positionsFixture[1]],
      }),
    )

    expect(parsed.devices).toHaveLength(1)
    expect(parsed.positions).toHaveLength(1)
    expect(parsed.breadcrumbs).toHaveLength(1)
  })

  it('rejects fully invalid cache json', () => {
    expect(() => parseTrackingCachePayload('not-json')).toThrow(/cache/i)
  })
})
