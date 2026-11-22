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
import { createMarkerDraftAtCoordinate } from '../../src/features/markers/marker-draft'

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

  it('formats lower-precision Irish grid references by truncating, not padding or rounding', () => {
    expect(formatIrishGridReference(99_842, 104_015, 5)).toBe('Q 99842 04015')
    expect(formatIrishGridReference(99_842, 104_015, 4)).toBe('Q 9984 0401')
    expect(formatIrishGridReference(99_842, 104_015, 3)).toBe('Q 998 040')
    expect(formatIrishGridReference(99_842, 104_015, 2)).toBe('Q 99 04')
    expect(formatIrishGridReference(99_842, 104_015, 1)).toBe('Q 9 0')
  })

  it('formats the combined coordinate bar string', () => {
    expect(formatMapCoordinateBar(52.274681, -9.530912)).toBe(
      '52.274681°N, 9.530912°W  |  Q 95553 14716',
    )
  })

  it('formats impossible live coordinate bar values as a safe placeholder', () => {
    expect(formatMapCoordinateBar(95, -190)).toBe('—')
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
      { name: 'Killarney Town Centre', ref: 'V 96673 90734' },
      { name: 'Tralee Town Centre', ref: 'Q 83847 14553' },
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
    expect(parseIrishGridReference('v 80269 84392')).toEqual([80269, 84392])
  })

  it('parses coarse Irish grid references to the centre of their represented square', () => {
    expect(parseIrishGridReference('V 8 8')).toEqual([85_000, 85_000])
    expect(parseIrishGridReference('V 80 84')).toEqual([80_500, 84_500])
    expect(parseIrishGridReference('V 802 843')).toEqual([80_250, 84_350])
    expect(parseIrishGridReference('V 8026 8439')).toEqual([80_265, 84_395])
    expect(parseIrishGridReference('V 80269 84392')).toEqual([80_269, 84_392])
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
    expect(() => itmToWgs84(778_000, 860_000)).toThrow(RangeError)
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

  it('still accepts Wicklow Head on the east coast (ITM E≈734629)', () => {
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
    expect(() => wgs84ToTM65(52.9577, -5.9962)).not.toThrow() // Wicklow Head (east coast)
  })

  it('keeps wgs84ToITM and formatITMCoordinates mutually consistent for Irish extremes', () => {
    // Invariant: any point accepted by wgs84ToITM must also format without throwing.
    // The ITM bounds envelope the WGS84 box precisely to preserve this.
    for (const [lat, lon] of [
      [55.4339, -7.2406], // Inishtrahull, northernmost
      [52.9577, -5.9962], // Wicklow Head, east coast
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

describe('Irish envelope covers the Co. Down coast east of -5.8°E (DON-351 / M-03)', () => {
  // Independent reference points on the Ards Peninsula and Copeland Islands, Co. Down.
  // ITM values are proj4 EPSG:2157 transforms of the published WGS84 positions.
  const coDownPoints = [
    { name: 'Burr Point, easternmost point of the island', lat: 54.4834, lon: -5.4331, easting: 766_322, northing: 862_471 },
    { name: 'Portaferry, Strangford Lough narrows', lat: 54.3826, lon: -5.5497, easting: 759_159, northing: 850_986 },
    { name: 'Copeland Islands', lat: 54.67, lon: -5.532, easting: 759_186, northing: 883_003 },
  ] as const

  for (const point of coDownPoints) {
    it(`accepts and converts ${point.name}`, () => {
      expect(isWithinIreland(point.lat, point.lon)).toBe(true)

      const [easting, northing] = wgs84ToITM(point.lat, point.lon)
      expect(Math.abs(easting - point.easting)).toBeLessThan(5)
      expect(Math.abs(northing - point.northing)).toBeLessThan(5)
      expect(() => formatITMCoordinates(easting, northing)).not.toThrow()

      const [tm65Easting, tm65Northing] = wgs84ToTM65(point.lat, point.lon)
      const gridRef = formatIrishGridReference(tm65Easting, tm65Northing)
      expect(gridRef).toMatch(/^J \d{5} \d{5}$/)
      const [parsedEasting, parsedNorthing] = parseIrishGridReference(gridRef)
      const [lat, lon] = tm65ToWgs84(parsedEasting, parsedNorthing)
      expect(lat).toBeCloseTo(point.lat, 4)
      expect(lon).toBeCloseTo(point.lon, 4)

      const [backLat, backLon] = itmToWgs84(easting, northing)
      expect(backLat).toBeCloseTo(point.lat, 6)
      expect(backLon).toBeCloseTo(point.lon, 6)
    })
  }

  it('lets a casualty marker be placed at Burr Point', () => {
    expect(() => createMarkerDraftAtCoordinate(54.4834, -5.4331, 'casualty')).not.toThrow()
  })

  it('keeps every coordinate isWithinIreland accepts inside the ITM range (containment invariant)', () => {
    // Envelope-agnostic sweep: walk past every edge of any plausible box, and require that
    // each accepted WGS84 point projects to an ITM pair that also validates and formats.
    const failures: string[] = []
    const check = (lat: number, lon: number): void => {
      if (!isWithinIreland(lat, lon)) {
        return
      }
      try {
        const [easting, northing] = wgs84ToITM(lat, lon)
        formatITMCoordinates(easting, northing)
        itmToWgs84(easting, northing)
      } catch (error) {
        failures.push(`${lat.toFixed(3)},${lon.toFixed(3)}: ${String(error)}`)
      }
    }
    for (let lat = 51.0; lat <= 56.0; lat += 0.01) {
      for (const lon of [-11, -10.8, -10.79, -5.81, -5.5, -5.4, -5.35, -5.31, -5.3, -5.29, -5.0]) {
        check(lat, lon)
      }
    }
    for (let lon = -11.0; lon <= -4.5; lon += 0.01) {
      for (const lat of [51.0, 51.3, 51.31, 53.99, 54.0, 54.01, 54.94, 54.95, 54.96, 55.59, 55.6, 56.0]) {
        check(lat, lon)
      }
    }
    expect(failures).toEqual([])
  })

  it('still rejects the Irish Sea beyond the Co. Down coast, the Isle of Man and non-finite input', () => {
    expect(isWithinIreland(54.4834, -5.0)).toBe(false)
    expect(() => wgs84ToITM(54.2, -4.5)).toThrow(RangeError) // Isle of Man
    expect(() => wgs84ToITM(53.4, -3.0)).toThrow(RangeError) // Liverpool
    expect(() => wgs84ToITM(Number.NaN, -5.4331)).toThrow(RangeError)
    expect(() => wgs84ToITM(54.4834, Number.POSITIVE_INFINITY)).toThrow(RangeError)
    expect(() => itmToWgs84(800_000, 862_471)).toThrow(RangeError)
    expect(() => formatITMCoordinates(0, 0)).toThrow(RangeError)
  })
})

describe('Irish envelope does not take in Wales or Scotland (DON-351 review)', () => {
  // Published WGS84 positions; ITM / TM65 values are proj4 transforms of them.
  const notIreland = [
    { name: 'Ramsey Island, Wales', lat: 51.86, lon: -5.34, itm: [783_204, 570_879], tm65: [383_294, 70_818] },
    { name: "St David's Head, Wales", lat: 51.9, lon: -5.31, itm: [785_106, 575_404], tm65: [385_196, 75_344] },
    { name: "St David's, Wales", lat: 51.882, lon: -5.27, itm: [787_933, 573_504], tm65: [388_023, 73_444] },
    { name: 'Campbeltown, Kintyre', lat: 55.425, lon: -5.605, itm: [751_599, 966_850], tm65: [351_679, 466_874] },
    { name: 'Sanda Island, Kintyre', lat: 55.28, lon: -5.58, itm: [753_742, 950_769], tm65: [353_823, 450_790] },
    { name: 'West shore of Arran', lat: 55.55, lon: -5.37, itm: [765_944, 981_296], tm65: [366_027, 481_323] },
    { name: 'Corsewall Point, Rhins of Galloway', lat: 55.01, lon: -5.16, itm: [781_640, 921_737], tm65: [381_727, 421_751] },
    { name: 'Portpatrick, Rhins of Galloway', lat: 54.84, lon: -5.12, itm: [784_976, 902_928], tm65: [385_064, 402_939] },
    { name: 'Isle of Man west coast', lat: 54.2, lon: -4.8, itm: [808_764, 832_628], tm65: [408_857, 332_623] },
  ] as const

  for (const point of notIreland) {
    it(`rejects ${point.name} on every transform path`, () => {
      expect(isWithinIreland(point.lat, point.lon)).toBe(false)
      expect(() => wgs84ToITM(point.lat, point.lon)).toThrow(RangeError)
      expect(() => wgs84ToTM65(point.lat, point.lon)).toThrow(RangeError)
      expect(() => itmToWgs84(point.itm[0], point.itm[1])).toThrow(RangeError)
      expect(() => tm65ToWgs84(point.tm65[0], point.tm65[1])).toThrow(RangeError)
    })
  }

  it('rejects the Welsh, Arran and Rhins ITM pairs when formatting ITM output', () => {
    for (const point of notIreland.filter((candidate) => !candidate.name.startsWith('Campbeltown') && !candidate.name.startsWith('Sanda'))) {
      expect(() => formatITMCoordinates(point.itm[0], point.itm[1]), point.name).toThrow(RangeError)
    }
  })

  it('still accepts the whole Co. Down coast east of -5.8°', () => {
    for (const [lat, lon] of [
      [54.226, -5.66], // St John's Point
      [54.32, -5.49], // Ballyquintin Point, southern tip of the Ards
      [54.4834, -5.4331], // Burr Point
      [54.67, -5.532], // Copeland Islands
      [54.766, -5.687], // Black Head, Islandmagee
    ] as const) {
      expect(isWithinIreland(lat, lon)).toBe(true)
      const [easting, northing] = wgs84ToITM(lat, lon)
      expect(() => itmToWgs84(easting, northing)).not.toThrow()
      const [tm65Easting, tm65Northing] = wgs84ToTM65(lat, lon)
      expect(() => tm65ToWgs84(tm65Easting, tm65Northing)).not.toThrow()
    }
  })

  it('never returns a position outside the Irish envelope from itmToWgs84 or tm65ToWgs84', () => {
    const escaped: string[] = []
    for (let easting = 400_000; easting < 800_000; easting += 2_500) {
      for (let northing = 500_000; northing < 990_000; northing += 2_500) {
        try {
          const [lat, lon] = itmToWgs84(easting, northing)
          if (!isWithinIreland(lat, lon)) {
            escaped.push(`ITM ${easting},${northing}`)
          }
        } catch {
          // Rejected input is the expected outcome outside Ireland.
        }
        try {
          const [lat, lon] = tm65ToWgs84(easting - 400_000, northing - 500_000)
          if (!isWithinIreland(lat, lon)) {
            escaped.push(`TM65 ${easting - 400_000},${northing - 500_000}`)
          }
        } catch {
          // Rejected input is the expected outcome outside Ireland.
        }
      }
    }
    expect(escaped.slice(0, 10)).toEqual([])
  })
})
