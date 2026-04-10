import { useEffect, useRef, type RefObject } from 'react'
import type maplibregl from 'maplibre-gl'

import { useMapTargetStore } from './map-target-store'

const TARGET_SOURCE_ID = 'coordinate-target'
const TARGET_RING_LAYER_ID = 'coordinate-target-ring'
const TARGET_DOT_LAYER_ID = 'coordinate-target-dot'
const TARGET_CLEAR_DELAY_MS = 8000
const TARGET_ZOOM = 14

type UseMapLocationTargetOptions = {
  readonly mapRef: RefObject<maplibregl.Map | null>
}

/**
 * Handles coordinate-tool go-to requests and renders the temporary target marker.
 */
export function useMapLocationTarget(options: UseMapLocationTargetOptions): void {
  const pendingTarget = useMapTargetStore((state) => state.pendingTarget)
  const clearPendingTarget = useMapTargetStore((state) => state.clearPendingTarget)
  const clearActiveTarget = useMapTargetStore((state) => state.clearActiveTarget)
  const activeTimeoutRef = useRef<number | null>(null)
  const lastAppliedTargetIdRef = useRef<number | null>(null)

  useEffect(() => {
    const map = options.mapRef.current
    if (map === null || pendingTarget === null || lastAppliedTargetIdRef.current === pendingTarget.id) {
      return
    }

    lastAppliedTargetIdRef.current = pendingTarget.id

    const synchronizeTarget = () => {
      if (!map.isStyleLoaded()) {
        return
      }

      ensureCoordinateTargetOverlay(map, pendingTarget.longitude, pendingTarget.latitude)
    }

    synchronizeTarget()
    map.flyTo({
      center: [pendingTarget.longitude, pendingTarget.latitude],
      zoom: Math.max(map.getZoom(), TARGET_ZOOM),
      essential: true,
    })
    map.on('styledata', synchronizeTarget)
    clearPendingTarget(pendingTarget.id)

    if (activeTimeoutRef.current !== null) {
      window.clearTimeout(activeTimeoutRef.current)
    }
    activeTimeoutRef.current = window.setTimeout(() => {
      const latestMap = options.mapRef.current
      if (latestMap !== null && latestMap.isStyleLoaded()) {
        clearCoordinateTargetOverlay(latestMap)
      }
      clearActiveTarget(pendingTarget.id)
    }, TARGET_CLEAR_DELAY_MS)

    return () => {
      map.off('styledata', synchronizeTarget)
    }
  }, [clearActiveTarget, clearPendingTarget, options.mapRef, pendingTarget])

  useEffect(
    () => () => {
      if (activeTimeoutRef.current !== null) {
        window.clearTimeout(activeTimeoutRef.current)
      }
    },
    [],
  )
}

function ensureCoordinateTargetOverlay(
  map: maplibregl.Map,
  longitude: number,
  latitude: number,
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

  const source = map.getSource(TARGET_SOURCE_ID) as maplibregl.GeoJSONSource | undefined
  if (source !== undefined) {
    source.setData(data)
  } else {
    map.addSource(TARGET_SOURCE_ID, {
      type: 'geojson',
      data,
    })
  }

  if (!map.getLayer(TARGET_RING_LAYER_ID)) {
    map.addLayer({
      id: TARGET_RING_LAYER_ID,
      type: 'circle',
      source: TARGET_SOURCE_ID,
      paint: {
        'circle-radius': 18,
        'circle-color': '#000000',
        'circle-opacity': 0,
        'circle-stroke-color': '#FCD34D',
        'circle-stroke-width': 2,
      },
    })
  }

  if (!map.getLayer(TARGET_DOT_LAYER_ID)) {
    map.addLayer({
      id: TARGET_DOT_LAYER_ID,
      type: 'circle',
      source: TARGET_SOURCE_ID,
      paint: {
        'circle-radius': 5,
        'circle-color': '#FCD34D',
        'circle-stroke-color': '#78350F',
        'circle-stroke-width': 2,
      },
    })
  }
}

function clearCoordinateTargetOverlay(map: maplibregl.Map): void {
  const source = map.getSource(TARGET_SOURCE_ID) as maplibregl.GeoJSONSource | undefined
  if (source === undefined) {
    return
  }

  source.setData({
    type: 'FeatureCollection',
    features: [],
  })
}
