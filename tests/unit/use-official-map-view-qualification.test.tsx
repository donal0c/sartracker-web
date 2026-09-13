import { act, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useOfficialMapViewQualification } from '../../src/features/map/use-official-map-view-qualification'
import type { OfficialMapViewRequest } from '../../src/features/map/official-map-view-qualification'

afterEach(() => { Reflect.deleteProperty(window, 'sartrackerElectron'); vi.unstubAllGlobals() })

describe('official view qualification lifecycle', () => {
  it.each(['movement', 'package change', 'tile failure', 'focus'])('does not publish a delayed successful check after %s', async trigger => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const listeners = new Map<string, () => void>()
    const map = { getPitch: () => 0, getZoom: () => 11.6,
      isStyleLoaded: () => false,
      getBounds: () => ({getWest: () => -10, getEast: () => -9, getSouth: () => 51, getNorth: () => 52}),
      on: (name: string, callback: () => void) => listeners.set(name, callback),
      off: (name: string) => listeners.delete(name),
    }
    let settle: (result: unknown) => void = () => { throw new Error('No pending native check') }
    const check = vi.fn((_request: OfficialMapViewRequest) => {
      void _request
      return new Promise(resolve => { settle = resolve })
    })
    let packageChanged: () => void = () => { throw new Error('No native change listener') }
    Object.defineProperty(window, 'sartrackerElectron', {configurable: true, value: {checkOfficialMapView: check,
      onOfficialMapPackagesChanged: (listener: () => void) => { packageChanged = listener; return () => undefined },
    }})
    let latest: ReturnType<typeof useOfficialMapViewQualification> | undefined
    const mapRef = {current: map} as never
    function Probe() {
      const result = useOfficialMapViewQualification('official_discovery_topo', mapRef)
      useEffect(() => { latest = result }, [result])
      return null
    }
    const host = document.createElement('div')
    const root = createRoot(host)
    await act(async () => root.render(<Probe />))
    let pending: Promise<void> | undefined
    await act(async () => { pending = latest!.check() })
    // MapLibre raster sources use roundZoom=true, so a 256px source at 11.6
    // requests source zoom 13 (round(11.6 + 1)).
    expect(check).toHaveBeenCalledWith(expect.objectContaining({zoom: 13}))
    await act(async () => {
      if (trigger === 'movement') listeners.get('movestart')?.()
      else if (trigger === 'package change') packageChanged()
      else window.dispatchEvent(new Event(trigger === 'focus' ? 'focus' : 'sartracker:official-map-tile-failed'))
    })
    await act(async () => {
      settle({...check.mock.calls[0]?.[0], status: 'complete', totalTiles: 4, usableTiles: 4,
        checkedAt: new Date().toISOString(), packageIdentities: [], message: 'All tiles checked'})
      await pending
    })
    expect(latest!.qualification).toBeNull()
    expect(latest!.coverage.status).toBe('unchecked')
    await act(async () => root.unmount())
  })

  it.each(['missing', 'partial', 'error'] as const)('retains a published %s result for a redundant tile failure', async status => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const listeners = new Map<string, () => void>()
    const map = { getPitch: () => 0, getZoom: () => 11,
      isStyleLoaded: () => false,
      getBounds: () => ({getWest: () => -10, getEast: () => -9, getSouth: () => 51, getNorth: () => 52}),
      on: (name: string, callback: () => void) => listeners.set(name, callback),
      off: (name: string) => listeners.delete(name),
    }
    const mapRef = {current: map} as never
    let packageChanged: () => void = () => { throw new Error('No native change listener') }
    const check = vi.fn(async (request: OfficialMapViewRequest) => ({...request,
      status, totalTiles: status === 'partial' ? 2 : 1, usableTiles: status === 'partial' ? 1 : 0,
      checkedAt: new Date().toISOString(), packageIdentities: [], message: 'Required local tiles are missing or unusable.'}))
    Object.defineProperty(window, 'sartrackerElectron', {configurable: true, value: {
      checkOfficialMapView: check,
      onOfficialMapPackagesChanged: (listener: () => void) => { packageChanged = listener; return () => undefined },
    }})
    let latest: ReturnType<typeof useOfficialMapViewQualification> | undefined
    function Probe() {
      const result = useOfficialMapViewQualification('official_discovery_topo', mapRef)
      useEffect(() => { latest = result }, [result])
      return null
    }
    const host = document.createElement('div')
    const root = createRoot(host)
    await act(async () => root.render(<Probe />))
    await act(async () => latest!.check())
    expect(check).toHaveBeenCalledTimes(1)
    expect(latest!.coverage.status).toBe(status)
    await act(async () => window.dispatchEvent(new Event('sartracker:official-map-tile-failed')))
    expect(latest!.coverage.status).toBe(status)
    for (const reset of [
      () => listeners.get('movestart')?.(),
      () => window.dispatchEvent(new Event('sartracker:settings-updated')),
      () => packageChanged(),
    ]) {
      await act(async () => latest!.check())
      expect(latest!.coverage.status).toBe(status)
      await act(async () => reset())
      expect(latest!.coverage.status).toBe('unchecked')
    }
    await act(async () => root.unmount())
  })

  it('retains an unavailable result for a redundant tile failure', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const listeners = new Map<string, () => void>()
    const map = { getPitch: () => 0, getZoom: () => 11,
      getBounds: () => ({getWest: () => -10, getEast: () => -9, getSouth: () => 51, getNorth: () => 52}),
      on: (name: string, callback: () => void) => listeners.set(name, callback),
      off: (name: string) => listeners.delete(name),
    }
    const mapRef = {current: map} as never
    const check = vi.fn(async () => { throw new Error('Electron check unavailable') })
    Object.defineProperty(window, 'sartrackerElectron', {configurable: true, value: {
      checkOfficialMapView: check,
      onOfficialMapPackagesChanged: () => () => undefined,
    }})
    let latest: ReturnType<typeof useOfficialMapViewQualification> | undefined
    function Probe() {
      const result = useOfficialMapViewQualification('official_discovery_topo', mapRef)
      useEffect(() => { latest = result }, [result])
      return null
    }
    const host = document.createElement('div')
    const root = createRoot(host)
    await act(async () => root.render(<Probe />))
    await act(async () => latest!.check())
    expect(latest!.coverage.status).toBe('unavailable')
    await act(async () => window.dispatchEvent(new Event('sartracker:official-map-tile-failed')))
    expect(latest!.coverage.status).toBe('unavailable')
    await act(async () => root.unmount())
  })

  it('withdraws a published positive result after a tile failure', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const listeners = new Map<string, () => void>()
    const map = { getPitch: () => 0, getZoom: () => 11,
      getBounds: () => ({getWest: () => -10, getEast: () => -9, getSouth: () => 51, getNorth: () => 52}),
      on: (name: string, callback: () => void) => listeners.set(name, callback),
      off: (name: string) => listeners.delete(name),
    }
    const mapRef = {current: map} as never
    const check = vi.fn(async (request: OfficialMapViewRequest) => ({...request,
      status: 'complete' as const, totalTiles: 1, usableTiles: 1,
      checkedAt: new Date().toISOString(), packageIdentities: [], message: 'All tiles checked'}))
    Object.defineProperty(window, 'sartrackerElectron', {configurable: true, value: {
      checkOfficialMapView: check,
      onOfficialMapPackagesChanged: () => () => undefined,
    }})
    let latest: ReturnType<typeof useOfficialMapViewQualification> | undefined
    function Probe() {
      const result = useOfficialMapViewQualification('official_discovery_topo', mapRef)
      useEffect(() => { latest = result }, [result])
      return null
    }
    const host = document.createElement('div')
    const root = createRoot(host)
    await act(async () => root.render(<Probe />))
    await act(async () => latest!.check())
    expect(latest!.coverage.status).toBe('complete')
    expect(latest!.qualification).not.toBeNull()
    await act(async () => window.dispatchEvent(new Event('sartracker:official-map-tile-failed')))
    expect(latest!.coverage.status).toBe('unchecked')
    expect(latest!.qualification).toBeNull()
    await act(async () => root.unmount())
  })

  it('allows a later successful check to replace a preserved negative result', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const listeners = new Map<string, () => void>()
    const map = { getPitch: () => 0, getZoom: () => 11,
      getBounds: () => ({getWest: () => -10, getEast: () => -9, getSouth: () => 51, getNorth: () => 52}),
      on: (name: string, callback: () => void) => listeners.set(name, callback),
      off: (name: string) => listeners.delete(name),
    }
    const mapRef = {current: map} as never
    const check = vi.fn()
      .mockImplementationOnce(async (request: OfficialMapViewRequest) => ({...request,
        status: 'missing' as const, totalTiles: 1, usableTiles: 0,
        checkedAt: new Date().toISOString(), packageIdentities: [], message: 'Required local tiles are missing or unusable.'}))
      .mockImplementationOnce(async (request: OfficialMapViewRequest) => ({...request,
        status: 'complete' as const, totalTiles: 1, usableTiles: 1,
        checkedAt: new Date().toISOString(), packageIdentities: [], message: 'All tiles checked'}))
    Object.defineProperty(window, 'sartrackerElectron', {configurable: true, value: {
      checkOfficialMapView: check,
      onOfficialMapPackagesChanged: () => () => undefined,
    }})
    let latest: ReturnType<typeof useOfficialMapViewQualification> | undefined
    function Probe() {
      const result = useOfficialMapViewQualification('official_discovery_topo', mapRef)
      useEffect(() => { latest = result }, [result])
      return null
    }
    const host = document.createElement('div')
    const root = createRoot(host)
    await act(async () => root.render(<Probe />))
    await act(async () => latest!.check())
    expect(latest!.coverage.status).toBe('missing')
    await act(async () => window.dispatchEvent(new Event('sartracker:official-map-tile-failed')))
    expect(latest!.coverage.status).toBe('missing')
    await act(async () => latest!.check())
    expect(latest!.coverage.status).toBe('complete')
    expect(latest!.qualification).not.toBeNull()
    await act(async () => root.unmount())
  })

  it('fails closed when the active map identity switches after a negative result', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const listeners = new Map<string, () => void>()
    const map = { getPitch: () => 0, getZoom: () => 11,
      getBounds: () => ({getWest: () => -10, getEast: () => -9, getSouth: () => 51, getNorth: () => 52}),
      on: (name: string, callback: () => void) => listeners.set(name, callback),
      off: (name: string) => listeners.delete(name),
    }
    const mapRef = {current: map} as never
    const check = vi.fn(async (request: OfficialMapViewRequest) => ({...request,
      status: 'missing' as const, totalTiles: 1, usableTiles: 0,
      checkedAt: new Date().toISOString(), packageIdentities: [], message: 'Required local tiles are missing or unusable.'}))
    Object.defineProperty(window, 'sartrackerElectron', {configurable: true, value: {
      checkOfficialMapView: check,
      onOfficialMapPackagesChanged: () => () => undefined,
    }})
    let activeMapId: 'official_discovery_topo' | 'official_premium_basemap' = 'official_discovery_topo'
    let latest: ReturnType<typeof useOfficialMapViewQualification> | undefined
    function Probe() {
      const result = useOfficialMapViewQualification(activeMapId, mapRef)
      useEffect(() => { latest = result }, [result])
      return null
    }
    const host = document.createElement('div')
    const root = createRoot(host)
    await act(async () => root.render(<Probe />))
    await act(async () => latest!.check())
    expect(latest!.coverage.status).toBe('missing')
    activeMapId = 'official_premium_basemap'
    await act(async () => root.render(<Probe />))
    expect(latest!.coverage.status).toBe('unchecked')
    expect(latest!.qualification).toBeNull()
    await act(async () => window.dispatchEvent(new Event('sartracker:official-map-tile-failed')))
    expect(latest!.coverage.status).toBe('unchecked')
    await act(async () => root.unmount())
  })

  it('keeps a new negative result fail-closed after a queued bare tile failure follows package reset', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const listeners = new Map<string, () => void>()
    const map = { getPitch: () => 0, getZoom: () => 11,
      isStyleLoaded: () => false,
      getBounds: () => ({getWest: () => -10, getEast: () => -9, getSouth: () => 51, getNorth: () => 52}),
      on: (name: string, callback: () => void) => listeners.set(name, callback),
      off: (name: string) => listeners.delete(name),
    }
    const mapRef = {current: map} as never
    let packageChanged: () => void = () => { throw new Error('No native change listener') }
    const check = vi.fn(async (request: OfficialMapViewRequest) => ({...request,
      status: 'missing' as const, totalTiles: 1, usableTiles: 0,
      checkedAt: new Date().toISOString(), packageIdentities: [], message: 'Required local tiles are missing or unusable.'}))
    Object.defineProperty(window, 'sartrackerElectron', {configurable: true, value: {
      checkOfficialMapView: check,
      onOfficialMapPackagesChanged: (listener: () => void) => { packageChanged = listener; return () => undefined },
    }})
    let latest: ReturnType<typeof useOfficialMapViewQualification> | undefined
    function Probe() {
      const result = useOfficialMapViewQualification('official_discovery_topo', mapRef)
      useEffect(() => { latest = result }, [result])
      return null
    }
    const host = document.createElement('div')
    const root = createRoot(host)
    await act(async () => root.render(<Probe />))
    await act(async () => latest!.check())
    expect(latest!.coverage.status).toBe('missing')

    const queuedBareTileFailure = Promise.resolve().then(() => {
      window.dispatchEvent(new Event('sartracker:official-map-tile-failed'))
    })
    await act(async () => {
      packageChanged()
      await queuedBareTileFailure
    })
    expect(latest!.coverage.status).toBe('unchecked')
    expect(latest!.qualification).toBeNull()

    await act(async () => latest!.check())
    expect(latest!.coverage.status).toBe('missing')
    await act(async () => window.dispatchEvent(new Event('sartracker:official-map-tile-failed')))
    expect(latest!.coverage.status).toBe('missing')
    expect(latest!.qualification).toBeNull()
    await act(async () => root.unmount())
  })
})
