import 'maplibre-gl/dist/maplibre-gl.css'

import { useEffect, useMemo, useRef, useState } from 'react'
import maplibregl, { type LngLatBoundsLike, type StyleSpecification } from 'maplibre-gl'

import { CoordinateBar } from './coordinate-bar'
import { BasemapSwitcher } from './basemap-switcher'
import {
  DEFAULT_BASEMAP_ID,
  getBasemapById,
  MAP_CENTER,
  MAP_DEFAULT_ZOOM,
  type BasemapId,
} from '../lib/map-config'

const BASEMAP_STORAGE_KEY = 'sartracker.map.basemap'
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

function readStoredBasemap(): BasemapId {
  const candidate = window.localStorage.getItem(BASEMAP_STORAGE_KEY)

  if (candidate === null) {
    return DEFAULT_BASEMAP_ID
  }

  try {
    return getBasemapById(candidate as BasemapId).id
  } catch {
    return DEFAULT_BASEMAP_ID
  }
}

export function MapView() {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const [activeBasemapId, setActiveBasemapId] = useState<BasemapId>(() => {
    if (typeof window === 'undefined') {
      return DEFAULT_BASEMAP_ID
    }

    return readStoredBasemap()
  })
  const [hoverCoordinate, setHoverCoordinate] = useState<{
    readonly latitude: number | null
    readonly longitude: number | null
  }>({
    latitude: null,
    longitude: null,
  })
  const style = useMemo(() => createRasterStyle(activeBasemapId), [activeBasemapId])

  useEffect(() => {
    window.localStorage.setItem(BASEMAP_STORAGE_KEY, activeBasemapId)
  }, [activeBasemapId])

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

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [style])

  useEffect(() => {
    const map = mapRef.current

    if (map === null) {
      return
    }

    map.setStyle(style)
  }, [style])

  return (
    <div className="relative min-h-[560px] overflow-hidden rounded-2xl border border-stone-700 bg-stone-950">
      <BasemapSwitcher
        activeBasemapId={activeBasemapId}
        onBasemapChange={setActiveBasemapId}
      />
      <div className="absolute inset-0" data-testid="map-container" ref={containerRef} />
      <div className="pointer-events-none absolute right-4 top-4 z-10 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-xs text-emerald-100">
        Cached tiles available offline after viewing
      </div>
      <CoordinateBar
        latitude={hoverCoordinate.latitude}
        longitude={hoverCoordinate.longitude}
      />
    </div>
  )
}
