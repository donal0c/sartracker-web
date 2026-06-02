import { describe, expect, it } from 'vitest'

import { createCoordinateTargetLayerSpecs } from '../../src/features/map/use-map-location-target'

describe('coordinate target map styling', () => {
  it('uses a prominent red ring and crosshair-style center over map tiles', () => {
    const { ringLayer, dotLayer } = createCoordinateTargetLayerSpecs()

    expect(ringLayer.paint['circle-radius']).toBeGreaterThanOrEqual(26)
    expect(ringLayer.paint['circle-stroke-color']).toBe('#EF4444')
    expect(ringLayer.paint['circle-stroke-width']).toBeGreaterThanOrEqual(4)
    expect(dotLayer.paint['circle-color']).toBe('#DC2626')
    expect(dotLayer.paint['circle-stroke-color']).toBe('#FFFFFF')
    expect(dotLayer.paint['circle-stroke-width']).toBeGreaterThanOrEqual(3)
  })
})
