import { act, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useOfficialMapViewQualification } from '../../src/features/map/use-official-map-view-qualification'
import type { OfficialMapViewRequest } from '../../src/features/map/official-map-view-qualification'

afterEach(() => { Reflect.deleteProperty(window, 'sartrackerElectron'); vi.unstubAllGlobals() })

/** Mounts the actual qualification hook against a structurally initialized map. */
async function mountQualification() {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const id = 'official_discovery_topo'
  const listeners = new Map<string, () => void>()
  const state = { source: true, layers: [`${id}-layer`, 'markers'], failAddSource: false, failRemoveLayer: false }
  const map = {
    getPitch: () => 0, getZoom: () => 11,
    getBounds: () => ({ getWest: () => -10, getEast: () => -9, getSouth: () => 51, getNorth: () => 52 }),
    getStyle: () => ({ layers: state.layers.map(layer => ({ id: layer })) }),
    getSource: () => state.source ? {} : undefined,
    getLayer: (layer: string) => state.layers.includes(layer) ? { id: layer } : undefined,
    removeLayer: vi.fn((layer: string) => {
      if (state.failRemoveLayer) throw new Error('Transient layer failure')
      state.layers = state.layers.filter(value => value !== layer)
    }),
    removeSource: vi.fn(() => { state.source = false }),
    addSource: vi.fn(() => {
      if (state.failAddSource) throw new Error('Transient source failure')
      state.source = true
    }),
    addLayer: vi.fn((layer: { id: string }, before?: string) => {
      state.layers.splice(before === undefined ? state.layers.length : state.layers.indexOf(before), 0, layer.id)
    }),
    on: (name: string, callback: () => void) => listeners.set(name, callback),
    off: (name: string) => listeners.delete(name),
  }
  let packagesChanged = () => { throw new Error('Not mounted') }
  let settle: (value: unknown) => void = () => { throw new Error('No pending check') }
  const nativeCheck = vi.fn<(request: OfficialMapViewRequest) => Promise<unknown>>(() => new Promise(resolve => { settle = resolve }))
  Object.defineProperty(window, 'sartrackerElectron', { configurable: true, value: {
    checkOfficialMapView: nativeCheck,
    onOfficialMapPackagesChanged: (callback: () => void) => { packagesChanged = callback; return () => undefined },
  } })
  let latest: ReturnType<typeof useOfficialMapViewQualification> | undefined
  const mapRef = { current: map } as never
  function Probe() {
    const controller = useOfficialMapViewQualification(id, mapRef)
    useEffect(() => { latest = controller }, [controller])
    return null
  }
  const root = createRoot(document.createElement('div'))
  await act(async () => root.render(<Probe />))
  return { state, map, listeners, nativeCheck, get latest() { return latest! },
    change: () => packagesChanged(), settle: (value: unknown) => settle(value),
    close: () => act(async () => root.unmount()) }
}

describe('Claude map lifecycle regressions', () => {
  it('recreates both raster parts after an addSource failure removed the previous parts', async () => {
    const harness = await mountQualification()
    try {
      harness.state.failAddSource = true
      await act(async () => harness.change())
      expect(harness.state.source).toBe(false)
      expect(harness.state.layers).toEqual(['markers'])
      expect(harness.latest.coverage.status).toBe('unavailable')
      harness.state.failAddSource = false
      await act(async () => harness.listeners.get('styledata')?.())
      expect(harness.state.source).toBe(true)
      expect(harness.state.layers).toEqual(['official_discovery_topo-layer', 'markers'])
    } finally { await harness.close() }
  })

  it('bounds failed automatic refresh attempts instead of retrying on every style event', async () => {
    const harness = await mountQualification()
    try {
      harness.state.failRemoveLayer = true
      await act(async () => harness.change())
      for (let index = 0; index < 20; index += 1) {
        await act(async () => harness.listeners.get('styledata')?.())
      }
      expect(harness.map.removeLayer.mock.calls.length).toBeLessThanOrEqual(3)
      expect(harness.latest.coverage.status).toBe('unavailable')
    } finally { await harness.close() }
  })

  it.each(['missing', 'partial', 'error'] as const)('publishes an in-flight %s result despite a tile failure', async status => {
    const harness = await mountQualification()
    try {
      let pending: Promise<void> | undefined
      await act(async () => { pending = harness.latest.check() })
      await act(async () => window.dispatchEvent(new Event('sartracker:official-map-tile-failed')))
      await act(async () => {
        harness.settle({ ...harness.nativeCheck.mock.calls[0]![0], status,
          totalTiles: 2, usableTiles: status === 'partial' ? 1 : 0,
          checkedAt: '2026-09-14T07:00:00Z', packageIdentities: [], message: 'Required tiles unusable.' })
        await pending
      })
      expect(harness.latest.coverage.status).toBe(status)
      expect(harness.latest.qualification).toBeNull()
    } finally { await harness.close() }
  })
})
