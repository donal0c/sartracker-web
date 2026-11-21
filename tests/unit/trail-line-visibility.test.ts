import { featureFilter } from '@maplibre/maplibre-gl-style-spec'
import { describe, expect, it } from 'vitest'

import { buildTrackingLayerFilter } from '../../src/features/layers/map-layer-filters'
import {
  isBreadcrumbTrailDrawnForDevice,
  summarizeTrailDrawing,
} from '../../src/features/tracking/trail-line-visibility'

describe('trail drawing truth [DON-338]', () => {
  it('uses the same per-device rule as the MapLibre trail filter', () => {
    const hidden = ['device-A', 'gone-device']
    const filter = featureFilter(buildTrackingLayerFilter(hidden))
    for (const deviceId of ['device-A', 'device-B', 'gone-device', 'device-C']) {
      const mapLibreDraws = filter.filter({ zoom: 14 }, { type: 2, properties: { deviceId } })
      expect(isBreadcrumbTrailDrawnForDevice(deviceId, true, new Set(hidden))).toBe(mapLibreDraws)
      expect(isBreadcrumbTrailDrawnForDevice(deviceId, false, new Set(hidden))).toBe(false)
    }
  })

  it('judges line and dots from their own geometry, never from the roster', () => {
    // Restored snapshot: roster holds device-A only; the trail and page hold device-B.
    expect(summarizeTrailDrawing({
      trailsVisible: true,
      hiddenBreadcrumbDeviceIds: ['device-A'],
      lineDeviceIds: new Set(['device-B']),
      dotDeviceIds: new Set(['device-B']),
    })).toEqual({ line: 'drawn', dots: 'all', hiddenTrailCount: 0 })

    // Line for B only; the page also holds C, which is hidden.
    expect(summarizeTrailDrawing({
      trailsVisible: true,
      hiddenBreadcrumbDeviceIds: ['device-C'],
      lineDeviceIds: new Set(['device-B']),
      dotDeviceIds: new Set(['device-B', 'device-C']),
    })).toEqual({ line: 'drawn', dots: 'some', hiddenTrailCount: 1 })

    // No trail geometry at all.
    expect(summarizeTrailDrawing({
      trailsVisible: true,
      hiddenBreadcrumbDeviceIds: [],
      lineDeviceIds: new Set(),
      dotDeviceIds: new Set(),
    })).toEqual({ line: 'no-trail', dots: 'all', hiddenTrailCount: 0 })

    // Trails switched off wins over everything.
    expect(summarizeTrailDrawing({
      trailsVisible: false,
      hiddenBreadcrumbDeviceIds: ['device-B'],
      lineDeviceIds: new Set(['device-B']),
      dotDeviceIds: new Set(['device-B']),
    })).toEqual({ line: 'switched-off', dots: 'none', hiddenTrailCount: 0 })
  })
})
