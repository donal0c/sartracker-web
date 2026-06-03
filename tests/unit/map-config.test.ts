import {
  BASEMAPS,
  DEFAULT_BASEMAP_ID,
  DEFAULT_OFFICIAL_BASEMAP_ID,
  MAP_CATALOGUE_GROUPS,
  buildTileUrl,
  getDefaultBasemapIdForCatalogue,
  getBasemapById,
} from '../../src/lib/map-config'

describe('map basemap catalogue', () => {
  it('uses OpenTopoMap as the default source', () => {
    expect(DEFAULT_BASEMAP_ID).toBe('opentopomap')
  })

  it('defines the four locked v1 basemaps', () => {
    expect(BASEMAPS.map((basemap) => basemap.id)).toEqual([
      'opentopomap',
      'esri_topo',
      'openstreetmap',
      'esri_satellite',
    ])
  })

  it('groups official maps ahead of public fallback maps', () => {
    expect(MAP_CATALOGUE_GROUPS.map((group) => group.label)).toEqual([
      'Official maps',
      'Public fallback maps',
    ])
    expect(MAP_CATALOGUE_GROUPS[0]?.items.map((item) => item.id)).toEqual([
      'official_discovery_topo',
      'official_premium_basemap',
      'official_aerial_imagery',
      'official_high_resolution_imagery',
    ])
    expect(MAP_CATALOGUE_GROUPS[1]?.items.map((item) => item.id)).toEqual([
      'opentopomap',
      'esri_topo',
      'openstreetmap',
      'esri_satellite',
    ])
  })

  it('keeps Discovery Topo as the official default when official maps are available', () => {
    expect(DEFAULT_OFFICIAL_BASEMAP_ID).toBe('official_discovery_topo')
    expect(getDefaultBasemapIdForCatalogue('official')).toBe('official_discovery_topo')
  })

  it('falls back to OpenTopoMap when official maps are not configured', () => {
    expect(getDefaultBasemapIdForCatalogue('public-fallback')).toBe(DEFAULT_BASEMAP_ID)
  })

  it('builds tile urls with the correct placeholder order', () => {
    expect(buildTileUrl(getBasemapById('opentopomap').tiles[0], 12, 345, 678)).toBe(
      'https://tile.opentopomap.org/12/345/678.png',
    )
    expect(buildTileUrl(getBasemapById('esri_topo').tiles[0], 12, 345, 678)).toBe(
      'https://services.arcgisonline.com/arcgis/rest/services/World_Topo_Map/MapServer/tile/12/678/345',
    )
  })
})
