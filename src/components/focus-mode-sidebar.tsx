import { LayerFilterPanel } from './layer-filter-panel'
import { MissionControlPanel } from './mission-control-panel'
import { TrackingStatusPanel } from './tracking-status-panel'
import { FocusModeToggle } from './focus-mode-toggle'

/**
 * Renders the reduced SAR control surface kept visible during Focus Mode Plus.
 */
export function FocusModeSidebar() {
  return (
    <aside
      className="sar-sidebar z-20 flex w-[340px] flex-col"
      data-testid="focus-mode-sidebar"
    >
      <header className="flex-shrink-0 border-b border-[var(--sar-line-strong)] px-4 py-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-amber-300">
              Focus Mode Plus
            </p>
            <h1
              className="mt-1 font-mono text-lg font-bold text-stone-50"
              data-testid="app-title"
            >
              SAR Tracker
            </h1>
          </div>
          <FocusModeToggle className="sar-button-focus rounded-lg px-3 py-2 text-[11px] font-bold" />
        </div>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        <MissionControlPanel />
        <TrackingStatusPanel />
        <section data-testid="focus-mode-layer-controls">
          <LayerFilterPanel />
        </section>
      </div>
    </aside>
  )
}
