import type maplibregl from 'maplibre-gl'

import type { Marker } from '../../infrastructure/mission-store/tauri-mission-store'

const DEFAULT_MARKER_PICK_RADIUS_PX = 24

/**
 * Finds the closest marker near a clicked map point when rendered-feature hit testing
 * is unavailable or temporarily stale.
 */
export function findNearestMarkerId(
  map: maplibregl.Map,
  point: { readonly x: number; readonly y: number },
  markers: readonly Marker[],
  maxDistancePx: number = DEFAULT_MARKER_PICK_RADIUS_PX,
): string | null {
  let nearestMarkerId: string | null = null
  let nearestDistance = Number.POSITIVE_INFINITY

  for (const marker of markers) {
    const projectedPoint = map.project([marker.lon, marker.lat])
    const deltaX = projectedPoint.x - point.x
    const deltaY = projectedPoint.y - point.y
    const distance = Math.hypot(deltaX, deltaY)

    if (distance > maxDistancePx || distance >= nearestDistance) {
      continue
    }

    nearestDistance = distance
    nearestMarkerId = marker.id
  }

  return nearestMarkerId
}
