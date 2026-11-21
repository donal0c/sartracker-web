// What the mission store reports about one tracking write, and the operator
// warnings it produces [DON-338 piece 3].
//
// The store refuses a malformed fix (for example one with no observed time)
// and keeps the good fixes of the same batch. It also keeps the stored row
// when Traccar reuses a position id for a different fix. Both are recorded as
// ingest anomalies; these warnings make them visible to the operator.

import type { TrackingWarning } from './tracking-warnings'

/** The store-write fields of a tracking acknowledgement that the runtime reads. */
export type StoreWriteOutcome = {
  /** Rows refused in this call (repeats on every re-delivery of the same row). */
  readonly rejectedPositionCount?: number
  /** Reused source ids seen in this call (repeats on every re-delivery). */
  readonly sourceIdentityConflictCount?: number
  /** Distinct rows the store has refused in this mission. */
  readonly missionRejectedPositionTotal?: number
  /** Distinct reused-id observations kept as conflicts in this mission. */
  readonly missionSourceIdentityConflictTotal?: number
}

/** Distinct store-write anomaly totals for one mission. */
export type StoreWriteTotals = {
  readonly missionId: string
  readonly rejectedPositionTotal: number
  readonly sourceIdentityConflictTotal: number
}

/**
 * Folds one acknowledgement into the totals the runtime warns about. Totals
 * never go down within one mission; a different mission starts again.
 * Per-call counts are used only when a store reports no mission total, so a
 * refusal is never hidden by an older store.
 *
 * @param previous totals already known, or null
 * @param missionId mission the acknowledgement belongs to
 * @param outcome the store acknowledgement
 * @returns the updated totals
 */
export function mergeStoreWriteTotals(
  previous: StoreWriteTotals | null,
  missionId: string,
  outcome: StoreWriteOutcome,
): StoreWriteTotals {
  const base = previous?.missionId === missionId
    ? previous
    : { missionId, rejectedPositionTotal: 0, sourceIdentityConflictTotal: 0 }
  return {
    missionId,
    rejectedPositionTotal: Math.max(
      base.rejectedPositionTotal,
      readTotal(outcome.missionRejectedPositionTotal, outcome.rejectedPositionCount),
    ),
    sourceIdentityConflictTotal: Math.max(
      base.sourceIdentityConflictTotal,
      readTotal(outcome.missionSourceIdentityConflictTotal, outcome.sourceIdentityConflictCount),
    ),
  }
}

/**
 * Builds the operator warnings for the current mission's store-write totals.
 *
 * @param totals the known totals, or null
 * @param missionId the mission the status is for, or null
 * @returns the warnings in display order (nulls when not active)
 */
export function buildStoreWriteWarnings(
  totals: StoreWriteTotals | null,
  missionId: string | null,
): readonly [TrackingWarning | null, TrackingWarning | null] {
  if (totals === null || missionId === null || totals.missionId !== missionId) return [null, null]
  const rejected = totals.rejectedPositionTotal
  const reused = totals.sourceIdentityConflictTotal
  return [
    rejected > 0
      ? {
          code: 'mission_storage_rows_rejected',
          text: `MISSION STORAGE REFUSED FIXES — ${formatCount(rejected, 'fix was', 'fixes were')} refused by mission storage `
            + 'because a value was missing or invalid. They are not on the map; the other fixes were saved. '
            + 'Each refusal is listed in the mission ingest anomalies.',
        }
      : null,
    reused > 0
      ? {
          code: 'source_position_id_reused',
          text: `TRACKING SERVER REUSED POSITION IDS — ${formatCount(reused, 'position id was', 'position ids were')} reused `
            + 'for a different fix. The fix stored first was kept and the new one is not on the map. '
            + 'The tracking server may have been reset or restored; check with whoever runs it.',
        }
      : null,
  ]
}

/** Returns a safe non-negative count, preferring the mission total. */
function readTotal(total: number | undefined, perCall: number | undefined): number {
  const value = total ?? perCall ?? 0
  return Number.isSafeInteger(value) && value > 0 ? value : 0
}

/** Formats a count with its singular or plural phrase. */
function formatCount(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`
}
