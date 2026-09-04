import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')
const { createElectronMissionStore } = require('../../electron/mission-store.cjs') as {
  readonly createElectronMissionStore: (options: { readonly userDataPath: string }) => {
    readonly close: () => void
  }
}
const { createMissionArchiveScratch } = require('../../electron/archive-scratch.cjs') as {
  readonly createMissionArchiveScratch: (input: {
    readonly sourceDatabasePath: string
    readonly scratchDatabasePath: string
    readonly missionId: string
    readonly archiveId: string
    readonly operationId: string
    readonly archiveKind: 'finalized' | 'finalized_recovery'
    readonly requestEventRowid: number
    readonly protectedFinalizationEpoch: number | null
    readonly fenceRequestedAt: string
    readonly requestEventId: string
    readonly schemaVersion: 13
    readonly inventoryVersion: 1
    readonly finalizationProjection?: Readonly<Record<string, unknown>>
    readonly onProgress?: (input: Readonly<Record<string, unknown>>) => void
    readonly isCancelled?: () => boolean
  }) => Readonly<Record<string, unknown>>
}
const {
  ARCHIVE_CLEANUP_MEMBERSHIP_TRIGGER_NAMES,
  readArchiveCleanupMembershipGeneration,
} = require('../../electron/archive-cleanup-membership.cjs') as {
  readonly ARCHIVE_CLEANUP_MEMBERSHIP_TRIGGER_NAMES: readonly string[]
  readonly readArchiveCleanupMembershipGeneration: (db: typeof Database, missionId: string) => number
}

const operationId = '11111111-1111-4111-8111-111111111111'
const archiveId = '22222222-2222-4222-8222-222222222222'
const requestEventId = '33333333-3333-4333-8333-333333333333'
const fenceRequestedAt = '2026-08-29T18:59:59.000Z'
const temporaryDirectories = new Set<string>()

afterEach(() => {
  for (const directory of temporaryDirectories) {
    rmSync(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 })
  }
  temporaryDirectories.clear()
})

/** Creates a two-mission v13 source with one exact archive-request epoch. */
function createTwoMissionSource() {
  const userDataPath = mkdtempSync(path.join(tmpdir(), 'sartracker-archive-scratch-'))
  temporaryDirectories.add(userDataPath)
  const store = createElectronMissionStore({ userDataPath })
  store.close()
  const sourceDatabasePath = path.join(userDataPath, 'mission-store.sqlite')
  const db = new Database(sourceDatabasePath)
  db.exec('PRAGMA foreign_keys = ON')
  const insertMission = db.prepare(`INSERT INTO missions (
    id, name, status, start_time, finish_time, paused_seconds, schema_version
  ) VALUES (?, ?, 'finished', ?, ?, 0, 13)`)
  insertMission.run(
    'mission-a', 'Mission A', '2026-08-29T10:00:00.000Z', '2026-08-29T12:00:00.000Z',
  )
  insertMission.run(
    'mission-b', 'Mission B', '2026-08-29T11:00:00.000Z', '2026-08-29T13:00:00.000Z',
  )
  const insertDevice = db.prepare(`INSERT INTO devices (
    id, mission_id, device_id, name, color, status
  ) VALUES (?, ?, ?, ?, '#38bdf8', 'offline')`)
  insertDevice.run('device-row-a', 'mission-a', 'device-a', 'Device A')
  insertDevice.run('device-row-b', 'mission-b', 'device-b', 'Device B')
  const insertPosition = db.prepare(`INSERT INTO positions (
    id, mission_id, device_id, lat, lon, timestamp, data_origin,
    received_at, timestamp_source, timestamp_provenance_recorded_at
  ) VALUES (?, ?, ?, 52.1, -9.7, ?, 'live', ?, 'fix', ?)`)
  insertPosition.run(
    'position-a', 'mission-a', 'device-a', '2026-08-29T10:01:00.000Z',
    '2026-08-29T10:01:01.000Z', '2026-08-29T10:01:01.000Z',
  )
  insertPosition.run(
    'position-b', 'mission-b', 'device-b', '2026-08-29T11:01:00.000Z',
    '2026-08-29T11:01:01.000Z', '2026-08-29T11:01:01.000Z',
  )
  const cleanupMembershipGeneration = readArchiveCleanupMembershipGeneration(db, 'mission-a')
  db.prepare(`INSERT INTO mission_events (
    rowid, id, mission_id, event_type, timestamp, details_json,
    recorded_at, recording_completeness
  ) VALUES (?, ?, ?, ?, ?, ?, ?, 'complete')`).run(
    42,
    requestEventId,
    'mission-a',
    'mission_finalize_requested',
    fenceRequestedAt,
    JSON.stringify({
      resulting_status: 'finished',
      archive_id: archiveId,
      operation_id: operationId,
      archive_kind: 'finalized',
      archive_relative_path: `${archiveId}.sararch`,
      cleanup_membership_generation: cleanupMembershipGeneration,
      protected_finalization_epoch: null,
    }),
    fenceRequestedAt,
  )
  db.prepare(`INSERT INTO mission_events (
    rowid, id, mission_id, event_type, timestamp, details_json,
    recorded_at, recording_completeness
  ) VALUES (43, '44444444-4444-4444-8444-444444444444', 'mission-b',
    'mission_finished', '2026-08-29T13:00:00.000Z', '{}',
    '2026-08-29T13:00:00.000Z', 'complete')`).run()
  db.prepare(`INSERT INTO mission_finalization_fences (mission_id, requested_at)
    VALUES ('mission-a', ?)`).run(fenceRequestedAt)
  db.close()
  return { userDataPath, sourceDatabasePath }
}

