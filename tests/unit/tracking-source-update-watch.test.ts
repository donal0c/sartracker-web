import { describe, expect, it, vi } from 'vitest'

import { watchTrackingSourceUpdates } from '../../src/features/tracking/tracking-source-update-watch'

type Listener = (event: unknown) => void

/** Fires events the way MapLibre 5.22's GeoJSONSource does for worker updates. */
function createFakeSource() {
  const listeners = new Map<string, Set<Listener>>()
  return {
    on: vi.fn((type: string, listener: Listener) => {
      const set = listeners.get(type) ?? new Set<Listener>()
      set.add(listener)
      listeners.set(type, set)
    }),
    off: vi.fn((type: string, listener: Listener) => {
      listeners.get(type)?.delete(listener)
    }),
    fire(type: string, event: Record<string, unknown> = {}) {
      for (const listener of listeners.get(type) ?? []) listener({ type, ...event })
    },
    /** One worker dispatch starting. */
    startDispatch() { this.fire('dataloading', { dataType: 'source' }) },
    /** The dispatch applied its data. */
    succeed() {
      this.fire('data', { dataType: 'source', sourceDataType: 'metadata' })
      this.fire('data', { dataType: 'source', sourceDataType: 'content' })
    },
    /** The worker rejected the dispatch; MapLibre keeps the old data. */
    reject(message = 'worker rejected the update') { this.fire('error', { error: new Error(message) }) },
    listenerCount() { return [...listeners.values()].reduce((total, set) => total + set.size, 0) },
  }
}

/**
 * The map's visible tracking tiles. `refresh` reloads every one, errored ones
 * included, so they are loading until `loadAll` or `failOne` is called.
 */
function createFakeTiles(source: ReturnType<typeof createFakeSource>) {
  let loading = false
  return {
    refresh: vi.fn(() => { loading = true }),
    settled: () => !loading,
    /** Every visible tile finished loading the new data. */
    loadAll() {
      loading = false
      source.fire('data', { dataType: 'source', tile: {} })
    },
    /** A tile failed to load; MapLibre fires the error on the source. */
    failOne(message = 'tile failed') {
      loading = false
      source.fire('error', { error: new Error(message), tile: {} })
    },
  }
}

/** Lets the deferred tile refresh run. */
const flush = () => Promise.resolve()

/** Starts a watch on a fake source with fake tiles. */
function setup(startFailed = false) {
  const source = createFakeSource()
  const tiles = createFakeTiles(source)
  const onFailure = vi.fn()
  const onRecovered = vi.fn()
  const watch = watchTrackingSourceUpdates(source, { startFailed, tiles, onFailure, onRecovered })
  return { source, tiles, onFailure, onRecovered, watch }
}

