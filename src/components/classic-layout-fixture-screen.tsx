import { useRef, type ReactNode } from 'react'

import { CompactMissionStrip } from './compact-mission-strip'
import { CoverageAttentionIndicator } from './coverage-attention-indicator'
import { FocusModeToggle } from './focus-mode-toggle'
import { OperationalSidebar } from './operational-sidebar'
import { PersistentTrackingHealth } from './persistent-tracking-health'
import { ThemeToggle } from './theme-toggle'
import { useSidebarTabs } from './use-sidebar-tabs'
import { WeatherMenu } from './weather-menu'
import { useDiagnosticsWorkspaceStore } from '../features/diagnostics/diagnostics-workspace-store'
import { useFocusModeStore } from '../features/focus-mode/focus-mode-store'
import { useMissionStore } from '../features/mission/mission-store'
import { formatMissionDuration } from '../features/mission/mission-timers'
import { useMissionTimer } from '../features/mission/use-mission-timer'
import { useWorkspaceVisibility } from '../features/mission/use-workspace-visibility'
import { selectWorkspaceHideBlockedReason } from '../features/mission/workspace-hide-blocked-reason'
import { scopeAutosaveWarningToMission } from '../features/persistence/autosave-warning-scope'
import { selectAutosaveWarning, useAutosaveStatusStore } from '../features/persistence/autosave-status-store'
import { useSettingsWorkspaceStore } from '../features/settings/settings-workspace-store'
import { selectCommandMastTrackingReadout } from '../features/tracking/command-mast-tracking-readout'
import { useTrackingStore } from '../features/tracking/tracking-store'
import { useAppStore } from '../lib/app-store'
import { APP_VERSION } from '../lib/app-version'

type RuntimeMode = 'electron' | 'hosted-browser'

/**
 * TEMPORARY, browser-test harness only (see classic-layout-fixture.ts): the old
 * command mast, awareness strip and sidebar, unchanged from before DON-341, so
 * the existing e2e specs keep running while they move to the new layout. Delete
 * with CommandMast before `don-341-integration` merges to master.
 */
