import { describe, expect, it, vi } from 'vitest'

import { applyMapStylePreservingCamera } from '../../src/features/map/apply-map-style-preserving-camera'

describe('applyMapStylePreservingCamera', () => {
  it('restores the active camera after a basemap style swap', () => {
    let idleHandler: (() => void) | null = null
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
          expect(event).toBe('idle')
          idleHandler = handler
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
    expect(jumpTo).toHaveBeenNthCalledWith(1, {
      center: [-9.74406, 51.99917],
      zoom: 13.75,
      bearing: 22,
      pitch: 48,
    })

    idleHandler?.()

    expect(jumpTo).toHaveBeenNthCalledWith(2, {
      center: [-9.74406, 51.99917],
      zoom: 13.75,
      bearing: 22,
      pitch: 48,
    })
  })
})
