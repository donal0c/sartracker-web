import { describe, expect, it } from 'vitest'

import {
  calculateSectorArcLength,
  formatDistance,
  geodesicBearing,
  geodesicBearingEndpoint,
  geodesicCirclePoints,
  geodesicDistance,
  geodesicPolygonArea,
  geodesicSectorPoints,
  MAX_GEODESIC_DISTANCE_M,
  MAX_GEODESIC_SEGMENTS,
  magneticToTrue,
  trueToMagnetic,
} from '../../src/features/drawings/drawing-math'

describe('drawing geodesic math', () => {
  it('round-trips magnetic and true bearings using fixed -4.5 declination', () => {
    expect(magneticToTrue(90)).toBeCloseTo(94.5, 5)
    expect(trueToMagnetic(94.5)).toBeCloseTo(90, 5)
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -0.001, 360.001])(
    'rejects unsafe public bearing conversion input: %s',
    (bearing) => {
      expect(() => magneticToTrue(bearing)).toThrow(RangeError)
      expect(() => trueToMagnetic(bearing)).toThrow(RangeError)
    },
  )

  it('computes a near-1km northward endpoint correctly', () => {
    const [lon, lat] = geodesicBearingEndpoint(-9.744, 51.999, 0, 1000)
    expect(lon).toBeCloseTo(-9.744, 2)
    expect(geodesicDistance(-9.744, 51.999, lon, lat)).toBeCloseTo(1000, -1)
  })

  it('computes bearings in the expected quadrant', () => {
    expect(geodesicBearing(-9.744, 51.999, -9.734, 52.009)).toBeGreaterThan(0)
    expect(geodesicBearing(-9.744, 51.999, -9.734, 52.009)).toBeLessThan(90)
  })

  it('creates geodesic circle points at the target radius', () => {
    const points = geodesicCirclePoints(-9.744, 51.999, 1000, 16)
    expect(points).toHaveLength(17)
    expect(geodesicDistance(-9.744, 51.999, points[4][0], points[4][1])).toBeCloseTo(1000, -1)
  })

  it('calculates sector arc length including wrap-around edge cases', () => {
    expect(calculateSectorArcLength(350, 10)).toBe(20)
    expect(calculateSectorArcLength(45, 45)).toBe(0)
    expect(calculateSectorArcLength(0, 360)).toBe(360)
  })

  it('creates sector polygons that start and end at the center', () => {
    const points = geodesicSectorPoints(-9.744, 51.999, 0, 90, 1000, 8)
    expect(points[0]).toEqual([-9.744, 51.999])
    expect(points.at(-1)).toEqual([-9.744, 51.999])
  })

  it('formats distances cleanly for labels', () => {
    expect(formatDistance(250)).toBe('250 m')
    expect(formatDistance(1250)).toBe('1.25 km')
  })

  it('rejects distances beyond the physically meaningful WGS84 half-circumference', () => {
    const oversizedDistance = MAX_GEODESIC_DISTANCE_M + 1

    expect(() => geodesicBearingEndpoint(-9.744, 51.999, 0, oversizedDistance)).toThrow(RangeError)
    expect(() => geodesicCirclePoints(-9.744, 51.999, oversizedDistance)).toThrow(RangeError)
    expect(() => geodesicSectorPoints(-9.744, 51.999, 0, 90, oversizedDistance)).toThrow(RangeError)
    expect(() => formatDistance(oversizedDistance)).toThrow(RangeError)
  })

  it('calculates small polygon areas correctly across the antimeridian', () => {
    const area = geodesicPolygonArea([
      [179.9, 10],
      [-179.9, 10],
      [-179.9, 10.1],
      [179.9, 10.1],
    ])

    expect(area).toBeGreaterThan(0)
    expect(area).toBeLessThan(300_000_000)
  })
})

