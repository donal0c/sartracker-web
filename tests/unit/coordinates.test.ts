import fixture from '../fixtures/kerry-reference-points.json'
import {
  formatIrishGridReference,
  formatMapCoordinateBar,
  formatWGS84Degrees,
  wgs84ToTM65,
} from '../../src/lib/coordinates'

type FixturePoint = {
  readonly name: string
  readonly wgs84: {
    readonly lat: number
    readonly lon: number
  }
}

describe('map coordinate formatting', () => {
  it('formats WGS84 values with directional suffixes', () => {
    expect(formatWGS84Degrees(52.274681, -9.530912)).toBe('52.274681°N, 9.530912°W')
  })

  it('rejects impossible WGS84 coordinates during formatting', () => {
    expect(() => formatWGS84Degrees(95, -9.530912)).toThrow(/Invalid latitude/)
    expect(() => formatWGS84Degrees(52.274681, -190)).toThrow(/Invalid longitude/)
  })

  it('formats TM65 easting and northing as a 5 digit Irish grid reference', () => {
    expect(formatIrishGridReference(99840, 104018)).toBe('Q 99840 04018')
  })

  it('formats the combined coordinate bar string', () => {
    expect(formatMapCoordinateBar(52.274681, -9.530912)).toBe(
      '52.274681°N, 9.530912°W  |  Q 95296 14688',
    )
  })
})

describe('wgs84 to TM65 conversion', () => {
  it('converts known Kerry points into valid Irish grid references', () => {
    const points = fixture.points as FixturePoint[]

    const gridRefs = points.map((point) => {
      const [easting, northing] = wgs84ToTM65(point.wgs84.lat, point.wgs84.lon)
      return {
        name: point.name,
        ref: formatIrishGridReference(easting, northing),
      }
    })

    expect(gridRefs).toEqual([
      { name: 'Carrauntoohil Summit', ref: 'V 80011 84363' },
      { name: 'Killarney Town Centre', ref: 'V 96415 90706' },
      { name: 'Tralee Town Centre', ref: 'Q 83589 14525' },
    ])
  })
})
