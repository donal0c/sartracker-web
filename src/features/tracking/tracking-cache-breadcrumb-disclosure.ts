import type {
  BreadcrumbDeviceBudget,
  BreadcrumbSnapshotMetadata,
  NormalizedTrackingPosition,
} from './tracking-types'
import { createTrackingPositionIdentityKey } from './tracking-position-identity'

/**
 * Simplification disclosure for trails that pass through the restart cache
 * [DON-338]. A thinned trail restored from the cache must say it is simplified;
 * it must never be presented as the exact route.
 */

const TARGET_GEOMETRY_ERROR_METRES = 25

/** What the cache writer knows about one device trail it thinned. */
export type CacheDeviceThinning = {
  readonly deviceId: string
  /** Fixes the snapshot held for this device before cache thinning. */
  readonly inputCount: number
  readonly retained: readonly NormalizedTrackingPosition[]
  /** 0 when nothing was dropped; null when no geometry bound is promised. */
  readonly geometryErrorBoundMetres: number | null
}

/**
 * Builds the metadata persisted with a cache write: the live simplification
 * (if any) combined with the cache's own thinning, per device.
 */
export function createCacheBreadcrumbMetadata(
  devices: readonly CacheDeviceThinning[],
  live: BreadcrumbSnapshotMetadata | undefined,
): BreadcrumbSnapshotMetadata {
  const liveBudgets = new Map(live?.deviceBudgets.map((budget) => [budget.deviceId, budget]))
  const deviceBudgets = devices.map((device): BreadcrumbDeviceBudget => {
    const liveBudget = liveBudgets.get(device.deviceId)
    const liveTruncated = liveBudget?.truncated === true
    const total = Math.max(liveBudget?.total ?? 0, device.inputCount, device.retained.length)
    // Any shortfall against what is known to exist counts as simplified.
    const truncated = liveTruncated || total > device.retained.length
    const liveBound = liveTruncated ? readBound(liveBudget) : 0
    const geometryErrorBoundMetres = !truncated ? 0
      : liveBound === null || device.geometryErrorBoundMetres === null ? null
        : Math.max(liveBound, device.geometryErrorBoundMetres)
    const span = timestampSpan(device.retained)
    return {
      deviceId: device.deviceId,
      retained: device.retained.length,
      sourceRetained: device.inputCount,
      total,
      firstTimestamp: span.first,
      lastTimestamp: span.last,
      truncated,
      geometryErrorBoundMetres,
      targetGeometryErrorSatisfied: !truncated || (
        (!liveTruncated || liveBudget?.targetGeometryErrorSatisfied === true) &&
        geometryErrorBoundMetres !== null &&
        geometryErrorBoundMetres <= TARGET_GEOMETRY_ERROR_METRES
      ),
    }
  })
  return {
    totalRetained: deviceBudgets.reduce((sum, budget) => sum + budget.retained, 0),
    totalObserved: deviceBudgets.reduce((sum, budget) => sum + budget.total, 0),
    deviceBudgets,
  }
}

/**
 * Accepts persisted metadata only when it describes exactly the restored
 * trail: one budget per device, matching counts and time spans, unique fix
 * identities and self-consistent simplification flags. Anything else is
 * doubtful and must be disclosed as simplification unknown, never as exact.
 */
export function isCacheBreadcrumbMetadataConsistent(
  metadata: BreadcrumbSnapshotMetadata,
  breadcrumbs: readonly NormalizedTrackingPosition[],
): boolean {
  const identities = new Set<string>()
  for (const position of breadcrumbs) {
    const key = createTrackingPositionIdentityKey(position)
    if (identities.has(key)) return false
    identities.add(key)
  }
  const trails = groupByDevice(breadcrumbs)
  if (metadata.deviceBudgets.length !== trails.size) return false
  if (metadata.totalRetained !== breadcrumbs.length) return false
  let totalObserved = 0
  let totalSourceRetained = 0
  let anyTruncated = false
  const seen = new Set<string>()
  for (const budget of metadata.deviceBudgets) {
    const trail = trails.get(budget.deviceId)
    if (trail === undefined || seen.has(budget.deviceId)) return false
    seen.add(budget.deviceId)
    // Counts must nest: retained <= sourceRetained <= total.
    if (
      budget.retained !== trail.length ||
      budget.sourceRetained < budget.retained ||
      budget.total < budget.sourceRetained
    ) return false
    const span = timestampSpan(trail)
    if (
      !sameInstant(budget.firstTimestamp, span.first) ||
      !sameInstant(budget.lastTimestamp, span.last)
    ) return false
    if (budget.truncated) {
      const bound = budget.geometryErrorBoundMetres
      if (budget.targetGeometryErrorSatisfied &&
        (bound === null || bound > TARGET_GEOMETRY_ERROR_METRES)) return false
      anyTruncated = true
    } else if (
      // A claim that nothing was dropped needs all three counts equal.
      budget.sourceRetained !== budget.retained ||
      budget.total !== budget.retained ||
      budget.geometryErrorBoundMetres !== 0
    ) {
      return false
    }
    totalSourceRetained += budget.sourceRetained
    totalObserved += budget.total
  }
  if (metadata.totalObserved !== totalObserved) return false
  if (
    metadata.totalRetained > totalSourceRetained ||
    totalSourceRetained > metadata.totalObserved
  ) return false
  return anyTruncated || (
    metadata.totalObserved === metadata.totalRetained &&
    totalSourceRetained === metadata.totalRetained
  )
}

