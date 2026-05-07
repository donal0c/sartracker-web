import { createRasterStyle, IRELAND_MAX_BOUNDS } from '../../src/features/map/map-style'

describe('map style creation', () => {
  it('keeps the map constrained to Ireland-wide bounds', () => {
    expect(IRELAND_MAX_BOUNDS).toEqual([
      [-10.85, 51.25],
      [-5.25, 55.55],
    ])
  })

  it('builds a single-source raster style for the selected basemap', () => {
    expect(createRasterStyle('openstreetmap')).toEqual({
      version: 8,
      sources: {
        openstreetmap: {
          type: 'raster',
          tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
          tileSize: 256,
          attribution: '© OpenStreetMap contributors',
          maxzoom: 19,
        },
      },
      layers: [
        {
          id: 'openstreetmap-layer',
          type: 'raster',
          source: 'openstreetmap',
        },
      ],
    })
  })
})
