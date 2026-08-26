import { describe, expect, it } from 'vitest'

import {
  DEFAULT_MISSION_MODEL_ENABLED,
  resolveMissionModelFlag,
} from '../../src/features/runtime/mission-model-flag'

describe('mission model internal feature flag', () => {
  it('uses the reviewed release default unless the internal build flag is explicit', () => {
    expect(resolveMissionModelFlag({
      dev: false,
      browserHarness: false,
      buildFlag: undefined,
    })).toBe(DEFAULT_MISSION_MODEL_ENABLED)

    expect(resolveMissionModelFlag({
      dev: false,
      browserHarness: false,
      buildFlag: '1',
    })).toBe(true)
  })

  it('is enabled for development and isolated browser-harness validation', () => {
    expect(resolveMissionModelFlag({
      dev: true,
      browserHarness: false,
      buildFlag: undefined,
    })).toBe(true)

    expect(resolveMissionModelFlag({
      dev: false,
      browserHarness: true,
      buildFlag: undefined,
    })).toBe(true)
  })

  it('lets an explicit internal zero fail closed even during development', () => {
    expect(resolveMissionModelFlag({
      dev: true,
      browserHarness: true,
      buildFlag: '0',
    })).toBe(false)
  })

  it('keeps browser validation explicitly opt-in after the release default flips', () => {
    expect(resolveMissionModelFlag({
      dev: false,
      browserHarnessMode: true,
      browserHarness: false,
      buildFlag: undefined,
    })).toBe(false)
    expect(resolveMissionModelFlag({
      dev: false,
      browserHarnessMode: true,
      browserHarness: true,
      buildFlag: undefined,
    })).toBe(true)
    expect(resolveMissionModelFlag({
      dev: false,
      browserHarnessMode: true,
      browserHarness: false,
      buildFlag: '1',
    })).toBe(true)
  })
})
