import { describe, expect, it } from 'vitest'

import { summarizeCoverageDiagnostics } from '../../src/features/tracking/coverage-diagnostics'

describe('coverage diagnostics [DON-276]', () => {
  it('reports only bounded counts, timings, delivery size, and an allow-listed error class', () => {
    const diagnostics = summarizeCoverageDiagnostics({
      nowMs: Date.parse('2026-08-24T12:05:00.000Z'),
      state: {
        status: 'error',
        missionId: 'mission-secret',
        rendererGeneration: 'renderer-secret',
        changeSeq: 8,
        latestObservedChangeSeq: 8,
        manifest: {
          changeSeq: 8,
          enumerated: true,
          pendingInvalidation: true,
          backfillIncomplete: false,
          outings: [],
          chunks: [],
          diagnostics: {
            queueDepth: 3,
            oldestQueuedAt: '2026-08-24T12:03:00.000Z',
            pendingChunkCount: 1,
            staleChunkCount: 2,
            freshChunkCount: 7,
            pendingInvalidationCount: 2,
            lastEnumerationDurationMs: 81,
            lastBuildDurationMs: 240,
          },
        },
        tileCatalog: null,
        delivered: {
          'private-device-key': 4,
          'another-private-device-key': 2,
        },
        deliveredFixCount: 4,
        totalFixCount: 10,
        lastErrorClass: 'timeout',
        message: 'Coverage tile worker failed at /Users/donal/secret and 52.123,-9.456',
      },
    })

    expect(diagnostics).toEqual({
      queueDepth: 3,
      queueAgeMs: 120_000,
      pendingChunkCount: 1,
      staleChunkCount: 2,
      freshChunkCount: 7,
      pendingInvalidationCount: 2,
      lastEnumerationDurationMs: 81,
      lastBuildDurationMs: 240,
      deliveryMapSize: 2,
      lastErrorClass: 'timeout',
    })
    expect(JSON.stringify(diagnostics)).not.toContain('private-device')
    expect(JSON.stringify(diagnostics)).not.toContain('/Users')
    expect(JSON.stringify(diagnostics)).not.toContain('52.123')
  })
})
