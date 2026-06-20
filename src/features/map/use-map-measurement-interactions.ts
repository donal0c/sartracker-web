import { useEffect, type RefObject } from 'react'
import type maplibregl from 'maplibre-gl'

import { useMeasurementStore } from '../measurements/measurement-store'
import { useMissionStore } from '../mission/mission-store'
import { isPointInsideMapContainer, shouldIgnoreMapInteraction } from './map-interaction-guards'
import { createOperationalCrosshairCursor } from './map-cursors'
import { useMapInteractionMode } from './use-map-interaction-mode'

type UseMapMeasurementInteractionsOptions = {
  readonly containerRef: RefObject<HTMLDivElement | null>
  readonly mapRef: RefObject<maplibregl.Map | null>
}

/**
 * Owns click-driven measurement placement and live preview behavior on the map.
 */
export function useMapMeasurementInteractions(
  options: UseMapMeasurementInteractionsOptions,
): void {
  const controller = useMeasurementStore((state) => state.controller)
  const mode = useMeasurementStore((state) => state.mode)
  const interactionMode = useMapInteractionMode()
  const currentMissionId = useMissionStore((state) => state.currentMission?.id ?? null)
  const missionPhase = useMissionStore((state) => state.phase)

  useEffect(() => {
    const map = options.mapRef.current
    if (map === null) {
      return
    }

    const canvas = map.getCanvas()
    if (mode === 'armed') {
      canvas.style.cursor = createOperationalCrosshairCursor()
    } else if (interactionMode !== 'drawing_tool_armed' && interactionMode !== 'drawing_sketching') {
      canvas.style.cursor = ''
    }

    return () => {
      if (mode === 'armed') {
        canvas.style.cursor = ''
      }
    }
  }, [interactionMode, mode, options.mapRef])

  useEffect(() => {
    if (controller === null) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || mode !== 'armed') {
        return
      }

      controller.cancelMeasurement()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [controller, mode])

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
        x: event.clientX - containerBounds.left,
        y: event.clientY - containerBounds.top,
      }
    }

    const handleClick = (event: MouseEvent) => {
      if (interactionMode !== 'measurement_armed') {
        return
      }

      if (
        shouldIgnoreMapInteraction({
          currentMissionId,
          missionPhase,
          target: event.target,
          interactiveSelector: 'button, input, select, label, textarea, a',
        })
      ) {
        return
      }

      const point = resolveMapPoint(event)
      if (point === null) {
        return
      }

      event.preventDefault()
      event.stopImmediatePropagation()
      const lngLat = map.unproject([point.x, point.y])
      controller.registerPoint(lngLat.lng, lngLat.lat)
    }

    const handleMouseMove = (event: MouseEvent) => {
      if (mode !== 'armed') {
        controller.setHoverPoint(null, null)
        return
      }

      const point = resolveMapPoint(event)
      if (point === null) {
        controller.setHoverPoint(null, null)
        return
      }

      const lngLat = map.unproject([point.x, point.y])
      controller.setHoverPoint(lngLat.lng, lngLat.lat)
    }

    window.addEventListener('click', handleClick, true)
    window.addEventListener('mousemove', handleMouseMove, true)

    return () => {
      window.removeEventListener('click', handleClick, true)
      window.removeEventListener('mousemove', handleMouseMove, true)
    }
  }, [
    controller,
    currentMissionId,
    interactionMode,
    missionPhase,
    mode,
    options.containerRef,
    options.mapRef,
  ])
}
