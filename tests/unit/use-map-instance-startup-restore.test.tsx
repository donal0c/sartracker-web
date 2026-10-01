import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { BASEMAP_STORAGE_KEY } from '../../src/lib/map-preferences'
import {
  DEFAULT_APP_SETTINGS,
  type AppSettings,
  type OfficialMapPackageSettings,
} from '../../src/features/settings/settings-types'
import { useMapInstance, type MapInstanceController } from '../../src/features/map/use-map-instance'

const fake = vi.hoisted(() => ({
  loadAppSettings: vi.fn<() => Promise<AppSettings>>(),
}))
vi.mock('../../src/infrastructure/settings-store/tauri-settings-store', () => ({
  loadAppSettings: fake.loadAppSettings,
}))
vi.mock('../../src/features/diagnostics/diagnostic-event-log', () => ({ recordDiagnosticEvent: async () => undefined }))
vi.mock('../../src/features/map/official-map-protocol', () => ({ registerOfficialMapProtocol: () => () => undefined }))
vi.mock('../../src/features/tracking/coverage-tile-protocol', () => ({ registerCoverageTileProtocol: () => () => undefined }))
vi.mock('../../src/features/map/map-style', () => ({
  createRasterStyle: (id: string) => ({ id, sources: { basemap: {} } }),
  IRELAND_MAX_BOUNDS: [[-11, 51], [-5, 56]],
}))
vi.mock('../../src/features/map/apply-map-style-preserving-camera', () => ({ applyMapStylePreservingCamera: () => undefined }))
vi.mock('maplibre-gl', () => ({ default: {
  Map: class {
    on() {} off() {} once() {} addControl() {} remove() {} setStyle() {}
    getCenter() { return { lat: 53, lng: -8 } }
    getZoom() { return 8 }
    getCanvas() { return document.createElement('canvas') }
    isStyleLoaded() { return true }
  },
  NavigationControl: class {},
} }))

const probe: { current: MapInstanceController | null } = { current: null }
let cleanup: (() => void) | undefined

/** Renders the hook in a real component tree and exposes its controller. */
function Probe() {
  const instance = useMapInstance()
  const { containerRef } = instance
  React.useEffect(() => {
    probe.current = instance
  })
  return <div ref={containerRef} />
}

/** Settings holding one Discovery package in the given verified state. */
function settingsWithDiscovery(status: OfficialMapPackageSettings['status']): AppSettings {
  return {
    ...DEFAULT_APP_SETTINGS,
    officialMaps: {
      ...DEFAULT_APP_SETTINGS.officialMaps,
      packages: [{
        id: 'package-1', sourceType: 'mbtiles', mapId: 'official_discovery_topo',
        packagePath: '/maps/discovery.mbtiles', status, bounds: null, minZoom: 6, maxZoom: 16,
        tileCount: 100, tileFormat: 'png', createdAt: '', verifiedAt: '', message: '',
      }],
    },
  }
}

async function mount(options: { readonly strict?: boolean } = {}) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  cleanup = () => { act(() => root.unmount()); host.remove() }
  await act(async () => root.render(
    options.strict === true ? <React.StrictMode><Probe /></React.StrictMode> : <Probe />,
  ))
  await act(async () => undefined)
}

beforeEach(() => {
  window.localStorage.clear()
})
afterEach(() => {
  cleanup?.()
  probe.current = null
  vi.clearAllMocks()
})

it('restores Discovery after relaunch when its package is verified ready [DON-304]', async () => {
  window.localStorage.setItem(BASEMAP_STORAGE_KEY, 'official_discovery_topo')
  fake.loadAppSettings.mockResolvedValue(settingsWithDiscovery('ready'))

  await mount()

  expect(probe.current?.activeBasemapId).toBe('official_discovery_topo')
  expect(probe.current?.startupMapNotice).toBeNull()
  expect(window.localStorage.getItem(BASEMAP_STORAGE_KEY)).toBe('official_discovery_topo')
})

it('shows why Discovery was not restored and keeps the stored choice for the next launch [DON-304]', async () => {
  window.localStorage.setItem(BASEMAP_STORAGE_KEY, 'official_discovery_topo')
  fake.loadAppSettings.mockResolvedValue(settingsWithDiscovery('missing'))

  await mount()

  expect(probe.current?.activeBasemapId).toBe('opentopomap')
  expect(probe.current?.startupMapNotice).toMatch(/Discovery Topo unavailable: its offline package cannot be found/u)
  expect(window.localStorage.getItem(BASEMAP_STORAGE_KEY)).toBe('official_discovery_topo')
})

it('lets an operator map choice made before settings load win over the restore [DON-304]', async () => {
  window.localStorage.setItem(BASEMAP_STORAGE_KEY, 'official_discovery_topo')
  let resolveSettings: (settings: AppSettings) => void = () => undefined
  fake.loadAppSettings.mockReturnValue(new Promise((resolve) => { resolveSettings = resolve }))

  await mount()
  act(() => probe.current?.handleBasemapChange('openstreetmap'))
  await act(async () => resolveSettings(settingsWithDiscovery('ready')))

  expect(probe.current?.activeBasemapId).toBe('openstreetmap')
  expect(window.localStorage.getItem(BASEMAP_STORAGE_KEY)).toBe('openstreetmap')
})

it('clears the startup notice once the operator picks a map [DON-304]', async () => {
  window.localStorage.setItem(BASEMAP_STORAGE_KEY, 'official_discovery_topo')
  fake.loadAppSettings.mockResolvedValue(settingsWithDiscovery('invalid'))

  await mount()
  expect(probe.current?.startupMapNotice).not.toBeNull()
  act(() => probe.current?.handleBasemapChange('openstreetmap'))

  expect(probe.current?.startupMapNotice).toBeNull()
})

it('restores once under StrictMode effect replay [DON-304]', async () => {
  window.localStorage.setItem(BASEMAP_STORAGE_KEY, 'official_discovery_topo')
  fake.loadAppSettings.mockResolvedValue(settingsWithDiscovery('ready'))

  await mount({ strict: true })

  expect(probe.current?.activeBasemapId).toBe('official_discovery_topo')
  expect(probe.current?.startupMapNotice).toBeNull()
})

it('does nothing when unmounted before settings load [DON-304]', async () => {
  window.localStorage.setItem(BASEMAP_STORAGE_KEY, 'official_discovery_topo')
  let resolveSettings: (settings: AppSettings) => void = () => undefined
  fake.loadAppSettings.mockReturnValue(new Promise((resolve) => { resolveSettings = resolve }))

  await mount()
  cleanup?.()
  cleanup = undefined
  await act(async () => resolveSettings(settingsWithDiscovery('missing')))

  expect(window.localStorage.getItem(BASEMAP_STORAGE_KEY)).toBe('official_discovery_topo')
})

it('replaces the stored choice when the operator explicitly picks the displayed fallback [DON-304]', async () => {
  window.localStorage.setItem(BASEMAP_STORAGE_KEY, 'official_discovery_topo')
  fake.loadAppSettings.mockResolvedValue(settingsWithDiscovery('missing'))

  await mount()
  act(() => probe.current?.handleBasemapChange('opentopomap'))

  expect(window.localStorage.getItem(BASEMAP_STORAGE_KEY)).toBe('opentopomap')
  expect(probe.current?.startupMapNotice).toBeNull()
})
