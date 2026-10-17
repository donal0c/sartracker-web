import { distance, point } from '@turf/turf'
import { describe, expect, it } from 'vitest'

import { haversineDistanceMetres } from '../../src/lib/haversine-distance'

/** Deterministic pseudo-random sequence so the equivalence sweep is reproducible. */
function createSequence(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
    return state / 2 ** 32
  }
}

describe('haversineDistanceMetres [DON-312]', () => {
  it('returns exactly the Turf distance in metres across Ireland and the full WGS84 range', () => {
    const next = createSequence(312)
    for (let index = 0; index < 5_000; index += 1) {
      const wide = index % 2 === 0
      const lat1 = wide ? next() * 180 - 90 : 51.3 + next() * 4.2
      const lon1 = wide ? next() * 360 - 180 : -10.7 + next() * 5.0
      const lat2 = wide ? next() * 180 - 90 : lat1 + (next() - 0.5) * 0.01
      const lon2 = wide ? next() * 360 - 180 : lon1 + (next() - 0.5) * 0.01
      const expected = distance(point([lon1, lat1]), point([lon2, lat2]), { units: 'meters' })
      expect(haversineDistanceMetres(lat1, lon1, lat2, lon2)).toBe(expected)
    }
  })

  it('returns zero for identical fixes', () => {
    expect(haversineDistanceMetres(52.06, -9.5, 52.06, -9.5)).toBe(0)
  })

  it.each([
    [Number.NaN, 0, 0, 0],
    [0, Number.POSITIVE_INFINITY, 0, 0],
    [91, 0, 0, 0],
    [0, 0, -90.5, 0],
    [0, 180.1, 0, 0],
    [0, 0, 0, -181],
  ])('rejects invalid coordinates (%s, %s) → (%s, %s)', (lat1, lon1, lat2, lon2) => {
    expect(() => haversineDistanceMetres(lat1, lon1, lat2, lon2)).toThrow(/haversineDistanceMetres/)
  })
})
