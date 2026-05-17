import { describe, expect, it, vi } from 'vitest'

import { applyMapStylePreservingCamera } from '../../src/features/map/apply-map-style-preserving-camera'

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
})
