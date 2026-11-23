// @vitest-environment jsdom

import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The real App layout and simplified workspace render; only the heavy panels,
// bridges and the map are stubbed [DON-338 REN-6, DON-341].
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
vi.mock('../../src/components/diagnostics-workspace', () => ({ DiagnosticsWorkspace: nothing }))
vi.mock('../../src/components/drawing-dialog', () => ({ DrawingDialog: nothing }))
vi.mock('../../src/components/coordinate-converter-dialog', () => ({ CoordinateConverterDialog: nothing }))
vi.mock('../../src/components/devices-workspace', () => ({ DevicesWorkspace: nothing }))
vi.mock('../../src/components/mission-review-workspace', () => ({ MissionReviewWorkspace: nothing }))
vi.mock('../../src/components/marker-dialog', () => ({ MarkerDialog: nothing }))
vi.mock('../../src/components/settings-workspace', () => ({ SettingsWorkspace: nothing }))
vi.mock('../../src/components/mission-control-panel', () => ({ MissionControlPanel: nothing }))
vi.mock('../../src/components/gpx-import-panel', () => ({ GpxImportPanel: nothing }))
vi.mock('../../src/components/helicopter-panel', () => ({ HelicopterPanel: nothing }))
vi.mock('../../src/components/tracking-status-panel', () => ({
  TrackingStatusPanel: () => React.createElement('div', { 'data-testid': 'tracking-panel-stub' }),
}))
vi.mock('../../src/components/layer-filter-panel', () => ({
  LayerFilterPanel: () => React.createElement('div', { 'data-testid': 'layers-panel-stub' }),
}))

import App from '../../src/App'
import type { CoverageState } from '../../src/features/tracking/coverage-controller'
import { applyCoverageState, useCoverageStore } from '../../src/features/tracking/coverage-store'
import { useMissionStore } from '../../src/features/mission/mission-store'
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
  useRuntimeBootStore.setState({ phase: 'ready', error: null })
  useMissionStore.setState({
    phase: 'active',
    currentMission: { id: 'mission-1', name: 'Exercise', start_time: '2026-11-21T10:00:00.000Z' } as ReturnType<typeof useMissionStore.getState>['currentMission'],
  })
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
  useCoverageStore.setState({ state: { status: 'inactive' }, sourceState: { status: 'inactive' } })
})

describe('DON-338 REN-6: whole-history warning outside the side panel', () => {
  it('stays visible with the side panel closed for a full map', () => {
    renderApp()
    clickTestId('ws-full-map')
    act(() => applyCoverageState(coverage('error', { updating: true })))

    expect(host.querySelector('[data-testid="ws-side"]')?.getAttribute('data-empty')).toBe('true')
    const indicator = host.querySelector<HTMLButtonElement>('[data-testid="coverage-attention-indicator"]')
    expect(indicator).not.toBeNull()
    expect(indicator?.closest('[data-testid="ws-side"]')).toBeNull()
    expect(indicator?.textContent).toContain('the history line could not be updated')
    expect(indicator?.textContent).toContain('Open Tracking for details.')
  })

  it('opens the Tracking panel when pressed, and is not repeated there', () => {
    renderApp()
    clickTestId('ws-full-map')
    act(() => applyCoverageState(coverage('partial', { updating: true, stalled: true })))
    expect(indicatorText()).toContain('has not updated for over 2 minutes')

    clickTestId('coverage-attention-indicator')
    expect(host.querySelector('[data-testid="ws-tracking-panel"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="tracking-panel-stub"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="coverage-attention-indicator"]')).toBeNull()
  })

  it('shows while People or Layers is open', () => {
    renderApp()
    act(() => applyCoverageState(coverage('partial', { updating: false })))
    expect(host.querySelector('[data-testid="ws-people-panel"]')).not.toBeNull()
    expect(indicatorText()).toContain('the history line is incomplete')

    clickTestId('ws-toggle-layers')
    expect(host.querySelector('[data-testid="layers-panel-stub"]')).not.toBeNull()
    expect(indicatorText()).toContain('the history line is incomplete')
  })

  it('stays calm while the line is up to date or catching up normally', () => {
    renderApp()
    clickTestId('ws-full-map')
    act(() => applyCoverageState(coverage('complete')))
    expect(host.querySelector('[data-testid="coverage-attention-indicator"]')).toBeNull()

    act(() => applyCoverageState(coverage('partial', { updating: true, drawnFixCount: 90 })))
    expect(host.querySelector('[data-testid="coverage-attention-indicator"]')).toBeNull()

    act(() => applyCoverageState(coverage('loading', { updating: true, drawnFixCount: 0 })))
    expect(host.querySelector('[data-testid="coverage-attention-indicator"]')).toBeNull()
  })

  it('ignores coverage that belongs to another mission', () => {
    renderApp()
    act(() => applyCoverageState({ ...coverage('error'), missionId: 'mission-2' }))
    expect(host.querySelector('[data-testid="coverage-attention-indicator"]')).toBeNull()
  })
})

function renderApp(): void {
  act(() => root.render(React.createElement(App)))
}

function clickTestId(testId: string): void {
  const element = host.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)
  if (element === null) throw new Error(`${testId} did not render`)
  act(() => element.click())
}

function indicatorText(): string | undefined {
  return host.querySelector('[data-testid="coverage-attention-indicator"]')?.textContent ?? undefined
}

function coverage(
  status: 'loading' | 'partial' | 'complete' | 'error',
  options: { readonly updating?: boolean; readonly stalled?: boolean; readonly drawnFixCount?: number } = {},
): Exclude<CoverageState, { status: 'inactive' }> {
  return {
    status,
    missionId: 'mission-1', rendererGeneration: 'r1',
    changeSeq: 1, latestObservedChangeSeq: 1,
    manifest: { changeSeq: 1, enumerated: true, pendingInvalidation: false, backfillIncomplete: false, outings: [], chunks: [] },
    tileCatalog: null, delivered: {},
    deliveredFixCount: 90, totalFixCount: 100,
    blockers: [],
    drawnFixCount: options.drawnFixCount ?? 90,
    ...(options.updating === undefined ? {} : { updating: options.updating }),
    ...(options.stalled === undefined ? {} : { stalled: options.stalled }),
  }
}
