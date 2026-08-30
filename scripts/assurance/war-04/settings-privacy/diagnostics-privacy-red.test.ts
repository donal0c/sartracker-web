// @vitest-environment jsdom

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { beforeEach, describe, expect, it } from 'vitest'

import {
  clearDiagnosticEvents,
  formatDiagnosticEvents,
  readDiagnosticEvents,
  recordDiagnosticEvent,
} from '../../../../src/features/diagnostics/diagnostic-event-log'
import { buildDiagnosticsSnapshot } from '../../../../src/features/diagnostics/diagnostics-model'
import {
  createSettingsDraft,
  DEFAULT_APP_SETTINGS,
  type AppSettings,
  type AppSettingsDraft,
} from '../../../../src/features/settings/settings-types'

const require = createRequire(import.meta.url)

type ElectronSettingsStore = {
  readonly loadAppSettings: () => Promise<AppSettings>
  readonly saveAppSettings: (input: AppSettingsDraft) => Promise<AppSettings>
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
    readonly readRecentLog?: () => Promise<readonly unknown[]>
  }) => ElectronRuntimeFiles
}

describe('WAR-04 diagnostics and support-output red probes', () => {
  beforeEach(() => {
    clearDiagnosticEvents()
  })

  it('keeps the Electron profile identity out of the report copied by the operator', () => {
    const snapshot = buildDiagnosticsSnapshot(createDiagnosticsInput(
      String.raw`C:\Users\field-operator\AppData\Roaming\SAR Tracker`,
    ))
    console.info('WAR-04 copied-report path observation', snapshot.supportReport)

    expect(snapshot.supportReport).not.toContain('field-operator')
    expect(snapshot.supportReport).not.toContain(String.raw`C:\Users\field-operator`)
  })

  it('does not persist a provider query credential into exported support output', async () => {
    const userDataPath = await mkdtemp(path.join(tmpdir(), 'war-04-query-credential-'))
    try {
      const store = createElectronSettingsStore({
        userDataPath,
        safeStorage: createSafeStorage(),
        platform: 'darwin',
      })
      const draft = createSettingsDraft(DEFAULT_APP_SETTINGS)
      draft.dataSource.providerType = 'traccar_http'
      draft.dataSource.baseUrl =
        'https://tracking.example.invalid/api?session=query-credential-canary'
      draft.dataSource.email = 'operator@example.test'
      draft.dataSource.secretInput = 'separately-stored-secret'
      let saved: AppSettings
      try {
        saved = await store.saveAppSettings(draft)
      } catch {
        // Rejecting a URL-borne credential before persistence is also a safe outcome.
        return
      }
      const runtimeFiles = createRuntimeFiles(userDataPath, store.loadAppSettings)

      const reportPath = await runtimeFiles.exportSupportBundle({
        fileName: 'query-credential-support.txt',
        contents: `provider url: ${saved.dataSource.baseUrl}`,
      })
      const report = await readFile(reportPath, 'utf8')
      console.info('WAR-04 provider-query observation', {
        acceptedUrl: saved.dataSource.baseUrl,
        canaryRetained: report.includes('query-credential-canary'),
      })

      expect(report).not.toContain('query-credential-canary')
    } finally {
      await rm(userDataPath, { force: true, recursive: true })
    }
  })

  it('recursively removes coordinates, credentials, and profile identity from nested event fields', async () => {
    const userDataPath = await mkdtemp(path.join(tmpdir(), 'war-04-nested-diagnostics-'))
    try {
      await recordDiagnosticEvent({
        ts: '2026-08-29T12:00:00.000Z',
        level: 'warn',
        category: 'map',
        event: 'nested_context_probe',
        fields: {
          context: {
            coordinates: [-9.5045, 52.0599],
            token: 'nested-credential-canary',
            path: String.raw`C:\Users\field-operator\case.gpx`,
          },
        },
      })
      const rendererReport = formatDiagnosticEvents(readDiagnosticEvents())
      const runtimeFiles = createRuntimeFiles(userDataPath, async () => DEFAULT_APP_SETTINGS)
      const reportPath = await runtimeFiles.exportSupportBundle({
        fileName: 'nested-event-support.txt',
        contents: rendererReport,
      })
      const report = await readFile(reportPath, 'utf8')
      const observed = {
        coordinateRetained: report.includes('52.0599'),
        credentialRetained: report.includes('nested-credential-canary'),
        profileIdentityRetained: report.includes('field-operator'),
      }
      console.info('WAR-04 nested-diagnostics observation', observed)

      expect(observed).toEqual({
        coordinateRetained: false,
        credentialRetained: false,
        profileIdentityRetained: false,
      })
    } finally {
      await rm(userDataPath, { force: true, recursive: true })
    }
  })

  it('removes precise coordinates from direct main-process runtime-log fields', async () => {
    const userDataPath = await mkdtemp(path.join(tmpdir(), 'war-04-main-log-coordinates-'))
    try {
      const runtimeFiles = createRuntimeFiles(
        userDataPath,
        async () => DEFAULT_APP_SETTINGS,
        async () => [{
          ts: '2026-08-29T12:00:00.000Z',
          level: 'warn',
          event: 'direct_main_probe',
          latitude: 52.123456,
          context: { longitude: -9.123456 },
        }],
      )
      const reportPath = await runtimeFiles.exportSupportBundle({
        fileName: 'main-log-coordinate-support.txt',
        contents: 'Diagnostics Report',
      })
      const report = await readFile(reportPath, 'utf8')
      const observed = {
        latitudeRetained: report.includes('52.123456'),
        longitudeRetained: report.includes('-9.123456'),
      }
      console.info('WAR-04 direct-main coordinate observation', observed)

      expect(observed).toEqual({ latitudeRetained: false, longitudeRetained: false })
    } finally {
      await rm(userDataPath, { force: true, recursive: true })
    }
  })
})

