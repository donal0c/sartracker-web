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
  it.each(['outing', 'unassigned'])('preserves exact stored origins in %s pages [DON-254]', (periodKind) => {
    const query = { kind: 'chunk-page', missionId: 'mission-1', expectedContentRev: 1, limit: 2,
      key: { device_id: 'device-1', period_kind: periodKind, period_id: periodKind === 'outing' ? 'outing-1' : '' } }
    const result = { key: query.key, contentRev: 1, nextCursor: null, positions: ['live', 'cache'].map((origin, index) => ({
      id: `position-${index}`, source_position_id: null, device_id: 'device-1',
      timestamp: `2026-08-24T10:0${index}:00.000Z`, lat: 52, lon: -9.7, data_origin: origin,
    })) }
    expect(normalizeCoverageWorkerResult(query, result)).toEqual(result)
    for (const invalid of [undefined, null, '', 'invented']) {
      expect(() => normalizeCoverageWorkerResult(query, {
        ...result, positions: [{ ...result.positions[0], data_origin: invalid }],
      })).toThrow(/position is invalid/iu)
    }
  })
  it('transports the durable reconciliation blocker without accepting a complete claim', () => {
    const result = { changeSeq: 1, databaseReady: false, blockers: ['history_reconciliation_incomplete'], chunkRevisions: [] }
    expect(normalizeCoverageWorkerResult({ kind: 'claim', missionId: 'm', selectedKeys: [] }, result)).toEqual(result)
  })
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
