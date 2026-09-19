import { describe, expect, it } from 'vitest'

import { DEFAULT_BUNDLE_BUDGET_BYTES, getBundleBudget } from '../../build/bundle-budgets.js'

describe('bundle budgets', () => {
  it('uses the default budget for application chunks', () => {
    expect(getBundleBudget('index-abc123.js').maxBytes).toBe(DEFAULT_BUNDLE_BUDGET_BYTES)
  })

  it('allows the isolated MapLibre vendor chunk a dedicated budget', () => {
    expect(getBundleBudget('map-vendor-abc123.js').maxBytes).toBe(1_100_000)
  })

  it('keeps the isolated MapLibre stylesheet on a tighter budget', () => {
    expect(getBundleBudget('map-vendor-abc123.css').maxBytes).toBe(100_000)
  })
})
