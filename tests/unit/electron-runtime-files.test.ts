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
        readonly officialMaps?: {
          readonly status?: string
          readonly sourceType?: string
          readonly sourcePath?: string
          readonly serviceCount?: number
          readonly packages?: readonly {
            readonly sourceType: string
            readonly mapId: string
            readonly packagePath: string
            readonly status: string
            readonly bounds: readonly [number, number, number, number] | null
            readonly minZoom: number | null
            readonly maxZoom: number | null
            readonly tileCount: number
            readonly tileFormat: string
            readonly verifiedAt: string
          }[]
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
    expect(report).toContain('official map packages: 2')
    expect(report).toContain('official map packages ready: 1')
    expect(report).toContain(
      'official map package 1: official_discovery_topo ready mbtiles z9-z16 tiles=31729 size=1100000000 format=png bounds=-10.17,51.84,-9.40,52.38 verified=2026-06-05T10:11:12.000Z',
    )
    expect(report).toContain('official map package 2: official_discovery_topo missing mbtiles')
    expect(report).not.toContain('mountainrescue_org.txt')
    expect(report).not.toContain('reeks-standard-60km-z16.mbtiles')
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
          packages: [
            {
              sourceType: 'mbtiles',
              mapId: 'official_discovery_topo',
              packagePath: '/private/maps/reeks-standard-60km-z16.mbtiles',
              status: 'ready',
              bounds: [-10.17, 51.84, -9.4, 52.38],
              minZoom: 9,
              maxZoom: 16,
              tileCount: 31_729,
              sizeBytes: 1_100_000_000,
              tileFormat: 'png',
              verifiedAt: '2026-06-05T10:11:12.000Z',
            },
            {
              sourceType: 'mbtiles',
              mapId: 'official_discovery_topo',
              packagePath: '/private/maps/missing.mbtiles',
              status: 'missing',
              bounds: null,
              minZoom: null,
              maxZoom: null,
              tileCount: 0,
              tileFormat: '',
              verifiedAt: '2026-06-05T10:11:12.000Z',
            },
          ],
        },
      }),
    })
  }
})
