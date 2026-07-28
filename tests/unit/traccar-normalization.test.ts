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

  it('canonicalizes accepted timestamp formats before cursor and dedupe use [DON-233]', () => {
    const position = normalizeTraccarPosition(
      {
        ...positionsFixture[0],
        fixTime: '2026-04-06T10:30:00Z',
      },
      'live',
    )

    expect(position.timestamp).toBe('2026-04-06T10:30:00.000Z')
  })

  it('normalizes Traccar API position speed from knots to km/h [DON-234]', () => {
    const position = normalizeTraccarPosition(
      {
        ...positionsFixture[0],
        speed: 10,
      },
      'live',
    )

    expect(position.speed).toBeCloseTo(18.52, 3)
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

  it.each([
    ['position id', { id: null }],
    ['position id', { id: '' }],
    ['position deviceId', { deviceId: null }],
    ['position deviceId', { deviceId: '' }],
    ['position latitude', { latitude: null }],
    ['position latitude', { latitude: '' }],
    ['position longitude', { longitude: null }],
    ['position longitude', { longitude: '' }],
  ])('rejects missing or empty required %s values [DON-260]', (_label, override) => {
    expect(() =>
      normalizeTraccarPosition(
        {
          ...positionsFixture[0],
          ...override,
        },
        'live',
      ),
    ).toThrow()
  })

  it('does not coerce a string false validity flag to true [DON-260]', () => {
    expect(() =>
      normalizeTraccarPosition(
        {
          ...positionsFixture[0],
          valid: 'false',
        },
        'live',
      ),
    ).toThrow(/invalid/i)
  })

  it('rejects date-only timestamps that would otherwise be guessed as midnight [DON-260]', () => {
    expect(() =>
      normalizeTraccarPosition(
        {
          ...positionsFixture[0],
          fixTime: '2026-07-28',
        },
        'live',
      ),
    ).toThrow(/fixTime/i)
  })

  it('rejects impossible calendar dates instead of rolling them into another day [DON-260]', () => {
    expect(() =>
      normalizeTraccarPosition(
        {
          ...positionsFixture[0],
          fixTime: '2026-02-30T10:00:00Z',
        },
        'live',
      ),
    ).toThrow(/fixTime/i)
  })

  it.each([null, '', 1.5, 0, -1])(
    'rejects an invalid Traccar device identity %j [DON-260]',
    (id) => {
      expect(() =>
        normalizeTraccarDevice({
          ...devicesFixture[0],
          id,
        }),
      ).toThrow(/device id/i)
    },
  )

  it('supports canonical breadcrumb fixtures', () => {
    const breadcrumbs = breadcrumbsFixture.map((position) =>
      normalizeTraccarPosition(position, 'live'),
    )

    expect(breadcrumbs).toHaveLength(3)
    expect(breadcrumbs[0].device_id).toBe('1')
  })
})
