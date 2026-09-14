import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { deflateSync } from 'node:zlib'

import { afterEach, describe, expect, it } from 'vitest'

import { buildFieldReadinessChecklist } from '../../src/features/map/field-readiness-checklist'
import {
  createSettingsDraft,
  DEFAULT_APP_SETTINGS,
  type AppSettings,
  type AppSettingsDraft,
} from '../../src/features/settings/settings-types'

const require = createRequire(import.meta.url)

type SqliteStatement = {
  readonly run: (...params: readonly unknown[]) => unknown
}

type SqliteDatabase = {
  readonly close: () => void
  readonly exec: (sql: string) => void
  readonly prepare: (sql: string) => SqliteStatement
}

type SettingsStore = {
  readonly loadAppSettings: () => Promise<AppSettings>
  readonly saveAppSettings: (input: AppSettingsDraft) => Promise<AppSettings>
}

type MapProxy = {
  readonly checkOfficialMapView: (input: {
    readonly mapId: 'official_discovery_topo'
    readonly bounds: Bounds
    readonly zoom: number
  }) => Promise<{
    readonly status: string
    readonly totalTiles: number
    readonly usableTiles: number
  }>
  readonly close: () => void
  readonly fetchOfficialMapTile: (url: string) => Promise<{
    readonly bytesBase64: string
    readonly contentType: string
  }>
  readonly invalidateSettings: () => void
  readonly withPackageMutation: <T>(operation: () => Promise<T>) => Promise<T>
}

type Bounds = {
  readonly west: number
  readonly south: number
  readonly east: number
  readonly north: number
}

const Database = require('better-sqlite3') as new (filename: string) => SqliteDatabase
const { decodeOfficialMapTile } = require('../../electron/official-map-tile-decoder.cjs') as {
  readonly decodeOfficialMapTile: (
    bytes: Uint8Array,
    format: string,
    nativeImage: NativeImageApi,
  ) => boolean
}
const { createElectronSettingsStore } = require('../../electron/settings-store.cjs') as {
  readonly createElectronSettingsStore: (options: {
    readonly decodeOfficialMapTile: (bytes: Uint8Array, format: string) => boolean
    readonly now: () => Date
    readonly safeStorage: ReturnType<typeof createSafeStorage>
    readonly userDataPath: string
  }) => SettingsStore
}
const { createElectronFileSystem } = require('../../electron/file-system.cjs') as {
  readonly createElectronFileSystem: (options: {
    readonly dialog: {
      readonly showOpenDialog: () => Promise<{
        readonly canceled: boolean
        readonly filePaths: readonly string[]
      }>
    }
    readonly getBrowserWindow: () => null
    readonly shell: { readonly openPath: () => Promise<string> }
    readonly statfs: () => Promise<{ readonly bavail: number; readonly bsize: number }>
    readonly userDataPath: string
  }) => {
    readonly chooseOfficialMapPackagePath: () => Promise<string | null>
    readonly importOfficialMapPackage: (input: {
      readonly mapId: string
      readonly sourcePath: string
    }) => Promise<{ readonly packagePath: string; readonly replacedExisting: boolean }>
  }
}
const { createElectronOfficialMapProxy } = require('../../electron/official-map-proxy.cjs') as {
  readonly createElectronOfficialMapProxy: (options: {
    readonly decodeOfficialMapTile: (bytes: Uint8Array, format: string) => boolean | Promise<boolean>
    readonly fetch: typeof fetch
    readonly loadSettings: () => Promise<AppSettings>
  }) => MapProxy
}

const TARGET_TILE = { z: 12, x: 1935, y: 1352 } as const
const TARGET_BOUNDS = xyzTileBounds(TARGET_TILE.z, TARGET_TILE.x, TARGET_TILE.y)
const PACKAGE_BOUNDS: Bounds = { west: -10.25, south: 51.85, east: -9.45, north: 52.35 }
const TILE_URL =
  `sartracker-official-map://tile/official_discovery_topo/${TARGET_TILE.z}/${TARGET_TILE.x}/${TARGET_TILE.y}.png`
const PNG_A = createOpaquePng([0xff, 0x00, 0x00, 0xff])
const PNG_B = createOpaquePng([0x00, 0x00, 0xff, 0xff])

let temporaryDirectory: string | null = null

