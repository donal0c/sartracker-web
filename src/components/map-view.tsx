import 'maplibre-gl/dist/maplibre-gl.css'

import { useEffect, useMemo, useRef, useState } from 'react'
import maplibregl, { type LngLatBoundsLike, type StyleSpecification } from 'maplibre-gl'

import { CoordinateBar } from './coordinate-bar'
import { BasemapSwitcher } from './basemap-switcher'
import { MapStatusBadge } from './map-status-badge'
import {
  MAP_CENTER,
  MAP_DEFAULT_ZOOM,
  getBasemapById,
  type BasemapId,
} from '../lib/map-config'
import {
  createDegradedMapHealth,
  createLoadingMapHealth,
  createReadyMapHealth,
  type MapHealth,
} from '../lib/map-health'
import { persistBasemapPreference, readStoredBasemap } from '../lib/map-preferences'

const KERRY_MAX_BOUNDS: LngLatBoundsLike = [
  [-10.7, 51.55],
  [-9.1, 52.6],
]

function createRasterStyle(basemapId: BasemapId): StyleSpecification {
  const basemap = getBasemapById(basemapId)

  return {
    version: 8,
    sources: {
      [basemap.id]: {
        type: 'raster',
        tiles: [...basemap.tiles],
        tileSize: basemap.tileSize,
        attribution: basemap.attribution,
        maxzoom: basemap.maxZoom,
      },
    },
    layers: [
      {
        id: `${basemap.id}-layer`,
        type: 'raster',
        source: basemap.id,
      },
    ],
  }
}

export function MapView() {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const previousBasemapIdRef = useRef<BasemapId | null>(null)
  const activeBasemapIdRef = useRef<BasemapId>(readStoredBasemap())
  const [activeBasemapId, setActiveBasemapId] = useState<BasemapId>(() => readStoredBasemap())
  const [hoverCoordinate, setHoverCoordinate] = useState<{
    readonly latitude: number | null
    readonly longitude: number | null
  }>({
    latitude: null,
    longitude: null,
  })
  const [mapHealth, setMapHealth] = useState<MapHealth>(() =>
    createLoadingMapHealth(getBasemapById(activeBasemapId).label),
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
      setHoverCoordinate({
        latitude: null,
        longitude: null,
      })
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

  return (
    <div className="relative min-h-[560px] overflow-hidden rounded-2xl border border-stone-700 bg-stone-950">
      <BasemapSwitcher
        activeBasemapId={activeBasemapId}
        onBasemapChange={handleBasemapChange}
      />
      <div className="absolute inset-0" data-testid="map-container" ref={containerRef} />
      <div className="pointer-events-none absolute right-4 top-4 z-10 flex flex-col items-end gap-2">
        <MapStatusBadge health={mapHealth} />
        <div className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-xs text-emerald-100">
          Cached tiles available offline after viewing
        </div>
      </div>
      <CoordinateBar
        latitude={hoverCoordinate.latitude}
        longitude={hoverCoordinate.longitude}
      />
    </div>
  )
}
