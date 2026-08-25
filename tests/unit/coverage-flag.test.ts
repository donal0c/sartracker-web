import { describe, expect, it } from 'vitest'

import {
  DEFAULT_COVERAGE_ENABLED,
  resolveCoverageFlag,
} from '../../src/features/runtime/coverage-flag'

describe('coverage internal flag [DON-276]', () => {
  it('uses the reviewed release default unless an internal override applies', () => {
    expect(resolveCoverageFlag({ buildFlag: undefined, browserHarness: false }))
      .toBe(DEFAULT_COVERAGE_ENABLED)
    expect(resolveCoverageFlag({ buildFlag: '0', browserHarness: true })).toBe(false)
    expect(resolveCoverageFlag({ buildFlag: '1', browserHarness: false })).toBe(true)
    expect(resolveCoverageFlag({ buildFlag: undefined, browserHarness: true })).toBe(true)
  })
})
