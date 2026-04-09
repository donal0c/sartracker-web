import { Suspense, lazy } from 'react'

import { MissionControlPanel } from './components/mission-control-panel'
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
    <main className="min-h-screen bg-stone-950 text-stone-100">
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-6 py-10 lg:px-10">
        <header className="flex items-center justify-between border-b border-amber-500/20 pb-5">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-amber-300">
              Kerry Mountain Rescue Team
            </p>
            <h1
              className="mt-2 font-mono text-3xl font-semibold tracking-tight text-stone-50"
              data-testid="app-title"
            >
              SAR Tracker Web
            </h1>
          </div>
          <div className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-sm text-emerald-200">
            Runtime {status}
          </div>
        </header>

        <section className="grid flex-1 gap-6 py-8 lg:grid-cols-[2fr_1fr]">
          <div className="rounded-3xl border border-stone-800 bg-stone-900/80 p-6 shadow-2xl shadow-black/30">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-stone-50">Operations Map</h2>
              <span className="text-sm text-stone-400">Kerry centred · zoom 12</span>
            </div>
            <div className="mt-5">
              <Suspense
                fallback={
                  <div className="flex min-h-[560px] items-center justify-center rounded-2xl border border-stone-700 bg-stone-950 text-sm text-stone-400">
                    Loading map shell...
                  </div>
                }
              >
                <MapView />
              </Suspense>
            </div>
          </div>

          <aside className="rounded-3xl border border-stone-800 bg-stone-900/80 p-6">
            <h2 className="text-lg font-semibold text-stone-50">Operations Status</h2>
            <ul className="mt-4 space-y-3 text-sm leading-6 text-stone-300">
              <li>Four locked basemaps with persistent selection.</li>
              <li>Coordinate bar formats WGS84 and TM65 side by side.</li>
              <li>Service worker caches viewed tiles for offline resilience.</li>
              <li>Tracking state survives restarts through the transport cache and mission store.</li>
            </ul>
            <div className="mt-6 rounded-2xl border border-stone-700 bg-stone-950/70 p-4 text-sm text-stone-400">
              Runtime status: <span className="text-emerald-300">{status}</span>
            </div>
            <div className="mt-6">
              <MissionControlPanel />
            </div>
            <TrackingStatusPanel />
          </aside>
        </section>
      </div>
    </main>
  )
}

export default App
