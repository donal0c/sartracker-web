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
const { decodeOfficialMapTile } = require('../../electron/official-map-tile-decoder.cjs') as {
  readonly decodeOfficialMapTile: (
    bytes: Uint8Array,
    format: string,
    nativeImage: NativeImageApi,
  ) => boolean
}
const { inspectOfficialMapPackage } = require('../../electron/official-map-package.cjs') as {
  readonly inspectOfficialMapPackage: (packagePath: string, options: {
    readonly decodeTile: (bytes: Uint8Array, format: string) => boolean
    readonly now?: () => Date
  }) => Promise<{
    readonly attestation: PackageAttestation
  }>
}
const { NO_COVERAGE_TILE_BYTES } = require('../../electron/official-map-no-coverage.cjs') as {
  readonly NO_COVERAGE_TILE_BYTES: Buffer
}

const { createElectronOfficialMapProxy, NO_COVERAGE_TILE_BASE64 } = (await import(
  '../../electron/official-map-proxy.cjs'
)) as {
  readonly NO_COVERAGE_TILE_BASE64: string
  readonly createElectronOfficialMapProxy: (options: {
    readonly loadSettings: () => Promise<unknown>
    readonly fetch: typeof fetch
    readonly decodeOfficialMapTile?: (bytes: Uint8Array, format: string) => boolean | Promise<boolean>
    readonly isPackageCurrent?: (mapPackage: unknown) => boolean
    readonly onPackagesChanged?: () => void
    readonly createMbtilesReader?: (packagePath: string) => {
      readonly readTile: (tile: {
        readonly mapId: string
        readonly z: number
        readonly x: number
        readonly y: number
      }) =>
        | { readonly status: 'hit'; readonly bytes: Uint8Array }
        | { readonly status: 'miss' }
        | { readonly status: 'package_error' }
        | Promise<{ readonly status: 'hit'; readonly bytes: Uint8Array } | { readonly status: 'miss' } | { readonly status: 'package_error' }>
      readonly close: () => void
    }
  }) => {
    readonly checkOfficialMapView: (input: {
      readonly mapId: 'official_discovery_topo'
      readonly bounds: { readonly west: number; readonly south: number; readonly east: number; readonly north: number }
      readonly zoom: number
    }) => Promise<{ readonly status: string }>
    readonly fetchOfficialMapTile: (url: string) => Promise<{
      readonly contentType: string
      readonly bytesBase64: string
    }>
    readonly invalidateSettings: () => void
    readonly withPackageMutation: <T>(operation: () => Promise<T>) => Promise<T>
    readonly close: () => void
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

  it.each([false, true])('closes readers before mutation and blocks reopening until settlement (failure=%s)', async fails => {
    const events: string[] = []
    const createReader = vi.fn(() => ({
      readTile: () => ({status: 'hit' as const, bytes: NO_COVERAGE_TILE_BYTES}),
      close: () => { events.push('reader closed') },
    }))
    const proxy = createElectronOfficialMapProxy({
      loadSettings: async () => createSettingsWithPackage('/synthetic/package.mbtiles'),
      fetch: vi.fn() as never,
      createMbtilesReader: createReader,
      decodeOfficialMapTile: () => true,
      isPackageCurrent: () => true,
      onPackagesChanged: () => { events.push('renderer notified') },
    })
    const url = 'sartracker-official-map://tile/official_discovery_topo/12/1935/1344.png'
    let finish: () => void = () => { throw new Error('Mutation has not started') }
    try {
      await proxy.fetchOfficialMapTile(url)
      const mutation = proxy.withPackageMutation(async () => {
        events.push('mutation started')
        await new Promise<void>(resolve => { finish = resolve })
        if (fails) throw new Error('Synthetic import failed')
        return 'saved'
      })
      const outcome = mutation.then(value => value, error => (error as Error).message)
      expect(events).toEqual(['reader closed', 'renderer notified', 'mutation started'])
      await expect(proxy.fetchOfficialMapTile(url)).rejects.toThrow('being updated')
      expect(createReader).toHaveBeenCalledTimes(1)
      finish()
      expect(await outcome).toBe(fails ? 'Synthetic import failed' : 'saved')
      expect(events.at(-1)).toBe('renderer notified')
      await proxy.fetchOfficialMapTile(url)
      expect(createReader).toHaveBeenCalledTimes(2)
    } finally {
      proxy.close()
    }
  })

  it('keeps mutation results truthful and releases readers when renderer notification throws', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const notify = vi.fn().mockImplementationOnce(() => { throw new Error('Synthetic window closed') })
    const proxy = createElectronOfficialMapProxy({
      loadSettings: async () => createSettingsWithPackage('/synthetic/package.mbtiles'),
      fetch: vi.fn() as never,
      createMbtilesReader: () => ({
        readTile: () => ({status: 'hit', bytes: NO_COVERAGE_TILE_BYTES}),
        close: () => undefined,
      }),
      decodeOfficialMapTile: () => true,
      isPackageCurrent: () => true,
      onPackagesChanged: notify,
    })
    const operation = vi.fn(async () => 'saved')
    try {
      await expect(proxy.withPackageMutation(operation)).resolves.toBe('saved')
      expect(operation).toHaveBeenCalledOnce()
      expect(warning).toHaveBeenCalledWith('Official map change notification failed; delivery will retry.')
      await expect(proxy.fetchOfficialMapTile(
        'sartracker-official-map://tile/official_discovery_topo/12/1935/1344.png',
      )).resolves.toMatchObject({contentType: 'image/png'})
    } finally {
      proxy.close()
      warning.mockRestore()
    }
  })

  it('reuses a decoded proof for the same package identity and tile, then evicts it on invalidation', async () => {
    const decodeTile = vi.fn(() => true)
    const isCurrent = vi.fn(() => true)
    const readTile = vi.fn(() => ({status: 'hit' as const, bytes: NO_COVERAGE_TILE_BYTES}))
    const proxy = createElectronOfficialMapProxy({
      loadSettings: async () => createSettingsWithPackage('/synthetic/package.mbtiles'),
      fetch: vi.fn() as never,
      createMbtilesReader: () => ({readTile, close: vi.fn()}),
      decodeOfficialMapTile: decodeTile,
      isPackageCurrent: isCurrent,
    })
    const url = 'sartracker-official-map://tile/official_discovery_topo/12/1935/1344.png'
    try {
      await proxy.fetchOfficialMapTile(url)
      await proxy.fetchOfficialMapTile(url)
      expect(decodeTile).toHaveBeenCalledOnce()
      expect(isCurrent).toHaveBeenCalledTimes(4)

      proxy.invalidateSettings()
      await proxy.fetchOfficialMapTile(url)
      expect(decodeTile).toHaveBeenCalledTimes(2)
      expect(isCurrent).toHaveBeenCalledTimes(6)
    } finally {
      proxy.close()
    }
  })

  it('bounds decoded proofs and evicts the oldest inserted tile', async () => {
    const decodeTile = vi.fn(() => true)
    const proxy = createElectronOfficialMapProxy({
      loadSettings: async () => createSettingsWithPackage('/synthetic/package.mbtiles'),
      fetch: vi.fn() as never,
      createMbtilesReader: () => ({
        readTile: () => ({status: 'hit' as const, bytes: NO_COVERAGE_TILE_BYTES}),
        close: vi.fn(),
      }),
      decodeOfficialMapTile: decodeTile,
      isPackageCurrent: () => true,
    })
    const tileUrl = (x: number) =>
      `sartracker-official-map://tile/official_discovery_topo/12/${x}/1344.png`
    try {
      for (let x = 1935; x < 1935 + 257; x += 1) {
        await proxy.fetchOfficialMapTile(tileUrl(x))
      }
      expect(decodeTile).toHaveBeenCalledTimes(257)
      await proxy.fetchOfficialMapTile(tileUrl(1935))
      expect(decodeTile).toHaveBeenCalledTimes(258)
    } finally {
      proxy.close()
    }
  })

  it('does not churn a reader when only attestation property order changes', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'sartracker-official-fingerprint-'))
    const packagePath = path.join(tempDir, 'reeks.mbtiles')
    createMbtilesPackage(packagePath, [{z: 12, x: 1935, xyzY: 1352, bytes: NO_COVERAGE_TILE_BYTES}])
    const inspected = await inspectFixturePackage(packagePath)
    const reordered = {
      version: inspected.version,
      schemaVersion: inspected.schemaVersion,
      decoderPolicy: inspected.decoderPolicy,
      identity: inspected.identity,
      sha256: inspected.sha256,
    }
    let loadCount = 0
    const loadSettings = vi.fn(async () => ({
      ...DEFAULT_APP_SETTINGS,
      officialMaps: {
        ...DEFAULT_APP_SETTINGS.officialMaps,
        packages: [createReadyPackage(packagePath, loadCount++ === 0 ? inspected : reordered)],
      },
    }))
    const createReader = vi.fn(() => ({
      readTile: () => ({status: 'hit' as const, bytes: NO_COVERAGE_TILE_BYTES}),
      close: vi.fn(),
    }))
    const proxy = createElectronOfficialMapProxy({
      loadSettings,
      fetch: vi.fn() as never,
      createMbtilesReader: createReader,
      decodeOfficialMapTile: () => true,
      isPackageCurrent: () => true,
    })
    try {
      await proxy.fetchOfficialMapTile(
        'sartracker-official-map://tile/official_discovery_topo/12/1935/1352.png',
      )
      await expect(proxy.checkOfficialMapView({
        mapId: 'official_discovery_topo',
        bounds: xyzTileBounds(12, 1935, 1352),
        zoom: 12,
      })).resolves.toMatchObject({status: 'complete'})
      expect(createReader).toHaveBeenCalledOnce()
    } finally {
      proxy.close()
    }
  })

  it('retries a failed post-mutation notification without throwing from its monitor', async () => {
    vi.useFakeTimers()
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const notify = vi.fn().mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => { throw new Error('Synthetic IPC unavailable') })
      .mockImplementationOnce(() => { throw new Error('Synthetic IPC still unavailable') })
      .mockImplementation(() => undefined)
    const proxy = createElectronOfficialMapProxy({
      loadSettings: async () => DEFAULT_APP_SETTINGS,
      fetch: vi.fn() as never,
      onPackagesChanged: notify,
    })
    try {
      await expect(proxy.withPackageMutation(async () => 'saved')).resolves.toBe('saved')
      expect(notify).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(2000)
      expect(notify).toHaveBeenCalledTimes(4)
      await vi.advanceTimersByTimeAsync(1000)
      expect(notify).toHaveBeenCalledTimes(4)
      expect(warning).toHaveBeenCalledTimes(1)
    } finally {
      proxy.close()
      warning.mockRestore()
      vi.useRealTimers()
    }
  })

  it('rejects an in-flight tile after mutation and serves a fresh tile after settlement', async () => {
    const firstReadStarted = deferred<void>()
    const delayedRead = deferred<{ readonly status: 'hit'; readonly bytes: Uint8Array }>()
    const mutationStarted = deferred<void>()
    const mutationFinished = deferred<void>()
    const firstReader = {
      readTile: vi.fn(() => {
        firstReadStarted.resolve()
        return delayedRead.promise
      }),
      close: vi.fn(),
    }
    const secondReader = {
      readTile: vi.fn(() => ({ status: 'hit' as const, bytes: NO_COVERAGE_TILE_BYTES })),
      close: vi.fn(),
    }
    const createMbtilesReader = vi
      .fn()
      .mockReturnValueOnce(firstReader)
      .mockReturnValueOnce(secondReader)
    const proxy = createElectronOfficialMapProxy({
      loadSettings: async () => createSettingsWithPackage('/synthetic/package.mbtiles'),
      fetch: vi.fn() as never,
      createMbtilesReader,
      decodeOfficialMapTile: () => true,
      isPackageCurrent: () => true,
    })
    const url = 'sartracker-official-map://tile/official_discovery_topo/12/1935/1344.png'

    try {
      const staleTile = proxy.fetchOfficialMapTile(url)
      await firstReadStarted.promise

      const mutation = proxy.withPackageMutation(async () => {
        mutationStarted.resolve()
        await mutationFinished.promise
      })
      await mutationStarted.promise
      expect(firstReader.close).toHaveBeenCalledOnce()

      delayedRead.resolve({ status: 'hit', bytes: NO_COVERAGE_TILE_BYTES })
      await expect(staleTile).rejects.toThrow('package changed during the tile request')

      mutationFinished.resolve()
      await mutation

      await expect(proxy.fetchOfficialMapTile(url)).resolves.toEqual({
        contentType: 'image/png',
        bytesBase64: NO_COVERAGE_TILE_BASE64,
      })
      expect(createMbtilesReader).toHaveBeenCalledTimes(2)
      expect(secondReader.readTile).toHaveBeenCalledOnce()
    } finally {
      proxy.close()
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
        bytes: NO_COVERAGE_TILE_BYTES,
      },
    ])
    const attestation = await inspectFixturePackage(packagePath)
    const fetchMock = vi.fn()
    const proxy = createElectronOfficialMapProxy({
      fetch: fetchMock as never,
      decodeOfficialMapTile: decodeOpaqueTile,
      loadSettings: async () => ({
        ...DEFAULT_APP_SETTINGS,
        officialMaps: {
          ...DEFAULT_APP_SETTINGS.officialMaps,
          packages: [createReadyPackage(packagePath, attestation)],
        },
      }),
    })

    const response = await proxy.fetchOfficialMapTile(
      'sartracker-official-map://tile/official_discovery_topo/12/1935/1344.png',
    )

    expect(response).toEqual({
      contentType: 'image/png',
      bytesBase64: NO_COVERAGE_TILE_BASE64,
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
    const proxy = createMockReaderProxy({
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
    const proxy = createMockReaderProxy({
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
    const proxy = createMockReaderProxy({
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
    const proxy = createMockReaderProxy({
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
        bytes: NO_COVERAGE_TILE_BYTES,
      },
    ])
    const attestation = await inspectFixturePackage(packagePath)
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
          packages: [createReadyPackage(packagePath, attestation)],
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

  it.each(['oversized', 'malformed'])('fails closed for a %s local row instead of silently falling back', async rowKind => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), `sartracker-official-${rowKind}-row-`))
    const packagePath = path.join(tempDir, 'reeks.mbtiles')
    createRawTilePackage(packagePath, rowKind === 'oversized'
      ? Buffer.alloc(4 * 1024 * 1024 + 1, 7)
      : 'not-a-binary-tile')
    const fetchMock = vi.fn()
    const proxy = createElectronOfficialMapProxy({
      fetch: fetchMock as never,
      loadSettings: async () => createSettingsWithFallbackPackage(packagePath),
      decodeOfficialMapTile: () => true,
      isPackageCurrent: () => true,
    })
    try {
      await expect(proxy.fetchOfficialMapTile(
        'sartracker-official-map://tile/official_discovery_topo/12/1935/1344.png',
      )).rejects.toThrow('Official map package is unreadable.')
      expect(fetchMock).not.toHaveBeenCalled()
    } finally {
      proxy.close()
    }
  })

  it('returns a visible no-coverage tile for local package misses when no online fallback is configured [DON-240]', async () => {
    const readTile = vi.fn().mockReturnValue({ status: 'miss' })
    const fetchMock = vi.fn()
    const proxy = createMockReaderProxy({
      fetch: fetchMock as never,
      createMbtilesReader: vi.fn().mockReturnValue({ readTile, close: vi.fn() }),
      loadSettings: async () =>
        createSettingsWithPackage('/private/app/official-map-packages/reeks.mbtiles'),
    })

    const response = await proxy.fetchOfficialMapTile(
      'sartracker-official-map://tile/official_discovery_topo/12/1936/1344.png',
    )

    // Coverage misses must render an operator-visible "no offline coverage" fill, not a
    // silent transparent tile — a blank map area cannot be distinguished from real terrain.
    expect(response.contentType).toBe('image/png')
    expect(response.bytesBase64).toBe(NO_COVERAGE_TILE_BASE64)
    expect(fetchMock).not.toHaveBeenCalled()

    // The tile is a full 256x256 raster (not a 1x1 placeholder), so the pattern is visible.
    const png = Buffer.from(response.bytesBase64, 'base64')
    expect(png.subarray(1, 4).toString('ascii')).toBe('PNG')
    expect(png.readUInt32BE(16)).toBe(256) // IHDR width
    expect(png.readUInt32BE(20)).toBe(256) // IHDR height
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

/** Keeps legacy reader-cache tests focused on cache behavior with synthetic bytes. */
function createMockReaderProxy(options: {
  readonly loadSettings: () => Promise<unknown>
  readonly fetch: typeof fetch
  readonly createMbtilesReader: (packagePath: string) => {
    readonly readTile: (tile: {
      readonly mapId: string
      readonly z: number
      readonly x: number
      readonly y: number
    }) => { readonly status: 'hit'; readonly bytes: Uint8Array } | { readonly status: 'miss' } | { readonly status: 'package_error' }
    readonly close: () => void
  }
}): ReturnType<typeof createElectronOfficialMapProxy> {
  return createElectronOfficialMapProxy({
    ...options,
    // These tests inject a reader and intentionally use arbitrary byte arrays;
    // strict decoder and filesystem identity behavior is covered by the durable
    // official-map-freshness tests and the real-package tests below.
    decodeOfficialMapTile: () => true,
    isPackageCurrent: () => true,
  })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

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
    insertMetadata.run('bounds', '-10.25,51.85,-9.45,52.35')
    insertMetadata.run('minzoom', '12')
    insertMetadata.run('maxzoom', '12')
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

/** Creates a minimal synthetic tile table whose row payload can exercise reader guards. */
function createRawTilePackage(packagePath: string, tileData: Uint8Array | string): void {
  const db = new Database(packagePath)
  try {
    db.exec(`
      CREATE TABLE tiles (
        zoom_level INTEGER NOT NULL,
        tile_column INTEGER NOT NULL,
        tile_row INTEGER NOT NULL,
        tile_data
      );
    `)
    db.prepare(
      'INSERT INTO tiles (zoom_level, tile_column, tile_row, tile_data) VALUES (?, ?, ?, ?)',
    ).run(12, 1935, xyzToTmsY(12, 1344), tileData)
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

/** Builds settings with an online source so local package failures cannot fall through silently. */
function createSettingsWithFallbackPackage(packagePath: string) {
  const settings = createSettingsWithPackage(packagePath)
  return {
    ...settings,
    officialMaps: {
      ...settings.officialMaps,
      sourceType: 'mapgenie_file',
      sourcePath: '/synthetic/mapgenie-source.txt',
      status: 'configured',
      availableSources: ['official_discovery_topo'],
    },
  }
}

/** Converts one XYZ tile coordinate into a view footprint just inside its boundaries. */
function xyzTileBounds(z: number, x: number, y: number) {
  const dimension = 2 ** z
  const longitude = (column: number) => (column / dimension) * 360 - 180
  const latitude = (row: number) =>
    (Math.atan(Math.sinh(Math.PI * (1 - (2 * row) / dimension))) * 180) / Math.PI
  const epsilon = 1e-7
  return {
    west: longitude(x) + epsilon,
    south: latitude(y + 1) + epsilon,
    east: longitude(x + 1) - epsilon,
    north: latitude(y) - epsilon,
  }
}

function xyzToTmsY(z: number, xyzY: number): number {
  return 2 ** z - 1 - xyzY
}

type PackageAttestation = {
  readonly version: 1
  readonly schemaVersion: 1
  readonly decoderPolicy: 'native-raster-256-or-512-opaque-v1'
  readonly sha256: string
  readonly identity: string
}

/** Attests a real SQLite fixture with the production package inspector. */
async function inspectFixturePackage(packagePath: string): Promise<PackageAttestation> {
  const inspected = await inspectOfficialMapPackage(packagePath, {
    decodeTile: decodeOpaqueTile,
    now: () => new Date('2026-09-13T12:34:56.000Z'),
  })
  return inspected.attestation
}

/** Builds the ready package shape used by real filesystem proxy tests. */
function createReadyPackage(packagePath: string, attestation: PackageAttestation) {
  return {
    id: 'official_discovery_topo-test',
    sourceType: 'mbtiles' as const,
    mapId: 'official_discovery_topo' as const,
    packagePath,
    status: 'ready' as const,
    bounds: [-10.25, 51.85, -9.45, 52.35] as const,
    minZoom: 12,
    maxZoom: 12,
    tileCount: 1,
    tileFormat: 'png',
    createdAt: '2026-06-05T10:00:00.000Z',
    verifiedAt: '2026-09-13T12:34:56.000Z',
    attestation,
    message: 'Official Discovery Topo package is ready.',
  }
}

/** Uses the production decoder against a deterministic opaque native-image seam. */
function decodeOpaqueTile(bytes: Uint8Array, format: string): boolean {
  return decodeOfficialMapTile(bytes, format, createOpaqueNativeImage())
}

/** Supplies the narrow native-image shape needed by the Node proxy tests. */
function createOpaqueNativeImage(): NativeImageApi {
  return {
    createFromBuffer: () => ({
      getSize: () => ({ width: 256, height: 256 }),
      isEmpty: () => false,
      toBitmap: () => {
        const bitmap = Buffer.alloc(256 * 256 * 4)
        for (let offset = 3; offset < bitmap.length; offset += 4) bitmap[offset] = 0xff
        return bitmap
      },
    }),
  }
}

type NativeImageApi = {
  readonly createFromBuffer: (bytes: Buffer) => {
    readonly getSize: () => { readonly width: number; readonly height: number }
    readonly isEmpty: () => boolean
    readonly toBitmap: () => Buffer
  }
}
