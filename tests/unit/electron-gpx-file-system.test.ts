import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { createElectronFileSystem } = require('../../electron/file-system.cjs') as {
  readonly createElectronFileSystem: (options: Readonly<Record<string, unknown>>) => {
    readonly validateGpxEvidencePaths: (paths: readonly string[]) => Promise<readonly string[]>
    readonly listGpxDirectoryPaths: (directoryPath: string) => Promise<readonly string[]>
    readonly listWatchedGpxDirectoryPaths: (directoryPath: string) => Promise<{
      readonly paths: readonly string[]
      readonly omittedCount: number
    }>
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

  it('rejects raw GPX file and directory paths over 4096 characters before path normalization', async () => {
    userDataPath = await mkdtemp(path.join(tmpdir(), 'sartracker-gpx-path-envelope-'))
    const fileSystem = createElectronFileSystem({ userDataPath })
    const oversizedRawPath = `${' '.repeat(4_096)}x`

    await expect(fileSystem.validateGpxEvidencePaths([oversizedRawPath]))
      .rejects.toThrow(/GPX file.*4096/iu)
    await expect(fileSystem.listGpxDirectoryPaths(oversizedRawPath))
      .rejects.toThrow(/GPX directory.*4096/iu)
  })

  it('fails explicitly when a directory contains more than 100 GPX paths', async () => {
    userDataPath = await mkdtemp(path.join(tmpdir(), 'sartracker-gpx-directory-envelope-'))
    await Promise.all(Array.from({ length: 101 }, (_, index) =>
      writeFile(path.join(userDataPath!, `${String(index).padStart(3, '0')}.gpx`), '<gpx/>')))
    const fileSystem = createElectronFileSystem({ userDataPath })

    await expect(fileSystem.listGpxDirectoryPaths(userDataPath))
      .rejects.toThrow(/GPX directory.*more than 100/iu)
  })

  it('lists a watched folder beyond 100 GPX files so automatic import keeps going [DON-350] [M-40]', async () => {
    userDataPath = await mkdtemp(path.join(tmpdir(), 'sartracker-gpx-watch-listing-'))
    await Promise.all(Array.from({ length: 101 }, (_, index) =>
      writeFile(path.join(userDataPath!, `${String(index).padStart(3, '0')}.gpx`), '<gpx/>')))
    const fileSystem = createElectronFileSystem({ userDataPath })

    const listing = await fileSystem.listWatchedGpxDirectoryPaths(userDataPath)
    expect(listing.paths).toHaveLength(101)
    expect(listing.paths.at(-1)).toBe(path.join(userDataPath, '100.gpx'))
    expect(listing.omittedCount).toBe(0)
  })

  it('keeps the most recently changed files when a watched folder exceeds its listing bound, and counts the rest', async () => {
    userDataPath = await mkdtemp(path.join(tmpdir(), 'sartracker-gpx-watch-bound-'))
    await Promise.all(Array.from({ length: 1_001 }, (_, index) =>
      writeFile(path.join(userDataPath!, `${String(index).padStart(4, '0')}.gpx`), '<gpx/>')))
    const oldest = path.join(userDataPath, '0500.gpx')
    await utimes(oldest, new Date('2026-01-01T00:00:00Z'), new Date('2026-01-01T00:00:00Z'))
    const fileSystem = createElectronFileSystem({ userDataPath })

    const listing = await fileSystem.listWatchedGpxDirectoryPaths(userDataPath)
    expect(listing.paths).toHaveLength(1_000)
    expect(listing.paths).not.toContain(oldest)
    expect(listing.omittedCount).toBe(1)
  })

  it('refuses a watched folder outside the operator-chosen locations', async () => {
    userDataPath = await mkdtemp(path.join(tmpdir(), 'sartracker-gpx-watch-allow-'))
    const fileSystem = createElectronFileSystem({ userDataPath })
    await expect(fileSystem.listWatchedGpxDirectoryPaths(tmpdir())).rejects.toThrow(/allowed/iu)
  })
})
