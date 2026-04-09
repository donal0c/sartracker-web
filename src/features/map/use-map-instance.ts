import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import maplibregl from 'maplibre-gl'

import { MAP_CENTER, MAP_DEFAULT_ZOOM, getBasemapById, type BasemapId } from '../../lib/map-config'
import {
  createDegradedMapHealth,
  createLoadingMapHealth,
  createReadyMapHealth,
  type MapHealth,
} from '../../lib/map-health'
import { persistBasemapPreference, readStoredBasemap } from '../../lib/map-preferences'
import { createRasterStyle, KERRY_MAX_BOUNDS } from './map-style'

export type HoverCoordinate = {
  readonly latitude: number | null
  readonly longitude: number | null
}

const EMPTY_HOVER_COORDINATE: HoverCoordinate = {
  latitude: null,
  longitude: null,
}

export type MapInstanceController = {
  readonly activeBasemapId: BasemapId
  readonly containerRef: RefObject<HTMLDivElement | null>
  readonly hoverCoordinate: HoverCoordinate
  readonly mapHealth: MapHealth
  readonly mapRef: RefObject<maplibregl.Map | null>
  readonly handleBasemapChange: (nextBasemapId: BasemapId) => void
}

/**
 * Owns the MapLibre instance lifecycle, basemap/style switching, hover state,
 * and health reporting.
 */
export function useMapInstance(): MapInstanceController {
  const initialBasemapId = readStoredBasemap()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const previousBasemapIdRef = useRef<BasemapId | null>(null)
  const activeBasemapIdRef = useRef<BasemapId>(initialBasemapId)
  const [activeBasemapId, setActiveBasemapId] = useState<BasemapId>(initialBasemapId)
  const [hoverCoordinate, setHoverCoordinate] = useState<HoverCoordinate>(EMPTY_HOVER_COORDINATE)
  const [mapHealth, setMapHealth] = useState<MapHealth>(() =>
    createLoadingMapHealth(getBasemapById(initialBasemapId).label),
  )
  const style = useMemo(() => createRasterStyle(activeBasemapId), [activeBasemapId])

  useEffect(() => {
    persistBasemapPreference(activeBasemapId)
  }, [activeBasemapId])

  function handleBasemapChange(nextBasemapId: BasemapId) {
    activeBasemapIdRef.current = nextBasemapId
    setMapHealth(createLoadingMapHealth(getBasemapById(nextBasemapId).label))
    setActiveBasemapId(nextBasemapId)
  }

  useEffect(() => {
    if (containerRef.current === null || mapRef.current !== null) {
      return
    }

    const map = new maplibregl.Map({
      container: containerRef.current,
      style,
      center: [...MAP_CENTER],
      zoom: MAP_DEFAULT_ZOOM,
      maxBounds: KERRY_MAX_BOUNDS,
    })

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right')
    map.on('load', () => {
      const center = map.getCenter()
      setHoverCoordinate({
        latitude: center.lat,
        longitude: center.lng,
      })
    })
    map.on('idle', () => {
      setMapHealth((current) => {
        if (current.status === 'degraded') {
          return current
        }

        return createReadyMapHealth(getBasemapById(activeBasemapIdRef.current).label)
      })
    })
    map.on('error', () => {
      setMapHealth(
        createDegradedMapHealth(getBasemapById(activeBasemapIdRef.current).label),
      )
    })
    map.on('webglcontextlost', () => {
      setMapHealth(
        createDegradedMapHealth(
          getBasemapById(activeBasemapIdRef.current).label,
          'WebGL context lost',
        ),
      )
    })
    map.on('webglcontextrestored', () => {
      setMapHealth(createLoadingMapHealth(getBasemapById(activeBasemapIdRef.current).label))
    })
    map.on('mousemove', (event) => {
      setHoverCoordinate({
        latitude: event.lngLat.lat,
        longitude: event.lngLat.lng,
      })
    })
    map.on('mouseleave', () => {
      setHoverCoordinate(EMPTY_HOVER_COORDINATE)
    })

    mapRef.current = map
    previousBasemapIdRef.current = activeBasemapId

    return () => {
      map.remove()
      mapRef.current = null
      previousBasemapIdRef.current = null
    }
  }, [activeBasemapId, style])

  useEffect(() => {
    const map = mapRef.current

    if (map === null || previousBasemapIdRef.current === activeBasemapId) {
      return
    }

    map.setStyle(style)
    previousBasemapIdRef.current = activeBasemapId
  }, [activeBasemapId, style])

  return {
    activeBasemapId,
    containerRef,
    hoverCoordinate,
    mapHealth,
    mapRef,
    handleBasemapChange,
  }
}
