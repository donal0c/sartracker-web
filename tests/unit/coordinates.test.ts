import fixture from '../fixtures/kerry-reference-points.json'
import {
  formatITMCoordinates,
  formatIrishGridReference,
  formatMapCoordinateBar,
  formatWGS84Dms,
  formatWGS84Degrees,
  itmToWgs84,
  parseIrishGridReference,
  tm65ToWgs84,
  wgs84ToITM,
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
      '52.274681°N, 9.530912°W  |  Q 95554 14717',
    )
  })

  it('rolls DMS seconds up instead of showing 60 seconds', () => {
    expect(formatWGS84Dms(51.97, -9.7)).toBe('51°58\'12.000"N, 9°42\'00.000"W')
  })

  it('formats ITM coordinates as rounded easting/northing pairs', () => {
    expect(formatITMCoordinates(480245.4, 584451.6)).toBe('480245, 584452')
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
      { name: 'Carrauntoohil Summit', ref: 'V 80269 84392' },
      { name: 'Killarney Town Centre', ref: 'V 96673 90735' },
      { name: 'Tralee Town Centre', ref: 'Q 83848 14554' },
    ])
  })

  it('keeps Eamonn Outdoor Active DD and TM65 references aligned', () => {
    const [easting, northing] = wgs84ToTM65(52.179337, -9.464944)

    expect(Math.round(easting)).toBe(99842)
    expect(Math.round(northing)).toBe(104015)
    expect(formatIrishGridReference(easting, northing)).toBe('Q 99842 04015')
  })
})

describe('wgs84 to ITM conversion', () => {
  it('converts the known Kerry operational points into ITM coordinates', () => {
    expect(wgs84ToITM(51.99917, -9.74406).map((value) => Math.round(value))).toEqual([
      480245,
      584452,
    ])
    expect(wgs84ToITM(52.059444, -9.507222).map((value) => Math.round(value))).toEqual([
      496646,
      590793,
    ])
    expect(wgs84ToITM(52.270868, -9.702278).map((value) => Math.round(value))).toEqual([
      483823,
      614607,
    ])
  })
})

describe('reverse Irish coordinate conversions', () => {
  it('parses Irish grid references into TM65 easting/northing coordinates', () => {
    expect(parseIrishGridReference('Q 99840 04018')).toEqual([99840, 104018])
    expect(parseIrishGridReference('v 80011 84363')).toEqual([80011, 84363])
  })

  it('converts ITM coordinates back into WGS84 within operational tolerance', () => {
    const [lat, lon] = itmToWgs84(480245, 584452)
    expect(lat).toBeCloseTo(51.99917, 4)
    expect(lon).toBeCloseTo(-9.74406, 4)
  })

  it('converts TM65 coordinates back into WGS84 within operational tolerance', () => {
    const [lat, lon] = tm65ToWgs84(80269, 84392)
    expect(lat).toBeCloseTo(51.99917, 4)
    expect(lon).toBeCloseTo(-9.74406, 4)
  })

  it('parses Eamonn Outdoor Active TM65 reference back to the reported DD point', () => {
    const [easting, northing] = parseIrishGridReference('Q 99842 04015')
    const [lat, lon] = tm65ToWgs84(easting, northing)

    expect(lat).toBeCloseTo(52.179337, 5)
    expect(lon).toBeCloseTo(-9.464944, 5)
  })
})
