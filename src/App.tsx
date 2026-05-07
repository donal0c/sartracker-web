import { Suspense, lazy, useState } from 'react'

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
      className="sar-shell flex h-screen w-screen overflow-hidden"
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
          className="sar-sidebar z-20 flex w-[380px] flex-col"
          data-testid="operational-sidebar"
        >
          {/* Tactical Header */}
          <header className="flex-shrink-0 border-b border-[var(--sar-line)] px-6 py-5">
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-amber-300/85">
              Kerry Mountain Rescue
            </p>
            <h1
              className="mt-1 font-mono text-2xl font-bold text-stone-50"
              data-testid="app-title"
            >
              SAR Tracker
            </h1>
            <div className="mt-3 flex items-center gap-2">
              <div className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              <span className="font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-emerald-300">
                System {status}
              </span>
              <button
                className="sar-button rounded-lg px-3 py-1.5 text-[12px] font-semibold"
                data-testid="open-diagnostics-workspace"
                onClick={() => openDiagnosticsWorkspace()}
                type="button"
              >
                Diagnostics
              </button>
              <FocusModeToggle className="sar-button-focus rounded-lg px-3 py-1.5 text-[12px] font-semibold" />
              <button
                className="sar-button ml-auto rounded-lg px-3 py-1.5 text-[12px] font-semibold"
                data-testid="open-settings-workspace"
                onClick={() => setSettingsOpen(true)}
                type="button"
              >
                Settings
              </button>
            </div>
          </header>

          {/* Pinned Mission Control — always visible, non-scrolling */}
          <div className="flex-shrink-0 border-b border-[var(--sar-line)] px-6 pb-4 pt-5">
            <MissionControlPanel />
          </div>

          {/* Segmented Tab Control */}
          <div className="flex-shrink-0 px-6 pt-3 pb-2" data-testid="sidebar-tabs">
            <div className="flex rounded-lg border border-[var(--sar-line)] bg-[var(--sar-panel-sunken)] p-1">
              {SIDEBAR_TABS.map((tab) => (
                <button
                  className={`flex-1 rounded-md px-3 py-1.5 text-[12px] font-semibold transition-colors ${
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
          <div className="flex-1 space-y-6 overflow-y-auto px-6 py-4">
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
                <div className="rounded-xl border border-stone-800/60 bg-stone-950/30 p-3 text-[13px] leading-relaxed text-stone-400">
                  <p className="text-[13px] font-semibold uppercase tracking-wide text-stone-300 mb-2">Operational Notes</p>
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
