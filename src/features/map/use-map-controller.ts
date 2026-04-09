import { useEffect, useMemo, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'

import { MAP_CENTER, MAP_DEFAULT_ZOOM, getBasemapById, type BasemapId } from '../../lib/map-config'
import {
  createDegradedMapHealth,
  createLoadingMapHealth,
  createReadyMapHealth,
  type MapHealth,
} from '../../lib/map-health'
import { persistBasemapPreference, readStoredBasemap } from '../../lib/map-preferences'
import { createRasterStyle, KERRY_MAX_BOUNDS } from './map-style'
import { useMissionStore } from '../mission/mission-store'
import { findNearestMarkerId } from '../markers/marker-hit-testing'
import { useMarkerStore } from '../markers/marker-store'
import {
  MARKER_HITBOX_LAYER_ID,
  MARKER_LABEL_LAYER_ID,
  MARKER_SYMBOL_LAYER_ID,
  syncMarkerOverlay,
} from '../markers/sync-marker-overlay'
import { syncTrackingOverlay } from '../tracking/sync-tracking-overlay'
import { useTrackingStore } from '../tracking/tracking-store'

export type HoverCoordinate = {
  readonly latitude: number | null
  readonly longitude: number | null
}

const EMPTY_HOVER_COORDINATE: HoverCoordinate = {
  latitude: null,
  longitude: null,
}

type MapController = {
  readonly activeBasemapId: BasemapId
  readonly containerRef: React.RefObject<HTMLDivElement | null>
  readonly hoverCoordinate: HoverCoordinate
  readonly mapHealth: MapHealth
  readonly handleBasemapChange: (nextBasemapId: BasemapId) => void
}

/**
 * Owns the map lifecycle, hover state, basemap switching, and health reporting.
 */
export function useMapController(): MapController {
  const initialBasemapId = readStoredBasemap()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const previousBasemapIdRef = useRef<BasemapId | null>(null)
  const activeBasemapIdRef = useRef<BasemapId>(initialBasemapId)
  const [activeBasemapId, setActiveBasemapId] = useState<BasemapId>(initialBasemapId)
  const [hoverCoordinate, setHoverCoordinate] = useState<HoverCoordinate>(EMPTY_HOVER_COORDINATE)
  const [mapHealth, setMapHealth] = useState<MapHealth>(() =>
    createLoadingMapHealth(getBasemapById(initialBasemapId).label),
  )
  const style = useMemo(() => createRasterStyle(activeBasemapId), [activeBasemapId])
  const trackingSnapshot = useTrackingStore((state) => state.snapshot)
  const markerActiveMissionId = useMarkerStore((state) => state.activeMissionId)
  const markerController = useMarkerStore((state) => state.controller)
  const markerState = useMarkerStore((state) => state.markers)
  const missionPhase = useMissionStore((state) => state.phase)
  const currentMissionId = useMissionStore((state) => state.currentMission?.id ?? null)

  useEffect(() => {
    persistBasemapPreference(activeBasemapId)
  }, [activeBasemapId])

  function handleBasemapChange(nextBasemapId: BasemapId) {
    activeBasemapIdRef.current = nextBasemapId
    setMapHealth(createLoadingMapHealth(getBasemapById(nextBasemapId).label))
    setActiveBasemapId(nextBasemapId)
  }

  useEffect(() => {
    if (containerRef.current === null || mapRef.current !== null) {
      return
    }

    const map = new maplibregl.Map({
      container: containerRef.current,
      style,
      center: [...MAP_CENTER],
      zoom: MAP_DEFAULT_ZOOM,
      maxBounds: KERRY_MAX_BOUNDS,
    })

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right')
    map.on('load', () => {
      const center = map.getCenter()
      setHoverCoordinate({
        latitude: center.lat,
        longitude: center.lng,
      })
    })
    map.on('idle', () => {
      setMapHealth((current) => {
        if (current.status === 'degraded') {
          return current
        }

        return createReadyMapHealth(getBasemapById(activeBasemapIdRef.current).label)
      })
    })
    map.on('error', () => {
      setMapHealth(
        createDegradedMapHealth(getBasemapById(activeBasemapIdRef.current).label),
      )
    })
    map.on('webglcontextlost', () => {
      setMapHealth(
        createDegradedMapHealth(
          getBasemapById(activeBasemapIdRef.current).label,
          'WebGL context lost',
        ),
      )
    })
    map.on('webglcontextrestored', () => {
      setMapHealth(createLoadingMapHealth(getBasemapById(activeBasemapIdRef.current).label))
    })
    map.on('mousemove', (event) => {
      setHoverCoordinate({
        latitude: event.lngLat.lat,
        longitude: event.lngLat.lng,
      })
    })
    map.on('mouseleave', () => {
      setHoverCoordinate(EMPTY_HOVER_COORDINATE)
    })

    mapRef.current = map
    previousBasemapIdRef.current = activeBasemapId

    return () => {
      map.remove()
      mapRef.current = null
      previousBasemapIdRef.current = null
    }
  }, [activeBasemapId, style])

  useEffect(() => {
    const map = mapRef.current

    if (map === null || previousBasemapIdRef.current === activeBasemapId) {
      return
    }

    map.setStyle(style)
    previousBasemapIdRef.current = activeBasemapId
  }, [activeBasemapId, style])

  useEffect(() => {
    const map = mapRef.current

    if (map === null) {
      return
    }

    const synchronizeOverlay = () => {
      if (!map.isStyleLoaded()) {
        return
      }

      syncTrackingOverlay(map, trackingSnapshot)
    }

    synchronizeOverlay()
    map.on('styledata', synchronizeOverlay)

    return () => {
      map.off('styledata', synchronizeOverlay)
    }
  }, [activeBasemapId, trackingSnapshot])

  useEffect(() => {
    const map = mapRef.current

    if (map === null) {
      return
    }

    const synchronizeOverlay = () => {
      if (!map.isStyleLoaded()) {
        return
      }

      void syncMarkerOverlay(map, markerState)
    }

    synchronizeOverlay()
    map.on('styledata', synchronizeOverlay)

    return () => {
      map.off('styledata', synchronizeOverlay)
    }
  }, [activeBasemapId, markerState])

  useEffect(() => {
    const map = mapRef.current
    const mapContainer = containerRef.current

    if (map === null || mapContainer === null || markerController === null) {
      return
    }

    const handleMarkerClick = (event: MouseEvent) => {
      if (currentMissionId === null || missionPhase === 'recovery') {
        return
      }

      const target = event.target
      if (target instanceof HTMLElement && target.closest('button, input, select, label, a')) {
        return
      }

      const containerBounds = mapContainer.getBoundingClientRect()
      if (
        event.clientX < containerBounds.left ||
        event.clientX > containerBounds.right ||
        event.clientY < containerBounds.top ||
        event.clientY > containerBounds.bottom
      ) {
        return
      }

      const point = {
        x: event.clientX - containerBounds.left,
        y: event.clientY - containerBounds.top,
      }
      const queryPoint: [number, number] = [point.x, point.y]
      const interactiveMarkerLayers = [
        MARKER_HITBOX_LAYER_ID,
        MARKER_SYMBOL_LAYER_ID,
        MARKER_LABEL_LAYER_ID,
      ].filter((layerId) => map.getLayer(layerId) !== undefined)
      const markerFeature =
        interactiveMarkerLayers.length === 0
          ? null
          : map.queryRenderedFeatures(queryPoint, {
              layers: interactiveMarkerLayers,
            })[0] ?? null

      const renderedMarkerId =
        markerFeature?.properties && 'markerId' in markerFeature.properties
          ? markerFeature.properties.markerId
          : null
      const markerId =
        typeof renderedMarkerId === 'string'
          ? renderedMarkerId
          : findNearestMarkerId(map, point, markerState)

      if (markerId !== null) {
        markerController.beginEdit(markerId)
        return
      }

      const lngLat = map.unproject([point.x, point.y])
      if (markerActiveMissionId !== currentMissionId) {
        void markerController.refreshMission(currentMissionId).then(() => {
          markerController.beginCreateAt(lngLat.lat, lngLat.lng)
        })
        return
      }

      markerController.beginCreateAt(lngLat.lat, lngLat.lng)
    }

    window.addEventListener('click', handleMarkerClick, true)

    return () => {
      window.removeEventListener('click', handleMarkerClick, true)
    }
  }, [currentMissionId, markerActiveMissionId, markerController, missionPhase, markerState])

  return {
    activeBasemapId,
    containerRef,
    hoverCoordinate,
    mapHealth,
    handleBasemapChange,
  }
}
