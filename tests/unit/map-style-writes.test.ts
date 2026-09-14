import { describe, expect, it, vi } from 'vitest'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { setMapFilterIfChanged, setMapPaintPropertyIfChanged } from '../../src/features/map/map-style-writes'

describe('conditional map style writes', () => {
  it('compares expression contents and repairs a replaced or externally changed filter', () => {
    let filter: Parameters<MapLibreMap['setFilter']>[1] = ['==', ['get', 'id'], 1]
    const map = {
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
})
