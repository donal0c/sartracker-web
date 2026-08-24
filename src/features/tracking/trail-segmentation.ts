import type { NormalizedTrackingPosition } from './tracking-types'

const parsedTimestampByPosition = new WeakMap<NormalizedTrackingPosition, number>()

/**
 * Splits chronologically ordered fixes when the real time gap exceeds the
 * configured threshold. A gap exactly equal to the threshold remains joined.
 */
export function createTrailSegments(
  positions: readonly NormalizedTrackingPosition[],
  gapThresholdMs: number,
): readonly (readonly NormalizedTrackingPosition[])[] {
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

    const gapMs = getParsedTimestamp(next) - getParsedTimestamp(previous)
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

export type PagedTrailSegmenter = {
  readonly append: (
    positions: readonly NormalizedTrackingPosition[],
  ) => readonly (readonly NormalizedTrackingPosition[])[]
  readonly finish: () => readonly (readonly NormalizedTrackingPosition[])[]
}

/**
 * Segments a cursor-paged ordered trail without inventing a break at a
 * transport boundary. Only the unfinished final segment is retained.
 */
export function createPagedTrailSegmenter(gapThresholdMs: number): PagedTrailSegmenter {
  let currentSegment: NormalizedTrackingPosition[] = []
  let finished = false

  return {
    append: (positions) => {
      if (finished) throw new Error('Cannot append to a finished trail segmenter.')
      const completed: NormalizedTrackingPosition[][] = []
      for (const position of positions) {
        const previous = currentSegment.at(-1)
        if (
          previous !== undefined &&
          getParsedTimestamp(position) - getParsedTimestamp(previous) > gapThresholdMs
        ) {
          completed.push(currentSegment)
          currentSegment = []
        }
        currentSegment.push(position)
      }
      return completed
    },
    finish: () => {
      if (finished) return []
      finished = true
      if (currentSegment.length === 0) return []
      const finalSegment = currentSegment
      currentSegment = []
      return [finalSegment]
    },
  }
}

/** Parses a normalized position timestamp once for stable repeated shaping. */
function getParsedTimestamp(position: NormalizedTrackingPosition): number {
  const cached = parsedTimestampByPosition.get(position)
  if (cached !== undefined) {
    return cached
  }
  const timestampMs = Date.parse(position.timestamp)
  parsedTimestampByPosition.set(position, timestampMs)
  return timestampMs
}
