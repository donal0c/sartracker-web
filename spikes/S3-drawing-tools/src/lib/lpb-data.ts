/**
 * Lost Person Behavior (LPB) statistics for SAR operations.
 *
 * Distances in metres for each probability percentile.
 * Based on Robert Koester's "Lost Person Behavior" reference data
 * adapted for Irish/UK terrain and conditions.
 */

export interface LPBCategory {
  label: string;
  description: string;
  /** Distance in metres for each percentile ring */
  distances: {
    p25: number;
    p50: number;
    p75: number;
    p95: number;
  };
}

export const LPB_CATEGORIES: Record<string, LPBCategory> = {
  child_1_3: {
    label: 'Child (1-3 years)',
    description: 'Very young child, limited mobility',
    distances: { p25: 100, p50: 300, p75: 700, p95: 1800 },
  },
  child_4_6: {
    label: 'Child (4-6 years)',
    description: 'Young child, more mobile',
    distances: { p25: 200, p50: 500, p75: 1200, p95: 3200 },
  },
  child_7_12: {
    label: 'Child (7-12 years)',
    description: 'Older child, active',
    distances: { p25: 300, p50: 900, p75: 2000, p95: 5000 },
  },
  hiker: {
    label: 'Hiker',
    description: 'Day hiker or hill walker',
    distances: { p25: 1000, p50: 2000, p75: 4000, p95: 10000 },
  },
  elderly: {
    label: 'Elderly (65+)',
    description: 'Elderly person, may be confused',
    distances: { p25: 200, p50: 600, p75: 1500, p95: 4000 },
  },
  dementia: {
    label: 'Dementia/Alzheimer',
    description: 'Person with cognitive impairment',
    distances: { p25: 200, p50: 500, p75: 1200, p95: 3500 },
  },
  despondent: {
    label: 'Despondent',
    description: 'Person in mental health crisis',
    distances: { p25: 100, p50: 400, p75: 1000, p95: 4000 },
  },
  hunter: {
    label: 'Hunter/Fisher',
    description: 'Outdoor sportsperson',
    distances: { p25: 500, p50: 1500, p75: 3000, p95: 8000 },
  },
  runner: {
    label: 'Trail Runner',
    description: 'Active trail runner',
    distances: { p25: 1500, p50: 3000, p75: 6000, p95: 15000 },
  },
  mountain_climber: {
    label: 'Mountain Climber',
    description: 'Experienced mountaineer',
    distances: { p25: 800, p50: 2000, p75: 4000, p95: 12000 },
  },
};

/** Colors for LPB percentile rings (inner to outer) */
export const LPB_RING_COLORS = {
  p25: '#22c55e', // green
  p50: '#eab308', // yellow
  p75: '#f97316', // orange
  p95: '#ef4444', // red
} as const;
