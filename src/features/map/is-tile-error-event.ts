/**
 * Returns true when a maplibre `error` event payload describes a tile-level
 * failure (the event carries a non-null `tile` object).
 *
 * Maplibre fires `error` for many situations — style validation, missing
 * layers, image-source errors, canvas-source errors, and tile fetch failures.
 * Only the last category should count toward the "basemap is genuinely
 * unreliable" trust signal that gates the operator-facing degraded badge.
 *
 * Counting non-tile errors caused the false-positive degraded badge tracked
 * in sartracker-web-2xp.
 */
export function isTileErrorEvent(payload: unknown): boolean {
  if (payload === null || typeof payload !== 'object') {
    return false
  }

  const candidate = (payload as { tile?: unknown }).tile
  return candidate !== null && typeof candidate === 'object'
}
