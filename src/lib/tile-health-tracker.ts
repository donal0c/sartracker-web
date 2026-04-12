/**
 * Tracks tile load errors within a sliding time window to prevent
 * transient tile failures from triggering operator-visible degradation alerts.
 *
 * Only declares degradation when errors exceed a configurable threshold
 * within a rolling time window (default: 3 errors in 10 seconds).
 */

export type TileHealthDecision = 'no-change' | 'degrade'

export type TileHealthTrackerOptions = {
  /** Number of errors within the window required to trigger degradation. */
  readonly threshold?: number
  /** Sliding window duration in milliseconds. */
  readonly windowMs?: number
}

export type TileHealthTracker = {
  /** Records a tile error. Returns 'degrade' if the threshold is exceeded. */
  readonly recordError: (now: number) => TileHealthDecision
  /** Clears all tracked errors (call on idle / basemap change). */
  readonly reset: () => void
  /**
   * Returns true if the tracker has recorded errors but all have expired
   * from the window — meaning the degraded state can be cleared.
   */
  readonly shouldRecover: (now: number) => boolean
}

const DEFAULT_THRESHOLD = 3
const DEFAULT_WINDOW_MS = 10_000

/**
 * Creates a tile health tracker with threshold-based degradation detection.
 */
export function createTileHealthTracker(
  options?: TileHealthTrackerOptions,
): TileHealthTracker {
  const threshold = options?.threshold ?? DEFAULT_THRESHOLD
  const windowMs = options?.windowMs ?? DEFAULT_WINDOW_MS

  let errorTimestamps: number[] = []
  let hasRecordedErrors = false

  function pruneExpired(now: number): void {
    const cutoff = now - windowMs
    errorTimestamps = errorTimestamps.filter((t) => t >= cutoff)
  }

  function recordError(now: number): TileHealthDecision {
    hasRecordedErrors = true
    errorTimestamps.push(now)
    pruneExpired(now)
    return errorTimestamps.length >= threshold ? 'degrade' : 'no-change'
  }

  function reset(): void {
    errorTimestamps = []
    hasRecordedErrors = false
  }

  function shouldRecover(now: number): boolean {
    if (!hasRecordedErrors) {
      return false
    }
    pruneExpired(now)
    return errorTimestamps.length === 0
  }

  return { recordError, reset, shouldRecover }
}
