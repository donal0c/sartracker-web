import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { AsyncLocalStorage } from 'node:async_hooks'
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

type SaveId = 'one' | 'two'

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
      expect(runtime.trackingDisabledReason).toEqual(expect.stringMatching(/\S/u))
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
    const rootPath = await mkdtemp(path.join(tmpdir(), 'war-04-settings-concurrent-'))
    const collisionPath = path.join(rootPath, 'temp-collision')
    const interleavingPath = path.join(rootPath, 'cross-file-interleaving')
    try {
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

      const fixedDateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(123_456_789)
      let collisionResults: readonly PromiseSettledResult<AppSettings>[]
      try {
        const collisionStore = createStore(collisionPath)
        collisionResults = await Promise.allSettled([
          collisionStore.saveAppSettings(first),
          collisionStore.saveAppSettings(second),
        ])
      } finally {
        fixedDateNowSpy.mockRestore()
      }

      const settingsPath = path.join(interleavingPath, 'settings.json')
      const credentialsPath = path.join(interleavingPath, 'credentials.json')
      const saveContext = new AsyncLocalStorage<SaveId>()
      const admitted = new Set<SaveId>()
      const committed = new Set<SaveId>()
      const credentialOneDone = createDeferredSignal()
      const credentialTwoDone = createDeferredSignal()
      const settingsTwoDone = createDeferredSignal()
      const renameOrder: string[] = []
      let overlappingSaves = false
      let tempSequence = 700_000_000

      const actualReadFile = fsPromises.readFile.bind(fsPromises)
      const actualRename = fsPromises.rename.bind(fsPromises)
      const uniqueDateNowSpy = vi.spyOn(Date, 'now').mockImplementation(() => tempSequence++)
      const readSpy = vi.spyOn(fsPromises, 'readFile').mockImplementation(
        (async (filePath, ...args) => {
          const saveId = saveContext.getStore()
          if (
            saveId !== undefined &&
            String(filePath) === credentialsPath &&
            !admitted.has(saveId)
          ) {
            const other: SaveId = saveId === 'one' ? 'two' : 'one'
            if (admitted.has(other) && !committed.has(other)) {
              overlappingSaves = true
            }
            admitted.add(saveId)
          }
          return actualReadFile(filePath, ...args)
        }) as typeof fsPromises.readFile,
      )
      const renameSpy = vi.spyOn(fsPromises, 'rename').mockImplementation(async (from, to) => {
        const saveId = saveContext.getStore()
        const target = String(to)
        const renameAndMark = async (): Promise<void> => {
          await actualRename(from, to)
          if (saveId !== undefined && target === settingsPath) {
            committed.add(saveId)
          }
          renameOrder.push(`${saveId ?? 'unscoped'}:${path.basename(target)}`)
        }

        if (!overlappingSaves || saveId === undefined) {
          return renameAndMark()
        }
        if (target === credentialsPath && saveId === 'one') {
          await renameAndMark()
          credentialOneDone.resolve()
          return
        }
        if (target === credentialsPath && saveId === 'two') {
          await credentialOneDone.promise
          await renameAndMark()
          credentialTwoDone.resolve()
          return
        }
        if (target === settingsPath && saveId === 'two') {
          await credentialTwoDone.promise
          await renameAndMark()
          settingsTwoDone.resolve()
          return
        }
        if (target === settingsPath && saveId === 'one') {
          await settingsTwoDone.promise
          await renameAndMark()
          return
        }
        return renameAndMark()
      })

      let interleavingResults: readonly PromiseSettledResult<AppSettings>[]
      let runtime: RuntimeBootstrapSettings
      try {
        const interleavingStore = createStore(interleavingPath)
        interleavingResults = await Promise.allSettled([
          saveContext.run('one', () => interleavingStore.saveAppSettings(first)),
          saveContext.run('two', () => interleavingStore.saveAppSettings(second)),
        ])
        runtime = await createStore(interleavingPath).loadRuntimeBootstrapSettings(true)
      } finally {
        renameSpy.mockRestore()
        readSpy.mockRestore()
        uniqueDateNowSpy.mockRestore()
      }

      const observed = {
        admittedSaveIds: [...admitted].sort(),
        collisionOutcomes: collisionResults.map((result) => result.status),
        interleavingOutcomes: interleavingResults.map((result) => result.status),
        overlappingSaves,
        renameOrder,
        trackingConfig: runtime.trackingConfig,
      }
      console.info('WAR-04 concurrent-settings observation', observed)

      const coherentTrackingConfigs = [
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
      ]
      const hostileRenameOrder = [
        'one:credentials.json',
        'two:credentials.json',
        'two:settings.json',
        'one:settings.json',
      ]
      const serializedRenameOrders = [
        [
          'one:credentials.json',
          'one:settings.json',
          'two:credentials.json',
          'two:settings.json',
        ],
        [
          'two:credentials.json',
          'two:settings.json',
          'one:credentials.json',
          'one:settings.json',
        ],
      ]

      expect.soft(observed.admittedSaveIds).toEqual(['one', 'two'])
      expect.soft(observed.collisionOutcomes).toEqual(['fulfilled', 'fulfilled'])
      expect.soft(observed.interleavingOutcomes).toEqual(['fulfilled', 'fulfilled'])
      if (observed.overlappingSaves) {
        expect.soft(observed.renameOrder).toEqual(hostileRenameOrder)
        expect.soft(observed.trackingConfig).toEqual({
          baseUrl: 'https://one.example.invalid',
          email: 'one@example.test',
          password: 'secret-two',
        })
      } else {
        expect.soft(serializedRenameOrders).toContainEqual(observed.renameOrder)
      }
      expect.soft(coherentTrackingConfigs).toContainEqual(observed.trackingConfig)
    } finally {
      vi.restoreAllMocks()
      await rm(rootPath, { force: true, recursive: true })
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

/** Creates a one-shot barrier for a deterministic asynchronous interleaving. */
function createDeferredSignal(): {
  readonly promise: Promise<void>
  readonly resolve: () => void
} {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
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
