import { describe, expect, it } from 'vitest'

import { calculateCoverageProgress } from '../../src/features/tracking/coverage-progress'
import type { CoverageManifestChunk } from '../../src/infrastructure/mission-store/tauri-mission-store'

describe('coverage progress [DON-275]', () => {
  it('counts only current fresh revisions that the renderer actually delivered', () => {
    expect(calculateCoverageProgress({
      chunks: [
        chunk('fresh-delivered', 2, 2, 8, 8),
        chunk('fresh-undelivered', 1, 1, 5, 5),
        chunk('stale-old-delivery', 3, 2, 4, 6),
        chunk('pending', 1, null, null, 3),
      ],
      delivered: {
        [identity('fresh-delivered')]: 2,
        [identity('fresh-undelivered')]: 0,
        [identity('stale-old-delivery')]: 2,
        [identity('pending')]: 1,
      },
    })).toEqual({ deliveredFixCount: 8, totalFixCount: 22 })
  })

  it('honestly decreases after a late fix or renderer restart', () => {
    expect(calculateCoverageProgress({
      chunks: [chunk('one', 2, 1, 5, 6)],
      delivered: { [identity('one')]: 1 },
    })).toEqual({ deliveredFixCount: 0, totalFixCount: 6 })

    expect(calculateCoverageProgress({
      chunks: [chunk('one', 1, 1, 5, 5)],
      delivered: {},
    })).toEqual({ deliveredFixCount: 0, totalFixCount: 5 })
  })

  it('keeps an exact zero-fix selection honest', () => {
    expect(calculateCoverageProgress({
      chunks: [chunk('zero', 1, 1, 0, 0)],
      delivered: { [identity('zero')]: 1 },
    })).toEqual({ deliveredFixCount: 0, totalFixCount: 0 })
  })
})

function chunk(
  periodId: string,
  contentRev: number,
  builtRev: number | null,
  fixCount: number | null,
  exactCount: number,
): CoverageManifestChunk {
  return {
    key: { device_id: 'device-1', period_kind: 'outing', period_id: periodId },
    contentRev,
    builtRev,
    fixCount,
    exactCount,
    fixDigest: builtRev === contentRev ? 'fresh-digest' : 'stale-digest',
  }
}

function identity(periodId: string): string {
  return `device-1\u0000outing\u0000${periodId}`
}