export function ClassicLayoutFixture(props: {
  readonly actionError: string | null
  readonly browserTestingMode: boolean
  readonly decisionOpen: boolean
  readonly map: ReactNode
  readonly onActionErrorChange: (error: string | null) => void
  readonly onDecisionOpenChange: (open: boolean) => void
  /** The shared safety banner; the old screen moves the autosave warning into it only in Focus Mode. */
  readonly renderSafetyBanner: (focusModeActive: boolean) => ReactNode
}) {
  const status = useAppStore((state) => state.status)
  const focusModeActive = useFocusModeStore((state) => state.active)
  const openSettingsWorkspace = useSettingsWorkspaceStore((state) => state.openWorkspace)
  const openDiagnosticsWorkspace = useDiagnosticsWorkspaceStore((state) => state.openWorkspace)
  const restoreWorkspaceRef = useRef<HTMLButtonElement>(null)
  const collapseOriginRef = useRef<HTMLElement | null>(null)
  const missionPhase = useMissionStore((state) => state.phase)
  const currentMission = useMissionStore((state) => state.currentMission)
  const governanceMission = useMissionStore((state) => state.governanceMission)
  const railCollapseBlockedReason = selectWorkspaceHideBlockedReason({
    decisionOpen: props.decisionOpen,
    actionError: props.actionError,
    phase: missionPhase,
    governanceMission,
  })
  const workspace = useWorkspaceVisibility(
    `${currentMission?.id ?? 'none'}:${missionPhase}:${governanceMission?.id ?? 'none'}`,
    railCollapseBlockedReason,
  )
  const effectiveRailCollapsed = workspace.collapsed
  const sidebarTabs = useSidebarTabs(focusModeActive)
  const trackingPanelHidden = effectiveRailCollapsed || sidebarTabs.activeTab !== 'tracking'
  const missionControlMinimized =
    missionPhase === 'active' &&
    props.actionError === null &&
    currentMission !== null &&
    workspace.minimized
  const runtimeMode: RuntimeMode = props.browserTestingMode ? 'hosted-browser' : 'electron'

  return (
    <>
      {focusModeActive ? null : (
        <CommandMast
          missionControlMinimized={missionControlMinimized}
          onOpenDiagnostics={openDiagnosticsWorkspace}
          onOpenSettings={() => openSettingsWorkspace()}
          runtimeMode={runtimeMode}
          status={status}
        />
      )}
      <div className="sar-awareness-strip">
        {(missionControlMinimized || effectiveRailCollapsed) && <CompactMissionStrip onRestore={workspace.restore} />}
        <PersistentTrackingHealth />
        {trackingPanelHidden && <CoverageAttentionIndicator onOpenTracking={() => {
          workspace.restoreRail()
          sidebarTabs.setActiveTab('tracking')
        }} />}
        <ThemeToggle />
        {effectiveRailCollapsed && <button ref={restoreWorkspaceRef} className="sar-button px-3 py-2 text-xs font-bold" data-testid="restore-workspace" onClick={() => {
          workspace.restoreRail()
          requestAnimationFrame(() => collapseOriginRef.current?.focus())
        }} type="button">Restore workspace</button>}
        {focusModeActive && effectiveRailCollapsed && <FocusModeToggle className="sar-button px-3 py-2 text-xs" />}
      </div>
      {props.renderSafetyBanner(focusModeActive)}

      <div className="flex min-h-0 flex-1">
        <section className="relative flex-1 overflow-hidden">{props.map}</section>
        <OperationalSidebar
          focusModeActive={focusModeActive}
          tabs={sidebarTabs}
          collapsed={effectiveRailCollapsed}
          minimized={missionControlMinimized}
          collapseDisabledReason={railCollapseBlockedReason}
          onActionErrorChange={props.onActionErrorChange}
          onDecisionOpenChange={props.onDecisionOpenChange}
          onMinimizedChange={workspace.minimize}
          onCollapseWorkspace={() => {
            collapseOriginRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
            workspace.collapse()
            requestAnimationFrame(() => restoreWorkspaceRef.current?.focus())
          }}
        />
      </div>
    </>
  )
}

