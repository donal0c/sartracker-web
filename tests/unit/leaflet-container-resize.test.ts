import { afterEach, describe, expect, it, vi } from 'vitest'

import { keepLeafletSizedToContainer } from '../../src/features/map/leaflet-container-resize'

type Callback = () => void
const observers: { callback: Callback; observed: Element[]; disconnected: boolean }[] = []

class FakeResizeObserver {
  private readonly entry: { callback: Callback; observed: Element[]; disconnected: boolean }
  constructor(callback: Callback) {
    this.entry = { callback, observed: [], disconnected: false }
    observers.push(this.entry)
  }
  observe(element: Element): void { this.entry.observed.push(element) }
  disconnect(): void { this.entry.disconnected = true }
}

afterEach(() => {
  observers.length = 0
  vi.unstubAllGlobals()
})

describe('Leaflet fallback follows its container [DON-368]', () => {
  it('recomputes the map size when a docked panel narrows the map without a window resize', () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    const container = {} as HTMLElement
    const map = { invalidateSize: vi.fn() }

    const release = keepLeafletSizedToContainer(map, container)
    expect(observers[0]?.observed).toEqual([container])

    observers[0]?.callback()
    expect(map.invalidateSize).toHaveBeenCalledWith({ pan: false })

    release()
    expect(observers[0]?.disconnected).toBe(true)
  })
})
