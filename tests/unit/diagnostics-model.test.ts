import { describe, expect, it } from 'vitest'

import { buildDiagnosticsSnapshot } from '../../src/features/diagnostics/diagnostics-model'
import type { AppSettings, RuntimeBootstrapSettings } from '../../src/features/settings/settings-types'
import type { MissionRuntimeState } from '../../src/features/mission/mission-store'
import type { MissionGovernanceRuntimeState } from '../../src/features/mission/start-mission-governance-runtime'
import type { TrackingConnectionStatus, TrackingSnapshot } from '../../src/features/tracking/tracking-types'
import type { Mission, MissionStoreInfo } from '../../src/infrastructure/mission-store/tauri-mission-store'

describe('diagnostics model', () => {
  it('builds an operator-facing snapshot and support report', () => {
    const snapshot = buildDiagnosticsSnapshot({
      generatedAt: '2026-04-11T00:30:00.000Z',
      appVersion: '0.1.0',
      runtimeKind: 'tauri',
      userAgent: 'SARTrackerTest/1.0',
      dependencySmoke: {
        hasMapLibre: true,
        hasProj4: true,
        hasTurf: true,
        hasZustand: true,
        hasTerraDraw: true,
      },
      settings: createSettings(),
      runtimeBootstrap: createRuntimeBootstrap(),
      missionStoreInfo: createStoreInfo(),
      missions: [createMission()],
      missionRuntime: createMissionRuntime(),
      governanceRuntime: createGovernanceRuntime(),
      trackingStatus: createTrackingStatus(),
      trackingSnapshot: createTrackingSnapshot(),
      diagnosticEvents: [
        {
          ts: '2026-06-22T15:05:00.000Z',
          level: 'info',
          category: 'map',
          event: 'basemap_changed',
          fields: {
            basemapId: 'official_discovery_topo',
            lat: '[coordinate-redacted]',
          },
        },
      ],
      trackingPollLedger: [
        {
          ts: '2026-06-22T15:05:01.000Z',
          kind: 'poll_cycle',
          outcome: 'failure',
          phase: 'current_positions',
          durationMs: 47_000,
          consecutiveFailures: 1,
          retryDelayMs: 1_000,
          failureKind: 'timeout',
        },
      ],
      layerCatalogState: {
        missionId: 'mission-1',
        loading: false,
        error: null,
        metadataEntryCount: 3,
      },
      selectedMissionId: 'mission-1',
    })

    expect(snapshot.summaryRows.some((row) => row.label === 'Runtime' && row.value === 'Tauri desktop')).toBe(true)
    expect(snapshot.summaryRows.some((row) => row.label === 'Tracking mode' && row.value === 'online')).toBe(true)
    expect(snapshot.storageRows.some((row) => row.label === 'Schema version' && row.value === '3')).toBe(true)
    expect(snapshot.configurationRows.some((row) => row.label === 'Official maps' && row.value === 'configured')).toBe(true)
    expect(snapshot.configurationRows.some((row) => row.label === 'Official packages' && row.value === '1 ready / 2 registered')).toBe(true)
    expect(snapshot.repair.targetMissionLabel).toContain('Night Ops')
    expect(snapshot.supportReport).toContain('Diagnostics Report')
    expect(snapshot.supportReport).toContain('Night Ops')
    expect(snapshot.supportReport).toContain('https://traccar.example.com')
    expect(snapshot.supportReport).toContain('official maps: configured')
    expect(snapshot.supportReport).toContain('official map packages: 2')
    expect(snapshot.supportReport).toContain('official map packages ready: 1')
    expect(snapshot.supportReport).toContain('official map package 1: official_discovery_topo ready mbtiles z8-z16 tiles=31729 size=1100000000 format=png')
    expect(snapshot.supportReport).toContain('official map package 2: official_discovery_topo missing mbtiles')
    expect(snapshot.supportReport).toContain('[diagnostic-breadcrumbs]')
    expect(snapshot.supportReport).toContain('basemap_changed')
    expect(snapshot.supportReport).toContain('[tracking-poll-ledger]')
    expect(snapshot.supportReport).toContain('"failureKind":"timeout"')
    expect(snapshot.supportReport).not.toContain('52.0599')
    expect(snapshot.supportReport).not.toContain('mountainrescue_org.txt')
    expect(snapshot.supportReport).not.toContain('reeks-standard-60km-z16.mbtiles')
    expect(snapshot.supportReport).toContain('layer metadata entries: 3')
  })

  it('flags browser-mode and degraded tracking/operator warnings clearly', () => {
    const snapshot = buildDiagnosticsSnapshot({
      generatedAt: '2026-04-11T00:45:00.000Z',
      appVersion: '0.1.0',
      runtimeKind: 'browser',
      userAgent: 'BrowserHarness/1.0',
      dependencySmoke: {
        hasMapLibre: true,
        hasProj4: true,
        hasTurf: true,
        hasZustand: true,
        hasTerraDraw: false,
      },
      settings: {
        ...createSettings(),
        dataSource: {
          ...createSettings().dataSource,
          providerType: 'none',
          autoConnect: false,
        },
      },
      runtimeBootstrap: {
        ...createRuntimeBootstrap(),
        trackingConfig: null,
      },
      missionStoreInfo: createStoreInfo(),
      missions: [],
      missionRuntime: {
        phase: 'idle',
        currentMission: null,
        recoverableMission: null,
      },
      governanceRuntime: {
        governanceMission: null,
      },
      trackingStatus: {
        mode: 'offline',
        consecutiveFailures: 4,
        recovered: false,
        lastSuccessAt: null,
        warning: 'Tracking feed is offline.',
      },
      trackingSnapshot: {
        devices: [],
        positions: [],
        breadcrumbs: [],
      },
      layerCatalogState: {
        missionId: null,
        loading: false,
        error: 'Layer catalog unavailable.',
        metadataEntryCount: 0,
      },
      selectedMissionId: null,
    })

    expect(snapshot.summaryRows.some((row) => row.label === 'Runtime' && row.value === 'Browser validation')).toBe(true)
    expect(snapshot.repair.targetMissionId).toBeNull()
    expect(snapshot.warnings).toContain('Layer catalog unavailable.')
    expect(snapshot.warnings).toContain('Tracking feed is offline.')
    expect(snapshot.supportReport).toContain('tracking mode: offline')
    expect(snapshot.supportReport).toContain('repair target: unavailable')
  })

  it('labels Electron desktop diagnostics separately from browser validation', () => {
    const snapshot = buildDiagnosticsSnapshot({
      generatedAt: '2026-04-11T00:50:00.000Z',
      appVersion: '0.1.0',
      runtimeKind: 'electron',
      userAgent: 'Electron/40.10.0 SARTrackerTest/1.0',
      dependencySmoke: {
        hasMapLibre: true,
        hasProj4: true,
        hasTurf: true,
        hasZustand: true,
        hasTerraDraw: true,
      },
      settings: createSettings(),
      runtimeBootstrap: createRuntimeBootstrap(),
      missionStoreInfo: createStoreInfo(),
      missions: [createMission()],
      missionRuntime: createMissionRuntime(),
      governanceRuntime: createGovernanceRuntime(),
      trackingStatus: createTrackingStatus(),
      trackingSnapshot: createTrackingSnapshot(),
      layerCatalogState: {
        missionId: 'mission-1',
        loading: false,
        error: null,
        metadataEntryCount: 3,
      },
      selectedMissionId: 'mission-1',
    })

    expect(snapshot.summaryRows).toContainEqual({ label: 'Runtime', value: 'Electron desktop' })
    expect(snapshot.supportReport).toContain('runtime: electron desktop')
    expect(snapshot.supportReport).not.toContain('runtime: browser validation')
  })

  it('redacts credentials embedded in provider URLs across diagnostics rows and report text [DON-207]', () => {
    const settings = {
      ...createSettings(),
      dataSource: {
        ...createSettings().dataSource,
        baseUrl: 'https://operator:field-secret@kmrtsar.eu',
      },
    } satisfies AppSettings
    const snapshot = buildDiagnosticsSnapshot({
      generatedAt: '2026-04-11T00:55:00.000Z',
      appVersion: '0.1.0',
      runtimeKind: 'electron',
      userAgent: 'Electron/40.10.0 SARTrackerTest/1.0',
      dependencySmoke: {
        hasMapLibre: true,
        hasProj4: true,
        hasTurf: true,
        hasZustand: true,
        hasTerraDraw: true,
      },
      settings,
      runtimeBootstrap: createRuntimeBootstrap(),
      missionStoreInfo: createStoreInfo(),
      missions: [createMission()],
      missionRuntime: createMissionRuntime(),
      governanceRuntime: createGovernanceRuntime(),
      trackingStatus: createTrackingStatus(),
      trackingSnapshot: createTrackingSnapshot(),
      layerCatalogState: {
        missionId: 'mission-1',
        loading: false,
        error: null,
        metadataEntryCount: 3,
      },
      selectedMissionId: 'mission-1',
    })

    expect(snapshot.configurationRows).toContainEqual({
      label: 'Provider URL',
      value: 'https://[redacted]@kmrtsar.eu',
    })
    expect(snapshot.supportReport).toContain('provider url: https://[redacted]@kmrtsar.eu')
    expect(snapshot.supportReport).not.toContain('operator')
    expect(snapshot.supportReport).not.toContain('field-secret')
  })

  it('reports per-device breadcrumb render budgets and warnings [DON-159]', () => {
    const snapshot = buildDiagnosticsSnapshot({
      generatedAt: '2026-06-13T21:48:51.654Z',
      appVersion: '0.1.0-beta.4',
      runtimeKind: 'electron',
      userAgent: 'Electron/40.10.0 SARTrackerTest/1.0',
      dependencySmoke: {
        hasMapLibre: true,
        hasProj4: true,
        hasTurf: true,
        hasZustand: true,
        hasTerraDraw: true,
      },
      settings: createSettings(),
      runtimeBootstrap: createRuntimeBootstrap(),
      missionStoreInfo: createStoreInfo(),
      missions: [createMission()],
      missionRuntime: createMissionRuntime(),
      governanceRuntime: createGovernanceRuntime(),
      trackingStatus: createTrackingStatus(),
      trackingSnapshot: {
        ...createTrackingSnapshot(),
        breadcrumbs: [],
        breadcrumbMetadata: {
          totalObserved: 28_280,
          totalRetained: 8_280,
          deviceBudgets: [
            {
              deviceId: '2',
              retained: 5_000,
              total: 25_000,
              firstTimestamp: '2026-06-13T01:00:00.000Z',
              lastTimestamp: '2026-06-13T21:30:00.000Z',
              truncated: true,
            },
            {
              deviceId: '25',
              retained: 3_280,
              total: 3_280,
              firstTimestamp: '2026-06-12T11:59:28.481Z',
              lastTimestamp: '2026-06-12T18:30:03.974Z',
              truncated: false,
            },
          ],
        },
      },
      layerCatalogState: {
        missionId: 'mission-1',
        loading: false,
        error: null,
        metadataEntryCount: 3,
      },
      selectedMissionId: 'mission-1',
    })

    expect(snapshot.supportReport).toContain('breadcrumb render retained: 8280 of 28280')
    expect(snapshot.supportReport).toContain('breadcrumb device 2: retained=5000 total=25000')
    expect(snapshot.supportReport).toContain('truncated=yes')
    expect(snapshot.supportReport).toContain('breadcrumb device 25: retained=3280 total=3280')
    expect(snapshot.supportReport).toContain('truncated=no')
    expect(snapshot.warnings).toContain(
      'Breadcrumb history is render-budgeted for 1 device; exported diagnostics include per-device counts.',
    )
  })
})

