import { describe, expect, it, vi } from 'vitest'
import { refreshOfficialMapRaster } from '../../src/features/map/official-map-raster-refresh'

describe('official map raster freshness', () => {
  it.each(['source', 'layer'])('reconciles an orphaned %s without retaining cached raster state', orphan => {
    const calls: string[] = []
    const map = {
      isStyleLoaded: () => true,
      getStyle: () => ({layers: orphan === 'layer'
        ? [{id: 'official_discovery_topo-layer'}, {id: 'markers'}] : [{id: 'markers'}]}),
      getSource: () => orphan === 'source' ? {} : undefined,
      removeLayer: vi.fn(() => calls.push('removeLayer')),
      removeSource: vi.fn(() => calls.push('removeSource')),
      addSource: vi.fn(() => calls.push('addSource')),
      addLayer: vi.fn(() => calls.push('addLayer')),
    }
    expect(refreshOfficialMapRaster(map as never, 'official_discovery_topo', 4)).toBe(true)
    expect(calls).toEqual([orphan === 'source' ? 'removeSource' : 'removeLayer', 'addSource', 'addLayer'])
    expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({id: 'official_discovery_topo-layer'}), 'markers')
  })

  it('removes old source tiles before recreating the raster below existing overlays', () => {
    const calls: string[] = []
    const map = {
      isStyleLoaded: () => true,
      getStyle: () => ({layers: [{id: 'official_discovery_topo-layer'}, {id: 'markers'}]}),
      getLayer: () => ({}), getSource: () => ({}),
      removeLayer: vi.fn(() => calls.push('removeLayer')),
      removeSource: vi.fn(() => calls.push('removeSource')),
      addSource: vi.fn(() => calls.push('addSource')),
      addLayer: vi.fn(() => calls.push('addLayer')),
    }
    expect(refreshOfficialMapRaster(map as never, 'official_discovery_topo', 3)).toBe(true)
    expect(calls).toEqual(['removeLayer', 'removeSource', 'addSource', 'addLayer'])
    expect(map.addSource).toHaveBeenCalledWith('official_discovery_topo', expect.objectContaining({
      tiles: ['sartracker-official-map://tile/official_discovery_topo/{z}/{x}/{y}.png?revision=3'],
    }))
    expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({id: 'official_discovery_topo-layer'}), 'markers')
  })
})