describe('official map freshness and required-view qualification', () => {
  afterEach(async () => {
    if (temporaryDirectory !== null) {
      await rm(temporaryDirectory, { force: true, recursive: true })
      temporaryDirectory = null
    }
  })

  it('withdraws readiness after a registered package disappears', async () => {
    const { store, packagePath } = await createFixture(PNG_A)
    const saved = await store.saveAppSettings(createPackageDraft(packagePath))
    expect(saved.officialMaps.packages[0]).toMatchObject({
      status: 'ready',
      tileCount: 1,
      attestation: {
        version: 1,
        schemaVersion: 1,
        decoderPolicy: 'native-raster-256-or-512-opaque-v1',
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      },
    })

    await rm(packagePath)
    const reloaded = await createStore(temporaryDirectory!).loadAppSettings()
    const checklist = buildFieldReadinessChecklist({
      activeMapId: 'official_discovery_topo',
      officialMaps: reloaded.officialMaps,
      viewBounds: TARGET_BOUNDS,
      viewZoom: TARGET_TILE.z,
    })

    expect(reloaded.officialMaps.packages[0]).toMatchObject({
      status: 'invalid',
      message: 'Offline package is missing, changed or unverified. Save Settings to validate it again.',
    })
    expect(checklist.verdict).toBe('not_ready')
    expect(checklist.summaryLabel).toBe('Not field ready')
  })

  it('rejects an undecodable tile package during explicit Save validation', async () => {
    const rootPath = await mkdtemp(path.join(tmpdir(), 'sartracker-map-invalid-'))
    temporaryDirectory = rootPath
    const packagePath = path.join(rootPath, 'invalid-tile.mbtiles')
    createMbtilesPackage(packagePath, [{ x: TARGET_TILE.x, y: TARGET_TILE.y, bytes: Buffer.from('not-a-png') }])

    const store = createStore(rootPath)
    const saved = await store.saveAppSettings(createPackageDraft(packagePath))

    expect(saved.officialMaps.packages[0]).toMatchObject({
      status: 'invalid',
      bounds: null,
      tileCount: 0,
      message: 'Official map package tile decoder rejected a tile.',
    })
    expect(buildFieldReadinessChecklist({
      activeMapId: 'official_discovery_topo',
      officialMaps: saved.officialMaps,
      viewBounds: TARGET_BOUNDS,
      viewZoom: TARGET_TILE.z,
    }).verdict).toBe('not_ready')
  })

  it('reports missing required-view tiles and keeps the checklist not ready', async () => {
    const { store, packagePath } = await createFixture(PNG_A, {
      x: TARGET_TILE.x - 1,
      y: TARGET_TILE.y,
    })
    const saved = await store.saveAppSettings(createPackageDraft(packagePath))
    const proxy = createProxy(() => store.loadAppSettings())

    try {
      const qualification = await proxy.checkOfficialMapView({
        mapId: 'official_discovery_topo',
        bounds: TARGET_BOUNDS,
        zoom: TARGET_TILE.z,
      })
      expect(qualification).toEqual({
        status: 'missing',
        totalTiles: 1,
        usableTiles: 0,
        mapId: 'official_discovery_topo',
        bounds: TARGET_BOUNDS,
        zoom: TARGET_TILE.z,
        checkedAt: expect.any(String),
        packageIdentities: [{
          id: saved.officialMaps.packages[0]?.id,
          sha256: saved.officialMaps.packages[0]?.attestation?.sha256,
        }],
        message: 'Required local tiles are missing or unusable. Keep an alternative map available.',
      })
      const checklist = buildFieldReadinessChecklist({
        activeMapId: 'official_discovery_topo',
        officialMaps: saved.officialMaps,
        viewBounds: TARGET_BOUNDS,
        viewZoom: TARGET_TILE.z,
        qualification,
      })
      expect(checklist.verdict).toBe('not_ready')
    } finally {
      proxy.close()
    }
  })

  it('withdraws a live reader after same-path replacement until Save revalidates it', async () => {
    const rootPath = await mkdtemp(path.join(tmpdir(), 'sartracker-map-replace-'))
    temporaryDirectory = rootPath
    const userDataPath = path.join(rootPath, 'user-data')
    const packagePath = path.join(
      userDataPath,
      'official-map-packages',
      'official_discovery_topo.mbtiles',
    )
    const replacementPath = path.join(rootPath, 'replacement.mbtiles')
    await mkdir(path.dirname(packagePath), { recursive: true })
    createMbtilesPackage(packagePath, [{ x: TARGET_TILE.x, y: TARGET_TILE.y, bytes: PNG_A }])
    createMbtilesPackage(replacementPath, [{ x: TARGET_TILE.x, y: TARGET_TILE.y, bytes: PNG_B }])

    const store = createStore(userDataPath)
    await store.saveAppSettings(createPackageDraft(packagePath))
    const proxy = createProxy(() => store.loadAppSettings())
    const fileSystem = createElectronFileSystem({
      dialog: {
        showOpenDialog: async () => ({ canceled: false, filePaths: [replacementPath] }),
      },
      getBrowserWindow: () => null,
      shell: { openPath: async () => '' },
      statfs: async () => ({ bavail: 1_000_000_000, bsize: 4_096 }),
      userDataPath,
    })

    try {
      const before = await proxy.fetchOfficialMapTile(TILE_URL)
      expect(Buffer.from(before.bytesBase64, 'base64').equals(PNG_A)).toBe(true)

      await fileSystem.chooseOfficialMapPackagePath()
      await fileSystem.importOfficialMapPackage({
        mapId: 'official_discovery_topo',
        sourcePath: replacementPath,
      })

      await expect(proxy.fetchOfficialMapTile(TILE_URL)).rejects.toThrow(
        'Official map package is unreadable.',
      )

      await store.saveAppSettings(createPackageDraft(packagePath))
      proxy.invalidateSettings()
      const afterSave = await proxy.fetchOfficialMapTile(TILE_URL)
      expect(Buffer.from(afterSave.bytesBase64, 'base64').equals(PNG_B)).toBe(true)
      expect(Buffer.from(afterSave.bytesBase64, 'base64').equals(PNG_A)).toBe(false)
    } finally {
      proxy.close()
    }
  })

  it('withdraws an in-flight view proof during mutation and permits a fresh proof afterward', async () => {
    const { store, packagePath } = await createFixture(PNG_A)
    await store.saveAppSettings(createPackageDraft(packagePath))
    const decoderStarted = deferred<void>()
    const firstDecode = deferred<boolean>()
    let decodeCount = 0
    const decodeTile = async () => {
      decodeCount += 1
      if (decodeCount === 1) {
        decoderStarted.resolve()
        return firstDecode.promise
      }
      return true
    }
    const proxy = createProxy(() => store.loadAppSettings(), { decodeOfficialMapTile: decodeTile })
    const view = {
      mapId: 'official_discovery_topo' as const,
      bounds: TARGET_BOUNDS,
      zoom: TARGET_TILE.z,
    }
    const mutationStarted = deferred<void>()
    const mutationFinished = deferred<void>()

    try {
      const staleProof = proxy.checkOfficialMapView(view)
      await decoderStarted.promise

      const mutation = proxy.withPackageMutation(async () => {
        mutationStarted.resolve()
        await mutationFinished.promise
      })
      await mutationStarted.promise

      firstDecode.resolve(true)
      await expect(staleProof).rejects.toThrow('package changed during the check')

      mutationFinished.resolve()
      await mutation

      await expect(proxy.checkOfficialMapView(view)).resolves.toMatchObject({
        status: 'complete',
        totalTiles: 1,
        usableTiles: 1,
      })
      expect(decodeCount).toBe(2)
    } finally {
      proxy.close()
    }
  })
})

