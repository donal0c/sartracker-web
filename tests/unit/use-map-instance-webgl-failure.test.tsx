import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'

import { DEFAULT_APP_SETTINGS, type AppSettings } from '../../src/features/settings/settings-types'
import { useMapInstance, type MapInstanceController } from '../../src/features/map/use-map-instance'

const fake = vi.hoisted(() => ({
  loadAppSettings: vi.fn<() => Promise<AppSettings>>(),
  webglFails: true,
  recordDiagnosticEvent: vi.fn<(event: unknown) => Promise<void>>(async () => undefined),
}))
vi.mock('../../src/infrastructure/settings-store/tauri-settings-store', () => ({
  loadAppSettings: fake.loadAppSettings,
}))
vi.mock('../../src/features/diagnostics/diagnostic-event-log', () => ({ recordDiagnosticEvent: fake.recordDiagnosticEvent }))
vi.mock('../../src/features/map/official-map-protocol', () => ({ registerOfficialMapProtocol: () => () => undefined }))
vi.mock('../../src/features/tracking/coverage-tile-protocol', () => ({ registerCoverageTileProtocol: () => () => undefined }))
vi.mock('../../src/features/map/map-style', () => ({
  createRasterStyle: (id: string) => ({ id, sources: { basemap: {} } }),
  IRELAND_MAX_BOUNDS: [[-11, 51], [-5, 56]],
}))
vi.mock('../../src/features/map/apply-map-style-preserving-camera', () => ({ applyMapStylePreservingCamera: () => undefined }))
vi.mock('maplibre-gl', () => ({ default: {
  Map: class {
    constructor() { if (fake.webglFails) throw new Error('Failed to initialize WebGL') }
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

afterEach(() => {
  cleanup?.()
  probe.current = null
  vi.clearAllMocks()
})

it('reports an unavailable WebGL renderer instead of crashing the app shell [DON-288]', async () => {
  fake.loadAppSettings.mockResolvedValue(DEFAULT_APP_SETTINGS)
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  cleanup = () => { act(() => root.unmount()); host.remove() }

  await act(async () => root.render(<Probe />))

  expect(host.isConnected).toBe(true)
  expect(probe.current?.rendererFailure).toContain('Failed to initialize WebGL')
  expect(probe.current?.mapRef.current).toBeNull()
  expect(fake.recordDiagnosticEvent).toHaveBeenCalledWith(expect.objectContaining({
    level: 'error', category: 'map', event: 'map_renderer_unavailable',
  }))
})
