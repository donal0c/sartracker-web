import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { ReplayMapView } from '../../src/features/mission-review/replay-map-view'

const fake = vi.hoisted(() => ({
  handlers: new Map<string, (event: Record<string, unknown>) => void>(),
  setFilter: vi.fn(), queryRenderedFeatures: vi.fn(() => []),
}))
vi.mock('../../src/features/markers/sync-marker-overlay', () => ({ ensureMarkerImages: async () => undefined }))
vi.mock('../../src/features/map/map-style', () => ({ createRasterStyle: () => ({ sources: { basemap: {} } }) }))
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
afterEach(() => { cleanup?.(); fake.handlers.clear(); vi.clearAllMocks() })

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
