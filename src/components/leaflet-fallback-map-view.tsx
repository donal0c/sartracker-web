import 'leaflet/dist/leaflet.css'

import { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'

import { BasemapSwitcher } from './basemap-switcher'
import { CoordinateBar } from './coordinate-bar'
import { MapDegradedAlert } from './map-degraded-alert'
import {
  createDegradedMapHealth,
  createLoadingMapHealth,
  createReadyMapHealth,
  type MapHealth,
} from '../lib/map-health'
import { getBasemapById, isOfficialMapId, type BasemapId, type RenderableMapId } from '../lib/map-config'
import { persistBasemapPreference, readStoredBasemap } from '../lib/map-preferences'
import {
  getEffectiveDrawingTypeVisibility,
  getEffectiveMarkerTypeVisibility,
  getEffectiveTrackingVisible,
} from '../features/layers/effective-overlay-visibility'
import { useLayerVisibilityStore } from '../features/layers/layer-visibility-store'
import { useDrawingStore } from '../features/drawings/drawing-store'
import { useMarkerStore } from '../features/markers/marker-store'
import { useTrackingStore } from '../features/tracking/tracking-store'
import { useActiveMissionDevicesStore } from '../features/tracking/active-mission-devices-store'
import { selectMissionTrackingSnapshot } from '../features/tracking/mission-active-tracking'
import { useTrackingStylePreferences } from '../features/tracking/tracking-style-store'
import { useMissionStore } from '../features/mission/mission-store'
import {
  createLeafletBasemapLayer,
  createLeafletFallbackMap,
  renderLeafletFallbackOverlays,
} from '../features/map/leaflet-fallback-renderer'
import type { OfflineMapReadiness } from '../features/map/offline-map-readiness'

type HoverCoordinate = {
  readonly latitude: number | null
  readonly longitude: number | null
}

const EMPTY_HOVER_COORDINATE: HoverCoordinate = {
  latitude: null,
  longitude: null,
}

const LEAFLET_OFFLINE_READINESS: OfflineMapReadiness = {
  detail: 'The Leaflet fallback is a render-compatibility spike; keep network available.',
  label: 'Fallback map online only',
  status: 'limited',
  tone: 'warning',
}

/**
 * Renders the DON-27 non-WebGL Leaflet fallback surface.
 */
export function LeafletFallbackMapView() {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const tileLayerRef = useRef<L.TileLayer | null>(null)
  const overlayGroupRef = useRef<L.LayerGroup | null>(null)
  const [activeBasemapId, setActiveBasemapId] = useState<BasemapId>(() => readStoredBasemap())
  const [hoverCoordinate, setHoverCoordinate] =
    useState<HoverCoordinate>(EMPTY_HOVER_COORDINATE)
  const [mapHealth, setMapHealth] = useState<MapHealth>(() =>
    createLoadingMapHealth(getBasemapById(readStoredBasemap()).label),
  )

  const trackingSnapshot = useTrackingStore((state) => state.snapshot)
  const missionId = useMissionStore((state) => state.currentMission?.id ?? null)
  const activeDeviceIds = useActiveMissionDevicesStore((state) => state.getActiveDeviceIds(missionId))
  const trackingStyle = useTrackingStylePreferences()
  const missionTrackingSnapshot = useMemo(
    () => selectMissionTrackingSnapshot(trackingSnapshot, activeDeviceIds),
    [activeDeviceIds, trackingSnapshot],
  )
  const markers = useMarkerStore((state) => state.markers)
  const drawings = useDrawingStore((state) => state.drawings)
  const selectedDrawingId = useDrawingStore((state) => state.selectedDrawingId)
  const groupVisibility = useLayerVisibilityStore((state) => state.groupVisibility)
  const hiddenDeviceIds = useLayerVisibilityStore((state) => state.hiddenDeviceIds)
  const hiddenBreadcrumbDeviceIds = useLayerVisibilityStore((state) => state.hiddenBreadcrumbDeviceIds)
  const breadcrumbsVisible = useLayerVisibilityStore((state) => state.breadcrumbsVisible)
  const markerTypeVisibility = useLayerVisibilityStore((state) => state.markerTypeVisibility)
  const hiddenMarkerIds = useLayerVisibilityStore((state) => state.hiddenMarkerIds)
  const drawingTypeVisibility = useLayerVisibilityStore((state) => state.drawingTypeVisibility)
  const hiddenDrawingIds = useLayerVisibilityStore((state) => state.hiddenDrawingIds)
  const effectiveMarkerTypeVisibility = useMemo(
    () => getEffectiveMarkerTypeVisibility(groupVisibility, markerTypeVisibility),
    [groupVisibility, markerTypeVisibility],
  )
  const effectiveDrawingTypeVisibility = useMemo(
    () => getEffectiveDrawingTypeVisibility(groupVisibility, drawingTypeVisibility),
    [groupVisibility, drawingTypeVisibility],
  )

  useEffect(() => {
    persistBasemapPreference(activeBasemapId)
  }, [activeBasemapId])

  function handleBasemapChange(nextBasemapId: BasemapId): void {
    setMapHealth(createLoadingMapHealth(getBasemapById(nextBasemapId).label))
    setActiveBasemapId(nextBasemapId)
  }

  function handleRenderableMapChange(nextMapId: RenderableMapId): void {
    if (isOfficialMapId(nextMapId)) {
      return
    }

    handleBasemapChange(nextMapId)
  }

  useEffect(() => {
    if (containerRef.current === null || mapRef.current !== null) {
      return
    }

    const map = createLeafletFallbackMap(containerRef.current)
    const overlayGroup = L.layerGroup().addTo(map)
    map.on('mousemove', (event) => {
      setHoverCoordinate({
        latitude: event.latlng.lat,
        longitude: event.latlng.lng,
      })
    })
    map.on('mouseout', () => setHoverCoordinate(EMPTY_HOVER_COORDINATE))
    mapRef.current = map
    overlayGroupRef.current = overlayGroup

    if (typeof window !== 'undefined') {
      ;(window as Window & { __SARTRACKER_LEAFLET_MAP__?: L.Map }).__SARTRACKER_LEAFLET_MAP__ = map
    }

    return () => {
      map.remove()
      mapRef.current = null
      overlayGroupRef.current = null
      if (typeof window !== 'undefined') {
        delete (window as Window & { __SARTRACKER_LEAFLET_MAP__?: L.Map }).__SARTRACKER_LEAFLET_MAP__
      }
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (map === null) {
      return
    }

    const basemap = getBasemapById(activeBasemapId)
    if (tileLayerRef.current !== null) {
      tileLayerRef.current.removeFrom(map)
    }

    const tileLayer = createLeafletBasemapLayer(activeBasemapId)
    tileLayer.on('load', () => {
      setMapHealth(createReadyMapHealth(basemap.label))
    })
    tileLayer.on('tileerror', () => {
      setMapHealth(createDegradedMapHealth(basemap.label))
    })
    tileLayer.addTo(map)
    tileLayerRef.current = tileLayer

    return () => {
      tileLayer.off()
    }
  }, [activeBasemapId])

  useEffect(() => {
    const layerGroup = overlayGroupRef.current
    if (layerGroup === null) {
      return
    }

    renderLeafletFallbackOverlays(layerGroup, {
      trackingSnapshot: missionTrackingSnapshot,
      trackingVisible: getEffectiveTrackingVisible(groupVisibility),
      breadcrumbsVisible,
      hiddenDeviceIds,
      hiddenBreadcrumbDeviceIds,
      trackingStyle,
      markers,
      markerTypeVisibility: effectiveMarkerTypeVisibility,
      hiddenMarkerIds,
      drawings,
      drawingTypeVisibility: effectiveDrawingTypeVisibility,
      hiddenDrawingIds,
      selectedDrawingId,
    })
  }, [
    breadcrumbsVisible,
    drawings,
    effectiveDrawingTypeVisibility,
    effectiveMarkerTypeVisibility,
    groupVisibility,
    hiddenBreadcrumbDeviceIds,
    hiddenDeviceIds,
    trackingStyle,
    hiddenDrawingIds,
    hiddenMarkerIds,
    markers,
    activeDeviceIds,
    missionTrackingSnapshot,
    selectedDrawingId,
    trackingSnapshot,
  ])

  return (
    <div className="relative h-full w-full overflow-hidden bg-stone-950">
      <BasemapSwitcher
        activeBasemapId={activeBasemapId}
        onBasemapChange={handleRenderableMapChange}
      />
      <div
        className="h-full w-full"
        data-testid="leaflet-map-container"
        ref={containerRef}
      />
      <div className="pointer-events-none absolute bottom-20 right-3 z-10 flex max-w-[min(18rem,calc(100%-2rem))] flex-col items-end gap-2">
        <div
          className="border border-cyan-300/70 bg-stone-950/95 px-3 py-1.5 text-[11px] font-bold text-cyan-100 shadow-lg shadow-black/40"
          data-testid="map-renderer-badge"
        >
          Leaflet fallback renderer: read-only
        </div>
      </div>
      <MapDegradedAlert mapHealth={mapHealth} offlineReadiness={LEAFLET_OFFLINE_READINESS} />
      <CoordinateBar
        latitude={hoverCoordinate.latitude}
        longitude={hoverCoordinate.longitude}
      />
    </div>
  )
}
