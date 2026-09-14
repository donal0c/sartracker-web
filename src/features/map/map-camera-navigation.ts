import type { Map as MapLibreMap } from 'maplibre-gl'

export type MapCameraSnapshot = {
  readonly center: [number, number]
  readonly zoom: number
  readonly bearing: number
  readonly pitch: number
}

type CameraMap = Pick<MapLibreMap, 'getCenter' | 'getZoom' | 'getBearing' | 'getPitch'>
type NavigationMap = CameraMap & Pick<MapLibreMap, 'flyTo' | 'jumpTo' | 'on' | 'off'>
type NavigationIntent = {
  readonly camera: MapCameraSnapshot
  readonly isCurrent: () => boolean
}
const navigationIntents = new WeakMap<object, NavigationIntent>()
const NAVIGATION_EVENT = { coordinateNavigation: true }

/** Captures the complete current view when there is no pending navigation destination. */
export function captureMapCamera(map: CameraMap): MapCameraSnapshot {
  const center = map.getCenter()
  return { center: [center.lng, center.lat], zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() }
}

/** Reads only a live navigation destination, never an expired or superseded request. */
export function getMapNavigationCamera(map: object): MapCameraSnapshot | undefined {
  const intent = navigationIntents.get(map)
  return intent?.isCurrent() ? intent.camera : undefined
}

/** Keeps style changes on the requested destination until expiry or an operator gesture. */
export function navigateMapToTarget(
  map: NavigationMap,
  center: [number, number],
  isCurrent: () => boolean,
): () => void {
  const intent = { camera: { ...captureMapCamera(map), center, zoom: Math.max(map.getZoom(), 14) }, isCurrent }
  navigationIntents.set(map, intent)
  const release = () => {
    if (navigationIntents.get(map) === intent) navigationIntents.delete(map)
    map.off('movestart', onMoveStart)
    map.off('style.load', onStyleLoad)
    map.off('remove', release)
  }
  const onMoveStart = (event: { originalEvent?: unknown }) => {
    if (event.originalEvent !== undefined) release()
  }
  const onStyleLoad = () => {
    if (navigationIntents.get(map) === intent && isCurrent()) {
      map.jumpTo(intent.camera, NAVIGATION_EVENT)
    }
  }
  map.on('movestart', onMoveStart)
  map.on('style.load', onStyleLoad)
  map.on('remove', release)
  map.flyTo({ center, zoom: intent.camera.zoom, essential: true }, NAVIGATION_EVENT)
  return release
}

/** Applies a style restoration without mistaking it for an operator camera action. */
export function restoreMapCamera(map: Pick<MapLibreMap, 'jumpTo'>, camera: MapCameraSnapshot): void {
  map.jumpTo(camera, NAVIGATION_EVENT)
}
