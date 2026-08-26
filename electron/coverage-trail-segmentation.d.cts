export type TimestampedPosition = { readonly timestamp: string }

export type GenericPagedTrailSegmenter<T extends TimestampedPosition> = {
  readonly append: (positions: readonly T[]) => readonly (readonly T[])[]
  readonly finish: () => readonly (readonly T[])[]
}

export function createTrailSegments<T extends TimestampedPosition>(
  positions: readonly T[],
  gapThresholdMs: number,
): readonly (readonly T[])[]

export function createPagedTrailSegmenter<T extends TimestampedPosition>(
  gapThresholdMs: number,
): GenericPagedTrailSegmenter<T>
