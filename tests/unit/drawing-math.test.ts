import { describe, expect, it } from 'vitest'

import {
  calculateSectorArcLength,
  formatDistance,
  geodesicBearing,
  geodesicBearingEndpoint,
  geodesicCirclePoints,
  geodesicDistance,
  geodesicSectorPoints,
  magneticToTrue,
  trueToMagnetic,
} from '../../src/features/drawings/drawing-math'

describe('drawing geodesic math', () => {
  it('round-trips magnetic and true bearings using fixed -4.5 declination', () => {
    expect(magneticToTrue(90)).toBeCloseTo(94.5, 5)
    expect(trueToMagnetic(94.5)).toBeCloseTo(90, 5)
  })

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
})
