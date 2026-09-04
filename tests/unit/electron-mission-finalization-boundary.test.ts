import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'

import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')
const {
  deriveArchiveLifecycleEventId,
  readCurrentMissionFinalizationBoundary,
  readV2MissionFinalizationBoundaryByArchiveId,
} = require('../../electron/mission-finalization-boundary.cjs') as {
  readonly deriveArchiveLifecycleEventId: (archiveId: string, kind: string) => string
  readonly readCurrentMissionFinalizationBoundary: (
    db: BetterSqliteDatabase,
    input: { readonly missionId: string; readonly archiveId?: string },
  ) => null | {
    readonly archiveId: string
    readonly archiveKind: 'finalized' | 'finalized_recovery'
    readonly containerVersion: 1 | 2
    readonly eventId: string
    readonly eventRowid: number
    readonly finalizationArchiveId: string | null
    readonly cleanupMembershipGeneration: number | null
    readonly details: Readonly<Record<string, unknown>>
    readonly usedLegacyScan: boolean
  }
  readonly readV2MissionFinalizationBoundaryByArchiveId: (
    db: BetterSqliteDatabase,
    input: { readonly missionId: string; readonly archiveId: string },
  ) => null | {
    readonly archiveId: string
    readonly archiveKind: 'finalized'
    readonly containerVersion: 2
    readonly eventId: string
    readonly eventRowid: number
    readonly finalizationArchiveId: string
    readonly cleanupMembershipGeneration: number
    readonly details: Readonly<Record<string, unknown>>
    readonly usedLegacyScan: false
  }
}

/** Returns the complete immutable detail projection written for a v2 finalization. */
function v2FinalizationDetails(archiveId: string): Readonly<Record<string, unknown>> {
  return {
    archive_id: archiveId,
    archive_path: `/test-archives/${archiveId}.sararch`,
    archive_relative_path: `${archiveId}.sararch`,
    cleanup_membership_generation: 7,
    container_version: 2,
    resulting_status: 'finalized',
  }
}

type BetterSqliteDatabase = {
  readonly close: () => void
  readonly exec: (sql: string) => unknown
  readonly prepare: (sql: string) => {
    readonly get: (...parameters: readonly unknown[]) => Record<string, unknown> | undefined
    readonly run: (...parameters: readonly unknown[]) => { readonly changes: number }
  }
}

const databases: BetterSqliteDatabase[] = []

afterEach(() => {
  for (const db of databases.splice(0)) db.close()
})

/** Creates only the registry/event columns needed by the current-boundary reader. */
function createDatabase(): BetterSqliteDatabase {
  const db = new Database(':memory:') as BetterSqliteDatabase
  databases.push(db)
  db.exec(`
    CREATE TABLE mission_events (
      id TEXT PRIMARY KEY,
      mission_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      details_json TEXT
    );
    CREATE TABLE mission_archives (
      id TEXT PRIMARY KEY,
      mission_id TEXT NOT NULL,
      request_event_rowid INTEGER NOT NULL,
      protected_finalization_epoch INTEGER,
      archive_kind TEXT NOT NULL,
      container_version INTEGER NOT NULL,
      status TEXT NOT NULL
    );
    CREATE INDEX idx_mission_archives_custody
      ON mission_archives(mission_id, request_event_rowid DESC, id DESC);
  `)
  return db
}

