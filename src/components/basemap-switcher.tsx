import { BASEMAPS, type BasemapId } from '../lib/map-config'

type BasemapSwitcherProps = {
  readonly activeBasemapId: BasemapId
  readonly onBasemapChange: (basemapId: BasemapId) => void
}

export function BasemapSwitcher({
  activeBasemapId,
  onBasemapChange,
}: BasemapSwitcherProps) {
  return (
    <div
      className="sar-control-dock absolute left-4 top-4 z-10 flex items-center gap-1.5 rounded px-2 py-2"
      data-testid="basemap-switcher"
    >
      <span className="pr-1.5 text-[10px] font-black uppercase tracking-[0.22em] text-amber-200">
        Basemap
      </span>
      {BASEMAPS.map((basemap) => {
        const isActive = basemap.id === activeBasemapId

        return (
          <button
            key={basemap.id}
            className={`border px-2.5 py-1.5 text-[11px] font-bold transition ${
              isActive
                ? 'border-amber-300 bg-amber-300 text-stone-950 shadow-inner'
                : 'border-stone-600/80 bg-black/45 text-stone-200 hover:border-stone-400'
            }`}
            data-testid={`basemap-btn-${basemap.id}`}
            type="button"
            onClick={() => onBasemapChange(basemap.id)}
          >
            {basemap.label}
          </button>
        )
      })}
    </div>
  )
}
