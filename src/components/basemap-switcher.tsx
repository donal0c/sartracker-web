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
      className="absolute left-4 top-4 z-10 flex flex-wrap gap-2"
      data-testid="basemap-switcher"
    >
      {BASEMAPS.map((basemap) => {
        const isActive = basemap.id === activeBasemapId

        return (
          <button
            key={basemap.id}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
              isActive
                ? 'border-amber-300 bg-amber-300 text-stone-950'
                : 'border-stone-600 bg-stone-950/80 text-stone-200 hover:border-stone-400'
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
