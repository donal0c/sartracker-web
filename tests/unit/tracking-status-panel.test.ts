import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import { TrackingStatusPanel } from '../../src/components/tracking-status-panel'
import { useDeviceWorkspaceStore } from '../../src/features/tracking/device-workspace-store'
import { useTrackingStore } from '../../src/features/tracking/tracking-store'
import { useTrackingStyleStore } from '../../src/features/tracking/tracking-style-store'
import { useIngestHealthStore } from '../../src/features/tracking/ingest-health-store'
import { useStationaryAttentionStore } from '../../src/features/tracking/stationary-attention-store'

let root: Root | null = null
let host: HTMLDivElement | null = null

describe('TrackingStatusPanel', () => {
  afterEach(() => {
    if (root !== null) {
      act(() => root?.unmount())
    }
    host?.remove()
    root = null
    host = null
    useTrackingStore.setState(useTrackingStore.getInitialState())
    useDeviceWorkspaceStore.setState(useDeviceWorkspaceStore.getInitialState())
    useTrackingStyleStore.setState(useTrackingStyleStore.getInitialState())
    useIngestHealthStore.setState(useIngestHealthStore.getInitialState())
    useStationaryAttentionStore.setState(useStationaryAttentionStore.getInitialState())
  })

  it('renders offline tracking mode and OFFLINE MODE warning as a flashing red alert', () => {
    useTrackingStore.setState({
      status: {
        mode: 'offline',
        consecutiveFailures: 2,
        recovered: false,
        lastSuccessAt: '2026-04-10T12:00:00.000Z',
        warning: 'OFFLINE MODE - showing last known positions.',
      },
    })

    render(React.createElement(TrackingStatusPanel))

    expect(getElement('[data-testid="tracking-mode-chip"]').className).toContain(
      'sar-status-chip-alert',
    )
    expect(getElement('[data-testid="tracking-warning"]').className).toContain(
      'sar-status-alert-panel',
    )
    expect(getText('[data-testid="tracking-warning"]')).toContain('OFFLINE MODE')
    expect(
      getElement('[data-testid="open-devices-workspace"]').getAttribute('aria-describedby'),
    ).toBe('tracking-status-message')
  })

  it('renders paused live-refresh suspension as a flashing red alert even while mode is idle', () => {
    useTrackingStore.setState({
      status: {
        mode: 'idle',
        consecutiveFailures: 0,
        recovered: false,
        lastSuccessAt: null,
        warning: 'Live refresh suspended while mission is paused.',
      },
    })

    render(React.createElement(TrackingStatusPanel))

    expect(getElement('[data-testid="tracking-mode-chip"]').className).toContain(
      'sar-status-chip-alert',
    )
    expect(getElement('[data-testid="tracking-warning"]').className).toContain(
      'sar-status-alert-panel',
    )
    expect(getText('[data-testid="tracking-mode-chip"]')).toContain('paused')
    expect(getText('[data-testid="tracking-mode-chip"]')).not.toContain('idle')
    expect(getText('[data-testid="tracking-warning"]')).toContain('Live refresh suspended')
  })

  it('shows rejected-row and unverified-fix-time warnings while retaining valid fixes [DON-267]', () => {
    useTrackingStore.setState((state) => ({
      snapshot: {
        ...state.snapshot,
        positions: [{
          id: 'position-1',
          device_id: 'device-1',
          lat: 52,
          lon: -9.7,
          altitude: null,
          speed: null,
          battery: null,
          accuracy: null,
          timestamp: '2026-08-22T10:00:00.000Z',
          timestamp_source: 'server',
          fix_time_unverified: true,
          source: 'osmand',
          data_origin: 'live',
          cache_age_seconds: null,
          device_cache_stale: true,
        }],
      },
    }))
    useIngestHealthStore.getState().applyRejections([
      { deviceId: 'device-1', reason: 'invalid_coordinates', rowIndex: 1 },
    ])

    render(React.createElement(TrackingStatusPanel))

    expect(getText('[data-testid="current-position-ingest-warning"]')).toContain(
      'Valid current fixes remain visible',
    )
    expect(getText('[data-testid="fix-time-unverified-warning"]')).toContain(
      'not treated as a fresh device fix',
    )
    expect(getText('[data-testid="tracking-counters"]')).toContain('1')
  })

  it('shows persistent degraded evidence health and first-accepted conflict truth [DON-268]', () => {
    useIngestHealthStore.getState().applyEvidenceHealth({
      state: 'degraded',
      reason: 'projection_failed',
      pendingCount: 1,
      corruptCount: 0,
      conflictCount: 1,
      rejectedCount: 0,
      affectedDeviceCount: 1,
      conflictDeviceIds: ['device-1'],
    })

    render(React.createElement(TrackingStatusPanel))

    expect(getText('[data-testid="ingest-evidence-health-warning"]')).toContain(
      'EVIDENCE HEALTH DEGRADED',
    )
    expect(getText('[data-testid="ingest-evidence-health-warning"]')).toContain(
      'Current positions remain live',
    )
    expect(getText('[data-testid="ingest-evidence-health-warning"]')).toContain(
      'finalization and archive export are blocked',
    )
    expect(getText('[data-testid="position-conflict-warning"]')).toContain(
      'first accepted fix remains displayed',
    )
  })

  it('summarizes stationary attention without declaring an emergency [DON-269]', () => {
    useStationaryAttentionStore.setState({ byDevice: {
      'device-1': { state: 'attention', acknowledged: false, sinceTimestamp: '2026-08-22T10:00:00.000Z', elapsedMs: 1_200_000, movementThresholdM: 15 },
    } })
    render(React.createElement(TrackingStatusPanel))
    const text = getText('[data-testid="stationary-attention-summary"]')
    expect(text).toContain('1 device needs stationary attention')
    expect(text.toLowerCase()).not.toContain('emergency')
  })

  it('makes a bounded whole-route trail explicit without implying stored data loss [DON-260]', () => {
    useTrackingStore.setState((state) => ({
      snapshot: {
        ...state.snapshot,
        breadcrumbMetadata: {
          totalRetained: 3_000,
          totalObserved: 12_000,
          deviceBudgets: [
            {
              deviceId: 'tracker-1',
              retained: 3_000,
              sourceRetained: 3_000,
              total: 12_000,
              firstTimestamp: '2026-07-28T00:00:00.000Z',
              lastTimestamp: '2026-07-28T03:19:59.000Z',
              truncated: true,
              geometryErrorBoundMetres: 25,
              targetGeometryErrorSatisfied: true,
            },
          ],
        },
      },
    }))

    render(React.createElement(TrackingStatusPanel))

    expect(getText('[data-testid="breadcrumb-display-summary"]')).toContain(
      '3,000 of at least 12,000 known fixes',
    )
    expect(getText('[data-testid="breadcrumb-display-summary"]')).toContain(
      'Full mission history remains stored',
    )
    expect(getText('[data-testid="breadcrumb-display-summary"]')).toContain(
      'Displayed route error is bounded to 25 metres',
    )
  })

  it('does not invent a 25-metre guarantee for legacy display metadata', () => {
    useTrackingStore.setState((state) => ({
      snapshot: {
        ...state.snapshot,
        breadcrumbMetadata: {
          totalRetained: 3_000,
          totalObserved: 12_000,
          deviceBudgets: [
            {
              deviceId: 'tracker-1',
              retained: 3_000,
              sourceRetained: 3_000,
              total: 12_000,
              firstTimestamp: '2026-07-28T00:00:00.000Z',
              lastTimestamp: '2026-07-28T03:19:59.000Z',
              truncated: true,
            },
          ],
        },
      },
    }))

    render(React.createElement(TrackingStatusPanel))

    expect(getText('[data-testid="breadcrumb-display-summary"]')).toContain(
      'too complex for a guaranteed display-error bound',
    )
    expect(getText('[data-testid="breadcrumb-display-summary"]')).not.toContain(
      'bounded to 25 metres',
    )
  })

  it('states the achieved bound when route complexity exceeds the 25-metre target', () => {
    useTrackingStore.setState((state) => ({
      snapshot: {
        ...state.snapshot,
        breadcrumbMetadata: {
          totalRetained: 5_000,
          totalObserved: 12_000,
          deviceBudgets: [
            {
              deviceId: 'tracker-1',
              retained: 5_000,
              sourceRetained: 12_000,
              total: 12_000,
              firstTimestamp: '2026-07-28T00:00:00.000Z',
              lastTimestamp: '2026-07-28T16:39:55.000Z',
              truncated: true,
              geometryErrorBoundMetres: 42.1,
              targetGeometryErrorSatisfied: false,
            },
          ],
        },
      },
    }))

    render(React.createElement(TrackingStatusPanel))

    expect(getText('[data-testid="breadcrumb-display-summary"]')).toContain(
      'Displayed route error may be up to 43 metres for this route',
    )
  })

  it('shows exact-dot paging in dots mode without presenting the line simplification warning as dot semantics', () => {
    seedSimplifiedLineMetadata()
    useTrackingStyleStore.setState({ breadcrumbTrailMode: 'dots' })
    const TrackingStatusPanelWithExactDots = TrackingStatusPanel as React.ComponentType<{
      readonly exactBreadcrumbDotState: {
        readonly status: 'ready'
        readonly totalPositionCount: number
        readonly pagePositionCount: number
        readonly fromTimestamp: string
        readonly toTimestamp: string
        readonly hasEarlier: boolean
        readonly hasLater: boolean
      }
      readonly onExactBreadcrumbDotsEarlier: () => void
      readonly onExactBreadcrumbDotsLater: () => void
    }>

    render(React.createElement(TrackingStatusPanelWithExactDots, {
      exactBreadcrumbDotState: {
        status: 'ready',
        totalPositionCount: 10_001,
        pagePositionCount: 10_000,
        fromTimestamp: '2026-08-08T00:00:00.000Z',
        toTimestamp: '2026-08-09T12:00:00.000Z',
        hasEarlier: true,
        hasLater: false,
      },
      onExactBreadcrumbDotsEarlier: () => undefined,
      onExactBreadcrumbDotsLater: () => undefined,
    }))

    expect(document.querySelector('[data-testid="breadcrumb-display-summary"]')).toBeNull()
    expect(getText('[data-testid="exact-breadcrumb-dot-page-summary"]')).toBe(
      'Exact fix inspection — showing 10,000 of 10,001 — 2026-08-08T00:00:00.000Z to 2026-08-09T12:00:00.000Z',
    )
  })

  it('keeps line simplification and route-error disclosure unchanged in line mode', () => {
    seedSimplifiedLineMetadata()
    useTrackingStyleStore.setState({ breadcrumbTrailMode: 'line' })

    render(React.createElement(TrackingStatusPanel))

    expect(getText('[data-testid="breadcrumb-display-summary"]')).toContain(
      'Trail display simplified: showing 5,000 of at least 12,000 known fixes',
    )
    expect(getText('[data-testid="breadcrumb-display-summary"]')).toContain(
      'Displayed route error may be up to 43 metres for this route',
    )
    expect(document.querySelector('[data-testid="exact-breadcrumb-dot-page-summary"]')).toBeNull()
  })
})

function seedSimplifiedLineMetadata(): void {
  useTrackingStore.setState((state) => ({
    snapshot: {
      ...state.snapshot,
      breadcrumbMetadata: {
        totalRetained: 5_000,
        totalObserved: 12_000,
        deviceBudgets: [
          {
            deviceId: 'tracker-1',
            retained: 5_000,
            sourceRetained: 12_000,
            total: 12_000,
            firstTimestamp: '2026-07-28T00:00:00.000Z',
            lastTimestamp: '2026-07-28T16:39:55.000Z',
            truncated: true,
            geometryErrorBoundMetres: 42.1,
            targetGeometryErrorSatisfied: false,
          },
        ],
      },
    },
  }))
}

function render(element: React.ReactElement): void {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => root?.render(element))
}

function getElement(selector: string): HTMLElement {
  const element = document.querySelector(selector)
  if (!(element instanceof HTMLElement)) {
    throw new Error(`Expected ${selector} to exist.`)
  }
  return element
}

function getText(selector: string): string {
  return getElement(selector).textContent ?? ''
}
