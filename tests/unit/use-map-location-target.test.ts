import React, { type RefObject } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type maplibregl from 'maplibre-gl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useMapTargetStore } from '../../src/features/map/map-target-store'
import { useMapLocationTarget } from '../../src/features/map/use-map-location-target'
import { applyMapStylePreservingCamera } from '../../src/features/map/apply-map-style-preserving-camera'

type MapEventName = 'idle' | 'style.load' | 'styledata' | 'styledataloading'
type MapEventListener = () => void
type StyleLayer = { readonly id: string }
const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}

describe('useMapLocationTarget', () => {
  let root: Root | null = null
  let host: HTMLDivElement | null = null

  beforeEach(() => {
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(() => {
    if (root !== null) {
      act(() => root?.unmount())
    }
    host?.remove()
    root = null
    host = null
    useMapTargetStore.setState(useMapTargetStore.getInitialState())
    vi.useRealTimers()
    reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = undefined
  })

  it('applies a repeated Go To after the prior target has expired [AUD-06]', () => {
    const harness = createMapHarness({
      styleLoaded: true,
      styleLayers: [{ id: 'base-layer' }],
    })
    renderHook(harness.map)

    act(() => {
      useMapTargetStore.getState().queueTarget(52.274681, -9.530912, 'First target')
    })
    const firstTarget = useMapTargetStore.getState().activeTarget
    expect(firstTarget).not.toBeNull()
    expect(harness.flyTo).toHaveBeenCalledTimes(1)

    act(() => {
      useMapTargetStore.getState().clearActiveTarget(firstTarget!.id)
    })
    act(() => {
      useMapTargetStore.getState().queueTarget(52.275681, -9.531912, 'Second target')
    })

    expect(harness.flyTo).toHaveBeenCalledTimes(2)
    expect(harness.flyTo).toHaveBeenLastCalledWith({
      center: [-9.531912, 52.275681],
      zoom: 14,
      essential: true,
    })
  })

  it('prevents delayed basemap restoration from overwriting a newer Go To [AUD-06]', () => {
    const harness = createMapHarness({ styleLoaded: true, styleLayers: [{ id: 'base' }] })
    renderHook(harness.map)
    applyMapStylePreservingCamera(harness.map, { version: 8, sources: {}, layers: [] })
    act(() => {
      useMapTargetStore.getState().queueTarget(52.274681, -9.530912)
    })
    expect(harness.flyTo).toHaveBeenCalledOnce()
    harness.emit('styledata')
    expect(harness.jumpTo).not.toHaveBeenCalled()
  })

  it('restores the active target after a style replacement completes [AUD-06]', () => {
    const harness = createMapHarness({
      styleLoaded: true,
      styleLayers: [{ id: 'base-layer' }],
    })
    renderHook(harness.map)

    act(() => {
      useMapTargetStore.getState().queueTarget(52.274681, -9.530912, 'Coordinate target')
    })
    expect(harness.addSource).toHaveBeenCalledTimes(1)

    harness.replaceStyle({ styleLoaded: false, styleLayers: [] })
    harness.emit('styledata')
    harness.replaceStyle({ styleLoaded: true, styleLayers: [{ id: 'base-layer' }] })
    harness.emit('style.load')

    expect(harness.addSource).toHaveBeenCalledTimes(2)
    expect(harness.addLayer).toHaveBeenCalledTimes(4)
    expect(harness.addSource.mock.calls.at(-1)?.[1]).toMatchObject({
      type: 'geojson',
      data: {
        features: [
          {
            geometry: {
              coordinates: [-9.530912, 52.274681],
            },
          },
        ],
      },
    })
  })

  it('attaches only the latest repeated Go To once a loading style becomes usable [AUD-06]', () => {
    const harness = createMapHarness({ styleLoaded: false, styleLayers: [] })
    renderHook(harness.map)

    act(() => {
      useMapTargetStore.getState().queueTarget(52.274681, -9.530912, 'First target')
    })
    act(() => {
      useMapTargetStore.getState().queueTarget(52.275681, -9.531912, 'Latest target')
    })

    expect(useMapTargetStore.getState().activeTarget).toMatchObject({
      latitude: 52.275681,
      longitude: -9.531912,
      label: 'Latest target',
    })
    expect(harness.addSource).not.toHaveBeenCalled()

    harness.replaceStyle({ styleLoaded: true, styleLayers: [{ id: 'base-layer' }] })
    harness.emit('style.load')

    expect(harness.addSource).toHaveBeenCalledOnce()
    expect(harness.addSource.mock.calls[0]?.[1]).toMatchObject({
      type: 'geojson',
      data: {
        features: [
          {
            geometry: {
              coordinates: [-9.531912, 52.275681],
            },
          },
        ],
      },
    })
  })

  it('does not resurrect an expired target when a later style event arrives [AUD-06]', () => {
    vi.useFakeTimers()
    const harness = createMapHarness({
      styleLoaded: true,
      styleLayers: [{ id: 'base-layer' }],
    })
    renderHook(harness.map)

    act(() => {
      useMapTargetStore.getState().queueTarget(52.274681, -9.530912, 'Expiring target')
    })
    expect(harness.addSource).toHaveBeenCalledOnce()

    act(() => {
      vi.advanceTimersByTime(8_000)
    })
    expect(useMapTargetStore.getState().activeTarget).toBeNull()

    harness.replaceStyle({ styleLoaded: true, styleLayers: [{ id: 'replacement-layer' }] })
    harness.emit('style.load')
    harness.emit('idle')

    expect(harness.addSource).toHaveBeenCalledOnce()
  })

  /** Mounts the target hook against a minimal map reference. */
  function renderHook(map: maplibregl.Map): void {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    const mapRef = { current: map } as RefObject<maplibregl.Map | null>
    act(() => {
      root?.render(React.createElement(TargetProbe, { mapRef }))
    })
  }
})

/** Exercises the target hook without introducing a component rendering surface. */
function TargetProbe(props: { readonly mapRef: RefObject<maplibregl.Map | null> }): null {
  useMapLocationTarget({ mapRef: props.mapRef })
  return null
}

/** Creates the minimal MapLibre event/style surface required by the target hook. */
function createMapHarness(input: {
  readonly styleLayers: readonly StyleLayer[]
  readonly styleLoaded: boolean
}): {
  readonly addLayer: ReturnType<typeof vi.fn>
  readonly addSource: ReturnType<typeof vi.fn>
  readonly emit: (event: MapEventName) => void
  readonly flyTo: ReturnType<typeof vi.fn>
  readonly jumpTo: ReturnType<typeof vi.fn>
  readonly map: maplibregl.Map
  readonly replaceStyle: (next: {
    readonly styleLayers: readonly StyleLayer[]
    readonly styleLoaded: boolean
  }) => void
} {
  const listeners = new Map<MapEventName, Set<MapEventListener>>()
  const layers = new Set<string>()
  let styleLayers = [...input.styleLayers]
  let styleLoaded = input.styleLoaded
  let source: { readonly setData: ReturnType<typeof vi.fn> } | undefined
  const addLayer = vi.fn((layer: { readonly id: string }) => {
    layers.add(layer.id)
  })
  const addSource = vi.fn((_id: string, definition: unknown) => {
    source = { setData: vi.fn() }
    return definition
  })
  const flyTo = vi.fn()
  const jumpTo = vi.fn()
  const map = {
    addLayer,
    addSource,
    flyTo,
    jumpTo,
    getCenter: () => ({ lng: -9.74, lat: 51.99 }),
    getBearing: () => 0,
    getPitch: () => 0,
    setStyle: vi.fn(),
    once: (event: MapEventName, listener: MapEventListener) => {
      const wrapped = () => { listeners.get(event)?.delete(wrapped); listener() }
      const eventListeners = listeners.get(event) ?? new Set<MapEventListener>()
      eventListeners.add(wrapped)
      listeners.set(event, eventListeners)
    },
    getLayer: (id: string) => (layers.has(id) ? { id } : undefined),
    getSource: () => source,
    getZoom: () => 10,
    getStyle: () => ({ layers: styleLayers }),
    isStyleLoaded: () => styleLoaded,
    on: (event: MapEventName, listener: MapEventListener) => {
      const eventListeners = listeners.get(event) ?? new Set<MapEventListener>()
      eventListeners.add(listener)
      listeners.set(event, eventListeners)
      return map
    },
    off: (event: MapEventName, listener: MapEventListener) => {
      listeners.get(event)?.delete(listener)
      return map
    },
  } as unknown as maplibregl.Map

  return {
    addLayer,
    addSource,
    emit: (event) => {
      listeners.get(event)?.forEach((listener) => listener())
    },
    flyTo,
    jumpTo,
    map,
    replaceStyle: (next) => {
      styleLayers = [...next.styleLayers]
      styleLoaded = next.styleLoaded
      source = undefined
      layers.clear()
    },
  }
}
