import { createRequire } from 'node:module'

import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { applyTrackingSoakRuntimeOverride } = require(
  '../../electron/tracking-soak-validation.cjs',
) as {
  readonly applyTrackingSoakRuntimeOverride: (
    runtimeSettings: Record<string, unknown>,
    options: {
      readonly validationUserDataPath?: string
      readonly intervalInput?: string
    },
  ) => Record<string, unknown>
}

const BASE_SETTINGS = {
  trackingPollIntervalMs: 5_000,
  trackingConfig: null,
}

describe('Electron tracking soak validation boundary [DON-246]', () => {
  it('leaves production and ordinary validation polling unchanged', () => {
    expect(
      applyTrackingSoakRuntimeOverride(BASE_SETTINGS, {
        intervalInput: '25',
      }),
    ).toBe(BASE_SETTINGS)
    expect(
      applyTrackingSoakRuntimeOverride(BASE_SETTINGS, {
        validationUserDataPath: '/tmp/isolated-profile',
      }),
    ).toBe(BASE_SETTINGS)
  })

  it('allows a bounded accelerated interval only for an isolated validation profile', () => {
    expect(
      applyTrackingSoakRuntimeOverride(BASE_SETTINGS, {
        validationUserDataPath: '/tmp/isolated-profile',
        intervalInput: '25',
      }),
    ).toEqual({
      ...BASE_SETTINGS,
      trackingPollIntervalMs: 25,
      trackingMinimumPollIntervalMs: 25,
    })
  })

  it('fails closed for malformed or dangerously short soak intervals', () => {
    for (const intervalInput of ['not-a-number', '0', '4', '1001']) {
      expect(() =>
        applyTrackingSoakRuntimeOverride(BASE_SETTINGS, {
          validationUserDataPath: '/tmp/isolated-profile',
          intervalInput,
        }),
      ).toThrow(/soak poll interval/i)
    }
  })
})
