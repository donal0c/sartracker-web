// @vitest-environment jsdom
import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The four on-demand screens fail to load, as from a damaged or half-replaced
// install: each mocked module throws, so its dynamic import rejects.
const nothing = vi.hoisted(() => () => null)
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
vi.mock('../../src/components/diagnostics-workspace', () => { throw new Error('diagnostics-workspace chunk is missing') })
vi.mock('../../src/components/drawing-dialog', () => ({ DrawingDialog: nothing }))
vi.mock('../../src/components/coordinate-converter-dialog', () => ({ CoordinateConverterDialog: nothing }))
vi.mock('../../src/components/devices-workspace', () => { throw new Error('devices-workspace chunk is missing') })
vi.mock('../../src/components/mission-review-workspace', () => { throw new Error('mission-review-workspace chunk is missing') })
vi.mock('../../src/components/marker-dialog', () => ({ MarkerDialog: nothing }))
vi.mock('../../src/components/settings-workspace', () => { throw new Error('settings-workspace chunk is missing') })
vi.mock('../../src/components/mission-control-panel', () => ({ MissionControlPanel: nothing }))
vi.mock('../../src/components/deferred-gpx-import-panel', () => ({ DeferredGpxImportPanel: nothing }))
vi.mock('../../src/components/helicopter-panel', () => ({ HelicopterPanel: nothing }))
vi.mock('../../src/components/tracking-status-panel', () => ({
  TrackingStatusPanel: () => React.createElement('div', { 'data-testid': 'tracking-panel-stub' }),
}))
vi.mock('../../src/components/layer-filter-panel', () => ({
  LayerFilterPanel: () => React.createElement('div', { 'data-testid': 'layers-panel-stub' }),
}))

import App from '../../src/App'
import { useMissionStore } from '../../src/features/mission/mission-store'
import { useRuntimeBootStore } from '../../src/features/runtime/runtime-boot-store'

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  useRuntimeBootStore.setState({ phase: 'ready', error: null })
  useMissionStore.setState({
    phase: 'active',
    currentMission: { id: 'mission-1', name: 'Exercise', start_time: '2026-11-21T10:00:00.000Z' } as ReturnType<typeof useMissionStore.getState>['currentMission'],
  })
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.restoreAllMocks()
})

describe('a lazy screen that fails to load', () => {
  it('shows a plain message for that screen and keeps the top bar, alarms and banners up', async () => {
    await act(async () => { root.render(React.createElement(App)) })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)) })

    const failures = [...host.querySelectorAll('[data-testid="lazy-screen-load-failure"]')]
    expect(failures.map((node) => node.getAttribute('data-screen')).sort()).toEqual(
      ['Devices', 'Diagnostics', 'Mission review', 'Settings'],
    )
    for (const failure of failures) {
      expect(failure.getAttribute('role')).toBe('alert')
      expect(failure.textContent).toMatch(/could not be loaded/)
      expect(failure.textContent).toMatch(/Restart SAR Tracker/)
    }
    // The rest of the app stays up: shell, top bar with the tracking line, and the side slot.
    expect(host.querySelector('[data-testid="app-shell"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="ws-top-bar"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="ws-tracking-headline"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="ws-side"]')).not.toBeNull()
  })
})
