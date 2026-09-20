import { afterEach, describe, expect, it, vi } from 'vitest'
import { runCompetingMapFault } from '../../scripts/qualification/competing-map-fault.mjs'

afterEach(() => { vi.unstubAllGlobals() })

describe('competing map fault custody', () => {
  it('restores the real injected map method even when evidence capture fails', async () => {
    const sources: Record<string, { type: string }> = {
      'mission-markers': { type: 'geojson' }, 'mission-drawings': { type: 'geojson' },
    }
    const original = vi.fn((id: string) => { sources[id] = { type: 'geojson' } })
    const map = {
      addSource: original,
      getStyle: () => ({ sources, layers: [] }),
      getSource: (id: string) => sources[id],
      removeSource: (id: string) => { delete sources[id] },
      fire: () => queueMicrotask(() => {
        try { map.addSource('mission-markers') } catch { /* deferred map error dispatch */ }
      }),
    }
    const browser = { __SARTRACKER_MAP__: map, setTimeout }
    vi.stubGlobal('window', browser)
    const page = {
      evaluate: async (callback: () => unknown) => callback(),
      screenshot: async () => { throw new Error('capture disk failure') },
      on: vi.fn(), off: vi.fn(),
    }
    const report = await runCompetingMapFault({ page, evidenceDir: '/owned/evidence' })
    expect(report.status).toBe('rejected')
    expect(report.error).toMatch(/capture disk failure/u)
    expect(map.addSource).toBe(original)
    expect('__C14_OVERLAY_FAILURE__' in browser).toBe(false)
    expect(sources['mission-markers']).toEqual({ type: 'geojson' })
    expect(report.cleanup.restored).toBe(true)
    expect(page.off).toHaveBeenCalledOnce()
    expect(report.stages.map((entry: { stage: string }) => entry.stage)).toEqual(['start', 'fault', 'steady', 'fail', 'cleanup'])
  })
})
