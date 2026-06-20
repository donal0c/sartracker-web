import { describe, expect, it, vi } from 'vitest'

import {
  combineMapFilters,
  ensureGeoJsonSource,
  ensureLayer,
  loadSvgIcon,
} from '../../src/features/map/map-overlay-primitives'

type LayerSpec = {
  readonly id: string
  readonly type: string
  readonly source: string
}

describe('map overlay primitives', () => {
  it('creates a GeoJSON source once and updates data on later syncs', () => {
    const setData = vi.fn()
    const sources = new Map<string, { setData: typeof setData }>()
    const map = {
      getSource: vi.fn((id: string) => sources.get(id)),
      addSource: vi.fn((id: string, config: unknown) => {
        sources.set(id, { setData })
        expect(config).toEqual({
          type: 'geojson',
          data: firstCollection,
        })
      }),
    }

    ensureGeoJsonSource(map, 'mission-overlay', firstCollection)
    ensureGeoJsonSource(map, 'mission-overlay', secondCollection)

    expect(map.addSource).toHaveBeenCalledTimes(1)
    expect(setData).toHaveBeenCalledTimes(1)
    expect(setData).toHaveBeenCalledWith(secondCollection)
  })

  it('does not reset an existing GeoJSON source when the source data key is unchanged [DON-210]', () => {
    const setData = vi.fn()
    const source = { setData }
    const sources = new Map<string, typeof source>()
    const map = {
      getSource: vi.fn((id: string) => sources.get(id)),
      addSource: vi.fn((id: string) => {
        sources.set(id, source)
      }),
    }

    ensureGeoJsonSource(map, 'mission-overlay', firstCollection, { dataKey: 'snapshot:1' })
    ensureGeoJsonSource(map, 'mission-overlay', secondCollection, { dataKey: 'snapshot:1' })

    expect(setData).not.toHaveBeenCalled()
  })

  it('resets an existing GeoJSON source when MapLibre replaces the source object for a style rebuild [DON-210]', () => {
    const staleSource = { setData: vi.fn() }
    const rebuiltSource = { setData: vi.fn() }
    const sources = new Map<string, typeof staleSource>()
    const map = {
      getSource: vi.fn((id: string) => sources.get(id)),
      addSource: vi.fn((id: string) => {
        sources.set(id, staleSource)
      }),
    }

    ensureGeoJsonSource(map, 'mission-overlay', firstCollection, { dataKey: 'snapshot:1' })
    sources.set('mission-overlay', rebuiltSource)
    ensureGeoJsonSource(map, 'mission-overlay', secondCollection, { dataKey: 'snapshot:1' })

    expect(staleSource.setData).not.toHaveBeenCalled()
    expect(rebuiltSource.setData).toHaveBeenCalledTimes(1)
    expect(rebuiltSource.setData).toHaveBeenCalledWith(secondCollection)
  })

  it('adds each layer once without replacing existing style layers', () => {
    const layers = new Map<string, LayerSpec>()
    const map = {
      getLayer: vi.fn((id: string) => layers.get(id)),
      addLayer: vi.fn((layer: LayerSpec) => {
        layers.set(layer.id, layer)
      }),
    }

    const layer = {
      id: 'mission-overlay-line',
      type: 'line',
      source: 'mission-overlay',
    }

    ensureLayer(map, layer)
    ensureLayer(map, layer)

    expect(map.addLayer).toHaveBeenCalledTimes(1)
    expect(map.addLayer).toHaveBeenCalledWith(layer)
  })

  it('combines a base geometry filter with an optional visibility filter', () => {
    expect(combineMapFilters(['==', '$type', 'LineString'], null)).toEqual([
      '==',
      '$type',
      'LineString',
    ])
    expect(
      combineMapFilters(['==', '$type', 'Point'], ['!', ['in', ['get', 'deviceId'], ['literal', ['d1']]]]),
    ).toEqual([
      'all',
      ['==', '$type', 'Point'],
      ['!', ['in', ['get', 'deviceId'], ['literal', ['d1']]]],
    ])
  })

  it('loads an SVG icon into ImageData for MapLibre symbol layers', async () => {
    const previousImage = globalThis.Image
    const previousDocument = globalThis.document
    class TestImage {
      width = 22
      height = 24
      onload: (() => void) | null = null
      onerror: (() => void) | null = null

      set src(_value: string) {
        this.onload?.()
      }
    }
    const imageData = { width: 22, height: 24, data: new Uint8ClampedArray(22 * 24 * 4) } as ImageData
    const drawImage = vi.fn()
    const getImageData = vi.fn(() => imageData)

    Object.defineProperty(globalThis, 'Image', {
      configurable: true,
      value: TestImage,
    })
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: {
        createElement: (tagName: string) => {
          expect(tagName).toBe('canvas')
          return {
            width: 0,
            height: 0,
            getContext: (contextType: string) => {
              expect(contextType).toBe('2d')
              return { drawImage, getImageData }
            },
          }
        },
      },
    })

    try {
      await expect(loadSvgIcon('<svg xmlns="http://www.w3.org/2000/svg" />', 'Test')).resolves.toBe(
        imageData,
      )
      expect(drawImage).toHaveBeenCalledTimes(1)
      expect(getImageData).toHaveBeenCalledWith(0, 0, 22, 24)
    } finally {
      Object.defineProperty(globalThis, 'Image', {
        configurable: true,
        value: previousImage,
      })
      Object.defineProperty(globalThis, 'document', {
        configurable: true,
        value: previousDocument,
      })
    }
  })
})

const firstCollection: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [],
}

const secondCollection: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { id: 'feature-1' },
      geometry: {
        type: 'Point',
        coordinates: [-9.7, 52],
      },
    },
  ],
}