/** Builds the current renderer report whose exact text is handed to Copy Report. */
function createDiagnosticsInput(profilePath: string): Parameters<typeof buildDiagnosticsSnapshot>[0] {
  return {
    generatedAt: '2026-08-29T12:00:00.000Z',
    appVersion: '0.1.0-beta.12.11',
    runtimeKind: 'electron',
    userAgent: 'Electron/40.10.0',
    dependencySmoke: {
      hasMapLibre: true,
      hasProj4: true,
      hasTurf: true,
      hasZustand: true,
      hasTerraDraw: true,
    },
    settings: DEFAULT_APP_SETTINGS,
    runtimeBootstrap: {
      autosaveEnabled: true,
      autosaveIntervalMs: 30_000,
      trackingPollIntervalMs: 30_000,
      trackingCacheEnabled: true,
      trackingConfig: null,
    },
    missionStoreInfo: {
      schema_version: 3,
      database_path: `${profilePath}\\mission-store.sqlite`,
      backup_path: `${profilePath}\\mission-store.backup.sqlite`,
    },
    missions: [],
    missionRuntime: {
      phase: 'idle',
      currentMission: null,
      recoverableMission: null,
    },
    governanceRuntime: { governanceMission: null },
    trackingStatus: {
      mode: 'idle',
      consecutiveFailures: 0,
      recovered: false,
      lastSuccessAt: null,
      warning: null,
    },
    trackingSnapshot: { devices: [], positions: [], breadcrumbs: [] },
    layerCatalogState: {
      missionId: null,
      loading: false,
      error: null,
      metadataEntryCount: 0,
    },
    selectedMissionId: null,
  }
}

/** Creates production runtime-file export wiring over a disposable profile. */
function createRuntimeFiles(
  userDataPath: string,
  loadSettings: () => Promise<AppSettings>,
  readRecentLog?: () => Promise<readonly unknown[]>,
): ElectronRuntimeFiles {
  return createElectronRuntimeFiles({
    userDataPath,
    versions: { electron: '40.10.0', chrome: '144.0.0', node: process.version },
    platform: process.platform,
    safeStorageBackend: () => 'basic_text',
    loadSettings,
    readRecentLog,
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
