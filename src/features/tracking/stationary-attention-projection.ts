import {
  evaluateStationaryAttention,
  type StationaryAttentionConfig,
  type StationaryAttentionEvaluation,
} from './stationary-attention'
import { createTrackingPositionIdentityKey } from './tracking-position-identity'
import type { NormalizedTrackingPosition, TrackingSnapshot } from './tracking-types'

type StationaryAttentionEvaluator = (
  fixes: readonly NormalizedTrackingPosition[],
  config: StationaryAttentionConfig,
) => StationaryAttentionEvaluation

type AcceptedFixHistory = {
  readonly fixes: readonly NormalizedTrackingPosition[]
  readonly identityKeys: ReadonlySet<string>
  readonly fixesByIdentity: ReadonlyMap<string, NormalizedTrackingPosition>
}

type CachedDeviceEvaluation = {
  readonly history: AcceptedFixHistory
  readonly currentIdentityKey: string
  readonly configKey: string
  readonly evaluation: StationaryAttentionEvaluation
}

export type StationaryAttentionProjector = {
  readonly project: (
    snapshot: TrackingSnapshot,
    config: StationaryAttentionConfig,
    activeDeviceIds?: readonly string[],
  ) => ReadonlyMap<string, StationaryAttentionEvaluation>
  readonly reset: () => void
}

const EMPTY_HISTORY: AcceptedFixHistory = {
  fixes: [],
  identityKeys: new Set(),
  fixesByIdentity: new Map(),
}

/**
 * Caches immutable breadcrumb grouping and unchanged per-device evaluations so
 * repeated runtime publications do not rescan every retained fix on renderer.
 */
export function createStationaryAttentionProjector(
  evaluate: StationaryAttentionEvaluator = evaluateStationaryAttention,
): StationaryAttentionProjector {
  let cachedBreadcrumbs: TrackingSnapshot['breadcrumbs'] | null = null
  let cachedHistoryByDevice = new Map<string, AcceptedFixHistory>()
  const cachedEvaluationByDevice = new Map<string, CachedDeviceEvaluation>()

  function project(
    snapshot: TrackingSnapshot,
    config: StationaryAttentionConfig,
    activeDeviceIds?: readonly string[],
  ): ReadonlyMap<string, StationaryAttentionEvaluation> {
    const historyByDevice = historiesFor(snapshot.breadcrumbs)
    const currentByDevice = groupCurrentFixes(snapshot.positions)
    const activeDeviceIdSet = activeDeviceIds === undefined || activeDeviceIds.length === 0
      ? null
      : new Set(activeDeviceIds)
    const configKey = createConfigKey(config)
    const projected = new Map<string, StationaryAttentionEvaluation>()

    for (const device of snapshot.devices) {
      if (activeDeviceIdSet !== null && !activeDeviceIdSet.has(device.device_id)) continue
      const history = historyByDevice.get(device.device_id) ?? EMPTY_HISTORY
      const current = currentByDevice.get(device.device_id) ?? new Map()
      const currentIdentityKey = [...current.keys()].sort().join('\u0000')
      const cached = cachedEvaluationByDevice.get(device.device_id)
      if (
        cached?.history === history &&
        cached.currentIdentityKey === currentIdentityKey &&
        cached.configKey === configKey
      ) {
        projected.set(device.device_id, cached.evaluation)
        continue
      }

      const currentOnly = [...current].filter(
        ([identityKey]) => !history.identityKeys.has(identityKey),
      ).map(([, fix]) => fix)
      const evaluation = evaluate(
        currentOnly.length === 0 ? history.fixes : [...history.fixes, ...currentOnly],
        config,
      )
      cachedEvaluationByDevice.set(device.device_id, {
        history,
        currentIdentityKey,
        configKey,
        evaluation,
      })
      projected.set(device.device_id, evaluation)
    }
    return projected
  }

  /** Groups a changed immutable breadcrumb array once across publications. */
  function historiesFor(
    breadcrumbs: TrackingSnapshot['breadcrumbs'],
  ): ReadonlyMap<string, AcceptedFixHistory> {
    if (cachedBreadcrumbs === breadcrumbs) return cachedHistoryByDevice
    if (cachedBreadcrumbs === null) {
      cachedBreadcrumbs = breadcrumbs
      cachedHistoryByDevice = buildHistories(breadcrumbs)
      return cachedHistoryByDevice
    }

    const previous = cachedBreadcrumbs
    let sharedPrefixLength = 0
    const shortestLength = Math.min(previous.length, breadcrumbs.length)
    while (
      sharedPrefixLength < shortestLength &&
      previous[sharedPrefixLength] === breadcrumbs[sharedPrefixLength]
    ) {
      sharedPrefixLength += 1
    }
    let sharedSuffixLength = 0
    while (
      sharedSuffixLength < shortestLength - sharedPrefixLength &&
      previous[previous.length - 1 - sharedSuffixLength] ===
        breadcrumbs[breadcrumbs.length - 1 - sharedSuffixLength]
    ) {
      sharedSuffixLength += 1
    }

    const removed = previous.slice(
      sharedPrefixLength,
      previous.length - sharedSuffixLength,
    )
    const added = breadcrumbs.slice(
      sharedPrefixLength,
      breadcrumbs.length - sharedSuffixLength,
    )
    const changedDeviceIds = new Set([
      ...removed.map((fix) => fix.device_id),
      ...added.map((fix) => fix.device_id),
    ])
    const nextHistoryByDevice = new Map(cachedHistoryByDevice)
    for (const deviceId of changedDeviceIds) {
      const fixes = new Map(
        cachedHistoryByDevice.get(deviceId)?.fixesByIdentity ?? [],
      )
      for (const fix of removed) {
        if (fix.device_id === deviceId) {
          fixes.delete(createTrackingPositionIdentityKey(fix))
        }
      }
      for (const fix of added) {
        if (fix.device_id === deviceId) {
          fixes.set(createTrackingPositionIdentityKey(fix), fix)
        }
      }
      if (fixes.size === 0) {
        nextHistoryByDevice.delete(deviceId)
        continue
      }
      const previousHistory = cachedHistoryByDevice.get(deviceId)
      nextHistoryByDevice.set(
        deviceId,
        previousHistory !== undefined && hasSameIdentitySet(previousHistory, fixes)
          ? previousHistory
          : createAcceptedFixHistory(fixes),
      )
    }
    cachedBreadcrumbs = breadcrumbs
    cachedHistoryByDevice = nextHistoryByDevice
    return cachedHistoryByDevice
  }

  /** Clears projection caches after a settings generation changes. */
  function reset(): void {
    cachedBreadcrumbs = null
    cachedHistoryByDevice = new Map()
    cachedEvaluationByDevice.clear()
  }

  return { project, reset }
}

