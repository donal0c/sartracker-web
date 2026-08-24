import type { NormalizedTrackingPosition } from './tracking-types'
import {
  createPagedTrailSegmenter as createSharedPagedTrailSegmenter,
  createTrailSegments as createSharedTrailSegments,
} from '../../../electron/coverage-trail-segmentation.cjs'

/**
 * Splits chronologically ordered fixes when the real time gap exceeds the
 * configured threshold. A gap exactly equal to the threshold remains joined.
 */
export function createTrailSegments(
  positions: readonly NormalizedTrackingPosition[],
  gapThresholdMs: number,
): readonly (readonly NormalizedTrackingPosition[])[] {
  return createSharedTrailSegments(positions, gapThresholdMs)
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
  return createSharedPagedTrailSegmenter<NormalizedTrackingPosition>(gapThresholdMs)
}
