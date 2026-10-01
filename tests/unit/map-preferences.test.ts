import {
  BASEMAP_STORAGE_KEY,
  persistBasemapPreference,
  readStoredBasemap,
  readStoredMapPreference,
} from '../../src/lib/map-preferences'

describe('stored map preference for startup restore [DON-304]', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('returns a stored official map so startup can restore it once its package is verified', () => {
    window.localStorage.setItem(BASEMAP_STORAGE_KEY, 'official_discovery_topo')

    expect(readStoredMapPreference()).toBe('official_discovery_topo')
  })

  it('returns a stored public map and nothing for an empty or unknown preference', () => {
    window.localStorage.setItem(BASEMAP_STORAGE_KEY, 'openstreetmap')
    expect(readStoredMapPreference()).toBe('openstreetmap')

    window.localStorage.setItem(BASEMAP_STORAGE_KEY, 'official_unknown_map')
    expect(readStoredMapPreference()).toBeNull()

    window.localStorage.clear()
    expect(readStoredMapPreference()).toBeNull()
  })
})

describe('map preference persistence', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('falls back to the default basemap when nothing is stored', () => {
    expect(readStoredBasemap()).toBe('opentopomap')
  })

  it('ignores invalid stored basemap ids', () => {
    window.localStorage.setItem(BASEMAP_STORAGE_KEY, 'unknown-map')

    expect(readStoredBasemap()).toBe('opentopomap')
  })

  it('does not restore official maps before local source configuration is known', () => {
    window.localStorage.setItem(BASEMAP_STORAGE_KEY, 'official_discovery_topo')

    expect(readStoredBasemap()).toBe('opentopomap')
  })

  it('persists the selected basemap when storage is available', () => {
    persistBasemapPreference('openstreetmap')

    expect(window.localStorage.getItem(BASEMAP_STORAGE_KEY)).toBe('openstreetmap')
  })

  it('falls back safely when localStorage access throws', () => {
    const getItem = vi.fn(() => {
      throw new Error('blocked')
    })
    const setItem = vi.fn(() => {
      throw new Error('blocked')
    })

    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem,
        setItem,
      },
    })

    expect(readStoredBasemap()).toBe('opentopomap')
    expect(() => persistBasemapPreference('esri_topo')).not.toThrow()
  })
})
