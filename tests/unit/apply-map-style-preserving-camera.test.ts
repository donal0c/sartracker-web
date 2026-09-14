import { describe, expect, it, vi } from 'vitest'

import {
  applyMapStylePreservingCamera,
  cancelPendingMapStyleCameraRestore,
} from '../../src/features/map/apply-map-style-preserving-camera'

describe('applyMapStylePreservingCamera', () => {
  it('restores the original camera once after the replacement style is ready', () => {
    let styleDataHandler: (() => void) | null = null
    const setStyle = vi.fn()
    const jumpTo = vi.fn()

    applyMapStylePreservingCamera(
      {
        getCenter: () => ({ lng: -9.74406, lat: 51.99917 }),
        getZoom: () => 13.75,
        getBearing: () => 22,
        getPitch: () => 48,
        setStyle,
        once: (event, handler) => {
          expect(event).toBe('styledata')
          styleDataHandler = handler
          return {} as never
        },
        jumpTo,
      },
      {
        version: 8,
        sources: {},
        layers: [],
      },
    )

    expect(setStyle).toHaveBeenCalledTimes(1)
    expect(jumpTo).not.toHaveBeenCalled()

    styleDataHandler?.()

    expect(jumpTo).toHaveBeenCalledTimes(1)
    expect(jumpTo).toHaveBeenCalledWith({
      center: [-9.74406, 51.99917],
      zoom: 13.75,
      bearing: 22,
      pitch: 48,
    })
  })

  it('does not restore a cancelled camera snapshot after a newer navigation request', () => {
    let styleDataHandler: (() => void) | null = null
    const jumpTo = vi.fn()
    const map = {
      getCenter: () => ({ lng: -9.74406, lat: 51.99917 }),
      getZoom: () => 13.75,
      getBearing: () => 22,
      getPitch: () => 48,
      setStyle: vi.fn(),
      once: vi.fn((_event: string, handler: () => void) => {
        styleDataHandler = handler
        return {} as never
      }),
      jumpTo,
    }

    applyMapStylePreservingCamera(map, {
      version: 8,
      sources: {},
      layers: [],
    })
    cancelPendingMapStyleCameraRestore(map)

    styleDataHandler?.()

    expect(jumpTo).not.toHaveBeenCalled()
  })

  it('allows only the latest overlapping style restoration to move the camera', () => {
    const styleDataHandlers: Array<() => void> = []
    const jumpTo = vi.fn()
    let camera = {
      center: [-9.74406, 51.99917] as [number, number],
      zoom: 13.75,
      bearing: 22,
      pitch: 48,
    }
    const map = {
      getCenter: () => ({ lng: camera.center[0], lat: camera.center[1] }),
      getZoom: () => camera.zoom,
      getBearing: () => camera.bearing,
      getPitch: () => camera.pitch,
      setStyle: vi.fn(),
      once: vi.fn((_event: string, handler: () => void) => {
        styleDataHandlers.push(handler)
        return {} as never
      }),
      jumpTo: vi.fn((next: typeof camera) => {
        camera = next
        jumpTo(next)
      }),
    }

    applyMapStylePreservingCamera(map, {
      version: 8,
      sources: {},
      layers: [],
    })
    camera = {
      center: [-9.464944, 52.179337],
      zoom: 14,
      bearing: 0,
      pitch: 0,
    }
    applyMapStylePreservingCamera(map, {
      version: 8,
      sources: {},
      layers: [],
    })

    styleDataHandlers[0]?.()
    expect(jumpTo).not.toHaveBeenCalled()

    styleDataHandlers[1]?.()
    expect(jumpTo).toHaveBeenCalledOnce()
    expect(jumpTo).toHaveBeenCalledWith({
      center: [-9.464944, 52.179337],
      zoom: 14,
      bearing: 0,
      pitch: 0,
    })
  })
})
