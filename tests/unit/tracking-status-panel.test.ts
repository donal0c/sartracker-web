import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { TrackingStatusPanel } from '../../src/components/tracking-status-panel'
import { useDeviceWorkspaceStore } from '../../src/features/tracking/device-workspace-store'
import { useTrackingStore } from '../../src/features/tracking/tracking-store'
import { useTrackingStyleStore } from '../../src/features/tracking/tracking-style-store'
import { useIngestHealthStore } from '../../src/features/tracking/ingest-health-store'
import { useStationaryAttentionStore } from '../../src/features/tracking/stationary-attention-store'
import { useCoverageStore } from '../../src/features/tracking/coverage-store'
import { useLayerVisibilityStore } from '../../src/features/layers/layer-visibility-store'
import { useMissionStore } from '../../src/features/mission/mission-store'
import type { Mission } from '../../src/infrastructure/mission-store/tauri-mission-store'

let root: Root | null = null
let host: HTMLDivElement | null = null

describe('TrackingStatusPanel', () => {
  it.each(['loading', 'complete', 'failed'] as const)('shows distinct %s history state only for its mission', (state) => {
    useMissionStore.setState({ currentMission: mission('mission-2'), phase: 'active' })
    useTrackingStore.setState({ status: { mode: 'online', consecutiveFailures: 0, recovered: false,
      lastSuccessAt: null, warning: null, savedHistoryTransfer: { missionId: 'mission-1', state,
        receivedPositions: 1, totalPositions: 2 } } })
    render(React.createElement(TrackingStatusPanel))
    expect(host!.textContent).not.toContain('Saved history')
    expect(host!.querySelector('progress')).toBeNull()
    act(() => useMissionStore.setState({ currentMission: mission('mission-1') }))
    expect(host!.textContent).toContain(state === 'loading' ? 'history is not yet complete'
      : state === 'complete' ? 'Saved history transfer complete' : 'Saved history could not be loaded')
    expect(host!.querySelector('progress') !== null).toBe(state === 'loading')
  })

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
    useCoverageStore.setState(useCoverageStore.getInitialState())
    useMissionStore.setState(useMissionStore.getInitialState())
    useLayerVisibilityStore.setState(useLayerVisibilityStore.getInitialState())
  })

  it('does not call the stream healthy in green while every position is stale [M-20]', () => {
    useTrackingStore.setState({
      snapshot: {
        devices: [{ device_id: 'alpha', name: 'Alpha', status: 'online', last_seen: null, unique_id: null, category: null }],
        positions: [{
          id: 'p1', device_id: 'alpha', lat: 52, lon: -9.7, altitude: null, speed: null, battery: null, accuracy: null,
          timestamp: '2026-04-10T11:00:00.000Z', source: null, data_origin: 'live', cache_age_seconds: null, device_cache_stale: true,
        }],
        breadcrumbs: [],
      },
      status: { mode: 'online', consecutiveFailures: 0, recovered: false, lastSuccessAt: '2026-04-10T12:00:00.000Z', warning: null },
    })

    render(React.createElement(TrackingStatusPanel))

    expect(host!.textContent).not.toContain('Telemetry stream healthy')
    expect(getElement('[data-testid="tracking-mode-chip"]').className).not.toContain('sar-status-chip-success')
    expect(getText('[data-testid="tracking-warning"]')).toContain('Feed connected · 1 position not current')
  })

  it('does not say the feed is connected while tracking is offline or idle with stale positions [DON-358]', () => {
    const stalePosition = {
      id: 'p1', device_id: 'alpha', lat: 52, lon: -9.7, altitude: null, speed: null, battery: null, accuracy: null,
      timestamp: '2026-04-10T11:00:00.000Z', source: null, data_origin: 'live' as const, cache_age_seconds: null, device_cache_stale: true,
    }
    const snapshot = {
      devices: [{ device_id: 'alpha', name: 'Alpha', status: 'online', last_seen: null, unique_id: null, category: null }],
      positions: [stalePosition],
      breadcrumbs: [],
    }
    for (const [mode, expected] of [['offline', 'Tracking offline · 1 position not current'], ['idle', 'Tracking not connected · 1 position not current']] as const) {
      useTrackingStore.setState({
        snapshot,
        status: { mode, consecutiveFailures: 0, recovered: false, lastSuccessAt: null, warning: null },
      })
      render(React.createElement(TrackingStatusPanel))
      const warning = getText('[data-testid="tracking-warning"]')
      expect(warning).not.toContain('Feed connected')
      expect(warning).toContain(expected)
      act(() => root?.unmount())
      host?.remove()
      root = null
      host = null
    }
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

  it('shows Last success as a complete local operator timestamp [DON-267]', () => {
    useTrackingStore.setState({
      status: {
        mode: 'online',
        consecutiveFailures: 0,
        recovered: false,
        lastSuccessAt: '2026-08-22T15:10:17.000Z',
        warning: null,
      },
    })

    render(React.createElement(TrackingStatusPanel))

    expect(document.body.textContent).toMatch(
      /Last success22\/08\/2026, \d{2}:10:17 GMT[+-]\d{2}:\d{2} \(.+\)/u,
    )
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

  it('warns in plain words when fix times are ahead of this laptop clock [DON-349 M-06]', () => {
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
          timestamp: '2026-08-22T11:00:00.000Z',
          timestamp_source: 'fix',
          fix_time_unverified: false,
          fix_time_ahead_of_clock: true,
          source: 'traccar',
          data_origin: 'live',
          cache_age_seconds: null,
          device_cache_stale: true,
        }],
      },
    }))

    render(React.createElement(TrackingStatusPanel))

    expect(getText('[data-testid="fix-time-ahead-warning"]')).toBe(
      'FIX TIME AHEAD OF THIS LAPTOP — 1 device reports a fix time more than 2 minutes in the future. It is shown as stale. Check the laptop clock and the tracker time zone.',
    )
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
          timestamp_source: 'device',
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
    expect(getText('[data-testid="fix-time-unverified-warning"]')).toBe(
      'FIX TIME UNVERIFIED — 1 position uses device clock, not verified Traccar fixTime. It remains visible for immediate safety but is excluded from exact breadcrumb evidence.',
    )
    expect(getText('[data-testid="tracking-counters"]')).toContain('1')
  })

  it('identifies unprovable legacy cache provenance without treating it as canonical fixTime [DON-267]', () => {
    useTrackingStore.setState((state) => ({
      snapshot: {
        ...state.snapshot,
        positions: [{
          id: 'legacy-position',
          device_id: 'device-1',
          lat: 52,
          lon: -9.7,
          altitude: null,
          speed: null,
          battery: null,
          accuracy: null,
          timestamp: '2026-08-22T10:00:00.000Z',
          fix_time_unverified: true,
          source: 'osmand',
          data_origin: 'cache',
          cache_age_seconds: 60,
          device_cache_stale: false,
        }],
      },
    }))

    render(React.createElement(TrackingStatusPanel))

    expect(getText('[data-testid="fix-time-unverified-warning"]')).toContain(
      'legacy cache provenance unavailable',
    )
    expect(getText('[data-testid="fix-time-unverified-warning"]')).toContain(
      'excluded from exact breadcrumb evidence',
    )
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

  it('describes renderer-held rejection evidence as pending save, not storage repair [DON-276]', () => {
    useIngestHealthStore.getState().applyEvidenceHealth({
      state: 'degraded',
      reason: 'renderer_evidence_pending',
      pendingCount: 1,
      corruptCount: 0,
      conflictCount: 0,
      rejectedCount: 1,
      affectedDeviceCount: 1,
      conflictDeviceIds: [],
    })

    render(React.createElement(TrackingStatusPanel))

    const warning = getText('[data-testid="ingest-evidence-health-warning"]')
    expect(warning).toContain('rejected-position evidence is waiting to be saved')
    expect(warning).not.toContain('requires repair')
  })

  it('describes renderer teardown evidence loss as a persistent safety blocker [DON-276]', () => {
    useIngestHealthStore.getState().applyEvidenceHealth({
      state: 'critical',
      reason: 'renderer_pending_evidence_lost',
      pendingCount: 0,
      corruptCount: 0,
      conflictCount: 0,
      rejectedCount: 1,
      affectedDeviceCount: 1,
      conflictDeviceIds: [],
    })

    render(React.createElement(TrackingStatusPanel))

    const warning = getText('[data-testid="ingest-evidence-health-warning"]')
    expect(warning).toContain('rejected-position evidence may have been lost when the app closed unexpectedly')
    expect(warning).toContain('finalization and archive export are blocked')
    expect(warning).toContain('authorized admin records the permanent known loss')
    expect(warning).not.toContain('until storage is repaired')
  })

  it('keeps acknowledged evidence loss visible without falsely saying archive is blocked [DON-276]', () => {
    useMissionStore.setState({
      governanceMission: {
        ...mission('mission-finished'),
        status: 'finished',
        finish_time: '2026-08-26T16:00:00.000Z',
      },
      governanceEvidenceHealth: {
        state: 'critical',
        reason: 'renderer_pending_evidence_lost',
        pendingCount: 0,
        corruptCount: 0,
        conflictCount: 0,
        rejectedCount: 1,
        affectedDeviceCount: 1,
        conflictDeviceIds: [],
        acknowledgedLoss: {
          adminName: 'Duty Admin',
          reason: 'Known runtime loss recorded in incident log.',
          acknowledgedAt: '2026-08-26T17:00:00.000Z',
        },
      },
    })

    render(React.createElement(TrackingStatusPanel))

    const warning = getText('[data-testid="ingest-evidence-health-warning"]')
    expect(warning).toContain('acknowledged by Duty Admin')
    expect(warning).toContain('Complete and 100% remain blocked')
    expect(warning).toContain('archive and lock may proceed')
    expect(warning).not.toContain('archive export are blocked')
  })

  it('does not project an older governance loss onto a recoverable active mission [DON-276]', () => {
    useMissionStore.setState({
      recoverableMission: mission('mission-recoverable'),
      governanceMission: {
        ...mission('mission-finished'),
        status: 'finished',
        finish_time: '2026-08-26T16:00:00.000Z',
      },
      governanceEvidenceHealth: {
        state: 'critical',
        reason: 'renderer_pending_evidence_lost',
        pendingCount: 0,
        corruptCount: 0,
        conflictCount: 0,
        rejectedCount: 1,
        affectedDeviceCount: 1,
        conflictDeviceIds: [],
      },
    })

    render(React.createElement(TrackingStatusPanel))

    expect(document.querySelector('[data-testid="ingest-evidence-health-warning"]')).toBeNull()
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

  it.each([
    ['Trails switched off', () => useLayerVisibilityStore.setState({ breadcrumbsVisible: false })],
    ['Tracking group switched off', () => useLayerVisibilityStore.setState((state) => ({
      groupVisibility: { ...state.groupVisibility, tracking: false },
    }))],
  ] as const)('never says a trail line is on the map when %s [DON-338]', (_label, switchOff) => {
    seedSimplifiedLineMetadata()
    useTrackingStyleStore.setState({ breadcrumbTrailMode: 'dots' })
    switchOff()
    const Panel = TrackingStatusPanel as React.ComponentType<{
      readonly exactBreadcrumbDotState: unknown
      readonly onExactBreadcrumbDotsEarlier: () => void
      readonly onExactBreadcrumbDotsLater: () => void
    }>
    render(React.createElement(Panel, {
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

    const note = getText('[data-testid="exact-breadcrumb-dots-whole-trail-note"]')
    expect(note).not.toContain('shows the whole trail')
    expect(note).not.toContain('The dots mark')
    expect(note).toContain('no trail line or dots are drawn on the map')
    expect(getText('[data-testid="breadcrumb-display-summary"]')).toContain(
      'of at least 12,000 known fixes across the full route.',
    )
    expect(getText('[data-testid="breadcrumb-display-summary"]')).toContain(
      'Trails are switched off on the Layers tab, so this line is not drawn on the map.',
    )

    act(() => useTrackingStyleStore.setState({ breadcrumbTrailMode: 'line' }))
    expect(getText('[data-testid="breadcrumb-display-summary"]')).toContain(
      'Trails are switched off on the Layers tab, so this line is not drawn on the map.',
    )
  })

  it('judges hidden trails from the trail geometry, not the roster: a device with history but no roster entry still draws [DON-338]', () => {
    seedSimplifiedLineMetadata()
    useTrackingStore.setState((state) => ({
      snapshot: {
        ...state.snapshot,
        // Roster has A only; the restored history holds trail fixes for B.
        devices: [
          { device_id: 'device-A', name: 'A', status: 'online', last_seen: null, unique_id: null, category: null },
        ],
        breadcrumbs: [trailFix('device-B', 0), trailFix('device-B', 1)],
      },
    }))
    useTrackingStyleStore.setState({ breadcrumbTrailMode: 'dots' })
    useLayerVisibilityStore.setState({ hiddenBreadcrumbDeviceIds: ['device-A', 'gone-device'] })
    const Panel = TrackingStatusPanel as React.ComponentType<{
      readonly exactBreadcrumbDotState: unknown
      readonly onExactBreadcrumbDotsEarlier: () => void
      readonly onExactBreadcrumbDotsLater: () => void
    }>
    render(React.createElement(Panel, {
      exactBreadcrumbDotState: { status: 'loading', missionId: 'mission-1' },
      onExactBreadcrumbDotsEarlier: () => undefined,
      onExactBreadcrumbDotsLater: () => undefined,
    }))
    expect(getText('[data-testid="exact-breadcrumb-dots-whole-trail-note"]')).toBe(
      'The line on the map shows the whole trail. Loading exact recorded fixes to mark as dots…',
    )
    expect(host!.querySelector('[data-testid="exact-breadcrumb-dots-hidden-trails"]')).toBeNull()
    expect(getText('[data-testid="breadcrumb-display-summary"]')).not.toContain('not drawn on the map')

    act(() => useLayerVisibilityStore.setState({ hiddenBreadcrumbDeviceIds: ['device-A', 'device-B'] }))
    expect(getText('[data-testid="exact-breadcrumb-dots-whole-trail-note"]')).toMatch(
      /^Every trail line is hidden on the Layers tab, so no trail line is drawn on the map\./u,
    )
    expect(getText('[data-testid="breadcrumb-display-summary"]')).toContain(
      'Every trail line is hidden on the Layers tab, so this line is not drawn on the map.',
    )
  })

  it('counts a hidden device whose only trail is on the exact page [DON-338]', () => {
    useTrackingStore.setState((state) => ({
      snapshot: { ...state.snapshot, breadcrumbs: [trailFix('device-B', 0), trailFix('device-B', 1)] },
    }))
    useTrackingStyleStore.setState({ breadcrumbTrailMode: 'dots' })
    useLayerVisibilityStore.setState({ hiddenBreadcrumbDeviceIds: ['device-C'] })
    const Panel = TrackingStatusPanel as React.ComponentType<{
      readonly exactBreadcrumbDotState: unknown
      readonly onExactBreadcrumbDotsEarlier: () => void
      readonly onExactBreadcrumbDotsLater: () => void
    }>
    render(React.createElement(Panel, {
      exactBreadcrumbDotState: {
        status: 'ready',
        missionId: 'mission-1',
        totalPositionCount: 3,
        pagePositionCount: 3,
        fromTimestamp: '2026-08-08T00:00:00.000Z',
        toTimestamp: '2026-08-08T00:02:00.000Z',
        hasEarlier: false,
        hasLater: false,
        positions: [trailFix('device-B', 0), trailFix('device-B', 1), trailFix('device-C', 2)],
      },
      onExactBreadcrumbDotsEarlier: () => undefined,
      onExactBreadcrumbDotsLater: () => undefined,
    }))
    expect(getText('[data-testid="exact-breadcrumb-dots-hidden-trails"]')).toMatch(/^1 device has its trail hidden/u)
    expect(getText('[data-testid="exact-breadcrumb-dots-whole-trail-note"]')).toContain(
      'Dots are drawn only for devices whose trail is shown.',
    )
  })

  it('does not say visible dots are hidden when every line device is hidden [DON-338]', () => {
    // Live trail holds only device A, which is hidden; the exact page holds visible device B.
    useTrackingStore.setState((state) => ({
      snapshot: { ...state.snapshot, breadcrumbs: [trailFix('device-A', 0), trailFix('device-A', 1)] },
    }))
    useTrackingStyleStore.setState({ breadcrumbTrailMode: 'dots' })
    useLayerVisibilityStore.setState({ hiddenBreadcrumbDeviceIds: ['device-A'] })
    const Panel = TrackingStatusPanel as React.ComponentType<{
      readonly exactBreadcrumbDotState: unknown
      readonly onExactBreadcrumbDotsEarlier: () => void
      readonly onExactBreadcrumbDotsLater: () => void
    }>
    render(React.createElement(Panel, {
      exactBreadcrumbDotState: {
        status: 'ready',
        missionId: 'mission-1',
        totalPositionCount: 2,
        pagePositionCount: 2,
        fromTimestamp: '2026-08-08T00:00:00.000Z',
        toTimestamp: '2026-08-08T00:01:00.000Z',
        hasEarlier: false,
        hasLater: false,
        positions: [trailFix('device-B', 0), trailFix('device-B', 1)],
      },
      onExactBreadcrumbDotsEarlier: () => undefined,
      onExactBreadcrumbDotsLater: () => undefined,
    }))
    const note = getText('[data-testid="exact-breadcrumb-dots-whole-trail-note"]')
    expect(note).toMatch(/^Every trail line is hidden on the Layers tab, so no trail line is drawn on the map\. The dots mark all 2 exact recorded fixes/u)
    expect(note).not.toMatch(/or dots are drawn|None are drawn/u)
    expect(getText('[data-testid="exact-breadcrumb-dots-hidden-trails"]')).toMatch(/^1 device has its trail hidden/u)
  })

  it('never claims a trail line when the snapshot has no trail fixes yet [DON-338]', () => {
    useTrackingStyleStore.setState({ breadcrumbTrailMode: 'dots' })
    const Panel = TrackingStatusPanel as React.ComponentType<{
      readonly exactBreadcrumbDotState: unknown
      readonly onExactBreadcrumbDotsEarlier: () => void
      readonly onExactBreadcrumbDotsLater: () => void
    }>
    for (const exactBreadcrumbDotState of [
      { status: 'loading', missionId: 'mission-1' },
      { status: 'unavailable', missionId: 'mission-1', message: 'Exact breadcrumb dots are unavailable.' },
      {
        status: 'ready', missionId: 'mission-1', totalPositionCount: 0, pagePositionCount: 0,
        fromTimestamp: null, toTimestamp: null, hasEarlier: false, hasLater: false, positions: [],
      },
    ]) {
      if (root === null) {
        render(React.createElement(Panel, {
          exactBreadcrumbDotState,
          onExactBreadcrumbDotsEarlier: () => undefined,
          onExactBreadcrumbDotsLater: () => undefined,
        }))
      } else {
        act(() => root?.render(React.createElement(Panel, {
          exactBreadcrumbDotState,
          onExactBreadcrumbDotsEarlier: () => undefined,
          onExactBreadcrumbDotsLater: () => undefined,
        })))
      }
      const note = getText('[data-testid="exact-breadcrumb-dots-whole-trail-note"]')
      expect(note).toMatch(/^No trail line is on the map yet\./u)
      expect(note).not.toContain('shows the whole trail')
    }
  })

  it('shows exact-dot paging in dots mode and keeps the simplified-line disclosure, because the line stays drawn [DON-338]', () => {
    const resolvedOptions = vi.spyOn(
      Intl.DateTimeFormat.prototype,
      'resolvedOptions',
    ).mockReturnValue({ timeZone: 'Europe/Dublin' } as Intl.ResolvedDateTimeFormatOptions)
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

    expect(getText('[data-testid="breadcrumb-display-summary"]')).toContain(
      'Trail display simplified: showing 5,000 of at least 12,000 known fixes',
    )
    expect(getText('[data-testid="exact-breadcrumb-dots-whole-trail-note"]')).toContain(
      'The line on the map shows the whole trail. The dots mark 10,000 of 10,001 exact recorded fixes',
    )
    expect(getText('[data-testid="exact-breadcrumb-dot-page-summary"]')).toBe(
      'Exact fix inspection — showing 10,000 of 10,001 — 08/08/2026, 01:00:00 GMT+01:00 (Europe/Dublin) to 09/08/2026, 13:00:00 GMT+01:00 (Europe/Dublin)',
    )
    resolvedOptions.mockRestore()
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

  it('never shows coverage status retained from the previous mission [DON-275]', () => {
    useMissionStore.setState({ currentMission: mission('mission-2'), phase: 'active' })
    useCoverageStore.setState({
      state: {
        status: 'complete',
        missionId: 'mission-1',
        rendererGeneration: 'renderer-1',
        changeSeq: 1,
        latestObservedChangeSeq: 1,
        manifest: null,
        tileCatalog: null,
        delivered: {},
        deliveredFixCount: 10,
        totalFixCount: 10,
      },
    })

    render(React.createElement(TrackingStatusPanel))

    expect(document.querySelector('[data-testid="coverage-status-panel"]')).toBeNull()
  })
})

function mission(id: string): Mission {
  return {
    id,
    name: 'Mission',
    status: 'active',
    start_time: '2026-08-24T08:00:00.000Z',
    pause_time: null,
    finish_time: null,
    paused_seconds: 0,
    notes: null,
    schema_version: 10,
  }
}

function seedSimplifiedLineMetadata(): void {
  useTrackingStore.setState((state) => ({
    snapshot: {
      ...state.snapshot,
      // A simplified line has retained fixes to draw.
      breadcrumbs: [trailFix('tracker-1', 0), trailFix('tracker-1', 1)],
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

/** One trail fix for a device, a minute apart and 10 m north each time. */
function trailFix(deviceId: string, minute: number) {
  return {
    id: `${deviceId}-${minute}`,
    device_id: deviceId,
    lat: 52 + minute * 0.0001,
    lon: -9,
    altitude: null,
    speed: null,
    battery: null,
    accuracy: null,
    timestamp: new Date(Date.parse('2026-08-08T00:00:00.000Z') + minute * 60_000).toISOString(),
    source: 'traccar' as const,
    data_origin: 'live' as const,
    cache_age_seconds: null,
    device_cache_stale: false,
  }
}
