import { useEffect, type RefObject } from 'react'
import type maplibregl from 'maplibre-gl'

import { useDrawingStore } from '../drawings/drawing-store'
import { useGpxStore } from '../gpx/gpx-store'
import { useMarkerStore } from '../markers/marker-store'
import { useMissionStore } from '../mission/mission-store'
import {
  createMapPanClickGuard,
  isPointInsideMapContainer,
  shouldIgnoreDrawingMapClick,
} from './map-drawing-interactions'
import { resolveClickedMapTarget } from './map-click-target-resolver'
import { useMapInteractionMode } from './use-map-interaction-mode'

type UseMapDrawingInteractionsOptions = {
  readonly containerRef: RefObject<HTMLDivElement | null>
  readonly mapRef: RefObject<maplibregl.Map | null>
}

const OPERATIONAL_CROSSHAIR_CURSOR = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'%3E%3Ccircle cx='16' cy='16' r='11' fill='none' stroke='%23FFFFFF' stroke-width='5'/%3E%3Ccircle cx='16' cy='16' r='11' fill='none' stroke='%23EF4444' stroke-width='3'/%3E%3Cpath d='M16 2v10M16 20v10M2 16h10M20 16h10' stroke='%23FFFFFF' stroke-width='5' stroke-linecap='round'/%3E%3Cpath d='M16 2v10M16 20v10M2 16h10M20 16h10' stroke='%23EF4444' stroke-width='3' stroke-linecap='round'/%3E%3Ccircle cx='16' cy='16' r='2.5' fill='%23DC2626' stroke='%23FFFFFF' stroke-width='1.5'/%3E%3C/svg%3E") 16 16, crosshair`

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
  const markers = useMarkerStore((state) => state.markers)
  const gpxImports = useGpxStore((state) => state.imports)
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
    const map = options.mapRef.current
    if (map === null) {
      return
    }

    const canvas = map.getCanvas()
    canvas.style.cursor = activeTool === 'select' ? '' : createOperationalCrosshairCursor()

    return () => {
      canvas.style.cursor = ''
    }
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

    const panClickGuard = createMapPanClickGuard()

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

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0) {
        panClickGuard.cancel()
        return
      }

      const resolved = resolveMapPoint(event)
      if (resolved === null) {
        panClickGuard.cancel()
        return
      }

      panClickGuard.recordPointerDown(resolved.point)
    }

    const handlePointerMove = (event: PointerEvent) => {
      const resolved = resolveMapPoint(event)
      if (resolved === null) {
        return
      }

      panClickGuard.recordPointerMove(resolved.point)
    }

    const handlePointerUp = () => {
      panClickGuard.recordPointerUp()
    }

    const handleClick = (event: MouseEvent) => {
      if (
        interactionMode === 'measurement_armed' ||
        shouldIgnoreDrawingMapClick(currentMissionId, missionPhase, event.target)
      ) {
        return
      }

      if (panClickGuard.consumeClickSuppression()) {
        return
      }

      const resolved = resolveMapPoint(event)
      if (resolved === null) {
        return
      }

      const { point } = resolved

      if (activeTool === 'select') {
        const target = resolveClickedMapTarget({
          map,
          point,
          markers,
          drawings,
          gpxImports,
        })

        if (target.kind === 'drawing' && target.id !== null) {
          event.preventDefault()
          event.stopImmediatePropagation()
          controller.beginEdit(target.id)
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

    window.addEventListener('pointerdown', handlePointerDown, true)
    window.addEventListener('pointermove', handlePointerMove, true)
    window.addEventListener('pointerup', handlePointerUp, true)
    window.addEventListener('click', handleClick, true)
    window.addEventListener('dblclick', handleDoubleClick, true)
    window.addEventListener('contextmenu', handleContextMenu, true)

    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true)
      window.removeEventListener('pointermove', handlePointerMove, true)
      window.removeEventListener('pointerup', handlePointerUp, true)
      window.removeEventListener('click', handleClick, true)
      window.removeEventListener('dblclick', handleDoubleClick, true)
      window.removeEventListener('contextmenu', handleContextMenu, true)
    }
  }, [
    activeTool,
    controller,
    currentMissionId,
    drawings,
    gpxImports,
    interactionMode,
    markers,
    missionPhase,
    options.containerRef,
    options.mapRef,
  ])
}

export function createOperationalCrosshairCursor(): string {
  return OPERATIONAL_CROSSHAIR_CURSOR
}
