import { describe, expect, it } from 'vitest'

import { LPB_CATEGORIES, LPB_RING_COLORS } from '../../src/features/drawings/lpb-data'

describe('LPB data', () => {
  it('contains the locked categories and monotonically increasing distances', () => {
    expect(Object.keys(LPB_CATEGORIES)).toHaveLength(9)

    for (const category of Object.values(LPB_CATEGORIES)) {
      expect(category.distances.p25).toBeLessThan(category.distances.p50)
      expect(category.distances.p50).toBeLessThan(category.distances.p75)
      expect(category.distances.p75).toBeLessThan(category.distances.p95)
    }
  })

  it('uses the locked ring colors', () => {
    expect(LPB_RING_COLORS).toEqual({
      p25: '#22C55E',
      p50: '#EAB308',
      p75: '#F97316',
      p95: '#EF4444',
    })
  })
})
