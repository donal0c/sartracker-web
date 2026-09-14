import type { Map as MapLibreMap, StyleSpecification } from 'maplibre-gl'

type CameraSnapshot = {
  readonly center: [number, number]
  readonly zoom: number
  readonly bearing: number
  readonly pitch: number
}

type CameraPreservingMap = Pick<
  MapLibreMap,
  'getCenter' | 'getZoom' | 'getBearing' | 'getPitch' | 'setStyle' | 'once' | 'jumpTo'
>

const pendingCameraRestoreTokens = new WeakMap<object, symbol>()

/**
 * Preserves the live operator view while swapping raster basemap styles.
 * Some style transitions can transiently reset the camera, so we restore the
 * exact camera state as soon as the new style data is ready.
 */
export function applyMapStylePreservingCamera(
  map: CameraPreservingMap,
  style: StyleSpecification,
): void {
  const snapshot = captureCameraSnapshot(map)
  const mapKey = map as object
  const token = Symbol('map-style-camera-restore')
  pendingCameraRestoreTokens.set(mapKey, token)

  try {
    map.setStyle(style)
    map.once('styledata', () => {
      if (pendingCameraRestoreTokens.get(mapKey) !== token) {
        return
      }

      pendingCameraRestoreTokens.delete(mapKey)
      map.jumpTo(snapshot)
    })
  } catch (error) {
    if (pendingCameraRestoreTokens.get(mapKey) === token) {
      pendingCameraRestoreTokens.delete(mapKey)
    }
    throw error
  }
}

/** Prevents a pending style callback from restoring an outdated camera. */
export function cancelPendingMapStyleCameraRestore(map: CameraPreservingMap): void {
  pendingCameraRestoreTokens.delete(map as object)
}

/** Captures the operator's complete camera state before a style replacement. */
function captureCameraSnapshot(
  map: Pick<MapLibreMap, 'getCenter' | 'getZoom' | 'getBearing' | 'getPitch'>,
): CameraSnapshot {
  const center = map.getCenter()

  return {
    center: [center.lng, center.lat],
    zoom: map.getZoom(),
    bearing: map.getBearing(),
    pitch: map.getPitch(),
  }
}