describe('tracking source update watch [DON-357]', () => {
  it('reports a rejected worker update as a failure and asks for a full resync', () => {
    const { source, onFailure, onRecovered, watch } = setup()

    source.startDispatch()
    source.reject('could not parse diff')

    expect(onFailure).toHaveBeenCalledWith('could not parse diff')
    expect(watch.needsFullResync()).toBe(true)
    expect(onRecovered).not.toHaveBeenCalled()
  })

  it('stays failed when an update dispatched before the resync succeeds', async () => {
    const { source, tiles, onRecovered, watch } = setup()

    source.startDispatch()
    source.reject()
    // A diff queued before the failure starts and succeeds, but it was built
    // against the data the source never applied, so it proves nothing.
    source.startDispatch()
    watch.noteFullResync()
    source.succeed()
    await flush()

    expect(onRecovered).not.toHaveBeenCalled()
    expect(tiles.refresh).not.toHaveBeenCalled()
    expect(watch.needsFullResync()).toBe(false)

    // The full replacement is the next dispatch; only it, once drawn, clears.
    source.startDispatch()
    source.succeed()
    await flush()
    tiles.loadAll()
    expect(onRecovered).toHaveBeenCalledTimes(1)
    expect(watch.needsFullResync()).toBe(false)
  })

  it('keeps the failure after the resync is applied until every visible tile has reloaded', async () => {
    const { source, tiles, onRecovered, watch } = setup()
    source.startDispatch()
    source.reject()
    watch.noteFullResync()
    source.startDispatch()
    source.succeed()

    // The worker holds the new data, but the map has not drawn it yet. Errored
    // tiles are skipped by MapLibre's normal reload, so every tile is reloaded.
    expect(onRecovered).not.toHaveBeenCalled()
    await flush()
    expect(tiles.refresh).toHaveBeenCalledTimes(1)
    expect(onRecovered).not.toHaveBeenCalled()

    tiles.loadAll()
    expect(onRecovered).toHaveBeenCalledTimes(1)
  })

  it('stays failed when a tile fails to reload after the resync, and asks for another', async () => {
    const { source, tiles, onFailure, onRecovered, watch } = setup()
    source.startDispatch()
    source.reject('first')
    watch.noteFullResync()
    source.startDispatch()
    source.succeed()
    await flush()

    tiles.failOne('tile could not be built')

    expect(onRecovered).not.toHaveBeenCalled()
    expect(onFailure).toHaveBeenLastCalledWith('tile could not be built')
    expect(watch.needsFullResync()).toBe(true)
  })

  it('reports a tile that fails to load while healthy as a failure', () => {
    const { tiles, onFailure, watch } = setup()
    tiles.failOne('tile could not be built')
    expect(onFailure).toHaveBeenCalledWith('tile could not be built')
    expect(watch.needsFullResync()).toBe(true)
  })

  it('stays failed when the resync itself is rejected, and asks for another', () => {
    const { source, onFailure, onRecovered, watch } = setup()

    source.startDispatch()
    source.reject('first')
    watch.noteFullResync()
    source.startDispatch()
    source.reject('second')

    expect(onRecovered).not.toHaveBeenCalled()
    expect(onFailure).toHaveBeenLastCalledWith('second')
    expect(watch.needsFullResync()).toBe(true)
  })

  it('ignores tile loading events, which the source fires too', async () => {
    const { source, tiles, onRecovered, watch } = setup()

    source.startDispatch()
    source.reject()
    watch.noteFullResync()
    // A tile request is not a worker dispatch and must not be counted as one.
    source.fire('dataloading', { dataType: 'source', tile: {} })
    source.succeed()
    await flush()
    tiles.loadAll()
    expect(onRecovered).not.toHaveBeenCalled()
  })

  it('does nothing on success while healthy', async () => {
    const { source, tiles, onRecovered, watch } = setup()
    source.startDispatch()
    source.succeed()
    await flush()
    expect(tiles.refresh).not.toHaveBeenCalled()
    expect(onRecovered).not.toHaveBeenCalled()
    expect(watch.needsFullResync()).toBe(false)
  })

  it('lets a new source clear an earlier failure once its first data is drawn', async () => {
    const { source, tiles, onRecovered } = setup(true)
    // A new source's first dispatch started inside addSource, before the watch.
    source.succeed()
    await flush()
    expect(onRecovered).not.toHaveBeenCalled()
    tiles.loadAll()
    expect(onRecovered).toHaveBeenCalledTimes(1)
  })

  it('reports a failure when the tiles cannot be reloaded at all', async () => {
    const { source, tiles, onFailure, onRecovered, watch } = setup()
    tiles.refresh.mockImplementation(() => { throw new Error('There is no tile manager with ID "tracking"') })
    source.startDispatch()
    source.reject()
    watch.noteFullResync()
    source.startDispatch()
    source.succeed()
    await flush()
    expect(onRecovered).not.toHaveBeenCalled()
    expect(onFailure).toHaveBeenLastCalledWith(expect.stringContaining('no tile manager'))
    expect(watch.needsFullResync()).toBe(true)
  })

  it('raises a visible failure, never a silent skip, when the source cannot be watched', () => {
    const onFailure = vi.fn()
    const onRecovered = vi.fn()
    const unwatchable = {} as Parameters<typeof watchTrackingSourceUpdates>[0]
    const watch = watchTrackingSourceUpdates(unwatchable, {
      startFailed: false, tiles: { refresh: vi.fn(), settled: () => true }, onFailure, onRecovered,
    })
    expect(onFailure).toHaveBeenCalledWith(expect.stringContaining('cannot report failed updates'))
    expect(onRecovered).not.toHaveBeenCalled()
    expect(watch.needsFullResync()).toBe(true)
    expect(() => watch.stop()).not.toThrow()
  })

  it('stops listening when stopped', () => {
    const { source, watch } = setup()
    expect(source.listenerCount()).toBeGreaterThan(0)
    watch.stop()
    expect(source.listenerCount()).toBe(0)
  })
})
