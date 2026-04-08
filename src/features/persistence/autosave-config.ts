export const DEFAULT_AUTOSAVE_INTERVAL_MS = 60_000
export const MIN_AUTOSAVE_INTERVAL_MS = 5_000

/**
 * Normalizes autosave intervals to a safe supported range.
 */
export function normalizeAutosaveIntervalMs(intervalMs?: number): number {
  if (intervalMs === undefined || !Number.isFinite(intervalMs)) {
    return DEFAULT_AUTOSAVE_INTERVAL_MS
  }

  return Math.max(MIN_AUTOSAVE_INTERVAL_MS, Math.trunc(intervalMs))
}
