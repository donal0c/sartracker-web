import { useState } from 'react'

import {
  MAP_CATALOGUE_GROUPS,
  getRenderableMapLabel,
  type MapCatalogueGroup,
  type RenderableMapId,
} from '../lib/map-config'
import type { MapHealth } from '../lib/map-health'
import type { OfflineMapCoverage } from '../features/map/offline-map-coverage'
import type { OfflineMapReadiness } from '../features/map/offline-map-readiness'

type BasemapSwitcherProps = {
  readonly activeBasemapId: RenderableMapId
  readonly catalogueGroups?: readonly MapCatalogueGroup[]
  readonly coverage?: OfflineMapCoverage
  readonly mapHealth?: MapHealth
  readonly offlineReadiness?: OfflineMapReadiness
  readonly onBasemapChange: (basemapId: RenderableMapId) => void
  readonly onCheckCoverage?: () => void
}

/**
 * Renders compact map style selection without keeping every basemap button on the map.
 */
export function BasemapSwitcher({
  activeBasemapId,
  catalogueGroups = MAP_CATALOGUE_GROUPS,
  coverage,
  mapHealth,
  offlineReadiness,
  onBasemapChange,
  onCheckCoverage,
}: BasemapSwitcherProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const checkingCoverage = coverage?.status === 'checking'

  function handleBasemapSelection(basemapId: RenderableMapId): void {
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
        <span className="border border-stone-500 bg-[var(--sar-panel-raised)] px-2 py-1 text-[11px] font-bold text-stone-50">
          {getRenderableMapLabel(activeBasemapId)}
        </span>
        <span aria-hidden="true" className="text-stone-200">
          {menuOpen ? '^' : 'v'}
        </span>
      </button>

      {menuOpen ? (
        <div className="mt-2 grid min-w-56 gap-2 border-t border-[var(--sar-line)] pt-2">
          {catalogueGroups.map((group) => (
            <section data-testid={`map-catalogue-group-${group.id}`} key={group.id}>
              <h3 className="mb-1 px-1 text-[10px] font-black uppercase tracking-[0.16em] text-stone-300">
                {group.label}
              </h3>
              <div className="grid gap-1.5">
                {group.items.map((item) => {
                  const mapId = item.mapId
                  const isActive = mapId === activeBasemapId
                  const isAvailable = item.availability === 'available' && mapId !== undefined

                  return (
                    <button
                      className={`border px-2.5 py-1.5 text-left text-[11px] font-bold transition ${
                        isActive
                          ? 'border-amber-300 bg-amber-300 text-stone-950 shadow-inner'
                          : isAvailable
                            ? 'border-stone-500 bg-stone-950/65 text-stone-100 hover:border-amber-300 hover:bg-stone-900/85'
                            : 'cursor-not-allowed border-stone-700 bg-stone-950/35 text-stone-400'
                      }`}
                      data-testid={`basemap-btn-${item.id}`}
                      disabled={!isAvailable}
                      key={item.id}
                      onClick={() => {
                        if (mapId !== undefined) {
                          handleBasemapSelection(mapId)
                        }
                      }}
                      title={item.description}
                      type="button"
                    >
                      <span>{item.label}</span>
                      {!isAvailable ? (
                        <span className="ml-2 text-[9px] font-black uppercase tracking-[0.12em] text-stone-500">
                          Not configured
                        </span>
                      ) : null}
                    </button>
                  )
                })}
              </div>
            </section>
          ))}
          <div
            className="mt-1 space-y-2 border-t border-[var(--sar-line)] pt-2 text-[11px]"
            data-testid="basemap-status-section"
          >
            {mapHealth !== undefined ? (
              <div className="flex items-center gap-2" data-testid="basemap-map-health">
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                    mapHealth.status === 'ready'
                      ? 'bg-emerald-400'
                      : mapHealth.status === 'loading'
                        ? 'bg-amber-400 animate-pulse'
                        : 'bg-rose-400'
                  }`}
                />
                <span className="text-stone-200">{mapHealth.message}</span>
              </div>
            ) : null}
            {offlineReadiness !== undefined ? (
              <div className="flex items-center gap-2" data-testid="basemap-offline-readiness">
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                    offlineReadiness.tone === 'success'
                      ? 'bg-emerald-400'
                      : offlineReadiness.tone === 'warning'
                        ? 'bg-amber-400'
                        : 'bg-rose-400'
                  }`}
                />
                <span className="text-stone-200">{offlineReadiness.label}</span>
              </div>
            ) : null}
            {coverage !== undefined && onCheckCoverage !== undefined ? (
              <div data-testid="basemap-offline-coverage">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-stone-100">{coverage.label}</span>
                  <button
                    className="border border-stone-400 px-2 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-stone-100 transition hover:border-amber-300 hover:bg-white/10 disabled:cursor-wait disabled:opacity-60"
                    data-testid="check-offline-map-coverage"
                    disabled={checkingCoverage}
                    onClick={onCheckCoverage}
                    type="button"
                  >
                    {checkingCoverage ? 'Checking' : 'Check View'}
                  </button>
                </div>
                <p className="mt-1 text-[10px] text-stone-300">{coverage.detail}</p>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}
