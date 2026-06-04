import { BASEMAP_STORAGE_KEY, persistBasemapPreference, readStoredBasemap } from '../../src/lib/map-preferences'

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
