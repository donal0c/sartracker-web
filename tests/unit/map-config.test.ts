import {
  BASEMAPS,
  DEFAULT_BASEMAP_ID,
  buildTileUrl,
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

  it('builds tile urls with the correct placeholder order', () => {
    expect(buildTileUrl(getBasemapById('opentopomap').tiles[0], 12, 345, 678)).toBe(
      'https://tile.opentopomap.org/12/345/678.png',
    )
    expect(buildTileUrl(getBasemapById('esri_topo').tiles[0], 12, 345, 678)).toBe(
      'https://services.arcgisonline.com/arcgis/rest/services/World_Topo_Map/MapServer/tile/12/678/345',
    )
  })
})
