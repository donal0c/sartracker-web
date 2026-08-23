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
    const grouped = new Map<string, Map<string, NormalizedTrackingPosition>>()
    for (const fix of breadcrumbs) {
      const fixes = grouped.get(fix.device_id) ?? new Map()
      fixes.set(createTrackingPositionIdentityKey(fix), fix)
      grouped.set(fix.device_id, fixes)
    }
    cachedBreadcrumbs = breadcrumbs
    cachedHistoryByDevice = new Map([...grouped].map(([deviceId, fixes]) => [
      deviceId,
      { fixes: [...fixes.values()], identityKeys: new Set(fixes.keys()) },
    ]))
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
