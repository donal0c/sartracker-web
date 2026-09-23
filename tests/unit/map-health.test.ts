import {
  createDegradedMapHealth,
  createLoadingMapHealth,
  createMapOverlaySyncWarning,
  createReadyMapHealth,
} from '../../src/lib/map-health'

describe('map health messages', () => {
  it('describes the loading state clearly', () => {
    expect(createLoadingMapHealth('OpenTopoMap')).toEqual({
      status: 'loading',
      message: 'Loading OpenTopoMap basemap',
    })
  })

  it('describes the ready state clearly', () => {
    expect(createReadyMapHealth('OpenTopoMap')).toEqual({
      status: 'ready',
      message: 'OpenTopoMap basemap ready',
    })
  })

  it('describes degraded state with a default detail', () => {
    expect(createDegradedMapHealth('ESRI World Topo')).toEqual({
      status: 'degraded',
      message: 'ESRI World Topo degraded: Some tiles failed to load',
    })
  })

  it('supports explicit degradation details', () => {
    expect(createDegradedMapHealth('OpenStreetMap', 'WebGL context lost')).toEqual({
      status: 'degraded',
      message: 'OpenStreetMap degraded: WebGL context lost',
    })
  })

  it('creates a sanitized, family-specific warning with existing recovery guidance', () => {
    expect(createMapOverlaySyncWarning('markers', 'markers')).toEqual({
      registrationId: 'markers',
      family: 'markers',
      message: expect.stringMatching(/Markers overlay may be missing or stale.*retrying.*independent operational source.*Diagnostics/iu),
    })
  })
})
