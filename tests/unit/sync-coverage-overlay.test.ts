import { describe, expect, it, vi } from 'vitest'

import {
  isCoverageOverlayAttached,
  syncCoverageOverlay,
  type CoverageOverlayMap,
} from '../../src/features/tracking/sync-coverage-overlay'

describe('Candidate B coverage overlay [DON-276]', () => {
  it('replaces equal period revisions when the mission identity changes', async () => {
    const map = createMap()
    const first = await syncCoverageOverlay(map, {
      missionId: 'mission-a',
      periods: [{ periodKey: 'outing\u0000shared', revisionDigest: 'revision-1' }],
      delivered: [],
    })
    first.commit()
    first.finalize()
    const firstSource = [...map.sources.keys()][0]!

    const replacement = await syncCoverageOverlay(map, {
      missionId: 'mission-b',
      periods: [{ periodKey: 'outing\u0000shared', revisionDigest: 'revision-1' }],
      delivered: [],
    })

    expect(map.sources.size).toBe(2)
    replacement.commit()
    replacement.finalize()
    expect(map.sources.has(firstSource)).toBe(false)
    expect([...map.sources.keys()]).toHaveLength(1)
  })

  it('replaces only the period whose own revision digest moved', async () => {
    const map = createMap()
    ;(await syncCoverageOverlay(map, {
      missionId: 'mission-1',
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
      missionId: 'mission-1',
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
      missionId: 'mission-1',
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
      missionId: 'mission-1',
      periods: [{ periodKey: 'outing\u0000a', revisionDigest: 'a1' }],
      delivered: [],
    }

    await expect(syncCoverageOverlay(map, catalog)).resolves.toMatchObject({
      periods: [{ periodKey: 'outing\u0000a', revisionDigest: 'a1' }],
    })
    vi.spyOn(map, 'getSource').mockReturnValue(undefined)
    await expect(syncCoverageOverlay(map, catalog)).rejects.toThrow(/activation failed/i)
  })

  it('rebuilds a retained period when its source survives but a layer is missing', async () => {
    const map = createMap()
    const catalog = {
      missionId: 'mission-1',
      periods: [{ periodKey: 'outing\u0000a', revisionDigest: 'a1' }],
      delivered: [],
    }
    const first = await syncCoverageOverlay(map, catalog)
    first.commit()
    first.finalize()
    const priorSource = [...map.sources.keys()][0]!
    const missingLayer = [...map.layers.keys()][0]!
    map.removeLayer(missingLayer)

    const repair = await syncCoverageOverlay(map, catalog)

    expect(map.sources.size).toBe(2)
    repair.commit()
    repair.finalize()
    expect(map.sources.has(priorSource)).toBe(false)
    expect(map.layers.size).toBe(2)
  })

  it('keeps the prior revision installed when replacement source creation fails', async () => {
    const map = createMap()
    ;(await syncCoverageOverlay(map, {
      missionId: 'mission-1',
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
      missionId: 'mission-1',
      periods: [{ periodKey: 'outing\u0000a', revisionDigest: 'a2' }],
      delivered: [],
    })).rejects.toThrow(/replacement source failed/)
    expect(map.sources.has(priorSource)).toBe(true)
    expect(map.getSource(priorSource)).toBeDefined()
  })

  it('retains the prior revision until replacement tiles load and activation commits', async () => {
    const map = createMap()
    const first = await syncCoverageOverlay(map, {
      missionId: 'mission-1',
      periods: [{ periodKey: 'outing\u0000a', revisionDigest: 'a1' }],
      delivered: [],
    })
    first.commit()
    const priorSource = [...map.sources.keys()][0]!
    map.autoLoadSources = false

    const replacement = syncCoverageOverlay(map, {
      missionId: 'mission-1',
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
    activation.finalize()
    expect(map.sources.has(priorSource)).toBe(false)
    expect(map.sources.has(nextSource)).toBe(true)
  })

  it('can roll renderer activation back until backend finalization succeeds', async () => {
    const map = createMap()
    const initial = await syncCoverageOverlay(map, {
      missionId: 'mission-1',
      periods: [{ periodKey: 'outing\u0000a', revisionDigest: 'a1' }],
      delivered: [],
    })
    initial.commit()
    initial.finalize()
    const priorSource = [...map.sources.keys()][0]!

    const replacement = await syncCoverageOverlay(map, {
      missionId: 'mission-1',
      periods: [{ periodKey: 'outing\u0000a', revisionDigest: 'a2' }],
      delivered: [],
    })
    const nextSource = [...map.sources.keys()].find((sourceId) => sourceId !== priorSource)!
    replacement.commit()

    expect(map.sources.has(priorSource)).toBe(true)
    expect(map.sources.has(nextSource)).toBe(true)
    replacement.rollback()
    expect(map.sources.has(priorSource)).toBe(true)
    expect(map.sources.has(nextSource)).toBe(false)
  })

  it('never lets an obsolete rollback restore prior-mission geometry after a mission clear', async () => {
    const map = createMap()
    const initial = await syncCoverageOverlay(map, {
      missionId: 'mission-a',
      periods: [{ periodKey: 'outing\\u0000a', revisionDigest: 'a1' }],
      delivered: [],
    })
    initial.commit()
    initial.finalize()

    const replacement = await syncCoverageOverlay(map, {
      missionId: 'mission-a',
      periods: [{ periodKey: 'outing\\u0000a', revisionDigest: 'a2' }],
      delivered: [],
    })
    replacement.commit()

    const clear = await syncCoverageOverlay(map, null)
    clear.commit()
    clear.finalize()
    expect(map.sources.size).toBe(0)
    expect(map.layers.size).toBe(0)

    replacement.rollback()

    expect(map.sources.size).toBe(0)
    expect(map.layers.size).toBe(0)
  })

  it('clears prior-mission geometry even when its obsolete filters cannot be updated', async () => {
    const map = createMap()
    const initial = await syncCoverageOverlay(map, {
      missionId: 'mission-a',
      periods: [{ periodKey: 'outing\u0000a', revisionDigest: 'a1' }],
      delivered: [],
    })
    initial.commit()
    initial.finalize()
    map.setFilter.mockClear()
    map.setFilter.mockImplementation(() => {
      throw new Error('style no longer accepts obsolete coverage filters')
    })

    const clear = await syncCoverageOverlay(map, null)
    clear.commit()
    clear.finalize()

    expect(map.sources.size).toBe(0)
    expect(map.layers.size).toBe(0)
    expect(map.setFilter).not.toHaveBeenCalled()
  })

  it('restores the prior owner when a superseding filtered sync fails', async () => {
    const map = createMap()
    const priorCatalog = {
      missionId: 'mission-1',
      periods: [{ periodKey: 'outing\\u0000a', revisionDigest: 'a1' }],
      delivered: [],
    }
    const initial = await syncCoverageOverlay(map, priorCatalog)
    initial.commit()
    initial.finalize()

    const pending = await syncCoverageOverlay(map, {
      ...priorCatalog,
      periods: [{ periodKey: 'outing\\u0000a', revisionDigest: 'a2' }],
    })
    pending.commit()
    const originalAddSource = map.addSource.bind(map)
    vi.spyOn(map, 'addSource').mockImplementation((id, source) => {
      if (String((source as { readonly tiles?: readonly string[] }).tiles?.[0]).includes('a3')) {
        throw new Error('filtered replacement failed')
      }
      return originalAddSource(id, source)
    })

    await expect(syncCoverageOverlay(map, {
      ...priorCatalog,
      periods: [{ periodKey: 'outing\\u0000a', revisionDigest: 'a3' }],
    }, {
      omittedDeviceIds: ['device-a'], omittedPeriodKeys: [],
    })).rejects.toThrow(/filtered replacement failed/)

    pending.rollback()

    expect(isCoverageOverlayAttached(map, priorCatalog)).toBe(true)
    expect(map.sources.size).toBe(1)
    expect(map.layers.size).toBe(2)
  })

  it('cascades rollback through a successfully staged superseding sync', async () => {
    const map = createMap()
    const catalog = {
      missionId: 'mission-1',
      periods: [{ periodKey: 'outing\\u0000a', revisionDigest: 'a1' }],
      delivered: [],
    }
    const initial = await syncCoverageOverlay(map, catalog)
    initial.commit()
    initial.finalize()
    const pending = await syncCoverageOverlay(map, {
      ...catalog,
      periods: [{ periodKey: 'outing\\u0000a', revisionDigest: 'a2' }],
    })
    const superseding = await syncCoverageOverlay(map, {
      ...catalog,
      periods: [{ periodKey: 'outing\\u0000a', revisionDigest: 'a3' }],
    })

    pending.rollback()
    superseding.rollback()

    expect(map.sources.size).toBe(1)
    expect(map.layers.size).toBe(2)
    expect(isCoverageOverlayAttached(map, catalog)).toBe(true)
  })

  it('removes an older request that loads after a newer successful request', async () => {
    const map = createMap()
    const catalog = {
      missionId: 'mission-1',
      periods: [{ periodKey: 'outing\\u0000a', revisionDigest: 'a1' }],
      delivered: [],
    }
    const initial = await syncCoverageOverlay(map, catalog)
    initial.commit()
    initial.finalize()
    map.autoLoadSources = false
    const olderPromise = syncCoverageOverlay(map, {
      ...catalog,
      periods: [{ periodKey: 'outing\\u0000a', revisionDigest: 'a2' }],
    })
    const newerPromise = syncCoverageOverlay(map, {
      ...catalog,
      periods: [{ periodKey: 'outing\\u0000a', revisionDigest: 'a3' }],
    })
    const newerSource = findSourceId(map, 'a3')
    map.markSourceLoaded(newerSource)
    const newer = await newerPromise
    newer.rollback()
    const olderSource = findSourceId(map, 'a2')
    map.markSourceLoaded(olderSource)

    await expect(olderPromise).rejects.toMatchObject({ name: 'AbortError' })
    expect(map.sources.size).toBe(1)
    expect(map.layers.size).toBe(2)
    expect(isCoverageOverlayAttached(map, catalog)).toBe(true)
  })

  it('does not let an obsolete aborted request restore stale filters', async () => {
    const map = createMap()
    const catalog = {
      missionId: 'mission-1',
      periods: [{ periodKey: 'outing\\u0000a', revisionDigest: 'a1' }],
      delivered: [],
    }
    const initial = await syncCoverageOverlay(map, catalog)
    initial.commit()
    initial.finalize()
    map.autoLoadSources = false
    const obsoleteController = new AbortController()
    const obsolete = syncCoverageOverlay(map, {
      ...catalog,
      periods: [{ periodKey: 'outing\\u0000a', revisionDigest: 'a2' }],
    }, { omittedDeviceIds: ['old-filter'], omittedPeriodKeys: [] }, obsoleteController.signal)
    obsoleteController.abort()
    const currentPromise = syncCoverageOverlay(map, {
      ...catalog,
      periods: [{ periodKey: 'outing\\u0000a', revisionDigest: 'a3' }],
    }, { omittedDeviceIds: ['new-filter'], omittedPeriodKeys: [] })
    map.markSourceLoaded(findSourceId(map, 'a3'))
    const current = await currentPromise
    await expect(obsolete).rejects.toMatchObject({ name: 'AbortError' })
    current.commit()
    current.finalize()

    const lastFilter = JSON.stringify(map.setFilter.mock.calls.at(-1))
    expect(lastFilter).toContain('new-filter')
    expect(lastFilter).not.toContain('old-filter')
  })

  it('applies new filters to the retained predecessor before replacement loading completes', async () => {
    const map = createMap()
    const catalog = {
      missionId: 'mission-1',
      periods: [{ periodKey: 'outing\\u0000a', revisionDigest: 'a1' }],
      delivered: [],
    }
    const initial = await syncCoverageOverlay(map, catalog)
    initial.commit()
    initial.finalize()
    const initialSource = findSourceId(map, 'a1')
    map.setFilter.mockClear()
    map.autoLoadSources = false
    const controller = new AbortController()
    const replacement = syncCoverageOverlay(map, {
      ...catalog,
      periods: [{ periodKey: 'outing\\u0000a', revisionDigest: 'a2' }],
    }, { omittedDeviceIds: ['device-x'], omittedPeriodKeys: [] }, controller.signal)

    const predecessorFilters = map.setFilter.mock.calls
      .filter(([layerId]) => String(layerId).startsWith(initialSource))
    expect(predecessorFilters).toHaveLength(2)
    expect(JSON.stringify(predecessorFilters)).toContain('device-x')
    controller.abort()
    await expect(replacement).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('rolls back immediately when activation starts with an aborted renderer signal', async () => {
    const map = createMap()
    map.autoLoadSources = false
    const controller = new AbortController()
    controller.abort()

    await expect(syncCoverageOverlay(map, {
      missionId: 'mission-1',
      periods: [{ periodKey: 'outing\u0000a', revisionDigest: 'a1' }],
      delivered: [],
    }, undefined, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(map.sources.size).toBe(0)
  })
})

function createMap(): CoverageOverlayMap & {
  readonly sources: Map<string, { readonly tiles?: readonly string[] }>
  readonly layers: Map<string, unknown>
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
    layers,
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

function findSourceId(
  map: ReturnType<typeof createMap>,
  revisionDigest: string,
): string {
  const entry = [...map.sources.entries()].find(([, source]) =>
    JSON.stringify(source.tiles).includes(revisionDigest))
  if (entry === undefined) throw new Error(`Missing source for ${revisionDigest}.`)
  return entry[0]
}
