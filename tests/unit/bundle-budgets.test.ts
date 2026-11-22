import { describe, expect, it } from 'vitest'

import { DEFAULT_BUNDLE_BUDGET_BYTES, getBundleBudget } from '../../build/bundle-budgets.js'

describe('bundle budgets', () => {
  it('uses the default budget for other application chunks', () => {
    expect(getBundleBudget('mission-review-abc123.js').maxBytes).toBe(DEFAULT_BUNDLE_BUDGET_BYTES)
  })

  it('bounds the main entry chunk at 600 KB now the classic layout is gone [DON-353]', () => {
    expect(getBundleBudget('index-abc123.js').maxBytes).toBe(600_000)
  })

  it('allows the isolated MapLibre vendor chunk a dedicated budget', () => {
    expect(getBundleBudget('map-vendor-abc123.js').maxBytes).toBe(1_100_000)
  })

  it('keeps the isolated MapLibre stylesheet on a tighter budget', () => {
    expect(getBundleBudget('map-vendor-abc123.css').maxBytes).toBe(100_000)
  })
})
