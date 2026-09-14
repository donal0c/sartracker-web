import React, { type RefObject } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type maplibregl from 'maplibre-gl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useMapTargetStore } from '../../src/features/map/map-target-store'
import { useMapLocationTarget } from '../../src/features/map/use-map-location-target'
import { applyMapStylePreservingCamera } from '../../src/features/map/apply-map-style-preserving-camera'

type MapEventName = 'idle' | 'style.load' | 'styledata' | 'styledataloading' | 'movestart' | 'error' | 'remove'
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
    }, { coordinateNavigation: true })
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

    expect(harness.jumpTo).toHaveBeenLastCalledWith(expect.objectContaining({
      center: [-9.530912, 52.274681],
    }), expect.anything())

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

  it('settles at the destination when basemap replacement interrupts an in-flight Go To', () => {
    const harness = createMapHarness({ styleLoaded: true, styleLayers: [{ id: 'base' }] })
    renderHook(harness.map)
    act(() => useMapTargetStore.getState().queueTarget(52.274681, -9.530912))
    // Harness getCenter remains at an intermediate frame, not the flyTo destination.
    applyMapStylePreservingCamera(harness.map, { version: 8, sources: {}, layers: [] })
    harness.emit('style.load')
    expect(harness.jumpTo).toHaveBeenLastCalledWith(expect.objectContaining({
      center: [-9.530912, 52.274681], zoom: 14,
    }), expect.anything())
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

  it('keeps an attachment pending when a layer add is a silent no-op, then attaches after retry', () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const harness = createMapHarness({
      styleLoaded: true,
      styleLayers: [{ id: 'base-layer' }],
    })
    harness.addLayer.mockImplementationOnce(() => undefined)
    renderHook(harness.map)

    act(() => {
      useMapTargetStore.getState().queueTarget(52.274681, -9.530912, 'Retrying target')
    })

    expect(useMapTargetStore.getState().activeTarget).toMatchObject({
      attached: false,
      expiresAt: 30_000,
    })
    expect(harness.map.getSource('coordinate-target')).toBeDefined()
    expect(harness.map.getLayer('coordinate-target-ring')).toBeUndefined()
    expect(harness.map.getLayer('coordinate-target-dot')).toBeDefined()

    harness.emit('idle')

    expect(useMapTargetStore.getState().activeTarget).toMatchObject({
      attached: true,
      expiresAt: 8_000,
    })
    expect(harness.map.getLayer('coordinate-target-ring')).toBeDefined()
    expect(harness.map.getLayer('coordinate-target-dot')).toBeDefined()
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

  it('does not fly or restore a stale target after unmount at 4 seconds and remount at 60 seconds [AUD-06]', () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const firstMap = createMapHarness({ styleLoaded: false, styleLayers: [] })
    renderHook(firstMap.map)

    act(() => {
      useMapTargetStore.getState().queueTarget(52.274681, -9.530912, 'Stale target')
      vi.advanceTimersByTime(4_000)
    })
    expect(firstMap.flyTo).toHaveBeenCalledOnce()
    expect(firstMap.addSource).not.toHaveBeenCalled()

    unmountHook()
    vi.setSystemTime(60_000)

    const remountedMap = createMapHarness({
      styleLoaded: true,
      styleLayers: [{ id: 'base-layer' }],
    })
    renderHook(remountedMap.map, 2)

    expect(useMapTargetStore.getState().activeTarget).toBeNull()
    expect(remountedMap.flyTo).not.toHaveBeenCalled()
    expect(remountedMap.addSource).not.toHaveBeenCalled()
    expect(remountedMap.addLayer).not.toHaveBeenCalled()
    expect(remountedMap.map.getSource('coordinate-target')).toBeUndefined()
    expect(remountedMap.map.getLayer('coordinate-target-ring')).toBeUndefined()
    expect(remountedMap.map.getLayer('coordinate-target-dot')).toBeUndefined()
  })

  it('replays an active target onto a recreated map without extending its original deadline [AUD-06]', () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const firstMap = createMapHarness({
      styleLoaded: true,
      styleLayers: [{ id: 'base-layer' }],
    })
    renderHook(firstMap.map)

    act(() => {
      useMapTargetStore.getState().queueTarget(52.274681, -9.530912, 'Recreated target')
    })
    const firstTarget = useMapTargetStore.getState().activeTarget
    expect(firstTarget).toMatchObject({ attached: true, expiresAt: 8_000 })

    act(() => {
      vi.advanceTimersByTime(4_000)
    })
    const recreatedMap = createMapHarness({
      styleLoaded: true,
      styleLayers: [{ id: 'replacement-layer' }],
    })
    renderHook(recreatedMap.map, 2)

    expect(recreatedMap.flyTo).toHaveBeenCalledWith({
      center: [-9.530912, 52.274681],
      zoom: 14,
      essential: true,
    }, { coordinateNavigation: true })
    expect(recreatedMap.addSource).toHaveBeenCalledOnce()
    expect(recreatedMap.addLayer).toHaveBeenCalledTimes(2)
    expect(useMapTargetStore.getState().activeTarget).toMatchObject({
      id: firstTarget?.id,
      attached: true,
      expiresAt: 8_000,
    })

    act(() => {
      vi.advanceTimersByTime(3_999)
    })
    expect(useMapTargetStore.getState().isTargetCurrent(firstTarget!.id)).toBe(true)
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(useMapTargetStore.getState().activeTarget).toBeNull()
  })

  it('expires an unattached request after 30 seconds when no style becomes usable, with no late resurrection [AUD-06]', () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const harness = createMapHarness({ styleLoaded: false, styleLayers: [] })
    renderHook(harness.map)

    act(() => {
      useMapTargetStore.getState().queueTarget(52.274681, -9.530912, 'Unattached target')
    })
    const target = useMapTargetStore.getState().activeTarget
    expect(target).toMatchObject({ attached: false, expiresAt: 30_000 })
    expect(harness.addSource).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(30_000)
    })
    expect(useMapTargetStore.getState().activeTarget).toBeNull()

    harness.replaceStyle({ styleLoaded: true, styleLayers: [{ id: 'late-layer' }] })
    harness.emit('style.load')
    harness.emit('idle')

    expect(harness.addSource).not.toHaveBeenCalled()
    expect(harness.addLayer).not.toHaveBeenCalled()
    expect(target).not.toBeNull()
  })

  it('rejects an expired target before its queued timer flushes, so a later style event cannot attach it [AUD-06]', () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const harness = createMapHarness({ styleLoaded: false, styleLayers: [] })
    renderHook(harness.map)

    act(() => {
      useMapTargetStore.getState().queueTarget(52.274681, -9.530912, 'Clock-expired target')
    })
    const targetId = useMapTargetStore.getState().activeTarget!.id

    act(() => {
      vi.setSystemTime(30_001)
    })
    expect(useMapTargetStore.getState().isTargetCurrent(targetId)).toBe(false)
    expect(useMapTargetStore.getState().activeTarget).toBeNull()

    harness.replaceStyle({ styleLoaded: true, styleLayers: [{ id: 'late-layer' }] })
    harness.emit('style.load')
    harness.emit('idle')

    expect(harness.addSource).not.toHaveBeenCalled()
    expect(harness.addLayer).not.toHaveBeenCalled()
  })

  /** Mounts the target hook against a minimal map reference. */
  function renderHook(map: maplibregl.Map, mapReadyVersion = 1): void {
    if (root === null) {
      host = document.createElement('div')
      document.body.append(host)
      root = createRoot(host)
    }
    const mapRef = { current: map } as RefObject<maplibregl.Map | null>
    act(() => {
      root?.render(React.createElement(TargetProbe, { mapRef, mapReadyVersion }))
    })
  }

  /** Unmounts the hook while leaving the target store available for a remount. */
  function unmountHook(): void {
    if (root !== null) {
      act(() => root?.unmount())
    }
    root = null
    host?.remove()
    host = null
  }
})

/** Exercises the target hook without introducing a component rendering surface. */
function TargetProbe(props: {
  readonly mapRef: RefObject<maplibregl.Map | null>
  readonly mapReadyVersion: number
}): null {
  useMapLocationTarget({ mapRef: props.mapRef, mapReadyVersion: props.mapReadyVersion })
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
