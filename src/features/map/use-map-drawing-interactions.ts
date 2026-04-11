import { useEffect, type RefObject } from 'react'
import type maplibregl from 'maplibre-gl'

import { findNearestDrawingId } from '../drawings/drawing-hit-testing'
import { useDrawingStore } from '../drawings/drawing-store'
import { useMissionStore } from '../mission/mission-store'
import {
  getInteractiveDrawingLayerIds,
  isPointInsideMapContainer,
  resolveClickedDrawingId,
  shouldIgnoreDrawingMapClick,
} from './map-drawing-interactions'
import { useMapInteractionMode } from './use-map-interaction-mode'

type UseMapDrawingInteractionsOptions = {
  readonly containerRef: RefObject<HTMLDivElement | null>
  readonly mapRef: RefObject<maplibregl.Map | null>
}

/**
 * Owns click-driven drawing create/edit/select behavior on the live map surface.
 */
export function useMapDrawingInteractions(
  options: UseMapDrawingInteractionsOptions,
): void {
  const controller = useDrawingStore((state) => state.controller)
  const activeTool = useDrawingStore((state) => state.activeTool)
  const dialog = useDrawingStore((state) => state.dialog)
  const drawings = useDrawingStore((state) => state.drawings)
  const interactionMode = useMapInteractionMode()
  const currentMissionId = useMissionStore((state) => state.currentMission?.id ?? null)
  const missionPhase = useMissionStore((state) => state.phase)

  useEffect(() => {
    const map = options.mapRef.current
    if (map === null) {
      return
    }

    if (activeTool === 'line' || activeTool === 'search_area') {
      map.doubleClickZoom.disable()
      return () => {
        map.doubleClickZoom.enable()
      }
    }

    map.doubleClickZoom.enable()
    return
  }, [activeTool, options.mapRef])

  useEffect(() => {
    if (controller === null) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return
      }

      if (activeTool === 'select' && dialog === null) {
        return
      }

      controller.cancelActiveTool()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [activeTool, controller, dialog])

  useEffect(() => {
    const map = options.mapRef.current
    const mapContainer = options.containerRef.current

    if (map === null || mapContainer === null || controller === null) {
      return
    }

    const resolveMapPoint = (event: MouseEvent) => {
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
        point: {
          x: event.clientX - containerBounds.left,
          y: event.clientY - containerBounds.top,
        },
        bounds: containerBounds,
      }
    }

    const handleClick = (event: MouseEvent) => {
      if (
        interactionMode === 'measurement_armed' ||
        shouldIgnoreDrawingMapClick(currentMissionId, missionPhase, event.target)
      ) {
        return
      }

      const resolved = resolveMapPoint(event)
      if (resolved === null) {
        return
      }

      const { point } = resolved

      if (activeTool === 'select') {
        const interactiveDrawingLayers = getInteractiveDrawingLayerIds(
          (layerId) => map.getLayer(layerId) !== undefined,
        )
        const drawingFeature =
          interactiveDrawingLayers.length === 0
            ? null
            : map.queryRenderedFeatures([point.x, point.y], {
                layers: interactiveDrawingLayers,
              })[0] ?? null
        const drawingId = resolveClickedDrawingId(drawingFeature?.properties?.drawingId)
        const resolvedDrawingId =
          drawingId ?? findNearestDrawingId(map, point, drawings)

        if (resolvedDrawingId !== null) {
          event.preventDefault()
          event.stopImmediatePropagation()
          controller.beginEdit(resolvedDrawingId)
        }

        return
      }

      const lngLat = map.unproject([point.x, point.y])

      if (activeTool === 'line' || activeTool === 'search_area') {
        event.preventDefault()
        event.stopImmediatePropagation()
        controller.appendSketchPoint(lngLat.lng, lngLat.lat)
        return
      }

      if (
        activeTool === 'range_ring' ||
        activeTool === 'bearing_line' ||
        activeTool === 'search_sector' ||
        activeTool === 'text_label'
      ) {
        event.preventDefault()
        event.stopImmediatePropagation()
        controller.beginDialogAtPoint(activeTool, lngLat.lng, lngLat.lat)
      }
    }

    const handleDoubleClick = (event: MouseEvent) => {
      if (activeTool !== 'line' && activeTool !== 'search_area') {
        return
      }

      const resolved = resolveMapPoint(event)
      if (resolved === null) {
        return
      }

      event.preventDefault()
      event.stopImmediatePropagation()
      controller.completeSketch()
    }

    const handleContextMenu = (event: MouseEvent) => {
      if (activeTool !== 'line' && activeTool !== 'search_area') {
        return
      }

      const resolved = resolveMapPoint(event)
      if (resolved === null) {
        return
      }

      event.preventDefault()
      event.stopImmediatePropagation()
      controller.completeSketch()
    }

    window.addEventListener('click', handleClick, true)
    window.addEventListener('dblclick', handleDoubleClick, true)
    window.addEventListener('contextmenu', handleContextMenu, true)

    return () => {
      window.removeEventListener('click', handleClick, true)
      window.removeEventListener('dblclick', handleDoubleClick, true)
      window.removeEventListener('contextmenu', handleContextMenu, true)
    }
  }, [
    activeTool,
    controller,
    currentMissionId,
    drawings,
    interactionMode,
    missionPhase,
    options.containerRef,
    options.mapRef,
  ])
}
