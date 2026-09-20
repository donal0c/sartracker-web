import { describe, expect, it } from 'vitest'

import {
  inspectHostCapabilities,
  validateHostCapabilities,
} from '../../scripts/qualification/host-capabilities.mjs'

describe('qualification host capability inspection', () => {
  it('requires the inspection and native-dialog tools used by reviewed package probes', () => {
    const result = inspectHostCapabilities({ platform: 'linux', arch: 'x64',
      commandAvailable: (name: string) => name !== 'xdotool',
      playwrightElectronAvailable: true, displayAvailable: true })
    expect(result.available).not.toContain('package-host')
    expect(result.missingReasons['package-host']).toContain('xdotool')
  })
  it('rejects Wayland-only sessions because the reviewed probes require X11', () => {
    const result = inspectHostCapabilities({ platform: 'linux', arch: 'x64',
      commandAvailable: () => true, playwrightElectronAvailable: true,
      environment: { WAYLAND_DISPLAY: 'wayland-0' } })
    expect(result.available).not.toContain('package-host')
    expect(result.missingReasons['package-host']).toContain('DISPLAY')
  })
  it('recognizes a static Linux package host without claiming an application launch', () => {
    const result = inspectHostCapabilities({
      platform: 'linux',
      arch: 'x64',
      commandAvailable: () => true,
      playwrightElectronAvailable: true,
      displayAvailable: true,
    })
    expect(result.available).toEqual(expect.arrayContaining(['node', 'fs', 'git', 'gh', 'package-host']))
    expect(result.checks.packageHost).toMatchObject({ linuxX64: true, playwrightElectron: true, display: true })
    expect(result.runtimeLaunchVerified).toBe(false)
  })

  it('reports each missing static prerequisite with an actionable reason', () => {
    const result = inspectHostCapabilities({
      platform: 'darwin',
      arch: 'arm64',
      commandAvailable: (command: string) => command === 'git',
      playwrightElectronAvailable: false,
      displayAvailable: false,
    })
    expect(result.available).toEqual(expect.arrayContaining(['node', 'fs', 'git']))
    expect(result.available).not.toContain('gh')
    expect(result.available).not.toContain('package-host')
    expect(result.missingReasons['gh']).toMatch(/gh|GitHub/u)
    expect(result.missingReasons['package-host']).toMatch(/Linux x64|Playwright|display/iu)
  })

  it('validates only requested capability names and never turns runtime proof into readiness', () => {
    const result = validateHostCapabilities({
      preflight: { requiredCapabilities: ['node', 'fs', 'git', 'gh', 'package-host', 'unknown'] },
    }, {
      platform: 'linux',
      arch: 'x64',
      commandAvailable: () => true,
      playwrightElectronAvailable: true,
      displayAvailable: true,
    })
    expect(result).toEqual(['missing host capability unknown'])
  })

  it('preserves the old Electron-only calibration semantic as a separate capability', () => {
    const result = validateHostCapabilities({
      preflight: { requiredCapabilities: ['electron'] },
    }, {
      platform: 'linux',
      arch: 'x64',
      commandAvailable: () => true,
      playwrightElectronAvailable: true,
      displayAvailable: true,
      electronAvailable: false,
    })
    expect(result.join(' ')).toMatch(/electron/u)
  })
})
