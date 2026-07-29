import { describe, expect, it } from 'vitest'

import { buildTrackingSoakCiRunnerArgs } from '../../build/electron-tracking-soak-ci-lib.js'

describe('tracking soak CI runner arguments', () => {
  it('enables the same software-rendering path as the Linux launch smoke', () => {
    expect(
      buildTrackingSoakCiRunnerArgs({
        appPath: '/tmp/sartracker-web',
        platform: 'linux',
        projectRoot: '/repo',
      }),
    ).toEqual([
      '/repo/scripts/electron-tracking-soak.mjs',
      '--app',
      '/tmp/sartracker-web',
      '--profile',
      'ci',
      '--evidence',
      '/repo/tmp/beta-artifacts/tracking-soak-ci',
      '--',
      '--no-sandbox',
      '--ignore-gpu-blocklist',
      '--enable-unsafe-swiftshader',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
    ])
  })

  it('does not add Linux-only launch arguments on macOS', () => {
    expect(
      buildTrackingSoakCiRunnerArgs({
        appPath: '/tmp/SAR Tracker',
        platform: 'darwin',
        projectRoot: '/repo',
      }),
    ).toEqual([
      '/repo/scripts/electron-tracking-soak.mjs',
      '--app',
      '/tmp/SAR Tracker',
      '--profile',
      'ci',
      '--evidence',
      '/repo/tmp/beta-artifacts/tracking-soak-ci',
    ])
  })
})
