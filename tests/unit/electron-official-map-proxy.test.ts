import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_APP_SETTINGS } from '../../src/features/settings/settings-types'

const require = createRequire(import.meta.url)
type SqliteStatement = {
  readonly run: (...params: readonly unknown[]) => unknown
}
type SqliteDatabase = {
  readonly exec: (sql: string) => void
  readonly prepare: (sql: string) => SqliteStatement
  readonly close: () => void
}
const Database = require('better-sqlite3') as new (filename: string) => SqliteDatabase

const { createElectronOfficialMapProxy } = (await import('../../electron/official-map-proxy.cjs')) as {
  readonly createElectronOfficialMapProxy: (options: {
    readonly loadSettings: () => Promise<unknown>
    readonly fetch: typeof fetch
    readonly createMbtilesReader?: (packagePath: string) => {
      readonly readTile: (tile: {
        readonly mapId: string
        readonly z: number
        readonly x: number
        readonly y: number
      }) => { readonly status: 'hit'; readonly bytes: Uint8Array } | { readonly status: 'miss' } | { readonly status: 'package_error' }
      readonly close: () => void
    }
  }) => {
    readonly fetchOfficialMapTile: (url: string) => Promise<{
      readonly contentType: string
      readonly bytesBase64: string
    }>
    readonly invalidateSettings: () => void
  }
}

