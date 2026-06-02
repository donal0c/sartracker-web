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
        <div className="flex flex-col gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="relative flex h-20 w-24 flex-shrink-0 items-center justify-center overflow-hidden border border-stone-200/40 bg-white">
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
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-amber-300">
                Focus Mode Plus
              </p>
              <h1
                className="mt-1 truncate font-mono text-lg font-bold text-stone-50"
                data-testid="app-title"
              >
                SAR Tracker
              </h1>
            </div>
          </div>
          <FocusModeToggle className="sar-button-focus self-start rounded-lg px-3 py-2 text-[11px] font-bold" />
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
