import type maplibregl from 'maplibre-gl'

import type { Drawing } from '../../infrastructure/mission-store/tauri-mission-store'

const DRAWING_SELECTION_RADIUS_PX = 20

export function findNearestDrawingId(
  map: maplibregl.Map,
  point: { readonly x: number; readonly y: number },
  drawings: readonly Drawing[],
): string | null {
  let nearestDrawingId: string | null = null
  let nearestDistanceSq = DRAWING_SELECTION_RADIUS_PX * DRAWING_SELECTION_RADIUS_PX

  for (const drawing of drawings) {
    const candidate = extractPointCoordinates(drawing.geometry_json)
    if (candidate === null) {
      continue
    }

    const projected = map.project({ lng: candidate.lng, lat: candidate.lat })
    const dx = projected.x - point.x
    const dy = projected.y - point.y
    const distanceSq = dx * dx + dy * dy

    if (distanceSq <= nearestDistanceSq) {
      nearestDrawingId = drawing.id
      nearestDistanceSq = distanceSq
    }
  }

  return nearestDrawingId
}

function extractPointCoordinates(
  geometryJson: string,
): { readonly lng: number; readonly lat: number } | null {
  try {
    const parsed = JSON.parse(geometryJson) as {
      readonly type?: string
      readonly coordinates?: unknown
    }

    if (
      parsed.type !== 'Point' ||
      !Array.isArray(parsed.coordinates) ||
      parsed.coordinates.length < 2
    ) {
      return null
    }

    const [lng, lat] = parsed.coordinates
    return typeof lng === 'number' && typeof lat === 'number' ? { lng, lat } : null
  } catch {
    return null
  }
}
