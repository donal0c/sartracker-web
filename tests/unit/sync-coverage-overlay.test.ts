import { describe, expect, it, vi } from 'vitest'

import {
  syncCoverageOverlay,
  type CoverageOverlayMap,
} from '../../src/features/tracking/sync-coverage-overlay'

describe('Candidate B coverage overlay [DON-276]', () => {
  it('replaces only the period whose own revision digest moved', async () => {
    const map = createMap()
    ;(await syncCoverageOverlay(map, {
      periods: [
        { periodKey: 'outing\u0000a', revisionDigest: 'a1' },
        { periodKey: 'outing\u0000b', revisionDigest: 'b1' },
      ],
      delivered: [],
    })).commit()
    const sourceB = [...map.sources.entries()]
      .find(([, source]) => String(source.tiles?.[0]).includes('b1'))?.[0]
    expect(sourceB).toBeDefined()
    map.removeSource.mockClear()

    ;(await syncCoverageOverlay(map, {
      periods: [
        { periodKey: 'outing\u0000a', revisionDigest: 'a2' },
        { periodKey: 'outing\u0000b', revisionDigest: 'b1' },
      ],
      delivered: [],
    })).commit()

    expect(map.removeSource).not.toHaveBeenCalledWith(sourceB)
    expect(map.sources.has(sourceB!)).toBe(true)
  })

  it('changes coverage filters without replacing sources or touching live layers', async () => {
    const map = createMap()
    const catalog = {
      periods: [{ periodKey: 'outing\u0000a', revisionDigest: 'a1' }],
      delivered: [],
    }
    ;(await syncCoverageOverlay(map, catalog)).commit()
    map.removeSource.mockClear()
    map.setFilter.mockClear()

    ;(await syncCoverageOverlay(map, catalog, {
      omittedDeviceIds: ['device-a'], omittedPeriodKeys: [],
    })).commit()

    expect(map.removeSource).not.toHaveBeenCalled()
    expect(map.setFilter).toHaveBeenCalledTimes(2)
    expect(map.setFilter.mock.calls.every(([layerId]) => String(layerId).startsWith('coverage-')))
      .toBe(true)
  })

  it('attests only catalogs whose sources and layers were installed', async () => {
    const map = createMap()
    const catalog = {
      periods: [{ periodKey: 'outing\u0000a', revisionDigest: 'a1' }],
      delivered: [],
    }

    await expect(syncCoverageOverlay(map, catalog)).resolves.toMatchObject({
      periods: [{ periodKey: 'outing\u0000a', revisionDigest: 'a1' }],
    })
    vi.spyOn(map, 'getSource').mockReturnValue(undefined)
    await expect(syncCoverageOverlay(map, catalog)).rejects.toThrow(/activation failed/i)
  })

  it('keeps the prior revision installed when replacement source creation fails', async () => {
    const map = createMap()
    ;(await syncCoverageOverlay(map, {
      periods: [{ periodKey: 'outing\u0000a', revisionDigest: 'a1' }],
      delivered: [],
    })).commit()
    const priorSource = [...map.sources.keys()][0]!
    const originalAddSource = map.addSource.bind(map)
    vi.spyOn(map, 'addSource').mockImplementation((id, source) => {
      if (String((source as { readonly tiles?: readonly string[] }).tiles?.[0]).includes('a2')) {
        throw new Error('replacement source failed')
      }
      return originalAddSource(id, source)
    })

    await expect(syncCoverageOverlay(map, {
      periods: [{ periodKey: 'outing\u0000a', revisionDigest: 'a2' }],
      delivered: [],
    })).rejects.toThrow(/replacement source failed/)
    expect(map.sources.has(priorSource)).toBe(true)
    expect(map.getSource(priorSource)).toBeDefined()
  })

  it('retains the prior revision until replacement tiles load and activation commits', async () => {
    const map = createMap()
    const first = await syncCoverageOverlay(map, {
      periods: [{ periodKey: 'outing\u0000a', revisionDigest: 'a1' }],
      delivered: [],
    })
    first.commit()
    const priorSource = [...map.sources.keys()][0]!
    map.autoLoadSources = false

    const replacement = syncCoverageOverlay(map, {
      periods: [{ periodKey: 'outing\u0000a', revisionDigest: 'a2' }],
      delivered: [],
    })
    await vi.waitFor(() => expect(map.sources.size).toBe(2))
    const nextSource = [...map.sources.keys()].find((sourceId) => sourceId !== priorSource)!

    expect(map.sources.has(priorSource)).toBe(true)
    let settled = false
    void replacement.then(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)

    map.markSourceLoaded(nextSource)
    const activation = await replacement
    expect(map.sources.has(priorSource)).toBe(true)
    activation.commit()
    expect(map.sources.has(priorSource)).toBe(false)
    expect(map.sources.has(nextSource)).toBe(true)
  })

  it('rolls back immediately when activation starts with an aborted renderer signal', async () => {
    const map = createMap()
    map.autoLoadSources = false
    const controller = new AbortController()
    controller.abort()

    await expect(syncCoverageOverlay(map, {
      periods: [{ periodKey: 'outing\u0000a', revisionDigest: 'a1' }],
      delivered: [],
    }, undefined, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(map.sources.size).toBe(0)
  })
})

function createMap(): CoverageOverlayMap & {
  readonly sources: Map<string, { readonly tiles?: readonly string[] }>
  readonly removeSource: ReturnType<typeof vi.fn>
  readonly setFilter: ReturnType<typeof vi.fn>
  autoLoadSources: boolean
  readonly markSourceLoaded: (sourceId: string) => void
} {
  const sources = new Map<string, { readonly tiles?: readonly string[] }>()
  const layers = new Map<string, unknown>()
  const loadedSources = new Set<string>()
  const sourceListeners = new Set<(event: { readonly sourceId: string }) => void>()
  const removeSource = vi.fn((id: string) => { sources.delete(id) })
  const map = {
    sources,
    autoLoadSources: true,
    addSource: (id, source) => {
      sources.set(id, source as never)
      if (map.autoLoadSources) loadedSources.add(id)
    },
    getSource: (id) => sources.get(id),
    removeSource,
    addLayer: (layer) => { layers.set(layer.id, layer) },
    getLayer: (id) => layers.get(id),
    removeLayer: (id) => { layers.delete(id) },
    setFilter: vi.fn(),
    isSourceLoaded: (id: string) => loadedSources.has(id),
    on: (_event: 'sourcedata', listener: (event: { readonly sourceId: string }) => void) => {
      sourceListeners.add(listener)
    },
    off: (_event: 'sourcedata', listener: (event: { readonly sourceId: string }) => void) => {
      sourceListeners.delete(listener)
    },
    markSourceLoaded: (sourceId: string) => {
      loadedSources.add(sourceId)
      for (const listener of sourceListeners) listener({ sourceId })
    },
  }
  return map
}
