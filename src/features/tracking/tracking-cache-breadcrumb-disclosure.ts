import type {
  BreadcrumbDeviceBudget,
  BreadcrumbSnapshotMetadata,
  NormalizedTrackingPosition,
} from './tracking-types'

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
    const cacheThinned = device.retained.length < device.inputCount
    const truncated = liveTruncated || cacheThinned
    const liveBound = liveTruncated ? readBound(liveBudget) : 0
    const geometryErrorBoundMetres = !truncated ? 0
      : liveBound === null || device.geometryErrorBoundMetres === null ? null
        : Math.max(liveBound, device.geometryErrorBoundMetres)
    return {
      deviceId: device.deviceId,
      retained: device.retained.length,
      sourceRetained: device.inputCount,
      total: Math.max(liveBudget?.total ?? 0, device.inputCount),
      firstTimestamp: device.retained[0]?.timestamp ?? null,
      lastTimestamp: device.retained.at(-1)?.timestamp ?? null,
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
    totalObserved: Math.max(
      live?.totalObserved ?? 0,
      deviceBudgets.reduce((sum, budget) => sum + budget.total, 0),
    ),
    deviceBudgets,
  }
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
  const byDevice = new Map<string, NormalizedTrackingPosition[]>()
  for (const position of breadcrumbs) {
    const trail = byDevice.get(position.device_id)
    if (trail === undefined) byDevice.set(position.device_id, [position])
    else trail.push(position)
  }
  const deviceBudgets = [...byDevice].map(([deviceId, trail]): BreadcrumbDeviceBudget => ({
    deviceId,
    retained: trail.length,
    sourceRetained: trail.length,
    total: trail.length,
    firstTimestamp: trail[0]?.timestamp ?? null,
    lastTimestamp: trail.at(-1)?.timestamp ?? null,
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
 * Combines a restored simplified cache trail with a live snapshot. Counts are
 * conservative lower bounds; a device simplified on either side stays
 * disclosed as simplified. Returns undefined when the cache made no
 * simplification claim.
 */
export function mergeCacheBreadcrumbMetadata(
  cached: BreadcrumbSnapshotMetadata | undefined,
  live: BreadcrumbSnapshotMetadata | undefined,
  merged: readonly NormalizedTrackingPosition[],
): BreadcrumbSnapshotMetadata | undefined {
  if (cached === undefined || !cached.deviceBudgets.some((budget) => budget.truncated)) {
    return undefined
  }
  const cachedBudgets = new Map(cached.deviceBudgets.map((budget) => [budget.deviceId, budget]))
  const liveBudgets = new Map(live?.deviceBudgets.map((budget) => [budget.deviceId, budget]))
  const byDevice = new Map<string, NormalizedTrackingPosition[]>()
  for (const position of merged) {
    const trail = byDevice.get(position.device_id)
    if (trail === undefined) byDevice.set(position.device_id, [position])
    else trail.push(position)
  }
  const deviceBudgets = [...byDevice].map(([deviceId, trail]): BreadcrumbDeviceBudget => {
    const sides = [cachedBudgets.get(deviceId), liveBudgets.get(deviceId)]
      .filter((budget): budget is BreadcrumbDeviceBudget => budget !== undefined)
    const truncatedSides = sides.filter((budget) => budget.truncated)
    const truncated = truncatedSides.length > 0
    const bounds = truncatedSides.map(readBound)
    const geometryErrorBoundMetres = !truncated ? 0
      : bounds.some((bound) => bound === null) ? null
        : Math.max(...(bounds as number[]))
    return {
      deviceId,
      retained: trail.length,
      sourceRetained: trail.length,
      total: Math.max(trail.length, ...sides.map((budget) => budget.total)),
      firstTimestamp: trail[0]?.timestamp ?? null,
      lastTimestamp: trail.at(-1)?.timestamp ?? null,
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
    totalObserved: Math.max(
      cached.totalObserved,
      live?.totalObserved ?? 0,
      deviceBudgets.reduce((sum, budget) => sum + budget.total, 0),
    ),
    deviceBudgets,
  }
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
