import { LngLat, MercatorCoordinate } from 'maplibre-gl'
import { describe, expect, it } from 'vitest'

import {
  MAP_SCALE_BAR_SEGMENT_COUNT,
  buildMapScaleBar,
  chooseMapScaleBarMaxWidth,
} from '../../src/features/map/map-scale-bar'
import { buildMapScaleReadout } from '../../src/features/map/map-scale-readout'

/** MapLibre GL sizes zoom 0 as one 512 CSS-pixel world (transform tileSize). */
const MAPLIBRE_TILE_SIZE = 512

/** Ground distance MapLibre measures between the centre and a point `px` pixels east. */
function maplibreGroundMetres(latitude: number, zoom: number, px: number): number {
  const worldPx = MAPLIBRE_TILE_SIZE * 2 ** zoom
  const centre = MercatorCoordinate.fromLngLat({ lng: -8, lat: latitude })
  const east = new MercatorCoordinate(centre.x + px / worldPx, centre.y, 0)
  return new LngLat(-8, latitude).distanceTo(east.toLngLat())
}

/** Relative difference between a measured and an expected value. */
function relativeDifference(measured: number, expected: number): number {
  return Math.abs(measured - expected) / expected
}

describe('[DON-369] segmented map scale bar', () => {
  it('marks 0 / 250 / 500 m at a search zoom over Kerry', () => {
    const bar = buildMapScaleBar({ latitude: 52, zoom: 13, maxWidthPx: 140 })
    expect(bar).not.toBeNull()
    expect(bar!.unit).toBe('m')
    expect(bar!.totalDistanceM).toBe(500)
    expect(bar!.ticks.map((tick) => tick.label)).toEqual(['0', '250', '500'])
    expect(bar!.totalLabel).toBe('500 m')
  })

  it('switches to kilometres when zoomed out: 0 / 1 / 2 km and 0 / 2.5 / 5 km', () => {
    const two = buildMapScaleBar({ latitude: 52, zoom: 11, maxWidthPx: 140 })
    expect(two!.unit).toBe('km')
    expect(two!.ticks.map((tick) => tick.label)).toEqual(['0', '1', '2'])
    expect(two!.totalLabel).toBe('2 km')

    const five = buildMapScaleBar({ latitude: 52, zoom: 10, maxWidthPx: 140 })
    expect(five!.ticks.map((tick) => tick.label)).toEqual(['0', '2.5', '5'])
    expect(five!.totalLabel).toBe('5 km')

    const one = buildMapScaleBar({ latitude: 53.3, zoom: 12, maxWidthPx: 160 })
    expect(one!.unit).toBe('km')
    expect(one!.ticks.map((tick) => tick.label)).toEqual(['0', '0.5', '1'])
  })

  it('uses the DON-339 readout as its oracle for total distance and width', () => {
    for (const [latitude, zoom, maxWidthPx] of [
      [51.5, 10, 140],
      [52, 13, 160],
      [53.3, 14.5, 200],
      [55.2, 16, 120],
      [54.4, 11.5, 180],
      [51.99, 8, 144],
    ] as const) {
      const bar = buildMapScaleBar({ latitude, zoom, maxWidthPx })!
      const readout = buildMapScaleReadout({ latitude, zoom, targetWidthPx: maxWidthPx })
      expect(bar.totalDistanceM).toBe(readout.distanceM)
      expect(bar.widthPx).toBe(readout.widthPx)
      expect(bar.totalLabel).toBe(readout.label)
    }
  })

  it('places every tick at the ground distance MapLibre measures, at several zooms and latitudes', () => {
    for (const [latitude, zoom] of [
      [51.5, 10],
      [51.99, 13],
      [53.0, 15],
      [53.3, 14.5],
      [54.4, 11.5],
      [55.2, 16],
      [55.3, 16.5],
    ] as const) {
      const bar = buildMapScaleBar({ latitude, zoom, maxWidthPx: 160 })!
      expect(bar.ticks).toHaveLength(3)
      expect(bar.ticks[0]).toMatchObject({ distanceM: 0, offsetPx: 0 })
      expect(bar.ticks[1].distanceM).toBe(bar.totalDistanceM / 2)
      expect(bar.ticks[2].distanceM).toBe(bar.totalDistanceM)
      expect(bar.ticks[2].offsetPx).toBeCloseTo(bar.widthPx, 9)

      for (const tick of bar.ticks.slice(1)) {
        const groundM = maplibreGroundMetres(latitude, zoom, tick.offsetPx)
        // 0.5% allows only for MapLibre's mean-radius sphere; the DON-339 bug was 100%.
        expect(relativeDifference(groundM, tick.distanceM), `${latitude} z${zoom} ${tick.label}`).toBeLessThan(0.005)
      }
    }
  })

  it('splits the bar into equal alternating black and white segments that fill its width exactly', () => {
    const bar = buildMapScaleBar({ latitude: 52, zoom: 13, maxWidthPx: 140 })!
    expect(bar.segments).toHaveLength(MAP_SCALE_BAR_SEGMENT_COUNT)
    expect(bar.segments.map((segment) => segment.filled)).toEqual([true, false, true, false])
    let cursor = 0
    for (const segment of bar.segments) {
      expect(segment.offsetPx).toBeCloseTo(cursor, 9)
      expect(segment.widthPx).toBeCloseTo(bar.widthPx / MAP_SCALE_BAR_SEGMENT_COUNT, 9)
      cursor += segment.widthPx
    }
    expect(cursor).toBeCloseTo(bar.widthPx, 9)
  })

  it('never draws the bar wider than the space it is given', () => {
    for (let zoom = 6; zoom <= 19; zoom += 0.25) {
      for (const maxWidthPx of [96, 144, 200]) {
        const bar = buildMapScaleBar({ latitude: 52.5, zoom, maxWidthPx })!
        expect(bar.widthPx).toBeLessThanOrEqual(maxWidthPx)
        expect(bar.widthPx).toBeGreaterThanOrEqual(maxWidthPx * 0.4 - 1e-9)
      }
    }
  })

  it('hides the middle label rather than let labels overlap on a short bar', () => {
    // 52°N z13 is 5.88 m/px: a 100 px budget gives 500 m at 85 px; 60 px gives 200 m at 34 px.
    const roomy = buildMapScaleBar({ latitude: 52, zoom: 13, maxWidthPx: 100 })!
    expect(roomy.ticks.map((tick) => tick.labelVisible)).toEqual([true, true, true])
    const cramped = buildMapScaleBar({ latitude: 52, zoom: 13, maxWidthPx: 60 })!
    expect(cramped.ticks.map((tick) => tick.labelVisible)).toEqual([true, false, true])
    expect(cramped.ticks[2].labelVisible).toBe(true)
  })

  it('shrinks the bar on a narrow map and caps it on a wide one', () => {
    expect(chooseMapScaleBarMaxWidth(1600)).toBe(200)
    expect(chooseMapScaleBarMaxWidth(480)).toBe(144)
    expect(chooseMapScaleBarMaxWidth(300)).toBe(96)
    expect(chooseMapScaleBarMaxWidth(Number.NaN)).toBe(140)
    expect(chooseMapScaleBarMaxWidth(0)).toBe(140)
  })

  it('draws nothing for a camera it cannot measure', () => {
    expect(buildMapScaleBar({ latitude: 52, zoom: Number.NaN, maxWidthPx: 140 })).toBeNull()
    expect(buildMapScaleBar({ latitude: 52, zoom: 13, maxWidthPx: 0 })).toBeNull()
  })
})
