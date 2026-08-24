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
})

function createMap(): CoverageOverlayMap & {
  readonly sources: Map<string, { readonly tiles?: readonly string[] }>
  readonly removeSource: ReturnType<typeof vi.fn>
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
  }
}
