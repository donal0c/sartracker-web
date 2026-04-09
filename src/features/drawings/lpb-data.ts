export type LpbPercentile = 'p25' | 'p50' | 'p75' | 'p95'

export type LpbCategoryId =
  | 'child_1_3'
  | 'child_4_6'
  | 'child_7_12'
  | 'hiker'
  | 'hunter'
  | 'elderly'
  | 'dementia'
  | 'despondent'
  | 'autistic'

export type LpbCategory = {
  readonly label: string
  readonly distances: Record<LpbPercentile, number>
}

export const LPB_CATEGORIES: Record<LpbCategoryId, LpbCategory> = {
  child_1_3: {
    label: 'Child (1-3 years)',
    distances: { p25: 100, p50: 300, p75: 700, p95: 1900 },
  },
  child_4_6: {
    label: 'Child (4-6 years)',
    distances: { p25: 200, p50: 500, p75: 1100, p95: 2400 },
  },
  child_7_12: {
    label: 'Child (7-12 years)',
    distances: { p25: 500, p50: 1300, p75: 2500, p95: 3800 },
  },
  hiker: {
    label: 'Hiker',
    distances: { p25: 800, p50: 2000, p75: 4000, p95: 8000 },
  },
  hunter: {
    label: 'Hunter',
    distances: { p25: 1200, p50: 3000, p75: 5500, p95: 10000 },
  },
  elderly: {
    label: 'Elderly',
    distances: { p25: 200, p50: 500, p75: 1200, p95: 2500 },
  },
  dementia: {
    label: 'Dementia',
    distances: { p25: 100, p50: 300, p75: 800, p95: 2000 },
  },
  despondent: {
    label: 'Despondent',
    distances: { p25: 200, p50: 500, p75: 1500, p95: 3000 },
  },
  autistic: {
    label: 'Autistic',
    distances: { p25: 200, p50: 600, p75: 1200, p95: 2000 },
  },
}

export const LPB_RING_COLORS: Record<LpbPercentile, string> = {
  p25: '#22C55E',
  p50: '#EAB308',
  p75: '#F97316',
  p95: '#EF4444',
}

export const LPB_PERCENTILE_ORDER: readonly LpbPercentile[] = ['p25', 'p50', 'p75', 'p95']