describe('current mission finalization boundary [DON-253]', () => {
  it('resolves an archive-embedded v2 projection by deterministic event ID without a registry row', () => {
    const db = createDatabase()
    const missionId = randomUUID()
    const archiveId = randomUUID()
    const eventId = deriveArchiveLifecycleEventId(archiveId, 'mission-finalized')
    db.prepare(`INSERT INTO mission_events (id, mission_id, event_type, timestamp, details_json)
      VALUES (?, ?, 'mission_finalized', '2026-09-04T10:00:00.000Z', ?)`).run(
      eventId,
      missionId,
      JSON.stringify(v2FinalizationDetails(archiveId)),
    )

    expect(readV2MissionFinalizationBoundaryByArchiveId(db, { missionId, archiveId }))
      .toMatchObject({ archiveId, eventId, usedLegacyScan: false })

    db.prepare('UPDATE mission_events SET id = ? WHERE id = ?').run(randomUUID(), eventId)
    expect(readV2MissionFinalizationBoundaryByArchiveId(db, { missionId, archiveId })).toBeNull()
  })

  it('uses the deterministic v2 event ID and its primary-key index without scanning mission history', () => {
    const db = createDatabase()
    const missionId = randomUUID()
    const archiveId = randomUUID()
    const eventId = deriveArchiveLifecycleEventId(archiveId, 'mission-finalized')
    db.prepare(`INSERT INTO mission_events (id, mission_id, event_type, timestamp, details_json)
      VALUES (?, ?, 'mission_finalized', '2026-09-04T10:00:00.000Z', ?)`).run(
      eventId,
      missionId,
      JSON.stringify(v2FinalizationDetails(archiveId)),
    )
    const eventRowid = Number(db.prepare('SELECT rowid FROM mission_events WHERE id = ?')
      .get(eventId)?.rowid)
    db.prepare(`INSERT INTO mission_archives (
      id, mission_id, request_event_rowid, protected_finalization_epoch,
      archive_kind, container_version, status
    ) VALUES (?, ?, 1, NULL, 'finalized', 2, 'verified')`).run(archiveId, missionId)

    expect(readCurrentMissionFinalizationBoundary(db, { missionId, archiveId })).toEqual({
      archiveId,
      archiveKind: 'finalized',
      containerVersion: 2,
      eventId,
      eventRowid,
      finalizationArchiveId: archiveId,
      cleanupMembershipGeneration: 7,
      details: v2FinalizationDetails(archiveId),
      usedLegacyScan: false,
    })
    const plan = db.prepare(`EXPLAIN QUERY PLAN SELECT rowid, id, mission_id, event_type,
      details_json FROM mission_events WHERE id = ?`).get(eventId)
    expect(String(plan?.detail)).toContain('sqlite_autoindex_mission_events_1')
  })

  it('resolves a recovery archive through its exact protected rowid and rejects a superseded archive', () => {
    const db = createDatabase()
    const missionId = randomUUID()
    const originalArchiveId = randomUUID()
    const recoveryArchiveId = randomUUID()
    const finalizationEventId = deriveArchiveLifecycleEventId(
      originalArchiveId,
      'mission-finalized',
    )
    db.prepare(`INSERT INTO mission_events (id, mission_id, event_type, timestamp, details_json)
      VALUES (?, ?, 'mission_finalized', '2026-09-04T10:00:00.000Z', ?)`).run(
      finalizationEventId,
      missionId,
      JSON.stringify(v2FinalizationDetails(originalArchiveId)),
    )
    const finalizationRowid = Number(db.prepare('SELECT rowid FROM mission_events WHERE id = ?')
      .get(finalizationEventId)?.rowid)
    db.prepare(`INSERT INTO mission_archives (
      id, mission_id, request_event_rowid, protected_finalization_epoch,
      archive_kind, container_version, status
    ) VALUES (?, ?, 2, ?, 'finalized_recovery', 2, 'verified')`).run(
      recoveryArchiveId,
      missionId,
      finalizationRowid,
    )

    expect(readCurrentMissionFinalizationBoundary(db, {
      missionId,
      archiveId: recoveryArchiveId,
    })).toMatchObject({
      archiveId: recoveryArchiveId,
      archiveKind: 'finalized_recovery',
      containerVersion: 2,
      eventId: finalizationEventId,
      eventRowid: finalizationRowid,
      finalizationArchiveId: originalArchiveId,
      usedLegacyScan: false,
    })

    db.prepare("UPDATE mission_archives SET status = 'superseded' WHERE id = ?")
      .run(recoveryArchiveId)
    expect(readCurrentMissionFinalizationBoundary(db, {
      missionId,
      archiveId: recoveryArchiveId,
    })).toBeNull()
  })

  it('fails closed when deterministic v2 finalization evidence is absent or mismatched', () => {
    const db = createDatabase()
    const missionId = randomUUID()
    const archiveId = randomUUID()
    db.prepare(`INSERT INTO mission_archives (
      id, mission_id, request_event_rowid, protected_finalization_epoch,
      archive_kind, container_version, status
    ) VALUES (?, ?, 1, NULL, 'finalized', 2, 'verified')`).run(archiveId, missionId)

    expect(readCurrentMissionFinalizationBoundary(db, { missionId, archiveId })).toBeNull()
  })

  it.each([
    ['resulting status', { resulting_status: 'finished' }],
    ['container version', { container_version: 1 }],
    ['relative path', { archive_relative_path: 'different.sararch' }],
    ['archive identity', { archive_id: randomUUID() }],
    ['cleanup membership generation', { cleanup_membership_generation: -1 }],
    ['cleanup membership generation type', { cleanup_membership_generation: null }],
  ])('fails closed when a v2 finalization has a mismatched %s', (_label, replacement) => {
    const db = createDatabase()
    const missionId = randomUUID()
    const archiveId = randomUUID()
    const eventId = deriveArchiveLifecycleEventId(archiveId, 'mission-finalized')
    db.prepare(`INSERT INTO mission_events (id, mission_id, event_type, timestamp, details_json)
      VALUES (?, ?, 'mission_finalized', '2026-09-04T10:00:00.000Z', ?)`).run(
      eventId,
      missionId,
      JSON.stringify({ ...v2FinalizationDetails(archiveId), ...replacement }),
    )
    db.prepare(`INSERT INTO mission_archives (
      id, mission_id, request_event_rowid, protected_finalization_epoch,
      archive_kind, container_version, status
    ) VALUES (?, ?, 1, NULL, 'finalized', 2, 'verified')`).run(archiveId, missionId)

    expect(readCurrentMissionFinalizationBoundary(db, { missionId, archiveId })).toBeNull()
  })

  it('fails closed when a v2 finalization omits its cleanup membership generation', () => {
    const db = createDatabase()
    const missionId = randomUUID()
    const archiveId = randomUUID()
    const eventId = deriveArchiveLifecycleEventId(archiveId, 'mission-finalized')
    const details = { ...v2FinalizationDetails(archiveId) }
    delete details.cleanup_membership_generation
    db.prepare(`INSERT INTO mission_events (id, mission_id, event_type, timestamp, details_json)
      VALUES (?, ?, 'mission_finalized', '2026-09-04T10:00:00.000Z', ?)`).run(
      eventId,
      missionId,
      JSON.stringify(details),
    )
    db.prepare(`INSERT INTO mission_archives (
      id, mission_id, request_event_rowid, protected_finalization_epoch,
      archive_kind, container_version, status
    ) VALUES (?, ?, 1, NULL, 'finalized', 2, 'verified')`).run(archiveId, missionId)

    expect(readCurrentMissionFinalizationBoundary(db, { missionId, archiveId })).toBeNull()
  })

  it('fails closed when a v2 finalization row has a non-deterministic event identity', () => {
    const db = createDatabase()
    const missionId = randomUUID()
    const archiveId = randomUUID()
    db.prepare(`INSERT INTO mission_events (id, mission_id, event_type, timestamp, details_json)
      VALUES (?, ?, 'mission_finalized', '2026-09-04T10:00:00.000Z', ?)`).run(
      randomUUID(),
      missionId,
      JSON.stringify(v2FinalizationDetails(archiveId)),
    )
    db.prepare(`INSERT INTO mission_archives (
      id, mission_id, request_event_rowid, protected_finalization_epoch,
      archive_kind, container_version, status
    ) VALUES (?, ?, 1, NULL, 'finalized', 2, 'verified')`).run(archiveId, missionId)

    expect(readCurrentMissionFinalizationBoundary(db, { missionId, archiveId })).toBeNull()
  })

  it('uses an exact protected epoch for a legacy recovery without choosing a newer event', () => {
    const db = createDatabase()
    const missionId = randomUUID()
    const recoveryArchiveId = randomUUID()
    const protectedEventId = randomUUID()
    db.prepare(`INSERT INTO mission_events (id, mission_id, event_type, timestamp, details_json)
      VALUES (?, ?, 'mission_finalized', '2026-09-04T10:00:00.000Z', ?)`).run(
      protectedEventId,
      missionId,
      JSON.stringify({
        archive_path: '/test-archives/original.zip',
        resulting_status: 'finalized',
      }),
    )
    const protectedEpoch = Number(db.prepare('SELECT rowid FROM mission_events WHERE id = ?')
      .get(protectedEventId)?.rowid)
    db.prepare(`INSERT INTO mission_events (id, mission_id, event_type, timestamp, details_json)
      VALUES (?, ?, 'mission_finalized', '2026-09-04T11:00:00.000Z', ?)`).run(
      randomUUID(),
      missionId,
      JSON.stringify({
        archive_path: '/test-archives/unrelated-newer.zip',
        resulting_status: 'finalized',
      }),
    )
    db.prepare(`INSERT INTO mission_archives (
      id, mission_id, request_event_rowid, protected_finalization_epoch,
      archive_kind, container_version, status
    ) VALUES (?, ?, 3, ?, 'finalized_recovery', 1, 'sealed')`).run(
      recoveryArchiveId,
      missionId,
      protectedEpoch,
    )

    expect(readCurrentMissionFinalizationBoundary(db, {
      missionId,
      archiveId: recoveryArchiveId,
    })).toMatchObject({
      archiveId: recoveryArchiveId,
      archiveKind: 'finalized_recovery',
      containerVersion: 1,
      eventId: protectedEventId,
      eventRowid: protectedEpoch,
      finalizationArchiveId: null,
      cleanupMembershipGeneration: null,
      usedLegacyScan: false,
    })
  })

  it('pins the historical deterministic lifecycle ID vector', () => {
    expect(deriveArchiveLifecycleEventId(
      '11111111-1111-4111-8111-111111111111',
      'mission-finalized',
    )).toBe('78c99bba-eb5c-44a5-9b55-1d0d08cebbfd')
  })
})
