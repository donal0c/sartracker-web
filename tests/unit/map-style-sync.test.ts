import type maplibregl from 'maplibre-gl'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { registerMapStyleSync } from '../../src/features/map/map-style-sync'

type MapEventName = 'idle' | 'style.load' | 'styledata'
type MapEventListener = () => void

describe('registerMapStyleSync', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('synchronizes overlays while raster basemap tiles are still pending [DON-262]', () => {
    const harness = createMapHarness({
      styleLayers: [{ id: 'opentopomap-layer' }],
      styleLoaded: false,
    })
    const synchronize = vi.fn()

    const dispose = registerMapStyleSync(harness.map, synchronize)

    expect(synchronize).toHaveBeenCalledTimes(1)
    dispose()
  })

  it('waits for style structure and responds to style.load without waiting for tiles', () => {
    vi.useFakeTimers()
    const harness = createMapHarness({
      styleLayers: [],
      styleLoaded: false,
    })
    const synchronize = vi.fn()

    const dispose = registerMapStyleSync(harness.map, synchronize)
    expect(synchronize).not.toHaveBeenCalled()

    harness.setStyleLayers([{ id: 'opentopomap-layer' }])
    harness.emit('style.load')

    expect(synchronize).toHaveBeenCalledTimes(1)
    dispose()
  })

  it('reports a transient overlay failure and retries instead of dropping synchronization', () => {
    vi.useFakeTimers()
    const harness = createMapHarness({
      styleLayers: [{ id: 'opentopomap-layer' }],
      styleLoaded: false,
    })
    const error = new Error('Style changed during overlay synchronization.')
    const synchronize = vi.fn()
      .mockImplementationOnce(() => {
        throw error
      })
      .mockImplementationOnce(() => undefined)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const dispose = registerMapStyleSync(harness.map, synchronize)
    expect(synchronize).toHaveBeenCalledTimes(1)
    expect(consoleError).toHaveBeenCalledWith(
      'Map overlay synchronization failed; retrying.',
      error,
    )

    vi.advanceTimersByTime(50)
    expect(synchronize).toHaveBeenCalledTimes(2)

    dispose()
    consoleError.mockRestore()
  })

  it('retries an asynchronous overlay rejection after icon loading [DON-263]', async () => {
    vi.useFakeTimers()
    const harness = createMapHarness({
      styleLayers: [{ id: 'opentopomap-layer' }],
      styleLoaded: false,
    })
    const error = new Error('Style changed after the marker icon loaded.')
    const synchronize = vi.fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce(undefined)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const dispose = registerMapStyleSync(harness.map, synchronize)
    expect(synchronize).toHaveBeenCalledTimes(1)
    await Promise.resolve()
    expect(consoleError).toHaveBeenCalledWith(
      'Map overlay synchronization failed; retrying.',
      error,
    )

    await vi.advanceTimersByTimeAsync(50)
    expect(synchronize).toHaveBeenCalledTimes(2)

    dispose()
    consoleError.mockRestore()
  })

  it('coalesces style events while asynchronous overlay synchronization is in flight', async () => {
    const harness = createMapHarness({
      styleLayers: [{ id: 'opentopomap-layer' }],
      styleLoaded: false,
    })
    let resolveFirstSync = () => undefined
    const firstSync = new Promise<void>((resolve) => {
      resolveFirstSync = resolve
    })
    const synchronize = vi.fn()
      .mockReturnValueOnce(firstSync)
      .mockResolvedValueOnce(undefined)

    const dispose = registerMapStyleSync(harness.map, synchronize)
    harness.emit('style.load')
    harness.emit('idle')

    expect(synchronize).toHaveBeenCalledTimes(1)
    resolveFirstSync()
    await Promise.resolve()
    await Promise.resolve()
    expect(synchronize).toHaveBeenCalledTimes(2)

    dispose()
  })

  it('does not retry an asynchronous rejection after disposal', async () => {
    vi.useFakeTimers()
    const harness = createMapHarness({
      styleLayers: [{ id: 'opentopomap-layer' }],
      styleLoaded: false,
    })
    let rejectSync: (error: Error) => void = () => undefined
    const pendingSync = new Promise<void>((_resolve, reject) => {
      rejectSync = reject
    })
    const synchronize = vi.fn(() => pendingSync)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const dispose = registerMapStyleSync(harness.map, synchronize)
    dispose()
    rejectSync(new Error('Late disposed overlay failure.'))
    await Promise.resolve()
    await vi.runAllTimersAsync()

    expect(synchronize).toHaveBeenCalledTimes(1)
    expect(consoleError).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('aborts in-flight synchronization when the registration is disposed', async () => {
    const harness = createMapHarness({
      styleLayers: [{ id: 'opentopomap-layer' }],
      styleLoaded: false,
    })
    let observedSignal: AbortSignal | null = null
    let releaseSynchronization = () => undefined
    const pendingSynchronization = new Promise<void>((resolve) => {
      releaseSynchronization = resolve
    })
    const synchronize = vi.fn(async (signal: AbortSignal) => {
      observedSignal = signal
      await pendingSynchronization
    })

    const dispose = registerMapStyleSync(harness.map, synchronize)
    expect(observedSignal?.aborted).toBe(false)

    dispose()
    expect(observedSignal?.aborted).toBe(true)
    releaseSynchronization()
    await pendingSynchronization
  })

  it('does not re-enter synchronization for source-driven styledata events', () => {
    const harness = createMapHarness({
      styleLayers: [{ id: 'opentopomap-layer' }],
      styleLoaded: false,
    })
    const synchronize = vi.fn()

    const dispose = registerMapStyleSync(harness.map, synchronize)
    expect(synchronize).toHaveBeenCalledTimes(1)

    harness.emit('styledata')

    expect(synchronize).toHaveBeenCalledTimes(1)
    dispose()
  })

  it('backs persistent failures off to a bounded retry interval', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(0))
    const callTimes: number[] = []
    const synchronize = vi.fn(() => {
      callTimes.push(Date.now())
      throw new Error('Persistent style failure.')
    })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const harness = createMapHarness({
      styleLayers: [{ id: 'opentopomap-layer' }],
      styleLoaded: false,
    })

    const dispose = registerMapStyleSync(harness.map, synchronize)
    for (let attempt = 0; attempt < 8; attempt += 1) {
      vi.advanceTimersToNextTimer()
    }

    expect(callTimes).toEqual([
      0,
      50,
      150,
      350,
      750,
      1_550,
      3_150,
      5_150,
      7_150,
    ])

    dispose()
    consoleError.mockRestore()
  })
})

/** Creates the minimal MapLibre event/style surface required by the synchronizer. */
function createMapHarness(input: {
  readonly styleLayers: readonly { readonly id: string }[]
  readonly styleLoaded: boolean
}): {
  readonly emit: (event: MapEventName) => void
  readonly map: maplibregl.Map
  readonly setStyleLayers: (layers: readonly { readonly id: string }[]) => void
} {
  const listeners = new Map<MapEventName, Set<MapEventListener>>()
  let styleLayers = [...input.styleLayers]
  const map = {
    getStyle: () => ({
      layers: styleLayers,
      sources: {},
      version: 8,
    }),
    isStyleLoaded: () => input.styleLoaded,
    off: (event: MapEventName, listener: MapEventListener) => {
      listeners.get(event)?.delete(listener)
    },
    on: (event: MapEventName, listener: MapEventListener) => {
      const eventListeners = listeners.get(event) ?? new Set<MapEventListener>()
      eventListeners.add(listener)
      listeners.set(event, eventListeners)
    },
  } as unknown as maplibregl.Map

  return {
    emit: (event) => {
      for (const listener of listeners.get(event) ?? []) {
        listener()
      }
    },
    map,
    setStyleLayers: (layers) => {
      styleLayers = [...layers]
    },
  }
}
