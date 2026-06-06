import { useState } from 'react'

import { FocusModeToggle } from './focus-mode-toggle'
import { GpxImportPanel } from './gpx-import-panel'
import { HelicopterPanel } from './helicopter-panel'
import { LayerFilterPanel } from './layer-filter-panel'
import { MarkerAtGridPanel } from './marker-at-grid-panel'
import { MeasurementPanel } from './measurement-panel'
import { MissionControlPanel } from './mission-control-panel'
import { TrackingStatusPanel } from './tracking-status-panel'

type FocusSidebarTab = 'tracking' | 'tools' | 'layers'

const FOCUS_SIDEBAR_TABS: readonly { readonly id: FocusSidebarTab; readonly label: string }[] = [
  { id: 'tracking', label: 'Tracking' },
  { id: 'tools', label: 'Tools' },
  { id: 'layers', label: 'Layers' },
]

/**
 * Renders the Focus Mode Plus sidebar with compact mission strip and full tabbed workspace.
 */
export function FocusModeSidebar() {
  const [activeTab, setActiveTab] = useState<FocusSidebarTab>('layers')

  return (
    <aside
      className="sar-sidebar z-20 flex w-[400px] flex-col"
      data-testid="focus-mode-sidebar"
    >
      {/* Compact Focus Mode header with mission strip */}
      <header className="flex-shrink-0 border-b-2 border-amber-500/70 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="relative flex h-14 w-16 flex-shrink-0 items-center justify-center overflow-hidden border border-stone-200/40 bg-white">
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
              <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-amber-400">
                Focus Mode Plus
              </p>
              <h1
                className="mt-0.5 truncate font-mono text-base font-bold text-stone-50"
                data-testid="app-title"
              >
                SAR Tracker
              </h1>
            </div>
          </div>
          <FocusModeToggle className="sar-button-focus flex-shrink-0 rounded-lg px-3 py-2 text-[11px] font-bold" />
        </div>
      </header>

      {/* Mission Control — full panel pinned above tabs */}
      <div
        className="min-h-0 flex-shrink overflow-y-auto border-b border-[var(--sar-line)] px-5 pb-4 pt-4"
        data-testid="focus-mode-mission-dock"
      >
        <MissionControlPanel />
      </div>

      {/* Tabbed workspace — same structure as normal sidebar */}
      <div className="flex-shrink-0 px-5 pb-2 pt-3" data-testid="focus-sidebar-tabs">
        <div className="grid grid-cols-3 border border-[var(--sar-line)] bg-[var(--sar-panel-sunken)] p-1">
          {FOCUS_SIDEBAR_TABS.map((tab) => (
            <button
              className={`px-3 py-2 text-[12px] font-bold uppercase tracking-[0.08em] transition-colors ${
                activeTab === tab.id ? 'sar-tab-active shadow-sm' : 'sar-tab-inactive'
              }`}
              data-testid={`focus-sidebar-tab-${tab.id}`}
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              type="button"
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content — fills remaining height */}
      <div
        className={`flex-1 overflow-y-auto px-5 py-4 ${activeTab === 'layers' ? 'flex flex-col' : 'space-y-5'}`}
        data-testid="focus-sidebar-tab-content"
      >
        {activeTab === 'tracking' && (
          <>
            <TrackingStatusPanel />
            <HelicopterPanel />
          </>
        )}
        {activeTab === 'tools' && (
          <>
            <MarkerAtGridPanel />
            <GpxImportPanel />
            <MeasurementPanel />
          </>
        )}
        {activeTab === 'layers' && (
          <section className="flex min-h-fit flex-1 flex-col" data-testid="focus-mode-layer-controls">
            <LayerFilterPanel />
          </section>
        )}
      </div>
    </aside>
  )
}
