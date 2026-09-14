import type { Map as MapLibreMap, StyleSpecification } from 'maplibre-gl'
import { captureMapCamera, getMapNavigationCamera, restoreMapCamera } from './map-camera-navigation'
import { isTileErrorEvent } from './is-tile-error-event'
import { mapLibreDeepEqual } from './map-style-writes'

type CameraPreservingMap = Pick<
  MapLibreMap,
  'getCenter' | 'getZoom' | 'getBearing' | 'getPitch' | 'getStyle' | 'setStyle' | 'on' | 'off' | 'jumpTo'
>
const pendingRestorations = new WeakMap<object, () => void>()
const STYLE_COMPLETION_TIMEOUT_MS = 30_000
type StyleApplicationObservers = {
  readonly onFailure?: (message: string) => void
  readonly onUnchanged?: () => void
}

/** Restores the latest intended camera at style.load, with bounded failure and teardown cleanup. */
export function applyMapStylePreservingCamera(
  map: CameraPreservingMap,
  style: StyleSpecification,
  observers: StyleApplicationObservers = {},
): () => void {
  pendingRestorations.get(map)?.()
  // MapLibre emits no completion event when the requested style is already current.
  if (mapLibreDeepEqual(map.getStyle(), style)) {
    observers.onUnchanged?.()
    return () => undefined
  }
  const snapshot = captureMapCamera(map)
  let cameraChanged = getMapNavigationCamera(map) !== undefined
  let disposed = false
  const dispose = () => {
    if (disposed) return
    disposed = true
    clearTimeout(timeout)
    map.off('style.load', complete)
    map.off('error', fail)
    map.off('remove', dispose)
    map.off('movestart', cameraMoved)
    if (pendingRestorations.get(map) === dispose) pendingRestorations.delete(map)
  }
  const complete = () => {
    if (disposed) return
    dispose()
    restoreMapCamera(map, getMapNavigationCamera(map) ?? (cameraChanged ? captureMapCamera(map) : snapshot))
  }
  const reportFailure = () => {
    if (disposed) return
    dispose()
    restoreMapCamera(map, getMapNavigationCamera(map) ?? (cameraChanged ? captureMapCamera(map) : snapshot))
    const message = 'Basemap style could not be applied. Choose another basemap.'
    console.error(message)
    observers.onFailure?.(message)
  }
  const fail = (event: unknown) => {
    // Tile availability has its own health policy; it does not mean style loading failed.
    if (!isTileErrorEvent(event)) reportFailure()
  }
  const cameraMoved = () => { cameraChanged = true }
  const timeout = setTimeout(reportFailure, STYLE_COMPLETION_TIMEOUT_MS)
  pendingRestorations.set(map, dispose)
  map.on('style.load', complete)
  map.on('error', fail)
  map.on('remove', dispose)
  map.on('movestart', cameraMoved)
  try {
    // Inline style diffs can fire style.load synchronously, so listeners precede this call.
    map.setStyle(style)
  } catch {
    reportFailure()
  }
  return dispose
}