function createSettings(): AppSettings {
  return {
    missionDefaults: {
      autoRefreshEnabled: true,
      autoRefreshIntervalSeconds: 30,
      autoSaveEnabled: true,
      autoSaveIntervalSeconds: 45,
      primaryMissionRoot: '/missions/primary',
      backupMissionRoot: '/missions/backup',
      coordinatorRoster: ['C1', 'C2'],
      adminRoster: ['Ops Lead'],
    },
    dataSource: {
      providerType: 'traccar_http',
      baseUrl: 'https://traccar.example.com',
      authMode: 'basic',
      email: 'ops@example.com',
      autoConnect: true,
      trackingCacheEnabled: true,
      replayEnabled: false,
      replayStart: '',
      replayDurationHours: 4,
      secretPresent: true,
    },
    officialMaps: {
      sourceType: 'mapgenie_file',
      sourcePath: '/private/maps/mountainrescue_org.txt',
      status: 'configured',
      username: 'mountainrescue_org',
      availableSources: ['official_discovery_topo'],
      serviceCount: 1,
      message: 'Official Discovery Topo source configured.',
      packages: [
        {
          id: 'official_discovery_topo-ready',
          sourceType: 'mbtiles',
          mapId: 'official_discovery_topo',
          packagePath: '/private/maps/reeks-standard-60km-z16.mbtiles',
          status: 'ready',
          bounds: [-10.25, 51.85, -9.45, 52.35],
          minZoom: 8,
          maxZoom: 16,
          tileCount: 31_729,
          tileFormat: 'png',
          sizeBytes: 1_100_000_000,
          createdAt: '2026-06-05T10:00:00.000Z',
          verifiedAt: '2026-06-05T10:11:12.000Z',
          message: 'Official Discovery Topo package is ready.',
        },
        {
          id: 'official_discovery_topo-missing',
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
          verifiedAt: '2026-06-05T10:12:12.000Z',
          message: 'Official map package file was not found.',
        },
      ],
    },
    weather: {
      links: [],
    },
    advanced: {
      repairLayerStructureAvailable: true,
    },
  }
}

