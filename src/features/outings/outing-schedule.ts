export type OutingWindow = {
  readonly id?: string
  readonly started_at: string
  readonly ended_at: string | null
}

/** Returns whether two half-open outing windows intersect. */
export function outingWindowsOverlap(left: OutingWindow, right: OutingWindow): boolean {
  const leftStart = boundaryMilliseconds(left.started_at)
  const rightStart = boundaryMilliseconds(right.started_at)
  const leftEnd = left.ended_at === null
    ? Number.POSITIVE_INFINITY
    : boundaryMilliseconds(left.ended_at)
  const rightEnd = right.ended_at === null
    ? Number.POSITIVE_INFINITY
    : boundaryMilliseconds(right.ended_at)
  return leftStart < rightEnd && rightStart < leftEnd
}

/** Classifies one timestamp into an outing, returning null for Unassigned evidence. */
export function classifyOutingAt(
  outings: readonly Required<Pick<OutingWindow, 'id' | 'started_at' | 'ended_at'>>[],
  timestamp: string,
): string | null {
  const instant = boundaryMilliseconds(timestamp)
  const match = outings.find((outing) => {
    const start = boundaryMilliseconds(outing.started_at)
    const end = outing.ended_at === null
      ? Number.POSITIVE_INFINITY
      : boundaryMilliseconds(outing.ended_at)
    return start <= instant && instant < end
  })
  return match?.id ?? null
}

/** Converts a valid date-time string to comparable milliseconds. */
function boundaryMilliseconds(value: string): number {
  const milliseconds = Date.parse(value)
  if (!Number.isFinite(milliseconds)) {
    throw new Error('Outing boundary must be a valid ISO8601 date-time.')
  }
  return milliseconds
}
