import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import maplibregl from 'maplibre-gl'

import {
  MAP_CENTER,
  MAP_DEFAULT_ZOOM,
  getRenderableMapLabel,
  type RenderableMapId,
} from '../../lib/map-config'
import {
  createDegradedMapHealth,
  createLoadingMapHealth,
  createReadyMapHealth,
  type MapHealth,
} from '../../lib/map-health'
import { createTileHealthTracker } from '../../lib/tile-health-tracker'
import { persistBasemapPreference, readStoredBasemap } from '../../lib/map-preferences'
import { createRasterStyle, IRELAND_MAX_BOUNDS } from './map-style'
import { applyMapStylePreservingCamera } from './apply-map-style-preserving-camera'
import { isTileErrorEvent } from './is-tile-error-event'
import { registerOfficialMapProtocol } from './official-map-protocol'
import { recordDiagnosticEvent } from '../diagnostics/diagnostic-event-log'

export type HoverCoordinate = {
  readonly latitude: number | null
  readonly longitude: number | null
}

const EMPTY_HOVER_COORDINATE: HoverCoordinate = {
  latitude: null,
  longitude: null,
}

export type MapInstanceController = {
  readonly activeBasemapId: RenderableMapId
  readonly containerRef: RefObject<HTMLDivElement | null>
  readonly hoverCoordinate: HoverCoordinate
  readonly mapHealth: MapHealth
  readonly mapRef: RefObject<maplibregl.Map | null>
  readonly mapReadyVersion: number
  readonly handleBasemapChange: (nextBasemapId: RenderableMapId) => void
}

/**
 * Owns the MapLibre instance lifecycle, basemap/style switching, hover state,
 * and health reporting.
 */
