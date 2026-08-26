import { describe, expect, it } from 'vitest'

import {
  buildTrackingSoakCiEnvironment,
  buildTrackingSoakCiRunnerArgs,
} from '../../build/electron-tracking-soak-ci-lib.js'

describe('tracking soak CI runner arguments', () => {
  it('selects Mesa-compatible ANGLE rendering for the Linux timing gate', () => {
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
      '--main-stall-threshold-ms',
      '200',
      '--',
      '--no-sandbox',
      '--ignore-gpu-blocklist',
      '--use-gl=angle',
      '--use-angle=gl',
      '--disable-features=Vulkan,DefaultANGLEVulkan,VulkanFromANGLE',
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
      '--main-stall-threshold-ms',
      '200',
    ])
  })

  it('forces Mesa llvmpipe only for the Linux validation process tree', () => {
    expect(
      buildTrackingSoakCiEnvironment({
        environment: { DISPLAY: ':99', EXISTING: 'preserved' },
        platform: 'linux',
      }),
    ).toEqual({
      DISPLAY: ':99',
      EXISTING: 'preserved',
      LIBGL_ALWAYS_SOFTWARE: '1',
      GALLIUM_DRIVER: 'llvmpipe',
    })

    expect(
      buildTrackingSoakCiEnvironment({
        environment: { EXISTING: 'preserved' },
        platform: 'darwin',
      }),
    ).toEqual({ EXISTING: 'preserved' })
  })
})
