import { describe, expect, it, vi } from 'vitest'

import devicesFixture from '../fixtures/traccar-devices.json'
import positionsFixture from '../fixtures/traccar-positions.json'
import {
  accumulateBreadcrumbPositions,
  appendBreadcrumbPositions,
} from '../../src/features/tracking/breadcrumb-accumulator'
import {
  DEFAULT_BREADCRUMB_LINE_GAP_THRESHOLD_MS,
  createBreadcrumbFeatureCollection,
  createDeviceFeatureCollection,
  createTrackingFeatureCollection,
} from '../../src/features/tracking/tracking-geojson'
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
    expect(collection.features[0]?.properties.featureKind).toBe('device')
    expect(collection.features[0]?.properties.color).toMatch(/^#/)
    expect(collection.features[0]?.properties.stale).toBe(true)
  })

  it('marks breadcrumb points separately from current device points for dot trails', () => {
    const collection = createTrackingFeatureCollection(
      {
        devices: devicesFixture.map((device) => normalizeTraccarDevice(device)),
        positions: [
          normalizeTraccarPosition(
            {
              id: 20,
              deviceId: 1,
              latitude: 52.003,
              longitude: -9.703,
              fixTime: '2026-04-06T10:06:00.000Z',
            },
            'live',
          ),
        ],
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
      { deviceColors: { '1': '#F97316' }, breadcrumbSize: 6, breadcrumbTrailMode: 'dots' },
    )

    const pointFeatures = collection.features.filter((feature) => feature.geometry.type === 'Point')

    expect(pointFeatures.map((feature) => feature.properties?.featureKind)).toEqual([
      'breadcrumb',
      'breadcrumb',
      'device',
    ])
    expect(pointFeatures[0]?.properties?.color).toBe('#F97316')
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

  it('connects sparse but operational breadcrumb cadence into a readable trail [DON-189]', () => {
    const breadcrumbs = Array.from({ length: 6 }, (_, index) =>
      normalizeTraccarPosition(
        {
          id: index + 1,
          deviceId: 1,
          latitude: 52 + index * 0.004,
          longitude: -9.7 - index * 0.006,
          fixTime: new Date(Date.UTC(2026, 4, 14, 10, index * 6, 0)).toISOString(),
        },
        'live',
      ),
    )

    const collection = createBreadcrumbFeatureCollection(
      {
        devices: devicesFixture.map((device) => normalizeTraccarDevice(device)),
        positions: [],
        breadcrumbs,
      },
      DEFAULT_BREADCRUMB_LINE_GAP_THRESHOLD_MS,
    )

    expect(collection.features).toHaveLength(1)
    expect(collection.features[0]?.geometry.type).toBe('LineString')
    expect(collection.features[0]?.geometry.coordinates).toHaveLength(6)
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

  it('does not apply one global render budget across all device breadcrumbs [DON-159]', () => {
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

    expect(accumulated).toHaveLength(24_600)
    expect(accumulated[0]?.timestamp).toBe('2026-05-14T10:00:00.000Z')
    expect(accumulated.at(-1)?.timestamp).toBe('2026-05-14T16:49:59.000Z')
  })

  it('keeps worst-case per-device retained trail rendering bounded [DON-159]', () => {
    const breadcrumbs = Array.from({ length: 33 * 6_000 }, (_, index) => {
      const deviceId = (index % 33) + 1
      return normalizeTraccarPosition(
        {
          id: index + 1,
          deviceId,
          latitude: 52 + index / 10_000_000,
          longitude: -9.7 - index / 10_000_000,
          fixTime: new Date(Date.UTC(2026, 5, 13, 0, 0, index)).toISOString(),
        },
        'live',
      )
    })

    const accumulated = accumulateBreadcrumbPositions([], breadcrumbs)
    const collection = createBreadcrumbFeatureCollection(
      {
        devices: [],
        positions: [],
        breadcrumbs: accumulated.positions,
      },
      5 * 60 * 1000,
    )

    expect(accumulated.positions).toHaveLength(33 * 5_000)
    expect(accumulated.metadata.deviceBudgets.every((budget) => budget.retained === 5_000)).toBe(true)
    expect(collection.features).toHaveLength(33)
  })

  it('reuses breadcrumb line features when only current positions change [DON-212]', () => {
    const breadcrumbs = Array.from({ length: 180 }, (_, index) =>
      normalizeTraccarPosition(
        {
          id: index + 1,
          deviceId: (index % 3) + 1,
          latitude: 52 + index / 1_000_000,
          longitude: -9.7 - index / 1_000_000,
          fixTime: new Date(Date.UTC(2026, 5, 13, 10, 0, index)).toISOString(),
        },
        'live',
      ),
    )
    const devices = devicesFixture.map((device) => normalizeTraccarDevice(device))
    const firstSnapshot = {
      devices,
      positions: [
        normalizeTraccarPosition(
          {
            id: 10_001,
            deviceId: 1,
            latitude: 52.001,
            longitude: -9.701,
            fixTime: '2026-06-13T10:03:00.000Z',
          },
          'live',
        ),
      ],
      breadcrumbs,
    }
    const secondSnapshot = {
      ...firstSnapshot,
      positions: [
        normalizeTraccarPosition(
          {
            id: 10_002,
            deviceId: 1,
            latitude: 52.002,
            longitude: -9.702,
            fixTime: '2026-06-13T10:04:00.000Z',
          },
          'live',
        ),
      ],
    }
    const parseSpy = vi.spyOn(Date, 'parse')

    try {
      createTrackingFeatureCollection(
        firstSnapshot,
        DEFAULT_BREADCRUMB_LINE_GAP_THRESHOLD_MS,
      )
      const parseCallsAfterFirstBuild = parseSpy.mock.calls.length

      createTrackingFeatureCollection(
        secondSnapshot,
        DEFAULT_BREADCRUMB_LINE_GAP_THRESHOLD_MS,
      )

      expect(parseSpy).toHaveBeenCalledTimes(parseCallsAfterFirstBuild)
    } finally {
      parseSpy.mockRestore()
    }
  })
})
