import { createRequire } from 'node:module'

import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { assertCoverageWorkerResultCardinality, normalizeCoverageWorkerResult } = require(
  '../../electron/coverage-query-result-envelope.cjs',
) as {
  readonly assertCoverageWorkerResultCardinality: (
    query: Readonly<Record<string, unknown>>,
    result: Readonly<Record<string, unknown>>,
    limits?: Readonly<Record<string, number>>,
  ) => void
  readonly normalizeCoverageWorkerResult: (
    query: Readonly<Record<string, unknown>>,
    result: Readonly<Record<string, unknown>>,
    limits?: Readonly<Record<string, number>>,
  ) => Readonly<Record<string, unknown>>
}

describe('coverage query result envelope', () => {
  it('rejects an over-limit manifest array before traversing any item', () => {
    const first = {
      get id(): string {
        throw new Error('deep traversal reached')
      },
    }
    const result = {
      changeSeq: 1,
      enumerated: true,
      pendingInvalidation: false,
      backfillIncomplete: false,
      diagnostics: {
        queueDepth: 0,
        oldestQueuedAt: null,
        pendingChunkCount: 0,
        staleChunkCount: 0,
        freshChunkCount: 0,
        pendingInvalidationCount: 0,
      },
      outings: [first, first],
      chunks: [],
    }

    expect(() => normalizeCoverageWorkerResult(
      { kind: 'manifest', missionId: 'mission-1' },
      result,
      { maxOutings: 1, maxChunks: 0 },
    )).toThrow(/coverage manifest result.*item list/iu)
  })

  it('preflights worker cardinality before a result crosses the thread boundary', () => {
    const first = {
      get id(): string {
        throw new Error('structured clone reached')
      },
    }

    expect(() => assertCoverageWorkerResultCardinality(
      { kind: 'manifest', missionId: 'mission-1' },
      { outings: [first], chunks: [] },
      { maxOutings: 0, maxChunks: 0 },
    )).toThrow(/coverage manifest result.*item list/iu)
  })
})
