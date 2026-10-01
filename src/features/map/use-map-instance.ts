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
import {
  persistBasemapPreference,
  readStoredBasemap,
  readStoredMapPreference,
} from '../../lib/map-preferences'
import { loadAppSettings } from '../../infrastructure/settings-store/tauri-settings-store'
import { resolveStartupMapRestore } from './startup-map-restore'
import { createRasterStyle, IRELAND_MAX_BOUNDS } from './map-style'
import { applyMapStylePreservingCamera } from './apply-map-style-preserving-camera'
import { isTileErrorEvent } from './is-tile-error-event'
import { registerOfficialMapProtocol } from './official-map-protocol'
import { registerCoverageTileProtocol } from '../tracking/coverage-tile-protocol'
import { useCoverageStore } from '../tracking/coverage-store'
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
  /** Why a stored official map could not be restored at startup, until the operator picks a map. */
  readonly startupMapNotice: string | null
  /** Why the map renderer could not start (for example WebGL unavailable); null when it started. */
  readonly rendererFailure: string | null
  readonly handleBasemapChange: (nextBasemapId: RenderableMapId) => void
}

/**
 * Owns the MapLibre instance lifecycle, basemap/style switching, hover state,
 * and health reporting.
 */
export function useMapInstance(): MapInstanceController {
  const initialBasemapId = readStoredBasemap()
  const storedMapPreferenceRef = useRef(readStoredMapPreference())
  const operatorChoseMapRef = useRef(false)
  const initialBasemapIdRef = useRef(initialBasemapId)
  const initialStyleRef = useRef(createRasterStyle(initialBasemapId))
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const previousBasemapIdRef = useRef<RenderableMapId | null>(null)
  const previousStyleRetryVersionRef = useRef(0)
  const activeBasemapIdRef = useRef<RenderableMapId>(initialBasemapId)
  const lastLoggedMapHealthRef = useRef<string | null>(null)
  const tileHealthTrackerRef = useRef(createTileHealthTracker())
  const styleFailureRef = useRef<string | null>(null)
  const hoverCoordinateFrameRef = useRef<number | null>(null)
  const pendingHoverCoordinateRef = useRef<HoverCoordinate>(EMPTY_HOVER_COORDINATE)
  const [activeBasemapId, setActiveBasemapId] = useState<RenderableMapId>(initialBasemapId)
  const [mapReadyVersion, setMapReadyVersion] = useState(0)
  const [styleRetryVersion, setStyleRetryVersion] = useState(0)
  const [hoverCoordinate, setHoverCoordinate] = useState<HoverCoordinate>(EMPTY_HOVER_COORDINATE)
  const [startupMapNotice, setStartupMapNotice] = useState<string | null>(null)
  const [rendererFailure, setRendererFailure] = useState<string | null>(null)
  const [mapHealth, setMapHealth] = useState<MapHealth>(() =>
    createLoadingMapHealth(getRenderableMapLabel(initialBasemapId)),
  )
  const style = useMemo(() => createRasterStyle(activeBasemapId), [activeBasemapId])

  useEffect(() => registerOfficialMapProtocol(maplibregl), [])
  useEffect(() => registerCoverageTileProtocol(maplibregl, (failure) => {
    useCoverageStore.getState().controller?.notifyRendererFailure(failure)
  }), [])

  /** Applies an operator's map choice; it always wins over startup restore. */
  function handleBasemapChange(nextBasemapId: RenderableMapId) {
    operatorChoseMapRef.current = true
    setStartupMapNotice(null)
    applyBasemap(nextBasemapId)
  }

  function applyBasemap(nextBasemapId: RenderableMapId) {
    persistBasemapPreference(nextBasemapId)
    const previousBasemapId = activeBasemapIdRef.current
    if (nextBasemapId === previousBasemapId) {
      if (styleFailureRef.current === null) return
      setStyleRetryVersion((version) => version + 1)
    }
    activeBasemapIdRef.current = nextBasemapId
    tileHealthTrackerRef.current.reset()
    styleFailureRef.current = null
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

  // An official map starts on the online default until its package is
  // verified, then is restored; a stored choice is never silently dropped.
  // Only real map changes are persisted, so the startup default never
  // overwrites the stored choice [DON-304].
  useEffect(() => {
    const storedMapId = storedMapPreferenceRef.current
    if (storedMapId === null || storedMapId === initialBasemapIdRef.current) return
    let cancelled = false
    void loadAppSettings()
      .then((settings) => settings.officialMaps, () => null)
      .then((officialMaps) => {
        if (cancelled || operatorChoseMapRef.current) return
        const restore = resolveStartupMapRestore({ storedMapId, officialMaps })
        if (restore.kind === 'restore') {
          applyBasemap(restore.mapId)
        } else if (restore.kind === 'unavailable') {
          setStartupMapNotice(restore.message)
        }
        if (restore.kind !== 'none') {
          void recordDiagnosticEvent({
            level: restore.kind === 'restore' ? 'info' : 'warn',
            category: 'map',
            event: restore.kind === 'restore' ? 'stored_map_restored' : 'stored_map_unavailable',
            fields: { mapId: restore.mapId },
          })
        }
      })
    return () => {
      cancelled = true
    }
    // Runs once per map instance: startup restore only.
  }, [])

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

    let map: maplibregl.Map
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style: initialStyleRef.current,
        center: [...MAP_CENTER],
        zoom: MAP_DEFAULT_ZOOM,
        maxBounds: IRELAND_MAX_BOUNDS,
      })
    } catch (error) {
      // MapLibre throws here when WebGL is unavailable or the GPU is
      // blocklisted. Uncaught, it would unmount the whole shell [DON-288].
      const reason = error instanceof Error ? error.message : String(error)
      // Reported from a task, like other renderer events, not during the effect body.
      queueMicrotask(() => setRendererFailure(reason))
      void recordDiagnosticEvent({
        level: 'error',
        category: 'map',
        event: 'map_renderer_unavailable',
        fields: { reason: reason.slice(0, 500) },
      })
      return
    }

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right')
    map.on('load', () => {
      const center = map.getCenter()
      setHoverCoordinate({
        latitude: center.lat,
        longitude: center.lng,
      })
    })
    map.on('idle', () => {
      if (styleFailureRef.current !== null) return
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

    if (map === null || (previousBasemapIdRef.current === activeBasemapId &&
        previousStyleRetryVersionRef.current === styleRetryVersion)) {
      return
    }

    previousBasemapIdRef.current = activeBasemapId
    previousStyleRetryVersionRef.current = styleRetryVersion
    return applyMapStylePreservingCamera(map, style, {
      onFailure: (message) => {
        styleFailureRef.current = message
        setMapHealth(createDegradedMapHealth(getRenderableMapLabel(activeBasemapId), message))
      },
      onUnchanged: () => {
        setMapHealth(createReadyMapHealth(getRenderableMapLabel(activeBasemapId)))
      },
    })
  }, [activeBasemapId, style, styleRetryVersion])

  return {
    activeBasemapId,
    containerRef,
    hoverCoordinate,
    mapHealth,
    mapRef,
    mapReadyVersion,
    startupMapNotice,
    rendererFailure,
    handleBasemapChange,
  }
}