/** Returns the one valid extraction input for the fixture. */
function extractionInput(sourceDatabasePath: string, overrides: Readonly<Record<string, unknown>> = {}) {
  const operationDirectory = path.join(path.dirname(sourceDatabasePath), 'archives', '.staging', operationId)
  return {
    sourceDatabasePath,
    scratchDatabasePath: path.join(operationDirectory, 'plaintext', 'mission-store.sqlite'),
    missionId: 'mission-a',
    archiveId,
    operationId,
    archiveKind: 'finalized' as const,
    requestEventRowid: 42,
    protectedFinalizationEpoch: null,
    fenceRequestedAt,
    requestEventId,
    schemaVersion: 13 as const,
    inventoryVersion: 1 as const,
    ...overrides,
  }
}

describe('mission-scoped archive scratch extraction', () => {
  it('copies exactly one pinned mission, preserves rowids, and proves all 49 tables', () => {
    const fixture = createTwoMissionSource()
    const live = new Database(fixture.sourceDatabasePath)
    live.prepare('INSERT INTO metadata (key, value) VALUES (?, ?)').run(
      'archive_custody_active_operation',
      JSON.stringify({ state: 'building', operationId }),
    )
    live.prepare('INSERT INTO metadata (key, value) VALUES (?, ?)').run(
      `archive_custody_operation:${operationId}`,
      JSON.stringify({ state: 'registered', operationId }),
    )
    live.close()
    const input = extractionInput(fixture.sourceDatabasePath)
    const progress: Readonly<Record<string, unknown>>[] = []

    const result = createMissionArchiveScratch({
      ...input,
      onProgress: (entry) => progress.push(entry),
    }) as {
      readonly tableProofs: readonly {
        readonly tableName: string
        readonly rowCount: number
        readonly contentSha256: string
        readonly sourceMatched: boolean
      }[]
      readonly schemaLedger: {
        readonly tableCount: number
        readonly indexCount: number
        readonly triggerCount: number
        readonly sha256: string
      }
    }

    expect(result.tableProofs).toHaveLength(49)
    expect(result.tableProofs.every((proof) => proof.contentSha256.match(/^[a-f0-9]{64}$/u)))
      .toBe(true)
    expect(result.tableProofs.filter((proof) => proof.sourceMatched === false)).toEqual([])
    expect(result.schemaLedger).toMatchObject({
      tableCount: 49,
      indexCount: 28,
      triggerCount: ARCHIVE_CLEANUP_MEMBERSHIP_TRIGGER_NAMES.length + 3,
    })
    expect(result.schemaLedger.sha256).toMatch(/^[a-f0-9]{64}$/u)
    expect(progress.length).toBeGreaterThan(0)

    const scratch = new Database(input.scratchDatabasePath, { readonly: true })
    try {
      expect(scratch.prepare('SELECT id FROM missions').all()).toEqual([{ id: 'mission-a' }])
      expect(scratch.prepare('SELECT id FROM positions').all()).toEqual([{ id: 'position-a' }])
      expect(scratch.prepare(`SELECT rowid AS event_rowid, id FROM mission_events
        WHERE id = ?`).get(requestEventId)).toEqual({ event_rowid: 42, id: requestEventId })
      expect(scratch.prepare(`SELECT mission_id, device_id, known_day, position_count
        FROM mission_replay_position_day_counts`).all()).toEqual([{
        mission_id: 'mission-a',
        device_id: 'device-a',
        known_day: '2026-08-29',
        position_count: 1,
      }])
      expect(scratch.prepare('SELECT COUNT(*) AS count FROM mission_archives').get().count).toBe(0)
      expect(scratch.prepare('SELECT key, value FROM metadata ORDER BY key').all()).toEqual([{
        key: 'schema_version',
        value: '13',
      }])
      expect(scratch.prepare('PRAGMA foreign_key_check').all()).toEqual([])
      expect(scratch.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' })
    } finally {
      scratch.close()
    }

    const source = new Database(fixture.sourceDatabasePath, { readonly: true })
    try {
      expect(source.prepare('SELECT COUNT(*) AS count FROM missions').get().count).toBe(2)
      expect(source.prepare('SELECT COUNT(*) AS count FROM positions').get().count).toBe(2)
    } finally {
      source.close()
    }
  })

  it('fails closed on a substituted epoch and removes the operation-owned scratch file', () => {
    const fixture = createTwoMissionSource()
    const input = extractionInput(fixture.sourceDatabasePath, { requestEventRowid: 43 })

    expect(() => createMissionArchiveScratch(input as never)).toThrow(/request identity/iu)
    expect(() => new Database(input.scratchDatabasePath, {
      readonly: true,
      fileMustExist: true,
    })).toThrow()
  })

  it('fails closed when cleanup membership changes after the immutable request event', () => {
    const fixture = createTwoMissionSource()
    const live = new Database(fixture.sourceDatabasePath)
    live.prepare(`INSERT INTO coverage_missions (
      mission_id, change_seq, enumerated, updated_at
    ) VALUES ('mission-a', 0, 0, '2026-08-29T19:01:00.000Z')`).run()
    live.close()
    const input = extractionInput(fixture.sourceDatabasePath)

    expect(() => createMissionArchiveScratch(input as never))
      .toThrow(/cleanup membership changed/iu)
    expect(() => new Database(input.scratchDatabasePath, {
      readonly: true,
      fileMustExist: true,
    })).toThrow()
  })

  it('binds the captured cleanup generation into the archived finalization projection', () => {
    const fixture = createTwoMissionSource()
    const source = new Database(fixture.sourceDatabasePath, { readonly: true })
    const cleanupMembershipGeneration = readArchiveCleanupMembershipGeneration(
      source,
      'mission-a',
    )
    source.close()
    const finalizationEventId = '55555555-5555-4555-8555-555555555555'
    const input = extractionInput(fixture.sourceDatabasePath, {
      finalizationProjection: {
        eventId: finalizationEventId,
        timestamp: fenceRequestedAt,
        recordedAt: fenceRequestedAt,
        archivePath: path.join(
          path.dirname(fixture.sourceDatabasePath),
          'archives',
          `${archiveId}.sararch`,
        ),
        archiveRelativePath: `${archiveId}.sararch`,
        cleanupMembershipGeneration,
        supplement: null,
      },
    })

    createMissionArchiveScratch(input as never)

    const scratch = new Database(input.scratchDatabasePath, { readonly: true })
    try {
      const finalized = scratch.prepare(`SELECT details_json FROM mission_events
        WHERE id = ?`).get(finalizationEventId)
      expect(JSON.parse(String(finalized.details_json))).toMatchObject({
        archive_id: archiveId,
        cleanup_membership_generation: cleanupMembershipGeneration,
        container_version: 2,
        resulting_status: 'finalized',
      })
    } finally {
      scratch.close()
    }
  })

  it('keeps a recovery request row separate from its current protected finalization epoch', () => {
    const fixture = createTwoMissionSource()
    const recoveryRequestEventId = '55555555-5555-4555-8555-555555555555'
    const recoveryRequestedAt = '2026-08-29T19:10:00.000Z'
    let source = new Database(fixture.sourceDatabasePath)
    source.prepare('DELETE FROM mission_events WHERE id = ?').run(requestEventId)
    source.prepare("UPDATE missions SET status = 'finalized' WHERE id = 'mission-a'").run()
    source.prepare(`INSERT INTO mission_events (
      rowid, id, mission_id, event_type, timestamp, details_json,
      recorded_at, recording_completeness
    ) VALUES (5, '45454545-4545-4545-8545-454545454545', 'mission-a',
      'mission_finalized', '2026-08-29T19:05:00.000Z', ?,
      '2026-08-29T19:05:00.000Z', 'complete')`).run(JSON.stringify({
      resulting_status: 'finalized',
    }))
    source.prepare(`INSERT INTO mission_events (
      rowid, id, mission_id, event_type, timestamp, details_json,
      recorded_at, recording_completeness
    ) VALUES (6, ?, 'mission-a', 'mission_archive_requested', ?, ?, ?, 'complete')`).run(
      recoveryRequestEventId,
      recoveryRequestedAt,
      JSON.stringify({
        resulting_status: 'finalized',
        archive_id: archiveId,
        operation_id: operationId,
        archive_kind: 'finalized_recovery',
        archive_relative_path: `${archiveId}.sararch`,
        cleanup_membership_generation: readArchiveCleanupMembershipGeneration(
          source,
          'mission-a',
        ),
        protected_finalization_epoch: 5,
      }),
      recoveryRequestedAt,
    )
    source.prepare(`UPDATE mission_finalization_fences SET requested_at = ?
      WHERE mission_id = 'mission-a'`).run(recoveryRequestedAt)
    source.close()

    const valid = extractionInput(fixture.sourceDatabasePath, {
      archiveKind: 'finalized_recovery',
      requestEventRowid: 6,
      requestEventId: recoveryRequestEventId,
      fenceRequestedAt: recoveryRequestedAt,
      protectedFinalizationEpoch: 5,
    })
    expect(createMissionArchiveScratch(valid as never)).toMatchObject({
      mission: expect.objectContaining({ status: 'finalized' }),
    })

    rmSync(path.dirname(path.dirname(valid.scratchDatabasePath)), {
      recursive: true,
      force: true,
    })
    source = new Database(fixture.sourceDatabasePath)
    source.prepare('UPDATE mission_events SET details_json = ? WHERE id = ?').run(
      JSON.stringify({
        resulting_status: 'finalized',
        archive_id: archiveId,
        operation_id: operationId,
        archive_kind: 'finalized_recovery',
        archive_relative_path: `${archiveId}.sararch`,
        cleanup_membership_generation: readArchiveCleanupMembershipGeneration(source, 'mission-a'),
        protected_finalization_epoch: 6,
      }),
      recoveryRequestEventId,
    )
    source.close()
    expect(() => createMissionArchiveScratch({
      ...valid,
      protectedFinalizationEpoch: 6,
    } as never)).toThrow(/protected finalization epoch is not current/iu)
  })

  it('installs canonical replay objects absent from a historically upgraded v13 source', () => {
    const fixture = createTwoMissionSource()
    const legacy = new Database(fixture.sourceDatabasePath)
    legacy.exec(`
      DROP INDEX idx_mission_events_replay;
      DROP INDEX idx_positions_replay_known_fix;
      DROP INDEX idx_positions_replay_unknown_time;
      DROP INDEX idx_positions_replay_known_at;
      DROP INDEX idx_positions_replay_device_known_at;
      DROP TRIGGER positions_replay_day_count_insert;
      DROP TRIGGER positions_replay_day_count_update;
      DROP TRIGGER positions_replay_day_count_delete;
    `)
    legacy.close()
    const input = extractionInput(fixture.sourceDatabasePath)

    createMissionArchiveScratch(input)

    const scratch = new Database(input.scratchDatabasePath, { readonly: true })
    try {
      expect(scratch.prepare(`SELECT COUNT(*) AS count FROM sqlite_master
        WHERE type = 'index' AND name NOT LIKE 'sqlite_%'`).get().count).toBe(28)
      expect(scratch.prepare(`SELECT COUNT(*) AS count FROM sqlite_master
        WHERE type = 'trigger'`).get().count)
        .toBe(ARCHIVE_CLEANUP_MEMBERSHIP_TRIGGER_NAMES.length + 3)
    } finally {
      scratch.close()
    }
  })
})
