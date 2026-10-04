import type { NormalizedTrackingPosition } from './tracking-types'

/**
 * Returns true when a fix has finite, in-range WGS84 coordinates and a parseable timestamp.
 */
function isUsableFix(fix: NormalizedTrackingPosition): boolean {
  return (
    Number.isFinite(fix.lat) &&
    Number.isFinite(fix.lon) &&
    fix.lat >= -90 &&
    fix.lat <= 90 &&
    fix.lon >= -180 &&
    fix.lon <= 180 &&
    Number.isFinite(new Date(fix.timestamp).getTime())
  )
}

type NewestBreadcrumb = { readonly fix: NormalizedTrackingPosition; readonly ms: number }

/** Newest-breadcrumb index per breadcrumb array, so unchanged history is not re-scanned each poll. */
const newestBreadcrumbIndexByInput = new WeakMap<
  readonly NormalizedTrackingPosition[],
  ReadonlyMap<string, NewestBreadcrumb>
>()

/**
 * Finds the newest usable breadcrumb per device, caching by array identity.
 */
function getNewestBreadcrumbByDevice(
  breadcrumbs: readonly NormalizedTrackingPosition[],
): ReadonlyMap<string, NewestBreadcrumb> {
  const cached = newestBreadcrumbIndexByInput.get(breadcrumbs)
  if (cached !== undefined) {
    return cached
  }
  const index = new Map<string, NewestBreadcrumb>()
  for (const breadcrumb of breadcrumbs) {
    if (!isUsableFix(breadcrumb)) {
      continue
    }
    const ms = new Date(breadcrumb.timestamp).getTime()
    const existing = index.get(breadcrumb.device_id)
    if (existing === undefined || ms > existing.ms) {
      index.set(breadcrumb.device_id, { fix: breadcrumb, ms })
    }
  }
  newestBreadcrumbIndexByInput.set(breadcrumbs, index)
  return index
}

/**
 * Chooses, per device that has a current position, the newest usable fix across the
 * current-position response and the breadcrumb history.
 *
 * History refresh can return fixes newer than the current-position response, so the
 * trail may end ahead of the marker. Display only: stored data is never modified.
 * Invalid fixes are never chosen; on equal timestamps the current position wins, and an
 * older breadcrumb never replaces a newer position. A position with no usable alternative
 * is passed through unchanged, as before.
 *
 * A winning breadcrumb supplies location, time and identity only. Staleness and cache
 * health always come from the current position, because only positions are re-assessed
 * against the clock each poll; a breadcrumb's flags are frozen at fetch time and would
 * hide a device that has since gone silent.
 */
export function selectNewestKnownFixes(
  positions: readonly NormalizedTrackingPosition[],
  breadcrumbs: readonly NormalizedTrackingPosition[],
): NormalizedTrackingPosition[] {
  const newestBreadcrumbByDevice = getNewestBreadcrumbByDevice(breadcrumbs)

  const selected: NormalizedTrackingPosition[] = []
  for (const position of positions) {
    const breadcrumb = newestBreadcrumbByDevice.get(position.device_id)
    if (!isUsableFix(position)) {
      selected.push(breadcrumb === undefined ? position : withPositionHealth(breadcrumb.fix, position))
      continue
    }
    selected.push(
      breadcrumb !== undefined && breadcrumb.ms > new Date(position.timestamp).getTime()
        ? withPositionHealth(breadcrumb.fix, position)
        : position,
    )
  }
  return selected
}

/**
 * Places the newer fix while keeping the current position's clock-assessed health, so a
 * newer breadcrumb can never clear a stale or cached warning. Errs towards showing stale.
 */
function withPositionHealth(
  newer: NormalizedTrackingPosition,
  position: NormalizedTrackingPosition,
): NormalizedTrackingPosition {
  return {
    ...newer,
    data_origin: position.data_origin,
    cache_age_seconds: position.cache_age_seconds,
    device_cache_stale: position.device_cache_stale || newer.device_cache_stale,
  }
}
