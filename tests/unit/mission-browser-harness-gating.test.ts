import { describe, expect, it } from 'vitest'

import { shouldEnableMissionBrowserHarnessForContext } from '../../src/features/mission/mission-browser-harness'

describe('mission browser harness gating', () => {
  it('enables hosted browser testing mode for non-Tauri production builds when explicitly requested', () => {
    expect(
      shouldEnableMissionBrowserHarnessForContext({
        search: '?missionHarness=1',
        dev: false,
        tauriAvailable: false,
        electronAvailable: false,
      }),
    ).toBe(true)
  })

  it('does not enable hosted browser testing mode without the explicit query flag', () => {
    expect(
      shouldEnableMissionBrowserHarnessForContext({
        search: '',
        dev: false,
        tauriAvailable: false,
        electronAvailable: false,
      }),
    ).toBe(false)
  })

  it('does not let a production Tauri runtime fall back to the browser harness', () => {
    expect(
      shouldEnableMissionBrowserHarnessForContext({
        search: '?missionHarness=1',
        dev: false,
        tauriAvailable: true,
        electronAvailable: false,
      }),
    ).toBe(false)
  })

  it('does not let a production Electron runtime fall back to the browser harness', () => {
    expect(
      shouldEnableMissionBrowserHarnessForContext({
        search: '?missionHarness=1',
        dev: false,
        tauriAvailable: false,
        electronAvailable: true,
      }),
    ).toBe(false)
  })
})
