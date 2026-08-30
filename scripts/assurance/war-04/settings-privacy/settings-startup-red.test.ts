import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import {
  createSettingsDraft,
  DEFAULT_APP_SETTINGS,
  type AppSettings,
  type AppSettingsDraft,
} from '../../../../src/features/settings/settings-types'

const require = createRequire(import.meta.url)
const fsPromises = require('node:fs/promises') as typeof import('node:fs/promises')

type RuntimeBootstrapSettings = {
  readonly trackingConfig: {
    readonly baseUrl: string
    readonly email?: string
    readonly password?: string
    readonly token?: string
  } | null
  readonly trackingDisabledReason?: string
}

type ElectronSettingsStore = {
  readonly loadAppSettings: () => Promise<AppSettings>
  readonly saveAppSettings: (input: AppSettingsDraft) => Promise<AppSettings>
  readonly loadRuntimeBootstrapSettings: (
    forceConnect?: boolean,
  ) => Promise<RuntimeBootstrapSettings>
}

type ElectronRuntimeFiles = {
  readonly exportSupportBundle: (input: {
    readonly fileName: string
    readonly contents: string
  }) => Promise<string>
}

const { createElectronSettingsStore } = require('../../../../electron/settings-store.cjs') as {
  readonly createElectronSettingsStore: (options: {
    readonly userDataPath: string
    readonly safeStorage: ReturnType<typeof createSafeStorage>
    readonly platform?: NodeJS.Platform
  }) => ElectronSettingsStore
}

const { createElectronRuntimeFiles } = require('../../../../electron/runtime-files.cjs') as {
  readonly createElectronRuntimeFiles: (options: {
    readonly userDataPath: string
    readonly versions: {
      readonly electron: string
      readonly chrome: string
      readonly node: string
    }
    readonly platform: string
    readonly safeStorageBackend: () => string
    readonly loadSettings: () => Promise<AppSettings>
  }) => ElectronRuntimeFiles
}