describe('drawing-math adversarial safety guards (DON-167 / B2 sweep)', () => {
  // DON-169 — geodesicSectorPoints / geodesicCirclePoints must reject non-positive radius.
  // A negative radiusM mirrors the entire sector across the origin (~10 km displacement)
  // with no visual indication, sending a team in the wrong direction.
  describe('DON-169: non-positive radius guards', () => {
    it('throws when geodesicSectorPoints is given a negative radius', () => {
      expect(() => geodesicSectorPoints(-9.5, 52.0, 30, 60, -5000, 36)).toThrow(RangeError)
    })

    it('throws when geodesicSectorPoints is given a zero radius', () => {
      expect(() => geodesicSectorPoints(-9.5, 52.0, 30, 60, 0, 36)).toThrow(RangeError)
    })

    it('throws when geodesicCirclePoints is given a negative radius', () => {
      expect(() => geodesicCirclePoints(-9.5, 52.0, -1000, 64)).toThrow(RangeError)
    })

    it('throws when geodesicCirclePoints is given a zero radius', () => {
      expect(() => geodesicCirclePoints(-9.5, 52.0, 0, 64)).toThrow(RangeError)
    })

    it('still produces a valid sector for a positive radius after the guard', () => {
      const points = geodesicSectorPoints(-9.5, 52.0, 30, 60, 5000, 36)
      // 36 arc points (index 0..36 = 37) + leading center + trailing center close = 39
      expect(points).toHaveLength(39)
      expect(points[0]).toEqual([-9.5, 52.0])
      expect(points.at(-1)).toEqual([-9.5, 52.0])
      for (const [lon, lat] of points) {
        expect(lon).toBeGreaterThan(-10.7)
        expect(lon).toBeLessThan(-5.9)
        expect(lat).toBeGreaterThan(51.3)
        expect(lat).toBeLessThan(55.5)
      }
    })
  })

  // DON-170 — calculateSectorArcLength(360, 0) must return 360, not 0.
  // 360→0 is a natural way to express a full search circle; returning 0 makes the
  // entire search area silently invisible on the map.
  describe('DON-170: full-circle arc length boundary', () => {
    it('returns 360 for a (360, 0) full circle (regression)', () => {
      expect(calculateSectorArcLength(360, 0)).toBe(360)
    })

    it('returns 360 for a (0, 360) full circle', () => {
      expect(calculateSectorArcLength(0, 360)).toBe(360)
    })

    it('treats (360, 360) as a zero-arc (consistent with (0, 0)), not a full circle', () => {
      // Both normalise to 0 with a raw difference of 0 — a zero-length sweep.
      // A full circle is expressed as 0→360 or 360→0, never 360→360.
      expect(calculateSectorArcLength(360, 360)).toBe(0)
    })

    it('returns 0 for a genuine zero-arc (0, 0)', () => {
      expect(calculateSectorArcLength(0, 0)).toBe(0)
    })

    it('returns 0 for a genuine zero-arc (45, 45)', () => {
      expect(calculateSectorArcLength(45, 45)).toBe(0)
    })

    it('handles the normal half-circle case (90, 270)', () => {
      expect(calculateSectorArcLength(90, 270)).toBe(180)
    })

    it('handles the wrapping half-circle case (270, 90)', () => {
      expect(calculateSectorArcLength(270, 90)).toBe(180)
    })

    it('produces a non-degenerate full-circle polygon when start=360, end=0', () => {
      const points = geodesicSectorPoints(-9.5, 52.0, 360, 0, 5000, 36)
      const area = geodesicPolygonArea(points)
      expect(area).toBeGreaterThan(0)
    })
  })

  // DON-173 — geodesicBearingEndpoint must reject a negative distance.
  // A negative distance reflects the endpoint to the opposite side of the origin.
  describe('DON-173: negative distance guard on geodesicBearingEndpoint', () => {
    it('throws on a clearly negative distance', () => {
      expect(() => geodesicBearingEndpoint(-8.0, 53.0, 0, -1000)).toThrow(RangeError)
    })

    it('throws on a small negative distance', () => {
      expect(() => geodesicBearingEndpoint(-8.0, 53.0, 0, -0.001)).toThrow(RangeError)
    })

    it('returns the origin for a zero distance', () => {
      const [lon, lat] = geodesicBearingEndpoint(-8.0, 53.0, 0, 0)
      expect(lon).toBeCloseTo(-8.0, 9)
      expect(lat).toBeCloseTo(53.0, 9)
    })

    it('places a positive-distance endpoint north of the origin', () => {
      const [, lat] = geodesicBearingEndpoint(-8.0, 53.0, 0, 1000)
      expect(lat).toBeGreaterThan(53.0)
      expect(lat).toBeCloseTo(53.009, 2)
    })
  })

  // DON-174 — geodesicBearing must return null when origin == destination.
  // The bearing is genuinely undefined for a zero-length vector; returning 0 (north)
  // misrepresents a stationary device as heading north.
  describe('DON-174: degenerate bearing returns null', () => {
    it('returns null when origin and destination are identical', () => {
      expect(geodesicBearing(-8.0, 53.0, -8.0, 53.0)).toBeNull()
    })

    it('returns a valid bearing for a nearby distinct point', () => {
      const bearing = geodesicBearing(-8.0, 53.0, -8.0001, 53.0)
      expect(bearing).not.toBeNull()
      expect(bearing).toBeGreaterThanOrEqual(0)
      expect(bearing).toBeLessThan(360)
    })
  })

  describe('GEO-002: public geometry boundaries reject unsafe numeric input', () => {
    it.each([
      ['NaN longitude', Number.NaN, 52],
      ['infinite longitude', Number.POSITIVE_INFINITY, 52],
      ['longitude below WGS84 range', -180.001, 52],
      ['longitude above WGS84 range', 180.001, 52],
      ['NaN latitude', -9.5, Number.NaN],
      ['infinite latitude', -9.5, Number.NEGATIVE_INFINITY],
      ['latitude below WGS84 range', -9.5, -90.001],
      ['latitude above WGS84 range', -9.5, 90.001],
    ])('rejects %s at the geodesic bearing boundary', (_label, lon, lat) => {
      expect(() => geodesicBearing(lon, lat, -9.4, 52.1)).toThrow(RangeError)
      expect(() => geodesicDistance(lon, lat, -9.4, 52.1)).toThrow(RangeError)
      expect(() => geodesicBearingEndpoint(lon, lat, 90, 1_000)).toThrow(RangeError)
      expect(() => geodesicCirclePoints(lon, lat, 1_000)).toThrow(RangeError)
      expect(() => geodesicSectorPoints(lon, lat, 0, 90, 1_000)).toThrow(RangeError)
    })

    it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -0.001, 360.001])(
      'rejects invalid destination bearings: %s',
      (bearing) => {
        expect(() => geodesicBearingEndpoint(-9.5, 52, bearing, 1_000)).toThrow(RangeError)
      },
    )

    it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -0.001])(
      'rejects invalid endpoint distances: %s',
      (distanceM) => {
        expect(() => geodesicBearingEndpoint(-9.5, 52, 90, distanceM)).toThrow(RangeError)
      },
    )

    it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 0, -1])(
      'rejects invalid circle radii: %s',
      (radiusM) => {
        expect(() => geodesicCirclePoints(-9.5, 52, radiusM)).toThrow(RangeError)
        expect(() => geodesicSectorPoints(-9.5, 52, 0, 90, radiusM)).toThrow(RangeError)
      },
    )

    it.each([
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      0,
      -1,
      1.5,
      MAX_GEODESIC_SEGMENTS + 1,
    ])('rejects invalid circle segment counts: %s', (segments) => {
      expect(() => geodesicCirclePoints(-9.5, 52, 1_000, segments)).toThrow(RangeError)
      expect(() => geodesicSectorPoints(-9.5, 52, 0, 90, 1_000, segments)).toThrow(RangeError)
    })

    it('retains the documented zero-distance endpoint behavior', () => {
      expect(geodesicBearingEndpoint(-9.5, 52, 90, 0)).toEqual([-9.5, 52])
    })

    it('does not let segments=Infinity hang the main test runner', async () => {
      const result = await runInfinityProbe()

      expect(result.timedOut).toBe(false)
      expect(result.exitCode).toBe(0)
      expect(result.signal).toBeNull()
    })
  })
})

async function runInfinityProbe(): Promise<{
  readonly timedOut: boolean
  readonly exitCode: number | null
  readonly signal: string | null
}> {
  const { spawn } = await import('node:child_process')
  const child = spawn(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
        import { readFileSync } from 'node:fs'
        import ts from 'typescript'
        const source = readFileSync('src/features/drawings/drawing-math.ts', 'utf8')
        const compiled = ts.transpileModule(source, {
          compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
        }).outputText
        const module = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'))
        try {
          module.geodesicCirclePoints(-9.5, 52, 1_000, Number.POSITIVE_INFINITY)
          process.exitCode = 1
        } catch (error) {
          process.exitCode = error instanceof RangeError ? 0 : 2
        }
      `,
    ],
    { cwd: process.cwd(), stdio: 'ignore' },
  )

  return new Promise((resolve) => {
    let timedOut = false
    const timeout = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, 3_000)

    child.once('exit', (exitCode, signal) => {
      clearTimeout(timeout)
      resolve({ timedOut, exitCode, signal })
    })
  })
}
