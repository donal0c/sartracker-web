import { describe, expect, it } from 'vitest'

import devicesFixture from '../fixtures/traccar-devices.json'
import positionsFixture from '../fixtures/traccar-positions.json'
import { appendBreadcrumbPositions } from '../../src/features/tracking/breadcrumb-accumulator'
import { createBreadcrumbFeatureCollection, createDeviceFeatureCollection } from '../../src/features/tracking/tracking-geojson'
import {
  normalizeTraccarDevice,
  normalizeTraccarPosition,
} from '../../src/features/tracking/traccar-normalization'

describe('tracking geojson', () => {
  it('creates one point feature per device position', () => {
    const collection = createDeviceFeatureCollection({
      devices: devicesFixture.map((device) => normalizeTraccarDevice(device)),
      positions: positionsFixture.map((position, index) => ({
        ...normalizeTraccarPosition(position, 'live'),
        device_cache_stale: index === 0,
      })),
      breadcrumbs: [],
    })

    expect(collection.features).toHaveLength(2)
    expect(collection.features[0]?.geometry.type).toBe('Point')
    expect(collection.features[0]?.properties.deviceId).toBe('1')
    expect(collection.features[0]?.properties.name).toBe('Donal Phone')
    expect(collection.features[0]?.properties.color).toMatch(/^#/)
    expect(collection.features[0]?.properties.stale).toBe(true)
  })

  it('segments breadcrumb lines on time gaps and skips one-point segments', () => {
    const collection = createBreadcrumbFeatureCollection(
      {
        devices: devicesFixture.map((device) => normalizeTraccarDevice(device)),
        positions: [],
        breadcrumbs: [
          normalizeTraccarPosition(
            {
              id: 1,
              deviceId: 1,
              latitude: 52.0,
              longitude: -9.7,
              fixTime: '2026-04-06T10:00:00.000Z',
            },
            'live',
          ),
          normalizeTraccarPosition(
            {
              id: 2,
              deviceId: 1,
              latitude: 52.0002,
              longitude: -9.7002,
              fixTime: '2026-04-06T10:03:00.000Z',
            },
            'live',
          ),
          normalizeTraccarPosition(
            {
              id: 3,
              deviceId: 1,
              latitude: 52.1,
              longitude: -9.8,
              fixTime: '2026-04-06T11:30:00.000Z',
            },
            'live',
          ),
        ],
      },
      5 * 60 * 1000,
    )

    expect(collection.features).toHaveLength(1)
    expect(collection.features[0]?.geometry.type).toBe('LineString')
    expect(collection.features[0]?.properties.deviceId).toBe('1')
  })

  it('uses operator-configured breadcrumb colours per device', () => {
    const collection = createBreadcrumbFeatureCollection(
      {
        devices: devicesFixture.map((device) => normalizeTraccarDevice(device)),
        positions: [],
        breadcrumbs: [
          normalizeTraccarPosition(
            {
              id: 1,
              deviceId: 1,
              latitude: 52.0,
              longitude: -9.7,
              fixTime: '2026-04-06T10:00:00.000Z',
            },
            'live',
          ),
          normalizeTraccarPosition(
            {
              id: 2,
              deviceId: 1,
              latitude: 52.0002,
              longitude: -9.7002,
              fixTime: '2026-04-06T10:03:00.000Z',
            },
            'live',
          ),
        ],
      },
      5 * 60 * 1000,
      { deviceColors: { '1': '#F97316' }, breadcrumbSize: 6 },
    )

    expect(collection.features[0]?.properties.color).toBe('#F97316')
  })

  it('builds a large single-device breadcrumb line without dropping current positions', () => {
    const breadcrumbs = Array.from({ length: 14_500 }, (_, index) =>
      normalizeTraccarPosition(
        {
          id: index + 1,
          deviceId: 2,
          latitude: 52 + index / 1_000_000,
          longitude: -9.7 - index / 1_000_000,
          fixTime: new Date(Date.UTC(2026, 4, 14, 10, 0, index)).toISOString(),
        },
        'live',
      ),
    )

    const collection = createBreadcrumbFeatureCollection(
      {
        devices: devicesFixture.map((device) => normalizeTraccarDevice(device)),
        positions: [
          normalizeTraccarPosition(
            {
              id: 20_000,
              deviceId: 2,
              latitude: 52.1,
              longitude: -9.8,
              fixTime: '2026-05-16T10:30:00.000Z',
            },
            'live',
          ),
        ],
        breadcrumbs,
      },
      5 * 60 * 1000,
    )

    expect(collection.features).toHaveLength(1)
    expect(collection.features[0]?.geometry.type).toBe('LineString')
    expect(collection.features[0]?.geometry.coordinates).toHaveLength(14_500)
  })

  it('keeps live breadcrumb snapshots under the long-running browser render budget', () => {
    const existing = Array.from({ length: 22_000 }, (_, index) =>
      normalizeTraccarPosition(
        {
          id: index + 1,
          deviceId: (index % 25) + 1,
          latitude: 52 + index / 1_000_000,
          longitude: -9.7 - index / 1_000_000,
          fixTime: new Date(Date.UTC(2026, 4, 14, 10, 0, index)).toISOString(),
        },
        'live',
      ),
    )
    const incoming = Array.from({ length: 3_000 }, (_, index) =>
      normalizeTraccarPosition(
        {
          id: 30_000 + index,
          deviceId: (index % 25) + 1,
          latitude: 52.1 + index / 1_000_000,
          longitude: -9.8 - index / 1_000_000,
          fixTime: new Date(Date.UTC(2026, 4, 14, 16, 0, index)).toISOString(),
        },
        'live',
      ),
    )

    const accumulated = appendBreadcrumbPositions(existing, incoming)

    expect(accumulated).toHaveLength(20_000)
    expect(accumulated[0]?.timestamp).toBe('2026-05-14T11:16:40.000Z')
    expect(accumulated.at(-1)?.timestamp).toBe('2026-05-14T16:49:59.000Z')
  })
})
