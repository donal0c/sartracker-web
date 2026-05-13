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
})

function readPackageManifest(): PackageManifest {
  return JSON.parse(
    readFileSync(join(process.cwd(), 'package.json'), 'utf8'),
  ) as PackageManifest
}
