import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

import { describe, expect, it } from 'vitest'

import { buildFieldReadinessChecklist } from '../../../../src/features/map/field-readiness-checklist'
import {
  createSettingsDraft,
  DEFAULT_APP_SETTINGS,
  type AppSettings,
  type AppSettingsDraft,
} from '../../../../src/features/settings/settings-types'

const require = createRequire(import.meta.url)

type SqliteStatement = {
  readonly get: (...params: readonly unknown[]) => { readonly tileData?: Uint8Array } | undefined
  readonly run: (...params: readonly unknown[]) => unknown
}

type SqliteDatabase = {
  readonly close: () => void
  readonly exec: (sql: string) => void
  readonly prepare: (sql: string) => SqliteStatement
}

type ElectronSettingsStore = {
  readonly loadAppSettings: () => Promise<AppSettings>
  readonly saveAppSettings: (input: AppSettingsDraft) => Promise<AppSettings>
}

type TileResult =
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'served'; readonly bytes: Buffer; readonly contentType: string }

type OfficialMapProxy = {
  readonly close: () => void
  readonly fetchOfficialMapTile: (url: string) => Promise<{
    readonly bytesBase64: string
    readonly contentType: string
  }>
  readonly invalidateSettings: () => void
}

const Database = require('better-sqlite3') as new (
  filename: string,
  options?: { readonly fileMustExist?: boolean; readonly readonly?: boolean },
) => SqliteDatabase

const { createElectronSettingsStore } = require('../../../../electron/settings-store.cjs') as {
  readonly createElectronSettingsStore: (options: {
    readonly now?: () => Date
    readonly safeStorage: ReturnType<typeof createSafeStorage>
    readonly userDataPath: string
  }) => ElectronSettingsStore
}

const { createElectronOfficialMapProxy, NO_COVERAGE_TILE_BASE64 } = require(
  '../../../../electron/official-map-proxy.cjs',
) as {
  readonly NO_COVERAGE_TILE_BASE64: string
  readonly createElectronOfficialMapProxy: (options: {
    readonly fetch: typeof fetch
    readonly loadSettings: () => Promise<AppSettings>
  }) => OfficialMapProxy
}

