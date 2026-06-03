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
      isTauriRuntimeAvailable: true,
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
    expect(snapshot.repair.targetMissionLabel).toContain('Night Ops')
    expect(snapshot.supportReport).toContain('Diagnostics Report')
    expect(snapshot.supportReport).toContain('Night Ops')
    expect(snapshot.supportReport).toContain('https://traccar.example.com')
    expect(snapshot.supportReport).toContain('official maps: configured')
    expect(snapshot.supportReport).not.toContain('mountainrescue_org.txt')
    expect(snapshot.supportReport).toContain('layer metadata entries: 3')
  })

  it('flags browser-mode and degraded tracking/operator warnings clearly', () => {
    const snapshot = buildDiagnosticsSnapshot({
      generatedAt: '2026-04-11T00:45:00.000Z',
      appVersion: '0.1.0',
      isTauriRuntimeAvailable: false,
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