/** Renders the top operational mast with mission, tracking, diagnostics, and runtime health. */
export function CommandMast(props: {
  readonly status: string
  readonly runtimeMode: RuntimeMode
  readonly missionControlMinimized?: boolean
  readonly onOpenDiagnostics: () => void
  readonly onOpenSettings: () => void
}) {
  const phase = useMissionStore((state) => state.phase)
  const currentMission = useMissionStore((state) => state.currentMission)
  const snapshot = useTrackingStore((state) => state.snapshot)
  const trackingStatus = useTrackingStore((state) => state.status)
  const autosaveStatus = useAutosaveStatusStore()
  const staleCount = snapshot.positions.filter((position) => position.device_cache_stale).length
  const autosaveWarning = scopeAutosaveWarningToMission(
    selectAutosaveWarning(autosaveStatus),
    currentMission,
  )
  const systemStatus = resolveCommandMastSystemStatus({
    runtimeMode: props.runtimeMode,
    status: props.status,
    autosaveWarning,
  })
  const timerState = useMissionTimer(currentMission)

  return (
    <header className="sar-global-mast flex-shrink-0" data-testid="command-mast">
      <div className="sar-command-mast-grid grid min-h-[80px] w-full items-stretch overflow-hidden">
        <div className="flex min-w-0 items-center gap-3 border-r border-[var(--sar-line)] px-4">
          <div className="relative flex h-14 w-16 flex-shrink-0 items-center justify-center overflow-hidden border border-stone-200/40 bg-white">
            <img
              alt="Mountain Rescue team logo"
              className="h-full w-full object-contain"
              onError={(event) => {
                event.currentTarget.hidden = true
                event.currentTarget.nextElementSibling?.removeAttribute('hidden')
              }}
              src="./brand/kmrt-logo-compact.png"
            />
            <span className="font-mono text-[11px] font-black text-amber-200" hidden>
              MR
            </span>
          </div>
          <div className="sr-only">
            MR
          </div>
          <div className="min-w-0">
            <p className="truncate text-[10px] font-black uppercase tracking-[0.16em] text-amber-300">
              Mountain Rescue
            </p>
            <h1
              className="mt-1 truncate font-mono text-[22px] font-black leading-none tracking-wide text-stone-50"
              data-testid="app-title"
            >
              SAR Tracker
            </h1>
            <p className="mt-1 min-w-0 truncate font-mono text-[10px] uppercase tracking-[0.12em] text-stone-300">
              {APP_VERSION}
            </p>
          </div>
        </div>

        <div
          className="min-w-0 border-r border-[var(--sar-line)] px-4 py-2"
          data-testid={
            props.missionControlMinimized && currentMission !== null
              ? 'command-mast-mission-control-minimized'
              : undefined
          }
        >
          <div className="flex items-center gap-2">
            <span className="sar-section-label text-amber-300">Mission</span>
            <span className={phasePillClassName(phase)}>{phase}</span>
          </div>
          <p
            className="mt-2 truncate text-sm font-bold text-stone-100"
            data-testid="current-mission-name"
          >
            {currentMission?.name ?? 'No active mission'}
          </p>
          <p className="mt-1 truncate font-mono text-[11px] uppercase tracking-[0.12em] text-stone-300">
            {currentMission === null ? 'Ready to start' : `Started ${formatTime(currentMission.start_time)}`}
          </p>
        </div>

        <TopReadout label="Elapsed" value={formatMissionDuration(timerState?.elapsedSeconds ?? 0)} />
        <TopReadout
          label="Active"
          tone="success"
          value={formatMissionDuration(timerState?.activeSeconds ?? 0)}
        />
        <TopReadout label="Devices" value={String(snapshot.devices.length)} />
        <TrackingMastCell
          readout={selectCommandMastTrackingReadout({
            mode: trackingStatus.mode,
            fixCount: snapshot.positions.length,
            staleCount,
          })}
        />

        <div className="flex min-w-0 flex-col justify-center border-l border-r border-[var(--sar-line)] px-3">
          <p className="sar-section-label">System Status</p>
          <p
            className={`mt-1 font-mono text-sm font-black uppercase tracking-[0.08em] ${
              systemStatus.tone === 'success' ? 'text-emerald-300' : 'text-amber-300'
            }`}
            data-testid="system-status-value"
          >
            {systemStatus.value}
          </p>
          <p
            className="mt-1 truncate text-[10px] font-black uppercase tracking-[0.08em] text-stone-300"
            data-testid="system-status-detail"
            title={systemStatus.detail}
          >
            {systemStatus.detail}
          </p>
          {autosaveWarning === null ? null : (
            <p
              aria-label={autosaveWarning}
              className="sar-status-chip-warning mt-1 inline-flex w-fit max-w-full truncate px-1.5 py-0.5 text-[10px] font-black uppercase tracking-[0.04em]"
              data-testid="autosave-warning"
              role="status"
              title={autosaveWarning}
            >
              Autosave warning
            </p>
          )}
        </div>
        <button
          aria-label="Open diagnostics workspace"
          className="sar-mast-button"
          data-testid="open-diagnostics-workspace"
          onClick={() => props.onOpenDiagnostics()}
          type="button"
        >
          <span className="sar-mast-label-full">Diagnostics</span>
          <span aria-hidden="true" className="sar-mast-label-short">
            Diag
          </span>
        </button>
        <FocusModeToggle className="sar-mast-button" compact />
        <button
          aria-label="Open settings workspace"
          className="sar-mast-button"
          data-testid="open-settings-workspace"
          onClick={() => props.onOpenSettings()}
          type="button"
        >
          <span className="sar-mast-label-full">Settings</span>
          <span aria-hidden="true" className="sar-mast-label-short">
            Set
          </span>
        </button>
        <WeatherMenu />
        <a
          aria-label="Open help manual"
          className="sar-mast-button inline-flex items-center justify-center"
          data-testid="open-help-manual"
          href="./manual/index.html"
          rel="noreferrer"
          target="_blank"
        >
          <span className="sar-mast-label-full">Help</span>
          <span aria-hidden="true" className="sar-mast-label-short">
            Help
          </span>
        </a>
      </div>
    </header>
  )
}

