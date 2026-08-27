import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { createElectronFileSystem } = require('../../electron/file-system.cjs') as {
  readonly createElectronFileSystem: (options: Readonly<Record<string, unknown>>) => {
    readonly validateGpxEvidencePaths: (paths: readonly string[]) => Promise<readonly string[]>
  }
}

describe('Electron GPX filesystem admission [DON-274]', () => {
  let userDataPath: string | null = null

  afterEach(async () => {
    if (userDataPath !== null) await rm(userDataPath, { recursive: true, force: true })
  })

  it('admits allowed selected paths without fail-fast file reads so each file settles durably', async () => {
    userDataPath = await mkdtemp(path.join(tmpdir(), 'sartracker-gpx-path-admission-'))
    const readablePath = path.join(userDataPath, 'readable.gpx')
    const missingPath = path.join(userDataPath, 'missing.gpx')
    await writeFile(readablePath, '<gpx/>')
    const fileSystem = createElectronFileSystem({ userDataPath })

    await expect(fileSystem.validateGpxEvidencePaths([missingPath, readablePath]))
      .resolves.toEqual([missingPath, readablePath])
  })
})
