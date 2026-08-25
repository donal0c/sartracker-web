import { describe, expect, it, vi } from 'vitest'

import {
  syncCoverageOverlay,
  type CoverageOverlayMap,
} from '../../src/features/tracking/sync-coverage-overlay'

describe('Candidate B coverage overlay [DON-276]', () => {
  it('replaces only the period whose own revision digest moved', () => {
    const map = createMap()
    syncCoverageOverlay(map, {
      periods: [
        { periodKey: 'outing\u0000a', revisionDigest: 'a1' },
        { periodKey: 'outing\u0000b', revisionDigest: 'b1' },
      ],
      delivered: [],
    })
    const sourceB = [...map.sources.entries()]
      .find(([, source]) => String(source.tiles?.[0]).includes('b1'))?.[0]
    expect(sourceB).toBeDefined()
    map.removeSource.mockClear()

    syncCoverageOverlay(map, {
      periods: [
        { periodKey: 'outing\u0000a', revisionDigest: 'a2' },
        { periodKey: 'outing\u0000b', revisionDigest: 'b1' },
      ],
      delivered: [],
    })

    expect(map.removeSource).not.toHaveBeenCalledWith(sourceB)
    expect(map.sources.has(sourceB!)).toBe(true)
  })

  it('changes coverage filters without replacing sources or touching live layers', () => {
    const map = createMap()
    const catalog = {
      periods: [{ periodKey: 'outing\u0000a', revisionDigest: 'a1' }],
      delivered: [],
    }
    syncCoverageOverlay(map, catalog)
    map.removeSource.mockClear()
    map.setFilter.mockClear()

    syncCoverageOverlay(map, catalog, {
      omittedDeviceIds: ['device-a'], omittedPeriodKeys: [],
    })

    expect(map.removeSource).not.toHaveBeenCalled()
    expect(map.setFilter).toHaveBeenCalledTimes(2)
    expect(map.setFilter.mock.calls.every(([layerId]) => String(layerId).startsWith('coverage-')))
      .toBe(true)
  })

  it('attests only catalogs whose sources and layers were installed', () => {
    const map = createMap()
    const catalog = {
      periods: [{ periodKey: 'outing\u0000a', revisionDigest: 'a1' }],
      delivered: [],
    }

    expect(syncCoverageOverlay(map, catalog)).toEqual({
      periods: [{ periodKey: 'outing\u0000a', revisionDigest: 'a1' }],
    })
    vi.spyOn(map, 'getSource').mockReturnValue(undefined)
    expect(() => syncCoverageOverlay(map, catalog)).toThrow(/activation failed/i)
  })

  it('keeps the prior revision installed when replacement source creation fails', () => {
    const map = createMap()
    syncCoverageOverlay(map, {
      periods: [{ periodKey: 'outing\u0000a', revisionDigest: 'a1' }],
      delivered: [],
    })
    const priorSource = [...map.sources.keys()][0]!
    const originalAddSource = map.addSource.bind(map)
    vi.spyOn(map, 'addSource').mockImplementation((id, source) => {
      if (String((source as { readonly tiles?: readonly string[] }).tiles?.[0]).includes('a2')) {
        throw new Error('replacement source failed')
      }
      return originalAddSource(id, source)
    })

    expect(() => syncCoverageOverlay(map, {
      periods: [{ periodKey: 'outing\u0000a', revisionDigest: 'a2' }],
      delivered: [],
    })).toThrow(/replacement source failed/)
    expect(map.sources.has(priorSource)).toBe(true)
    expect(map.getSource(priorSource)).toBeDefined()
  })
})

function createMap(): CoverageOverlayMap & {
  readonly sources: Map<string, { readonly tiles?: readonly string[] }>
  readonly removeSource: ReturnType<typeof vi.fn>
  readonly setFilter: ReturnType<typeof vi.fn>
} {
  const sources = new Map<string, { readonly tiles?: readonly string[] }>()
  const layers = new Map<string, unknown>()
  const removeSource = vi.fn((id: string) => { sources.delete(id) })
  return {
    sources,
    addSource: (id, source) => { sources.set(id, source as never) },
    getSource: (id) => sources.get(id),
    removeSource,
    addLayer: (layer) => { layers.set(layer.id, layer) },
    getLayer: (id) => layers.get(id),
    removeLayer: (id) => { layers.delete(id) },
    setFilter: vi.fn(),
  }
}
