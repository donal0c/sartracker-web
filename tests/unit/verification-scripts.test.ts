import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

type PackageManifest = {
  readonly scripts?: Record<string, string>
}

describe('project verification scripts', () => {
  it('keeps backend Cargo tests in the normal full verification path', () => {
    const manifest = readPackageManifest()

    expect(manifest.scripts?.['test:backend']).toBe(
      'cargo test --manifest-path src-tauri/Cargo.toml',
    )
    expect(manifest.scripts?.['test:all']).toContain('npm run test:backend')
  })

  it('keeps the packaged official-map offline smoke script available', () => {
    const manifest = readPackageManifest()

    expect(manifest.scripts?.['electron:pack']).toBe('node scripts/electron-package.mjs --dir')
    expect(manifest.scripts?.['electron:dist:linux']).toBe(
      'node scripts/electron-package.mjs --linux AppImage deb --x64 --publish never',
    )
    expect(manifest.scripts?.['electron:smoke:official-offline']).toBe(
      'node scripts/electron-official-map-offline-smoke.mjs',
    )
  })

  it('forces Electron packaged native dependencies to rebuild from source', () => {
    const builderConfig = readJsonFile<{ readonly buildDependenciesFromSource?: boolean }>(
      'electron-builder.json',
    )

    expect(builderConfig.buildDependenciesFromSource).toBe(true)
  })
})

function readPackageManifest(): PackageManifest {
  return readJsonFile('package.json')
}

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(
    readFileSync(join(process.cwd(), filePath), 'utf8'),
  ) as T
}