/**
 * Discloses a restored trail whose simplification is unknown (a cache written
 * by an older version at its old cap, or unreadable metadata) as simplified
 * with no geometry promise. Counts are what the cache holds, so "at least" is
 * still true.
 */
export function createUnknownCacheSimplificationMetadata(
  breadcrumbs: readonly NormalizedTrackingPosition[],
): BreadcrumbSnapshotMetadata {
  const byDevice = groupByDevice(breadcrumbs)
  const deviceBudgets = [...byDevice].map(([deviceId, trail]): BreadcrumbDeviceBudget => ({
    deviceId,
    retained: trail.length,
    sourceRetained: trail.length,
    total: trail.length,
    firstTimestamp: timestampSpan(trail).first,
    lastTimestamp: timestampSpan(trail).last,
    truncated: true,
    geometryErrorBoundMetres: null,
    targetGeometryErrorSatisfied: false,
  }))
  return {
    totalRetained: breadcrumbs.length,
    totalObserved: breadcrumbs.length,
    deviceBudgets,
  }
}

/**
 * Reads persisted cache metadata. Returns null when it is malformed, so the
 * caller can fall back to the unknown-simplification disclosure rather than
 * present a thinned trail as exact.
 */
export function parseCacheBreadcrumbMetadata(value: unknown): BreadcrumbSnapshotMetadata | null {
  if (!isRecord(value) || !Array.isArray(value.deviceBudgets)) return null
  const totalRetained = readCount(value.totalRetained)
  const totalObserved = readCount(value.totalObserved)
  if (totalRetained === null || totalObserved === null) return null
  const deviceBudgets: BreadcrumbDeviceBudget[] = []
  for (const entry of value.deviceBudgets as unknown[]) {
    const budget = parseDeviceBudget(entry)
    if (budget === null) return null
    deviceBudgets.push(budget)
  }
  return { totalRetained, totalObserved, deviceBudgets }
}

/**
 * Combines a restored cache trail with a live snapshot. When either side is
 * simplified, the union is disclosed as simplified; counts are rebuilt from
 * the union and totals are conservative lower bounds. A cached trail with no
 * metadata is treated as simplification unknown. Returns undefined only when
 * both sides are positively exact.
 */
