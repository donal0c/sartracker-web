import 'maplibre-gl/dist/maplibre-gl.css'

import { CoordinateBar } from './coordinate-bar'
import { BasemapSwitcher } from './basemap-switcher'
import { DrawingToolbar } from './drawing-toolbar'
import { FocusModeCoordinateMirror } from './focus-mode-coordinate-mirror'
import { MapStatusBadge } from './map-status-badge'
import { OfflineMapReadinessBadge } from './offline-map-readiness-badge'
import { useFocusModeStore } from '../features/focus-mode/focus-mode-store'
import { useOfflineMapCoverage } from '../features/map/use-offline-map-coverage'
import { useMapController } from '../features/map/use-map-controller'
import { useOfflineMapReadiness } from '../features/map/use-offline-map-readiness'

/**
 * Renders the operator-facing map shell around the map controller state.
 */
export function MapView() {
  const focusModeActive = useFocusModeStore((state) => state.active)
  const {
    activeBasemapId,
    containerRef,
    handleBasemapChange,
    hoverCoordinate,
    mapHealth,
    mapRef,
  } = useMapController()
  const offlineMapReadiness = useOfflineMapReadiness(activeBasemapId)
  const { coverage, checkCurrentViewCoverage } = useOfflineMapCoverage(
    activeBasemapId,
    mapRef,
  )

  return (
    <div className="relative h-full w-full overflow-hidden bg-stone-950">
      <BasemapSwitcher
        activeBasemapId={activeBasemapId}
        onBasemapChange={handleBasemapChange}
      />
      <DrawingToolbar />
      <div className="h-full w-full" data-testid="map-container" ref={containerRef} />
      <div className="pointer-events-none absolute bottom-20 right-3 z-10 flex max-w-[min(18rem,calc(100%-2rem))] flex-col items-end gap-2">
        <MapStatusBadge health={mapHealth} />
        <OfflineMapReadinessBadge
          coverage={coverage}
          onCheckCoverage={checkCurrentViewCoverage}
          readiness={offlineMapReadiness}
        />
      </div>
      <CoordinateBar
        latitude={hoverCoordinate.latitude}
        longitude={hoverCoordinate.longitude}
      />
      {focusModeActive ? (
        <FocusModeCoordinateMirror
          latitude={hoverCoordinate.latitude}
          longitude={hoverCoordinate.longitude}
        />
      ) : null}
    </div>
  )
}
