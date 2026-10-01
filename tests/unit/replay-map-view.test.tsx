import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ReplayMapView } from '../../src/features/mission-review/replay-map-view'
import { BASEMAP_STORAGE_KEY } from '../../src/lib/map-preferences'
import {
  DEFAULT_APP_SETTINGS,
  type AppSettings,
  type OfficialMapPackageSettings,
} from '../../src/features/settings/settings-types'

const fake = vi.hoisted(() => ({
  handlers: new Map<string, (event: Record<string, unknown>) => void>(),
  setFilter: vi.fn(), queryRenderedFeatures: vi.fn(() => []),
  createRasterStyle: vi.fn<(id: string) => { sources: Record<string, object> }>(() => ({ sources: { basemap: {} } })),
  loadAppSettings: vi.fn<() => Promise<AppSettings>>(),
  registerOfficialMapProtocol: vi.fn(() => () => undefined),
}))
vi.mock('../../src/infrastructure/settings-store/tauri-settings-store', () => ({ loadAppSettings: fake.loadAppSettings }))
vi.mock('../../src/features/map/official-map-protocol', () => ({ registerOfficialMapProtocol: fake.registerOfficialMapProtocol }))
vi.mock('../../src/features/markers/sync-marker-overlay', () => ({ ensureMarkerImages: async () => undefined }))
vi.mock('../../src/features/map/map-style', () => ({ createRasterStyle: fake.createRasterStyle }))
vi.mock('maplibre-gl', () => ({ default: {
  Map: class {
    on(name: string, handler: (event: Record<string, unknown>) => void) { fake.handlers.set(name, handler) }
    addControl() {} addSource() {} addLayer() {} remove() {} fitBounds() {}
    getSource() { return { setData() {} } }
    getLayer() { return {} }
    setFilter = fake.setFilter
    queryRenderedFeatures = fake.queryRenderedFeatures
  }, NavigationControl: class {},
} }))
let cleanup: (() => void) | undefined
beforeEach(() => {
  window.localStorage.clear()
  fake.loadAppSettings.mockResolvedValue(DEFAULT_APP_SETTINGS)
})
afterEach(() => { cleanup?.(); fake.handlers.clear(); vi.clearAllMocks() })

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

/** Mounts the rendered view and completes its real style-ready state transition. */
async function mount() {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  cleanup = () => { act(() => root.unmount()); host.remove() }
  await act(async () => root.render(<ReplayMapView evidence={{ status: 'loading', data: null, loaded: 0, total: 0, message: 'Loading' }} />))
  await act(async () => fake.handlers.get('style.load')?.({}))
  return host
}

it('clears a transient basemap failure when that source finishes loading', async () => {
  const host = await mount()
  act(() => fake.handlers.get('error')?.({ sourceId: 'basemap', tile: { tileID: { key: 'failed-tile' } }, error: new Error('503') }))
  expect(host.textContent).toContain('Basemap')
  act(() => fake.handlers.get('sourcedata')?.({ sourceId: 'basemap', isSourceLoaded: true, sourceDataType: 'idle' }))
  expect(host.querySelector('[role="alert"]')).not.toBeNull()
  act(() => fake.handlers.get('sourcedata')?.({ sourceId: 'basemap', isSourceLoaded: true, tile: { state: 'loaded', tileID: { key: 'other-tile' } } }))
  expect(host.querySelector('[role="alert"]')).not.toBeNull()
  act(() => fake.handlers.get('sourcedata')?.({ sourceId: 'basemap', isSourceLoaded: false, tile: { state: 'loaded', tileID: { key: 'failed-tile' } } }))
  expect(host.querySelector('[role="alert"]')).toBeNull()
})

it('does not clear an evidence error because an unrelated tile loaded', async () => {
  const host = await mount()
  act(() => fake.handlers.get('error')?.({ sourceId: 'review-evidence', error: new Error('bad geometry') }))
  act(() => fake.handlers.get('sourcedata')?.({ sourceId: 'basemap', isSourceLoaded: true, tile: { state: 'loaded' } }))
  expect(host.querySelector('[role="alert"]')).not.toBeNull()
  act(() => fake.handlers.get('sourcedata')?.({ sourceId: 'review-evidence', isSourceLoaded: true, sourceDataType: 'content' }))
  expect(host.querySelector('[role="alert"]')).toBeNull()
})

it('shows one basemap warning while retaining each failed tile until its own recovery', async () => {
  const host = await mount()
  for (const key of ['a', 'b']) {
    act(() => fake.handlers.get('error')?.({ sourceId: 'basemap', tile: { tileID: { key } } }))
  }
  expect(host.querySelectorAll('[role="alert"]')).toHaveLength(1)
  act(() => fake.handlers.get('sourcedata')?.({ sourceId: 'basemap', isSourceLoaded: false, tile: { state: 'loaded', tileID: { key: 'a' } } }))
  expect(host.querySelectorAll('[role="alert"]')).toHaveLength(1)
  act(() => fake.handlers.get('sourcedata')?.({ sourceId: 'basemap', isSourceLoaded: true, tile: { state: 'loaded', tileID: { key: 'b' } } }))
  expect(host.querySelectorAll('[role="alert"]')).toHaveLength(0)
})

it('uses one point filter and includes rendered symbols and labels in click inspection', async () => {
  await mount()
  expect(fake.setFilter.mock.calls.filter(([id]) => id === 'review-points')).toHaveLength(1)
  act(() => fake.handlers.get('click')?.({ point: { x: 10, y: 10 } }))
  expect(fake.queryRenderedFeatures).toHaveBeenCalledWith({ x: 10, y: 10 }, {
    layers: expect.arrayContaining(['review-marker-icons', 'review-labels']),
  })
})

it('replays over Discovery when the operator chose it and its offline package is ready [DON-314]', async () => {
  window.localStorage.setItem(BASEMAP_STORAGE_KEY, 'official_discovery_topo')
  fake.loadAppSettings.mockResolvedValue(settingsWithDiscovery('ready'))

  const host = await mount()

  expect(fake.createRasterStyle).toHaveBeenCalledWith('official_discovery_topo')
  expect(fake.createRasterStyle).not.toHaveBeenCalledWith('opentopomap')
  expect(fake.registerOfficialMapProtocol).toHaveBeenCalled()
  expect(host.querySelector('[data-testid="mission-replay-map-canvas"]')?.getAttribute('data-basemap-id'))
    .toBe('official_discovery_topo')
  expect(host.textContent).not.toContain('unavailable')
})

it('replays over the online default with the visible reason when the Discovery package is missing [DON-314]', async () => {
  window.localStorage.setItem(BASEMAP_STORAGE_KEY, 'official_discovery_topo')
  fake.loadAppSettings.mockResolvedValue(settingsWithDiscovery('missing'))

  const host = await mount()

  expect(fake.createRasterStyle).toHaveBeenCalledWith('opentopomap')
  expect(host.textContent).toContain('Discovery')
  expect(host.textContent).toContain('its offline package cannot be found')
  expect(window.localStorage.getItem(BASEMAP_STORAGE_KEY)).toBe('official_discovery_topo')
})

it('keeps an online basemap choice without waiting on map settings [DON-314]', async () => {
  window.localStorage.setItem(BASEMAP_STORAGE_KEY, 'esri_topo')

  await mount()

  expect(fake.createRasterStyle).toHaveBeenCalledWith('esri_topo')
  expect(fake.loadAppSettings).not.toHaveBeenCalled()
})
