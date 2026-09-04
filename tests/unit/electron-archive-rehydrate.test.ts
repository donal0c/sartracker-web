import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
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
    readonly recordIngestRejections: (input: Readonly<Record<string, unknown>>) => Promise<Readonly<Record<string, unknown>>>
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
const { deriveArchiveLifecycleEventId } = require(
  '../../electron/mission-finalization-boundary.cjs',
) as {
  readonly deriveArchiveLifecycleEventId: (archiveId: string, kind: string) => string
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

/** Installs one current recovery archive that protects an existing v2 finalization. */
function installFinalizedRecoveryArchive(
  database: InstanceType<typeof Database>,
  input: Readonly<{
    missionId: string
    protectedArchiveId: string
    recoveryArchiveId: string
    requestedAt: string
  }>,
) {
  const protectedEpoch = Number(database.prepare(`SELECT rowid FROM mission_events
    WHERE mission_id = ? AND event_type = 'mission_finalized'
    ORDER BY rowid DESC LIMIT 1`).get(input.missionId)?.rowid)
  const requestEventId = randomUUID()
  const operationId = randomUUID()
  database.prepare(`INSERT INTO mission_events (
    id, mission_id, event_type, timestamp, details_json,
    recorded_at, recording_completeness
  ) VALUES (?, ?, 'mission_archive_requested', ?, ?, ?, 'complete')`).run(
    requestEventId,
    input.missionId,
    input.requestedAt,
    JSON.stringify({
      archive_id: input.recoveryArchiveId,
      archive_kind: 'finalized_recovery',
      archive_relative_path: `${input.recoveryArchiveId}.sararch`,
      operation_id: operationId,
      protected_finalization_epoch: protectedEpoch,
      resulting_status: 'finalized',
    }),
    input.requestedAt,
  )
  const requestEventRowid = Number(database.prepare(
    'SELECT rowid FROM mission_events WHERE id = ?',
  ).get(requestEventId)?.rowid)
  database.prepare(`INSERT INTO mission_archives (
    id, mission_id, request_event_rowid, request_event_id,
    creation_operation_id, protected_finalization_epoch, archive_kind,
    container_version, relative_path, ciphertext_sha256, size_bytes, created_at,
    sealed_event_id, frame_count, header_sha256, manifest_sha256, entry_count,
    table_count, verified_at, verification_proof_json, previous_archive_id,
    status, availability, availability_reason, last_reconciled_at,
    last_observed_file_identity, slots_json, last_non_machine_unwrap_at,
    legacy_event_rowid
  ) SELECT ?, mission_id, ?, ?, ?, ?, 'finalized_recovery',
    container_version, ?, ciphertext_sha256, size_bytes, ?, sealed_event_id,
    frame_count, header_sha256, manifest_sha256, entry_count, table_count,
    verified_at, verification_proof_json, NULL, 'verified', availability,
    availability_reason, last_reconciled_at, last_observed_file_identity,
    slots_json, last_non_machine_unwrap_at, NULL
  FROM mission_archives WHERE id = ?`).run(
    input.recoveryArchiveId,
    requestEventRowid,
    requestEventId,
    operationId,
    protectedEpoch,
    `${input.recoveryArchiveId}.sararch`,
    input.requestedAt,
    input.protectedArchiveId,
  )
}

afterEach(() => {
  for (const directory of temporaryDirectories) rmSync(directory, { recursive: true, force: true })
  temporaryDirectories.clear()
})

describe('archived mission correction rehydration', () => {
  it('fails closed with the stable snapshot code when the v2 finalization projection is missing', () => {
    const userDataPath = mkdtempSync(path.join(tmpdir(), 'sartracker-rehydrate-boundary-'))
    temporaryDirectories.add(userDataPath)
    const snapshotPath = path.join(userDataPath, 'missing-finalization.sqlite')
    const archiveId = '11111111-1111-4111-8111-111111111111'
    const snapshot = new Database(snapshotPath)
    snapshot.exec(`
      CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO metadata (key, value) VALUES ('schema_version', '13');
      CREATE TABLE missions (id TEXT PRIMARY KEY, status TEXT NOT NULL);
      INSERT INTO missions (id, status) VALUES ('mission-a', 'finalized');
      CREATE TABLE mission_events (
        id TEXT PRIMARY KEY,
        mission_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        details_json TEXT
      );
    `)
    snapshot.close()
    const proof = snapshotProof(snapshotPath)
    const live = new Database(':memory:')
    try {
      expect(() => rehydrateMissionFromSnapshot({
        db: live,
        snapshotPath,
        expectedSha256: proof.snapshot_database_sha256,
        expectedIdentity: proof.snapshot_database_identity,
        missionId: 'mission-a',
        archiveId,
        schemaVersion: CURRENT_SCHEMA_VERSION,
      })).toThrow(expect.objectContaining({
        code: 'ARCHIVE_REHYDRATE_SNAPSHOT_INVALID',
      }))
    } finally {
      live.close()
    }
  })

  it('restores a finalized-recovery archive through its protected original boundary', async () => {
    const userDataPath = mkdtempSync(path.join(tmpdir(), 'sartracker-rehydrate-recovery-'))
    temporaryDirectories.add(userDataPath)
    const custody = {
      passphrase: 'Recovery Restore 2026!',
      recoveryCode: 'AB234-CD567-EF789-GH234-JK567-MN789-PR234-ST567',
    }
    const store = createElectronMissionStore({ userDataPath })
    let missionId = ''
    let originalArchiveId = ''
    const recoveryArchiveId = '92929292-9292-4292-8292-929292929292'
    const snapshotPath = path.join(userDataPath, 'recovery-correction-snapshot.sqlite')
    try {
      const mission = await store.createMission({ name: 'Recovery-bound correction restore' })
      missionId = mission.id
      await store.upsertDevice({
        mission_id: missionId,
        device_id: 'recovery-device',
        name: 'Recovery Device',
        color: '#0088ff',
        status: 'offline',
      })
      await store.finishMission(missionId)
      const finalized = await store.finalizeMission(missionId, custody) as {
        readonly archive: { readonly id: string }
      }
      originalArchiveId = finalized.archive.id
      await store.syncBackup('recovery-correction-fixture')
      copyFileSync(path.join(userDataPath, 'mission-store.backup.sqlite'), snapshotPath)
      await store.startMissionCleanup({
        missionId,
        archiveId: originalArchiveId,
        slotType: 'passphrase',
        secret: custody.passphrase,
      }, {
        operationId: '93939393-9393-4393-8393-939393939393',
        reviewActivity: false,
        onProgress: () => undefined,
      })
    } finally {
      await store.prepareClose()
      store.close()
    }

    const live = new Database(path.join(userDataPath, 'mission-store.sqlite'))
    try {
      const protectedEpoch = Number(live.prepare(`SELECT rowid FROM mission_events
        WHERE mission_id = ? AND event_type = 'mission_finalized'
        ORDER BY rowid DESC LIMIT 1`).get(missionId)?.rowid)
      const requestEventId = randomUUID()
      const requestTimestamp = '2026-09-04T12:00:00.000Z'
      live.prepare(`INSERT INTO mission_events (
        id, mission_id, event_type, timestamp, details_json,
        recorded_at, recording_completeness
      ) VALUES (?, ?, 'mission_archive_requested', ?, ?, ?, 'complete')`).run(
        requestEventId,
        missionId,
        requestTimestamp,
        JSON.stringify({
          archive_id: recoveryArchiveId,
          archive_kind: 'finalized_recovery',
          archive_relative_path: `${recoveryArchiveId}.sararch`,
          operation_id: '94949494-9494-4494-8494-949494949494',
          protected_finalization_epoch: protectedEpoch,
          resulting_status: 'finalized',
        }),
        requestTimestamp,
      )
      const requestEventRowid = Number(live.prepare('SELECT rowid FROM mission_events WHERE id = ?')
        .get(requestEventId)?.rowid)
      live.prepare("UPDATE mission_archives SET status = 'superseded' WHERE id = ?")
        .run(originalArchiveId)
      live.prepare(`INSERT INTO mission_archives (
        id, mission_id, request_event_rowid, request_event_id,
        creation_operation_id, protected_finalization_epoch, archive_kind,
        container_version, relative_path, ciphertext_sha256, size_bytes, created_at,
        sealed_event_id, frame_count, header_sha256, manifest_sha256, entry_count,
        table_count, verified_at, verification_proof_json, previous_archive_id,
        status, availability, availability_reason, last_reconciled_at,
        last_observed_file_identity, slots_json, last_non_machine_unwrap_at,
        legacy_event_rowid
      ) SELECT ?, mission_id, ?, ?, ?, ?, 'finalized_recovery',
        container_version, ?, ciphertext_sha256, size_bytes, ?, sealed_event_id,
        frame_count, header_sha256, manifest_sha256, entry_count, table_count,
        verified_at, verification_proof_json, NULL, 'verified', availability,
        availability_reason, last_reconciled_at, last_observed_file_identity,
        slots_json, last_non_machine_unwrap_at, NULL
      FROM mission_archives WHERE id = ?`).run(
        recoveryArchiveId,
        requestEventRowid,
        requestEventId,
        '94949494-9494-4494-8494-949494949494',
        protectedEpoch,
        `${recoveryArchiveId}.sararch`,
        requestTimestamp,
        originalArchiveId,
      )
      const proof = snapshotProof(snapshotPath)

      expect(rehydrateMissionFromSnapshot({
        db: live,
        snapshotPath,
        expectedSha256: proof.snapshot_database_sha256,
        expectedIdentity: proof.snapshot_database_identity,
        missionId,
        archiveId: recoveryArchiveId,
        finalizedEpoch: protectedEpoch,
        schemaVersion: CURRENT_SCHEMA_VERSION,
      })).toEqual({ missionId, archiveId: recoveryArchiveId })
      expect(live.prepare('SELECT name FROM devices WHERE mission_id = ?').get(missionId))
        .toEqual({ name: 'Recovery Device' })
    } finally {
      live.close()
    }
  }, 60_000)

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

  it('keeps live Review lineage through repeated re-finalize and ordinary-unlock cycles', async () => {
    const userDataPath = mkdtempSync(path.join(tmpdir(), 'sartracker-rehydrate-refinalize-unlock-'))
    temporaryDirectories.add(userDataPath)
    const store = createElectronMissionStore({
      userDataPath,
      readAdminRoster: async () => ['Duty Admin'],
    })
    const custody = {
      passphrase: 'Lineage Restore 2026!',
      recoveryCode: 'AB234-CD567-EF789-GH234-JK567-MN789-PR234-ST567',
    }
    try {
      const mission = await store.createMission({ name: 'Correction lineage after ordinary unlock' })
      await store.finishMission(mission.id)
      const firstFinalization = await store.finalizeMission(mission.id, custody)
      const firstArchiveId = String(
        (firstFinalization as { readonly archive: { readonly id: string } }).archive.id,
      )
      await store.syncBackup('correction-lineage-fixture')
      const snapshotPath = path.join(userDataPath, 'correction-lineage-snapshot.sqlite')
      copyFileSync(path.join(userDataPath, 'mission-store.backup.sqlite'), snapshotPath)
      await store.startMissionCleanup({
        missionId: mission.id,
        archiveId: firstArchiveId,
        slotType: 'passphrase',
        secret: custody.passphrase,
      }, {
        operationId: '37373737-3737-4737-8737-373737373737',
        reviewActivity: false,
        onProgress: () => undefined,
      })
      await expect(store.unlockFinalizedMission({
        mission_id: mission.id,
        archive_id: firstArchiveId,
        snapshot_path: snapshotPath,
        ...snapshotProof(snapshotPath),
        admin_name: 'Duty Admin',
        reason: 'Restore this archived mission for a recorded correction.',
      })).resolves.toMatchObject({ status: 'finished', storage_state: 'live' })

      const restoredUnlock = new Database(path.join(userDataPath, 'mission-store.sqlite'), {
        readonly: true,
      })
      let restoredUnlockProof
      try {
        restoredUnlockProof = restoredUnlock.prepare(`SELECT rowid AS event_rowid, id, timestamp
          FROM mission_events WHERE id = ?`).get(
          deriveArchiveLifecycleEventId(firstArchiveId, 'mission-unlocked'),
        )
        expect(restoredUnlockProof).toMatchObject({
          id: deriveArchiveLifecycleEventId(firstArchiveId, 'mission-unlocked'),
          event_rowid: expect.any(Number),
          timestamp: expect.any(String),
        })
      } finally {
        restoredUnlock.close()
      }

      const secondFinalization = await store.finalizeMission(mission.id, custody)
      expect(secondFinalization).toMatchObject({
        mission: { status: 'finalized', storage_state: 'live' },
      })
      const secondArchiveId = String(
        (secondFinalization as { readonly archive: { readonly id: string } }).archive.id,
      )
      const firstSupplement = new Database(path.join(userDataPath, 'mission-store.sqlite'), {
        readonly: true,
      })
      try {
        const row = firstSupplement.prepare(`SELECT event.details_json
          FROM mission_archive_supplements AS supplement
          JOIN mission_events AS event ON event.id = supplement.audit_event_id
          WHERE supplement.archive_id = ?`).get(secondArchiveId) as {
            readonly details_json: string
          }
        expect(JSON.parse(row.details_json)).toMatchObject({
          unlock_event_id: restoredUnlockProof.id,
          unlock_event_rowid: restoredUnlockProof.event_rowid,
          unlocked_at: restoredUnlockProof.timestamp,
        })
      } finally {
        firstSupplement.close()
      }
      await expect(store.unlockFinalizedMission({
        mission_id: mission.id,
        admin_name: 'Duty Admin',
        reason: 'Make one further ordinary correction after re-finalization.',
      })).resolves.toMatchObject({ status: 'finished', storage_state: 'live' })
      const ordinaryUnlock = new Database(path.join(userDataPath, 'mission-store.sqlite'), {
        readonly: true,
      })
      try {
        expect(ordinaryUnlock.prepare(`SELECT event_type FROM mission_events
          WHERE id = ?`).get(
          deriveArchiveLifecycleEventId(secondArchiveId, 'mission-unlocked'),
        )).toEqual({ event_type: 'mission_unlocked' })
      } finally {
        ordinaryUnlock.close()
      }
      await expect(store.getMission(mission.id)).resolves.toMatchObject({
        status: 'finished',
        storage_state: 'live',
      })

      await expect(store.finalizeMission(mission.id, custody)).resolves.toMatchObject({
        mission: { status: 'finalized', storage_state: 'live' },
      })
      await expect(store.unlockFinalizedMission({
        mission_id: mission.id,
        admin_name: 'Duty Admin',
        reason: 'Make a second ordinary correction after re-finalization.',
      })).resolves.toMatchObject({ status: 'finished', storage_state: 'live' })
      await expect(store.getMission(mission.id)).resolves.toMatchObject({
        status: 'finished',
        storage_state: 'live',
      })
    } finally {
      await store.prepareClose()
      store.close()
    }
  }, 60_000)

  it('continues lineage when cleanup targets an already-supplemental archive revision', async () => {
    const userDataPath = mkdtempSync(path.join(tmpdir(), 'sartracker-rehydrate-existing-supplement-'))
    temporaryDirectories.add(userDataPath)
    const store = createElectronMissionStore({
      userDataPath,
      readAdminRoster: async () => ['Duty Admin'],
    })
    const custody = {
      passphrase: 'Existing Supplement 2026!',
      recoveryCode: 'AB234-CD567-EF789-GH234-JK567-MN789-PR234-ST567',
    }
    try {
      const mission = await store.createMission({ name: 'Cleanup after an earlier correction' })
      await store.finishMission(mission.id)
      const originalFinalization = await store.finalizeMission(mission.id, custody)
      const originalArchiveId = String(
        (originalFinalization as { readonly archive: { readonly id: string } }).archive.id,
      )
      await store.unlockFinalizedMission({
        mission_id: mission.id,
        admin_name: 'Duty Admin',
        reason: 'Create the correction revision that will later be cleaned up.',
      })
      const cleanupFinalization = await store.finalizeMission(mission.id, custody)
      const cleanupArchiveId = String(
        (cleanupFinalization as { readonly archive: { readonly id: string } }).archive.id,
      )
      await store.syncBackup('existing-supplement-lineage-fixture')
      const snapshotPath = path.join(userDataPath, 'existing-supplement-snapshot.sqlite')
      copyFileSync(path.join(userDataPath, 'mission-store.backup.sqlite'), snapshotPath)
      await store.startMissionCleanup({
        missionId: mission.id,
        archiveId: cleanupArchiveId,
        slotType: 'passphrase',
        secret: custody.passphrase,
      }, {
        operationId: '40404040-4040-4040-8040-404040404040',
        reviewActivity: false,
        onProgress: () => undefined,
      })
      await store.unlockFinalizedMission({
        mission_id: mission.id,
        archive_id: cleanupArchiveId,
        snapshot_path: snapshotPath,
        ...snapshotProof(snapshotPath),
        admin_name: 'Duty Admin',
        reason: 'Restore the existing supplemental revision for another correction.',
      })
      const nextFinalization = await store.finalizeMission(mission.id, custody)
      const nextArchiveId = String(
        (nextFinalization as { readonly archive: { readonly id: string } }).archive.id,
      )
      expect(nextFinalization).toMatchObject({
        mission: { status: 'finalized', storage_state: 'live' },
      })

      const liveDatabase = new Database(path.join(userDataPath, 'mission-store.sqlite'), {
        readonly: true,
      })
      try {
        expect(liveDatabase.prepare(`SELECT archive_id, previous_archive_id,
            supplement_sequence
          FROM mission_archive_supplements WHERE mission_id = ?
          ORDER BY supplement_sequence`).all(mission.id)).toEqual([
          {
            archive_id: cleanupArchiveId,
            previous_archive_id: originalArchiveId,
            supplement_sequence: 1,
          },
          {
            archive_id: nextArchiveId,
            previous_archive_id: cleanupArchiveId,
            supplement_sequence: 2,
          },
        ])
      } finally {
        liveDatabase.close()
      }

      await expect(store.unlockFinalizedMission({
        mission_id: mission.id,
        admin_name: 'Duty Admin',
        reason: 'Open the next ordinary correction after supplemental cleanup restore.',
      })).resolves.toMatchObject({ status: 'finished', storage_state: 'live' })
    } finally {
      await store.prepareClose()
      store.close()
    }
  }, 60_000)

  it('uses exact unlock point reads without building a mission-history index at startup', async () => {
    const userDataPath = mkdtempSync(path.join(tmpdir(), 'sartracker-rehydrate-lineage-index-'))
    temporaryDirectories.add(userDataPath)
    const store = createElectronMissionStore({ userDataPath })
    try {
      await store.createMission({ name: 'Correction lineage query plan' })
      const database = new Database(path.join(userDataPath, 'mission-store.sqlite'), {
        readonly: true,
      })
      try {
        expect(database.prepare(`SELECT name FROM sqlite_master
          WHERE type = 'index' AND name = 'idx_mission_events_unlock_lineage'`).get())
          .toBeUndefined()
        const rowidPlan = database.prepare(`EXPLAIN QUERY PLAN
          SELECT rowid AS event_rowid, id, timestamp, details_json
          FROM mission_events WHERE rowid = ?`).all(1)
        const idPlan = database.prepare(`EXPLAIN QUERY PLAN
          SELECT rowid AS event_rowid, id, timestamp, details_json
          FROM mission_events WHERE id = ?`).all(randomUUID())
        const rowidDetail = rowidPlan
          .map((step: { readonly detail: string }) => step.detail).join('\n')
        const idDetail = idPlan
          .map((step: { readonly detail: string }) => step.detail).join('\n')
        expect(rowidDetail).toContain('USING INTEGER PRIMARY KEY (rowid=?)')
        expect(idDetail).toContain('USING INDEX sqlite_autoindex_mission_events_1 (id=?)')
        for (const detail of [rowidDetail, idDetail]) {
          expect(detail).not.toContain('SCAN')
          expect(detail).not.toContain('TEMP B-TREE')
        }
      } finally {
        database.close()
      }
    } finally {
      await store.prepareClose()
      store.close()
    }
  })

  it('keeps valid correction lineage live through a current finalized-recovery head', async () => {
    const userDataPath = mkdtempSync(path.join(tmpdir(), 'sartracker-rehydrate-lineage-recovery-'))
    temporaryDirectories.add(userDataPath)
    const store = createElectronMissionStore({
      userDataPath,
      readAdminRoster: async () => ['Duty Admin'],
    })
    const custody = {
      passphrase: 'Lineage Recovery 2026!',
      recoveryCode: 'AB234-CD567-EF789-GH234-JK567-MN789-PR234-ST567',
    }
    try {
      const mission = await store.createMission({ name: 'Correction lineage recovery head' })
      await store.finishMission(mission.id)
      const original = await store.finalizeMission(mission.id, custody)
      const originalArchiveId = String(
        (original as { readonly archive: { readonly id: string } }).archive.id,
      )
      await store.syncBackup('lineage-recovery-head-fixture')
      const snapshotPath = path.join(userDataPath, 'lineage-recovery-head-snapshot.sqlite')
      copyFileSync(path.join(userDataPath, 'mission-store.backup.sqlite'), snapshotPath)
      await store.startMissionCleanup({
        missionId: mission.id,
        archiveId: originalArchiveId,
        slotType: 'passphrase',
        secret: custody.passphrase,
      }, {
        operationId: '41414141-4141-4141-8141-414141414141',
        reviewActivity: false,
        onProgress: () => undefined,
      })
      await store.unlockFinalizedMission({
        mission_id: mission.id,
        archive_id: originalArchiveId,
        snapshot_path: snapshotPath,
        ...snapshotProof(snapshotPath),
        admin_name: 'Duty Admin',
        reason: 'Restore this archived mission before recovery-head validation.',
      })
      const refinalized = await store.finalizeMission(mission.id, custody)
      const refinalizedArchiveId = String(
        (refinalized as { readonly archive: { readonly id: string } }).archive.id,
      )
      const recoveryArchiveId = '42424242-4242-4242-8242-424242424242'
      const liveDatabase = new Database(path.join(userDataPath, 'mission-store.sqlite'))
      try {
        installFinalizedRecoveryArchive(liveDatabase, {
          missionId: mission.id,
          protectedArchiveId: refinalizedArchiveId,
          recoveryArchiveId,
          requestedAt: new Date(Date.now() + 1_000).toISOString(),
        })
      } finally {
        liveDatabase.close()
      }

      await expect(store.getMission(mission.id)).resolves.toMatchObject({
        status: 'finalized',
        storage_state: 'live',
      })

      const nextArchiveId = '43434343-4343-4343-8343-434343434343'
      const nextOperationId = '44444444-4444-4444-8444-444444444444'
      const ordinaryUnlockAt = new Date(Date.now() + 2_000).toISOString()
      const nextRequestedAt = new Date(Date.now() + 3_000).toISOString()
      const nextDatabase = new Database(path.join(userDataPath, 'mission-store.sqlite'))
      try {
        nextDatabase.transaction(() => {
          const protectedFinalization = nextDatabase.prepare(`SELECT details_json
            FROM mission_events WHERE id = ?`).get(
            deriveArchiveLifecycleEventId(refinalizedArchiveId, 'mission-finalized'),
          ) as { readonly details_json: string }
          const cleanupMembershipGeneration = Number(
            JSON.parse(protectedFinalization.details_json).cleanup_membership_generation,
          )
          const recovery = nextDatabase.prepare(`SELECT ciphertext_sha256
            FROM mission_archives WHERE id = ?`).get(recoveryArchiveId) as {
            readonly ciphertext_sha256: string
          }
          nextDatabase.prepare("UPDATE missions SET status = 'finished' WHERE id = ?")
            .run(mission.id)
          const ordinaryUnlockEventId = deriveArchiveLifecycleEventId(
            recoveryArchiveId,
            'mission-unlocked',
          )
          nextDatabase.prepare(`INSERT INTO mission_events (
              id, mission_id, event_type, timestamp, details_json, recorded_at,
              recording_completeness
            ) VALUES (?, ?, 'mission_unlocked', ?, ?, ?, 'complete')`).run(
            ordinaryUnlockEventId,
            mission.id,
            ordinaryUnlockAt,
            JSON.stringify({
              admin_name: 'Duty Admin',
              reason: 'Continue correction through the recovery archive predecessor.',
              resulting_status: 'finished',
            }),
            ordinaryUnlockAt,
          )
          const ordinaryUnlockEventRowid = Number(nextDatabase.prepare(`SELECT rowid
            FROM mission_events WHERE id = ?`).get(ordinaryUnlockEventId)?.rowid)
          const requestEventId = randomUUID()
          nextDatabase.prepare(`INSERT INTO mission_events (
              id, mission_id, event_type, timestamp, details_json, recorded_at,
              recording_completeness
            ) VALUES (?, ?, 'mission_finalize_requested', ?, ?, ?, 'complete')`).run(
            requestEventId,
            mission.id,
            nextRequestedAt,
            JSON.stringify({
              resulting_status: 'finished',
              archive_id: nextArchiveId,
              operation_id: nextOperationId,
              archive_kind: 'finalized',
              archive_relative_path: `${nextArchiveId}.sararch`,
              cleanup_membership_generation: cleanupMembershipGeneration,
              protected_finalization_epoch: null,
              previous_archive_id: recoveryArchiveId,
              previous_archive_sha256: recovery.ciphertext_sha256,
            }),
            nextRequestedAt,
          )
          const requestEventRowid = Number(nextDatabase.prepare(`SELECT rowid
            FROM mission_events WHERE id = ?`).get(requestEventId)?.rowid)
          nextDatabase.prepare(`INSERT INTO mission_archives (
              id, mission_id, request_event_rowid, request_event_id,
              creation_operation_id, protected_finalization_epoch, archive_kind,
              container_version, relative_path, ciphertext_sha256, size_bytes, created_at,
              sealed_event_id, frame_count, header_sha256, manifest_sha256, entry_count,
              table_count, verified_at, verification_proof_json, previous_archive_id,
              status, availability, availability_reason, last_reconciled_at,
              last_observed_file_identity, slots_json, last_non_machine_unwrap_at,
              legacy_event_rowid
            ) SELECT ?, mission_id, ?, ?, ?, NULL, 'finalized', container_version, ?,
              ciphertext_sha256, size_bytes, ?, sealed_event_id, frame_count, header_sha256,
              manifest_sha256, entry_count, table_count, verified_at, verification_proof_json,
              ?, 'verified', availability, availability_reason, last_reconciled_at,
              last_observed_file_identity, slots_json, last_non_machine_unwrap_at, NULL
            FROM mission_archives WHERE id = ?`).run(
            nextArchiveId,
            requestEventRowid,
            requestEventId,
            nextOperationId,
            `${nextArchiveId}.sararch`,
            nextRequestedAt,
            recoveryArchiveId,
            recoveryArchiveId,
          )
          const supplementEventId = deriveArchiveLifecycleEventId(nextArchiveId, 'supplement')
          const supplementDetails = {
            archive_id: nextArchiveId,
            previous_archive_id: recoveryArchiveId,
            supplement_sequence: 2,
            authority: 'Duty Admin',
            reason: 'Continue correction through the recovery archive predecessor.',
            resulting_status: 'finalized',
            unlock_event_id: ordinaryUnlockEventId,
            unlock_event_rowid: ordinaryUnlockEventRowid,
            unlocked_at: ordinaryUnlockAt,
          }
          nextDatabase.prepare(`INSERT INTO mission_events (
              id, mission_id, event_type, timestamp, details_json, recorded_at,
              recording_completeness
            ) VALUES (?, ?, 'mission_archive_supplement_recorded', ?, ?, ?, 'complete')`).run(
            supplementEventId,
            mission.id,
            nextRequestedAt,
            JSON.stringify(supplementDetails),
            nextRequestedAt,
          )
          nextDatabase.prepare(`INSERT INTO mission_archive_supplements (
              id, mission_id, archive_id, previous_archive_id, supplement_sequence,
              authority, reason, created_at, audit_event_id
            ) VALUES (?, ?, ?, ?, 2, ?, ?, ?, ?)`).run(
            randomUUID(),
            mission.id,
            nextArchiveId,
            recoveryArchiveId,
            supplementDetails.authority,
            supplementDetails.reason,
            nextRequestedAt,
            supplementEventId,
          )
          nextDatabase.prepare("UPDATE mission_archives SET status = 'superseded' WHERE id = ?")
            .run(recoveryArchiveId)
          nextDatabase.prepare(`INSERT INTO mission_events (
              id, mission_id, event_type, timestamp, details_json, recorded_at,
              recording_completeness
            ) VALUES (?, ?, 'mission_finalized', ?, ?, ?, 'complete')`).run(
            deriveArchiveLifecycleEventId(nextArchiveId, 'mission-finalized'),
            mission.id,
            nextRequestedAt,
            JSON.stringify({
              resulting_status: 'finalized',
              archive_id: nextArchiveId,
              archive_path: path.join(userDataPath, 'archives', `${nextArchiveId}.sararch`),
              archive_relative_path: `${nextArchiveId}.sararch`,
              cleanup_membership_generation: cleanupMembershipGeneration,
              container_version: 2,
            }),
            nextRequestedAt,
          )
          nextDatabase.prepare("UPDATE missions SET status = 'finalized' WHERE id = ?")
            .run(mission.id)
        }).immediate()

        expect(nextDatabase.prepare(`SELECT id, status FROM mission_archives
          WHERE id IN (?, ?, ?) ORDER BY request_event_rowid`).all(
          refinalizedArchiveId,
          recoveryArchiveId,
          nextArchiveId,
        )).toEqual([
          { id: refinalizedArchiveId, status: 'verified' },
          { id: recoveryArchiveId, status: 'superseded' },
          { id: nextArchiveId, status: 'verified' },
        ])
      } finally {
        nextDatabase.close()
      }
      await expect(store.getMission(mission.id)).resolves.toMatchObject({
        status: 'finalized',
        storage_state: 'live',
      })
    } finally {
      await store.prepareClose()
      store.close()
    }
  }, 60_000)

  it('fails live Review closed when a correction archive ancestry link is corrupt', async () => {
    const userDataPath = mkdtempSync(path.join(tmpdir(), 'sartracker-rehydrate-corrupt-lineage-'))
    temporaryDirectories.add(userDataPath)
    const store = createElectronMissionStore({
      userDataPath,
      readAdminRoster: async () => ['Duty Admin'],
    })
    const custody = {
      passphrase: 'Corrupt Lineage 2026!',
      recoveryCode: 'AB234-CD567-EF789-GH234-JK567-MN789-PR234-ST567',
    }
    try {
      const mission = await store.createMission({ name: 'Corrupt correction archive lineage' })
      await store.finishMission(mission.id)
      const firstFinalization = await store.finalizeMission(mission.id, custody)
      const firstArchiveId = String(
        (firstFinalization as { readonly archive: { readonly id: string } }).archive.id,
      )
      await store.syncBackup('corrupt-lineage-fixture')
      const snapshotPath = path.join(userDataPath, 'corrupt-lineage-snapshot.sqlite')
      copyFileSync(path.join(userDataPath, 'mission-store.backup.sqlite'), snapshotPath)
      await store.startMissionCleanup({
        missionId: mission.id,
        archiveId: firstArchiveId,
        slotType: 'passphrase',
        secret: custody.passphrase,
      }, {
        operationId: '38383838-3838-4838-8838-383838383838',
        reviewActivity: false,
        onProgress: () => undefined,
      })
      await store.unlockFinalizedMission({
        mission_id: mission.id,
        archive_id: firstArchiveId,
        snapshot_path: snapshotPath,
        ...snapshotProof(snapshotPath),
        admin_name: 'Duty Admin',
        reason: 'Restore this archived mission before testing its lineage guard.',
      })
      const refinalized = await store.finalizeMission(mission.id, custody)
      const refinalizedArchiveId = String(
        (refinalized as { readonly archive: { readonly id: string } }).archive.id,
      )
      await store.unlockFinalizedMission({
        mission_id: mission.id,
        admin_name: 'Duty Admin',
        reason: 'Open one ordinary correction epoch before corrupting its lineage.',
      })

      const liveDatabase = new Database(path.join(userDataPath, 'mission-store.sqlite'))
      let brokenPredecessorState
      let mislinkedUnlockState
      let misorderedSupplementState
      let missingSupplementState
      try {
        const predecessor = liveDatabase.prepare(`SELECT previous_archive_id
          FROM mission_archives WHERE id = ?`).get(refinalizedArchiveId)
        expect(predecessor).toEqual({ previous_archive_id: firstArchiveId })
        liveDatabase.prepare(`UPDATE mission_archives SET previous_archive_id = NULL
          WHERE id = ?`).run(refinalizedArchiveId)
        brokenPredecessorState = (await store.getMission(mission.id)).storage_state

        liveDatabase.prepare(`UPDATE mission_archives SET previous_archive_id = ?
          WHERE id = ?`).run(firstArchiveId, refinalizedArchiveId)
        const supplementEvent = liveDatabase.prepare(`SELECT event.rowid AS event_rowid,
            finalized.rowid AS finalization_rowid, event.id, event.details_json
          FROM mission_archive_supplements AS supplement
          JOIN mission_events AS event ON event.id = supplement.audit_event_id
          JOIN mission_events AS finalized
            ON finalized.id = ?
          WHERE supplement.archive_id = ?`).get(
          deriveArchiveLifecycleEventId(refinalizedArchiveId, 'mission-finalized'),
          refinalizedArchiveId,
        ) as {
          readonly event_rowid: number
          readonly finalization_rowid: number
          readonly id: string
          readonly details_json: string
        }
        const supplementDetails = JSON.parse(supplementEvent.details_json)
        liveDatabase.prepare('UPDATE mission_events SET details_json = ? WHERE id = ?').run(
          JSON.stringify({
            ...supplementDetails,
            unlock_event_rowid: Number(supplementDetails.unlock_event_rowid ?? 0) + 1,
          }),
          supplementEvent.id,
        )
        mislinkedUnlockState = (await store.getMission(mission.id)).storage_state
        liveDatabase.prepare('UPDATE mission_events SET details_json = ? WHERE id = ?')
          .run(supplementEvent.details_json, supplementEvent.id)

        expect(supplementEvent.event_rowid).toBeLessThan(supplementEvent.finalization_rowid)
        liveDatabase.prepare(`UPDATE mission_events
          SET rowid = (SELECT MAX(rowid) + 100 FROM mission_events)
          WHERE id = ?`).run(supplementEvent.id)
        misorderedSupplementState = (await store.getMission(mission.id)).storage_state
        liveDatabase.prepare('UPDATE mission_events SET rowid = ? WHERE id = ?')
          .run(supplementEvent.event_rowid, supplementEvent.id)

        const removedSupplement = liveDatabase.prepare(`DELETE FROM mission_archive_supplements
          WHERE archive_id = ?`).run(refinalizedArchiveId)
        expect(removedSupplement.changes).toBe(1)
        missingSupplementState = (await store.getMission(mission.id)).storage_state
      } finally {
        liveDatabase.close()
      }

      expect({
        brokenPredecessorState,
        mislinkedUnlockState,
        misorderedSupplementState,
        missingSupplementState,
      }).toEqual({
        brokenPredecessorState: 'cleanup_in_progress',
        mislinkedUnlockState: 'cleanup_in_progress',
        misorderedSupplementState: 'cleanup_in_progress',
        missingSupplementState: 'cleanup_in_progress',
      })
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
      writeFileSync(path.join(
        correctionJournalDirectory(String(input.databasePath)),
        'pending.json',
      ), '{}', { mode: 0o600 })
      const timestamp = '2026-09-03T10:00:00.000Z'
      database.prepare('UPDATE missions SET status = ? WHERE id = ?')
        .run('finished', input.missionId)
      database.prepare(`INSERT INTO mission_events (
        id, mission_id, event_type, timestamp, details_json, recorded_at, recording_completeness
      ) VALUES (?, ?, 'mission_unlocked', ?, ?, ?, 'complete')`).run(
        deriveArchiveLifecycleEventId(String(input.archiveId), 'mission-unlocked'),
        input.missionId,
        timestamp,
        JSON.stringify({
          admin_name: input.adminName,
          reason: input.reason,
          restored_from_archive_id: input.archiveId,
          archive_correction_operation_id: input.operationId,
          resulting_status: 'finished',
          storage_state: 'live',
        }),
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
      writeFileSync(path.join(
        correctionJournalDirectory(String(input.databasePath)),
        'pending.json',
      ), '{}', { mode: 0o600 })
      const timestamp = '2026-09-03T11:00:00.000Z'
      database.prepare('UPDATE missions SET status = ? WHERE id = ?')
        .run('finished', input.missionId)
      database.prepare(`INSERT INTO mission_events (
        id, mission_id, event_type, timestamp, details_json, recorded_at, recording_completeness
      ) VALUES (?, ?, 'mission_unlocked', ?, ?, ?, 'complete')`).run(
        deriveArchiveLifecycleEventId(String(input.archiveId), 'mission-unlocked'),
        input.missionId,
        timestamp,
        JSON.stringify({
          admin_name: input.adminName,
          reason: input.reason,
          restored_from_archive_id: input.archiveId,
          archive_correction_operation_id: input.operationId,
          resulting_status: 'finished',
          storage_state: 'live',
        }),
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
    const correctionRunner = vi.fn((input: Readonly<Record<string, unknown>>) => {
      // Simulate a stale empty journal directory left by an earlier completed
      // correction; no journal record remains to justify a global fence.
      mkdirSync(correctionJournalDirectory(String(input.databasePath)), { recursive: true })
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

  it('fences every live mutation until a committed correction worker has exited', async () => {
    const userDataPath = mkdtempSync(path.join(tmpdir(), 'sartracker-rehydrate-writer-fence-'))
    temporaryDirectories.add(userDataPath)
    let releaseWorkerExit: (() => void) | undefined
    const workerExited = new Promise<void>((resolve) => { releaseWorkerExit = resolve })
    const correctionRunner = vi.fn((input: Readonly<Record<string, unknown>>) => {
      const database = new Database(String(input.databasePath))
      const timestamp = '2026-09-03T12:00:00.000Z'
      database.prepare('UPDATE missions SET status = ? WHERE id = ?')
        .run('finished', input.missionId)
      database.prepare(`INSERT INTO mission_events (
        id, mission_id, event_type, timestamp, details_json, recorded_at, recording_completeness
      ) VALUES (?, ?, 'mission_unlocked', ?, ?, ?, 'complete')`).run(
        deriveArchiveLifecycleEventId(String(input.archiveId), 'mission-unlocked'),
        input.missionId,
        timestamp,
        JSON.stringify({
          admin_name: 'Duty Admin',
          reason: 'Fence live writes until correction worker exit.',
          resulting_status: 'finished',
          restored_from_archive_id: input.archiveId,
          archive_correction_operation_id: input.operationId,
          storage_state: 'live',
        }),
        timestamp,
      )
      database.close()
      const completion = Promise.reject(Object.assign(
        new Error('worker exited after correction commit'),
        { code: 'ARCHIVE_REHYDRATE_FAILED' },
      ))
      Object.defineProperty(completion, 'workerExited', { value: workerExited })
      return completion
    })
    const store = createElectronMissionStore({
      userDataPath,
      readAdminRoster: async () => ['Duty Admin'],
      startArchiveCorrectionWorker: correctionRunner,
    })
    const custody = {
      passphrase: 'Writer Fence Restore 2026!',
      recoveryCode: 'AB234-CD567-EF789-GH234-JK567-MN789-PR234-ST567',
    }
    try {
      const mission = await store.createMission({ name: 'Writer fence correction' })
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
        operationId: '26262626-2626-4626-8626-262626262626',
        reviewActivity: false,
        onProgress: () => undefined,
      })
      const correction = store.unlockFinalizedMission({
        mission_id: mission.id,
        archive_id: archiveId,
        snapshot_path: snapshotPath,
        ...snapshotProof(snapshotPath),
        admin_name: 'Duty Admin',
        reason: 'Fence live writes until correction worker exit.',
      })
      await vi.waitFor(() => expect(correctionRunner).toHaveBeenCalledOnce())
      await expect(store.upsertMarker({
        mission_id: mission.id,
        id: '55555555-5555-4555-8555-555555555555',
        type: 'clue',
        name: 'Blocked during correction',
        lat: 52.1,
        lon: -9.1,
        irish_grid_e: 480000,
        irish_grid_n: 580000,
        display_order: 0,
      })).rejects.toMatchObject({ code: 'ARCHIVE_REHYDRATE_LIVE_ACTIVITY' })
      await expect(store.recordIngestRejections({
        mission_id: mission.id,
        rejections: [],
      })).rejects.toMatchObject({ code: 'ARCHIVE_REHYDRATE_LIVE_ACTIVITY' })
      releaseWorkerExit?.()
      await expect(correction).rejects.toMatchObject({ code: 'ARCHIVE_REHYDRATE_CLEANUP_REQUIRED' })
    } finally {
      releaseWorkerExit?.()
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
