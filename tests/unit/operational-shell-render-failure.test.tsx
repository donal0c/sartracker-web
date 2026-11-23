// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The real renderer root, App and workspace render; heavy panels, bridges and
// the map are stubbed. The drawing dialog can be told to fail while rendering,
// as a broken first operational screen would [DON-354].
const nothing = vi.hoisted(() => () => null)
const fake = vi.hoisted(() => ({
  failDrawingDialog: false,
  recordDiagnosticEvent: vi.fn<(event: unknown) => Promise<void>>(async () => undefined),
}))
vi.mock('../../src/components/map-view', () => ({ MapView: nothing }))
vi.mock('../../src/features/drawings/drawing-runtime-bridge', () => ({ DrawingRuntimeBridge: nothing }))
vi.mock('../../src/features/diagnostics/diagnostics-runtime-bridge', () => ({ DiagnosticsRuntimeBridge: nothing }))
vi.mock('../../src/features/layers/layer-catalog-runtime-bridge', () => ({ LayerCatalogRuntimeBridge: nothing }))
vi.mock('../../src/features/markers/marker-runtime-bridge', () => ({ MarkerRuntimeBridge: nothing }))
vi.mock('../../src/features/outings/outing-runtime-bridge', () => ({ OutingRuntimeBridge: nothing }))
vi.mock('../../src/features/participants/participant-runtime-bridge', () => ({ ParticipantRuntimeBridge: nothing }))
vi.mock('../../src/features/measurements/measurement-runtime-bridge', () => ({ MeasurementRuntimeBridge: nothing }))
vi.mock('../../src/features/mission-review/mission-review-runtime-bridge', () => ({ MissionReviewRuntimeBridge: nothing }))
vi.mock('../../src/features/gpx/gpx-runtime-bridge', () => ({ GpxRuntimeBridge: nothing }))
vi.mock('../../src/features/helicopters/helicopter-runtime-bridge', () => ({ HelicopterRuntimeBridge: nothing }))
vi.mock('../../src/components/diagnostics-workspace', () => ({ DiagnosticsWorkspace: nothing }))
vi.mock('../../src/components/coordinate-converter-dialog', () => ({ CoordinateConverterDialog: nothing }))
vi.mock('../../src/components/devices-workspace', () => ({ DevicesWorkspace: nothing }))
vi.mock('../../src/components/mission-review-workspace', () => ({ MissionReviewWorkspace: nothing }))
vi.mock('../../src/components/marker-dialog', () => ({ MarkerDialog: nothing }))
vi.mock('../../src/components/settings-workspace', () => ({ SettingsWorkspace: nothing }))
vi.mock('../../src/components/mission-control-panel', () => ({ MissionControlPanel: nothing }))
vi.mock('../../src/components/deferred-gpx-import-panel', () => ({ DeferredGpxImportPanel: nothing }))
vi.mock('../../src/components/helicopter-panel', () => ({ HelicopterPanel: nothing }))
vi.mock('../../src/components/tracking-status-panel', () => ({
  TrackingStatusPanel: () => React.createElement('div', { 'data-testid': 'tracking-panel-stub' }),
}))
vi.mock('../../src/components/layer-filter-panel', () => ({
  LayerFilterPanel: () => React.createElement('div', { 'data-testid': 'layers-panel-stub' }),
}))

vi.mock('../../src/components/drawing-dialog', () => ({
  DrawingDialog: () => {
    if (fake.failDrawingDialog) throw new Error('drawing dialog failed to render')
    return null
  },
}))
vi.mock('../../src/features/diagnostics/diagnostic-event-log', () => ({
  recordDiagnosticEvent: fake.recordDiagnosticEvent,
}))

import { RendererRoot } from '../../src/features/runtime/renderer-root'
import { useRuntimeBootStore } from '../../src/features/runtime/runtime-boot-store'

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0)
    return 0
  })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  fake.failDrawingDialog = false
  fake.recordDiagnosticEvent.mockClear()
  useRuntimeBootStore.setState({ phase: 'booting', error: null })
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('first operational screen [DON-354]', () => {
  it('shows a visible, logged fault when the operational shell fails to render after booting', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const signalRendererMounted = vi.fn()
    fake.failDrawingDialog = true

    await act(async () => root.render(<RendererRoot bridge={{ signalRendererMounted }} />))
    expect(host.querySelector('[data-testid="runtime-booting-shell"]')).not.toBeNull()

    await act(async () => useRuntimeBootStore.setState({ phase: 'ready', error: null }))

    const fault = host.querySelector('[data-testid="operational-shell-fault"]')
    expect(fault).not.toBeNull()
    expect(fault?.getAttribute('role')).toBe('alert')
    expect(fault?.textContent).toContain('SAR Tracker could not show its mission screen')
    expect(fault?.textContent).toContain('drawing dialog failed to render')
    expect(host.querySelector('[data-testid="app-shell"]')).toBeNull()
    expect(fake.recordDiagnosticEvent).toHaveBeenCalledWith(expect.objectContaining({
      level: 'error',
      event: 'operational_shell_render_failed',
    }))
    // The window is still revealed, so the fault is seen rather than a hidden window.
    expect(signalRendererMounted).toHaveBeenCalled()
  })

  it('shows the mission screen on a healthy start', async () => {
    const signalRendererMounted = vi.fn()

    await act(async () => root.render(<RendererRoot bridge={{ signalRendererMounted }} />))
    await act(async () => useRuntimeBootStore.setState({ phase: 'ready', error: null }))

    expect(host.querySelector('[data-testid="app-shell"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="operational-shell-fault"]')).toBeNull()
    expect(fake.recordDiagnosticEvent).not.toHaveBeenCalledWith(expect.objectContaining({
      event: 'operational_shell_render_failed',
    }))
    expect(signalRendererMounted).toHaveBeenCalled()
  })
})
