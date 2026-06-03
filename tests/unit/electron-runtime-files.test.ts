import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const {
  FORBIDDEN_DIAGNOSTICS_PATH_SEGMENTS,
  createElectronRuntimeFiles,
} = require('../../electron/runtime-files.cjs') as {
  readonly FORBIDDEN_DIAGNOSTICS_PATH_SEGMENTS: readonly string[]
  readonly createElectronRuntimeFiles: (options: {
    readonly userDataPath: string
    readonly versions: {
      readonly electron: string
      readonly chrome: string
      readonly node: string
    }
    readonly platform: string
    readonly safeStorageBackend: () => string
    readonly loadSettings: () => Promise<{
      readonly dataSource: {
        readonly baseUrl: string
        readonly authMode: string
        readonly secretPresent: boolean
      }
    }>
  }) => {
    readonly readTrackingCache: () => Promise<string | null>
    readonly writeTrackingCache: (contents: string) => Promise<string>
    readonly exportDiagnosticsReport: (input: {
      readonly fileName: string
      readonly contents: string
    }) => Promise<string>
  }
}

describe('electron runtime files', () => {
  let userDataPath: string | null = null

  afterEach(async () => {
    if (userDataPath !== null) {
      await rm(userDataPath, { recursive: true, force: true })
      userDataPath = null
    }
  })

  it('reads and writes tracking cache atomically under userData', async () => {
    const files = await createRuntimeFiles()

    await expect(files.readTrackingCache()).resolves.toBeNull()
    const cachePath = await files.writeTrackingCache('{"devices":[{"id":1}]}')

    expect(cachePath).toBe(path.join(userDataPath!, 'tracking-cache.json'))
    await expect(files.readTrackingCache()).resolves.toBe('{"devices":[{"id":1}]}')
    const entries = await readdir(userDataPath!)
    expect(entries).not.toContain('tracking-cache.tmp')
  })

  it('exports a sanitized allow-listed diagnostics report without profile files or secrets', async () => {
    const files = await createRuntimeFiles()

    const exportPath = await files.exportDiagnosticsReport({
      fileName: '../profile/Cookies:bad.txt',
      contents: [
        'Diagnostics Report',
        'provider url: https://kmrtsar.eu',
        'password=field-secret',
        'token: field-secret',
      ].join('\n'),
    })

    expect(exportPath).toBe(path.join(userDataPath!, 'diagnostics-reports', 'Cookies-bad.txt'))
    const report = await readFile(exportPath, 'utf8')
    expect(report).toContain('[electron]')
    expect(report).toContain('electron: 40.10.0')
    expect(report).toContain('chrome: 144.0.7559.236')
    expect(report).toContain('safeStorage backend: gnome_libsecret')
    expect(report).toContain('provider url: https://kmrtsar.eu')
    expect(report).toContain('secret present: yes')
    expect(report).toContain('official maps: configured')
    expect(report).not.toContain('mountainrescue_org.txt')
    expect(report).not.toContain('field-secret')
    for (const forbidden of FORBIDDEN_DIAGNOSTICS_PATH_SEGMENTS) {
      expect(report).not.toContain(forbidden)
    }
  })

  async function createRuntimeFiles() {
    userDataPath = await mkdtemp(path.join(tmpdir(), 'sartracker-electron-runtime-'))
    return createElectronRuntimeFiles({
      userDataPath,
      versions: {
        electron: '40.10.0',
        chrome: '144.0.7559.236',
        node: '24.15.0',
      },
      platform: 'linux',
      safeStorageBackend: () => 'gnome_libsecret',
      loadSettings: async () => ({
        dataSource: {
          baseUrl: 'https://kmrtsar.eu',
          authMode: 'basic',
          secretPresent: true,
        },
        officialMaps: {
          status: 'configured',
          sourceType: 'mapgenie_file',
          sourcePath: '/private/maps/mountainrescue_org.txt',
          serviceCount: 4,
        },
      }),
    })
  }
})
