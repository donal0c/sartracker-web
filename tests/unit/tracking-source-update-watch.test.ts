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

describe('tracking source update watch [DON-357]', () => {
  it('reports a rejected worker update as a failure and asks for a full resync', () => {
    const source = createFakeSource()
    const onFailure = vi.fn()
    const onRecovered = vi.fn()
    const watch = watchTrackingSourceUpdates(source, { startFailed: false, onFailure, onRecovered })

    source.startDispatch()
    source.reject('could not parse diff')

    expect(onFailure).toHaveBeenCalledWith('could not parse diff')
    expect(watch.needsFullResync()).toBe(true)
    expect(onRecovered).not.toHaveBeenCalled()
  })

  it('stays failed when an update dispatched before the resync succeeds', () => {
    const source = createFakeSource()
    const onRecovered = vi.fn()
    const watch = watchTrackingSourceUpdates(source, { startFailed: false, onFailure: vi.fn(), onRecovered })

    source.startDispatch()
    source.reject()
    // A diff queued before the failure starts and succeeds, but it was built
    // against the data the source never applied, so it proves nothing.
    source.startDispatch()
    watch.noteFullResync()
    source.succeed()

    expect(onRecovered).not.toHaveBeenCalled()
    expect(watch.needsFullResync()).toBe(false)

    // The full replacement is the next dispatch; only its success clears.
    source.startDispatch()
    source.succeed()
    expect(onRecovered).toHaveBeenCalledTimes(1)
    expect(watch.needsFullResync()).toBe(false)
  })

  it('stays failed when the resync itself is rejected, and asks for another', () => {
    const source = createFakeSource()
    const onFailure = vi.fn()
    const onRecovered = vi.fn()
    const watch = watchTrackingSourceUpdates(source, { startFailed: false, onFailure, onRecovered })

    source.startDispatch()
    source.reject('first')
    watch.noteFullResync()
    source.startDispatch()
    source.reject('second')

    expect(onRecovered).not.toHaveBeenCalled()
    expect(onFailure).toHaveBeenLastCalledWith('second')
    expect(watch.needsFullResync()).toBe(true)
  })

  it('ignores tile loading events, which the source fires too', () => {
    const source = createFakeSource()
    const onRecovered = vi.fn()
    const watch = watchTrackingSourceUpdates(source, { startFailed: false, onFailure: vi.fn(), onRecovered })

    source.startDispatch()
    source.reject()
    watch.noteFullResync()
    // A tile request is not a worker dispatch and must not be counted as one.
    source.fire('dataloading', { dataType: 'source', tile: {} })
    source.succeed()
    expect(onRecovered).not.toHaveBeenCalled()
  })

  it('does nothing on success while healthy', () => {
    const source = createFakeSource()
    const onRecovered = vi.fn()
    const watch = watchTrackingSourceUpdates(source, { startFailed: false, onFailure: vi.fn(), onRecovered })
    source.startDispatch()
    source.succeed()
    expect(onRecovered).not.toHaveBeenCalled()
    expect(watch.needsFullResync()).toBe(false)
  })

  it('lets a new source clear an earlier failure once it applies its first data', () => {
    const source = createFakeSource()
    const onRecovered = vi.fn()
    watchTrackingSourceUpdates(source, { startFailed: true, onFailure: vi.fn(), onRecovered })
    // A new source's first dispatch started inside addSource, before the watch.
    source.succeed()
    expect(onRecovered).toHaveBeenCalledTimes(1)
  })

  it('stops listening when stopped', () => {
    const source = createFakeSource()
    const watch = watchTrackingSourceUpdates(source, { startFailed: false, onFailure: vi.fn(), onRecovered: vi.fn() })
    expect(source.listenerCount()).toBeGreaterThan(0)
    watch.stop()
    expect(source.listenerCount()).toBe(0)
  })
})
