import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { appImageToolsetVersion, loadPackageToolchain } from '../../build/linux-package-toolchain.js'

describe('explicit package inspection toolchain [DON-146]', () => {
  it('uses the builder configuration decision, including an explicit modern toolset', () => {
    expect(appImageToolsetVersion({})).toBe('0.0.0')
    expect(appImageToolsetVersion({ toolsets: { appimage: '1.0.3' } })).toBe('1.0.3')
    expect(() => appImageToolsetVersion({ toolsets: { appimage: 42 } })).toThrow(/toolsets.appimage/)
  })
  it('requires exact declared versions and the pinned builder internal API', () => {
    const manifest = JSON.parse(readFileSync('package.json', 'utf8'))
    const tools = loadPackageToolchain(manifest)
    expect(typeof tools.getAppImageTools).toBe('function')
    expect(tools.x64).toBeDefined()
    expect(() => loadPackageToolchain({ devDependencies: {} })).toThrow(/direct exact/)
    expect(() => loadPackageToolchain({ devDependencies: { ...manifest.devDependencies, 'app-builder-lib': '0.0.0' } })).toThrow(/app-builder-lib/)
  })
  it('does not inspect using the old library after changing the builder declaration', () => {
    const manifest = JSON.parse(readFileSync('package.json', 'utf8'))
    expect(() => loadPackageToolchain({ devDependencies: { ...manifest.devDependencies, 'electron-builder': '27.0.0' } }))
      .toThrow(/electron-builder/)
  })
})
