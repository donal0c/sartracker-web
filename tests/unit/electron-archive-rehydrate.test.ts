import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

import { afterEach, describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')
const { createElectronMissionStore, CURRENT_SCHEMA_VERSION } = require(
  '../../electron/mission-store.cjs',
) as {
  readonly createElectronMissionStore: (input: Readonly<Record<string, unknown>>) => {
    readonly createMission: (input: Readonly<Record<string, unknown>>) => Promise<{ readonly id: string }>
    readonly upsertDevice: (input: Readonly<Record<string, unknown>>) => Promise<Readonly<Record<string, unknown>>>
    readonly upsertMarker: (input: Readonly<Record<string, unknown>>) => Promise<Readonly<Record<string, unknown>>>
    readonly runMarkerAttachmentIngest: (missionId: string, write: () => Promise<string>) => Promise<string>
    readonly addPosition: (input: Readonly<Record<string, unknown>>) => Promise<Readonly<Record<string, unknown>>>
    readonly finishMission: (missionId: string) => Promise<Readonly<Record<string, unknown>>>
    readonly finalizeMission: (missionId: string, custody: Readonly<Record<string, string>>) => Promise<Readonly<Record<string, unknown>>>
    readonly syncBackup: (trigger?: string) => Promise<unknown>
    readonly startMissionCleanup: (input: Readonly<Record<string, unknown>>, context: Readonly<Record<string, unknown>>) => Promise<Readonly<Record<string, unknown>>>
    readonly getMission: (missionId: string) => Promise<Readonly<Record<string, unknown>>>
    readonly unlockFinalizedMission: (input: Readonly<Record<string, unknown>>) => Promise<Readonly<Record<string, unknown>>>
    readonly listDevices: (missionId: string) => Promise<readonly Readonly<Record<string, unknown>>[]>
    readonly prepareClose: () => Promise<void>
    readonly close: () => void
  }
}
const { rehydrateMissionFromSnapshot } = require('../../electron/archive-rehydrate.cjs') as {
  readonly rehydrateMissionFromSnapshot: (input: Readonly<Record<string, unknown>>) => Readonly<Record<string, string>>
}
const { correctionJournalDirectory } = require('../../electron/archive-correction-custody.cjs') as {
  readonly correctionJournalDirectory: (databasePath: string) => string
}

const temporaryDirectories = new Set<string>()

/** Returns the authenticated proof carried with one correction snapshot path. */
function snapshotProof(snapshotPath: string) {
  const identity = statSync(snapshotPath)
  return {
    snapshot_database_sha256: createHash('sha256').update(readFileSync(snapshotPath)).digest('hex'),
    snapshot_database_identity: {
      dev: identity.dev,
      ino: identity.ino,
      sizeBytes: identity.size,
    },
  }
}

afterEach(() => {
  for (const directory of temporaryDirectories) rmSync(directory, { recursive: true, force: true })
  temporaryDirectories.clear()
})

describe('archived mission correction rehydration', () => {
  it('restores the emptied mission namespace from the authenticated snapshot without replacing retained history', async () => {
    const userDataPath = mkdtempSync(path.join(tmpdir(), 'sartracker-rehydrate-'))
    temporaryDirectories.add(userDataPath)
    const archiveCorrectionFaultInjection = { afterRehydrateBeforeUnlock: true }
    const store = createElectronMissionStore({
      userDataPath,
      readAdminRoster: async () => ['Duty Admin'],
      archiveCorrectionFaultInjection,
    })
    const custody = {
      passphrase: 'Correct Restore 2026!',
      recoveryCode: 'AB234-CD567-EF789-GH234-JK567-MN789-PR234-ST567',
    }
    try {
      const mission = await store.createMission({ name: 'Archived correction restore' })
      await store.upsertDevice({
        mission_id: mission.id,
        device_id: 'rehydrate-device',
        name: 'Rehydrate Device',
        color: '#0088ff',
        status: 'offline',
      })
      await store.addPosition({
        mission_id: mission.id,
        device_id: 'rehydrate-device',
        lat: 52.1,
        lon: -9.1,
        timestamp: '2026-09-02T10:00:00.000Z',
        timestamp_source: 'fix',
      })
      await store.finishMission(mission.id)
      const finalized = await store.finalizeMission(mission.id, custody)
      const archiveId = String((finalized as { readonly archive: { readonly id: string } }).archive.id)
      const snapshotPath = path.join(userDataPath, 'correction-snapshot.sqlite')
      await store.syncBackup('correction-fixture')
      copyFileSync(path.join(userDataPath, 'mission-store.backup.sqlite'), snapshotPath)
      await store.startMissionCleanup({
        missionId: mission.id,
        archiveId,
        slotType: 'passphrase',
        secret: custody.passphrase,
      }, {
        operationId: '16161616-1616-4616-8616-161616161616',
        reviewActivity: false,
        onProgress: () => undefined,
      })
      expect(await store.getMission(mission.id)).toMatchObject({ storage_state: 'archived' })
      const authenticatedProof = snapshotProof(snapshotPath)
      const substituted = readFileSync(snapshotPath)
      substituted[substituted.length - 1] ^= 0x01
      writeFileSync(snapshotPath, substituted)
      await expect(store.unlockFinalizedMission({
        mission_id: mission.id,
        archive_id: archiveId,
        snapshot_path: snapshotPath,
        snapshot_database_sha256: authenticatedProof.snapshot_database_sha256,
        snapshot_database_identity: authenticatedProof.snapshot_database_identity,
        admin_name: 'Duty Admin',
        reason: 'Reject a substituted correction snapshot.',
      })).rejects.toMatchObject({ code: 'ARCHIVE_REHYDRATE_SNAPSHOT_INVALID' })
      copyFileSync(path.join(userDataPath, 'mission-store.backup.sqlite'), snapshotPath)
      await expect(store.unlockFinalizedMission({
        mission_id: mission.id,
        archive_id: archiveId,
        snapshot_path: snapshotPath,
        ...snapshotProof(snapshotPath),
        admin_name: 'Duty Admin',
        reason: 'Restore this archived mission for a recorded correction.',
      })).rejects.toThrow(/failed safely/iu)
      const failedDb = new Database(path.join(userDataPath, 'mission-store.sqlite'))
      try {
        expect(failedDb.prepare('SELECT COUNT(*) AS count FROM positions WHERE mission_id = ?').get(mission.id))
          .toEqual({ count: 0 })
        expect(failedDb.prepare('SELECT status FROM missions WHERE id = ?').get(mission.id))
          .toEqual({ status: 'finalized' })
      } finally {
        failedDb.close()
      }
      archiveCorrectionFaultInjection.afterRehydrateBeforeUnlock = false
      await expect(store.unlockFinalizedMission({
        mission_id: mission.id,
        archive_id: archiveId,
        snapshot_path: snapshotPath,
        ...snapshotProof(snapshotPath),
        admin_name: 'Duty Admin',
        reason: 'Restore this archived mission for a recorded correction.',
      })).resolves.toMatchObject({ status: 'finished', storage_state: 'live' })
      const liveDb = new Database(path.join(userDataPath, 'mission-store.sqlite'))
      try {
        expect(liveDb.prepare('SELECT COUNT(*) AS count FROM devices WHERE mission_id = ?').get(mission.id))
          .toEqual({ count: 1 })
        expect(liveDb.prepare('SELECT COUNT(*) AS count FROM positions WHERE mission_id = ?').get(mission.id))
          .toEqual({ count: 1 })
        expect(liveDb.prepare(`SELECT COUNT(*) AS count FROM mission_events
          WHERE mission_id = ? AND event_type = 'mission_cleanup_completed'`).get(mission.id))
          .toEqual({ count: 1 })
      } finally {
        liveDb.close()
      }
      expect(readFileSync(snapshotPath).length).toBeGreaterThan(0)
    } finally {
      await store.prepareClose()
      store.close()
    }
  }, 60_000)

  it('accepts an archive-review correction snapshot without registry tables', async () => {
    const userDataPath = mkdtempSync(path.join(tmpdir(), 'sartracker-rehydrate-review-snapshot-'))
    temporaryDirectories.add(userDataPath)
    const store = createElectronMissionStore({
      userDataPath,
      readAdminRoster: async () => ['Duty Admin'],
    })
    const custody = {
      passphrase: 'Review Snapshot 2026!',
      recoveryCode: 'AB234-CD567-EF789-GH234-JK567-MN789-PR234-ST567',
    }
    try {
      const mission = await store.createMission({ name: 'Archive review correction snapshot' })
      await store.finishMission(mission.id)
      const finalized = await store.finalizeMission(mission.id, custody)
      const archiveId = String((finalized as { readonly archive: { readonly id: string } }).archive.id)
      await store.syncBackup('correction-fixture')
      const snapshotPath = path.join(userDataPath, 'review-snapshot.sqlite')
      copyFileSync(path.join(userDataPath, 'mission-store.backup.sqlite'), snapshotPath)
      const snapshotDb = new Database(snapshotPath)
      try {
        snapshotDb.pragma('foreign_keys = OFF')
        snapshotDb.exec(`
          DELETE FROM mission_cleanup_journal;
          DELETE FROM mission_archive_supplements;
          DELETE FROM mission_archives;
        `)
      } finally {
        snapshotDb.close()
      }
      await store.startMissionCleanup({
        missionId: mission.id,
        archiveId,
        slotType: 'passphrase',
        secret: custody.passphrase,
      }, {
        operationId: '19191919-1919-4191-8191-191919191919',
        reviewActivity: false,
        onProgress: () => undefined,
      })
      await expect(store.unlockFinalizedMission({
        mission_id: mission.id,
        archive_id: archiveId,
        snapshot_path: snapshotPath,
        ...snapshotProof(snapshotPath),
        admin_name: 'Duty Admin',
        reason: 'Restore the archive-review snapshot for correction.',
      })).resolves.toMatchObject({ status: 'finished', storage_state: 'live' })
    } finally {
      await store.prepareClose()
      store.close()
    }
  }, 60_000)

  it('rolls back restored rows when the atomic correction completion callback fails', async () => {
    const userDataPath = mkdtempSync(path.join(tmpdir(), 'sartracker-rehydrate-rollback-'))
    temporaryDirectories.add(userDataPath)
    const store = createElectronMissionStore({ userDataPath })
    const custody = {
      passphrase: 'Atomic Restore 2026!',
      recoveryCode: 'AB234-CD567-EF789-GH234-JK567-MN789-PR234-ST567',
    }
    try {
      const mission = await store.createMission({ name: 'Atomic correction restore' })
      await store.upsertDevice({
        mission_id: mission.id,
        device_id: 'rollback-device',
        name: 'Rollback Device',
        color: '#0088ff',
        status: 'offline',
      })
      await store.addPosition({
        mission_id: mission.id,
        device_id: 'rollback-device',
        lat: 52.1,
        lon: -9.1,
        timestamp: '2026-09-02T10:00:00.000Z',
        timestamp_source: 'fix',
      })
      await store.finishMission(mission.id)
      const finalized = await store.finalizeMission(mission.id, custody)
      const archiveId = String((finalized as { readonly archive: { readonly id: string } }).archive.id)
      const snapshotPath = path.join(userDataPath, 'rollback-snapshot.sqlite')
      await store.syncBackup('correction-fixture')
      copyFileSync(path.join(userDataPath, 'mission-store.backup.sqlite'), snapshotPath)
      await store.startMissionCleanup({
        missionId: mission.id,
        archiveId,
        slotType: 'passphrase',
        secret: custody.passphrase,
      }, {
        operationId: '17171717-1717-4171-8171-171717171717',
        reviewActivity: false,
        onProgress: () => undefined,
      })
      const liveDb = new Database(path.join(userDataPath, 'mission-store.sqlite'))
      const substitutePath = path.join(userDataPath, 'substitute-snapshot.sqlite')
      copyFileSync(snapshotPath, substitutePath)
      const substituteDb = new Database(substitutePath)
      substituteDb.prepare('UPDATE devices SET name = ? WHERE mission_id = ?')
        .run('SUBSTITUTED', mission.id)
      substituteDb.close()
      const guardedLiveDb = new Proxy(liveDb, {
        get(target, property, receiver) {
          if (property === 'prepare') {
            return (sql: string) => {
              if (sql.startsWith('ATTACH DATABASE')) copyFileSync(substitutePath, snapshotPath)
              return target.prepare(sql)
            }
          }
          if (property === 'transaction') return target.transaction.bind(target)
          return Reflect.get(target, property, receiver)
        },
      })
      try {
        const proof = snapshotProof(snapshotPath)
        expect(() => rehydrateMissionFromSnapshot({
          db: guardedLiveDb,
          snapshotPath,
          expectedSha256: proof.snapshot_database_sha256,
          expectedIdentity: proof.snapshot_database_identity,
          missionId: mission.id,
          archiveId,
          schemaVersion: CURRENT_SCHEMA_VERSION,
          onRestored: () => {
            expect(liveDb.prepare('SELECT name FROM devices WHERE mission_id = ?').get(mission.id))
              .toEqual({ name: 'Rollback Device' })
            throw new Error('injected post-copy failure')
          },
        })).toThrow('injected post-copy failure')
        expect(liveDb.prepare('SELECT COUNT(*) AS count FROM devices WHERE mission_id = ?').get(mission.id))
          .toEqual({ count: 0 })
        expect(liveDb.prepare('SELECT COUNT(*) AS count FROM positions WHERE mission_id = ?').get(mission.id))
          .toEqual({ count: 0 })
        expect(liveDb.prepare('SELECT status FROM missions WHERE id = ?').get(mission.id))
          .toEqual({ status: 'finalized' })
      } finally {
        liveDb.close()
      }
    } finally {
      await store.prepareClose()
      store.close()
    }
  }, 60_000)

  it('rejects a correction snapshot whose declared mission inventory table is missing', async () => {
    const userDataPath = mkdtempSync(path.join(tmpdir(), 'sartracker-rehydrate-inventory-'))
    temporaryDirectories.add(userDataPath)
    const store = createElectronMissionStore({ userDataPath })
    const custody = {
      passphrase: 'Inventory Restore 2026!',
      recoveryCode: 'AB234-CD567-EF789-GH234-JK567-MN789-PR234-ST567',
    }
    try {
      const mission = await store.createMission({ name: 'Inventory correction restore' })
      await store.upsertDevice({
        mission_id: mission.id,
        device_id: 'inventory-device',
        name: 'Inventory Device',
        color: '#0088ff',
        status: 'offline',
      })
      await store.finishMission(mission.id)
      const finalized = await store.finalizeMission(mission.id, custody)
      const archiveId = String((finalized as { readonly archive: { readonly id: string } }).archive.id)
      const snapshotPath = path.join(userDataPath, 'inventory-snapshot.sqlite')
      await store.syncBackup('correction-fixture')
      copyFileSync(path.join(userDataPath, 'mission-store.backup.sqlite'), snapshotPath)
      await store.startMissionCleanup({
        missionId: mission.id,
        archiveId,
        slotType: 'passphrase',
        secret: custody.passphrase,
      }, {
        operationId: '18181818-1818-4181-8181-181818181818',
        reviewActivity: false,
        onProgress: () => undefined,
      })
      const proof = snapshotProof(snapshotPath)
      const snapshotDb = new Database(snapshotPath)
      try {
        snapshotDb.exec('DROP TABLE markers')
      } finally {
        snapshotDb.close()
      }
      const liveDb = new Database(path.join(userDataPath, 'mission-store.sqlite'))
      try {
        expect(() => rehydrateMissionFromSnapshot({
          db: liveDb,
          snapshotPath,
          expectedSha256: proof.snapshot_database_sha256,
          expectedIdentity: proof.snapshot_database_identity,
          missionId: mission.id,
          archiveId,
          schemaVersion: CURRENT_SCHEMA_VERSION,
        })).toThrow(/snapshot|inventory|schema/iu)
        expect(liveDb.prepare('SELECT status FROM missions WHERE id = ?').get(mission.id))
          .toEqual({ status: 'finalized' })
      } finally {
        liveDb.close()
      }
    } finally {
      await store.prepareClose()
      store.close()
    }
  }, 60_000)

  it('turns a generic post-commit correction failure into a durable same-process recovery fence', async () => {
    const userDataPath = mkdtempSync(path.join(tmpdir(), 'sartracker-rehydrate-cleanup-fence-'))
    temporaryDirectories.add(userDataPath)
    const cleanupFailure = Object.assign(new Error('worker exited after correction commit'), {
      code: 'ARCHIVE_REHYDRATE_FAILED',
    })
    const correctionRunner = vi.fn((input: Readonly<Record<string, unknown>>) => {
      const database = new Database(String(input.databasePath))
      mkdirSync(correctionJournalDirectory(String(input.databasePath)), { recursive: true })
      const timestamp = '2026-09-03T10:00:00.000Z'
      database.prepare('UPDATE missions SET status = ? WHERE id = ?')
        .run('finished', input.missionId)
      database.prepare(`INSERT INTO mission_events (
        id, mission_id, event_type, timestamp, details_json, recorded_at, recording_completeness
      ) VALUES (?, ?, 'mission_unlocked', ?, ?, ?, 'complete')`).run(
        'generic-post-commit-event',
        input.missionId,
        timestamp,
        JSON.stringify({ restored_from_archive_id: input.archiveId }),
        timestamp,
      )
      database.close()
      const completion = Promise.reject(cleanupFailure)
      Object.defineProperty(completion, 'workerExited', { value: Promise.resolve() })
      return completion
    })
    const store = createElectronMissionStore({
      userDataPath,
      readAdminRoster: async () => ['Duty Admin'],
      startArchiveCorrectionWorker: correctionRunner,
    })
    const custody = {
      passphrase: 'Cleanup Fence 2026!',
      recoveryCode: 'AB234-CD567-EF789-GH234-JK567-MN789-PR234-ST567',
    }
    try {
      const mission = await store.createMission({ name: 'Cleanup fence correction' })
      await store.finishMission(mission.id)
      const finalized = await store.finalizeMission(mission.id, custody)
      const archiveId = String((finalized as { readonly archive: { readonly id: string } }).archive.id)
      await store.syncBackup('correction-fixture')
      const snapshotPath = path.join(userDataPath, 'correction-snapshot.sqlite')
      copyFileSync(path.join(userDataPath, 'mission-store.backup.sqlite'), snapshotPath)
      await store.startMissionCleanup({
        missionId: mission.id,
        archiveId,
        slotType: 'passphrase',
        secret: custody.passphrase,
      }, {
        operationId: '23232323-2323-4232-8232-232323232323',
        reviewActivity: false,
        onProgress: () => undefined,
      })

      const correctionInput = {
        mission_id: mission.id,
        archive_id: archiveId,
        snapshot_path: snapshotPath,
        ...snapshotProof(snapshotPath),
        admin_name: 'Duty Admin',
        reason: 'Retain a durable recovery blocker after cleanup failure.',
      }
      await expect(store.unlockFinalizedMission(correctionInput)).rejects.toMatchObject({
        code: 'ARCHIVE_REHYDRATE_CLEANUP_REQUIRED',
      })
      await expect(store.getMission(mission.id)).resolves.toMatchObject({
        status: 'finished',
        storage_state: 'recovery_required',
      })
      await expect(store.upsertMarker({
        mission_id: mission.id,
        id: '44444444-4444-4444-8444-444444444444',
        type: 'clue',
        name: 'Should be blocked',
        lat: 52.1,
        lon: -9.1,
        irish_grid_e: 480000,
        irish_grid_n: 580000,
        display_order: 1,
      })).rejects.toMatchObject({
        code: 'ARCHIVE_CORRECTION_ATTACHMENT_RECOVERY_REQUIRED',
      })
      await expect(store.unlockFinalizedMission(correctionInput)).rejects.toThrow(/finalized|recovery/iu)
      expect(correctionRunner).toHaveBeenCalledOnce()
    } finally {
      await store.prepareClose()
      store.close()
    }
  }, 60_000)

  it('fences a cancellation that arrives after correction commit before custody cleanup is proven', async () => {
    const userDataPath = mkdtempSync(path.join(tmpdir(), 'sartracker-rehydrate-cancel-fence-'))
    temporaryDirectories.add(userDataPath)
    const correctionRunner = vi.fn((input: Readonly<Record<string, unknown>>) => {
      const database = new Database(String(input.databasePath))
      mkdirSync(correctionJournalDirectory(String(input.databasePath)), { recursive: true })
      const timestamp = '2026-09-03T11:00:00.000Z'
      database.prepare('UPDATE missions SET status = ? WHERE id = ?')
        .run('finished', input.missionId)
      database.prepare(`INSERT INTO mission_events (
        id, mission_id, event_type, timestamp, details_json, recorded_at, recording_completeness
      ) VALUES (?, ?, 'mission_unlocked', ?, ?, ?, 'complete')`).run(
        'post-commit-cancel-event',
        input.missionId,
        timestamp,
        JSON.stringify({ restored_from_archive_id: input.archiveId }),
        timestamp,
      )
      database.close()
      const completion = Promise.reject(Object.assign(new Error('cancelled after commit'), {
        code: 'ARCHIVE_CANCELLED',
      }))
      Object.defineProperty(completion, 'workerExited', { value: Promise.resolve() })
      return completion
    })
    const store = createElectronMissionStore({
      userDataPath,
      readAdminRoster: async () => ['Duty Admin'],
      startArchiveCorrectionWorker: correctionRunner,
    })
    const custody = {
      passphrase: 'Cancellation Fence 2026!',
      recoveryCode: 'AB234-CD567-EF789-GH234-JK567-MN789-PR234-ST567',
    }
    try {
      const mission = await store.createMission({ name: 'Cancellation fence correction' })
      await store.finishMission(mission.id)
      const finalized = await store.finalizeMission(mission.id, custody)
      const archiveId = String((finalized as { readonly archive: { readonly id: string } }).archive.id)
      await store.syncBackup('correction-fixture')
      const snapshotPath = path.join(userDataPath, 'correction-snapshot.sqlite')
      copyFileSync(path.join(userDataPath, 'mission-store.backup.sqlite'), snapshotPath)
      await store.startMissionCleanup({
        missionId: mission.id,
        archiveId,
        slotType: 'passphrase',
        secret: custody.passphrase,
      }, {
        operationId: '24242424-2424-4242-8242-242424242424',
        reviewActivity: false,
        onProgress: () => undefined,
      })
      const correctionInput = {
        mission_id: mission.id,
        archive_id: archiveId,
        snapshot_path: snapshotPath,
        ...snapshotProof(snapshotPath),
        admin_name: 'Duty Admin',
        reason: 'Fence a cancellation after correction commit.',
      }
      await expect(store.unlockFinalizedMission(correctionInput)).rejects.toMatchObject({
        code: 'ARCHIVE_REHYDRATE_CLEANUP_REQUIRED',
      })
      await expect(store.getMission(mission.id)).resolves.toMatchObject({
        status: 'finished',
        storage_state: 'recovery_required',
      })
      expect(correctionRunner).toHaveBeenCalledOnce()
    } finally {
      await store.prepareClose()
      store.close()
    }
  }, 60_000)

  it('does not create a global fence when forced pre-commit cancellation leaves no attachment journal', async () => {
    const userDataPath = mkdtempSync(path.join(tmpdir(), 'sartracker-rehydrate-precommit-fence-'))
    temporaryDirectories.add(userDataPath)
    const cleanupFailure = Object.assign(new Error('forced cancellation interrupted custody rollback'), {
      code: 'ARCHIVE_REHYDRATE_CLEANUP_REQUIRED',
    })
    const correctionRunner = vi.fn(() => {
      const completion = Promise.reject(cleanupFailure)
      Object.defineProperty(completion, 'workerExited', { value: Promise.resolve() })
      return completion
    })
    const store = createElectronMissionStore({
      userDataPath,
      readAdminRoster: async () => ['Duty Admin'],
      startArchiveCorrectionWorker: correctionRunner,
    })
    const custody = {
      passphrase: 'Pre-commit Fence 2026!',
      recoveryCode: 'AB234-CD567-EF789-GH234-JK567-MN789-PR234-ST567',
    }
    try {
      const mission = await store.createMission({ name: 'Pre-commit cancellation fence' })
      await store.finishMission(mission.id)
      const finalized = await store.finalizeMission(mission.id, custody)
      const archiveId = String((finalized as { readonly archive: { readonly id: string } }).archive.id)
      await store.syncBackup('correction-fixture')
      const snapshotPath = path.join(userDataPath, 'precommit-snapshot.sqlite')
      copyFileSync(path.join(userDataPath, 'mission-store.backup.sqlite'), snapshotPath)
      await store.startMissionCleanup({
        missionId: mission.id,
        archiveId,
        slotType: 'passphrase',
        secret: custody.passphrase,
      }, {
        operationId: '25252525-2525-4525-8525-252525252525',
        reviewActivity: false,
        onProgress: () => undefined,
      })
      const correctionInput = {
        mission_id: mission.id,
        archive_id: archiveId,
        snapshot_path: snapshotPath,
        ...snapshotProof(snapshotPath),
        admin_name: 'Duty Admin',
        reason: 'Fence residue after forced correction cancellation.',
      }
      await expect(store.unlockFinalizedMission(correctionInput)).rejects.toMatchObject({
        code: 'ARCHIVE_REHYDRATE_CLEANUP_REQUIRED',
      })
      await expect(store.getMission(mission.id)).resolves.toMatchObject({
        status: 'finalized',
        storage_state: 'archived',
      })
      await expect(store.unlockFinalizedMission(correctionInput)).rejects.toMatchObject({
        code: 'ARCHIVE_REHYDRATE_CLEANUP_REQUIRED',
      })
      expect(correctionRunner).toHaveBeenCalledTimes(2)
    } finally {
      await store.prepareClose()
      store.close()
    }
  }, 60_000)

  it('defers correction while another mission is operational before starting the worker', async () => {
    const userDataPath = mkdtempSync(path.join(tmpdir(), 'sartracker-rehydrate-admission-'))
    temporaryDirectories.add(userDataPath)
    const runner = vi.fn(() => Promise.resolve({ missionId: 'unused', archiveId: 'unused' }))
    const store = createElectronMissionStore({
      userDataPath,
      readAdminRoster: async () => ['Duty Admin'],
      startArchiveCorrectionWorker: runner,
    })
    const custody = {
      passphrase: 'Admission Restore 2026!',
      recoveryCode: 'AB234-CD567-EF789-GH234-JK567-MN789-PR234-ST567',
    }
    try {
      const archivedMission = await store.createMission({ name: 'Admission archived mission' })
      await store.finishMission(archivedMission.id)
      const finalized = await store.finalizeMission(archivedMission.id, custody)
      const archiveId = String((finalized as { readonly archive: { readonly id: string } }).archive.id)
      await store.syncBackup('correction-fixture')
      await store.startMissionCleanup({
        missionId: archivedMission.id,
        archiveId,
        slotType: 'passphrase',
        secret: custody.passphrase,
      }, {
        operationId: '19191919-1919-4191-8191-191919191919',
        reviewActivity: false,
        onProgress: () => undefined,
      })
      const activeMission = await store.createMission({ name: 'Operational mission' })
      await expect(store.unlockFinalizedMission({
        mission_id: archivedMission.id,
        archive_id: archiveId,
        snapshot_path: path.join(userDataPath, 'not-started.sqlite'),
        admin_name: 'Duty Admin',
        reason: 'Correction is deferred while operations continue.',
      })).rejects.toMatchObject({ code: 'ARCHIVE_REHYDRATE_LIVE_ACTIVITY' })
      expect(activeMission.status).toBe('active')
      expect(runner).not.toHaveBeenCalled()
    } finally {
      await store.prepareClose()
      store.close()
    }
  }, 60_000)

  it('restores missing archived attachment bytes into canonical mission custody', async () => {
    const userDataPath = mkdtempSync(path.join(tmpdir(), 'sartracker-rehydrate-attachment-'))
    temporaryDirectories.add(userDataPath)
    const store = createElectronMissionStore({
      userDataPath,
      readAdminRoster: async () => ['Duty Admin'],
    })
    const custody = {
      passphrase: 'Attachment Restore 2026!',
      recoveryCode: 'AB234-CD567-EF789-GH234-JK567-MN789-PR234-ST567',
    }
    try {
      const mission = await store.createMission({ name: 'Attachment correction restore' })
      const attachmentPath = path.join(userDataPath, 'missions', mission.id, 'attachments', 'field.jpg')
      const marker = await store.upsertMarker({
        mission_id: mission.id,
        id: '22222222-2222-4222-8222-222222222222',
        type: 'clue',
        name: 'Field attachment',
        lat: 52.1,
        lon: -9.1,
        irish_grid_e: 480000,
        irish_grid_n: 580000,
        display_order: 0,
        attachment_path: attachmentPath,
      })
      const attachmentBytes = Buffer.from('archived attachment bytes')
      await store.runMarkerAttachmentIngest(mission.id, async () => {
        mkdirSync(path.dirname(attachmentPath), { recursive: true })
        writeFileSync(attachmentPath, attachmentBytes, { mode: 0o600 })
        return attachmentPath
      })
      await store.finishMission(mission.id)
      const finalized = await store.finalizeMission(mission.id, custody)
      const archiveId = String((finalized as { readonly archive: { readonly id: string } }).archive.id)
      const snapshotPath = path.join(userDataPath, 'attachment-snapshot.sqlite')
      await store.syncBackup('correction-fixture')
      copyFileSync(path.join(userDataPath, 'mission-store.backup.sqlite'), snapshotPath)
      await store.startMissionCleanup({
        missionId: mission.id,
        archiveId,
        slotType: 'passphrase',
        secret: custody.passphrase,
      }, {
        operationId: '20202020-2020-4202-8202-202020202020',
        reviewActivity: false,
        onProgress: () => undefined,
      })
      rmSync(attachmentPath, { force: true })
      const stagedDirectory = path.join(userDataPath, 'attachment-stage')
      const stagedAttachmentDirectory = path.join(stagedDirectory, 'attachments')
      mkdirSync(stagedAttachmentDirectory, { recursive: true })
      writeFileSync(path.join(stagedAttachmentDirectory, 'field.jpg'), attachmentBytes, { mode: 0o600 })
      const mapping = {
        entryName: 'attachments/field.jpg',
        sourceRelativePath: 'field.jpg',
        sha256: createHash('sha256').update(attachmentBytes).digest('hex'),
        sizeBytes: attachmentBytes.length,
        references: [{ referenceId: marker.id, referenceKind: 'marker' }],
      }
      await expect(store.unlockFinalizedMission({
        mission_id: mission.id,
        archive_id: archiveId,
        snapshot_path: snapshotPath,
        ...snapshotProof(snapshotPath),
        attachment_directory: stagedAttachmentDirectory,
        attachment_mappings: [mapping],
        admin_name: 'Duty Admin',
        reason: 'Restore attachment custody for a correction.',
      })).resolves.toMatchObject({ status: 'finished', storage_state: 'live' })
      expect(readFileSync(attachmentPath)).toEqual(attachmentBytes)
      const info = await store.info()
      const liveDb = new Database(info.database_path)
      try {
        expect(liveDb.prepare('SELECT attachment_path FROM markers WHERE id = ?').get(marker.id))
          .toEqual({ attachment_path: attachmentPath })
      } finally {
        liveDb.close()
      }
    } finally {
      await store.prepareClose()
      store.close()
    }
  }, 60_000)

  it('fences later archive work when post-commit attachment journal removal cannot be proven', async () => {
    const userDataPath = mkdtempSync(path.join(tmpdir(), 'sartracker-rehydrate-post-commit-cleanup-'))
    temporaryDirectories.add(userDataPath)
    const store = createElectronMissionStore({
      userDataPath,
      readAdminRoster: async () => ['Duty Admin'],
      archiveCorrectionFaultInjection: { failAttachmentJournalRemoval: true },
    })
    const custody = {
      passphrase: 'Post Commit Restore 2026!',
      recoveryCode: 'AB234-CD567-EF789-GH234-JK567-MN789-PR234-ST567',
    }
    try {
      const mission = await store.createMission({ name: 'Post-commit cleanup fence' })
      const attachmentPath = path.join(userDataPath, 'missions', mission.id, 'attachments', 'field.jpg')
      const marker = await store.upsertMarker({
        mission_id: mission.id,
        id: '33333333-3333-4333-8333-333333333333',
        type: 'clue',
        name: 'Post-commit attachment',
        lat: 52.1,
        lon: -9.1,
        irish_grid_e: 480000,
        irish_grid_n: 580000,
        display_order: 0,
        attachment_path: attachmentPath,
      })
      const attachmentBytes = Buffer.from('post-commit archived attachment')
      await store.runMarkerAttachmentIngest(mission.id, async () => {
        mkdirSync(path.dirname(attachmentPath), { recursive: true })
        writeFileSync(attachmentPath, attachmentBytes, { mode: 0o600 })
        return attachmentPath
      })
      await store.finishMission(mission.id)
      const finalized = await store.finalizeMission(mission.id, custody)
      const archiveId = String((finalized as { readonly archive: { readonly id: string } }).archive.id)
      await store.syncBackup('correction-fixture')
      const snapshotPath = path.join(userDataPath, 'post-commit-snapshot.sqlite')
      copyFileSync(path.join(userDataPath, 'mission-store.backup.sqlite'), snapshotPath)
      await store.startMissionCleanup({
        missionId: mission.id,
        archiveId,
        slotType: 'passphrase',
        secret: custody.passphrase,
      }, {
        operationId: '34343434-3434-4434-8434-343434343434',
        reviewActivity: false,
        onProgress: () => undefined,
      })
      rmSync(attachmentPath, { force: true })
      const stagedAttachmentDirectory = path.join(userDataPath, 'post-commit-stage', 'attachments')
      mkdirSync(stagedAttachmentDirectory, { recursive: true })
      writeFileSync(path.join(stagedAttachmentDirectory, 'field.jpg'), attachmentBytes, { mode: 0o600 })
      const mapping = {
        entryName: 'attachments/field.jpg',
        sourceRelativePath: 'field.jpg',
        sha256: createHash('sha256').update(attachmentBytes).digest('hex'),
        sizeBytes: attachmentBytes.length,
        references: [{ referenceId: marker.id, referenceKind: 'marker' }],
      }
      await expect(store.unlockFinalizedMission({
        mission_id: mission.id,
        archive_id: archiveId,
        snapshot_path: snapshotPath,
        ...snapshotProof(snapshotPath),
        attachment_directory: stagedAttachmentDirectory,
        attachment_mappings: [mapping],
        admin_name: 'Duty Admin',
        reason: 'Prove the post-commit custody fence.',
      })).rejects.toMatchObject({ code: 'ARCHIVE_REHYDRATE_CLEANUP_REQUIRED' })
      await expect(store.getMission(mission.id)).resolves.toMatchObject({
        status: 'finished',
        storage_state: 'recovery_required',
      })
      await expect(store.unlockFinalizedMission({
        mission_id: mission.id,
        archive_id: archiveId,
        snapshot_path: snapshotPath,
        ...snapshotProof(snapshotPath),
        attachment_directory: stagedAttachmentDirectory,
        attachment_mappings: [mapping],
        admin_name: 'Duty Admin',
        reason: 'A second correction must remain blocked.',
      })).rejects.toThrow(/finalized|recovery/iu)
    } finally {
      await store.prepareClose()
      store.close()
    }
  }, 60_000)
})
