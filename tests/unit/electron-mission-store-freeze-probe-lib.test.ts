import { describe, expect, it } from 'vitest'

import {
  buildMissionStoreProbeVerdict,
  createBackupTimelineState,
  createMissionStoreProbeSettings,
  isTemporaryBackupDatabaseName,
  parseMissionStoreProbeArgs,
  updateBackupTimeline,
} from '../../build/electron-mission-store-freeze-probe-lib.js'
import { summarizeResponsiveness } from '../../build/electron-map-freeze-probe-lib.js'

describe('parseMissionStoreProbeArgs [DON-243]', () => {
  it('parses the packaged app, fixture, evidence, cycle, and expectation contract', () => {
    expect(
      parseMissionStoreProbeArgs([
        '--app',
        '/opt/sartracker.AppImage',
        '--fixture',
        '/fixtures/field.sqlite',
        '--evidence',
        '/evidence/run-1',
        '--cycles',
        '3',
        '--timeout-ms',
        '180000',
        '--expect',
        'frozen',
        '--',
        '--no-sandbox',
        '--ozone-platform=x11',
      ]),
    ).toEqual({
      appPath: '/opt/sartracker.AppImage',
      fixturePath: '/fixtures/field.sqlite',
      evidenceDir: '/evidence/run-1',
      expectedCycles: 3,
      timeoutMs: 180_000,
      probeIntervalMs: 50,
      freezeThresholdMs: 1_000,
      expectation: 'frozen',
      extraArgs: ['--no-sandbox', '--ozone-platform=x11'],
    })
  })

  it('fails closed for missing inputs and invalid numeric/expectation values', () => {
    expect(() => parseMissionStoreProbeArgs(['--fixture', '/f'])).toThrow('--app')
    expect(() => parseMissionStoreProbeArgs(['--app', '/a'])).toThrow('--fixture')
    expect(() =>
      parseMissionStoreProbeArgs(['--app', '/a', '--fixture', '/f', '--cycles', '0']),
    ).toThrow('--cycles')
    expect(() =>
      parseMissionStoreProbeArgs(['--app', '/a', '--fixture', '/f', '--expect', 'maybe']),
    ).toThrow('--expect')
  })
})

describe('mission-store packaged probe settings [DON-243 DON-244]', () => {
  it('uses the shortest supported autosave cadence with tracking and maps disabled', () => {
    const settings = createMissionStoreProbeSettings()
    expect(settings.missionDefaults).toMatchObject({
      autoSaveEnabled: true,
      autoSaveIntervalSeconds: 5,
      autoRefreshEnabled: false,
    })
    expect(settings.dataSource).toMatchObject({ providerType: 'none', autoConnect: false })
    expect(settings.officialMaps.packages).toEqual([])
  })
})

