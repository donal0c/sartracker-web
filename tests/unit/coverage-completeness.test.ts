import { createRequire } from 'node:module'

import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { calculateCoverageProgress, evaluateCoverageClaim } = require(
  '../../electron/coverage-completeness.cjs',
) as {
  readonly calculateCoverageProgress: (input: CoverageInput) => CoverageProgress
  readonly evaluateCoverageClaim: (input: CoverageInput & ClaimContext) => {
    readonly complete: boolean
    readonly blockers: readonly string[]
    readonly progress: CoverageProgress
    readonly changeSeq: number
    readonly chunkRevisions: readonly { readonly key: string; readonly contentRev: number }[]
  }
}

type Chunk = {
  readonly key: string
  readonly contentRev: number
  readonly builtRev: number | null
  readonly fixCount: number | null
  readonly exactCount: number
}

type CoverageInput = {
  readonly chunks: readonly Chunk[]
  readonly delivered: Readonly<Record<string, number>>
}

type ClaimContext = {
  readonly changeSeq: number
  readonly enumerated: boolean
  readonly pendingInvalidation: boolean
  readonly ingestOutboxPending: boolean
  readonly ingestHealth: 'healthy' | 'degraded' | 'critical'
  readonly backfillIncomplete: boolean
  readonly missionId: string
  readonly expectedMissionId: string
  readonly generation: number
  readonly expectedGeneration: number
}

type CoverageProgress = {
  readonly deliveredFixes: number
  readonly totalFixes: number
  readonly percent: number
}

describe('coverage completeness', () => {
  it('counts delivery only when a fresh selected chunk is delivered at its exact revision', () => {
    const chunks = [
      chunk('fresh-delivered', 2, 2, 8, 8),
      chunk('fresh-undelivered', 1, 1, 5, 5),
      chunk('stale-old-delivery', 3, 2, 4, 6),
      chunk('pending', 1, null, null, 3),
    ]

    expect(calculateCoverageProgress({
      chunks,
      delivered: {
        'fresh-delivered': 2,
        'fresh-undelivered': 0,
        'stale-old-delivery': 2,
        pending: 1,
      },
    })).toEqual({ deliveredFixes: 8, totalFixes: 22, percent: 36 })
  })

  it.each([
    ['not_enumerated', { enumerated: false }],
    ['pending_invalidation', { pendingInvalidation: true }],
    ['chunk_not_fresh', { chunks: [chunk('one', 2, 1, 4, 5)] }],
    ['chunk_not_delivered', { delivered: {} }],
    ['ingest_outbox_pending', { ingestOutboxPending: true }],
    ['ingest_health_degraded', { ingestHealth: 'degraded' as const }],
    ['backfill_incomplete', { backfillIncomplete: true }],
    ['mission_mismatch', { expectedMissionId: 'other-mission' }],
    ['generation_mismatch', { expectedGeneration: 2 }],
  ])('blocks Complete for %s', (blocker, override) => {
    const result = evaluateCoverageClaim({ ...completeInput(), ...override })

    expect(result.complete).toBe(false)
    expect(result.blockers).toContain(blocker)
  })

  it('does not confuse a fully built ledger with renderer delivery', () => {
    const result = evaluateCoverageClaim({ ...completeInput(), delivered: {} })

    expect(result.progress).toEqual({ deliveredFixes: 0, totalFixes: 5, percent: 0 })
    expect(result.blockers).toContain('chunk_not_delivered')
    expect(result.complete).toBe(false)
  })

  it('allows honest progress to decrease after a late fix and restart', () => {
    const before = calculateCoverageProgress({
      chunks: [chunk('one', 1, 1, 5, 5)],
      delivered: { one: 1 },
    })
    const afterLateFix = calculateCoverageProgress({
      chunks: [chunk('one', 2, 1, 5, 6)],
      delivered: { one: 1 },
    })
    const afterRestart = calculateCoverageProgress({
      chunks: [chunk('one', 1, 1, 5, 5)],
      delivered: {},
    })

    expect(before.percent).toBe(100)
    expect(afterLateFix.percent).toBe(0)
    expect(afterLateFix.totalFixes).toBe(6)
    expect(afterRestart.percent).toBe(0)
  })

  it('uses only selected chunks and handles an empty zero-fix selection', () => {
    expect(calculateCoverageProgress({
      chunks: [chunk('zero', 1, 1, 0, 0)],
      delivered: { zero: 1 },
    })).toEqual({ deliveredFixes: 0, totalFixes: 0, percent: 100 })

    const empty = evaluateCoverageClaim({
      ...completeInput(),
      chunks: [],
      delivered: {},
    })
    expect(empty.complete).toBe(true)
    expect(empty.progress).toEqual({ deliveredFixes: 0, totalFixes: 0, percent: 100 })
  })

  it('returns the exact sequence and selected revision attestation when complete', () => {
    expect(evaluateCoverageClaim(completeInput())).toEqual({
      complete: true,
      blockers: [],
      progress: { deliveredFixes: 5, totalFixes: 5, percent: 100 },
      changeSeq: 7,
      chunkRevisions: [{ key: 'one', contentRev: 1 }],
    })
  })
})

function completeInput(): CoverageInput & ClaimContext {
  return {
    chunks: [chunk('one', 1, 1, 5, 5)],
    delivered: { one: 1 },
    changeSeq: 7,
    enumerated: true,
    pendingInvalidation: false,
    ingestOutboxPending: false,
    ingestHealth: 'healthy',
    backfillIncomplete: false,
    missionId: 'mission-1',
    expectedMissionId: 'mission-1',
    generation: 1,
    expectedGeneration: 1,
  }
}

function chunk(
  key: string,
  contentRev: number,
  builtRev: number | null,
  fixCount: number | null,
  exactCount: number,
): Chunk {
  return { key, contentRev, builtRev, fixCount, exactCount }
}
