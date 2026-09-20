import { describe, expect, it } from 'vitest'
import { validateRuntimeObservation } from '../../scripts/qualification/package-runtime.mjs'

const expected = { proofMode: 'ci-appimage', launchPath: '/owned/candidate.AppImage',
  executableSha256: 'a'.repeat(64), asarSha256: 'b'.repeat(64), artifactSha256: 'c'.repeat(64) }
const observed = { pid: 123, startTicks: '999', launchPath: expected.launchPath,
  executablePath: '/tmp/.mount_candidate/sartracker-web', executableSha256: expected.executableSha256,
  asarSha256: expected.asarSha256, appImagePath: expected.launchPath, artifactSha256: expected.artifactSha256,
  mainProcess: true, descendantOfRunner: true }

describe('actual package process identity', () => {
  it('binds actual AppImage main executable and ASAR to the inspected exact image', () => {
    expect(validateRuntimeObservation(observed, expected)).toBe(true)
  })
  it.each([
    { executableSha256: '0'.repeat(64) }, { asarSha256: '0'.repeat(64) },
    { artifactSha256: '0'.repeat(64) }, { appImagePath: '/unpacked/sartracker-web' },
    { descendantOfRunner: false }, { mainProcess: false }, { pid: 0 }, { startTicks: '' },
  ])('rejects wrong runtime identity %j', (change) => {
    expect(() => validateRuntimeObservation({ ...observed, ...change }, expected)).toThrow()
  })
  it('requires the actual installed executable, not a byte-identical extracted copy', () => {
    const installed = { ...expected, proofMode: 'installed-deb', launchPath: '/opt/SAR/sartracker-web',
      installedExecutablePath: '/opt/SAR/sartracker-web' }
    const input = { ...observed, launchPath: installed.launchPath, executablePath: installed.launchPath, appImagePath: null }
    expect(validateRuntimeObservation(input, installed)).toBe(true)
    expect(() => validateRuntimeObservation({ ...input, executablePath: '/tmp/deb/opt/SAR/sartracker-web' }, installed)).toThrow()
    expect(() => validateRuntimeObservation(input, { ...installed, proofMode: 'browser' })).toThrow()
  })
})
