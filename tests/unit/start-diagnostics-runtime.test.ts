import { describe, expect, it, vi } from 'vitest'

import { startDiagnosticsRuntime } from '../../src/features/diagnostics/start-diagnostics-runtime'
import type { AppSettings, RuntimeBootstrapSettings } from '../../src/features/settings/settings-types'
import type { Mission } from '../../src/infrastructure/mission-store/tauri-mission-store'

describe('startDiagnosticsRuntime', () => {
  it('loads diagnostics using cached application snapshots and store boundaries', async () => {
    const applyRuntime = vi.fn()
    const runtime = await startDiagnosticsRuntime({
      appVersion: '0.1.0',
      getRuntimeKind: () => 'tauri',
      getUserAgent: () => 'SARTrackerTest/1.0',
      getDependencySmoke: () => ({
        hasMapLibre: true,
        hasProj4: true,
        hasTurf: true,
        hasZustand: true,
        hasTerraDraw: true,
      }),
      loadSettings: vi.fn().mockResolvedValue(createSettings()),
      loadRuntimeBootstrapSettings: vi.fn().mockResolvedValue(createRuntimeBootstrap()),
      missionStore: {
        info: vi.fn().mockResolvedValue({
          schema_version: 3,
          database_path: '/tmp/mission-store.sqlite',
          backup_path: '/tmp/mission-store.backup.sqlite',
        }),
        listMissions: vi.fn().mockResolvedValue([createMission()]),
      },
      layerCatalogStore: {
        clearMetadata: vi.fn(),
      },
      readMissionRuntime: () => ({
        phase: 'active',
        currentMission: createMission(),
        recoverableMission: null,
      }),
      readMissionGovernanceRuntime: () => ({
        governanceMission: null,
      }),
      readTrackingRuntime: () => ({
        status: {
          mode: 'online',
          consecutiveFailures: 0,
          recovered: false,
          lastSuccessAt: '2026-04-11T01:00:00.000Z',
          warning: null,
        },
        snapshot: {
          devices: [],
          positions: [],
          breadcrumbs: [],
        },
      }),
      readLayerCatalogRuntime: () => ({
        missionId: 'mission-1',
        metadataEntryCount: 4,
        loading: false,
        error: null,
      }),
      readDiagnosticEvents: () => [
        {
          ts: '2026-04-11T01:17:00.000Z',
          level: 'info',
          category: 'map',
          event: 'marker_saved',
          fields: { markerType: 'clue' },
        },
        {
          ts: '2026-04-11T02:30:00.000Z',
          level: 'info',
          category: 'map',
          event: 'outside_window',
        },
      ],
      readDiagnosticEvents: () => [
        {
          ts: '2026-04-11T01:17:00.000Z',
          level: 'info',
          category: 'map',
          event: 'marker_saved',
          fields: { markerType: 'clue' },
        },
        {
          ts: '2026-04-11T02:30:00.000Z',
          level: 'info',
          category: 'map',
          event: 'outside_window',
        },
      ],
      exportReport: vi.fn().mockResolvedValue('/tmp/diagnostics/report.txt'),
      refreshLayerCatalogIfActive: vi.fn().mockResolvedValue(undefined),
      applyRuntime,
      now: () => new Date('2026-04-11T01:00:00.000Z'),
    })

    await runtime.load()

    expect(applyRuntime).toHaveBeenLastCalledWith(
      expect.objectContaining({
        loading: false,
        snapshot: expect.objectContaining({
          repair: expect.objectContaining({
            targetMissionId: 'mission-1',
          }),
        }),
      }),
    )
  })

  it('runs the layer repair action and refreshes the active catalog when applicable', async () => {
    const clearMetadata = vi.fn().mockResolvedValue(undefined)
    const refreshLayerCatalogIfActive = vi.fn().mockResolvedValue(undefined)
    const applyRuntime = vi.fn()
    const runtime = await startDiagnosticsRuntime({
      appVersion: '0.1.0',
      getRuntimeKind: () => 'tauri',
      getUserAgent: () => 'SARTrackerTest/1.0',
      getDependencySmoke: () => ({
        hasMapLibre: true,
        hasProj4: true,
        hasTurf: true,
        hasZustand: true,
        hasTerraDraw: true,
      }),
      loadSettings: vi.fn().mockResolvedValue(createSettings()),
      loadRuntimeBootstrapSettings: vi.fn().mockResolvedValue(createRuntimeBootstrap()),
      missionStore: {
        info: vi.fn().mockResolvedValue({
          schema_version: 3,
          database_path: '/tmp/mission-store.sqlite',
          backup_path: '/tmp/mission-store.backup.sqlite',
        }),
        listMissions: vi.fn().mockResolvedValue([createMission()]),
      },
      layerCatalogStore: {
        clearMetadata,
      },
      readMissionRuntime: () => ({
        phase: 'active',
        currentMission: createMission(),
        recoverableMission: null,
      }),
      readMissionGovernanceRuntime: () => ({
        governanceMission: null,
      }),
      readTrackingRuntime: () => ({
        status: {
          mode: 'online',
          consecutiveFailures: 0,
          recovered: false,
          lastSuccessAt: '2026-04-11T01:00:00.000Z',
          warning: null,
        },
        snapshot: {
          devices: [],
          positions: [],
          breadcrumbs: [],
        },
      }),
      readLayerCatalogRuntime: () => ({
        missionId: 'mission-1',
        metadataEntryCount: 4,
        loading: false,
        error: null,
      }),
      readDiagnosticEvents: () => [
        {
          ts: '2026-04-11T01:17:00.000Z',
          level: 'info',
          category: 'map',
          event: 'marker_saved',
          fields: { markerType: 'clue' },
        },
        {
          ts: '2026-04-11T02:30:00.000Z',
          level: 'info',
          category: 'map',
          event: 'outside_window',
        },
      ],
      exportReport: vi.fn().mockResolvedValue('/tmp/diagnostics/report.txt'),
      refreshLayerCatalogIfActive,
      applyRuntime,
      now: () => new Date('2026-04-11T01:00:00.000Z'),
    })

    await runtime.load()
    await runtime.repairLayerCatalog()

    expect(clearMetadata).toHaveBeenCalledWith('mission-1')
    expect(refreshLayerCatalogIfActive).toHaveBeenCalledWith('mission-1')
    expect(applyRuntime).toHaveBeenLastCalledWith(
      expect.objectContaining({
        feedback: expect.stringContaining('Layer catalog metadata reset'),
      }),
    )
  })
  it('exports a support bundle under a distinct file name and surfaces the path', async () => {
    const exportSupportBundle = vi.fn().mockResolvedValue('/tmp/diagnostics/support-bundle.txt')
    const applyRuntime = vi.fn()
    const runtime = await startDiagnosticsRuntime({
      appVersion: '0.1.0',
      getRuntimeKind: () => 'electron',
      getUserAgent: () => 'SARTrackerTest/1.0',
      getDependencySmoke: () => ({
        hasMapLibre: true,
        hasProj4: true,
        hasTurf: true,
        hasZustand: true,
        hasTerraDraw: true,
      }),
      loadSettings: vi.fn().mockResolvedValue(createSettings()),
      loadRuntimeBootstrapSettings: vi.fn().mockResolvedValue(createRuntimeBootstrap()),
      missionStore: {
        info: vi.fn().mockResolvedValue({
          schema_version: 3,
          database_path: '/tmp/mission-store.sqlite',
          backup_path: '/tmp/mission-store.backup.sqlite',
        }),
        listMissions: vi.fn().mockResolvedValue([createMission()]),
      },
      layerCatalogStore: { clearMetadata: vi.fn() },
      readMissionRuntime: () => ({
        phase: 'active',
        currentMission: createMission(),
        recoverableMission: null,
      }),
      readMissionGovernanceRuntime: () => ({ governanceMission: null }),
      readTrackingRuntime: () => ({
        status: {
          mode: 'online',
          consecutiveFailures: 0,
          recovered: false,
          lastSuccessAt: '2026-04-11T01:00:00.000Z',
          warning: null,
        },
        snapshot: { devices: [], positions: [], breadcrumbs: [] },
      }),
      readLayerCatalogRuntime: () => ({
        missionId: 'mission-1',
        metadataEntryCount: 4,
        loading: false,
        error: null,
      }),
      readDiagnosticEvents: () => [
        {
          ts: '2026-04-11T01:17:00.000Z',
          level: 'info',
          category: 'map',
          event: 'marker_saved',
          fields: { markerType: 'clue' },
        },
        {
          ts: '2026-04-11T02:30:00.000Z',
          level: 'info',
          category: 'map',
          event: 'outside_window',
        },
      ],
      exportReport: vi.fn().mockResolvedValue('/tmp/diagnostics/report.txt'),
      exportSupportBundle,
      refreshLayerCatalogIfActive: vi.fn().mockResolvedValue(undefined),
      applyRuntime,
      now: () => new Date('2026-04-11T01:00:00.000Z'),
    })

    await runtime.load()
    const exportPath = await runtime.exportSupportBundle()

    expect(exportPath).toBe('/tmp/diagnostics/support-bundle.txt')
    const [fileName] = exportSupportBundle.mock.calls[0]!
    expect(fileName).toContain('support-bundle')
    expect(fileName).toMatch(/\.txt$/)
    expect(applyRuntime).toHaveBeenLastCalledWith(
      expect.objectContaining({
        exporting: false,
        exportPath: '/tmp/diagnostics/support-bundle.txt',
        feedback: expect.stringContaining('support bundle'),
      }),
    )
  })

  it('exports a time-framed support bundle with an incident window for Electron logs', async () => {
    const exportSupportBundle = vi.fn().mockResolvedValue('/tmp/diagnostics/support-bundle-incident.txt')
    const applyRuntime = vi.fn()
    const runtime = await startDiagnosticsRuntime({
      appVersion: '0.1.0',
      getRuntimeKind: () => 'electron',
      getUserAgent: () => 'SARTrackerTest/1.0',
      getDependencySmoke: () => ({
        hasMapLibre: true,
        hasProj4: true,
        hasTurf: true,
        hasZustand: true,
        hasTerraDraw: true,
      }),
      loadSettings: vi.fn().mockResolvedValue(createSettings()),
      loadRuntimeBootstrapSettings: vi.fn().mockResolvedValue(createRuntimeBootstrap()),
      missionStore: {
        info: vi.fn().mockResolvedValue({
          schema_version: 3,
          database_path: '/tmp/mission-store.sqlite',
          backup_path: '/tmp/mission-store.backup.sqlite',
        }),
        listMissions: vi.fn().mockResolvedValue([createMission()]),
      },
      layerCatalogStore: { clearMetadata: vi.fn() },
      readMissionRuntime: () => ({
        phase: 'active',
        currentMission: createMission(),
        recoverableMission: null,
      }),
      readMissionGovernanceRuntime: () => ({ governanceMission: null }),
      readTrackingRuntime: () => ({
        status: {
          mode: 'online',
          consecutiveFailures: 0,
          recovered: false,
          lastSuccessAt: '2026-04-11T01:00:00.000Z',
          warning: null,
        },
        snapshot: { devices: [], positions: [], breadcrumbs: [] },
      }),
      readLayerCatalogRuntime: () => ({
        missionId: 'mission-1',
        metadataEntryCount: 4,
        loading: false,
        error: null,
      }),
      exportReport: vi.fn().mockResolvedValue('/tmp/diagnostics/report.txt'),
      exportSupportBundle,
      refreshLayerCatalogIfActive: vi.fn().mockResolvedValue(undefined),
      applyRuntime,
      now: () => new Date('2026-04-11T01:45:00.000Z'),
      readDiagnosticEvents: () => [
        {
          ts: '2026-04-11T01:17:00.000Z',
          level: 'info',
          category: 'map',
          event: 'marker_saved',
          fields: { markerType: 'clue' },
        },
        {
          ts: '2026-04-11T02:30:00.000Z',
          level: 'info',
          category: 'map',
          event: 'outside_window',
        },
      ],
    })

    await runtime.load()
    const exportPath = await runtime.exportTimeFramedSupportBundle('2026-04-11T01:18:00.000Z')

    expect(exportPath).toBe('/tmp/diagnostics/support-bundle-incident.txt')
    const [fileName, contents, options] = exportSupportBundle.mock.calls[0]!
    expect(fileName).toBe('support-bundle-incident-2026-04-11T01-18-00-000Z.txt')
    expect(contents).toContain('[incident-window]')
    expect(contents).toContain('incident time: 2026-04-11T01:18:00.000Z')
    expect(contents).toContain('[diagnostic-breadcrumbs]')
    expect(contents).toContain('marker_saved')
    expect(contents).not.toContain('outside_window')
    expect(options).toEqual({
      timeFrame: {
        incidentAt: '2026-04-11T01:18:00.000Z',
        beforeMinutes: 30,
        afterMinutes: 30,
      },
    })
    expect(applyRuntime).toHaveBeenLastCalledWith(
      expect.objectContaining({
        exporting: false,
        exportPath: '/tmp/diagnostics/support-bundle-incident.txt',
        feedback: expect.stringContaining('time-framed support bundle'),
      }),
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
      coordinatorRoster: ['C1'],
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

function createMission(): Mission {
  return {
    id: 'mission-1',
    name: 'Night Ops',
    status: 'active',
    start_time: '2026-04-11T00:00:00.000Z',
    pause_time: null,
    finish_time: null,
    paused_seconds: 0,
    notes: null,
    schema_version: 3,
  }
}
