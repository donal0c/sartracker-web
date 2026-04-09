import { describe, expect, it } from 'vitest'

import breadcrumbsFixture from '../fixtures/traccar-breadcrumbs.json'
import devicesFixture from '../fixtures/traccar-devices.json'
import positionsFixture from '../fixtures/traccar-positions.json'
import {
  normalizeTraccarDevice,
  normalizeTraccarPosition,
} from '../../src/features/tracking/traccar-normalization'

describe('traccar normalization', () => {
  it('normalizes a device payload into the internal shape', () => {
    const device = normalizeTraccarDevice(devicesFixture[0])

    expect(device.device_id).toBe('1')
    expect(device.name).toBe('Donal Phone')
    expect(device.status).toBe('online')
    expect(device.last_seen).toBe('2026-04-06T10:30:00.000Z')
  })

  it('normalizes a position payload into the internal shape', () => {
    const position = normalizeTraccarPosition(positionsFixture[0], 'live')

    expect(position.device_id).toBe('1')
    expect(position.lat).toBe(51.9985)
    expect(position.lon).toBe(-9.7426)
    expect(position.battery).toBe(85)
    expect(position.timestamp).toBe('2026-04-06T10:30:00.000Z')
    expect(position.data_origin).toBe('live')
  })

  it('falls back to deviceTime or serverTime when fixTime is absent', () => {
    const position = normalizeTraccarPosition(
      {
        ...positionsFixture[0],
        fixTime: undefined,
        deviceTime: '2026-04-06T10:29:59.000Z',
      },
      'cache',
    )

    expect(position.timestamp).toBe('2026-04-06T10:29:59.000Z')
    expect(position.data_origin).toBe('cache')
  })

  it('rejects malformed payloads instead of silently accepting them', () => {
    expect(() =>
      normalizeTraccarDevice({
        id: 'bad-id',
      }),
    ).toThrow(/device/i)

    expect(() =>
      normalizeTraccarPosition(
        {
          ...positionsFixture[0],
          latitude: 200,
        },
        'live',
      ),
    ).toThrow(/latitude/i)
  })

  it('supports canonical breadcrumb fixtures', () => {
    const breadcrumbs = breadcrumbsFixture.map((position) =>
      normalizeTraccarPosition(position, 'live'),
    )

    expect(breadcrumbs).toHaveLength(3)
    expect(breadcrumbs[0].device_id).toBe('1')
  })
})
