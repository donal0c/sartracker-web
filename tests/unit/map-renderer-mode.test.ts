import { describe, expect, it } from 'vitest'

import { resolveMapRendererMode } from '../../src/features/map/map-renderer-mode'

describe('map renderer mode', () => {
  it('keeps MapLibre as the default renderer', () => {
    expect(resolveMapRendererMode('')).toBe('maplibre')
    expect(resolveMapRendererMode('?missionHarness=1')).toBe('maplibre')
  })

  it('enables the Leaflet fallback only through the explicit feature flag', () => {
    expect(resolveMapRendererMode('?mapRenderer=leaflet')).toBe('leaflet')
    expect(resolveMapRendererMode('?missionHarness=1&mapRenderer=leaflet')).toBe('leaflet')
  })
})
