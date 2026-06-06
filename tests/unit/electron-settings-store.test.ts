import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createSettingsDraft,
  DEFAULT_APP_SETTINGS,
} from '../../src/features/settings/settings-types'

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
const { createElectronSettingsStore } = require('../../electron/settings-store.cjs') as {
  readonly createElectronSettingsStore: (options: {
    readonly userDataPath: string
    readonly safeStorage: MockSafeStorage
    readonly fetchFn?: typeof fetch
    readonly platform?: NodeJS.Platform
    readonly now?: () => Date
  }) => ElectronSettingsStore
}

type ElectronSettingsStore = {
  readonly loadAppSettings: () => Promise<typeof DEFAULT_APP_SETTINGS>
  readonly saveAppSettings: (input: ReturnType<typeof createSettingsDraft>) => Promise<typeof DEFAULT_APP_SETTINGS>
  readonly loadRuntimeBootstrapSettings: (forceConnect?: boolean) => Promise<{
    readonly trackingConfig: {
      readonly baseUrl: string
      readonly email?: string
      readonly password?: string
      readonly token?: string
    } | null
    readonly trackingDisabledReason?: string
  }>
  readonly testTrackingConnection: (input: ReturnType<typeof createSettingsDraft>) => Promise<{
    readonly ok: boolean
    readonly message: string
  }>
}

type MockSafeStorage = {
  readonly isEncryptionAvailable: () => boolean
  readonly getSelectedStorageBackend: () => string
  readonly encryptString: (plainText: string) => Buffer
  readonly decryptString: (encrypted: Buffer) => string
}

