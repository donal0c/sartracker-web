import { useEffect, type RefObject } from 'react'
import type maplibregl from 'maplibre-gl'

import { useDrawingStore } from '../drawings/drawing-store'
import { useGpxStore } from '../gpx/gpx-store'
import { useMissionStore } from '../mission/mission-store'
import { useMarkerStore } from '../markers/marker-store'
import {
  createMapPanClickGuard,
  isPointInsideMapContainer,
  shouldIgnoreMarkerMapClick,
} from './map-marker-interactions'
import { resolveClickedMapTarget } from './map-click-target-resolver'
import { useMapInteractionMode } from './use-map-interaction-mode'

type UseMapMarkerInteractionsOptions = {
  readonly containerRef: RefObject<HTMLDivElement | null>
  readonly mapRef: RefObject<maplibregl.Map | null>
}

/**
 * Owns click-driven marker edit/create behavior on the live map surface.
 */
export function useMapMarkerInteractions(
  options: UseMapMarkerInteractionsOptions,
): void {
  const markerActiveMissionId = useMarkerStore((state) => state.activeMissionId)
  const markerController = useMarkerStore((state) => state.controller)
  const markerState = useMarkerStore((state) => state.markers)
  const drawings = useDrawingStore((state) => state.drawings)
  const gpxImports = useGpxStore((state) => state.imports)
  const interactionMode = useMapInteractionMode()
  const missionPhase = useMissionStore((state) => state.phase)
  const currentMissionId = useMissionStore((state) => state.currentMission?.id ?? null)

  useEffect(() => {
    const map = options.mapRef.current
    const mapContainer = options.containerRef.current

    if (map === null || mapContainer === null || markerController === null) {
      return
    }

    const panClickGuard = createMapPanClickGuard()

    const resolveContainerPoint = (event: MouseEvent | PointerEvent) => {
      const containerBounds = mapContainer.getBoundingClientRect()
      if (
        !isPointInsideMapContainer(
          { x: event.clientX, y: event.clientY },
          containerBounds,
        )
      ) {
        return null
      }

      return {
        x: event.clientX - containerBounds.left,
        y: event.clientY - containerBounds.top,
      }
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0) {
        panClickGuard.cancel()
        return
      }

      const point = resolveContainerPoint(event)
      if (point === null) {
        panClickGuard.cancel()
        return
      }

      panClickGuard.recordPointerDown(point)
    }

    const handlePointerMove = (event: PointerEvent) => {
      const point = resolveContainerPoint(event)
      if (point === null) {
        return
      }

      panClickGuard.recordPointerMove(point)
    }

    const handlePointerUp = () => {
      panClickGuard.recordPointerUp()
    }

    const handleMarkerClick = (event: MouseEvent) => {
      if (shouldIgnoreMarkerMapClick(currentMissionId, missionPhase, event.target)) {
        return
      }

      if (panClickGuard.consumeClickSuppression()) {
        return
      }

      if (interactionMode !== 'idle') {
        return
      }

      const point = resolveContainerPoint(event)
      if (point === null) {
        return
      }

      const target = resolveClickedMapTarget({
        map,
        point,
        markers: markerState,
        drawings,
        gpxImports,
      })

      if (target.kind === 'marker' && target.id !== null) {
        markerController.beginEdit(target.id)
        return
      }

      if (target.kind === 'drawing') {
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

    window.addEventListener('pointerdown', handlePointerDown, true)
    window.addEventListener('pointermove', handlePointerMove, true)
    window.addEventListener('pointerup', handlePointerUp, true)
    window.addEventListener('click', handleMarkerClick, true)

    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true)
      window.removeEventListener('pointermove', handlePointerMove, true)
      window.removeEventListener('pointerup', handlePointerUp, true)
      window.removeEventListener('click', handleMarkerClick, true)
    }
  }, [
    currentMissionId,
    drawings,
    gpxImports,
    interactionMode,
    markerActiveMissionId,
    markerController,
    markerState,
    missionPhase,
    options.containerRef,
    options.mapRef,
  ])
}
