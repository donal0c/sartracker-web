import { describe, expect, it } from 'vitest'

import { shouldUseClassicLayoutFixtureForContext } from '../../src/features/workspace/classic-layout-fixture'

/**
 * The old screen survives only as a browser-test fixture while the e2e suite
 * moves to the new layout (DON-341). Operators must never be able to reach it.
 */
describe('classic layout fixture gate [DON-341]', () => {
  it('is used only inside the browser test harness with classicLayout=1', () => {
    expect(shouldUseClassicLayoutFixtureForContext({ search: '?missionHarness=1&classicLayout=1', harnessEnabled: true })).toBe(true)
  })

  it('is never used outside the harness, whatever the address says', () => {
    expect(shouldUseClassicLayoutFixtureForContext({ search: '?missionHarness=1&classicLayout=1', harnessEnabled: false })).toBe(false)
    expect(shouldUseClassicLayoutFixtureForContext({ search: '?classicLayout=1', harnessEnabled: false })).toBe(false)
  })

  it('defaults to the new layout inside the harness', () => {
    expect(shouldUseClassicLayoutFixtureForContext({ search: '?missionHarness=1', harnessEnabled: true })).toBe(false)
    expect(shouldUseClassicLayoutFixtureForContext({ search: '?missionHarness=1&classicLayout=0', harnessEnabled: true })).toBe(false)
  })
})
