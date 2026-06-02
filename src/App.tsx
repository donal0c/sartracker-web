import { Suspense, lazy, useEffect, useRef, useState } from 'react'

import { DrawingRuntimeBridge } from './features/drawings/drawing-runtime-bridge'
import { DiagnosticsRuntimeBridge } from './features/diagnostics/diagnostics-runtime-bridge'
import { DiagnosticsWorkspace } from './components/diagnostics-workspace'
import { DrawingDialog } from './components/drawing-dialog'
import { CoordinateConverterDialog } from './components/coordinate-converter-dialog'
import { DevicesWorkspace } from './components/devices-workspace'
import { FocusModeSidebar } from './components/focus-mode-sidebar'
import { FocusModeToggle } from './components/focus-mode-toggle'
import { GpxImportPanel } from './components/gpx-import-panel'
import { HelicopterPanel } from './components/helicopter-panel'
import { LayerFilterPanel } from './components/layer-filter-panel'
import { MissionReviewWorkspace } from './components/mission-review-workspace'
import { LayerCatalogRuntimeBridge } from './features/layers/layer-catalog-runtime-bridge'
import { MeasurementPanel } from './components/measurement-panel'
import { MissionControlPanel } from './components/mission-control-panel'
import { MarkerDialog } from './components/marker-dialog'
import { MarkerAtGridPanel } from './components/marker-at-grid-panel'
import { MarkerRuntimeBridge } from './features/markers/marker-runtime-bridge'
import { MeasurementRuntimeBridge } from './features/measurements/measurement-runtime-bridge'
import { useAppStore } from './lib/app-store'
import { MissionReviewRuntimeBridge } from './features/mission-review/mission-review-runtime-bridge'
import { TrackingStatusPanel } from './components/tracking-status-panel'
import { SettingsWorkspace } from './components/settings-workspace'
import { loadAppSettings } from './infrastructure/settings-store/tauri-settings-store'
import { openExternalUrl } from './infrastructure/url-opener/open-external-url'
import type { WeatherLinkSettings } from './features/settings/settings-types'
import { useDiagnosticsWorkspaceStore } from './features/diagnostics/diagnostics-workspace-store'
import { GpxRuntimeBridge } from './features/gpx/gpx-runtime-bridge'
import { HelicopterRuntimeBridge } from './features/helicopters/helicopter-runtime-bridge'
import { useFocusModeStore } from './features/focus-mode/focus-mode-store'
import { useMissionStore } from './features/mission/mission-store'
import { shouldEnableMissionBrowserHarness } from './features/mission/mission-browser-harness'
import { formatMissionDuration } from './features/mission/mission-timers'
import { useMissionTimer } from './features/mission/use-mission-timer'
import {
  selectLifecycleBackupFailureAlert,
  selectAutosaveWarning,
  useAutosaveStatusStore,
} from './features/persistence/autosave-status-store'
import {
  type RuntimeBootPhase,
  useRuntimeBootStore,
} from './features/runtime/runtime-boot-store'
import { reloadRuntimeFaultShell } from './features/runtime/runtime-fault-reload'
import { useTrackingStore } from './features/tracking/tracking-store'
import { selectCommandMastTrackingReadout } from './features/tracking/command-mast-tracking-readout'
import { APP_VERSION } from './lib/app-version'

const MapView = lazy(async () => {
  const module = await import('./components/map-view')

  return { default: module.MapView }
})

/** Sidebar tab identifiers for the segmented control below Mission Control. */
type SidebarTab = 'tracking' | 'tools' | 'layers'
type RuntimeMode = 'tauri' | 'hosted-browser'

const SIDEBAR_TABS: readonly { readonly id: SidebarTab; readonly label: string }[] = [
  { id: 'tracking', label: 'Tracking' },
  { id: 'tools', label: 'Tools' },
  { id: 'layers', label: 'Layers' },
]