export function useMapInstance(): MapInstanceController {
  const initialBasemapId = readStoredBasemap()
  const initialBasemapIdRef = useRef(initialBasemapId)
  const initialStyleRef = useRef(createRasterStyle(initialBasemapId))
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const previousBasemapIdRef = useRef<RenderableMapId | null>(null)
  const activeBasemapIdRef = useRef<RenderableMapId>(initialBasemapId)
  const lastLoggedMapHealthRef = useRef<string | null>(null)
  const tileHealthTrackerRef = useRef(createTileHealthTracker())
  const hoverCoordinateFrameRef = useRef<number | null>(null)
  const pendingHoverCoordinateRef = useRef<HoverCoordinate>(EMPTY_HOVER_COORDINATE)
  const [activeBasemapId, setActiveBasemapId] = useState<RenderableMapId>(initialBasemapId)
  const [mapReadyVersion, setMapReadyVersion] = useState(0)
  const [hoverCoordinate, setHoverCoordinate] = useState<HoverCoordinate>(EMPTY_HOVER_COORDINATE)
  const [mapHealth, setMapHealth] = useState<MapHealth>(() =>
    createLoadingMapHealth(getRenderableMapLabel(initialBasemapId)),
  )
  const style = useMemo(() => createRasterStyle(activeBasemapId), [activeBasemapId])

  useEffect(() => registerOfficialMapProtocol(maplibregl), [])

  useEffect(() => {
    persistBasemapPreference(activeBasemapId)
  }, [activeBasemapId])

  function handleBasemapChange(nextBasemapId: RenderableMapId) {
    const previousBasemapId = activeBasemapIdRef.current
    activeBasemapIdRef.current = nextBasemapId
    tileHealthTrackerRef.current.reset()
    setMapHealth(createLoadingMapHealth(getRenderableMapLabel(nextBasemapId)))
    setActiveBasemapId(nextBasemapId)
    void recordDiagnosticEvent({
      level: 'info',
      category: 'map',
      event: 'basemap_changed',
      fields: {
        previousBasemapId,
        nextBasemapId,
        screenWidth: typeof window === 'undefined' ? null : window.innerWidth,
        screenHeight: typeof window === 'undefined' ? null : window.innerHeight,
        devicePixelRatio: typeof window === 'undefined' ? null : window.devicePixelRatio,
      },
    })
  }

  useEffect(() => {
    const signature = `${activeBasemapId}:${mapHealth.status}:${mapHealth.message}`
    if (lastLoggedMapHealthRef.current === signature) {
      return
    }
    lastLoggedMapHealthRef.current = signature
    void recordDiagnosticEvent({
      level: mapHealth.status === 'degraded' ? 'warn' : 'info',
      category: 'map',
      event: 'map_health_changed',
      fields: {
        basemapId: activeBasemapId,
        status: mapHealth.status,
        message: mapHealth.message,
      },
    })
  }, [activeBasemapId, mapHealth])

  useEffect(() => {
    if (containerRef.current === null || mapRef.current !== null) {
      return
    }

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: initialStyleRef.current,
      center: [...MAP_CENTER],
      zoom: MAP_DEFAULT_ZOOM,
      maxBounds: IRELAND_MAX_BOUNDS,
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
      const tracker = tileHealthTrackerRef.current
      setMapHealth((current) => {
        if (current.status === 'degraded') {
          if (tracker.shouldRecover(Date.now())) {
            tracker.reset()
            return createReadyMapHealth(getRenderableMapLabel(activeBasemapIdRef.current))
          }
          return current
        }
        tracker.reset()
        return createReadyMapHealth(getRenderableMapLabel(activeBasemapIdRef.current))
      })
    })
    map.on('error', (event) => {
      // Only count tile-level failures against the operator-facing trust
      // signal. Maplibre also raises `error` for style errors, image-source
      // errors, etc. — counting those caused the false-positive "tiles
      // failed to load" badge tracked in sartracker-web-2xp.
      if (!isTileErrorEvent(event)) {
        return
      }
      const decision = tileHealthTrackerRef.current.recordError(Date.now())
      if (decision === 'degrade') {
        setMapHealth(
          createDegradedMapHealth(getRenderableMapLabel(activeBasemapIdRef.current)),
        )
      }
    })
    map.on('webglcontextlost', () => {
      setMapHealth(
        createDegradedMapHealth(
          getRenderableMapLabel(activeBasemapIdRef.current),
          'WebGL context lost',
        ),
      )
    })
    map.on('webglcontextrestored', () => {
      setMapHealth(createLoadingMapHealth(getRenderableMapLabel(activeBasemapIdRef.current)))
    })
    const publishPendingHoverCoordinate = () => {
      hoverCoordinateFrameRef.current = null
      setHoverCoordinate(pendingHoverCoordinateRef.current)
    }
    const scheduleHoverCoordinate = (coordinate: HoverCoordinate) => {
      pendingHoverCoordinateRef.current = coordinate
      if (hoverCoordinateFrameRef.current !== null) {
        return
      }
      hoverCoordinateFrameRef.current = window.requestAnimationFrame(publishPendingHoverCoordinate)
    }
    map.on('mousemove', (event) => {
      scheduleHoverCoordinate({
        latitude: event.lngLat.lat,
        longitude: event.lngLat.lng,
      })
    })
    map.on('mouseleave', () => {
      scheduleHoverCoordinate(EMPTY_HOVER_COORDINATE)
    })

    mapRef.current = map
    window.setTimeout(() => {
      setMapReadyVersion((version) => version + 1)
    }, 0)
    if (typeof window !== 'undefined') {
      ;(window as Window & { __SARTRACKER_MAP__?: maplibregl.Map }).__SARTRACKER_MAP__ = map
    }
    previousBasemapIdRef.current = initialBasemapIdRef.current

    return () => {
      if (hoverCoordinateFrameRef.current !== null) {
        window.cancelAnimationFrame(hoverCoordinateFrameRef.current)
        hoverCoordinateFrameRef.current = null
      }
      map.remove()
      if (typeof window !== 'undefined') {
        delete (window as Window & { __SARTRACKER_MAP__?: maplibregl.Map }).__SARTRACKER_MAP__
      }
      mapRef.current = null
      previousBasemapIdRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current

    if (map === null || previousBasemapIdRef.current === activeBasemapId) {
      return
    }

    applyMapStylePreservingCamera(map, style)
    previousBasemapIdRef.current = activeBasemapId
  }, [activeBasemapId, style])

  return {
    activeBasemapId,
    containerRef,
    hoverCoordinate,
    mapHealth,
    mapRef,
    mapReadyVersion,
    handleBasemapChange,
  }
}
