import { describe, expect, it, vi } from 'vitest'

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
    expect(parsed.positions[0]?.timestamp_source).toBe('fix')
  })

  it('continues to decode legacy cache positions without timestamp provenance [DON-267]', () => {
    const legacyPosition = normalizeTraccarPosition(positionsFixture[0], 'live')
    const withoutProvenance = Object.fromEntries(
      Object.entries(legacyPosition).filter(([key]) => (
        key !== 'timestamp_source' && key !== 'fix_time_unverified'
      )),
    )

    const parsed = parseTrackingCachePayload(JSON.stringify({
      cached_at: '2026-04-06T10:35:00.000Z',
      devices: [],
      positions: [withoutProvenance],
      breadcrumbs: [],
    }))

    expect(parsed.positions).toHaveLength(1)
    expect(parsed.positions[0]?.timestamp_source).toBeUndefined()
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

  it('reports bounded malformed-entry counts without exposing rejected cache rows [DON-260]', () => {
    const onDroppedEntries = vi.fn()

    parseTrackingCachePayload(
      JSON.stringify({
        cached_at: '2026-04-06T10:35:00.000Z',
        devices: [devicesFixture[0], { id: 'bad-device' }, null],
        positions: [
          positionsFixture[0],
          { id: 1, deviceId: 2, latitude: 999, longitude: 0 },
        ],
        breadcrumbs: [positionsFixture[1]],
      }),
      { onDroppedEntries },
    )

    expect(onDroppedEntries).toHaveBeenCalledTimes(2)
    expect(onDroppedEntries).toHaveBeenNthCalledWith(1, {
      section: 'devices',
      droppedCount: 2,
      totalCount: 3,
    })
    expect(onDroppedEntries).toHaveBeenNthCalledWith(2, {
      section: 'positions',
      droppedCount: 1,
      totalCount: 2,
    })
  })

  it('drops normalized cache rows with coercible missing required fields [DON-260]', () => {
    const validPosition = normalizeTraccarPosition(positionsFixture[0], 'live')
    const parsed = parseTrackingCachePayload(
      JSON.stringify({
        cached_at: '2026-04-06T10:35:00.000Z',
        devices: [],
        positions: [
          { ...validPosition, id: null },
          { ...validPosition, device_id: '' },
          { ...validPosition, lat: null },
          { ...validPosition, lon: '' },
          { ...validPosition, timestamp: undefined },
          validPosition,
        ],
        breadcrumbs: [],
      }),
    )

    expect(parsed.positions).toEqual([
      expect.objectContaining({
        id: validPosition.id,
        device_id: validPosition.device_id,
        lat: validPosition.lat,
        lon: validPosition.lon,
        timestamp: validPosition.timestamp,
      }),
    ])
  })

  it('drops normalized cache rows with non-finite optional numbers [DON-260]', () => {
    const validPosition = normalizeTraccarPosition(positionsFixture[0], 'live')
    const parsed = parseTrackingCachePayload(
      JSON.stringify({
        cached_at: '2026-04-06T10:35:00.000Z',
        devices: [],
        positions: [
          { ...validPosition, accuracy: 'not-a-number' },
          validPosition,
        ],
        breadcrumbs: [],
      }),
    )

    expect(parsed.positions).toHaveLength(1)
    expect(parsed.positions[0]?.id).toBe(validPosition.id)
  })

  it('drops normalized cache devices with invalid identity or last-seen values [DON-260]', () => {
    const validDevice = normalizeTraccarDevice(devicesFixture[0])
    const parsed = parseTrackingCachePayload(
      JSON.stringify({
        cached_at: '2026-04-06T10:35:00.000Z',
        devices: [
          { ...validDevice, device_id: null },
          { ...validDevice, device_id: '' },
          { ...validDevice, last_seen: 'not-a-time' },
          validDevice,
        ],
        positions: [],
        breadcrumbs: [],
      }),
    )

    expect(parsed.devices).toEqual([validDevice])
  })

  it('rejects a coercible non-string cache timestamp [DON-260]', () => {
    expect(() =>
      parseTrackingCachePayload(
        JSON.stringify({
          cached_at: 1_785_236_100_000,
          devices: [],
          positions: [],
          breadcrumbs: [],
        }),
      ),
    ).toThrow(/cached_at/i)
  })

  it('rejects date-only cache timestamps instead of guessing a time [DON-260]', () => {
    expect(() =>
      parseTrackingCachePayload(
        JSON.stringify({
          cached_at: '2026-07-28',
          devices: [],
          positions: [],
          breadcrumbs: [],
        }),
      ),
    ).toThrow(/cached_at/i)
  })

  it('rejects fully invalid cache json', () => {
    expect(() => parseTrackingCachePayload('not-json')).toThrow(/cache/i)
  })
})
