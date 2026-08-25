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

  it('keeps browser validation explicitly opt-in after the release default flips', () => {
    expect(resolveCoverageFlag({
      buildFlag: undefined,
      browserHarnessMode: true,
      browserHarness: false,
    })).toBe(false)
    expect(resolveCoverageFlag({
      buildFlag: undefined,
      browserHarnessMode: true,
      browserHarness: true,
    })).toBe(true)
    expect(resolveCoverageFlag({
      buildFlag: '1',
      browserHarnessMode: true,
      browserHarness: false,
    })).toBe(true)
  })
})