describe('electron settings store', () => {
  let userDataPath: string | null = null

  afterEach(async () => {
    if (userDataPath !== null) {
      await rm(userDataPath, { recursive: true, force: true })
      userDataPath = null
    }
  })

  it('persists settings under userData and keeps the Traccar secret out of settings JSON', async () => {
    const store = await createStore({ backend: 'gnome_libsecret' })
    const draft = createSettingsDraft(DEFAULT_APP_SETTINGS)
    draft.missionDefaults.autoRefreshIntervalSeconds = 45
    draft.dataSource.providerType = 'traccar_http'
    draft.dataSource.baseUrl = 'https://kmrtsar.eu/'
    draft.dataSource.email = 'sean'
    draft.dataSource.secretInput = 'field-secret'
    draft.weather.links = [{ name: 'Met Éireann', url: 'https://www.met.ie/' }]

    const saved = await store.saveAppSettings(draft)

    expect(saved.dataSource).toMatchObject({
      providerType: 'traccar_http',
      baseUrl: 'https://kmrtsar.eu',
      email: 'sean',
      secretPresent: true,
    })
    expect(saved.weather.links).toEqual([{ name: 'Met Éireann', url: 'https://www.met.ie' }])
    const runtime = await store.loadRuntimeBootstrapSettings(true)
    expect(runtime.trackingConfig).toEqual({
      baseUrl: 'https://kmrtsar.eu',
      email: 'sean',
      password: 'field-secret',
    })
    const rawSettings = await readFile(path.join(userDataPath!, 'settings.json'), 'utf8')
    expect(rawSettings).not.toContain('secretInput')
    expect(rawSettings).not.toContain('field-secret')
  })

  it('normalizes bare-domain weather links before persistence', async () => {
    const store = await createStore({ backend: 'gnome_libsecret' })
    const draft = createSettingsDraft(DEFAULT_APP_SETTINGS)
    draft.weather.links = [{ name: 'Met Éireann', url: 'met.ie' }]

    const saved = await store.saveAppSettings(draft)

    expect(saved.weather.links).toEqual([{ name: 'Met Éireann', url: 'https://met.ie' }])
    const rawSettings = await readFile(path.join(userDataPath!, 'settings.json'), 'utf8')
    expect(rawSettings).toContain('https://met.ie')
    expect(rawSettings).not.toContain('"url":"met.ie"')
  })

  it('persists official map source metadata without copying the MapGenie password into settings JSON', async () => {
    const store = await createStore({ backend: 'gnome_libsecret' })
    const sourcePath = path.join(userDataPath!, 'mountainrescue_org.txt')
    await writeFile(
      sourcePath,
      [
        'Customer: Mountain Rescue Ireland',
        'Username: mountainrescue_org',
        'Password: field-secret',
        'discovery ITM https://ogcmapgenie.osi.ie/data/rest/services/ITM/discovery/MapServer/wmts',
        'basemap_premium ITM https://ogcmapgenie.osi.ie/data/rest/services/ITM/basemap_premium/MapServer/wmts',
      ].join('\n'),
      'utf8',
    )
    const draft = createSettingsDraft(DEFAULT_APP_SETTINGS)
    draft.officialMaps.sourceType = 'mapgenie_file'
    draft.officialMaps.sourcePath = sourcePath

    const saved = await store.saveAppSettings(draft)

    expect(saved.officialMaps).toMatchObject({
      sourceType: 'mapgenie_file',
      sourcePath,
      status: 'configured',
      username: 'mountainrescue_org',
      availableSources: ['official_discovery_topo', 'official_premium_basemap'],
      serviceCount: 2,
    })
    const rawSettings = await readFile(path.join(userDataPath!, 'settings.json'), 'utf8')
    expect(rawSettings).toContain(sourcePath)
    expect(rawSettings).not.toContain('field-secret')
    expect(rawSettings).not.toContain('Password')
  })

  it('registers a valid local MBTiles official map package with safe metadata only', async () => {
    const verifiedAt = '2026-06-05T10:11:12.000Z'
    const store = await createStore({
      backend: 'gnome_libsecret',
      now: () => new Date(verifiedAt),
    })
    const packagePath = path.join(userDataPath!, 'reeks-standard-60km-z16.mbtiles')
    createMbtilesPackage(packagePath)
    const draft = createSettingsDraft(DEFAULT_APP_SETTINGS)
    draft.officialMaps.packages = [
      {
        sourceType: 'mbtiles',
        mapId: 'official_discovery_topo',
        packagePath,
      },
    ]

    const saved = await store.saveAppSettings(draft)

    expect(saved.officialMaps.packages).toHaveLength(1)
    expect(saved.officialMaps.packages[0]).toMatchObject({
      sourceType: 'mbtiles',
      mapId: 'official_discovery_topo',
      packagePath,
      status: 'ready',
      bounds: [-10.25, 51.85, -9.45, 52.35],
      minZoom: 9,
      maxZoom: 16,
      tileCount: 2,
      tileFormat: 'png',
      verifiedAt,
      message: 'Official Discovery Topo package is ready.',
    })
    expect(saved.officialMaps.packages[0]?.id).toMatch(/^official_discovery_topo-[a-f0-9]{12}$/u)
    expect(saved.officialMaps.packages[0]?.id).not.toContain(packagePath)
    expect(saved.officialMaps.packages[0]?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/u)
    const rawSettings = await readFile(path.join(userDataPath!, 'settings.json'), 'utf8')
    expect(rawSettings).toContain(packagePath)
    expect(rawSettings).not.toContain('tile-bytes')
  })

  it('keeps missing and invalid local official map packages visible without throwing', async () => {
    const verifiedAt = '2026-06-05T10:11:12.000Z'
    const store = await createStore({
      backend: 'gnome_libsecret',
      now: () => new Date(verifiedAt),
    })
    const missingPath = path.join(userDataPath!, 'missing.mbtiles')
    const invalidPath = path.join(userDataPath!, 'not-a-database.mbtiles')
    await writeFile(invalidPath, 'not sqlite', 'utf8')
    const draft = createSettingsDraft(DEFAULT_APP_SETTINGS)
    draft.officialMaps.packages = [
      {
        sourceType: 'mbtiles',
        mapId: 'official_discovery_topo',
        packagePath: missingPath,
      },
      {
        sourceType: 'mbtiles',
        mapId: 'official_discovery_topo',
        packagePath: invalidPath,
      },
    ]

    const saved = await store.saveAppSettings(draft)

    expect(saved.officialMaps.packages).toEqual([
      expect.objectContaining({
        sourceType: 'mbtiles',
        mapId: 'official_discovery_topo',
        packagePath: missingPath,
        status: 'missing',
        bounds: null,
        minZoom: null,
        maxZoom: null,
        tileCount: 0,
        verifiedAt,
        message: 'Official map package file was not found.',
      }),
      expect.objectContaining({
        sourceType: 'mbtiles',
        mapId: 'official_discovery_topo',
        packagePath: invalidPath,
        status: 'invalid',
        bounds: null,
        minZoom: null,
        maxZoom: null,
        tileCount: 0,
        verifiedAt,
        message: 'Official map package could not be read as MBTiles.',
      }),
    ])
  })

  it('removes app-owned official map package files when the registration is removed', async () => {
    const store = await createStore({ backend: 'gnome_libsecret' })
    const appOwnedPackagePath = path.join(
      userDataPath!,
      'official-map-packages',
      'official_discovery_topo.mbtiles',
    )
    await mkdir(path.dirname(appOwnedPackagePath), { recursive: true })
    createMbtilesPackage(appOwnedPackagePath)
    const externalPackagePath = path.join(userDataPath!, 'external.mbtiles')
    createMbtilesPackage(externalPackagePath)
    const initial = createSettingsDraft(DEFAULT_APP_SETTINGS)
    initial.officialMaps.packages = [
      {
        sourceType: 'mbtiles',
        mapId: 'official_discovery_topo',
        packagePath: appOwnedPackagePath,
      },
      {
        sourceType: 'mbtiles',
        mapId: 'official_discovery_topo',
        packagePath: externalPackagePath,
      },
    ]
    await store.saveAppSettings(initial)

    const next = createSettingsDraft(await store.loadAppSettings())
    next.officialMaps.packages = next.officialMaps.packages.filter(
      (mapPackage) => mapPackage.packagePath !== appOwnedPackagePath,
    )
    await store.saveAppSettings(next)

    await expect(access(appOwnedPackagePath)).rejects.toThrow()
    await expect(access(externalPackagePath)).resolves.toBeUndefined()
  })

  it('preserves an existing secret when saving non-secret settings', async () => {
    const store = await createStore({ backend: 'gnome_libsecret' })
    const initial = createSettingsDraft(DEFAULT_APP_SETTINGS)
    initial.dataSource.providerType = 'traccar_http'
    initial.dataSource.baseUrl = 'https://kmrtsar.eu'
    initial.dataSource.email = 'sean'
    initial.dataSource.secretInput = 'first-secret'
    await store.saveAppSettings(initial)

    const loaded = await store.loadAppSettings()
    const next = createSettingsDraft(loaded)
    next.missionDefaults.autoSaveIntervalSeconds = 60
    await store.saveAppSettings(next)

    const runtime = await store.loadRuntimeBootstrapSettings(true)
    expect(runtime.trackingConfig).toMatchObject({ password: 'first-secret' })
  })

  it('clears the current secret when requested', async () => {
    const store = await createStore({ backend: 'gnome_libsecret' })
    const initial = createSettingsDraft(DEFAULT_APP_SETTINGS)
    initial.dataSource.providerType = 'traccar_http'
    initial.dataSource.baseUrl = 'https://kmrtsar.eu'
    initial.dataSource.email = 'sean'
    initial.dataSource.secretInput = 'first-secret'
    await store.saveAppSettings(initial)

    const clearDraft = createSettingsDraft(await store.loadAppSettings())
    clearDraft.dataSource.clearSecret = true
    const saved = await store.saveAppSettings(clearDraft)

    expect(saved.dataSource.secretPresent).toBe(false)
    const runtime = await store.loadRuntimeBootstrapSettings(true)
    expect(runtime.trackingConfig).toBeNull()
    expect(runtime.trackingDisabledReason).toBe('A provider secret is required before tracking can start.')
  })

  it('refuses to persist a secret when Linux safeStorage falls back to basic_text', async () => {
    const store = await createStore({ backend: 'basic_text', platform: 'linux' })
    const draft = createSettingsDraft(DEFAULT_APP_SETTINGS)
    draft.dataSource.providerType = 'traccar_http'
    draft.dataSource.baseUrl = 'https://kmrtsar.eu'
    draft.dataSource.email = 'sean'
    draft.dataSource.secretInput = 'sean'

    await expect(store.saveAppSettings(draft)).rejects.toThrow(
      'Electron cannot store Traccar secrets safely on this Linux desktop',
    )
  })

  it('uses the encrypted secret from main when testing a connection without a new secret input', async () => {
    const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init)
      if (request.url === 'https://kmrtsar.eu/api/session') {
        return new Response(JSON.stringify({ id: 1 }), { status: 200 })
      }
      if (request.url === 'https://kmrtsar.eu/api/devices') {
        return new Response(JSON.stringify([]), { status: 200 })
      }
      return new Response('not found', { status: 404 })
    }) as typeof fetch
    const store = await createStore({ backend: 'gnome_libsecret', fetchFn })
    const initial = createSettingsDraft(DEFAULT_APP_SETTINGS)
    initial.dataSource.providerType = 'traccar_http'
    initial.dataSource.baseUrl = 'https://kmrtsar.eu'
    initial.dataSource.email = 'sean'
    initial.dataSource.secretInput = 'stored-secret'
    await store.saveAppSettings(initial)

    const testDraft = createSettingsDraft(await store.loadAppSettings())
    const result = await store.testTrackingConnection(testDraft)

    expect(result).toEqual({ ok: true, message: 'Connection successful.' })
    expect(fetchFn).toHaveBeenCalledWith(
      'https://kmrtsar.eu/api/session',
      expect.objectContaining({
        body: 'email=sean&password=stored-secret',
      }),
    )
  })

  async function createStore(options: {
    readonly backend: string
    readonly platform?: NodeJS.Platform
    readonly fetchFn?: typeof fetch
    readonly now?: () => Date
  }): Promise<ElectronSettingsStore> {
    userDataPath = await mkdtemp(path.join(tmpdir(), 'sartracker-electron-settings-'))
    return createElectronSettingsStore({
      userDataPath,
      safeStorage: createMockSafeStorage(options.backend),
      fetchFn: options.fetchFn,
      platform: options.platform ?? 'linux',
      now: options.now,
    })
  }
})

function createMbtilesPackage(packagePath: string): void {
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
    insertMetadata.run('name', 'Reeks standard 60km z16')
    insertMetadata.run('format', 'png')
    insertMetadata.run('bounds', '-10.25,51.85,-9.45,52.35')
    insertMetadata.run('minzoom', '9')
    insertMetadata.run('maxzoom', '16')
    const insertTile = db.prepare(
      'INSERT INTO tiles (zoom_level, tile_column, tile_row, tile_data) VALUES (?, ?, ?, ?)',
    )
    insertTile.run(9, 246, 166, Buffer.from('tile-bytes-z9', 'utf8'))
    insertTile.run(16, 31514, 21318, Buffer.from('tile-bytes-z16', 'utf8'))
  } finally {
    db.close()
  }
}

function createMockSafeStorage(backend: string): MockSafeStorage {
  return {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => backend,
    encryptString: (plainText) => Buffer.from(`encrypted:${plainText}`, 'utf8'),
    decryptString: (encrypted) =>
      encrypted.toString('utf8').replace(/^encrypted:/, ''),
  }
}
