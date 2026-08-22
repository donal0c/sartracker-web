import { distance, point } from '@turf/turf'

import type { NormalizedTrackingPosition } from './tracking-types'

export type StationaryAttentionConfig = {
  readonly heartbeatWindowMs: number
  readonly movementFloorM: number
  readonly accuracyFactor: number
  readonly outlierRejectM: number
}

export type StationaryAttentionEvaluation = {
  readonly state: 'none' | 'attention' | 'insufficient-data'
  readonly sinceTimestamp?: string
  readonly elapsedMs?: number
  readonly movementThresholdM?: number
}

export const DEFAULT_STATIONARY_ATTENTION_CONFIG: StationaryAttentionConfig = {
  heartbeatWindowMs: 20 * 60_000,
  movementFloorM: 15,
  accuracyFactor: 2,
  outlierRejectM: 500,
}

/**
 * Evaluates accepted fixes only. A matching endpoint pair makes isolated
 * intermediate outliers irrelevant and preserves deterministic restart results.
 */
export function evaluateStationaryAttention(
  fixes: readonly NormalizedTrackingPosition[],
  configInput: StationaryAttentionConfig,
): StationaryAttentionEvaluation {
  const config = sanitizeStationaryAttentionConfig(configInput)
  const ordered = fixes
    .filter(isUsableFix)
    .map((fix) => ({ fix, timeMs: Date.parse(fix.timestamp) }))
    .sort((left, right) => left.timeMs - right.timeMs || left.fix.id.localeCompare(right.fix.id))
  if (ordered.length < 2) {
    return { state: 'insufficient-data' }
  }

  const latest = ordered.at(-1)
  if (latest === undefined) {
    return { state: 'insufficient-data' }
  }
  for (const candidate of ordered) {
    const elapsedMs = latest.timeMs - candidate.timeMs
    if (elapsedMs < config.heartbeatWindowMs) {
      continue
    }
    const movementM = distance(
      point([candidate.fix.lon, candidate.fix.lat]),
      point([latest.fix.lon, latest.fix.lat]),
      { units: 'meters' },
    )
    if (movementM >= config.outlierRejectM) {
      continue
    }
    const movementThresholdM = Math.max(
      config.movementFloorM,
      config.accuracyFactor * Math.max(validAccuracy(candidate.fix.accuracy), validAccuracy(latest.fix.accuracy)),
    )
    if (movementM < movementThresholdM) {
      return {
        state: 'attention',
        sinceTimestamp: candidate.fix.timestamp,
        elapsedMs,
        movementThresholdM,
      }
    }
  }
  return { state: 'none' }
}

/** Replaces corrupt or unsafe persisted values with the reviewed hypotheses. */
export function sanitizeStationaryAttentionConfig(input: unknown): StationaryAttentionConfig {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return DEFAULT_STATIONARY_ATTENTION_CONFIG
  }
  const candidate = input as Partial<Record<keyof StationaryAttentionConfig, unknown>>
  if (
    !isBoundedNumber(candidate.heartbeatWindowMs, 5 * 60_000, 60 * 60_000) ||
    !isBoundedNumber(candidate.movementFloorM, 5, 100) ||
    !isBoundedNumber(candidate.accuracyFactor, 1, 5) ||
    !isBoundedNumber(candidate.outlierRejectM, 100, 5_000)
  ) {
    return DEFAULT_STATIONARY_ATTENTION_CONFIG
  }
  return {
    heartbeatWindowMs: candidate.heartbeatWindowMs,
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

function validAccuracy(value: number | null): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

function isBoundedNumber(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum
}