function App() {
  const status = useAppStore((state) => state.status)
  const focusModeActive = useFocusModeStore((state) => state.active)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('tracking')
  const openDiagnosticsWorkspace = useDiagnosticsWorkspaceStore((state) => state.openWorkspace)
  const browserTestingMode = shouldEnableMissionBrowserHarness()
  const runtimeMode: RuntimeMode = browserTestingMode ? 'hosted-browser' : 'tauri'
  const runtimeBootPhase = useRuntimeBootStore((state) => state.phase)
  const runtimeBootError = useRuntimeBootStore((state) => state.error)
  const missionPhase = useMissionStore((state) => state.phase)

  useEffect(() => {
    const timer = window.setInterval(() => {
      useAutosaveStatusStore.getState().markObservedElapsed({ elapsedMs: 1000 })
    }, 1000)
    return () => window.clearInterval(timer)
  }, [])

  if (runtimeBootPhase !== 'ready') {
    return (
      <RuntimeBootGate
        error={runtimeBootError}
        onReload={() => reloadRuntimeFaultShell()}
        phase={runtimeBootPhase}
      />
    )
  }

  return (
    <main
      className="sar-shell flex h-screen w-full flex-col overflow-hidden"
      data-focus-mode={focusModeActive ? 'true' : 'false'}
      data-testid="app-shell"
    >
      <DiagnosticsRuntimeBridge />
      <DrawingRuntimeBridge />
      <GpxRuntimeBridge />
      <HelicopterRuntimeBridge />
      <LayerCatalogRuntimeBridge />
      <MarkerRuntimeBridge />
      <MeasurementRuntimeBridge />
      <MissionReviewRuntimeBridge />

      {focusModeActive ? null : (
        <CommandMast
          onOpenDiagnostics={openDiagnosticsWorkspace}
          onOpenSettings={() => setSettingsOpen(true)}
          runtimeMode={runtimeMode}
          status={status}
        />
      )}
      <RuntimeSafetyBanner
        browserTestingMode={browserTestingMode}
        focusModeActive={focusModeActive}
      />

      <div className="flex min-h-0 flex-1">
        {/* Map Area - Expanded */}
        <section className="relative flex-1 overflow-hidden">
          <Suspense
            fallback={
              <div className="flex h-full w-full items-center justify-center bg-stone-950 text-sm text-stone-400">
                Loading map shell...
              </div>
            }
          >
            <MapView />
          </Suspense>
        </section>

        {/* Operational Sidebar - Fixed Right */}
        {focusModeActive ? (
          <FocusModeSidebar />
        ) : (
          <aside
            className="sar-sidebar z-20 flex w-[400px] flex-col"
            data-testid="operational-sidebar"
          >
            {/*
              Pinned Mission Control — always visible. The height is normally
              capped so the tab content below stays reachable, but while paused
              we lift the cap (DON-64) so the paused alarm and Resume control can
              never be clipped or scrolled out of view.
            */}
            <div
              className={`min-h-0 flex-shrink overflow-y-auto border-b border-[var(--sar-line)] px-5 pb-4 pt-5 ${
                missionPhase === 'paused' ? '' : 'max-h-[53vh]'
              }`}
              data-testid="mission-control-dock"
            >
              <MissionControlPanel />
            </div>

            {/* Segmented Tab Control */}
            <div className="flex-shrink-0 px-5 pb-2 pt-3" data-testid="sidebar-tabs">
              <div className="grid grid-cols-3 border border-[var(--sar-line)] bg-[var(--sar-panel-sunken)] p-1">
                {SIDEBAR_TABS.map((tab) => (
                  <button
                    className={`px-3 py-2 text-[12px] font-bold uppercase tracking-[0.08em] transition-colors ${
                      sidebarTab === tab.id ? 'sar-tab-active shadow-sm' : 'sar-tab-inactive'
                    }`}
                    data-testid={`sidebar-tab-${tab.id}`}
                    key={tab.id}
                    onClick={() => setSidebarTab(tab.id)}
                    type="button"
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Tab Content — scrollable */}
            <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
              {sidebarTab === 'tracking' && (
                <>
                  <TrackingStatusPanel />
                  <HelicopterPanel />
                </>
              )}
              {sidebarTab === 'tools' && (
                <>
                  <MarkerAtGridPanel />
                  <GpxImportPanel />
                  <MeasurementPanel />
                </>
              )}
              {sidebarTab === 'layers' && (
                <>
                  <LayerFilterPanel />
                </>
              )}
            </div>
          </aside>
        )}
      </div>

      <DrawingDialog />
      <CoordinateConverterDialog />
      <DevicesWorkspace />
      <MissionReviewWorkspace />
      <MarkerDialog />
      <DiagnosticsWorkspace />
      <SettingsWorkspace onClose={() => setSettingsOpen(false)} open={settingsOpen} />
    </main>
  )
}

export default App

/**
 * Blocks operator interaction until runtime startup either succeeds or fails visibly.
 */
export function RuntimeBootGate(props: {
  readonly phase: RuntimeBootPhase
  readonly error: string | null
  readonly onReload: () => void
}) {
  const reloadButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (props.phase === 'failed') {
      reloadButtonRef.current?.focus()
    }
  }, [props.phase])

  if (props.phase === 'booting') {
    return (
      <main
        className="sar-shell flex h-screen w-screen items-center justify-center"
        data-testid="runtime-booting-shell"
      >
        <div className="border border-[var(--sar-line)] bg-[var(--sar-panel)] px-6 py-5 text-center shadow-2xl">
          <p className="text-[11px] font-black uppercase tracking-[0.16em] text-amber-300">
            SAR Tracker
          </p>
          <h1 className="mt-2 font-mono text-[22px] font-black text-stone-50">
            Preparing operational runtime
          </h1>
          <p aria-live="polite" className="mt-2 text-sm text-stone-400" role="status">
            Loading mission, tracking, and map services...
          </p>
        </div>
      </main>
    )
  }

  return (
    <main
      className="sar-shell flex h-screen w-screen items-center justify-center p-6"
      data-testid="runtime-failed-shell"
    >
      <section
        aria-describedby="runtime-fault-guidance runtime-fault-detail"
        aria-labelledby="runtime-fault-title"
        aria-live="assertive"
        className="max-w-xl border border-rose-300/40 bg-rose-950/30 p-6 shadow-2xl"
        role="alert"
      >
        <p className="text-[11px] font-black uppercase tracking-[0.16em] text-rose-200">
          Startup fault
        </p>
        <h1
          className="mt-2 font-mono text-[24px] font-black text-stone-50"
          id="runtime-fault-title"
        >
          Runtime startup failed
        </h1>
        <p
          className="mt-3 text-sm leading-relaxed text-stone-200"
          id="runtime-fault-guidance"
        >
          SAR Tracker could not start the runtime services needed for mission
          operations. Before reloading, copy or screenshot this fault message if
          you are in an incident. Reload starts from a clean operational URL and
          removes browser testing flags.
        </p>
        <pre
          className="mt-4 whitespace-pre-wrap border border-rose-200/20 bg-stone-950/70 p-3 text-left text-xs text-rose-100"
          id="runtime-fault-detail"
        >
          {props.error ?? 'Unknown startup failure.'}
        </pre>
        <button
          autoFocus
          className="sar-action-primary mt-5 px-4 py-2 text-[12px] font-black uppercase tracking-[0.08em]"
          onClick={props.onReload}
          ref={reloadButtonRef}
          type="button"
        >
          Reload clean runtime
        </button>
      </section>
    </main>
  )
}

