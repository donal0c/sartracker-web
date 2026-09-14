import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type maplibregl from 'maplibre-gl'
import { isOfficialMapId, type RenderableMapId } from '../../lib/map-config'
import { createCheckingOfflineMapCoverage, createUncheckedOfflineMapCoverage,
  createUnavailableOfflineMapCoverage, type OfflineMapCoverage } from './offline-map-coverage'
import { officialMapViewKey, readOfficialMapViewRequest, type OfficialMapViewQualification } from './official-map-view-qualification'
import { refreshOfficialMapRaster, type OfficialMapRasterRecovery } from './official-map-raster-refresh'

type State = {
  readonly mapId: RenderableMapId
  readonly qualification: OfficialMapViewQualification | null
  readonly coverage: OfflineMapCoverage
}

/** Keeps a native tile check bound to one unchanged view and package generation. */
export function useOfficialMapViewQualification(activeMapId: RenderableMapId, mapRef: RefObject<maplibregl.Map | null>) {
  const generation = useRef(0)
  const tileFailureSequence = useRef(0)
  const retryRasterForCheck = useRef<(() => boolean) | null>(null)
  const [state, setState] = useState<State>(() => ({mapId: activeMapId, qualification: null,
    coverage: createUncheckedOfflineMapCoverage()}))
  const stateRef = useRef(state)
  /** Publishes a qualification state and keeps event handlers on the current result. */
  const publishState = useCallback((next: State) => {
    stateRef.current = next
    setState(next)
  }, [])
  /** Invalidates a qualification after a view, source, or package identity change. */
  const invalidate = useCallback(() => {
    generation.current += 1
    publishState({mapId: activeMapId, qualification: null, coverage: createUncheckedOfflineMapCoverage()})
  }, [activeMapId, publishState])
  /** Preserves a published negative result only for a redundant tile failure in the same view. */
  const invalidateOnTileFailure = useCallback(() => {
    tileFailureSequence.current += 1
    const current = stateRef.current
    const status = current.coverage.status
    // A negative native result still explains this unchanged view. A positive
    // result is separately rejected if a rendering failure occurred in flight.
    if (current.mapId === activeMapId && status === 'checking') return
    const preservePublishedNegative = current.mapId === activeMapId &&
      current.qualification === null &&
      (status === 'missing' || status === 'partial' || status === 'error' || status === 'unavailable')
    if (preservePublishedNegative) return
    invalidate()
  }, [activeMapId, invalidate])

  useEffect(() => {
    const map = mapRef.current
    let refreshPending = false
    let failedAttempts = 0
    let revision = Date.now()
    const recovery: OfficialMapRasterRecovery = { pending: false }
    /** Retries only the invalidated raster when its style becomes available. */
    function refreshRaster(): void {
      if (!refreshPending || failedAttempts >= 3 || map === null || !isOfficialMapId(activeMapId)) return
      refreshPending = false
      try { refreshPending = !refreshOfficialMapRaster(map, activeMapId, revision, recovery) }
      catch {
        failedAttempts += 1
        refreshPending = true
        publishState({mapId: activeMapId, qualification: null,
          coverage: createUnavailableOfflineMapCoverage('Offline map changed but could not be refreshed. Switch maps before relying on it.')})
      }
    }
    /** Withdraws readiness and removes resident raster tiles after native file changes. */
    function packagesChanged(): void {
      invalidate()
      window.dispatchEvent(new Event('sartracker:settings-updated'))
      revision += 1
      failedAttempts = 0
      refreshPending = true
      refreshRaster()
    }
    retryRasterForCheck.current = () => {
      failedAttempts = 0
      refreshRaster()
      return !refreshPending
    }
    map?.on('movestart', invalidate)
    map?.on('styledata', refreshRaster)
    window.addEventListener('sartracker:settings-updated', invalidate)
    window.addEventListener('sartracker:official-map-tile-failed', invalidateOnTileFailure)
    window.addEventListener('focus', invalidate)
    const unsubscribe = window.sartrackerElectron?.onOfficialMapPackagesChanged?.(packagesChanged)
    return () => {
      retryRasterForCheck.current = null
      generation.current += 1
      map?.off('movestart', invalidate)
      map?.off('styledata', refreshRaster)
      window.removeEventListener('sartracker:settings-updated', invalidate)
      window.removeEventListener('sartracker:official-map-tile-failed', invalidateOnTileFailure)
      window.removeEventListener('focus', invalidate)
      unsubscribe?.()
    }
  }, [activeMapId, invalidate, invalidateOnTileFailure, mapRef, publishState])

  const check = useCallback(async (): Promise<void> => {
    const map = mapRef.current
    if (!isOfficialMapId(activeMapId) || map === null) return
    const requestGeneration = ++generation.current
    const requestTileFailureSequence = tileFailureSequence.current
    publishState({mapId: activeMapId, qualification: null, coverage: createCheckingOfflineMapCoverage()})
    try {
      if (retryRasterForCheck.current?.() === false) {
        throw new Error('Offline map could not be refreshed. Switch maps before relying on it.')
      }
      const request = readOfficialMapViewRequest(activeMapId, map)
      const nativeCheck = window.sartrackerElectron?.checkOfficialMapView
      if (nativeCheck === undefined) throw new Error('Official offline tile checks require the Electron app.')
      const result = await nativeCheck(request)
      if (requestGeneration !== generation.current ||
          officialMapViewKey(request) !== officialMapViewKey(readOfficialMapViewRequest(activeMapId, map))) return
      if (officialMapViewKey(result) !== officialMapViewKey(request)) throw new Error('Offline map check returned a different view. Check View again.')
      const complete = result.status === 'complete' && result.totalTiles > 0 && result.usableTiles === result.totalTiles
      if (complete && requestTileFailureSequence !== tileFailureSequence.current) {
        invalidate()
        return
      }
      publishState({mapId: activeMapId, qualification: complete ? result : null, coverage: {
        status: complete ? 'complete' : result.status === 'partial' ? 'partial' : result.status === 'error' ? 'error' : 'missing',
        tone: complete ? 'success' : 'danger',
        label: complete ? 'Current view tiles verified' : 'Official offline coverage incomplete',
        detail: `${result.usableTiles}/${result.totalTiles} local tiles at tile z${result.zoom}. ${result.message}`,
        cachedTiles: result.usableTiles, totalTiles: result.totalTiles, zoom: result.zoom,
      }})
    } catch (error) {
      if (requestGeneration !== generation.current) return
      publishState({mapId: activeMapId, qualification: null, coverage: createUnavailableOfflineMapCoverage(
        error instanceof Error ? error.message : 'Offline map check failed. Keep an alternative map available.')})
    }
  }, [activeMapId, invalidate, mapRef, publishState])

  return {check,
    qualification: state.mapId === activeMapId ? state.qualification : null,
    coverage: state.mapId === activeMapId ? state.coverage : createUncheckedOfflineMapCoverage(),
  }
}
