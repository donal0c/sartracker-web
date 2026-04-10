import type { Map as MapLibreMap, StyleSpecification } from 'maplibre-gl'

type CameraSnapshot = {
  readonly center: [number, number]
  readonly zoom: number
  readonly bearing: number
  readonly pitch: number
}

/**
 * Preserves the live operator view while swapping raster basemap styles.
 * Some style transitions can transiently reset the camera, so we restore the
 * exact camera state as soon as the new style data is ready.
 */
export function applyMapStylePreservingCamera(
  map: Pick<
    MapLibreMap,
    'getCenter' | 'getZoom' | 'getBearing' | 'getPitch' | 'setStyle' | 'once' | 'jumpTo'
  >,
  style: StyleSpecification,
): void {
  const snapshot = captureCameraSnapshot(map)
  map.setStyle(style)
  map.jumpTo(snapshot)
  map.once('idle', () => {
    map.jumpTo(snapshot)
  })
}

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
