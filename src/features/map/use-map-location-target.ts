import { useEffect, type RefObject } from 'react'
import type maplibregl from 'maplibre-gl'

import { useMapTargetStore } from './map-target-store'
import { ensureGeoJsonSource } from './map-overlay-primitives'
import { registerMapStyleSync } from './map-style-sync'
import { navigateMapToTarget } from './map-camera-navigation'

const TARGET_SOURCE_ID = 'coordinate-target'
const TARGET_RING_LAYER_ID = 'coordinate-target-ring'
const TARGET_DOT_LAYER_ID = 'coordinate-target-dot'

type UseMapLocationTargetOptions = {
  readonly mapRef: RefObject<maplibregl.Map | null>
  readonly mapReadyVersion: number
}

type CoordinateTargetLayerSpecs = {
  readonly ringLayer: maplibregl.CircleLayerSpecification
  readonly dotLayer: maplibregl.CircleLayerSpecification
}

/**
 * Handles coordinate-tool go-to requests and renders the temporary target marker.
 */
export function useMapLocationTarget(options: UseMapLocationTargetOptions): void {
  const targetId = useMapTargetStore((state) => state.activeTarget?.id ?? null)

  useEffect(() => {
    const map = options.mapRef.current
    if (map === null) {
      return
    }
    const store = useMapTargetStore.getState()
    const activeTarget = targetId !== null && store.isTargetCurrent(targetId) ? store.activeTarget : null
    const releaseCamera = activeTarget === null ? undefined : navigateMapToTarget(
      map, [activeTarget.longitude, activeTarget.latitude],
      () => useMapTargetStore.getState().isTargetCurrent(activeTarget.id),
    )
    const dispose = registerMapStyleSync(map, () => {
      if (activeTarget === null || !useMapTargetStore.getState().isTargetCurrent(activeTarget.id)) {
        clearCoordinateTargetOverlay(map)
        return
      }
      ensureCoordinateTargetOverlay(map, activeTarget.longitude, activeTarget.latitude, activeTarget.id)
      useMapTargetStore.getState().markTargetAttached(activeTarget.id)
    })
    return () => {
      dispose()
      releaseCamera?.()
    }
  }, [targetId, options.mapRef, options.mapReadyVersion])
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

  if (
    map.getSource(TARGET_SOURCE_ID) === undefined ||
    map.getLayer(TARGET_RING_LAYER_ID) === undefined ||
    map.getLayer(TARGET_DOT_LAYER_ID) === undefined
  ) {
    throw new Error('Coordinate target overlay attachment is incomplete; the source, ring, and dot must be visible before attaching the request.')
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
