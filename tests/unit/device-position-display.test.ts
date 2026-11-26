import { describe, expect, it } from 'vitest'

import fixture from '../fixtures/kerry-reference-points.json'
import { formatDevicePositionDisplay } from '../../src/features/tracking/device-position-display'

type FixturePoint = { readonly name: string; readonly wgs84: { readonly lat: number; readonly lon: number } }

const points = fixture.points as FixturePoint[]

function fixturePoint(name: string): FixturePoint {
  const point = points.find((candidate) => candidate.name === name)
  if (point === undefined) throw new Error(`Missing golden fixture point ${name}`)
  return point
}

describe('formatDevicePositionDisplay [DON-377]', () => {
  it('shows the golden Irish Grid reference first and lat/lon beneath', () => {
    const { lat, lon } = fixturePoint('Carrauntoohil Summit').wgs84

    expect(formatDevicePositionDisplay(lat, lon)).toEqual({
      kind: 'irish_grid',
      primary: 'V 80269 84392',
      secondary: '51.99917, -9.74406',
    })
  })

  it('matches every Kerry golden fixture point', () => {
    const grids = points.map((point) => formatDevicePositionDisplay(point.wgs84.lat, point.wgs84.lon).primary)

    expect(grids).toEqual(['V 80269 84392', 'V 96673 90734', 'Q 83847 14553'])
  })

  it('says Outside Ireland, never a grid reference, for a position off Ireland', () => {
    expect(formatDevicePositionDisplay(48.8566, 2.3522)).toEqual({
      kind: 'outside_ireland',
      primary: 'Outside Ireland',
      secondary: '48.85660, 2.35220',
    })
  })

  it('says No position when the device has none', () => {
    expect(formatDevicePositionDisplay(null, null)).toEqual({ kind: 'no_position', primary: 'No position', secondary: null })
    expect(formatDevicePositionDisplay(51.99917, null)).toEqual({ kind: 'no_position', primary: 'No position', secondary: null })
    expect(formatDevicePositionDisplay(null, -9.74406)).toEqual({ kind: 'no_position', primary: 'No position', secondary: null })
  })

  it.each([
    [Number.NaN, -9.7],
    [52, Number.POSITIVE_INFINITY],
    [91, -9.7],
    [52, -181],
  ])('says the position cannot be read, never a made-up grid, for %s, %s', (lat, lon) => {
    const display = formatDevicePositionDisplay(lat, lon)

    expect(display.kind).toBe('unreadable')
    expect(display.primary).toBe('Position unreadable')
    expect(display.secondary).toBeNull()
  })
})
