import type { NormalizedTrackingPosition } from './tracking-types'

const MAX_BREADCRUMB_POSITIONS = 100_000

/**
 * Appends new breadcrumb positions while deduplicating by device and timestamp.
 */
export function appendBreadcrumbPositions(
  existing: readonly NormalizedTrackingPosition[],
  incoming: readonly NormalizedTrackingPosition[],
): readonly NormalizedTrackingPosition[] {
  if (incoming.length === 0) {
    return existing
  }

  const deduplicated = new Map<string, NormalizedTrackingPosition>()

  for (const position of [...existing, ...incoming]) {
    deduplicated.set(createPositionKey(position), position)
  }

  return [...deduplicated.values()]
    .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp))
    .slice(-MAX_BREADCRUMB_POSITIONS)
}

/**
 * Splits breadcrumb positions into line segments when time gaps exceed the threshold.
 */
export function createBreadcrumbSegments(
  positions: readonly NormalizedTrackingPosition[],
  gapThresholdMs: number,
): readonly (readonly NormalizedTrackingPosition[])[] {
  if (positions.length === 0) {
    return []
  }

  const firstPosition = positions[0]
  if (firstPosition === undefined) {
    return []
  }

  const segments: NormalizedTrackingPosition[][] = []
  let currentSegment: NormalizedTrackingPosition[] = [firstPosition]
  let previous = firstPosition

  for (let index = 1; index < positions.length; index += 1) {
    const next = positions[index]
    if (next === undefined) {
      continue
    }

    const gapMs = Date.parse(next.timestamp) - Date.parse(previous.timestamp)

    if (gapMs > gapThresholdMs) {
      segments.push(currentSegment)
      currentSegment = [next]
    } else {
      currentSegment.push(next)
    }

    previous = next
  }

  segments.push(currentSegment)
  return segments
}

function createPositionKey(position: NormalizedTrackingPosition): string {
  return `${position.device_id}:${position.timestamp}`
}