export function mergeCacheBreadcrumbMetadata(
  cachedTrail: readonly NormalizedTrackingPosition[],
  cachedMetadata: BreadcrumbSnapshotMetadata | undefined,
  live: BreadcrumbSnapshotMetadata | undefined,
  merged: readonly NormalizedTrackingPosition[],
): BreadcrumbSnapshotMetadata | undefined {
  const cached = cachedMetadata ?? (
    cachedTrail.length === 0 ? undefined : createUnknownCacheSimplificationMetadata(cachedTrail)
  )
  const simplified = (metadata: BreadcrumbSnapshotMetadata | undefined) =>
    metadata?.deviceBudgets.some((budget) => budget.truncated) === true
  if (!simplified(cached) && !simplified(live)) return undefined
  const cachedBudgets = new Map(cached?.deviceBudgets.map((budget) => [budget.deviceId, budget]))
  const liveBudgets = new Map(live?.deviceBudgets.map((budget) => [budget.deviceId, budget]))
  const deviceBudgets = [...groupByDevice(merged)].map(([deviceId, trail]): BreadcrumbDeviceBudget => {
    const sides = [cachedBudgets.get(deviceId), liveBudgets.get(deviceId)]
      .filter((budget): budget is BreadcrumbDeviceBudget => budget !== undefined)
    const truncatedSides = sides.filter((budget) => budget.truncated)
    const truncated = truncatedSides.length > 0
    const bounds = truncatedSides.map(readBound)
    const geometryErrorBoundMetres = !truncated ? 0
      : bounds.some((bound) => bound === null) ? null
        : Math.max(...(bounds as number[]))
    const total = Math.max(trail.length, ...sides.map((budget) => budget.total))
    const span = timestampSpan(trail)
    return {
      deviceId,
      retained: trail.length,
      sourceRetained: trail.length,
      total,
      firstTimestamp: span.first,
      lastTimestamp: span.last,
      truncated,
      geometryErrorBoundMetres,
      targetGeometryErrorSatisfied: !truncated || (
        truncatedSides.every((budget) => budget.targetGeometryErrorSatisfied) &&
        geometryErrorBoundMetres !== null &&
        geometryErrorBoundMetres <= TARGET_GEOMETRY_ERROR_METRES
      ),
    }
  })
  return {
    totalRetained: merged.length,
    totalObserved: deviceBudgets.reduce((sum, budget) => sum + budget.total, 0),
    deviceBudgets,
  }
}

/** Groups a trail by device, preserving order. */
function groupByDevice(
  positions: readonly NormalizedTrackingPosition[],
): Map<string, NormalizedTrackingPosition[]> {
  const byDevice = new Map<string, NormalizedTrackingPosition[]>()
  for (const position of positions) {
    const trail = byDevice.get(position.device_id)
    if (trail === undefined) byDevice.set(position.device_id, [position])
    else trail.push(position)
  }
  return byDevice
}

/** Earliest and latest timestamps of a trail, whatever its order. */
function timestampSpan(
  trail: readonly NormalizedTrackingPosition[],
): { readonly first: string | null, readonly last: string | null } {
  let first: NormalizedTrackingPosition | undefined
  let last: NormalizedTrackingPosition | undefined
  for (const position of trail) {
    const ms = Date.parse(position.timestamp)
    if (first === undefined || ms < Date.parse(first.timestamp)) first = position
    if (last === undefined || ms > Date.parse(last.timestamp)) last = position
  }
  return { first: first?.timestamp ?? null, last: last?.timestamp ?? null }
}

/** True when two optional timestamps name the same instant. */
function sameInstant(left: string | null, right: string | null): boolean {
  if (left === null || right === null) return left === right
  return Date.parse(left) === Date.parse(right)
}

/** A finite, non-negative bound, or null for "no promise". */
function readBound(budget: BreadcrumbDeviceBudget | undefined): number | null {
  const bound = budget?.geometryErrorBoundMetres
  return typeof bound === 'number' && Number.isFinite(bound) && bound >= 0 ? bound : null
}

function parseDeviceBudget(value: unknown): BreadcrumbDeviceBudget | null {
  if (!isRecord(value) || typeof value.deviceId !== 'string' || value.deviceId.length === 0) {
    return null
  }
  const retained = readCount(value.retained)
  const sourceRetained = readCount(value.sourceRetained)
  const total = readCount(value.total)
  const firstTimestamp = readTimestamp(value.firstTimestamp)
  const lastTimestamp = readTimestamp(value.lastTimestamp)
  if (
    retained === null || sourceRetained === null || total === null ||
    firstTimestamp === undefined || lastTimestamp === undefined ||
    typeof value.truncated !== 'boolean' ||
    typeof value.targetGeometryErrorSatisfied !== 'boolean'
  ) return null
  const bound = value.geometryErrorBoundMetres
  if (bound !== null && (typeof bound !== 'number' || !Number.isFinite(bound) || bound < 0)) {
    return null
  }
  return {
    deviceId: value.deviceId,
    retained,
    sourceRetained,
    total,
    firstTimestamp,
    lastTimestamp,
    truncated: value.truncated,
    geometryErrorBoundMetres: bound,
    targetGeometryErrorSatisfied: value.targetGeometryErrorSatisfied,
  }
}

function readCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null
}

/** A timestamp string or null; undefined means malformed. */
function readTimestamp(value: unknown): string | null | undefined {
  if (value === null) return null
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
