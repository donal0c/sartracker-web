import { LngLat, MercatorCoordinate } from 'maplibre-gl'
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

  it('matches MapLibre metres per pixel, whose zoom is sized for 512-pixel tiles (DON-339)', () => {
    const latitude = 52
    const zoom = 13
    const readout = buildMapScaleReadout({ latitude, zoom, targetWidthPx: 140 })

    // MapLibre's own measurement: one metre in Mercator world units at this latitude,
    // with the MapLibre world MAPLIBRE_TILE_SIZE * 2^zoom CSS pixels wide.
    const mercatorUnitsPerMetre = MercatorCoordinate.fromLngLat(
      { lng: -9, lat: latitude },
    ).meterInMercatorCoordinateUnits()
    const maplibreMetresPerPixel = 1 / (mercatorUnitsPerMetre * MAPLIBRE_TILE_SIZE * 2 ** zoom)

    expect(maplibreMetresPerPixel).toBeCloseTo(5.88, 2)
    // MapLibre measures on a mean-radius sphere (6371008.8 m); the readout uses the WGS84
    // equatorial radius, as Web Mercator does. They differ by 0.11%, far below one pixel.
    expect(relativeDifference(readout.distanceM / readout.widthPx, maplibreMetresPerPixel)).toBeLessThan(0.005)
    expect(readout.distanceM).toBe(500)
    expect(readout.label).toBe('500 m')
    expect(readout.widthPx).toBeCloseTo(85, 0)
  })

  it('matches the distance between two MapLibre-projected points at several Irish latitudes and zooms', () => {
    for (const [latitude, zoom] of [
      [51.5, 10],
      [53.3, 14.5],
      [55.2, 16],
    ] as const) {
      const readout = buildMapScaleReadout({ latitude, zoom })
      const worldPx = MAPLIBRE_TILE_SIZE * 2 ** zoom
      const centre = MercatorCoordinate.fromLngLat({ lng: -8, lat: latitude })
      const east = new MercatorCoordinate(centre.x + readout.widthPx / worldPx, centre.y, 0)
      const groundM = new LngLat(-8, latitude).distanceTo(east.toLngLat())

      // The labelled distance must equal what the drawn bar covers on the MapLibre map.
      // 0.5% allows only for MapLibre's mean-radius sphere; the old bug was 100%.
      expect(relativeDifference(groundM, readout.distanceM)).toBeLessThan(0.005)
    }
  })
})

/** MapLibre GL sizes zoom 0 as one 512 CSS-pixel world (transform tileSize). */
const MAPLIBRE_TILE_SIZE = 512

/** Relative difference between a measured and an expected value. */
function relativeDifference(measured: number, expected: number): number {
  return Math.abs(measured - expected) / expected
}
