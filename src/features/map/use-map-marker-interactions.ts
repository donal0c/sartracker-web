import { useEffect, type RefObject } from 'react'
import type maplibregl from 'maplibre-gl'

import { useMissionStore } from '../mission/mission-store'
import { findNearestMarkerId } from '../markers/marker-hit-testing'
import { useMarkerStore } from '../markers/marker-store'
import {
  createMapPanClickGuard,
  getInteractiveMarkerLayerIds,
  isPointInsideMapContainer,
  resolveClickedMarkerId,
  shouldIgnoreMarkerMapClick,
} from './map-marker-interactions'
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

      const queryPoint: [number, number] = [point.x, point.y]
      const interactiveMarkerLayers = getInteractiveMarkerLayerIds(
        (layerId) => map.getLayer(layerId) !== undefined,
      )
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
      const markerId = resolveClickedMarkerId(
        renderedMarkerId,
        findNearestMarkerId(map, point, markerState),
      )

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
    interactionMode,
    markerActiveMissionId,
    markerController,
    markerState,
    missionPhase,
    options.containerRef,
    options.mapRef,
  ])
}
