// @vitest-environment jsdom

import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/components/mission-control-panel', () => ({ MissionControlPanel: () => null }))
vi.mock('../../src/components/tracking-status-panel', () => ({
  TrackingStatusPanel: () => React.createElement('div', { 'data-testid': 'tracking-panel-stub' }),
}))
vi.mock('../../src/components/layer-filter-panel', () => ({ LayerFilterPanel: () => null }))
vi.mock('../../src/components/deferred-gpx-import-panel', () => ({ DeferredGpxImportPanel: () => null }))
vi.mock('../../src/components/helicopter-panel', () => ({ HelicopterPanel: () => null }))
vi.mock('../../src/components/focus-mode-toggle', () => ({ FocusModeToggle: () => null }))

import { OperationalSidebar } from '../../src/components/operational-sidebar'
import type { CoverageState } from '../../src/features/tracking/coverage-controller'
import { applyCoverageState, useCoverageStore } from '../../src/features/tracking/coverage-store'
import { useMissionStore } from '../../src/features/mission/mission-store'

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  useMissionStore.setState({
    currentMission: { id: 'mission-1' } as ReturnType<typeof useMissionStore.getState>['currentMission'],
  })
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  useCoverageStore.setState({ state: { status: 'inactive' }, sourceState: { status: 'inactive' } })
})

describe('DON-338 REN-6: whole-history warning outside the Tracking tab', () => {
  it('shows a failed history line on the Layers tab and opens Tracking when pressed', () => {
    renderSidebar(true)
    act(() => applyCoverageState(coverage('error', { updating: true })))

    const indicator = host.querySelector('[data-testid="coverage-attention-indicator"]')
    expect(indicator?.textContent).toContain('the history line could not be updated')
    expect(indicator?.textContent).toContain('Open Tracking for details.')

    act(() => (indicator as HTMLButtonElement).click())
    expect(host.querySelector('[data-testid="tracking-panel-stub"]')).not.toBeNull()
    // Tracking shows the full panel, so the compact warning is not repeated there.
    expect(host.querySelector('[data-testid="coverage-attention-indicator"]')).toBeNull()
  })

  it('warns when the line has stalled or is incomplete with nothing working on it', () => {
    renderSidebar(true)
    act(() => applyCoverageState(coverage('partial', { updating: true, stalled: true })))
    expect(indicatorText()).toContain('has not updated for over 2 minutes')

    act(() => applyCoverageState(coverage('partial', { updating: false })))
    expect(indicatorText()).toContain('the history line is incomplete')
  })

  it('stays calm while the line is up to date or catching up normally', () => {
    renderSidebar(true)
    act(() => applyCoverageState(coverage('complete')))
    expect(host.querySelector('[data-testid="coverage-attention-indicator"]')).toBeNull()

    act(() => applyCoverageState(coverage('partial', { updating: true, drawnFixCount: 90 })))
    expect(host.querySelector('[data-testid="coverage-attention-indicator"]')).toBeNull()

    act(() => applyCoverageState(coverage('loading', { updating: true, drawnFixCount: 0 })))
    expect(host.querySelector('[data-testid="coverage-attention-indicator"]')).toBeNull()
  })

  it('ignores coverage that belongs to another mission', () => {
    renderSidebar(false)
    act(() => applyCoverageState({ ...coverage('error'), missionId: 'mission-2' }))
    act(() => (host.querySelector('[data-testid="sidebar-tab-layers"]') as HTMLButtonElement).click())
    expect(host.querySelector('[data-testid="coverage-attention-indicator"]')).toBeNull()
  })
})

function indicatorText(): string | undefined {
  return host.querySelector('[data-testid="coverage-attention-indicator"]')?.textContent ?? undefined
}

function sidebarProps(focusModeActive: boolean) {
  return {
    focusModeActive,
    collapseDisabledReason: null,
    onActionErrorChange: () => undefined,
    onDecisionOpenChange: () => undefined,
    onMinimizedChange: () => undefined,
    onCollapseWorkspace: () => undefined,
  }
}

/** Focus Mode opens on the Layers tab, which is where the warning used to be missing. */
function renderSidebar(focusModeActive: boolean): void {
  act(() => root.render(React.createElement(OperationalSidebar, sidebarProps(focusModeActive))))
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