describe('Electron official map proxy', () => {
  let tempDir: string | null = null

  afterEach(async () => {
    if (tempDir !== null) {
      await rm(tempDir, { force: true, recursive: true })
      tempDir = null
    }
  })

  it('fetches a configured MapGenie tile through ArcGIS export without returning credentials', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'sartracker-mapgenie-'))
    const sourcePath = path.join(tempDir, 'mountainrescue_org.txt')
    await writeFile(
      sourcePath,
      [
        'Customer: Mountain Rescue Ireland',
        'Username: mountainrescue_org',
        'Password: field-secret',
        'discovery ITM https://ogcmapgenie.osi.ie/data/rest/services/ITM/discovery/MapServer/wmts?REQUEST=GetCapabilities&format=text/xml',
        'ortho ITM https://ogcmapgenie.osi.ie/data/rest/services/ITM/ortho/MapServer/wmts?REQUEST=GetCapabilities&format=text/xml',
      ].join('\n'),
      'utf8',
    )
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'image/png' }),
      arrayBuffer: async () => Uint8Array.from([1, 2, 3, 4]).buffer,
    })
    const proxy = createElectronOfficialMapProxy({
      fetch: fetchMock as never,
      loadSettings: async () => ({
        ...DEFAULT_APP_SETTINGS,
        officialMaps: {
          ...DEFAULT_APP_SETTINGS.officialMaps,
          sourceType: 'mapgenie_file',
          sourcePath,
          status: 'configured',
          availableSources: ['official_discovery_topo', 'official_aerial_imagery'],
          serviceCount: 2,
        },
      }),
    })

    const response = await proxy.fetchOfficialMapTile(
      'sartracker-official-map://tile/official_discovery_topo/12/1935/1344.png',
    )

    expect(response).toEqual({
      contentType: 'image/png',
      bytesBase64: 'AQIDBA==',
    })
    expect(JSON.stringify(response)).not.toContain('field-secret')
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, options] = fetchMock.mock.calls[0]!
    expect(url).toContain('/discovery/MapServer/export?')
    expect(url).not.toContain('field-secret')
    expect(url).not.toContain('mountainrescue_org')
    expect(options).toMatchObject({
      headers: {
        authorization: 'Basic bW91bnRhaW5yZXNjdWVfb3JnOmZpZWxkLXNlY3JldA==',
      },
    })

    await proxy.fetchOfficialMapTile(
      'sartracker-official-map://tile/official_aerial_imagery/12/1935/1344.png',
    )
    expect(fetchMock.mock.calls[1]![0]).toContain('/ortho/MapServer/export?')
  })

  it('serves a local MBTiles official map tile before using online MapGenie', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'sartracker-official-mbtiles-'))
    const packagePath = path.join(tempDir, 'reeks.mbtiles')
    createMbtilesPackage(packagePath, [
      {
        z: 12,
        x: 1935,
        xyzY: 1344,
        bytes: Uint8Array.from([10, 20, 30, 40]),
      },
    ])
    const fetchMock = vi.fn()
    const proxy = createElectronOfficialMapProxy({
      fetch: fetchMock as never,
      loadSettings: async () => ({
        ...DEFAULT_APP_SETTINGS,
        officialMaps: {
          ...DEFAULT_APP_SETTINGS.officialMaps,
          packages: [
            {
              id: 'official_discovery_topo-test',
              sourceType: 'mbtiles',
              mapId: 'official_discovery_topo',
              packagePath,
              status: 'ready',
              bounds: [-10.25, 51.85, -9.45, 52.35],
              minZoom: 9,
              maxZoom: 16,
              tileCount: 1,
              tileFormat: 'png',
              createdAt: '2026-06-05T10:00:00.000Z',
              verifiedAt: '2026-06-05T10:11:12.000Z',
              message: 'Official Discovery Topo package is ready.',
            },
          ],
        },
      }),
    })

    const response = await proxy.fetchOfficialMapTile(
      'sartracker-official-map://tile/official_discovery_topo/12/1935/1344.png',
    )

    expect(response).toEqual({
      contentType: 'image/png',
      bytesBase64: 'ChQeKA==',
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(JSON.stringify(response)).not.toContain(packagePath)
  })

  it('reuses a readonly MBTiles reader for consecutive requests from the same package [DON-201]', async () => {
    const readTile = vi
      .fn()
      .mockReturnValueOnce({ status: 'hit', bytes: Uint8Array.from([10, 20, 30, 40]) })
      .mockReturnValueOnce({ status: 'hit', bytes: Uint8Array.from([50, 60, 70, 80]) })
    const close = vi.fn()
    const createMbtilesReader = vi.fn().mockReturnValue({ readTile, close })
    const packagePath = '/private/app/official-map-packages/reeks.mbtiles'
    const proxy = createElectronOfficialMapProxy({
      fetch: vi.fn() as never,
      createMbtilesReader,
      loadSettings: async () => createSettingsWithPackage(packagePath),
    })

    await expect(
      proxy.fetchOfficialMapTile('sartracker-official-map://tile/official_discovery_topo/12/1935/1344.png'),
    ).resolves.toEqual({
      contentType: 'image/png',
      bytesBase64: 'ChQeKA==',
    })
    await expect(
      proxy.fetchOfficialMapTile('sartracker-official-map://tile/official_discovery_topo/12/1936/1344.png'),
    ).resolves.toEqual({
      contentType: 'image/png',
      bytesBase64: 'MjxGUA==',
    })

    expect(createMbtilesReader).toHaveBeenCalledOnce()
    expect(createMbtilesReader).toHaveBeenCalledWith(packagePath)
    expect(readTile).toHaveBeenCalledTimes(2)
    expect(close).not.toHaveBeenCalled()
  })

  it('reuses resolved official map settings for consecutive local tile requests [DON-240]', async () => {
    const readTile = vi
      .fn()
      .mockReturnValueOnce({ status: 'hit', bytes: Uint8Array.from([10, 20, 30, 40]) })
      .mockReturnValueOnce({ status: 'hit', bytes: Uint8Array.from([50, 60, 70, 80]) })
    const packagePath = '/private/app/official-map-packages/reeks.mbtiles'
    const loadSettings = vi.fn().mockResolvedValue(createSettingsWithPackage(packagePath))
    const proxy = createElectronOfficialMapProxy({
      fetch: vi.fn() as never,
      createMbtilesReader: vi.fn().mockReturnValue({ readTile, close: vi.fn() }),
      loadSettings,
    })

    await proxy.fetchOfficialMapTile(
      'sartracker-official-map://tile/official_discovery_topo/12/1935/1344.png',
    )
    await proxy.fetchOfficialMapTile(
      'sartracker-official-map://tile/official_discovery_topo/12/1936/1344.png',
    )

    expect(loadSettings).toHaveBeenCalledOnce()
    expect(readTile).toHaveBeenCalledTimes(2)
  })

  it('coalesces concurrent official tile settings loads during the first pan burst [DON-240]', async () => {
    const readTile = vi
      .fn()
      .mockReturnValueOnce({ status: 'hit', bytes: Uint8Array.from([10, 20, 30, 40]) })
      .mockReturnValueOnce({ status: 'hit', bytes: Uint8Array.from([50, 60, 70, 80]) })
    const packagePath = '/private/app/official-map-packages/reeks.mbtiles'
    const loadSettings = vi.fn().mockResolvedValue(createSettingsWithPackage(packagePath))
    const proxy = createElectronOfficialMapProxy({
      fetch: vi.fn() as never,
      createMbtilesReader: vi.fn().mockReturnValue({ readTile, close: vi.fn() }),
      loadSettings,
    })

    await Promise.all([
      proxy.fetchOfficialMapTile(
        'sartracker-official-map://tile/official_discovery_topo/12/1935/1344.png',
      ),
      proxy.fetchOfficialMapTile(
        'sartracker-official-map://tile/official_discovery_topo/12/1936/1344.png',
      ),
    ])

    expect(loadSettings).toHaveBeenCalledOnce()
    expect(readTile).toHaveBeenCalledTimes(2)
  })

  it('closes and recreates the MBTiles reader when package metadata changes [DON-201]', async () => {
    const firstReader = {
      readTile: vi.fn().mockReturnValue({ status: 'hit', bytes: Uint8Array.from([1, 2, 3, 4]) }),
      close: vi.fn(),
    }
    const secondReader = {
      readTile: vi.fn().mockReturnValue({ status: 'hit', bytes: Uint8Array.from([5, 6, 7, 8]) }),
      close: vi.fn(),
    }
    const createMbtilesReader = vi
      .fn()
      .mockReturnValueOnce(firstReader)
      .mockReturnValueOnce(secondReader)
    const packagePath = '/private/app/official-map-packages/reeks.mbtiles'
    let loadCount = 0
    const proxy = createElectronOfficialMapProxy({
      fetch: vi.fn() as never,
      createMbtilesReader,
      loadSettings: async () => {
        loadCount += 1
        return createSettingsWithPackage(packagePath, {
          tileCount: loadCount === 1 ? 31_729 : 31_730,
          verifiedAt:
            loadCount === 1
              ? '2026-06-05T10:11:12.000Z'
              : '2026-06-20T08:00:00.000Z',
        })
      },
    })

    await expect(
      proxy.fetchOfficialMapTile('sartracker-official-map://tile/official_discovery_topo/12/1935/1344.png'),
    ).resolves.toEqual({
      contentType: 'image/png',
      bytesBase64: 'AQIDBA==',
    })
    proxy.invalidateSettings()
    await expect(
      proxy.fetchOfficialMapTile('sartracker-official-map://tile/official_discovery_topo/12/1935/1344.png'),
    ).resolves.toEqual({
      contentType: 'image/png',
      bytesBase64: 'BQYHCA==',
    })

    expect(createMbtilesReader).toHaveBeenCalledTimes(2)
    expect(firstReader.close).toHaveBeenCalledOnce()
    expect(secondReader.close).not.toHaveBeenCalled()
  })

  it('falls back to online MapGenie when a ready local package does not contain the requested tile', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'sartracker-official-mbtiles-fallback-'))
    const packagePath = path.join(tempDir, 'reeks.mbtiles')
    createMbtilesPackage(packagePath, [
      {
        z: 12,
        x: 1935,
        xyzY: 1344,
        bytes: Uint8Array.from([10, 20, 30, 40]),
      },
    ])
    const sourcePath = path.join(tempDir, 'mountainrescue_org.txt')
    await writeFile(
      sourcePath,
      [
        'Username: mountainrescue_org',
        'Password: field-secret',
        'discovery ITM https://ogcmapgenie.osi.ie/data/rest/services/ITM/discovery/MapServer/wmts',
      ].join('\n'),
      'utf8',
    )
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'image/png' }),
      arrayBuffer: async () => Uint8Array.from([1, 2, 3, 4]).buffer,
    })
    const proxy = createElectronOfficialMapProxy({
      fetch: fetchMock as never,
      loadSettings: async () => ({
        ...DEFAULT_APP_SETTINGS,
        officialMaps: {
          ...DEFAULT_APP_SETTINGS.officialMaps,
          sourceType: 'mapgenie_file',
          sourcePath,
          status: 'configured',
          availableSources: ['official_discovery_topo'],
          serviceCount: 1,
          packages: [
            {
              id: 'official_discovery_topo-test',
              sourceType: 'mbtiles',
              mapId: 'official_discovery_topo',
              packagePath,
              status: 'ready',
              bounds: [-10.25, 51.85, -9.45, 52.35],
              minZoom: 9,
              maxZoom: 16,
              tileCount: 1,
              tileFormat: 'png',
              createdAt: '2026-06-05T10:00:00.000Z',
              verifiedAt: '2026-06-05T10:11:12.000Z',
              message: 'Official Discovery Topo package is ready.',
            },
          ],
        },
      }),
    })

    const response = await proxy.fetchOfficialMapTile(
      'sartracker-official-map://tile/official_discovery_topo/12/1936/1344.png',
    )

    expect(response).toEqual({
      contentType: 'image/png',
      bytesBase64: 'AQIDBA==',
    })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0]![0]).not.toContain('field-secret')
  })

  it('returns an empty tile for local package coverage misses when no online fallback is configured [DON-240]', async () => {
    const readTile = vi.fn().mockReturnValue({ status: 'miss' })
    const fetchMock = vi.fn()
    const proxy = createElectronOfficialMapProxy({
      fetch: fetchMock as never,
      createMbtilesReader: vi.fn().mockReturnValue({ readTile, close: vi.fn() }),
      loadSettings: async () =>
        createSettingsWithPackage('/private/app/official-map-packages/reeks.mbtiles'),
    })

    const response = await proxy.fetchOfficialMapTile(
      'sartracker-official-map://tile/official_discovery_topo/12/1936/1344.png',
    )

    expect(response.contentType).toBe('image/png')
    expect(Buffer.from(response.bytesBase64, 'base64').length).toBeGreaterThan(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reports a registered package that is missing and has no online fallback', async () => {
    const fetchMock = vi.fn()
    const proxy = createElectronOfficialMapProxy({
      fetch: fetchMock as never,
      loadSettings: async () => ({
        ...DEFAULT_APP_SETTINGS,
        officialMaps: {
          ...DEFAULT_APP_SETTINGS.officialMaps,
          packages: [
            {
              id: 'official_discovery_topo-test',
              sourceType: 'mbtiles',
              mapId: 'official_discovery_topo',
              packagePath: '/private/maps/missing.mbtiles',
              status: 'missing',
              bounds: null,
              minZoom: null,
              maxZoom: null,
              tileCount: 0,
              tileFormat: '',
              createdAt: '',
              verifiedAt: '2026-06-05T10:11:12.000Z',
              message: 'Official map package file was not found.',
            },
          ],
        },
      }),
    })

    await expect(
      proxy.fetchOfficialMapTile('sartracker-official-map://tile/official_discovery_topo/12/1935/1344.png'),
    ).rejects.toThrow('Official map package is missing.')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reports a ready package that becomes unreadable instead of falling back silently', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'sartracker-official-unreadable-'))
    const packagePath = path.join(tempDir, 'not-a-database.mbtiles')
    await writeFile(packagePath, 'not sqlite', 'utf8')
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'image/png' }),
      arrayBuffer: async () => Uint8Array.from([1, 2, 3, 4]).buffer,
    })
    const proxy = createElectronOfficialMapProxy({
      fetch: fetchMock as never,
      loadSettings: async () => ({
        ...DEFAULT_APP_SETTINGS,
        officialMaps: {
          ...DEFAULT_APP_SETTINGS.officialMaps,
          sourceType: 'mapgenie_file',
          sourcePath: path.join(tempDir!, 'mountainrescue_org.txt'),
          status: 'configured',
          availableSources: ['official_discovery_topo'],
          serviceCount: 1,
          packages: [
            {
              id: 'official_discovery_topo-test',
              sourceType: 'mbtiles',
              mapId: 'official_discovery_topo',
              packagePath,
              status: 'ready',
              bounds: [-10.25, 51.85, -9.45, 52.35],
              minZoom: 9,
              maxZoom: 16,
              tileCount: 1,
              tileFormat: 'png',
              createdAt: '2026-06-05T10:00:00.000Z',
              verifiedAt: '2026-06-05T10:11:12.000Z',
              message: 'Official Discovery Topo package is ready.',
            },
          ],
        },
      }),
    })

    await expect(
      proxy.fetchOfficialMapTile('sartracker-official-map://tile/official_discovery_topo/12/1935/1344.png'),
    ).rejects.toThrow('Official map package is unreadable.')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fails explicitly when official maps are not configured', async () => {
    const proxy = createElectronOfficialMapProxy({
      fetch: vi.fn() as never,
      loadSettings: async () => DEFAULT_APP_SETTINGS,
    })

    await expect(
      proxy.fetchOfficialMapTile('sartracker-official-map://tile/official_discovery_topo/12/1935/1344.png'),
    ).rejects.toThrow('Official maps are not configured.')
  })
})