/** Creates a settings store with the production decoder and a strict synthetic native-image seam. */
function createStore(userDataPath: string): SettingsStore {
  return createElectronSettingsStore({
    decodeOfficialMapTile: decodeOpaqueTile,
    now: () => new Date('2026-09-13T12:34:56.000Z'),
    safeStorage: createSafeStorage(),
    userDataPath,
  })
}

/** Creates the proxy with the same explicit decoder seam used by the Node integration tests. */
function createProxy(
  loadSettings: () => Promise<AppSettings>,
  options: {
    readonly decodeOfficialMapTile?: (bytes: Uint8Array, format: string) => boolean | Promise<boolean>
  } = {},
): MapProxy {
  return createElectronOfficialMapProxy({
    decodeOfficialMapTile: options.decodeOfficialMapTile ?? decodeOpaqueTile,
    fetch: (async () => {
      throw new Error('Network fallback must not be used by this probe.')
    }) as typeof fetch,
    loadSettings,
  })
}

/** Creates one fixture package and its temporary owning directory. */
async function createFixture(
  tileBytes: Uint8Array,
  tile = { x: TARGET_TILE.x, y: TARGET_TILE.y },
): Promise<{ readonly packagePath: string; readonly store: SettingsStore }> {
  const rootPath = await mkdtemp(path.join(tmpdir(), 'sartracker-map-freshness-'))
  temporaryDirectory = rootPath
  const packagePath = path.join(rootPath, 'package.mbtiles')
  createMbtilesPackage(packagePath, [{ ...tile, bytes: tileBytes }])
  return { packagePath, store: createStore(rootPath) }
}

