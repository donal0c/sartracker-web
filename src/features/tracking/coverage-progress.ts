import type { CoverageManifestChunk } from '../../infrastructure/mission-store/tauri-mission-store'
import type { CoverageState } from './coverage-controller'
import { coverageChunkIdentity } from './coverage-identity'

type CoverageDelivery = Readonly<Record<string, number>>

/**
 * How long the whole-history line may go without being redrawn while it is
 * behind before the operator is warned. A normal catch-up cycle is a 30 s
 * quiet interval plus one tile build, so two minutes without any redraw means
 * the line is not keeping up [DON-338].
 */
export const COVERAGE_CATCH_UP_STALL_MS = 120_000

/** Blockers that mean history cannot be trusted until someone acts or storage recovers. */
const ATTENTION_BLOCKERS: ReadonlySet<string> = new Set([
  'history_reconciliation_incomplete',
  'ingest_health_degraded',
  'renderer_evidence_degraded',
])

/** Blockers that clear on their own while the app keeps working. */
const TRANSIENT_BLOCKERS: ReadonlySet<string> = new Set([
  'backfill_incomplete',
  'ingest_outbox_pending',
  'pending_invalidation',
  'renderer_detached',
  'renderer_evidence_pending',
  'renderer_filter_pending',
])

/**
 * Operator-facing meaning of the whole-history status:
 * - `up_to_date`: every selected fix is drawn and verified.
 * - `loading`: nothing drawn yet; the app is still working on it.
 * - `catching_up`: an earlier version of the line is drawn and newer fixes are being added.
 * - `behind`: the line is missing fixes and is not catching up on its own (stopped, blocked, or stalled).
 * - `failed`: loading or drawing failed; the loaded line stays shown.
 */
export type CoverageStatusKind =
  | 'inactive'
  | 'up_to_date'
  | 'loading'
  | 'catching_up'
  | 'behind'
  | 'failed'

export type CoverageStatusSummary = {
  readonly kind: CoverageStatusKind
  readonly drawnFixCount: number
  readonly totalFixCount: number
  /** True when the operator must be told wherever they are in the app. */
  readonly needsAttention: boolean
  /** True when the app will retry or continue without the operator pressing anything. */
  readonly automaticRetry: boolean
  /** True when the line has gone {@link COVERAGE_CATCH_UP_STALL_MS} without being redrawn. */
  readonly stalled: boolean
}

/** Returns the fix count a chunk contributes at its current revision. */
export function coverageChunkFixCount(chunk: CoverageManifestChunk): number {
  const fresh = chunk.builtRev === chunk.contentRev
  return fresh && chunk.fixCount !== null ? chunk.fixCount : chunk.exactCount
}

/** Calculates selected-scope progress without treating built state as delivery. */
export function calculateCoverageProgress(input: {
  readonly chunks: readonly CoverageManifestChunk[]
  readonly delivered: CoverageDelivery
}): { readonly deliveredFixCount: number; readonly totalFixCount: number } {
  let deliveredFixCount = 0
  let totalFixCount = 0
  for (const chunk of input.chunks) {
    const fresh = chunk.builtRev === chunk.contentRev
    const count = coverageChunkFixCount(chunk)
    totalFixCount += count
    if (fresh && input.delivered[coverageChunkIdentity(chunk.key)] === chunk.contentRev) {
      deliveredFixCount += count
    }
  }
  return { deliveredFixCount, totalFixCount }
}

/**
 * Counts the fixes the map actually draws for the selected chunks, including
 * chunks whose drawn revision is older than the current one. `drawnCounts`
 * holds the fix count recorded when each revision was accepted by the map; a
 * revision with no record counts only if it is still current, otherwise zero,
 * so the figure can understate but never overstate what is drawn.
 */
export function calculateDrawnFixCount(input: {
  readonly chunks: readonly CoverageManifestChunk[]
  readonly delivered: CoverageDelivery
  readonly drawnCounts: ReadonlyMap<string, { readonly contentRev: number; readonly fixCount: number }>
}): number {
  let drawn = 0
  for (const chunk of input.chunks) {
    const identity = coverageChunkIdentity(chunk.key)
    const revision = input.delivered[identity]
    if (revision === undefined) continue
    const recorded = input.drawnCounts.get(identity)
    if (recorded !== undefined && recorded.contentRev === revision) drawn += recorded.fixCount
    else if (chunk.contentRev === revision) drawn += coverageChunkFixCount(chunk)
  }
  return drawn
}

/**
 * Turns controller state into the plain status an operator needs. Unknown or
 * missing evidence of ongoing work is treated as "behind" so that the panel
 * never claims the line is catching up when nothing is working on it.
 */
export function summarizeCoverageStatus(state: CoverageState): CoverageStatusSummary {
  if (state.status === 'inactive') {
    return {
      kind: 'inactive', drawnFixCount: 0, totalFixCount: 0,
      needsAttention: false, automaticRetry: false, stalled: false,
    }
  }
  const drawnFixCount = state.drawnFixCount ?? state.deliveredFixCount
  const base = {
    drawnFixCount,
    totalFixCount: state.totalFixCount,
    automaticRetry: state.updating === true,
    stalled: false,
  }
  if (state.status === 'complete') return { ...base, kind: 'up_to_date', needsAttention: false }
  if (state.status === 'error') return { ...base, kind: 'failed', needsAttention: true }

  const blockers = state.blockers ?? []
  if (blockers.some((blocker) => ATTENTION_BLOCKERS.has(blocker))) {
    return { ...base, kind: 'behind', needsAttention: true }
  }
  if (state.stalled === true) {
    return { ...base, kind: 'behind', needsAttention: true, stalled: true }
  }
  const working = state.updating === true ||
    state.status === 'loading' ||
    state.manifest?.pendingInvalidation === true ||
    state.manifest?.backfillIncomplete === true ||
    blockers.some((blocker) => TRANSIENT_BLOCKERS.has(blocker))
  if (!working) return { ...base, kind: 'behind', needsAttention: true }
  return { ...base, kind: drawnFixCount === 0 ? 'loading' : 'catching_up', needsAttention: false }
}
