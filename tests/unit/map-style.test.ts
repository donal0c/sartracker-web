import { createRasterStyle, KERRY_MAX_BOUNDS } from '../../src/features/map/map-style'

describe('map style creation', () => {
  it('keeps the map constrained to Kerry bounds', () => {
    expect(KERRY_MAX_BOUNDS).toEqual([
      [-10.7, 51.55],
      [-9.1, 52.6],
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