describe('WAR-04 settings and credential startup red probes', () => {
  it('keeps the shell operable with tracking disabled when credentials cannot be read', async () => {
    const userDataPath = await mkdtemp(path.join(tmpdir(), 'war-04-unreadable-credentials-'))
    try {
      await writeFile(
        path.join(userDataPath, 'settings.json'),
        JSON.stringify({
          missionDefaults: { autoRefreshEnabled: true },
          dataSource: {
            providerType: 'traccar_http',
            baseUrl: 'https://tracking.example.invalid',
            authMode: 'basic',
            email: 'operator@example.test',
            autoConnect: true,
          },
        }),
        'utf8',
      )
      await mkdir(path.join(userDataPath, 'credentials.json'))
      const store = createStore(userDataPath)

      const runtime = await store.loadRuntimeBootstrapSettings(true)
      console.info('WAR-04 unreadable-credential observation', runtime)

      expect(runtime.trackingConfig).toBeNull()
      expect(runtime.trackingDisabledReason).toEqual(expect.any(String))
    } finally {
      await rm(userDataPath, { force: true, recursive: true })
    }
  })

  it('does not pair old provider settings with a newly written credential after a settings-write fault', async () => {
    const userDataPath = await mkdtemp(path.join(tmpdir(), 'war-04-settings-fault-'))
    const settingsPath = path.join(userDataPath, 'settings.json')
    try {
      const store = createStore(userDataPath)
      await store.saveAppSettings(createTrackingDraft({
        baseUrl: 'https://old.example.invalid',
        email: 'old@example.test',
        secret: 'old-secret',
      }))

      const actualRename = fsPromises.rename.bind(fsPromises)
      const renameSpy = vi.spyOn(fsPromises, 'rename').mockImplementation(async (from, to) => {
        if (String(to) === settingsPath) {
          throw Object.assign(new Error('WAR-04 simulated settings rename failure'), {
            code: 'EIO',
          })
        }
        return actualRename(from, to)
      })
      try {
        await expect(
          store.saveAppSettings(createTrackingDraft({
            baseUrl: 'https://new.example.invalid',
            email: 'new@example.test',
            secret: 'new-secret',
          })),
        ).rejects.toThrow('WAR-04 simulated settings rename failure')
      } finally {
        renameSpy.mockRestore()
      }

      const runtime = await createStore(userDataPath).loadRuntimeBootstrapSettings(true)
      const observed = runtime.trackingConfig === null
        ? null
        : {
            baseUrl: runtime.trackingConfig.baseUrl,
            email: runtime.trackingConfig.email,
            password: runtime.trackingConfig.password,
          }
      console.info('WAR-04 cross-file write-fault observation', observed)

      expect(observed).not.toEqual({
        baseUrl: 'https://old.example.invalid',
        email: 'old@example.test',
        password: 'new-secret',
      })
    } finally {
      await rm(userDataPath, { force: true, recursive: true })
    }
  })

  it('serializes simultaneous saves without a rejected write or a cross-paired credential', async () => {
    const userDataPath = await mkdtemp(path.join(tmpdir(), 'war-04-settings-concurrent-'))
    const dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(123_456_789)
    try {
      const store = createStore(userDataPath)
      const first = createTrackingDraft({
        baseUrl: 'https://one.example.invalid',
        email: 'one@example.test',
        secret: 'secret-one',
      })
      const second = createTrackingDraft({
        baseUrl: 'https://two.example.invalid',
        email: 'two@example.test',
        secret: 'secret-two',
      })

      const results = await Promise.allSettled([
        store.saveAppSettings(first),
        store.saveAppSettings(second),
      ])
      const runtime = await createStore(userDataPath).loadRuntimeBootstrapSettings(true)
      const observed = {
        outcomes: results.map((result) => result.status),
        trackingConfig: runtime.trackingConfig,
      }
      console.info('WAR-04 concurrent-settings observation', observed)

      expect([
        {
          baseUrl: 'https://one.example.invalid',
          email: 'one@example.test',
          password: 'secret-one',
        },
        {
          baseUrl: 'https://two.example.invalid',
          email: 'two@example.test',
          password: 'secret-two',
        },
      ]).toContainEqual(runtime.trackingConfig)
    } finally {
      dateNowSpy.mockRestore()
      await rm(userDataPath, { force: true, recursive: true })
    }
  })

  it('exports startup support evidence even when settings JSON is corrupt', async () => {
    const userDataPath = await mkdtemp(path.join(tmpdir(), 'war-04-corrupt-settings-support-'))
    try {
      await writeFile(path.join(userDataPath, 'settings.json'), '{not-json', 'utf8')
      const store = createStore(userDataPath)
      const runtimeFiles = createRuntimeFiles(userDataPath, store.loadAppSettings)

      const reportPath = await runtimeFiles.exportSupportBundle({
        fileName: 'startup-fault-support.txt',
        contents: 'Startup failed while loading settings.',
      })
      const report = await readFile(reportPath, 'utf8')
      console.info('WAR-04 corrupt-settings support observation', { reportPath })

      expect(report).toContain('Startup failed while loading settings.')
    } finally {
      await rm(userDataPath, { force: true, recursive: true })
    }
  })
})

/** Creates the production settings store over a disposable Electron profile. */
function createStore(userDataPath: string): ElectronSettingsStore {
  return createElectronSettingsStore({
    userDataPath,
    safeStorage: createSafeStorage(),
    platform: 'darwin',
  })
}

/** Creates one complete provider-settings draft with a caller-selected credential. */
function createTrackingDraft(input: {
  readonly baseUrl: string
  readonly email: string
  readonly secret: string
}): AppSettingsDraft {
  const draft = createSettingsDraft(DEFAULT_APP_SETTINGS)
  draft.dataSource.providerType = 'traccar_http'
  draft.dataSource.baseUrl = input.baseUrl
  draft.dataSource.email = input.email
  draft.dataSource.secretInput = input.secret
  return draft
}

/** Creates production runtime-file export wiring without accessing real profile data. */
function createRuntimeFiles(
  userDataPath: string,
  loadSettings: () => Promise<AppSettings>,
): ElectronRuntimeFiles {
  return createElectronRuntimeFiles({
    userDataPath,
    versions: { electron: '40.10.0', chrome: '144.0.0', node: process.version },
    platform: process.platform,
    safeStorageBackend: () => 'basic_text',
    loadSettings,
  })
}

/** Supplies the settings store's legacy safeStorage contract without real credentials. */
function createSafeStorage() {
  return {
    decryptString: (encrypted: Buffer) => encrypted.toString('utf8'),
    encryptString: (plainText: string) => Buffer.from(plainText, 'utf8'),
    getSelectedStorageBackend: () => 'basic_text',
    isEncryptionAvailable: () => true,
  }
}
