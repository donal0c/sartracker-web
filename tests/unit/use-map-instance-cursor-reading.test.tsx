import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'

import { DEFAULT_APP_SETTINGS } from '../../src/features/settings/settings-types'
import { useMapInstance, type MapInstanceController } from '../../src/features/map/use-map-instance'

const fake = vi.hoisted(() => ({
  handlers: new Map<string, Array<() => void>>(),
  canvasContainer: null as HTMLElement | null,
}))
vi.mock('../../src/infrastructure/settings-store/tauri-settings-store', () => ({
  loadAppSettings: async () => DEFAULT_APP_SETTINGS,
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
    constructor(options: { container: HTMLElement }) {
      const canvasContainer = document.createElement('div')
      options.container.append(canvasContainer)
      fake.canvasContainer = canvasContainer
    }
    on(type: string, handler: () => void) {
      fake.handlers.set(type, [...(fake.handlers.get(type) ?? []), handler])
    }
    off() {} once() {} addControl() {} remove() {} setStyle() {}
    getCenter() { return { lat: 53, lng: -8 } }
    getZoom() { return 8 }
    getCanvas() { return document.createElement('canvas') }
    getCanvasContainer() { return fake.canvasContainer! }
    unproject() { return { lat: 52.1, lng: -9.5 } }
    isStyleLoaded() { return true }
  },
  NavigationControl: class {},
} }))

const probe: { current: MapInstanceController | null } = { current: null }
let cleanup: (() => void) | undefined

/** Renders the hook and exposes its controller. */
function Probe() {
  const instance = useMapInstance()
  const { containerRef } = instance
  React.useEffect(() => {
    probe.current = instance
  })
  return <div ref={containerRef} />
}

/** Runs the hook's handlers for a MapLibre event and lets the next animation frame publish. */
async function fire(type: string) {
  await act(async () => {
    for (const handler of fake.handlers.get(type) ?? []) handler()
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)))
  })
}

afterEach(() => {
  cleanup?.()
  probe.current = null
  fake.handlers.clear()
  Reflect.deleteProperty(document, 'elementFromPoint')
})

it('keeps the bar blank when the pointer left the map before the first load finished [DON-372]', async () => {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  cleanup = () => { act(() => root.unmount()); host.remove() }
  await act(async () => root.render(<Probe />))

  const mapElement = host.firstElementChild!
  // jsdom has no layout: the pointer is over the map's canvas container.
  document.elementFromPoint = () => fake.canvasContainer
  await act(async () => {
    mapElement.dispatchEvent(new MouseEvent('pointermove', { clientX: 40, clientY: 40 }))
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)))
  })
  expect(probe.current?.hoverCoordinate).toEqual({ latitude: 52.1, longitude: -9.5, source: 'cursor' })

  await act(async () => {
    mapElement.dispatchEvent(new MouseEvent('pointerleave'))
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)))
  })
  await fire('load')

  expect(probe.current?.hoverCoordinate).toEqual({ latitude: null, longitude: null, source: 'cursor' })
})

it('shows the map centre, labelled as such, when the pointer has not been on the map at load [DON-372]', async () => {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  cleanup = () => { act(() => root.unmount()); host.remove() }
  await act(async () => root.render(<Probe />))

  await fire('load')

  expect(probe.current?.hoverCoordinate).toEqual({ latitude: 53, longitude: -8, source: 'map-centre' })
})
