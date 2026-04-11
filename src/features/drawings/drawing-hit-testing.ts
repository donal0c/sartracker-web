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
    const distanceSq = calculateGeometryDistanceSq(map, point, drawing.geometry_json)
    if (distanceSq === null) {
      continue
    }

    if (distanceSq <= nearestDistanceSq) {
      nearestDrawingId = drawing.id
      nearestDistanceSq = distanceSq
    }
  }

  return nearestDrawingId
}

function calculateGeometryDistanceSq(
  map: Pick<maplibregl.Map, 'project'>,
  targetPoint: { readonly x: number; readonly y: number },
  geometryJson: string,
): number | null {
  try {
    const parsed = JSON.parse(geometryJson) as {
      readonly type?: string
      readonly coordinates?: unknown
    }

    switch (parsed.type) {
      case 'Point':
        return calculatePointDistanceSq(map, targetPoint, parsed.coordinates)
      case 'LineString':
        return calculateLineDistanceSq(map, targetPoint, parsed.coordinates)
      case 'Polygon':
        return calculatePolygonDistanceSq(map, targetPoint, parsed.coordinates)
      default:
        return null
    }
  } catch {
    return null
  }
}

function calculatePointDistanceSq(
  map: Pick<maplibregl.Map, 'project'>,
  targetPoint: { readonly x: number; readonly y: number },
  coordinates: unknown,
): number | null {
  const projectedPoint = projectCoordinate(map, coordinates)
  if (projectedPoint === null) {
    return null
  }

  return distanceSq(projectedPoint, targetPoint)
}

function calculateLineDistanceSq(
  map: Pick<maplibregl.Map, 'project'>,
  targetPoint: { readonly x: number; readonly y: number },
  coordinates: unknown,
): number | null {
  const projectedPoints = projectCoordinateArray(map, coordinates)
  if (projectedPoints === null || projectedPoints.length < 2) {
    return null
  }

  let nearestDistanceSq = Number.POSITIVE_INFINITY
  for (let index = 0; index < projectedPoints.length - 1; index += 1) {
    const start = projectedPoints[index]
    const end = projectedPoints[index + 1]
    if (start === undefined || end === undefined) {
      continue
    }

    nearestDistanceSq = Math.min(
      nearestDistanceSq,
      distanceToSegmentSq(targetPoint, start, end),
    )
  }

  return Number.isFinite(nearestDistanceSq) ? nearestDistanceSq : null
}

function calculatePolygonDistanceSq(
  map: Pick<maplibregl.Map, 'project'>,
  targetPoint: { readonly x: number; readonly y: number },
  coordinates: unknown,
): number | null {
  if (!Array.isArray(coordinates) || coordinates.length === 0) {
    return null
  }

  const outerRing = projectCoordinateArray(map, coordinates[0])
  if (outerRing === null || outerRing.length < 3) {
    return null
  }

  if (isPointInsidePolygon(targetPoint, outerRing)) {
    return 0
  }

  return calculateLineDistanceSq(map, targetPoint, coordinates[0])
}

function projectCoordinate(
  map: Pick<maplibregl.Map, 'project'>,
  coordinate: unknown,
): { readonly x: number; readonly y: number } | null {
  if (!Array.isArray(coordinate) || coordinate.length < 2) {
    return null
  }

  const [lng, lat] = coordinate
  if (typeof lng !== 'number' || typeof lat !== 'number') {
    return null
  }

  const projected = map.project({ lng, lat })
  return { x: projected.x, y: projected.y }
}

function projectCoordinateArray(
  map: Pick<maplibregl.Map, 'project'>,
  coordinates: unknown,
): { readonly x: number; readonly y: number }[] | null {
  if (!Array.isArray(coordinates)) {
    return null
  }

  const projected = coordinates
    .map((coordinate) => projectCoordinate(map, coordinate))
    .filter((coordinate): coordinate is { readonly x: number; readonly y: number } => coordinate !== null)

  return projected.length === coordinates.length ? projected : null
}

function distanceSq(
  left: { readonly x: number; readonly y: number },
  right: { readonly x: number; readonly y: number },
): number {
  const dx = left.x - right.x
  const dy = left.y - right.y
  return dx * dx + dy * dy
}

function distanceToSegmentSq(
  point: { readonly x: number; readonly y: number },
  start: { readonly x: number; readonly y: number },
  end: { readonly x: number; readonly y: number },
): number {
  const segmentDx = end.x - start.x
  const segmentDy = end.y - start.y
  const segmentLengthSq = segmentDx * segmentDx + segmentDy * segmentDy

  if (segmentLengthSq === 0) {
    return distanceSq(point, start)
  }

  const projectedRatio = Math.max(
    0,
    Math.min(
      1,
      ((point.x - start.x) * segmentDx + (point.y - start.y) * segmentDy) / segmentLengthSq,
    ),
  )

  return distanceSq(point, {
    x: start.x + projectedRatio * segmentDx,
    y: start.y + projectedRatio * segmentDy,
  })
}

function isPointInsidePolygon(
  point: { readonly x: number; readonly y: number },
  polygon: readonly { readonly x: number; readonly y: number }[],
): boolean {
  let inside = false

  for (let index = 0, previousIndex = polygon.length - 1; index < polygon.length; previousIndex = index, index += 1) {
    const current = polygon[index]
    const previous = polygon[previousIndex]
    if (current === undefined || previous === undefined) {
      continue
    }

    const intersects =
      current.y > point.y !== previous.y > point.y &&
      point.x <
        ((previous.x - current.x) * (point.y - current.y)) / (previous.y - current.y) +
          current.x

    if (intersects) {
      inside = !inside
    }
  }

  return inside
}
