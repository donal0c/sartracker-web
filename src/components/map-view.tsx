import 'maplibre-gl/dist/maplibre-gl.css'

import { CoordinateBar } from './coordinate-bar'
import { BasemapSwitcher } from './basemap-switcher'
import { DrawingToolbar } from './drawing-toolbar'
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
    <div className="relative h-full w-full overflow-hidden bg-stone-950">
      <BasemapSwitcher
        activeBasemapId={activeBasemapId}
        onBasemapChange={handleBasemapChange}
      />
      <DrawingToolbar />
      <div className="h-full w-full" data-testid="map-container" ref={containerRef} />
      <div className="pointer-events-none absolute right-4 top-4 z-10 flex flex-col items-end gap-2">
        <MapStatusBadge health={mapHealth} />
      </div>
      <CoordinateBar
        latitude={hoverCoordinate.latitude}
        longitude={hoverCoordinate.longitude}
      />
    </div>
  )
}
