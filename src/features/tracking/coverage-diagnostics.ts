import type { CoverageState } from './coverage-controller'

export type CoverageErrorClass =
  | 'cancelled'
  | 'chunk_stale'
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
  }
}

/** Classifies coverage failures without retaining raw error text. */
export function classifyCoverageError(error: unknown): CoverageErrorClass {
  const message = error instanceof Error ? error.message.toLowerCase() : ''
  if (error instanceof Error && error.name === 'AbortError') return 'cancelled'
  if (message.includes('chunk-stale')) return 'chunk_stale'
  if (message.includes('timed out') || message.includes('timeout')) return 'timeout'
  if (message.includes('worker')) return 'worker'
  if (message.includes('unavailable') || message.includes('not available')) {
    return 'runtime_unavailable'
  }
  return 'unknown'
}
