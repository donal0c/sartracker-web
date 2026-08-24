import type { NormalizedTrackingPosition } from './tracking-types'
import '../../../electron/coverage-trail-segmentation.cjs'

type Timestamped = { readonly timestamp: string }
type SharedTrailSegmentation = {
  readonly createTrailSegments: <T extends Timestamped>(
    positions: readonly T[],
    gapThresholdMs: number,
  ) => readonly (readonly T[])[]
  readonly createPagedTrailSegmenter: <T extends Timestamped>(
    gapThresholdMs: number,
  ) => {
    readonly append: (positions: readonly T[]) => readonly (readonly T[])[]
    readonly finish: () => readonly (readonly T[])[]
  }
}

const sharedTrailSegmentation = (
  globalThis as typeof globalThis & {
    __SARTRACKER_COVERAGE_TRAIL_SEGMENTATION__?: SharedTrailSegmentation
  }
).__SARTRACKER_COVERAGE_TRAIL_SEGMENTATION__

if (sharedTrailSegmentation === undefined) {
  throw new Error('Shared coverage trail segmentation failed to initialize.')
}

const {
  createPagedTrailSegmenter: createSharedPagedTrailSegmenter,
  createTrailSegments: createSharedTrailSegments,
} = sharedTrailSegmentation

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
