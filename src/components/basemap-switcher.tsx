import { useState } from 'react'

import { BASEMAPS, type BasemapId } from '../lib/map-config'
import type { OfflineMapCoverage } from '../features/map/offline-map-coverage'

type BasemapSwitcherProps = {
  readonly activeBasemapId: BasemapId
  readonly coverage?: OfflineMapCoverage
  readonly onBasemapChange: (basemapId: BasemapId) => void
  readonly onCheckCoverage?: () => void
}

/**
 * Renders compact map style selection without keeping every basemap button on the map.
 */
export function BasemapSwitcher({
  activeBasemapId,
  coverage,
  onBasemapChange,
  onCheckCoverage,
}: BasemapSwitcherProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const activeBasemap = BASEMAPS.find((basemap) => basemap.id === activeBasemapId) ?? BASEMAPS[0]!
  const checkingCoverage = coverage?.status === 'checking'

  function handleBasemapSelection(basemapId: BasemapId): void {
    onBasemapChange(basemapId)
    setMenuOpen(false)
  }

  return (
    <div
      className="sar-control-dock absolute left-4 top-4 z-30 rounded px-2 py-2"
      data-testid="basemap-switcher"
    >
      <button
        aria-expanded={menuOpen}
        className="flex items-center gap-2 px-2 py-1.5 text-left"
        data-testid="basemap-menu-toggle"
        onClick={() => setMenuOpen((open) => !open)}
        type="button"
      >
        <span className="text-[10px] font-black uppercase tracking-[0.22em] text-amber-200">
          Maps
        </span>
        <span className="border border-[var(--sar-line)] bg-[var(--sar-panel-raised)] px-2 py-1 text-[11px] font-bold text-stone-100">
          {activeBasemap.label}
        </span>
        <span aria-hidden="true" className="text-stone-500">
          {menuOpen ? '^' : 'v'}
        </span>
      </button>

      {menuOpen ? (
        <div className="mt-2 grid min-w-44 gap-1.5 border-t border-[var(--sar-line)] pt-2">
          {BASEMAPS.map((basemap) => {
            const isActive = basemap.id === activeBasemapId

            return (
              <button
                className={`border px-2.5 py-1.5 text-left text-[11px] font-bold transition ${
                  isActive
                    ? 'border-amber-300 bg-amber-300 text-stone-950 shadow-inner'
                    : 'border-stone-600/80 bg-black/45 text-stone-200 hover:border-stone-400'
                }`}
                data-testid={`basemap-btn-${basemap.id}`}
                key={basemap.id}
                onClick={() => handleBasemapSelection(basemap.id)}
                type="button"
              >
                {basemap.label}
              </button>
            )
          })}
          {coverage !== undefined && onCheckCoverage !== undefined ? (
            <div
              className="mt-1 border-t border-[var(--sar-line)] pt-2 text-[11px] text-stone-200"
              data-testid="basemap-offline-coverage"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">{coverage.label}</span>
                <button
                  className="border border-current/40 px-2 py-1 text-[10px] font-black uppercase tracking-[0.14em] transition hover:bg-white/10 disabled:cursor-wait disabled:opacity-60"
                  data-testid="check-offline-map-coverage"
                  disabled={checkingCoverage}
                  onClick={onCheckCoverage}
                  type="button"
                >
                  {checkingCoverage ? 'Checking' : 'Check View'}
                </button>
              </div>
              <p className="mt-1 text-[10px] text-stone-400">{coverage.detail}</p>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
