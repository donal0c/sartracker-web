// @vitest-environment node
import { describe, expect, it } from 'vitest'

import {
  assertExactlyThreeMutationSeams,
  runWar02bMutationBaseline,
} from './mutation-baseline'

describe('WAR-02B bounded mutation baseline', () => {
  it('covers exactly three approved safety seams and records survivors', async () => {
    const outcomes = await runWar02bMutationBaseline()

    assertExactlyThreeMutationSeams(outcomes)
    expect(outcomes).toEqual([
      expect.objectContaining({
        id: 'coordinate-easting-plus-one-metre',
        seam: 'coordinate-transform',
        status: 'killed',
        seed: 2026091201,
        runBudget: 50,
        numRuns: 1,
      }),
      expect.objectContaining({
        id: 'cursor-plus-one-second',
        seam: 'cursor-window-arithmetic',
        status: 'killed',
        seed: 2026091202,
        runBudget: 25,
        numRuns: 1,
      }),
      expect.objectContaining({
        id: 'ingest-timestamp-without-normalization',
        seam: 'position-ingest-policy',
        status: 'killed',
        seed: 2026091203,
        runBudget: 100,
        numRuns: 4,
      }),
      expect.objectContaining({
        id: 'ingest-legacy-prefix-conflict-uncovered',
        seam: 'position-ingest-policy',
        status: 'survived',
        seed: 2026091204,
        runBudget: 100,
        numRuns: 100,
      }),
    ])
  })
})
