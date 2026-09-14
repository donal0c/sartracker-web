import { afterEach, describe, expect, it, vi } from 'vitest'
import { Evented, type Map as MapLibreMap } from 'maplibre-gl'
import { applyMapStylePreservingCamera } from '../../src/features/map/apply-map-style-preserving-camera'
import { navigateMapToTarget } from '../../src/features/map/map-camera-navigation'

const style = { version: 8 as const, sources: {}, layers: [] }

/** Real event dispatch with independently mutable camera state. */
function createMap() {
  let camera = { center: [-9.74, 52] as [number, number], zoom: 13, bearing: 22, pitch: 48 }
  const events = new Evented()
  const map = Object.assign(events, {
    getCenter: () => ({ lng: camera.center[0], lat: camera.center[1] }),
    getZoom: () => camera.zoom,
    getBearing: () => camera.bearing,
    getPitch: () => camera.pitch,
    getStyle: () => ({ version: 8, sources: {}, layers: [{ id: 'previous', type: 'background' }] }),
    setStyle: vi.fn(),
    flyTo: vi.fn(),
    jumpTo: vi.fn((next: typeof camera) => { camera = next }),
  })
  return { map, camera: () => camera }
}

describe('applyMapStylePreservingCamera ownership', () => {
  afterEach(() => vi.restoreAllMocks())

  it('preserves the full ordinary camera at the completed style boundary', () => {
    const { map, camera } = createMap()
    const original = camera()
    applyMapStylePreservingCamera(map as unknown as MapLibreMap, style)
    map.jumpTo({ center: [0, 0], zoom: 0, bearing: 0, pitch: 0 })
    map.fire('style.load')
    expect(camera()).toEqual(original)
  })

  it('retargets a pending restoration to newer navigation instead of cancelling its safety net', () => {
    const { map, camera } = createMap()
    applyMapStylePreservingCamera(map as unknown as MapLibreMap, style)
    const release = navigateMapToTarget(map as unknown as MapLibreMap, [-9.5, 52.2], () => true)
    map.jumpTo({ center: [0, 0], zoom: 0, bearing: 0, pitch: 0 })
    map.fire('style.load')
    expect(camera()).toEqual({ center: [-9.5, 52.2], zoom: 14, bearing: 22, pitch: 48 })
    release()
  })

  it('removes the previous restoration listener on an overlapping switch', () => {
    const { map, camera } = createMap()
    applyMapStylePreservingCamera(map as unknown as MapLibreMap, style)
    map.jumpTo({ center: [-9.5, 52.2], zoom: 14, bearing: 0, pitch: 0 })
    applyMapStylePreservingCamera(map as unknown as MapLibreMap, style)
    map.jumpTo.mockClear()
    map.fire('style.load')
    expect(map.jumpTo).toHaveBeenCalledOnce()
    expect(camera().center).toEqual([-9.5, 52.2])
  })

  it('releases navigation when the operator moves, so a later style preserves their view', () => {
    const { map, camera } = createMap()
    const release = navigateMapToTarget(map as unknown as MapLibreMap, [-9.5, 52.2], () => true)
    map.fire('movestart', { originalEvent: { type: 'pointerdown' } })
    const operatorCamera = { center: [-9.8, 52.1] as [number, number], zoom: 12, bearing: 10, pitch: 20 }
    map.jumpTo(operatorCamera)
    applyMapStylePreservingCamera(map as unknown as MapLibreMap, style)
    map.fire('style.load')
    expect(camera()).toEqual(operatorCamera)
    release()
  })
})
