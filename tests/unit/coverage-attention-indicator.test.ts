// @vitest-environment jsdom

import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The real App layout, awareness strip and OperationalSidebar render; only the
// heavy panels, bridges and the map are stubbed [DON-338 REN-6].
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
vi.mock('../../src/components/deferred-gpx-import-panel', () => ({ DeferredGpxImportPanel: nothing }))
vi.mock('../../src/components/helicopter-panel', () => ({ HelicopterPanel: nothing }))
vi.mock('../../src/components/tracking-status-panel', () => ({
  TrackingStatusPanel: () => React.createElement('div', { 'data-testid': 'tracking-panel-stub' }),
}))
vi.mock('../../src/components/layer-filter-panel', () => ({
  LayerFilterPanel: (props: { readonly onCollapseWorkspace: () => void }) =>
    React.createElement('button', { 'data-testid': 'collapse-stub', onClick: props.onCollapseWorkspace, type: 'button' }, 'Hide'),
}))

import App from '../../src/App'
import type { CoverageState } from '../../src/features/tracking/coverage-controller'
import { applyCoverageState, useCoverageStore } from '../../src/features/tracking/coverage-store'
import { useMissionStore } from '../../src/features/mission/mission-store'
import { useRuntimeBootStore } from '../../src/features/runtime/runtime-boot-store'
import { useFocusModeStore } from '../../src/features/focus-mode/focus-mode-store'

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
  useFocusModeStore.setState({ active: false })
  useMissionStore.setState({
    currentMission: { id: 'mission-1' } as ReturnType<typeof useMissionStore.getState>['currentMission'],
  })
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
  useCoverageStore.setState({ state: { status: 'inactive' }, sourceState: { status: 'inactive' } })
})

describe('DON-338 REN-6: whole-history warning outside the collapsible sidebar', () => {
  it('stays visible with the sidebar collapsed', () => {
    renderApp()
    // Collapse is offered from the Layers tab.
    clickTestId('sidebar-tab-layers')
    clickTestId('collapse-stub')
    act(() => applyCoverageState(coverage('error', { updating: true })))

    expect(sidebar().style.display).toBe('none')
    const indicator = host.querySelector<HTMLButtonElement>('[data-testid="coverage-attention-indicator"]')
    expect(indicator).not.toBeNull()
    expect(indicator?.closest('[data-testid="operational-sidebar"]')).toBeNull()
    expect(indicator?.textContent).toContain('the history line could not be updated')
    expect(indicator?.textContent).toContain('Open Tracking for details.')
  })

  it('restores the sidebar and opens Tracking when pressed', () => {
    renderApp()
    clickTestId('sidebar-tab-layers')
    clickTestId('collapse-stub')
    act(() => applyCoverageState(coverage('partial', { updating: true, stalled: true })))
    expect(indicatorText()).toContain('has not updated for over 2 minutes')

    clickTestId('coverage-attention-indicator')
    expect(sidebar().style.display).toBe('')
    expect(host.querySelector('[data-testid="sidebar-tab-tracking"]')?.getAttribute('aria-pressed')).toBe('true')
    expect(host.querySelector('[data-testid="tracking-panel-stub"]')).not.toBeNull()
    // Tracking shows the full panel, so the compact warning is not repeated there.
    expect(host.querySelector('[data-testid="coverage-attention-indicator"]')).toBeNull()
  })

  it('shows on any other tab while the sidebar is open', () => {
    renderApp()
    act(() => applyCoverageState(coverage('partial', { updating: false })))
    expect(host.querySelector('[data-testid="coverage-attention-indicator"]')).toBeNull()

    clickTestId('sidebar-tab-tools')
    expect(indicatorText()).toContain('the history line is incomplete')
    clickTestId('coverage-attention-indicator')
    expect(host.querySelector('[data-testid="tracking-panel-stub"]')).not.toBeNull()
  })

  it('shows in Focus Mode, which opens on the Layers tab', () => {
    useFocusModeStore.setState({ active: true })
    renderApp()
    act(() => applyCoverageState(coverage('error')))
    expect(indicatorText()).toContain('the history line could not be updated')
  })

  it('stays calm while the line is up to date or catching up normally', () => {
    renderApp()
    clickTestId('sidebar-tab-layers')
    clickTestId('collapse-stub')
    act(() => applyCoverageState(coverage('complete')))
    expect(host.querySelector('[data-testid="coverage-attention-indicator"]')).toBeNull()

    act(() => applyCoverageState(coverage('partial', { updating: true, drawnFixCount: 90 })))
    expect(host.querySelector('[data-testid="coverage-attention-indicator"]')).toBeNull()

    act(() => applyCoverageState(coverage('loading', { updating: true, drawnFixCount: 0 })))
    expect(host.querySelector('[data-testid="coverage-attention-indicator"]')).toBeNull()
  })

  it('ignores coverage that belongs to another mission', () => {
    renderApp()
    clickTestId('sidebar-tab-layers')
    act(() => applyCoverageState({ ...coverage('error'), missionId: 'mission-2' }))
    expect(host.querySelector('[data-testid="coverage-attention-indicator"]')).toBeNull()
  })
})

function renderApp(): void {
  act(() => root.render(React.createElement(App)))
}

function sidebar(): HTMLElement {
  const element = host.querySelector<HTMLElement>('[data-testid="operational-sidebar"]')
  if (element === null) throw new Error('operational sidebar did not render')
  return element
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
