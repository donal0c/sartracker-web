import { useAppStore } from './lib/app-store'

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
            Scaffold {status}
          </div>
        </header>

        <section className="grid flex-1 gap-6 py-8 lg:grid-cols-[2fr_1fr]">
          <div className="rounded-3xl border border-stone-800 bg-stone-900/80 p-6 shadow-2xl shadow-black/30">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-stone-50">Operations Map</h2>
              <span className="text-sm text-stone-400">MapLibre baseline pending M2</span>
            </div>
            <div
              className="mt-5 flex min-h-[420px] items-center justify-center rounded-2xl border border-dashed border-amber-500/25 bg-[radial-gradient(circle_at_top,_rgba(245,158,11,0.18),_transparent_35%),linear-gradient(180deg,_rgba(28,25,23,0.9),_rgba(12,10,9,0.96))]"
              data-testid="map-shell"
            >
              <div className="max-w-md text-center">
                <p className="text-xs uppercase tracking-[0.3em] text-amber-300/80">
                  Operational Core
                </p>
                <p className="mt-4 text-2xl font-semibold text-stone-50">
                  Map shell ready for Tauri, React, and test infrastructure
                </p>
                <p className="mt-3 text-sm leading-6 text-stone-400">
                  The scaffold is intentionally thin. Safety-critical coordinate,
                  persistence, and tracking logic will live in testable modules.
                </p>
              </div>
            </div>
          </div>

          <aside className="rounded-3xl border border-stone-800 bg-stone-900/80 p-6">
            <h2 className="text-lg font-semibold text-stone-50">Build Guardrails</h2>
            <ul className="mt-4 space-y-3 text-sm leading-6 text-stone-300">
              <li>Strict TypeScript and ESLint are enabled.</li>
              <li>Vitest and Playwright smoke coverage is in place.</li>
              <li>State flows through Zustand, not ad hoc component state.</li>
              <li>Tauri SQL plugin is installed for the MissionStore boundary.</li>
            </ul>
          </aside>
        </section>
      </div>
    </main>
  )
}

export default App