describe('backup phase timeline [DON-243]', () => {
  it('tracks temporary database files but excludes persistent SQLite sidecars', () => {
    expect(isTemporaryBackupDatabaseName('mission-store.backup.sqlite.tmp-a706d853-e04e-4afd-bc45-770b72905d22')).toBe(true)
    expect(isTemporaryBackupDatabaseName('mission-store.backup.sqlite.tmp-a706d853-e04e-4afd-bc45-770b72905d22-wal')).toBe(false)
    expect(isTemporaryBackupDatabaseName('mission-store.backup.sqlite.tmp-a706d853-e04e-4afd-bc45-770b72905d22-shm')).toBe(false)
  })

  it('separates snapshot copy time from the stable-size validation interval', () => {
    let state = createBackupTimelineState({ databaseBytes: 1_000_000 })
    state = updateBackupTimeline(state, snapshot(1_000, [{ name: 'tmp-a', size: 10_000 }]))
    state = updateBackupTimeline(state, snapshot(2_000, [{ name: 'tmp-a', size: 500_000 }]))
    state = updateBackupTimeline(state, snapshot(3_000, [{ name: 'tmp-a', size: 1_000_000 }]))
    state = updateBackupTimeline(state, snapshot(8_000, [], 1_000_000, 8_000))

    expect(state.cycles).toEqual([
      expect.objectContaining({
        temporaryName: 'tmp-a',
        startedAtMs: 1_000,
        copyCompletedAtMs: 3_000,
        completedAtMs: 8_000,
        copyDurationMs: 2_000,
        validationDurationMs: 5_000,
        totalDurationMs: 7_000,
        maximumTemporaryBytes: 1_000_000,
      }),
    ])
    expect(state.activeCycle).toBeNull()
  })

  it('falls back to the last observed growth time when the snapshot is smaller than the live file', () => {
    let state = createBackupTimelineState({ databaseBytes: 1_000_000 })
    state = updateBackupTimeline(state, snapshot(10, [{ name: 'tmp-b', size: 100 }]))
    state = updateBackupTimeline(state, snapshot(20, [{ name: 'tmp-b', size: 800_000 }]))
    state = updateBackupTimeline(state, snapshot(50, [], 800_000, 50))

    expect(state.cycles[0]).toMatchObject({
      copyCompletedAtMs: 20,
      copyDurationMs: 10,
      validationDurationMs: 30,
    })
  })

  it('ignores unrelated final-file observations when no temporary backup cycle was seen', () => {
    const state = updateBackupTimeline(
      createBackupTimelineState({ databaseBytes: 1_000_000 }),
      snapshot(100, [], 1_000_000, 100),
    )
    expect(state.cycles).toEqual([])
  })
})

describe('buildMissionStoreProbeVerdict [DON-243]', () => {
  it('requires complete backup evidence and attributes a release-blocking main-process stall', () => {
    const verdict = buildMissionStoreProbeVerdict({
      cycles: [{ totalDurationMs: 12_000 }, { totalDurationMs: 11_000 }, { totalDurationMs: 13_000 }],
      expectedCycles: 3,
      mainStats: summarizeResponsiveness([50, 12_200]),
      rendererStats: summarizeResponsiveness([16, 200]),
      mainHeartbeatErrors: 0,
      freezeThresholdMs: 1_000,
      expectation: 'frozen',
    })

    expect(verdict).toMatchObject({
      probeValid: true,
      frozen: true,
      offender: 'main',
      expectationMet: true,
    })
  })

  it('does not let a throttled renderer disguise a healthy main process', () => {
    const verdict = buildMissionStoreProbeVerdict({
      cycles: [{ totalDurationMs: 200 }, { totalDurationMs: 210 }, { totalDurationMs: 190 }],
      expectedCycles: 3,
      mainStats: summarizeResponsiveness([40, 80]),
      rendererStats: summarizeResponsiveness([1_010, 1_020]),
      mainHeartbeatErrors: 0,
      freezeThresholdMs: 1_000,
      expectation: 'healthy',
    })

    expect(verdict).toMatchObject({
      probeValid: true,
      frozen: false,
      offender: 'none',
      rendererThrottled: true,
      expectationMet: true,
    })
  })

  it('fails closed when backup cycles or heartbeat samples are missing', () => {
    const verdict = buildMissionStoreProbeVerdict({
      cycles: [{ totalDurationMs: 10_000 }],
      expectedCycles: 3,
      mainStats: summarizeResponsiveness([]),
      rendererStats: summarizeResponsiveness([]),
      mainHeartbeatErrors: 4,
      freezeThresholdMs: 1_000,
      expectation: 'frozen',
    })

    expect(verdict.probeValid).toBe(false)
    expect(verdict.expectationMet).toBe(false)
    expect(verdict.invalidReasons).toEqual(
      expect.arrayContaining([expect.stringContaining('backup cycles'), expect.stringContaining('heartbeat')]),
    )
  })
})

function snapshot(
  atMs: number,
  temporaryFiles: readonly { readonly name: string; readonly size: number }[],
  backupBytes = 0,
  backupMtimeMs = 0,
) {
  return {
    atMs,
    temporaryFiles,
    backup: {
      exists: backupBytes > 0,
      size: backupBytes,
      mtimeMs: backupMtimeMs,
    },
  }
}
