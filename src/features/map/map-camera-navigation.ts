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

/**
 * The camera centre that puts `target` `screenOffsetX` pixels right of the
 * map's middle at `zoom` and `bearing`. A window docked over the left of the
 * map uses it so the target lands in the part of the map still visible
 * (DON-368). The destination is computed rather than passed to MapLibre as an
 * offset, so a style change mid-flight restores the same shifted view.
 *
 * @param target [longitude, latitude] to show
 * @param zoom destination zoom
 * @param bearing map bearing in degrees
 * @param screenOffsetX pixels right of centre the target should appear; 0 centres it
 * @returns [longitude, latitude] for the camera centre
 */
export function centerForScreenOffset(
  target: [number, number],
  zoom: number,
  bearing: number,
  screenOffsetX: number,
): [number, number] {
  if (!Number.isFinite(screenOffsetX) || screenOffsetX === 0) return target
  const [longitude, latitude] = target
  const worldSize = 512 * 2 ** zoom
  const x = (longitude + 180) / 360
  const y = (1 - Math.log(Math.tan(Math.PI / 4 + (latitude * Math.PI) / 360)) / Math.PI) / 2
  // Screen right points along (cos θ, sin θ) in Web Mercator x/y at bearing θ.
  const theta = (bearing * Math.PI) / 180
  const centreX = x - (screenOffsetX / worldSize) * Math.cos(theta)
  const centreY = y - (screenOffsetX / worldSize) * Math.sin(theta)
  const centreLongitude = centreX * 360 - 180
  const centreLatitude = (Math.atan(Math.sinh(Math.PI * (1 - 2 * centreY))) * 180) / Math.PI
  return [centreLongitude, centreLatitude]
}

/** Keeps style changes on the requested destination until expiry or an operator gesture. */
export function navigateMapToTarget(
  map: NavigationMap,
  target: [number, number],
  isCurrent: () => boolean,
  options: { readonly screenOffsetX?: number } = {},
): () => void {
  const zoom = Math.max(map.getZoom(), 14)
  const center = centerForScreenOffset(target, zoom, map.getBearing(), options.screenOffsetX ?? 0)
  const intent = { camera: { ...captureMapCamera(map), center, zoom }, isCurrent }
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
