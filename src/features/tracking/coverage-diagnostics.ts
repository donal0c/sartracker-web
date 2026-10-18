import type { CoverageState } from './coverage-controller'

export type CoverageErrorClass =
  | 'cancelled'
  | 'chunk_stale'
  | 'malformed_sequence'
  | 'runtime_unavailable'
  | 'timeout'
  | 'worker'
  | 'unknown'

export type CoverageDiagnostics = {
  readonly queueDepth: number
  readonly queueAgeMs: number | null
  readonly pendingChunkCount: number
  readonly staleChunkCount: number
  readonly freshChunkCount: number
  readonly pendingInvalidationCount: number
  readonly lastEnumerationDurationMs: number | null
  readonly lastBuildDurationMs: number | null
  readonly deliveryMapSize: number
  readonly lastErrorClass: CoverageErrorClass | null
  readonly retryableStaleCount: number
}

/** Returns the bounded, identity-free coverage fields allowed in support reports. */
export function summarizeCoverageDiagnostics(input: {
  readonly state: CoverageState
  readonly nowMs?: number
}): CoverageDiagnostics | null {
  if (input.state.status === 'inactive' || input.state.manifest?.diagnostics === undefined) {
    return null
  }
  const storage = input.state.manifest.diagnostics
  const oldestQueuedMs = storage.oldestQueuedAt === null
    ? Number.NaN
    : Date.parse(storage.oldestQueuedAt)
  const nowMs = input.nowMs ?? Date.now()
  return {
    queueDepth: storage.queueDepth,
    queueAgeMs: Number.isFinite(oldestQueuedMs)
      ? Math.max(0, nowMs - oldestQueuedMs)
      : null,
    pendingChunkCount: storage.pendingChunkCount,
    staleChunkCount: storage.staleChunkCount,
    freshChunkCount: storage.freshChunkCount,
    pendingInvalidationCount: storage.pendingInvalidationCount,
    lastEnumerationDurationMs: storage.lastEnumerationDurationMs,
    lastBuildDurationMs: storage.lastBuildDurationMs,
    deliveryMapSize: Object.keys(input.state.delivered).length,
    lastErrorClass: input.state.lastErrorClass ?? null,
    retryableStaleCount: input.state.retryableStaleCount ?? 0,
  }
}

const MALFORMED_SEQUENCE_PREFIX = 'coverage-malformed-sequence:'

/**
 * Accepts a coverage change sequence only as a non-negative safe integer. The
 * main process normalizes sequences, but the renderer must not trust a value
 * that would make `Math.max` comparisons NaN or let a bogus revision outrank
 * real ones [DON-335]. Fails as a visible coverage error.
 */
export function requireCoverageSequence(value: unknown, source: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${MALFORMED_SEQUENCE_PREFIX} ${source} carried an invalid change sequence.`)
  }
}

/** Classifies coverage failures without retaining raw error text. */
export function classifyCoverageError(error: unknown): CoverageErrorClass {
  const message = error instanceof Error ? error.message.toLowerCase() : ''
  if (isCoverageCancellation(error)) return 'cancelled'
  if (message.includes(MALFORMED_SEQUENCE_PREFIX)) return 'malformed_sequence'
  if (message.includes('chunk-stale') || message.includes('coverage-revision-moved:')) return 'chunk_stale'
  if (message.includes('timed out') || message.includes('timeout')) return 'timeout'
  if (message.includes('worker')) return 'worker'
  if (message.includes('unavailable') || message.includes('not available')) {
    return 'runtime_unavailable'
  }
  return 'unknown'
}

/** Recognizes native cancellation even when Electron preserves only its message. */
export function isCoverageCancellation(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.message.includes('coverage-cancelled:'))
}
