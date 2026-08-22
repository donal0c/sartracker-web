import { distance, point } from '@turf/turf'

import { createTrackingPositionIdentityKey } from './tracking-position-identity'
import type { NormalizedTrackingPosition } from './tracking-types'

export type StationaryAttentionConfig = {
  readonly heartbeatWindowMs: number
  readonly heartbeatToleranceMs: number
  readonly movementFloorM: number
  readonly accuracyFactor: number
  readonly outlierRejectM: number
}

export type StationaryAttentionEvaluation = {
  readonly state: 'none' | 'attention' | 'insufficient-data'
  readonly sinceTimestamp?: string
  readonly elapsedMs?: number
  readonly movementThresholdM?: number
  readonly latestFixUnreliable?: boolean
}

export const DEFAULT_STATIONARY_ATTENTION_CONFIG: StationaryAttentionConfig = {
  heartbeatWindowMs: 20 * 60_000,
  heartbeatToleranceMs: 2 * 60_000,
  movementFloorM: 15,
  accuracyFactor: 2,
  outlierRejectM: 500,
}

/**
 * Evaluates accepted fixes only. A ten-percent default tolerance makes the
 * approximately-twenty-minute heartbeat explicit, while one uncorroborated
 * terminal outlier cannot silently clear an established attention result.
 */
export function evaluateStationaryAttention(
  fixes: readonly NormalizedTrackingPosition[],
  configInput: StationaryAttentionConfig,
): StationaryAttentionEvaluation {
  const config = sanitizeStationaryAttentionConfig(configInput)
  const ordered = fixes
    .filter(isUsableFix)
    .map((fix) => ({ fix, timeMs: Date.parse(fix.timestamp) }))
    .sort((left, right) => left.timeMs - right.timeMs ||
      createTrackingPositionIdentityKey(left.fix).localeCompare(
        createTrackingPositionIdentityKey(right.fix),
      ))
  if (ordered.length < 2) {
    return { state: 'insufficient-data' }
  }

  const terminalOutlier = hasUncorroboratedTerminalOutlier(ordered, config)
  const latest = terminalOutlier ? ordered.at(-2) : ordered.at(-1)
  if (latest === undefined) {
    return { state: 'insufficient-data' }
  }
  const minimumHeartbeatSpanMs = config.heartbeatWindowMs - config.heartbeatToleranceMs
  for (const candidate of ordered) {
    if (candidate === latest) {
      continue
    }
    const elapsedMs = latest.timeMs - candidate.timeMs
    if (elapsedMs < minimumHeartbeatSpanMs) {
      continue
    }
    const movementM = distance(
      point([candidate.fix.lon, candidate.fix.lat]),
      point([latest.fix.lon, latest.fix.lat]),
      { units: 'meters' },
    )
    const movementThresholdM = movementThreshold(candidate.fix, latest.fix, config)
    if (movementM >= Math.max(config.outlierRejectM, movementThresholdM)) {
      continue
    }
    if (movementM < movementThresholdM) {
      return {
        state: 'attention',
        sinceTimestamp: candidate.fix.timestamp,
        elapsedMs,
        movementThresholdM,
        ...(terminalOutlier ? { latestFixUnreliable: true } : {}),
      }
    }
  }
  return terminalOutlier
    ? { state: 'none', latestFixUnreliable: true }
    : { state: 'none' }
}

/** Replaces corrupt or unsafe persisted values with the reviewed hypotheses. */
export function sanitizeStationaryAttentionConfig(input: unknown): StationaryAttentionConfig {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return DEFAULT_STATIONARY_ATTENTION_CONFIG
  }
  const candidate = input as Partial<Record<keyof StationaryAttentionConfig, unknown>>
  if (
    !isBoundedNumber(candidate.heartbeatWindowMs, 5 * 60_000, 60 * 60_000) ||
    !isBoundedNumber(candidate.heartbeatToleranceMs, 0, 6 * 60_000) ||
    candidate.heartbeatToleranceMs > candidate.heartbeatWindowMs / 2 ||
    !isBoundedNumber(candidate.movementFloorM, 5, 100) ||
    !isBoundedNumber(candidate.accuracyFactor, 1, 5) ||
    !isBoundedNumber(candidate.outlierRejectM, 100, 5_000)
  ) {
    return DEFAULT_STATIONARY_ATTENTION_CONFIG
  }
  return {
    heartbeatWindowMs: candidate.heartbeatWindowMs,
    heartbeatToleranceMs: candidate.heartbeatToleranceMs,
    movementFloorM: candidate.movementFloorM,
    accuracyFactor: candidate.accuracyFactor,
    outlierRejectM: candidate.outlierRejectM,
  }
}

function isUsableFix(fix: NormalizedTrackingPosition): boolean {
  return Number.isFinite(fix.lat) && fix.lat >= -90 && fix.lat <= 90 &&
    Number.isFinite(fix.lon) && fix.lon >= -180 && fix.lon <= 180 &&
    Number.isFinite(Date.parse(fix.timestamp))
}

function validAccuracy(value: number | null, unknownFallbackM: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : unknownFallbackM
}

/** Returns the accuracy-aware displacement below which movement is not meaningful. */
function movementThreshold(
  left: NormalizedTrackingPosition,
  right: NormalizedTrackingPosition,
  config: StationaryAttentionConfig,
): number {
  return Math.max(
    config.movementFloorM,
    config.accuracyFactor * Math.max(
      validAccuracy(left.accuracy, config.movementFloorM),
      validAccuracy(right.accuracy, config.movementFloorM),
    ),
  )
}

/** Detects one implausible newest fix that has not yet been corroborated by a later fix. */
function hasUncorroboratedTerminalOutlier(
  ordered: readonly { readonly fix: NormalizedTrackingPosition; readonly timeMs: number }[],
  config: StationaryAttentionConfig,
): boolean {
  const beforePrevious = ordered.at(-3)
  const previous = ordered.at(-2)
  const latest = ordered.at(-1)
  if (beforePrevious === undefined || previous === undefined || latest === undefined) {
    return false
  }
  const priorMovementM = distance(
    point([beforePrevious.fix.lon, beforePrevious.fix.lat]),
    point([previous.fix.lon, previous.fix.lat]),
    { units: 'meters' },
  )
  const latestMovementM = distance(
    point([previous.fix.lon, previous.fix.lat]),
    point([latest.fix.lon, latest.fix.lat]),
    { units: 'meters' },
  )
  const priorStationaryThresholdM = movementThreshold(
    beforePrevious.fix,
    previous.fix,
    config,
  )
  const latestMovementThresholdM = movementThreshold(
    previous.fix,
    latest.fix,
    config,
  )
  return priorMovementM < priorStationaryThresholdM &&
    latestMovementM >= latestMovementThresholdM
}

function isBoundedNumber(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum
}
