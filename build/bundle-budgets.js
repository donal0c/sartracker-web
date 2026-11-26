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
  {
    // DON-353: with the classic layout chunk gone, Rolldown folds the shared
    // chunks into main, so first-paint JS moved into one file rather than
    // grew: about 575 KB before (main 443 KB + shared 132 KB) and after.
    // Review stays in main on purpose (PR 76 loads it at startup so the first
    // press is never lost), so the main chunk gets its own bound.
    // DON-368: the folded people controls and docked All devices added about
    // 2 KB (601.5 KB); the bound moves to 610 KB rather than splitting Mission.
    // DON-371 wave 1 (PRs 110-115: Finish refusal, not-connected headline,
    // Irish Grid first, removed people, stationary line) took main to 614.1 KB;
    // the bound moves to 620 KB rather than splitting first-paint code.
    pattern: /^index-.*\.js$/,
    maxBytes: 620_000,
    reason: 'Main chunk holds first-paint JS, including Review loaded at startup (PR 76).',
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
