export const DEFAULT_BUNDLE_BUDGET_BYTES = 500_000

export const BUNDLE_BUDGETS = [
  {
    pattern: /^map-vendor-.*\.js$/,
    maxBytes: 1_100_000,
    reason: 'MapLibre GL ships as a large vendor artifact and is intentionally isolated.',
  },
  {
    pattern: /^map-vendor-.*\.css$/,
    maxBytes: 100_000,
    reason: 'MapLibre CSS is expected but should remain bounded.',
  },
]

export function getBundleBudget(filename) {
  return (
    BUNDLE_BUDGETS.find((budget) => budget.pattern.test(filename)) ?? {
      pattern: /.*/,
      maxBytes: DEFAULT_BUNDLE_BUDGET_BYTES,
      reason: 'Default application chunk budget.',
    }
  )
}