function createRuntimeBootstrap(): RuntimeBootstrapSettings {
  return {
    autosaveEnabled: true,
    autosaveIntervalMs: 45_000,
    trackingPollIntervalMs: 30_000,
    trackingCacheEnabled: true,
    trackingConfig: {
      baseUrl: 'https://traccar.example.com',
      email: 'ops@example.com',
      password: 'secret',
    },
  }
}

function createStoreInfo(): MissionStoreInfo {
  return {
    schema_version: 3,
    database_path: '/tmp/browser-harness/mission-store.sqlite',
    backup_path: '/tmp/browser-harness/mission-store.backup.sqlite',
  }
}

function createMission(): Mission {
  return {
    id: 'mission-1',
    name: 'Night Ops',
    status: 'active',
    start_time: '2026-04-11T00:00:00.000Z',
    pause_time: null,
    finish_time: null,
    paused_seconds: 0,
    notes: 'Primary search in progress.',
    schema_version: 3,
  }
}

function createMissionRuntime(): MissionRuntimeState {
  return {
    phase: 'active',
    currentMission: createMission(),
    recoverableMission: null,
  }
}

function createGovernanceRuntime(): MissionGovernanceRuntimeState {
  return {
    governanceMission: null,
  }
}

function createTrackingStatus(): TrackingConnectionStatus {
  return {
    mode: 'online',
    consecutiveFailures: 0,
    recovered: false,
    lastSuccessAt: '2026-04-11T00:29:30.000Z',
    warning: null,
  }
}

function createTrackingSnapshot(): TrackingSnapshot {
  return {
    devices: [
      {
        device_id: 'alpha',
        name: 'Alpha Team',
        status: 'online',
        last_seen: '2026-04-11T00:29:30.000Z',
        unique_id: null,
        category: null,
      },
    ],
    positions: [
      {
        id: 'pos-1',
        device_id: 'alpha',
        lat: 52.0599,
        lon: -9.5045,
        altitude: null,
        speed: 2.8,
        battery: 81,
        accuracy: null,
        timestamp: '2026-04-11T00:29:30.000Z',
        source: 'traccar',
        data_origin: 'live',
        cache_age_seconds: null,
        device_cache_stale: false,
      },
    ],
    breadcrumbs: [],
  }
}
