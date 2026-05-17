import type maplibregl from 'maplibre-gl'

import type { GpxTrackImport } from '../../infrastructure/mission-store/tauri-mission-store'

const GPX_SELECTION_RADIUS_PX = 14

type ScreenPoint = { readonly x: number; readonly y: number }

/**
 * Returns the GPX import id whose track passes nearest the click point, when one
 * lies within the GPX selection radius.
 *
 * GPX geometry is persisted as MultiLineString. Each constituent LineString is
 * walked segment-by-segment and the smallest projected pixel distance is used.
 * Geometry that is malformed, has the wrong type, or contains fewer than two
 * points per line is silently ignored — operators must never see a thrown error
 * from a click on the map.
 */
export function findNearestGpxImportId(
  map: Pick<maplibregl.Map, 'project'>,
  point: ScreenPoint,
  imports: readonly GpxTrackImport[],
  maxDistancePx: number = GPX_SELECTION_RADIUS_PX,
): string | null {
  let nearestImportId: string | null = null
  let nearestDistanceSq = maxDistancePx * maxDistancePx

  for (const entry of imports) {
    const distanceSq = calculateMultiLineDistanceSq(map, point, entry.geometry_json)
    if (distanceSq === null) {
      continue
    }

    if (distanceSq <= nearestDistanceSq) {
      nearestImportId = entry.id
      nearestDistanceSq = distanceSq
    }
  }

  return nearestImportId
}

function calculateMultiLineDistanceSq(
  map: Pick<maplibregl.Map, 'project'>,
  targetPoint: ScreenPoint,
  geometryJson: string,
): number | null {
  let parsed: { readonly type?: string; readonly coordinates?: unknown }
  try {
    parsed = JSON.parse(geometryJson) as {
      readonly type?: string
      readonly coordinates?: unknown
    }
  } catch {
    return null
  }

  if (parsed.type !== 'MultiLineString' || !Array.isArray(parsed.coordinates)) {
    return null
  }

  let nearestDistanceSq = Number.POSITIVE_INFINITY

  for (const lineCoordinates of parsed.coordinates) {
    const projectedPoints = projectCoordinateArray(map, lineCoordinates)
    if (projectedPoints === null || projectedPoints.length < 2) {
      continue
    }

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
  }

  return Number.isFinite(nearestDistanceSq) ? nearestDistanceSq : null
}

function projectCoordinate(
  map: Pick<maplibregl.Map, 'project'>,
  coordinate: unknown,
): ScreenPoint | null {
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
): ScreenPoint[] | null {
  if (!Array.isArray(coordinates)) {
    return null
  }

  const projected = coordinates
    .map((coordinate) => projectCoordinate(map, coordinate))
    .filter((coordinate): coordinate is ScreenPoint => coordinate !== null)

  return projected.length === coordinates.length ? projected : null
}

function distanceToSegmentSq(point: ScreenPoint, start: ScreenPoint, end: ScreenPoint): number {
  const segmentDx = end.x - start.x
  const segmentDy = end.y - start.y
  const segmentLengthSq = segmentDx * segmentDx + segmentDy * segmentDy

  if (segmentLengthSq === 0) {
    const dx = point.x - start.x
    const dy = point.y - start.y
    return dx * dx + dy * dy
  }

  const projectedRatio = Math.max(
    0,
    Math.min(
      1,
      ((point.x - start.x) * segmentDx + (point.y - start.y) * segmentDy) / segmentLengthSq,
    ),
  )

  const closestX = start.x + projectedRatio * segmentDx
  const closestY = start.y + projectedRatio * segmentDy
  const dx = point.x - closestX
  const dy = point.y - closestY

  return dx * dx + dy * dy
}
