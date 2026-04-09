import 'maplibre-gl/dist/maplibre-gl.css'

import { CoordinateBar } from './coordinate-bar'
import { BasemapSwitcher } from './basemap-switcher'
import { MapStatusBadge } from './map-status-badge'
import { useMapController } from '../features/map/use-map-controller'

/**
 * Renders the operator-facing map shell around the map controller state.
 */
export function MapView() {
  const {
    activeBasemapId,
    containerRef,
    handleBasemapChange,
    hoverCoordinate,
    mapHealth,
  } = useMapController()

  return (
    <div className="relative h-[560px] overflow-hidden rounded-2xl border border-stone-700 bg-stone-950">
      <BasemapSwitcher
        activeBasemapId={activeBasemapId}
        onBasemapChange={handleBasemapChange}
      />
      <div className="h-full w-full" data-testid="map-container" ref={containerRef} />
      <div className="pointer-events-none absolute right-4 top-4 z-10 flex flex-col items-end gap-2">
        <MapStatusBadge health={mapHealth} />
        <div className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-xs text-emerald-100">
          Cached tiles available offline after viewing
        </div>
      </div>
      <CoordinateBar
        latitude={hoverCoordinate.latitude}
        longitude={hoverCoordinate.longitude}
      />
    </div>
  )
}
