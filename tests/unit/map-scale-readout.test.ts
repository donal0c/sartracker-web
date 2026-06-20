import { describe, expect, it } from 'vitest'

import {
  buildMapScaleReadout,
  chooseMapScaleDistance,
  formatMapScaleDistance,
} from '../../src/features/map/map-scale-readout'

describe('map-scale-readout', () => {
  it('chooses a readable rounded distance that fits inside the target width', () => {
    expect(chooseMapScaleDistance(3.7, 140)).toBe(500)
    expect(chooseMapScaleDistance(22, 140)).toBe(2_000)
    expect(chooseMapScaleDistance(84, 140)).toBe(10_000)
  })

  it('formats operator scale distances without noisy decimals', () => {
    expect(formatMapScaleDistance(250)).toBe('250 m')
    expect(formatMapScaleDistance(1_000)).toBe('1 km')
    expect(formatMapScaleDistance(1_500)).toBe('1.5 km')
    expect(formatMapScaleDistance(12_000)).toBe('12 km')
  })

  it('builds a scale readout from latitude and zoom using Web Mercator metres per pixel', () => {
    const readout = buildMapScaleReadout({
      latitude: 52,
      zoom: 13,
      targetWidthPx: 140,
    })

    expect(readout.distanceM).toBe(1_000)
    expect(readout.label).toBe('1 km')
    expect(readout.widthPx).toBeGreaterThan(80)
    expect(readout.widthPx).toBeLessThanOrEqual(140)
  })
})