export function RuntimeSafetyBanner(props: {
  readonly browserTestingMode: boolean
  readonly focusModeActive: boolean
}) {
  const currentMission = useMissionStore((state) => state.currentMission)
  const autosaveStatus = useAutosaveStatusStore()
  const lifecycleBackupFailure = selectLifecycleBackupFailureAlert(autosaveStatus)
  const autosaveWarning = selectCommandMastAutosaveWarning(
    selectAutosaveWarning(autosaveStatus),
    currentMission,
  )
  const focusAutosaveWarning = props.focusModeActive ? autosaveWarning : null

  if (
    !props.browserTestingMode &&
    focusAutosaveWarning === null &&
    lifecycleBackupFailure === null
  ) {
    return null
  }

  return (
    <div
      className="border-b border-amber-400/55 bg-amber-400/15 px-5 py-2 text-[12px] font-semibold text-amber-100 shadow-[inset_0_-1px_rgba(0,0,0,0.4)]"
      data-testid="hosted-browser-testing-banner"
    >
      {props.browserTestingMode ? (
        <p>
          Browser testing mode: mission data is stored in this browser session. Use for team testing only, not live incidents.
        </p>
      ) : null}
      {focusAutosaveWarning === null ? null : (
        <p className="mt-1" data-testid="focus-autosave-warning">
          {focusAutosaveWarning}
        </p>
      )}
      {lifecycleBackupFailure === null ? null : (
        <div
          className="sar-inline-critical mt-2 p-3"
          data-testid="lifecycle-backup-failure-banner"
          role="alert"
        >
          <p className="font-black uppercase tracking-[0.1em]">
            Lifecycle backup failed
          </p>
          <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.08em] text-rose-100">
            {lifecycleBackupFailure.reasonLabel}
          </p>
          <p className="mt-1 text-[12px] leading-relaxed">
            SAR Tracker saved the mission state change, but the safety backup did not complete:
            {' '}
            {lifecycleBackupFailure.message}
          </p>
          <p className="mt-1 text-[12px] leading-relaxed text-rose-100">
            Keep the app open, capture diagnostics, and do not treat the backup copy as current
            until this alert clears after a matching successful lifecycle backup.
          </p>
        </div>
      )}
    </div>
  )
}

