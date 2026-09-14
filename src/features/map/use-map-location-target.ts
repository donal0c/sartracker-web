import { useEffect, useRef, type RefObject } from 'react'
import type maplibregl from 'maplibre-gl'

import { useMapTargetStore } from './map-target-store'
import { ensureGeoJsonSource } from './map-overlay-primitives'
import { registerMapStyleSync } from './map-style-sync'
import { cancelPendingMapStyleCameraRestore } from './apply-map-style-preserving-camera'

const TARGET_SOURCE_ID = 'coordinate-target'
const TARGET_RING_LAYER_ID = 'coordinate-target-ring'
const TARGET_DOT_LAYER_ID = 'coordinate-target-dot'
const TARGET_CLEAR_DELAY_MS = 8000
const TARGET_ZOOM = 14

type UseMapLocationTargetOptions = {
  readonly mapRef: RefObject<maplibregl.Map | null>
  readonly mapReadyVersion?: number
}

type CoordinateTargetLayerSpecs = {
  readonly ringLayer: maplibregl.CircleLayerSpecification
  readonly dotLayer: maplibregl.CircleLayerSpecification
}

/**
 * Handles coordinate-tool go-to requests and renders the temporary target marker.
 */
export function useMapLocationTarget(options: UseMapLocationTargetOptions): void {
  const activeTarget = useMapTargetStore((state) => state.activeTarget)
  const clearPendingTarget = useMapTargetStore((state) => state.clearPendingTarget)
  const clearActiveTarget = useMapTargetStore((state) => state.clearActiveTarget)
  const lastAppliedTargetIdRef = useRef<number | null>(null)

  useEffect(() => {
    const map = options.mapRef.current
    if (map === null) {
      return
    }
    let timeout: number | null = null
    if (activeTarget !== null && lastAppliedTargetIdRef.current !== activeTarget.id) {
      cancelPendingMapStyleCameraRestore(map)
      lastAppliedTargetIdRef.current = activeTarget.id
      map.flyTo({
        center: [activeTarget.longitude, activeTarget.latitude],
        zoom: Math.max(map.getZoom(), TARGET_ZOOM),
        essential: true,
      })
    }
    const dispose = registerMapStyleSync(map, () => {
      if (activeTarget === null) {
        clearCoordinateTargetOverlay(map)
        return
      }
      ensureCoordinateTargetOverlay(map, activeTarget.longitude, activeTarget.latitude, activeTarget.id)
      clearPendingTarget(activeTarget.id)
      if (timeout === null) {
        timeout = window.setTimeout(() => {
          clearActiveTarget(activeTarget.id)
        }, TARGET_CLEAR_DELAY_MS)
      }
    })
    return () => {
      dispose()
      if (timeout !== null) window.clearTimeout(timeout)
    }
  }, [activeTarget, clearActiveTarget, clearPendingTarget, options.mapRef, options.mapReadyVersion])
}

/** Restores the request marker without rewriting unchanged source data on idle. */
function ensureCoordinateTargetOverlay(
  map: maplibregl.Map,
  longitude: number,
  latitude: number,
  requestId: number,
): void {
  const data = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [longitude, latitude],
        },
        properties: {},
      },
    ],
  } satisfies GeoJSON.FeatureCollection

  ensureGeoJsonSource(map, TARGET_SOURCE_ID, data, { dataKey: `target:${requestId}` })

  if (!map.getLayer(TARGET_RING_LAYER_ID)) {
    map.addLayer(createCoordinateTargetLayerSpecs().ringLayer)
  }

  if (!map.getLayer(TARGET_DOT_LAYER_ID)) {
    map.addLayer(createCoordinateTargetLayerSpecs().dotLayer)
  }
}

/** Defines the visible ring and centre dot for a temporary navigation target. */
export function createCoordinateTargetLayerSpecs(): CoordinateTargetLayerSpecs {
  return {
    ringLayer: {
      id: TARGET_RING_LAYER_ID,
      type: 'circle',
      source: TARGET_SOURCE_ID,
      paint: {
        'circle-radius': 28,
        'circle-color': '#000000',
        'circle-opacity': 0,
        'circle-stroke-color': '#EF4444',
        'circle-stroke-width': 4,
      },
    },
    dotLayer: {
      id: TARGET_DOT_LAYER_ID,
      type: 'circle',
      source: TARGET_SOURCE_ID,
      paint: {
        'circle-radius': 7,
        'circle-color': '#DC2626',
        'circle-stroke-color': '#FFFFFF',
        'circle-stroke-width': 3,
      },
    },
  }
}

/** Clears expired targets idempotently, including after delayed style availability. */
function clearCoordinateTargetOverlay(map: maplibregl.Map): void {
  const source = map.getSource(TARGET_SOURCE_ID) as maplibregl.GeoJSONSource | undefined
  if (source === undefined) {
    return
  }

  ensureGeoJsonSource(map, TARGET_SOURCE_ID, {
    type: 'FeatureCollection',
    features: [],
  }, { dataKey: 'target:empty' })
}
