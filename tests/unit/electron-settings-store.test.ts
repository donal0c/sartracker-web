import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createSettingsDraft,
  DEFAULT_APP_SETTINGS,
} from '../../src/features/settings/settings-types'

const require = createRequire(import.meta.url)
const { createElectronSettingsStore } = require('../../electron/settings-store.cjs') as {
  readonly createElectronSettingsStore: (options: {
    readonly userDataPath: string
    readonly safeStorage: MockSafeStorage
    readonly fetchFn?: typeof fetch
    readonly platform?: NodeJS.Platform
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
  }): Promise<ElectronSettingsStore> {
    userDataPath = await mkdtemp(path.join(tmpdir(), 'sartracker-electron-settings-'))
    return createElectronSettingsStore({
      userDataPath,
      safeStorage: createMockSafeStorage(options.backend),
      fetchFn: options.fetchFn,
      platform: options.platform ?? 'linux',
    })
  }
})

function createMockSafeStorage(backend: string): MockSafeStorage {
  return {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => backend,
    encryptString: (plainText) => Buffer.from(`encrypted:${plainText}`, 'utf8'),
    decryptString: (encrypted) =>
      encrypted.toString('utf8').replace(/^encrypted:/, ''),
  }
}
