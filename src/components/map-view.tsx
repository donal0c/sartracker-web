import 'maplibre-gl/dist/maplibre-gl.css'

import { useEffect, useState } from 'react'

import { CoordinateBar } from './coordinate-bar'
import { BasemapSwitcher } from './basemap-switcher'
import { DrawingToolbar } from './drawing-toolbar'
import { FocusModeCoordinateMirror } from './focus-mode-coordinate-mirror'
import { MapDegradedAlert } from './map-degraded-alert'
import { LeafletFallbackMapView } from './leaflet-fallback-map-view'
import { getMapRendererMode } from '../features/map/map-renderer-mode'
import { useFocusModeStore } from '../features/focus-mode/focus-mode-store'
import { useOfflineMapCoverage } from '../features/map/use-offline-map-coverage'
import { useMapController } from '../features/map/use-map-controller'
import { useOfflineMapReadiness } from '../features/map/use-offline-map-readiness'
import { loadAppSettings } from '../infrastructure/settings-store/tauri-settings-store'
import {
  MAP_CATALOGUE_GROUPS,
  buildMapCatalogueGroups,
  type MapCatalogueGroup,
} from '../lib/map-config'

/**
 * Renders the operator-facing map shell around the map controller state.
 */
export function MapView() {
  if (getMapRendererMode() === 'leaflet') {
    return <LeafletFallbackMapView />
  }

  return <MapLibreMapView />
}

function MapLibreMapView() {
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
  const catalogueGroups = useOfficialMapCatalogueGroups()

  return (
    <div className="relative h-full w-full overflow-hidden bg-stone-950">
      <BasemapSwitcher
        activeBasemapId={activeBasemapId}
        catalogueGroups={catalogueGroups}
        coverage={coverage}
        mapHealth={mapHealth}
        offlineReadiness={offlineMapReadiness}
        onBasemapChange={handleBasemapChange}
        onCheckCoverage={checkCurrentViewCoverage}
      />
      <DrawingToolbar />
      <div className="h-full w-full" data-testid="map-container" ref={containerRef} />
      <MapDegradedAlert mapHealth={mapHealth} offlineReadiness={offlineMapReadiness} />
      {!focusModeActive ? (
        <CoordinateBar
          latitude={hoverCoordinate.latitude}
          longitude={hoverCoordinate.longitude}
        />
      ) : null}
      {focusModeActive ? (
        <FocusModeCoordinateMirror
          latitude={hoverCoordinate.latitude}
          longitude={hoverCoordinate.longitude}
        />
      ) : null}
    </div>
  )
}

function useOfficialMapCatalogueGroups(): readonly MapCatalogueGroup[] {
  const [catalogueGroups, setCatalogueGroups] = useState(MAP_CATALOGUE_GROUPS)

  useEffect(() => {
    let cancelled = false

    const refreshCatalogue = () => {
      void loadAppSettings()
        .then((settings) => {
          if (!cancelled) {
            setCatalogueGroups(buildMapCatalogueGroups(settings.officialMaps))
          }
        })
        .catch(() => {
          if (!cancelled) {
            setCatalogueGroups(buildMapCatalogueGroups())
          }
        })
    }

    refreshCatalogue()
    window.addEventListener('sartracker:settings-updated', refreshCatalogue)
    return () => {
      cancelled = true
      window.removeEventListener('sartracker:settings-updated', refreshCatalogue)
    }
  }, [])

  return catalogueGroups
}