const { createElectronFileSystem } = require('../../../../electron/file-system.cjs') as {
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

const TARGET_TILE = { z: 12, x: 1935, y: 1352 } as const
const TILE_URL =
  `sartracker-official-map://tile/official_discovery_topo/${TARGET_TILE.z}/${TARGET_TILE.x}/${TARGET_TILE.y}.png`
const VIEW_BOUNDS = { west: -10.1, south: 51.9, east: -9.6, north: 52.2 }
const PACKAGE_BOUNDS = { west: -10.25, south: 51.85, east: -9.45, north: 52.35 }
const VALID_PNG_BYTES = Buffer.from(NO_COVERAGE_TILE_BASE64, 'base64')

describe('WAR-04 official-map readiness red probes', () => {
  it('does not keep a registered package field-ready after the file disappears', async () => {
    expectTargetTileInsideCertifiedBounds()
    const rootPath = await mkdtemp(path.join(tmpdir(), 'war-04-map-missing-'))
    const packagePath = path.join(rootPath, 'registered.mbtiles')
    try {
      createMbtilesPackage(packagePath, VALID_PNG_BYTES)
      const store = createStore(rootPath)
      const saved = await store.saveAppSettings(createPackageDraft(packagePath))
      expect(saved.officialMaps.packages[0]?.status).toBe('ready')

      await rm(packagePath)
      const reloaded = await createStore(rootPath).loadAppSettings()
      const checklist = buildChecklist(reloaded)
      const proxy = createProxy(async () => reloaded)
      const tileResult = await captureTileResult(proxy)
      proxy.close()

      const observed = {
        packageStatus: reloaded.officialMaps.packages[0]?.status,
        readiness: checklist.verdict,
        readinessLabel: checklist.summaryLabel,
        tileResult: tileResult.kind,
        tileError: tileResult.kind === 'error' ? tileResult.message : null,
      }
      console.info('WAR-04 missing-package observation', observed)

      expect(observed.readiness).toBe('not_ready')
      expect(observed.readinessLabel).toBe('Not field ready')
      expect(observed.tileResult).toBe('error')
      expect(observed.tileError).toBe('Official map package is unreadable.')
    } finally {
      await rm(rootPath, { force: true, recursive: true })
    }
  })

  it('switches a live reader to the package atomically imported at the same path', async () => {
    expectTargetTileInsideCertifiedBounds()
    const rootPath = await mkdtemp(path.join(tmpdir(), 'war-04-map-replace-'))
    const userDataPath = path.join(rootPath, 'user-data')
    const packagePath = path.join(
      userDataPath,
      'official-map-packages',
      'official_discovery_topo.mbtiles',
    )
    const replacementPath = path.join(rootPath, 'replacement.mbtiles')
    const replacementBytes = Buffer.concat([VALID_PNG_BYTES, Buffer.from([0])])
    try {
      await mkdir(path.dirname(packagePath), { recursive: true })
      createMbtilesPackage(packagePath, VALID_PNG_BYTES)
      createMbtilesPackage(replacementPath, replacementBytes)
      const store = createStore(userDataPath)
      await store.saveAppSettings(createPackageDraft(packagePath))
      const proxy = createProxy(() => store.loadAppSettings())
      const beforeImport = await proxy.fetchOfficialMapTile(TILE_URL)

      const fileSystem = createElectronFileSystem({
        dialog: {
          showOpenDialog: async () => ({ canceled: false, filePaths: [replacementPath] }),
        },
        getBrowserWindow: () => null,
        shell: { openPath: async () => '' },
        statfs: async () => ({ bavail: 1_000_000_000, bsize: 4_096 }),
        userDataPath,
      })
      await fileSystem.chooseOfficialMapPackagePath()
      const imported = await fileSystem.importOfficialMapPackage({
        mapId: 'official_discovery_topo',
        sourcePath: replacementPath,
      })

      const bytesNowAtPath = readTileBytes(packagePath)
      const registryAfterImport = await store.loadAppSettings()
      const checklistAfterImport = buildChecklist(registryAfterImport)
      const afterImport = await proxy.fetchOfficialMapTile(TILE_URL)
      proxy.invalidateSettings()
      const afterInvalidation = await proxy.fetchOfficialMapTile(TILE_URL)
      proxy.close()

      const observed = {
        replacedExisting: imported.replacedExisting,
        beforeWasOriginal: Buffer.from(beforeImport.bytesBase64, 'base64').equals(VALID_PNG_BYTES),
        pathContainsReplacement: bytesNowAtPath.equals(replacementBytes),
        registryStatusAfterImport: registryAfterImport.officialMaps.packages[0]?.status,
        readinessAfterImport: checklistAfterImport.verdict,
        liveReaderContainsReplacement: Buffer.from(afterImport.bytesBase64, 'base64').equals(replacementBytes),
        invalidatedReaderContainsReplacement: Buffer.from(afterInvalidation.bytesBase64, 'base64').equals(replacementBytes),
      }
      console.info('WAR-04 same-path replacement observation', observed)

      expect(observed).toEqual({
        replacedExisting: true,
        beforeWasOriginal: true,
        pathContainsReplacement: true,
        registryStatusAfterImport: 'ready',
        readinessAfterImport: 'ready',
        liveReaderContainsReplacement: true,
        invalidatedReaderContainsReplacement: true,
      })
    } finally {
      await rm(rootPath, { force: true, recursive: true })
    }
  })

  it('does not label or serve a tile row whose bytes are not a decodable PNG', async () => {
    expectTargetTileInsideCertifiedBounds()
    const rootPath = await mkdtemp(path.join(tmpdir(), 'war-04-map-invalid-image-'))
    const packagePath = path.join(rootPath, 'invalid-image.mbtiles')
    const invalidImageBytes = Buffer.from('not-a-decodable-png', 'utf8')
    try {
      createMbtilesPackage(packagePath, invalidImageBytes)
      const saved = await createStore(rootPath).saveAppSettings(createPackageDraft(packagePath))
      const checklist = buildChecklist(saved)
      const proxy = createProxy(async () => saved)
      const tileResult = await captureTileResult(proxy)
      proxy.close()

      const servedBytes = tileResult.kind === 'served' ? tileResult.bytes : Buffer.alloc(0)
      const observed = {
        packageStatus: saved.officialMaps.packages[0]?.status,
        readiness: checklist.verdict,
        readinessLabel: checklist.summaryLabel,
        tileResult: tileResult.kind,
        contentType: tileResult.kind === 'served' ? tileResult.contentType : null,
        servedBytesHavePngSignature: hasPngSignature(servedBytes),
        servedBytesMatchInvalidRow: servedBytes.equals(invalidImageBytes),
      }
      console.info('WAR-04 invalid-image observation', observed)

      expect(observed.readiness).toBe('not_ready')
      expect(observed.readinessLabel).toBe('Not field ready')
      expect(observed.servedBytesMatchInvalidRow).toBe(false)
    } finally {
      await rm(rootPath, { force: true, recursive: true })
    }
  })

  it('does not certify declared coverage when the requested in-bounds tile is absent', async () => {
    expectTargetTileInsideCertifiedBounds()
    const rootPath = await mkdtemp(path.join(tmpdir(), 'war-04-map-incomplete-'))
    const packagePath = path.join(rootPath, 'incomplete.mbtiles')
    try {
      createMbtilesPackage(packagePath, VALID_PNG_BYTES, { x: 1934, y: TARGET_TILE.y })
      const saved = await createStore(rootPath).saveAppSettings(createPackageDraft(packagePath))
      const checklist = buildChecklist(saved)
      const proxy = createProxy(async () => saved)
      const tile = await proxy.fetchOfficialMapTile(TILE_URL)
      proxy.close()

      const observed = {
        packageStatus: saved.officialMaps.packages[0]?.status,
        readiness: checklist.verdict,
        readinessLabel: checklist.summaryLabel,
        targetTileUsesNoCoverageHatch: tile.bytesBase64 === NO_COVERAGE_TILE_BASE64,
      }
      console.info('WAR-04 incomplete-coverage observation', observed)

      expect(observed.readiness).toBe('not_ready')
      expect(observed.readinessLabel).toBe('Not field ready')
      expect(observed.targetTileUsesNoCoverageHatch).toBe(true)
    } finally {
      await rm(rootPath, { force: true, recursive: true })
    }
  })
})

/** Creates the production settings store over a disposable user-data directory. */
function createStore(userDataPath: string): ElectronSettingsStore {
  return createElectronSettingsStore({
    now: () => new Date('2026-08-29T10:00:00.000Z'),
    safeStorage: createSafeStorage(),
    userDataPath,
  })
}

/** Creates a production proxy with network fallback deliberately unavailable. */
function createProxy(loadSettings: () => Promise<AppSettings>): OfficialMapProxy {
  return createElectronOfficialMapProxy({
    fetch: (async () => {
      throw new Error('Network fallback must not be used by this probe.')
    }) as typeof fetch,
    loadSettings,
  })
}

/** Builds the exact renderer readiness verdict for a view inside package metadata bounds. */
function buildChecklist(settings: AppSettings) {
  return buildFieldReadinessChecklist({
    activeMapId: 'official_discovery_topo',
    officialMaps: settings.officialMaps,
    viewBounds: VIEW_BOUNDS,
  })
}

/** Captures whether the production proxy serves tile bytes or rejects the package. */
async function captureTileResult(proxy: OfficialMapProxy): Promise<TileResult> {
  try {
    const response = await proxy.fetchOfficialMapTile(TILE_URL)
    return {
      kind: 'served',
      bytes: Buffer.from(response.bytesBase64, 'base64'),
      contentType: response.contentType,
    }
  } catch (error) {
    return {
      kind: 'error',
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

/** Produces a settings draft that requests validation of one Discovery MBTiles package. */
function createPackageDraft(packagePath: string): AppSettingsDraft {
  const draft = createSettingsDraft(DEFAULT_APP_SETTINGS)
  draft.officialMaps.packages = [
    {
      sourceType: 'mbtiles',
      mapId: 'official_discovery_topo',
      packagePath,
    },
  ]
  return draft
}

/** Creates a one-tile MBTiles package with caller-controlled tile bytes. */
function createMbtilesPackage(
  packagePath: string,
  tileBytes: Uint8Array,
  tile = { x: TARGET_TILE.x, y: TARGET_TILE.y },
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
    insertMetadata.run('name', 'WAR-04 synthetic package')
    insertMetadata.run('format', 'png')
    insertMetadata.run(
      'bounds',
      `${PACKAGE_BOUNDS.west},${PACKAGE_BOUNDS.south},${PACKAGE_BOUNDS.east},${PACKAGE_BOUNDS.north}`,
    )
    insertMetadata.run('minzoom', '12')
    insertMetadata.run('maxzoom', '12')
    db.prepare(
      'INSERT INTO tiles (zoom_level, tile_column, tile_row, tile_data) VALUES (?, ?, ?, ?)',
    ).run(12, tile.x, xyzToTmsY(12, tile.y), Buffer.from(tileBytes))
  } finally {
    db.close()
  }
}

/** Reads the probe tile directly through a fresh SQLite handle. */
function readTileBytes(packagePath: string): Buffer {
  const db = new Database(packagePath, { readonly: true, fileMustExist: true })
  try {
    const row = db
      .prepare(
        'SELECT tile_data AS tileData FROM tiles WHERE zoom_level = ? AND tile_column = ? AND tile_row = ?',
      )
      .get(TARGET_TILE.z, TARGET_TILE.x, xyzToTmsY(TARGET_TILE.z, TARGET_TILE.y))
    return Buffer.from(row?.tileData ?? [])
  } finally {
    db.close()
  }
}

/** Returns true only for the fixed eight-byte PNG file signature. */
function hasPngSignature(bytes: Uint8Array): boolean {
  return Buffer.from(bytes.subarray(0, 8)).equals(
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  )
}

/** Proves the synthetic request is wholly inside both positively certified envelopes. */
function expectTargetTileInsideCertifiedBounds(): void {
  const tileBounds = xyzTileBounds(TARGET_TILE.z, TARGET_TILE.x, TARGET_TILE.y)
  for (const certifiedBounds of [VIEW_BOUNDS, PACKAGE_BOUNDS]) {
    expect(tileBounds.west).toBeGreaterThanOrEqual(certifiedBounds.west)
    expect(tileBounds.south).toBeGreaterThanOrEqual(certifiedBounds.south)
    expect(tileBounds.east).toBeLessThanOrEqual(certifiedBounds.east)
    expect(tileBounds.north).toBeLessThanOrEqual(certifiedBounds.north)
  }
}

/** Converts one XYZ tile coordinate into its WGS84 footprint. */
function xyzTileBounds(z: number, x: number, y: number) {
  const dimension = 2 ** z
  const longitude = (column: number) => (column / dimension) * 360 - 180
  const latitude = (row: number) =>
    (Math.atan(Math.sinh(Math.PI * (1 - (2 * row) / dimension))) * 180) / Math.PI
  return {
    west: longitude(x),
    south: latitude(y + 1),
    east: longitude(x + 1),
    north: latitude(y),
  }
}

/** Supplies the settings store's narrow safeStorage contract without real credentials. */
function createSafeStorage() {
  return {
    decryptString: (encrypted: Buffer) => encrypted.toString('utf8'),
    encryptString: (plainText: string) => Buffer.from(plainText, 'utf8'),
    getSelectedStorageBackend: () => 'basic_text',
    isEncryptionAvailable: () => true,
  }
}

/** Converts the slippy-map row used by the proxy into the MBTiles TMS row. */
function xyzToTmsY(z: number, xyzY: number): number {
  return 2 ** z - 1 - xyzY
}