/** Builds the initial immutable per-device histories. */
function buildHistories(
  breadcrumbs: TrackingSnapshot['breadcrumbs'],
): Map<string, AcceptedFixHistory> {
  const grouped = new Map<string, Map<string, NormalizedTrackingPosition>>()
  for (const fix of breadcrumbs) {
    const fixes = grouped.get(fix.device_id) ?? new Map()
    fixes.set(createTrackingPositionIdentityKey(fix), fix)
    grouped.set(fix.device_id, fixes)
  }
  return new Map([...grouped].map(([deviceId, fixes]) => [
    deviceId,
    createAcceptedFixHistory(fixes),
  ]))
}

/** Creates one immutable history identity for evaluator caching. */
function createAcceptedFixHistory(
  fixes: ReadonlyMap<string, NormalizedTrackingPosition>,
): AcceptedFixHistory {
  return {
    fixes: [...fixes.values()],
    identityKeys: new Set(fixes.keys()),
    fixesByIdentity: new Map(fixes),
  }
}

/** Reuses a device history when a rebuilt snapshot contains the same accepted fixes. */
function hasSameIdentitySet(
  previous: AcceptedFixHistory,
  fixes: ReadonlyMap<string, NormalizedTrackingPosition>,
): boolean {
  return previous.identityKeys.size === fixes.size &&
    [...fixes].every(([identityKey, fix]) => {
      const existing = previous.fixesByIdentity.get(identityKey)
      return existing !== undefined && hasSameStationaryInputs(existing, fix)
    })
}

/** Compares every accepted-fix value consumed by the stationary policy. */
function hasSameStationaryInputs(
  first: NormalizedTrackingPosition,
  second: NormalizedTrackingPosition,
): boolean {
  return first.device_id === second.device_id &&
    first.lat === second.lat &&
    first.lon === second.lon &&
    first.accuracy === second.accuracy &&
    first.timestamp === second.timestamp
}

/** Groups the small current-position set without touching retained history. */
function groupCurrentFixes(
  positions: TrackingSnapshot['positions'],
): ReadonlyMap<string, ReadonlyMap<string, NormalizedTrackingPosition>> {
  const grouped = new Map<string, Map<string, NormalizedTrackingPosition>>()
  for (const fix of positions) {
    const fixes = grouped.get(fix.device_id) ?? new Map()
    fixes.set(createTrackingPositionIdentityKey(fix), fix)
    grouped.set(fix.device_id, fixes)
  }
  return grouped
}

/** Creates an exact stable cache key for the sanitized policy hypotheses. */
function createConfigKey(config: StationaryAttentionConfig): string {
  return [
    config.heartbeatWindowMs,
    config.heartbeatToleranceMs,
    config.movementFloorM,
    config.accuracyFactor,
    config.outlierRejectM,
  ].join(':')
}
