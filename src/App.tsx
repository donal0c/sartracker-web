import { Suspense, lazy, useEffect, useMemo, useState } from 'react'

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
import { MarkerRuntimeBridge } from './features/markers/marker-runtime-bridge'
import { MeasurementRuntimeBridge } from './features/measurements/measurement-runtime-bridge'
import { useAppStore } from './lib/app-store'
import { MissionReviewRuntimeBridge } from './features/mission-review/mission-review-runtime-bridge'
import { TrackingStatusPanel } from './components/tracking-status-panel'
import { SettingsWorkspace } from './components/settings-workspace'
import { useDiagnosticsWorkspaceStore } from './features/diagnostics/diagnostics-workspace-store'
import { GpxRuntimeBridge } from './features/gpx/gpx-runtime-bridge'
import { HelicopterRuntimeBridge } from './features/helicopters/helicopter-runtime-bridge'
import { useFocusModeStore } from './features/focus-mode/focus-mode-store'
import { useMissionStore } from './features/mission/mission-store'
import { calculateMissionTimerState, formatMissionDuration } from './features/mission/mission-timers'
import { useTrackingStore } from './features/tracking/tracking-store'
import { APP_VERSION } from './lib/app-version'

const MapView = lazy(async () => {
  const module = await import('./components/map-view')

  return { default: module.MapView }
})

/** Sidebar tab identifiers for the segmented control below Mission Control. */
type SidebarTab = 'tracking' | 'tools' | 'layers'

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

  return (
    <main
      className="sar-shell flex h-screen w-screen flex-col overflow-hidden"
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
          status={status}
        />
      )}

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
            {/* Pinned Mission Control — always visible, non-scrolling */}
            <div className="min-h-0 max-h-[53vh] flex-shrink overflow-y-auto border-b border-[var(--sar-line)] px-5 pb-4 pt-5">
              <MissionControlPanel />
            </div>

            {/* Segmented Tab Control */}
            <div className="flex-shrink-0 px-5 pb-2 pt-3" data-testid="sidebar-tabs">
              <div className="grid grid-cols-3 border border-[var(--sar-line)] bg-[var(--sar-panel-sunken)] p-1">
                {SIDEBAR_TABS.map((tab) => (
                  <button
                    className={`px-3 py-2 text-[12px] font-bold uppercase tracking-[0.08em] transition-colors ${
                      sidebarTab === tab.id
                        ? 'sar-tab-active shadow-sm'
                        : 'text-stone-400 hover:text-stone-200'
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
                  <GpxImportPanel />
                  <MeasurementPanel />
                </>
              )}
              {sidebarTab === 'layers' && (
                <>
                  <LayerFilterPanel />
                  <div className="sar-rail-section p-3 text-[13px] leading-relaxed text-stone-400">
                    <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-stone-300">Operational Notes</p>
                    <ul className="list-disc pl-4 space-y-1">
                      <li>ITM (EPSG:2157) is the working CRS.</li>
                      <li>WGS84 for GPS and map rendering.</li>
                      <li>Service worker caching active for viewed tiles.</li>
                      <li>SQLite persistence active (WAL mode).</li>
                    </ul>
                  </div>
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

function CommandMast(props: {
  readonly status: string
  readonly onOpenDiagnostics: () => void
  readonly onOpenSettings: () => void
}) {
  const phase = useMissionStore((state) => state.phase)
  const currentMission = useMissionStore((state) => state.currentMission)
  const snapshot = useTrackingStore((state) => state.snapshot)
  const trackingStatus = useTrackingStore((state) => state.status)
  const [now, setNow] = useState(() => new Date())
  const staleCount = snapshot.positions.filter((position) => position.device_cache_stale).length
  const timerState = useMemo(
    () => (currentMission === null ? null : calculateMissionTimerState(currentMission, now)),
    [currentMission, now],
  )

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <header className="sar-global-mast flex-shrink-0" data-testid="command-mast">
      <div className="grid min-h-[88px] w-full grid-cols-[260px_minmax(220px,1fr)_124px_124px_72px_72px_120px_128px_128px_128px_96px] items-stretch overflow-hidden">
        <div className="flex min-w-0 items-center gap-3 border-r border-[var(--sar-line)] px-4">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center border border-amber-300/35 bg-amber-300/10 font-mono text-[11px] font-black text-amber-200">
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
            <p className="mt-1 min-w-0 truncate font-mono text-[10px] uppercase tracking-[0.12em] text-stone-400">
              {APP_VERSION}
            </p>
          </div>
        </div>

        <div className="min-w-0 border-r border-[var(--sar-line)] px-4 py-4">
          <div className="flex items-center gap-2">
            <span className="sar-section-label text-amber-300/90">Mission</span>
            <span className={phasePillClassName(phase)}>{phase}</span>
          </div>
          <p className="mt-2 truncate text-sm font-bold text-stone-100">
            {currentMission?.name ?? 'No active mission'}
          </p>
          <p className="mt-1 truncate font-mono text-[11px] uppercase tracking-[0.12em] text-stone-500">
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
        <TopReadout
          label={trackingStatus.mode}
          tone={trackingStatus.mode === 'online' ? 'success' : staleCount > 0 ? 'warning' : 'default'}
          value={`${snapshot.positions.length}/${staleCount}`}
        />

        <div className="flex min-w-0 flex-col justify-center border-l border-r border-[var(--sar-line)] px-4">
          <p className="sar-section-label">System Status</p>
          <p className="mt-1 font-mono text-sm font-black uppercase tracking-[0.14em] text-emerald-300">
            {props.status}
          </p>
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
      <p className="text-[10px] font-black uppercase tracking-[0.14em] text-stone-500">
        {props.label}
      </p>
      <p className={`mt-1 font-mono text-xl font-black leading-none ${toneClassName}`}>
        {props.value}
      </p>
    </div>
  )
}

function phasePillClassName(phase: string): string {
  if (phase === 'active') {
    return 'border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 font-mono text-[10px] font-black uppercase tracking-[0.12em] text-emerald-300'
  }

  if (phase === 'paused' || phase === 'recovery') {
    return 'border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 font-mono text-[10px] font-black uppercase tracking-[0.12em] text-amber-300'
  }

  return 'border border-stone-700 bg-stone-950 px-2 py-0.5 font-mono text-[10px] font-black uppercase tracking-[0.12em] text-stone-500'
}

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}
