// @vitest-environment node
import { describe, expect, it } from 'vitest'

import {
  assertExactlyThreeMutationSeams,
  runWar02bMutationBaseline,
} from './mutation-baseline'

describe('WAR-02B bounded mutation baseline', () => {
  it('covers exactly three approved safety seams and kills every current baseline mutant', async () => {
    const outcomes = await runWar02bMutationBaseline()

    assertExactlyThreeMutationSeams(outcomes)
    expect(outcomes).toHaveLength(4)
    expect(outcomes.every((outcome) => outcome.status === 'killed')).toBe(true)
    expect(outcomes.map(({ id }) => id)).toEqual([
      'coordinate-tm65-golden-anchor-perturbation',
      'cursor-public-boundary-fault-injection',
      'ingest-timestamp-without-normalization',
      'ingest-unversioned-hash-integrity',
    ])
    for (const outcome of outcomes) {
      expect(outcome.numRuns).toBeGreaterThanOrEqual(1)
      expect(outcome.numRuns).toBeLessThanOrEqual(outcome.runBudget)
    }
    expect(outcomes).toEqual([
      expect.objectContaining({ seam: 'coordinate-transform', seed: 2026091201, runBudget: 50 }),
      expect.objectContaining({ seam: 'cursor-window-arithmetic', seed: 2026091202, runBudget: 25 }),
      expect.objectContaining({ seam: 'position-ingest-policy', seed: 2026091203, runBudget: 100 }),
      expect.objectContaining({ seam: 'position-ingest-policy', seed: 2026091204, runBudget: 100 }),
    ])
  })
})