function createMbtilesPackage(
  packagePath: string,
  tiles: readonly {
    readonly z: number
    readonly x: number
    readonly xyzY: number
    readonly bytes: Uint8Array
  }[],
): void {
  const db = new Database(packagePath)
  try {
    db.exec(`
      CREATE TABLE metadata (name TEXT NOT NULL, value TEXT NOT NULL);
      CREATE TABLE tiles (
        zoom_level INTEGER NOT NULL,
        tile_column INTEGER NOT NULL,
        tile_row INTEGER NOT NULL,
        tile_data BLOB NOT NULL
      );
    `)
    const insertMetadata = db.prepare('INSERT INTO metadata (name, value) VALUES (?, ?)')
    insertMetadata.run('format', 'png')
    const insertTile = db.prepare(
      'INSERT INTO tiles (zoom_level, tile_column, tile_row, tile_data) VALUES (?, ?, ?, ?)',
    )
    for (const tile of tiles) {
      insertTile.run(tile.z, tile.x, xyzToTmsY(tile.z, tile.xyzY), Buffer.from(tile.bytes))
    }
  } finally {
    db.close()
  }
}

function createSettingsWithPackage(
  packagePath: string,
  overrides: {
    readonly tileCount?: number
    readonly verifiedAt?: string
  } = {},
) {
  return {
    ...DEFAULT_APP_SETTINGS,
    officialMaps: {
      ...DEFAULT_APP_SETTINGS.officialMaps,
      packages: [
        {
          id: 'official_discovery_topo-test',
          sourceType: 'mbtiles',
          mapId: 'official_discovery_topo',
          packagePath,
          status: 'ready',
          bounds: [-10.25, 51.85, -9.45, 52.35],
          minZoom: 9,
          maxZoom: 16,
          tileCount: overrides.tileCount ?? 31_729,
          tileFormat: 'png',
          createdAt: '2026-06-05T10:00:00.000Z',
          verifiedAt: overrides.verifiedAt ?? '2026-06-05T10:11:12.000Z',
          message: 'Official Discovery Topo package is ready.',
        },
      ],
    },
  }
}

function xyzToTmsY(z: number, xyzY: number): number {
  return 2 ** z - 1 - xyzY
}