function TopReadout(props: {
  readonly label: string
  readonly value: string
  readonly tone?: 'default' | 'success' | 'warning'
}) {
  const toneClassName =
    props.tone === 'success'
      ? 'text-emerald-300'
      : props.tone === 'warning'
        ? 'text-amber-300'
        : 'text-stone-100'

  return (
    <div className="sar-mast-readout flex min-w-0 flex-col justify-center border-r border-[var(--sar-line)] px-4">
      <p className="text-[10px] font-black uppercase tracking-[0.14em] text-stone-300">
        {props.label}
      </p>
      <p className={`mt-1 font-mono text-xl font-black leading-none ${toneClassName}`}>
        {props.value}
      </p>
    </div>
  )
}

function TrackingMastCell(props: {
  readonly readout: ReturnType<typeof selectCommandMastTrackingReadout>
}) {
  const labelToneClassName =
    props.readout.tone === 'success'
      ? 'text-emerald-300'
      : props.readout.tone === 'warning'
        ? 'text-amber-300'
        : 'text-stone-300'
  const staleToneClassName =
    props.readout.stale.tone === 'warning' ? 'text-amber-300' : 'text-stone-400'

  return (
    <div
      className="flex min-w-0 flex-col justify-center border-r border-[var(--sar-line)] px-3"
      data-testid="mast-tracking-cell"
    >
      <p
        className={`text-[10px] font-black uppercase tracking-[0.14em] ${labelToneClassName}`}
        data-testid="mast-tracking-mode"
      >
        {props.readout.label}
      </p>
      <div className="mt-1 flex items-baseline justify-between gap-1">
        <span className="text-[9px] font-bold uppercase tracking-[0.08em] text-stone-300">
          {props.readout.fix.label}
        </span>
        <span
          className="font-mono text-sm font-black leading-none text-stone-100"
          data-testid="mast-tracking-fix-value"
        >
          {props.readout.fix.value}
        </span>
      </div>
      <div className="mt-1 flex items-baseline justify-between gap-1">
        <span className={`text-[9px] font-bold uppercase tracking-[0.08em] ${staleToneClassName}`}>
          {props.readout.stale.label}
        </span>
        <span
          className={`font-mono text-sm font-black leading-none ${staleToneClassName}`}
          data-testid="mast-tracking-stale-value"
        >
          {props.readout.stale.value}
        </span>
      </div>
    </div>
  )
}

function resolveCommandMastSystemStatus(input: {
  readonly runtimeMode: RuntimeMode
  readonly status: string
  readonly autosaveWarning: string | null
}): {
  readonly value: string
  readonly detail: string
  readonly tone: 'success' | 'warning'
} {
  if (input.runtimeMode === 'hosted-browser') {
    return {
      value: 'Browser test',
      detail: 'Session storage only',
      tone: 'warning',
    }
  }

  if (input.autosaveWarning !== null) {
    return {
      value: input.status,
      detail: 'Autosave warning',
      tone: 'warning',
    }
  }

  return {
    value: input.status,
    detail: 'Desktop persistence',
    tone: 'success',
  }
}

function phasePillClassName(phase: string): string {
  const base =
    'px-2 py-0.5 font-mono text-[10px] font-black uppercase tracking-[0.12em]'

  if (phase === 'active') {
    return `${base} sar-status-chip-success`
  }

  // Paused must read as an alarm, not a soft warning (DON-64): the mast pill
  // flashes bright red so an operator scanning the top bar cannot miss it.
  if (phase === 'paused') {
    return `${base} sar-status-chip-paused`
  }

  if (phase === 'recovery') {
    return `${base} sar-status-chip-warning`
  }

  return `${base} sar-status-chip-neutral`
}

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}
