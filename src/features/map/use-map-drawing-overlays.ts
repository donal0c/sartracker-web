import { useEffect, type RefObject } from 'react'
import type maplibregl from 'maplibre-gl'

import { useDrawingStore } from '../drawings/drawing-store'
import {
  syncDrawingOverlay,
  syncDrawingPreviewOverlay,
} from '../drawings/sync-drawing-overlay'
import { useLayerVisibilityStore } from '../layers/layer-visibility-store'
import type { BasemapId } from '../../lib/map-config'

type UseMapDrawingOverlaysOptions = {
  readonly activeBasemapId: BasemapId
  readonly mapRef: RefObject<maplibregl.Map | null>
}

/**
 * Keeps persisted and in-progress drawing overlays synchronized with the map.
 */
export function useMapDrawingOverlays(options: UseMapDrawingOverlaysOptions): void {
  const drawings = useDrawingStore((state) => state.drawings)
  const selectedDrawingId = useDrawingStore((state) => state.selectedDrawingId)
  const sketch = useDrawingStore((state) => state.sketch)
  const activeTool = useDrawingStore((state) => state.activeTool)
  const drawingTypeVisibility = useLayerVisibilityStore((state) => state.drawingTypeVisibility)
  const hiddenDrawingIds = useLayerVisibilityStore((state) => state.hiddenDrawingIds)

  useEffect(() => {
    const map = options.mapRef.current

    if (map === null) {
      return
    }

    const synchronizeOverlay = () => {
      if (!map.isStyleLoaded()) {
        return
      }

      syncDrawingOverlay(
        map,
        drawings,
        hiddenDrawingIds,
        drawingTypeVisibility,
        selectedDrawingId,
      )
    }

    synchronizeOverlay()
    map.on('styledata', synchronizeOverlay)

    return () => {
      map.off('styledata', synchronizeOverlay)
    }
  }, [
    activeTool,
    drawings,
    drawingTypeVisibility,
    hiddenDrawingIds,
    options.activeBasemapId,
    options.mapRef,
    selectedDrawingId,
  ])

  useEffect(() => {
    const map = options.mapRef.current

    if (map === null) {
      return
    }

    const synchronizePreview = () => {
      if (!map.isStyleLoaded()) {
        return
      }

      syncDrawingPreviewOverlay(map, {
        sketch,
        activeTool,
      })
    }

    synchronizePreview()
    map.on('styledata', synchronizePreview)

    return () => {
      map.off('styledata', synchronizePreview)
    }
  }, [activeTool, options.activeBasemapId, options.mapRef, sketch])
}
