import { describe, expect, it } from 'vitest'

import { resolveCoverageFlag } from '../../src/features/runtime/coverage-flag'

describe('coverage internal flag [DON-276]', () => {
  it('stays fail-closed until the separate G3 default-flip commit', () => {
    expect(resolveCoverageFlag({ buildFlag: undefined, browserHarness: false })).toBe(false)
    expect(resolveCoverageFlag({ buildFlag: '0', browserHarness: true })).toBe(false)
    expect(resolveCoverageFlag({ buildFlag: '1', browserHarness: false })).toBe(true)
    expect(resolveCoverageFlag({ buildFlag: undefined, browserHarness: true })).toBe(true)
  })
})
