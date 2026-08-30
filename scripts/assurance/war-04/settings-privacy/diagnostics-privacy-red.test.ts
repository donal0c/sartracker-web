// @vitest-environment jsdom

import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
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
import { PROVIDER_URL_CREDENTIALS_ERROR } from '../../../../src/features/settings/settings-validation'
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

type RuntimeLog = {
  readonly appendDurable: (input: {
    readonly level: string
    readonly event: string
    readonly fields: Readonly<Record<string, unknown>>
  }) => Promise<void>
  readonly readRecent: (limit?: number) => Promise<readonly unknown[]>
}

type ProviderUrlProbeObservation = {
  readonly caseName: string
  readonly rejection: string | null
  readonly persistedMarkers: readonly string[]
  readonly persistedDataSource: {
    readonly providerType: AppSettings['dataSource']['providerType']
    readonly baseUrl: string
    readonly email: string
    readonly secretPresent: boolean
  }
  readonly credentialFilePresent: boolean
  readonly copiedReportMarkers: readonly string[]
  readonly exportedMarkers: readonly string[]
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

const { createRuntimeLog } = require('../../../../electron/runtime-log.cjs') as {
  readonly createRuntimeLog: (options: {
    readonly userDataPath: string
    readonly now?: () => string
  }) => RuntimeLog
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

  it('does not persist or export credential-bearing query and fragment forms', async () => {
    const probeCases = [
      {
        caseName: 'raw-query-session',
        baseUrl: 'https://tracking.example.invalid/api?session=raw-query-credential-canary',
        leakMarkers: ['raw-query-credential-canary'],
      },
      {
        caseName: 'encoded-query-key-session',
        baseUrl: 'https://tracking.example.invalid/api?ses%73ion=encoded-key-credential-canary',
        leakMarkers: ['encoded-key-credential-canary'],
      },
      {
        caseName: 'encoded-query-value-session',
        baseUrl: 'https://tracking.example.invalid/api?session=encoded%2Dcredential%2Dcanary',
        leakMarkers: ['encoded%2Dcredential%2Dcanary', 'encoded-credential-canary'],
      },
      {
        caseName: 'double-encoded-query-value-session',
        baseUrl: 'https://tracking.example.invalid/api?session=double%252Dcredential%252Dcanary',
        leakMarkers: [
          'double%252Dcredential%252Dcanary',
          'double%2Dcredential%2Dcanary',
          'double-credential-canary',
        ],
      },
      {
        caseName: 'fragment-session',
        baseUrl: 'https://tracking.example.invalid/api#session=fragment-credential-canary',
        leakMarkers: ['fragment-credential-canary'],
      },
    ] as const
    const observations: ProviderUrlProbeObservation[] = []

    for (const probeCase of probeCases) {
      const userDataPath = await mkdtemp(
        path.join(tmpdir(), `war-04-${probeCase.caseName}-`),
      )
      try {
        const store = createElectronSettingsStore({
          userDataPath,
          safeStorage: createSafeStorage(),
          platform: 'darwin',
        })
        const draft = createSettingsDraft(DEFAULT_APP_SETTINGS)
        draft.dataSource.providerType = 'traccar_http'
        draft.dataSource.baseUrl = probeCase.baseUrl
        draft.dataSource.email = 'operator@example.test'
        draft.dataSource.secretInput = 'separately-stored-secret'
        let saved: AppSettings | null = null
        let rejection: string | null = null
        try {
          saved = await store.saveAppSettings(draft)
        } catch (error) {
          rejection = error instanceof Error ? error.message : String(error)
        }

        const reloaded = await store.loadAppSettings()
        const persistedDataSource = {
          providerType: reloaded.dataSource.providerType,
          baseUrl: reloaded.dataSource.baseUrl,
          email: reloaded.dataSource.email,
          secretPresent: reloaded.dataSource.secretPresent,
        }
        const credentialFilePresent = await fileExists(
          path.join(userDataPath, 'credentials.json'),
        )

        if (saved === null) {
          observations.push({
            caseName: probeCase.caseName,
            rejection,
            persistedMarkers: findRetainedMarkers(
              reloaded.dataSource.baseUrl,
              probeCase.leakMarkers,
            ),
            persistedDataSource,
            credentialFilePresent,
            copiedReportMarkers: [],
            exportedMarkers: [],
          })
          continue
        }

        const copiedReport = buildDiagnosticsSnapshot(
          createDiagnosticsInput(userDataPath, saved),
        ).supportReport
        const runtimeFiles = createRuntimeFiles(userDataPath, store.loadAppSettings)
        const reportPath = await runtimeFiles.exportSupportBundle({
          fileName: `${probeCase.caseName}-support.txt`,
          contents: copiedReport,
        })
        const report = await readFile(reportPath, 'utf8')
        observations.push({
          caseName: probeCase.caseName,
          rejection,
          persistedMarkers: findRetainedMarkers(
            saved.dataSource.baseUrl,
            probeCase.leakMarkers,
          ),
          persistedDataSource,
          credentialFilePresent,
          copiedReportMarkers: findRetainedMarkers(copiedReport, probeCase.leakMarkers),
          exportedMarkers: findRetainedMarkers(report, probeCase.leakMarkers),
        })
      } finally {
        await rm(userDataPath, { force: true, recursive: true })
      }
    }

    console.info('WAR-04 provider-query observations', observations)
    const unsafeObservations = observations.filter(
      (observation) =>
        observation.rejection !== PROVIDER_URL_CREDENTIALS_ERROR ||
        observation.persistedMarkers.length > 0 ||
        observation.copiedReportMarkers.length > 0 ||
        observation.exportedMarkers.length > 0 ||
        observation.credentialFilePresent ||
        observation.persistedDataSource.providerType !== 'none' ||
        observation.persistedDataSource.baseUrl !== '' ||
        observation.persistedDataSource.email !== '' ||
        observation.persistedDataSource.secretPresent,
    )
    expect(unsafeObservations).toEqual([])
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
        coordinateMarkersRetained: ['-9.5045', '52.0599'].filter((marker) =>
          report.includes(marker),
        ),
        credentialRetained: report.includes('nested-credential-canary'),
        profileIdentityRetained: report.includes('field-operator'),
      }
      console.info('WAR-04 nested-diagnostics observation', observed)

      expect(observed).toEqual({
        coordinateMarkersRetained: [],
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
      const runtimeLog = createRuntimeLog({
        userDataPath,
        now: () => '2026-08-29T12:00:00.000Z',
      })
      await runtimeLog.appendDurable({
        level: 'warn',
        event: 'direct_main_probe',
        fields: {
          latitude: 52.123456,
          context: { longitude: -9.123456 },
        },
      })
      const persistedEntries = await runtimeLog.readRecent()
      const runtimeFiles = createRuntimeFiles(
        userDataPath,
        async () => DEFAULT_APP_SETTINGS,
        () => runtimeLog.readRecent(),
      )
      const reportPath = await runtimeFiles.exportSupportBundle({
        fileName: 'main-log-coordinate-support.txt',
        contents: 'Diagnostics Report',
      })
      const report = await readFile(reportPath, 'utf8')
      const persistedText = JSON.stringify(persistedEntries)
      const observed = {
        persistedLatitudeRetained: persistedText.includes('52.123456'),
        persistedLongitudeRetained: persistedText.includes('-9.123456'),
        latitudeRetained: report.includes('52.123456'),
        longitudeRetained: report.includes('-9.123456'),
      }
      console.info('WAR-04 direct-main coordinate observation', observed)

      expect(observed).toEqual({
        persistedLatitudeRetained: false,
        persistedLongitudeRetained: false,
        latitudeRetained: false,
        longitudeRetained: false,
      })
    } finally {
      await rm(userDataPath, { force: true, recursive: true })
    }
  })
})

/** Builds the current renderer report whose exact text is handed to Copy Report. */
function createDiagnosticsInput(
  profilePath: string,
  settings: AppSettings = DEFAULT_APP_SETTINGS,
): Parameters<typeof buildDiagnosticsSnapshot>[0] {
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
    settings,
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

/** Returns every synthetic connection-detail marker still present in one representation. */
function findRetainedMarkers(
  value: string,
  markers: readonly string[],
): readonly string[] {
  return markers.filter((marker) => value.includes(marker))
}

/** Reports whether an audit fixture path exists without reading its contents. */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false
    }
    throw error
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