/** Renders the top operational mast with mission, tracking, diagnostics, and runtime health. */
export function CommandMast(props: {
  readonly status: string
  readonly runtimeMode: RuntimeMode
  readonly onOpenDiagnostics: () => void
  readonly onOpenSettings: () => void
}) {
  const phase = useMissionStore((state) => state.phase)
  const currentMission = useMissionStore((state) => state.currentMission)
  const snapshot = useTrackingStore((state) => state.snapshot)
  const trackingStatus = useTrackingStore((state) => state.status)
  const autosaveStatus = useAutosaveStatusStore()
  const staleCount = snapshot.positions.filter((position) => position.device_cache_stale).length
  const autosaveWarning = selectCommandMastAutosaveWarning(
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
      <div className="grid min-h-[112px] w-full grid-cols-[330px_176px_112px_112px_64px_64px_160px_92px_92px_92px_92px_92px] items-stretch overflow-hidden">
        <div className="flex min-w-0 items-center gap-4 border-r border-[var(--sar-line)] px-4">
          <div className="relative flex h-24 w-28 flex-shrink-0 items-center justify-center overflow-hidden border border-stone-200/40 bg-white">
            <img
              alt="Mountain Rescue team logo"
              className="h-full w-full object-contain"
              onError={(event) => {
                event.currentTarget.hidden = true
                event.currentTarget.nextElementSibling?.removeAttribute('hidden')
              }}
              src="/brand/kmrt-logo.png"
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

        <div className="min-w-0 border-r border-[var(--sar-line)] px-4 py-4">
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

        <div className="flex min-w-0 flex-col justify-center border-l border-r border-[var(--sar-line)] px-4">
          <p className="sar-section-label">System Status</p>
          <p
            className={`mt-1 font-mono text-sm font-black uppercase tracking-[0.14em] ${
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
          className="sar-mast-button"
          data-testid="open-diagnostics-workspace"
          onClick={() => props.onOpenDiagnostics()}
          type="button"
        >
          Diagnostics
        </button>
        <FocusModeToggle className="sar-mast-button" compact />
        <button
          className="sar-mast-button"
          data-testid="open-settings-workspace"
          onClick={() => props.onOpenSettings()}
          type="button"
        >
          Settings
        </button>
        <WeatherMenu />
        <a
          className="sar-mast-button inline-flex items-center justify-center"
          data-testid="open-help-manual"
          href="./manual/index.html"
          rel="noreferrer"
          target="_blank"
        >
          Help
        </a>
      </div>
    </header>
  )
}

/** Compact mast menu for operator-configured external weather resources. */
function WeatherMenu() {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [links, setLinks] = useState<readonly WeatherLinkSettings[]>([])
  const [error, setError] = useState<string | null>(null)

  return (
    <div className="relative flex min-w-0 border-r border-[var(--sar-line)]">
      <button
        aria-expanded={open}
        className="sar-mast-button w-full"
        data-testid="weather-menu-trigger"
        onClick={() => {
          if (open) {
            setOpen(false)
            return
          }
          setOpen(true)
          void loadWeatherLinks()
        }}
        type="button"
      >
        Weather
      </button>
      {open ? (
        <div
          className="absolute right-0 top-full z-50 mt-1 w-72 border border-[var(--sar-line)] bg-[var(--sar-panel)] p-3 text-sm shadow-2xl"
          data-testid="weather-menu"
        >
          <p className="sar-section-label text-amber-300">External Weather Links</p>
          <p className="sar-helper-text mt-1">
            Opens configured websites in a new tab. No weather data is fetched by SAR Tracker.
          </p>
          {loading ? (
            <p className="mt-3 text-sm text-stone-300">Loading weather links...</p>
          ) : error !== null ? (
            <p className="mt-3 text-sm font-semibold text-rose-300">{error}</p>
          ) : links.length === 0 ? (
            <p className="mt-3 text-sm text-stone-300">
              No weather links configured. Add named weather URLs in Settings.
            </p>
          ) : (
            <div className="mt-3 space-y-2">
              {links.map((link, index) => (
                <button
                  className="sar-button flex w-full items-center justify-between px-3 py-2 text-left text-[12px] font-bold text-stone-100"
                  data-testid={`weather-link-open-${index}`}
                  key={`${link.name}-${link.url}`}
                  onClick={() => void openExternalUrl(link.url)}
                  type="button"
                >
                  <span className="truncate">{link.name}</span>
                  <span aria-hidden="true" className="ml-3 text-amber-300">Open</span>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  )

  async function loadWeatherLinks(): Promise<void> {
    setLoading(true)
    setError(null)
    try {
      const settings = await loadAppSettings()
      setLinks(settings.weather.links)
    } catch (loadError) {
      setError(toErrorMessage(loadError))
      setLinks([])
    } finally {
      setLoading(false)
    }
  }
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
    <div className="flex min-w-0 flex-col justify-center border-r border-[var(--sar-line)] px-4">
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

/** Keeps stale autosave warnings mission-scoped while preserving failure visibility. */
function selectCommandMastAutosaveWarning(
  warning: string | null,
  currentMission: unknown,
): string | null {
  if (warning === null) {
    return null
  }

  if (warning.startsWith('Autosave failing')) {
    return warning
  }

  return currentMission === null ? null : warning
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

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
