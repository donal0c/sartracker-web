import type { RefObject } from 'react'
import type { BasemapId } from '../../lib/map-config'
import type { MapHealth } from '../../lib/map-health'
import type { HoverCoordinate } from './use-map-instance'
import { useMapInstance } from './use-map-instance'
import { useMapMarkerInteractions } from './use-map-marker-interactions'
import { useMapOverlays } from './use-map-overlays'

type MapController = {
  readonly activeBasemapId: BasemapId
  readonly containerRef: RefObject<HTMLDivElement | null>
  readonly hoverCoordinate: HoverCoordinate
  readonly mapHealth: MapHealth
  readonly handleBasemapChange: (nextBasemapId: BasemapId) => void
}

/**
 * Composes the map lifecycle, overlay synchronization, and marker interactions
 * behind the stable controller API consumed by the map view.
 */
export function useMapController(): MapController {
  const mapInstance = useMapInstance()

  useMapOverlays({
    activeBasemapId: mapInstance.activeBasemapId,
    mapRef: mapInstance.mapRef,
  })
  useMapMarkerInteractions({
    containerRef: mapInstance.containerRef,
    mapRef: mapInstance.mapRef,
  })

  return {
    activeBasemapId: mapInstance.activeBasemapId,
    containerRef: mapInstance.containerRef,
    hoverCoordinate: mapInstance.hoverCoordinate,
    mapHealth: mapInstance.mapHealth,
    handleBasemapChange: mapInstance.handleBasemapChange,
  }
}
