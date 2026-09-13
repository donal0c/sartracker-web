import { describe, expect, it, vi } from 'vitest'
import { refreshOfficialMapRaster } from '../../src/features/map/official-map-raster-refresh'

const sourceId = 'official_discovery_topo'
const layerId = `${sourceId}-layer`

/** Models structural MapLibre mutations independently of pending tile/source completion. */
function fixture() {
  const state = {initialized: true, source: true, layers: [layerId, 'markers', 'pending-overlay'],
    failRemoveLayer: false, failRemoveSource: false, failAddSource: false, failAddLayer: false}
  const calls: string[] = []
  const map = {
    isStyleLoaded: vi.fn(() => false),
    isSourceLoaded: vi.fn(() => false),
    getStyle: () => state.initialized ? {layers: state.layers.map(id => ({id}))} : undefined,
    getLayer: (id: string) => state.layers.includes(id) ? {id} : undefined,
    getSource: (id: string) => id === sourceId && state.source ? {} : undefined,
    removeLayer: vi.fn((id: string) => {
      calls.push('removeLayer')
      if (!state.failRemoveLayer) state.layers = state.layers.filter(layer => layer !== id)
    }),
    removeSource: vi.fn(() => { calls.push('removeSource'); if (!state.failRemoveSource) state.source = false }),
    addSource: vi.fn(() => { calls.push('addSource'); if (!state.failAddSource) state.source = true }),
    addLayer: vi.fn((layer: {id: string}, before?: string) => {
      calls.push('addLayer')
      if (!state.failAddLayer) state.layers.splice(before === undefined ? state.layers.length : state.layers.indexOf(before), 0, layer.id)
    }),
  }
  return {state, map, calls}
}

describe('official map raster freshness', () => {
  it('evicts resident raster while unrelated sources or official tiles are pending', () => {
    const {map, calls, state} = fixture()
    expect(refreshOfficialMapRaster(map as never, sourceId, 8)).toBe(true)
    expect(calls).toEqual(['removeLayer', 'removeSource', 'addSource', 'addLayer'])
    expect(map.isStyleLoaded).not.toHaveBeenCalled()
    expect(map.isSourceLoaded).not.toHaveBeenCalled()
    expect(state.layers).toEqual([layerId, 'markers', 'pending-overlay'])
  })

  it('waits for initialized style structure without consulting source loading', () => {
    const {map, state, calls} = fixture()
    state.initialized = false
    expect(refreshOfficialMapRaster(map as never, sourceId, 9)).toBe(false)
    expect(calls).toEqual([])
    expect(map.isSourceLoaded).not.toHaveBeenCalled()
  })

  it('leaves another selected map untouched when the official source and layer are absent', () => {
    const {map, state, calls} = fixture()
    state.source = false
    state.layers = ['other-basemap', 'markers', 'pending-overlay']
    expect(refreshOfficialMapRaster(map as never, sourceId, 10)).toBe(true)
    expect(calls).toEqual([])
    expect(state.layers).toEqual(['other-basemap', 'markers', 'pending-overlay'])
  })

  it.each(['source', 'layer'])('reconciles an orphaned %s without retaining cached raster state', orphan => {
    const {map, state, calls} = fixture()
    state.source = orphan === 'source'
    state.layers = orphan === 'layer' ? [layerId, 'markers', 'pending-overlay'] : ['markers', 'pending-overlay']
    expect(refreshOfficialMapRaster(map as never, sourceId, 4)).toBe(true)
    expect(calls).toEqual([orphan === 'source' ? 'removeSource' : 'removeLayer', 'addSource', 'addLayer'])
    expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({id: layerId}), 'markers')
  })

  it('repeated notifications replace only the official raster and preserve layer order', () => {
    const {map, state, calls} = fixture()
    expect(refreshOfficialMapRaster(map as never, sourceId, 3)).toBe(true)
    expect(refreshOfficialMapRaster(map as never, sourceId, 4)).toBe(true)
    expect(calls).toEqual(['removeLayer', 'removeSource', 'addSource', 'addLayer', 'removeLayer', 'removeSource', 'addSource', 'addLayer'])
    expect(state.layers).toEqual([layerId, 'markers', 'pending-overlay'])
    expect(map.addSource).toHaveBeenLastCalledWith(sourceId, expect.objectContaining({
      tiles: ['sartracker-official-map://tile/official_discovery_topo/{z}/{x}/{y}.png?revision=4'],
    }))
  })

  it.each(['failRemoveLayer', 'failRemoveSource', 'failAddSource', 'failAddLayer'] as const)(
    'surfaces a MapLibre mutation that reports failure without throwing (%s)', failure => {
      const {map, state} = fixture()
      state[failure] = true
      expect(() => refreshOfficialMapRaster(map as never, sourceId, 11)).toThrow(/offline map/i)
      if (failure === 'failRemoveLayer' || failure === 'failRemoveSource') expect(map.addSource).not.toHaveBeenCalled()
    },
  )

  it('propagates a thrown mutation error to the hook fail-visible path', () => {
    const {map} = fixture()
    map.removeLayer.mockImplementation(() => { throw new Error('MapLibre removal refused') })
    expect(() => refreshOfficialMapRaster(map as never, sourceId, 12)).toThrow('MapLibre removal refused')
    expect(map.addSource).not.toHaveBeenCalled()
  })
})
