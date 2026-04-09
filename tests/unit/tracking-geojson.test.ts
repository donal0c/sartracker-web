import { describe, expect, it } from 'vitest'

import devicesFixture from '../fixtures/traccar-devices.json'
import positionsFixture from '../fixtures/traccar-positions.json'
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
})
