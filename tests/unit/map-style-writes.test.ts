import { describe, expect, it, vi } from 'vitest'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { setMapFilterIfChanged, setMapPaintPropertyIfChanged } from '../../src/features/map/map-style-writes'

describe('conditional map style writes', () => {
  it('compares expression contents and repairs a replaced or externally changed filter', () => {
    let filter: Parameters<MapLibreMap['setFilter']>[1] = ['==', ['get', 'id'], 1]
    const map = {
      getLayer: vi.fn(() => ({ id: 'target' })),
      getFilter: () => filter ?? undefined,
      setFilter: vi.fn((_id: string, next: typeof filter) => { filter = next; return map as unknown as MapLibreMap }),
    }
    setMapFilterIfChanged(map, 'target', ['==', ['get', 'id'], 1])
    expect(map.setFilter).not.toHaveBeenCalled()
    filter = undefined
    setMapFilterIfChanged(map, 'target', ['==', ['get', 'id'], 1])
    expect(map.setFilter).toHaveBeenCalledOnce()
    setMapFilterIfChanged(map, 'target', null)
    expect(map.setFilter).toHaveBeenCalledTimes(2)
    setMapFilterIfChanged(map, 'target', null)
    expect(map.setFilter).toHaveBeenCalledTimes(2)
  })

  it('retains actual paint changes and reconstructs paint after style replacement', () => {
    let paint: unknown = 4
    const map = {
      getLayer: vi.fn(() => ({ id: 'trail' })),
      getPaintProperty: () => paint,
      setPaintProperty: vi.fn((_id: string, _property: string, value: unknown) => { paint = value; return map as unknown as MapLibreMap }),
    }
    setMapPaintPropertyIfChanged(map, 'trail', 'line-width', 4)
    expect(map.setPaintProperty).not.toHaveBeenCalled()
    setMapPaintPropertyIfChanged(map, 'trail', 'line-width', 8)
    expect(paint).toBe(8)
    paint = undefined
    setMapPaintPropertyIfChanged(map, 'trail', 'line-width', 8)
    expect(map.setPaintProperty).toHaveBeenCalledTimes(2)
  })

  it('does not throw or write when MapLibre has not created the requested layer', () => {
    const filterMap = {
      getLayer: vi.fn(() => undefined),
      getFilter: vi.fn(() => {
        throw new TypeError('missing filter layer')
      }),
      setFilter: vi.fn(),
    }
    const paintMap = {
      getLayer: vi.fn(() => undefined),
      getPaintProperty: vi.fn(() => {
        throw new TypeError('missing paint layer')
      }),
      setPaintProperty: vi.fn(),
    }

    expect(() => setMapFilterIfChanged(filterMap, 'not-yet-created', null)).not.toThrow()
    expect(filterMap.getFilter).not.toHaveBeenCalled()
    expect(filterMap.setFilter).not.toHaveBeenCalled()
    expect(() => setMapPaintPropertyIfChanged(paintMap, 'not-yet-created', 'line-width', 4))
      .not.toThrow()
    expect(paintMap.getPaintProperty).not.toHaveBeenCalled()
    expect(paintMap.setPaintProperty).not.toHaveBeenCalled()
  })

  it('matches MapLibre structural equality and top-level unset semantics', () => {
    let paint: unknown = { base: 2, stops: [[0, 1]] }
    const map = {
      getLayer: vi.fn(() => ({ id: 'trail' })),
      getPaintProperty: vi.fn(() => paint),
      setPaintProperty: vi.fn((_id: string, _property: string, value: unknown) => {
        paint = value
        return map as unknown as MapLibreMap
      }),
    }

    setMapPaintPropertyIfChanged(map, 'trail', 'line-gradient', {
      stops: [[0, 1]],
      base: 2,
    })
    expect(map.setPaintProperty).not.toHaveBeenCalled()

    paint = undefined
    setMapPaintPropertyIfChanged(map, 'trail', 'line-gradient', null)
    expect(map.setPaintProperty).not.toHaveBeenCalled()
  })

  it('does not collapse MapLibre-distinct undefined, null, or NaN values', () => {
    let filter: unknown = ['literal', ['alpha', undefined]]
    let paint: unknown = Number.NaN
    const map = {
      getLayer: vi.fn(() => ({ id: 'target' })),
      getFilter: vi.fn(() => filter),
      setFilter: vi.fn((_id: string, value: unknown) => {
        filter = value
        return map as unknown as MapLibreMap
      }),
      getPaintProperty: vi.fn(() => paint),
      setPaintProperty: vi.fn((_id: string, _property: string, value: unknown) => {
        paint = value
        return map as unknown as MapLibreMap
      }),
    }

    setMapFilterIfChanged(map, 'target', ['literal', ['alpha', null]])
    expect(map.setFilter).toHaveBeenCalledOnce()

    setMapPaintPropertyIfChanged(map, 'target', 'line-width', Number.NaN)
    expect(map.setPaintProperty).toHaveBeenCalledOnce()
  })
})
