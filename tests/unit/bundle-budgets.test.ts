import { describe, expect, it } from 'vitest'

import { DEFAULT_BUNDLE_BUDGET_BYTES, getBundleBudget } from '../../build/bundle-budgets.js'

describe('bundle budgets', () => {
  it('uses the default budget for other application chunks', () => {
    expect(getBundleBudget('mission-review-abc123.js').maxBytes).toBe(DEFAULT_BUNDLE_BUDGET_BYTES)
  })

  it('bounds the main entry chunk at 610 KB: 600 KB after the classic layout went [DON-353], plus the folded people controls and docked All devices [DON-368]', () => {
    expect(getBundleBudget('index-abc123.js').maxBytes).toBe(610_000)
  })

  it('allows the isolated MapLibre vendor chunk a dedicated budget', () => {
    expect(getBundleBudget('map-vendor-abc123.js').maxBytes).toBe(1_100_000)
  })

  it('keeps the isolated MapLibre stylesheet on a tighter budget', () => {
    expect(getBundleBudget('map-vendor-abc123.css').maxBytes).toBe(100_000)
  })
})
