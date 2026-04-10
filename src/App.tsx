import { Suspense, lazy } from 'react'

import { DrawingRuntimeBridge } from './features/drawings/drawing-runtime-bridge'
import { DrawingDialog } from './components/drawing-dialog'
import { LayerFilterPanel } from './components/layer-filter-panel'
import { MissionControlPanel } from './components/mission-control-panel'
import { MarkerDialog } from './components/marker-dialog'
import { MarkerRuntimeBridge } from './features/markers/marker-runtime-bridge'
import { useAppStore } from './lib/app-store'
import { TrackingStatusPanel } from './components/tracking-status-panel'

const MapView = lazy(async () => {
  const module = await import('./components/map-view')

  return { default: module.MapView }
})

/**
 * Renders the current scaffold shell around the operations map.
 */
function App() {
  const status = useAppStore((state) => state.status)

  return (
    <main className="flex h-screen w-screen overflow-hidden bg-stone-950 text-stone-100">
      <DrawingRuntimeBridge />
      <MarkerRuntimeBridge />
      
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
      <aside className="z-20 flex w-[380px] flex-col border-l border-stone-800 bg-stone-900 shadow-2xl">
        {/* Tactical Header */}
        <header className="flex-shrink-0 border-b border-amber-500/20 px-6 py-6">
          <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-amber-300/80">
            Kerry Mountain Rescue
          </p>
          <h1
            className="mt-1 font-mono text-2xl font-bold tracking-tight text-stone-50"
            data-testid="app-title"
          >
            SAR Tracker
          </h1>
          <div className="mt-3 flex items-center gap-2">
            <div className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.5)]" />
            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400/80">
              System {status}
            </span>
          </div>
        </header>

        {/* Status & Controls Scrolled Area */}
        <div className="flex-1 space-y-6 px-6 py-8 overflow-y-auto">
          <MissionControlPanel />
          <TrackingStatusPanel />
          <LayerFilterPanel />
          
          <div className="rounded-xl border border-stone-800 bg-stone-950/40 p-4 text-[11px] leading-relaxed text-stone-500">
            <p className="font-semibold text-stone-400 uppercase tracking-wider mb-2">Operational Notes</p>
            <ul className="list-disc pl-4 space-y-1">
              <li>ITM (EPSG:2157) is the working CRS.</li>
              <li>WGS84 for GPS and map rendering.</li>
              <li>Service worker caching active for viewed tiles.</li>
              <li>SQLite persistence active (WAL mode).</li>
            </ul>
          </div>
        </div>
      </aside>

      <DrawingDialog />
      <MarkerDialog />
    </main>
  )
}

export default App
