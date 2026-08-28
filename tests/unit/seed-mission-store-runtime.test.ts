import { createHash } from 'node:crypto'
import { readFile, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

import { afterEach, describe, expect, it } from 'vitest'

import {
  assertBreadcrumbProgrammePositionScopeInvariants,
  assertBreadcrumbProgrammeSelectionInvariants,
  createBreadcrumbProgrammeCalibrationSample,
  generateMissionStoreFixture,
  restartCheckpointDayForPoll,
} from '../../build/seed-mission-store-runtime.js'
import { createFixturePlan } from '../../build/seed-mission-store-lib.js'
import {
  DEFAULT_STATIONARY_ATTENTION_CONFIG,
  evaluateStationaryAttention,
} from '../../src/features/tracking/stationary-attention'
import { distance, point } from '@turf/turf'

const require = createRequire(import.meta.url)
const { createElectronMissionStore } = require('../../electron/mission-store.cjs') as {
  createElectronMissionStore: (options: {
    readonly userDataPath: string
    readonly readAdminRoster: () => Promise<readonly string[]>
  }) => {
    readonly close: () => void
    readonly getActiveMission: () => Promise<{ readonly id: string; readonly name: string } | null>
    readonly listDevices: (missionId: string) => Promise<readonly unknown[]>
    readonly countPositions: (missionId: string) => Promise<number>
  }
}
const Database = require('better-sqlite3')

const tempPaths: string[] = []

afterEach(async () => {
  const { rm } = await import('node:fs/promises')
  await Promise.all(tempPaths.splice(0).map((tempPath) => rm(tempPath, { recursive: true, force: true })))
})

describe('generateMissionStoreFixture [DON-242]', () => {
  it('atomically generates a reusable synthetic store that opens through the real adapter', async () => {
    const tempRoot = await makeTempRoot()
    const outputPath = path.join(tempRoot, 'cache', 'mission-store.sqlite')
    const copyToPath = path.join(tempRoot, 'run', 'user-data', 'mission-store.sqlite')

    const generated = await generateMissionStoreFixture({
      preset: 'small',
      outputPath,
      copyToPath,
      force: false,
      progress: () => undefined,
    })

    expect(generated.reused).toBe(false)
    expect(generated.manifest.syntheticDataOnly).toBe(true)
    expect(generated.manifest.preset).toBe('small')
    expect(generated.manifest.database.bytes).toBeGreaterThanOrEqual(8 * 1024 * 1024)
    expect(generated.manifest.rows.byTable.devices).toBe(32)
    expect(generated.manifest.rows.byTable.positions).toBeGreaterThan(0)
    expect(generated.manifest.rows.byEventType.device_updated).toBeGreaterThan(0)
    expect(generated.manifest.bytes.byTable.positions).toBeGreaterThan(0)
    expect(generated.manifest.bytes.byTable.mission_events).toBeGreaterThan(0)
    expect(generated.manifest.database.sha256).toBe(
      '3d5075babff4ff6b04da66048c0bb753ad6a08572dc3753a02fae5115fa5a10a',
    )
    await expect(sha256File(outputPath)).resolves.toBe(generated.manifest.database.sha256)
    await expect(sha256File(copyToPath)).resolves.toBe(generated.manifest.database.sha256)

    const copiedUserDataPath = path.dirname(copyToPath)
    const store = createElectronMissionStore({
      userDataPath: copiedUserDataPath,
      readAdminRoster: async () => [],
    })
    try {
      const activeMission = await store.getActiveMission()
      expect(activeMission?.name).toBe('SYNTHETIC FIELD-SCALE VALIDATION MISSION')
      expect(await store.listDevices(activeMission!.id)).toHaveLength(32)
      expect(await store.countPositions(activeMission!.id)).toBe(
        generated.manifest.rows.byTable.positions,
      )
    } finally {
      store.close()
    }

    const originalStat = await stat(outputPath)
    const reused = await generateMissionStoreFixture({
      preset: 'small',
      outputPath,
      force: false,
      progress: () => undefined,
    })
    expect(reused.reused).toBe(true)
    expect((await stat(outputPath)).mtimeMs).toBe(originalStat.mtimeMs)
  }, 30_000)

  it('preserves an existing known-good fixture when forced regeneration is interrupted', async () => {
    const tempRoot = await makeTempRoot()
    const outputPath = path.join(tempRoot, 'cache', 'mission-store.sqlite')
    const first = await generateMissionStoreFixture({
      preset: 'small',
      outputPath,
      force: false,
      progress: () => undefined,
    })

    await expect(
      generateMissionStoreFixture({
        preset: 'small',
        outputPath,
        force: true,
        progress: () => undefined,
        faultInjection: { afterPollBatches: 1 },
      }),
    ).rejects.toThrow(/Injected fixture generation interruption/u)

    await expect(sha256File(outputPath)).resolves.toBe(first.manifest.database.sha256)
    const manifest = JSON.parse(
      await readFile(`${outputPath}.manifest.json`, 'utf8'),
    ) as typeof first.manifest
    expect(manifest.database.sha256).toBe(first.manifest.database.sha256)

    await expect(
      generateMissionStoreFixture({
        preset: 'small',
        outputPath,
        force: true,
        progress: () => undefined,
        faultInjection: { afterDatabaseSwap: true },
      }),
    ).rejects.toThrow(/Injected fixture replacement interruption/u)

    const recovered = await generateMissionStoreFixture({
      preset: 'small',
      outputPath,
      force: false,
      progress: () => undefined,
    })
    expect(recovered.reused).toBe(true)
    expect(recovered.manifest.database.sha256).toBe(first.manifest.database.sha256)
    await expect(sha256File(outputPath)).resolves.toBe(first.manifest.database.sha256)
  }, 30_000)

  it('reuses a checksum-valid legacy v2 preset cache without regeneration', async () => {
    const tempRoot = await makeTempRoot()
    const outputPath = path.join(tempRoot, 'cache', 'mission-store.sqlite')
    const generated = await generateMissionStoreFixture({
      preset: 'small',
      outputPath,
      force: false,
      progress: () => undefined,
    })
    const manifestPath = `${outputPath}.manifest.json`
    await writeFile(manifestPath, `${JSON.stringify({
      ...generated.manifest,
      generatorVersion: 2,
    }, null, 2)}\n`, 'utf8')
    const originalStat = await stat(outputPath)

    const reused = await generateMissionStoreFixture({
      preset: 'small',
      outputPath,
      force: false,
      progress: () => undefined,
    })

    expect(reused.reused).toBe(true)
    expect(reused.manifest.generatorVersion).toBe(2)
    expect((await stat(outputPath)).mtimeMs).toBe(originalStat.mtimeMs)
  }, 30_000)
})

describe('restartCheckpointDayForPoll [DON-242]', () => {
  it('marks exact accumulated day boundaries without resetting the mission', () => {
    const plan = createFixturePlan('mission-5d')

    expect(restartCheckpointDayForPoll(plan, 17_279)).toBeNull()
    expect(restartCheckpointDayForPoll(plan, 17_280)).toBe(1)
    expect(restartCheckpointDayForPoll(plan, 34_560)).toBe(2)
    expect(restartCheckpointDayForPoll(plan, 69_120)).toBe(4)
    expect(restartCheckpointDayForPoll(plan, 86_400)).toBeNull()
  })

  it('keeps the field-scale checkpoint schedule through day fourteen', () => {
    const plan = createFixturePlan('field')

    expect(restartCheckpointDayForPoll(plan, 172_800)).toBe(10)
    expect(restartCheckpointDayForPoll(plan, 241_920)).toBe(14)
  })
})

describe('breadcrumb programme fixture calibration [DON-272]', () => {
  it('rejects a direct participant already covered by an active selected group', () => {
    const db = new Database(':memory:')
    try {
      db.exec(`
        CREATE TABLE devices (
          mission_id TEXT NOT NULL, device_id TEXT NOT NULL
        );
        CREATE TABLE mission_participants (
          id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, kind TEXT NOT NULL,
          traccar_device_id TEXT, mission_team_id TEXT, removed_at TEXT
        );
        CREATE TABLE mission_group_membership_events (
          id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, mission_team_id TEXT NOT NULL,
          traccar_device_id TEXT NOT NULL, change TEXT NOT NULL,
          observed_at TEXT NOT NULL, sequence INTEGER NOT NULL
        );
        INSERT INTO devices VALUES ('mission-1', 'device-1');
        INSERT INTO mission_participants VALUES
          ('group-participant', 'mission-1', 'group', NULL, 'team-1', NULL),
          ('direct-participant', 'mission-1', 'device', 'device-1', NULL, NULL);
        INSERT INTO mission_group_membership_events VALUES
          ('membership-1', 'mission-1', 'team-1', 'device-1', 'member',
           '2026-08-20T08:00:00.000Z', 1);
      `)

      expect(() =>
        assertBreadcrumbProgrammeSelectionInvariants(db, 'mission-1')).toThrow(
        /direct participant.*selected group/iu,
      )
      db.prepare("DELETE FROM mission_participants WHERE kind = 'device'").run()
      expect(() =>
        assertBreadcrumbProgrammeSelectionInvariants(db, 'mission-1')).not.toThrow()
    } finally {
      db.close()
    }
  })

  it('rejects accepted fixture positions outside participation-at-fix-time', () => {
    const db = new Database(':memory:')
    try {
      db.exec(`
        CREATE TABLE mission_participants (
          mission_id TEXT NOT NULL, kind TEXT NOT NULL, traccar_device_id TEXT,
          mission_team_id TEXT, effective_from TEXT NOT NULL, removed_at TEXT
        );
        CREATE TABLE mission_group_membership_events (
          mission_id TEXT NOT NULL, mission_team_id TEXT NOT NULL,
          traccar_device_id TEXT NOT NULL, change TEXT NOT NULL,
          observed_at TEXT NOT NULL, sequence INTEGER NOT NULL
        );
        CREATE TABLE positions (
          mission_id TEXT NOT NULL, device_id TEXT NOT NULL, timestamp TEXT NOT NULL
        );
        INSERT INTO mission_participants VALUES
          ('mission-1', 'device', 'device-1', NULL, '2026-08-20T09:00:00.000Z', NULL);
        INSERT INTO positions VALUES
          ('mission-1', 'device-1', '2026-08-20T09:30:00.000Z'),
          ('mission-1', 'device-1', '2026-08-20T08:59:00.000Z');
      `)

      expect(() => assertBreadcrumbProgrammePositionScopeInvariants(
        db,
        'mission-1',
        1,
      )).toThrow(/position.*outside.*participation|participation.*fix/i)

      db.prepare("DELETE FROM positions WHERE timestamp < '2026-08-20T09:00:00.000Z'").run()
      expect(() => assertBreadcrumbProgrammePositionScopeInvariants(
        db,
        'mission-1',
        1,
      )).not.toThrow()
    } finally {
      db.close()
    }
  })

  it('emits the shipped stationary attention cases and near misses', () => {
    const attention = createBreadcrumbProgrammeCalibrationSample('bcp-960k', 0, 1_000, 1_014)
    const slowWalker = createBreadcrumbProgrammeCalibrationSample('bcp-960k', 1, 1_000, 1_014)
    const jitterNearMiss = createBreadcrumbProgrammeCalibrationSample('bcp-960k', 2, 1_000, 1_014)
    const outlierInsideRun = createBreadcrumbProgrammeCalibrationSample('bcp-960k', 3, 1_000, 1_014)

    expect(evaluateStationaryAttention(attention, DEFAULT_STATIONARY_ATTENTION_CONFIG).state).toBe('attention')
    expect(evaluateStationaryAttention(slowWalker, DEFAULT_STATIONARY_ATTENTION_CONFIG).state).toBe('none')
    expect(evaluateStationaryAttention(jitterNearMiss, DEFAULT_STATIONARY_ATTENTION_CONFIG).state).toBe('none')
    expect(evaluateStationaryAttention(outlierInsideRun, DEFAULT_STATIONARY_ATTENTION_CONFIG).state).toBe('attention')
  })

  it('keeps movement and accuracy distributions calibrated to observed field evidence', () => {
    const sample = createBreadcrumbProgrammeCalibrationSample('bcp-960k', 10, 0, 1_000)
    const displacements = sample.slice(1).map((fix, index) => distance(
      point([sample[index]!.lon, sample[index]!.lat]),
      point([fix.lon, fix.lat]),
      { units: 'meters' },
    )).sort((left, right) => left - right)
    const accuracies = Array.from({ length: 100 }, (_, deviceIndex) =>
      createBreadcrumbProgrammeCalibrationSample('bcp-960k', deviceIndex, 500, 501)[0]!.accuracy ?? 0,
    ).sort((left, right) => left - right)

    expect(displacements[Math.floor(displacements.length / 2)]).toBeGreaterThanOrEqual(32)
    expect(displacements[Math.floor(displacements.length / 2)]).toBeLessThanOrEqual(36)
    expect(accuracies[Math.floor(accuracies.length / 2)]).toBe(3.8)
    expect(accuracies[Math.floor(accuracies.length * 0.9)]).toBe(10)
  })
})

async function makeTempRoot(): Promise<string> {
  const { mkdtemp } = await import('node:fs/promises')
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'sartracker-seed-store-'))
  tempPaths.push(tempRoot)
  return tempRoot
}

async function sha256File(filePath: string): Promise<string> {
  return createHash('sha256').update(await readFile(filePath)).digest('hex')
}