/** Creates a settings draft that registers one Discovery MBTiles package. */
function createPackageDraft(packagePath: string): AppSettingsDraft {
  const draft = createSettingsDraft(DEFAULT_APP_SETTINGS)
  draft.officialMaps.packages = [{
    sourceType: 'mbtiles',
    mapId: 'official_discovery_topo',
    packagePath,
  }]
  return draft
}

/** Creates a disposable MBTiles package with caller-controlled tile rows. */
function createMbtilesPackage(
  packagePath: string,
  tiles: readonly { readonly x: number; readonly y: number; readonly bytes: Uint8Array }[],
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
    insertMetadata.run('name', 'WAR-11 durable synthetic package')
    insertMetadata.run('format', 'png')
    insertMetadata.run(
      'bounds',
      `${PACKAGE_BOUNDS.west},${PACKAGE_BOUNDS.south},${PACKAGE_BOUNDS.east},${PACKAGE_BOUNDS.north}`,
    )
    insertMetadata.run('minzoom', String(TARGET_TILE.z))
    insertMetadata.run('maxzoom', String(TARGET_TILE.z))
    const insertTile = db.prepare(
      'INSERT INTO tiles (zoom_level, tile_column, tile_row, tile_data) VALUES (?, ?, ?, ?)',
    )
    for (const tile of tiles) {
      insertTile.run(TARGET_TILE.z, tile.x, xyzToTmsY(TARGET_TILE.z, tile.y), Buffer.from(tile.bytes))
    }
  } finally {
    db.close()
  }
}

/** Provides the narrow safeStorage contract without real credentials. */
function createSafeStorage() {
  return {
    decryptString: (encrypted: Buffer) => encrypted.toString('utf8'),
    encryptString: (plainText: string) => Buffer.from(plainText, 'utf8'),
    getSelectedStorageBackend: () => 'basic_text',
    isEncryptionAvailable: () => true,
  }
}

/** Uses the production decoder with a strict synthetic nativeImage boundary for Node tests. */
function decodeOpaqueTile(bytes: Uint8Array, format: string): boolean {
  return decodeOfficialMapTile(bytes, format, createOpaqueNativeImage())
}

/** Supplies a deterministic opaque 256x256 native-image stand-in for the Node unit seam. */
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

/** Converts one XYZ tile coordinate into the WGS84 tile footprint. */
function xyzTileBounds(z: number, x: number, y: number): Bounds {
  const dimension = 2 ** z
  const longitude = (column: number) => (column / dimension) * 360 - 180
  const latitude = (row: number) =>
    (Math.atan(Math.sinh(Math.PI * (1 - (2 * row) / dimension))) * 180) / Math.PI
  // The qualification contract treats a boundary as belonging to the
  // adjacent tile, so keep this test view just inside one tile footprint.
  const epsilon = 1e-7
  return {
    west: longitude(x) + epsilon,
    south: latitude(y + 1) + epsilon,
    east: longitude(x + 1) - epsilon,
    north: latitude(y) - epsilon,
  }
}

/** Converts the slippy-map row used by the proxy into the MBTiles TMS row. */
function xyzToTmsY(z: number, xyzY: number): number {
  return 2 ** z - 1 - xyzY
}

/** Builds a valid opaque 256x256 RGBA PNG for package verification. */
function createOpaquePng(pixel: readonly [number, number, number, number]): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(256, 0)
  ihdr.writeUInt32BE(256, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const raw = Buffer.alloc(256 * (1 + 256 * pixel.length))
  for (let row = 0; row < 256; row += 1) {
    const rowOffset = row * (1 + 256 * pixel.length)
    for (let column = 0; column < 256; column += 1) {
      const pixelOffset = rowOffset + 1 + column * pixel.length
      for (let channel = 0; channel < pixel.length; channel += 1) {
        raw[pixelOffset + channel] = pixel[channel]!
      }
    }
  }
  return Buffer.concat([
    signature,
    createPngChunk('IHDR', ihdr),
    createPngChunk('IDAT', deflateSync(raw)),
    createPngChunk('IEND', Buffer.alloc(0)),
  ])
}

/** Encodes one PNG chunk with its standard CRC. */
function createPngChunk(type: string, data: Uint8Array): Buffer {
  const typeBytes = Buffer.from(type, 'ascii')
  const chunk = Buffer.alloc(12 + data.length)
  chunk.writeUInt32BE(data.length, 0)
  typeBytes.copy(chunk, 4)
  Buffer.from(data).copy(chunk, 8)
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBytes, Buffer.from(data)])), 8 + data.length)
  return chunk
}

/** Calculates the standard PNG CRC over a chunk type and payload. */
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
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
