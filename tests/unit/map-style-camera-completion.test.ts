import { afterEach, describe, expect, it, vi } from 'vitest'
import { Evented, type Map as MapLibreMap } from 'maplibre-gl'
import { applyMapStylePreservingCamera } from '../../src/features/map/apply-map-style-preserving-camera'

const style = { version: 8 as const, sources: {}, layers: [] }

/** Models synchronous MapLibre event ordering without forgiving missing events. */
function createMap() {
  const events = new Evented()
  const map = Object.assign(events, {
    getCenter: () => ({ lng: -9.7, lat: 52 }),
    getZoom: () => 13,
    getBearing: () => 20,
    getPitch: () => 30,
    getStyle: vi.fn(() => ({ version: 8, sources: {}, layers: [{ id: 'previous', type: 'background' }] })),
    setStyle: vi.fn(),
    jumpTo: vi.fn(),
  })
  return map
}

describe('basemap camera completion boundary', () => {
  afterEach(() => vi.useRealTimers())

  it('ignores overlay styledata and restores only when the replacement style loads', () => {
    const map = createMap()
    applyMapStylePreservingCamera(map as unknown as MapLibreMap, style)
    map.fire('styledata')
    expect(map.jumpTo).not.toHaveBeenCalled()
    map.fire('style.load')
    expect(map.jumpTo).toHaveBeenCalledOnce()
    expect(map.listens('style.load')).toBeFalsy()
  })

  it('observes inline style.load fired synchronously inside setStyle', () => {
    const map = createMap()
    map.setStyle.mockImplementation(() => map.fire('style.load'))
    applyMapStylePreservingCamera(map as unknown as MapLibreMap, style)
    expect(map.jumpTo).toHaveBeenCalledOnce()
  })

  it('disposes listeners when the map is removed before completion', () => {
    const map = createMap()
    applyMapStylePreservingCamera(map as unknown as MapLibreMap, style)
    map.fire('remove')
    expect(map.listens('styledata')).toBeFalsy()
    expect(map.listens('style.load')).toBeFalsy()
    map.fire('style.load')
    expect(map.jumpTo).not.toHaveBeenCalled()
  })

  it.each(['throw', 'error', 'timeout'] as const)('reports %s failure and removes all pending listeners', (mode) => {
    vi.useFakeTimers()
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const map = createMap()
    const failure = vi.fn()
    if (mode === 'throw') map.setStyle.mockImplementation(() => { throw new Error('invalid style') })
    expect(() => applyMapStylePreservingCamera(map as unknown as MapLibreMap, style, { onFailure: failure })).not.toThrow()
    if (mode === 'error') map.fire('error', { error: new Error('style unavailable') })
    if (mode === 'timeout') vi.advanceTimersByTime(30_000)
    expect(failure).toHaveBeenCalledWith(expect.stringContaining('Choose another basemap'))
    expect(map.jumpTo).toHaveBeenCalledOnce()
    expect(map.listens('style.load')).toBeFalsy()
    expect(map.listens('error')).toBeFalsy()
    expect(map.listens('remove')).toBeFalsy()
    expect(vi.getTimerCount()).toBe(0)
    log.mockRestore()
  })

  it('does not treat a tile failure as failure to apply a style', () => {
    const map = createMap()
    const failure = vi.fn()
    applyMapStylePreservingCamera(map as unknown as MapLibreMap, style, { onFailure: failure })
    map.fire('error', { error: new Error('tile unavailable'), tile: {} })
    expect(failure).not.toHaveBeenCalled()
    map.fire('style.load')
    expect(map.jumpTo).toHaveBeenCalledOnce()
  })

  it('does not leave a false failure timer for an identical already-applied style', () => {
    vi.useFakeTimers()
    const map = createMap()
    const failure = vi.fn()
    map.getStyle.mockReturnValue(style)
    const unchanged = vi.fn()
    applyMapStylePreservingCamera(map as unknown as MapLibreMap, style, { onFailure: failure, onUnchanged: unchanged })
    expect(map.setStyle).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
    expect(map.listens('style.load')).toBeFalsy()
    expect(unchanged).toHaveBeenCalledOnce()
  })
})
