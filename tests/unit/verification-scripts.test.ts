import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

import { describe, expect, it } from 'vitest'

type PackageManifest = {
  readonly scripts?: Record<string, string>
}

type ElectronBuilderConfig = {
  readonly buildDependenciesFromSource?: boolean
  readonly extraResources?: readonly {
    readonly from?: string
    readonly to?: string
    readonly filter?: readonly string[]
  }[]
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
    expect(manifest.scripts?.['electron:smoke:bad-secret']).toBe(
      'node scripts/electron-bad-secret-smoke.mjs',
    )
  })

  it('forces Electron packaged native dependencies to rebuild from source', () => {
    const builderConfig = readJsonFile<ElectronBuilderConfig>('electron-builder.json')

    expect(builderConfig.buildDependenciesFromSource).toBe(true)
  })

  it('ships the report-only Linux hang collector beside packaged app resources [DON-247]', () => {
    const builderConfig = readJsonFile<ElectronBuilderConfig>('electron-builder.json')

    expect(builderConfig.extraResources).toContainEqual({
      from: 'field-tools',
      to: 'field-tools',
      filter: ['**/*'],
    })
    expect(
      readFileSync(
        join(process.cwd(), 'field-tools', 'sartracker-linux-hang-collector.sh'),
        'utf8',
      ),
    ).toContain('ELECTRON_RUN_AS_NODE=1')
  })

  it('preserves the failed packaging command exit code while restoring native dependencies', () => {
    const fakeBinDirectory = mkdtempSync(join(tmpdir(), 'sartracker-package-failure-'))
    const fakeNpmPath = join(fakeBinDirectory, 'npm')
    writeFileSync(
      fakeNpmPath,
      '#!/bin/sh\nif [ "$1" = "rebuild" ]; then exit 0; fi\nexit 7\n',
      'utf8',
    )
    chmodSync(fakeNpmPath, 0o755)

    try {
      const result = spawnSync(process.execPath, ['scripts/electron-package.mjs', '--dir'], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          PATH: `${fakeBinDirectory}:${process.env.PATH ?? ''}`,
        },
        encoding: 'utf8',
      })

      expect(result.status).toBe(7)
      expect(result.stderr).not.toContain('ReferenceError')
    } finally {
      rmSync(fakeBinDirectory, { recursive: true, force: true })
    }
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
