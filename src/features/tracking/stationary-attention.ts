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

type TimedFix = { readonly fix: NormalizedTrackingPosition; readonly timeMs: number }
type Episode = {
  readonly anchor: TimedFix
  readonly previous: TimedFix
  readonly pendingDeviation?: TimedFix
}

/** Prepares immutable history once; a newer current fix only revisits the mutable tail. */
export function prepareStationaryAttention(
  fixes: readonly NormalizedTrackingPosition[],
  configInput: StationaryAttentionConfig,
): (current: readonly NormalizedTrackingPosition[]) => StationaryAttentionEvaluation {
  const config = sanitizeStationaryAttentionConfig(configInput)
  const ordered = orderFixes(fixes)
  const accepted = ordered.filter((entry, index) => !isGrossExcursion(
    ordered[index - 1], entry, ordered[index + 1], config,
  ))
  const prefix = accepted.slice(0, Math.max(0, accepted.length - 2))
  const tail = accepted.slice(-2)
  const episode = foldEpisode(prefix, config)
  return (current) => {
    const newest = current[0]
    const lastRaw = ordered.at(-1)
    if (current.length !== 1 || newest === undefined || !isUsableFix(newest) ||
        lastRaw === undefined || Date.parse(newest.timestamp) <= lastRaw.timeMs) {
      return evaluateStationaryAttention([...fixes, ...current], config)
    }
    const next = { fix: newest, timeMs: Date.parse(newest.timestamp) }
    const revisedTail = isGrossExcursion(ordered.at(-2), lastRaw, next, config)
      ? tail.filter((entry) => entry !== lastRaw) : tail
    const nextTail = [...revisedTail, next]
    const nextEpisode = foldEpisode(nextTail, config, episode)
    return episodeEvaluation(nextEpisode, prefix.length + nextTail.length, config)
  }
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
  const ordered = orderFixes(fixes)
  if (ordered.length < 2) {
    return { state: 'insufficient-data' }
  }

  // Reject only an isolated gross excursion whose immediately following fix
  // corroborates the preceding location. Ordinary routes must remain intact.
  const accepted = ordered.filter((entry, index) => !isGrossExcursion(
    ordered[index - 1], entry, ordered[index + 1], config,
  ))
  return episodeEvaluation(foldEpisode(accepted, config), accepted.length, config)
}

/** Sorts usable observations deterministically without mutating evidence. */
function orderFixes(fixes: readonly NormalizedTrackingPosition[]): TimedFix[] {
  return fixes.filter(isUsableFix).map((fix) => ({ fix, timeMs: Date.parse(fix.timestamp) }))
    .sort((left, right) => left.timeMs - right.timeMs ||
      createTrackingPositionIdentityKey(left.fix).localeCompare(createTrackingPositionIdentityKey(right.fix)))
}

/** Rejects only a gross isolated excursion with a corroborating raw return fix. */
function isGrossExcursion(previous: TimedFix | undefined, entry: TimedFix, next: TimedFix | undefined, config: StationaryAttentionConfig): boolean {
  return previous !== undefined && next !== undefined &&
    displacement(previous.fix, entry.fix) >= Math.max(config.outlierRejectM, movementThreshold(previous.fix, entry.fix, config)) &&
    displacement(previous.fix, next.fix) < movementThreshold(previous.fix, next.fix, config)
}

/** Requires a second outside fix to confirm departure from a stationary episode. */
function foldEpisode(entries: readonly TimedFix[], config: StationaryAttentionConfig, initial: Episode | null = null): Episode | null {
  let state = initial
  for (const entry of entries) {
    if (state === null) {
      state = { anchor: entry, previous: entry }
      continue
    }
    const outside = displacement(state.anchor.fix, entry.fix) >= movementThreshold(state.anchor.fix, entry.fix, config) ||
      displacement(state.previous.fix, entry.fix) >= movementThreshold(state.previous.fix, entry.fix, config)
    if (!outside) {
      // A return corroborates the original location, not a new episode.
      state = { anchor: state.anchor, previous: entry }
    } else if (state.pendingDeviation === undefined) {
      state = { ...state, pendingDeviation: entry }
    } else {
      const pending = state.pendingDeviation
      const anchor = displacement(pending.fix, entry.fix) >= movementThreshold(pending.fix, entry.fix, config)
        ? entry : pending
      state = { anchor, previous: entry }
    }
  }
  return state
}

/** Converts derived episode state to the existing operator attention contract. */
function episodeEvaluation(episode: Episode | null, count: number, config: StationaryAttentionConfig): StationaryAttentionEvaluation {
  if (episode === null || count < 2) return { state: 'insufficient-data' }
  const terminalOutlier = episode.pendingDeviation !== undefined
  const { anchor, previous: latest } = episode
  const minimumHeartbeatSpanMs = config.heartbeatWindowMs - config.heartbeatToleranceMs
  const elapsedMs = latest.timeMs - anchor.timeMs
  if (elapsedMs >= minimumHeartbeatSpanMs) {
    return {
      state: 'attention', sinceTimestamp: anchor.fix.timestamp, elapsedMs,
      movementThresholdM: movementThreshold(anchor.fix, latest.fix, config),
      ...(terminalOutlier ? { latestFixUnreliable: true } : {}),
    }
  }
  return terminalOutlier
    ? { state: 'none', latestFixUnreliable: true }
    : { state: 'none' }
}

/** Measures separation without changing either accepted source fix. */
function displacement(left: NormalizedTrackingPosition, right: NormalizedTrackingPosition): number {
  return distance(point([left.lon, left.lat]), point([right.lon, right.lat]), { units: 'meters' })
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

function isBoundedNumber(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum
}
