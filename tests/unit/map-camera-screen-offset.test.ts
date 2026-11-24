import { describe, expect, it, vi } from 'vitest'
import { Evented, type Map as MapLibreMap } from 'maplibre-gl'

import { centerForScreenOffset, navigateMapToTarget } from '../../src/features/map/map-camera-navigation'

describe('centerForScreenOffset [DON-368]', () => {
  it('centres the target when there is no offset', () => {
    expect(centerForScreenOffset([-9.5, 52.05], 14, 0, 0)).toEqual([-9.5, 52.05])
  })

  it('moves the centre west so the target sits the offset right of the middle, north up', () => {
    const [longitude, latitude] = centerForScreenOffset([-9.5, 52.05], 14, 0, 200)
    expect(longitude).toBeCloseTo(-9.5 - (200 * 360) / (512 * 2 ** 14), 9)
    expect(latitude).toBeCloseTo(52.05, 9)
  })

  it('follows the map bearing: at 90° screen right points south', () => {
    const [longitude, latitude] = centerForScreenOffset([-9.5, 52.05], 14, 90, 200)
    expect(longitude).toBeCloseTo(-9.5, 9)
    expect(latitude).toBeGreaterThan(52.05)
  })

  it('flies to and remembers the shifted centre, so a style change restores the same view', () => {
    const events = new Evented()
    const map = Object.assign(events, {
      getCenter: () => ({ lng: -9.7, lat: 52 }),
      getZoom: () => 12,
      getBearing: () => 0,
      getPitch: () => 0,
      flyTo: vi.fn(),
      jumpTo: vi.fn(),
    })
    const release = navigateMapToTarget(map as unknown as MapLibreMap, [-9.5, 52.05], () => true, { screenOffsetX: 200 })
    const expected = centerForScreenOffset([-9.5, 52.05], 14, 0, 200)
    expect(map.flyTo).toHaveBeenCalledWith(expect.objectContaining({ center: expected, zoom: 14 }), expect.anything())
    map.fire('style.load')
    expect(map.jumpTo).toHaveBeenCalledWith(expect.objectContaining({ center: expected }), expect.anything())
    release()
  })
})
