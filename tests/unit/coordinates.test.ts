import fixture from '../fixtures/kerry-reference-points.json'
import {
  formatITMCoordinates,
  formatIrishGridReference,
  formatMapCoordinateBar,
  formatWGS84Dms,
  formatWGS84Degrees,
  isWithinIreland,
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

describe('ITM input range guards (DON-168 / B2-C3)', () => {
  // itmToWgs84(0, 0) — GPS zero-fill fault — back-projects to the Atlantic ~700 km
  // from Ireland but is a globally valid WGS84 point, so it passed silently.
  it('rejects the GPS zero-fill (0, 0) fault coordinate', () => {
    expect(() => itmToWgs84(0, 0)).toThrow(RangeError)
  })

  it('rejects ITM easting below the Irish extent', () => {
    expect(() => itmToWgs84(390_000, 600_000)).toThrow(RangeError)
  })

  it('rejects ITM easting at/above the Irish extent', () => {
    expect(() => itmToWgs84(760_000, 600_000)).toThrow(RangeError)
  })

  it('rejects ITM northing below the Irish extent', () => {
    expect(() => itmToWgs84(600_000, 490_000)).toThrow(RangeError)
  })

  it('rejects ITM northing at/above the Irish extent', () => {
    expect(() => itmToWgs84(600_000, 990_000)).toThrow(RangeError)
  })

  it('still round-trips the Carrauntoohil golden point', () => {
    const [lat, lon] = itmToWgs84(480245, 584452)
    expect(lat).toBeCloseTo(51.99917, 4)
    expect(lon).toBeCloseTo(-9.74406, 4)
  })

  it('still accepts the south-westernmost island (Skellig Michael) ITM extent', () => {
    // Skellig Michael ~ E=424852, N=560681. The issue's proposed 480000 floor would
    // have wrongly rejected this real Irish rescue location — guard must not.
    expect(() => itmToWgs84(424_852, 560_681)).not.toThrow()
  })

  it('still accepts Inishtrahull, the northernmost Irish island (ITM N≈965951)', () => {
    // The ITM box must envelope the WGS84 box: Inishtrahull passes isWithinIreland, so
    // its ITM coordinate must also be accepted. A too-low N ceiling silently rejected it.
    expect(() => itmToWgs84(648_222, 965_951)).not.toThrow()
  })

  it('still accepts Wicklow Head, the eastern extreme (ITM E≈734629)', () => {
    expect(() => itmToWgs84(734_629, 691_537)).not.toThrow()
  })
})

describe('ITM output formatting guards (DON-171 / B2-COORD02)', () => {
  it('rejects an offshore-derived ITM pair', () => {
    // Bay of Biscay (50, -9) -> ITM ~ [528318, 361130]; northing far south of Ireland.
    expect(() => formatITMCoordinates(528318, 361130)).toThrow(RangeError)
  })

  it('rejects the zero-fill (0, 0) ITM pair', () => {
    expect(() => formatITMCoordinates(0, 0)).toThrow(RangeError)
  })

  it('still formats a valid Kerry ITM pair', () => {
    expect(formatITMCoordinates(480245.4, 584451.6)).toBe('480245, 584452')
  })
})

describe('Irish geographic bounds for transform inputs (DON-171 / B2-C1, B2-C2)', () => {
  it('rejects a Bay of Biscay WGS84 point in wgs84ToITM', () => {
    expect(() => wgs84ToITM(50, -9)).toThrow(RangeError)
  })

  it('rejects the zero-fill (0, 0) WGS84 point in wgs84ToITM', () => {
    expect(() => wgs84ToITM(0, 0)).toThrow(RangeError)
  })

  it('rejects an Atlantic WGS84 point in wgs84ToTM65', () => {
    // ~37 km west of Waterville, Co. Kerry, well out to sea but inside global WGS84.
    expect(() => wgs84ToTM65(52, -12.5)).toThrow(RangeError)
  })

  it('still converts every Kerry golden point through wgs84ToTM65 and wgs84ToITM', () => {
    const points = fixture.points as FixturePoint[]
    for (const point of points) {
      expect(() => wgs84ToTM65(point.wgs84.lat, point.wgs84.lon)).not.toThrow()
      expect(() => wgs84ToITM(point.wgs84.lat, point.wgs84.lon)).not.toThrow()
    }
  })

  it('still converts the OSI verification points (Dublin, Carrauntoohil, Galway)', () => {
    expect(() => wgs84ToITM(53.349, -6.26)).not.toThrow() // Dublin GPO
    expect(() => wgs84ToITM(51.99917, -9.74406)).not.toThrow() // Carrauntoohil
    expect(() => wgs84ToITM(53.2707, -9.0568)).not.toThrow() // Galway
  })

  it('still accepts the south-west island and northern extremes', () => {
    expect(() => wgs84ToTM65(51.771, -10.538)).not.toThrow() // Skellig Michael
    expect(() => wgs84ToTM65(55.381, -7.374)).not.toThrow() // Malin Head
    expect(() => wgs84ToTM65(55.4339, -7.2406)).not.toThrow() // Inishtrahull (northernmost island)
    expect(() => wgs84ToTM65(52.9577, -5.9962)).not.toThrow() // Wicklow Head (eastern extreme)
  })

  it('keeps wgs84ToITM and formatITMCoordinates mutually consistent for Irish extremes', () => {
    // Invariant: any point accepted by wgs84ToITM must also format without throwing.
    // The ITM bounds envelope the WGS84 box precisely to preserve this.
    for (const [lat, lon] of [
      [55.4339, -7.2406], // Inishtrahull, northernmost
      [52.9577, -5.9962], // Wicklow Head, easternmost
      [51.771, -10.538], // Skellig Michael, south-west island
      [51.3903, -9.6018], // Fastnet Rock, southern
    ] as const) {
      const [easting, northing] = wgs84ToITM(lat, lon)
      expect(() => formatITMCoordinates(easting, northing)).not.toThrow()
    }
  })

  it('documents the residual near-coast limitation (B2-C1)', () => {
    // A bounding box cannot separate near-coast sea from outlying islands: a point a few
    // dozen km off the Kerry coast lies inside the same rectangle as Tearaght Island, so
    // it is NOT rejected. This is an accepted, documented limitation of the bbox approach;
    // genuinely distant offshore inputs (Bay of Biscay, mid-Atlantic) are still caught.
    expect(() => wgs84ToTM65(52, -10.5)).not.toThrow()
  })
})

describe('isWithinIreland predicate (non-throwing, for live display)', () => {
  it('returns true for an on-land Irish point', () => {
    expect(isWithinIreland(51.99917, -9.74406)).toBe(true)
  })

  it('returns true for the south-west island extreme (Skellig Michael)', () => {
    expect(isWithinIreland(51.771, -10.538)).toBe(true)
  })

  it('returns false for the Bay of Biscay', () => {
    expect(isWithinIreland(50, -9)).toBe(false)
  })

  it('returns false for the zero-fill back-projection (Atlantic)', () => {
    expect(isWithinIreland(46.488, -15.817)).toBe(false)
  })

  it('does not throw on out-of-range or non-finite input (hot-path safe)', () => {
    expect(() => isWithinIreland(Number.NaN, Number.NaN)).not.toThrow()
    expect(isWithinIreland(Number.NaN, Number.NaN)).toBe(false)
    expect(isWithinIreland(95, 200)).toBe(false)
  })
})
