import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')
const { createElectronMissionStore } = require('../../electron/mission-store.cjs') as {
  readonly createElectronMissionStore: (input: { readonly userDataPath: string }) => {
    readonly close: () => void
  }
}
const {
  ARCHIVE_CLEANUP_MEMBERSHIP_TRACKED_TABLES,
  ARCHIVE_CLEANUP_MEMBERSHIP_TRIGGER_NAMES,
  ARCHIVE_CLEANUP_MEMBERSHIP_EVENT_TYPES,
  archiveCleanupMembershipBypassKey,
  archiveCleanupMembershipGenerationKey,
  assertArchiveCleanupMembershipGeneration,
  installArchiveCleanupMembershipTriggers,
  readArchiveCleanupMembershipGeneration,
  withArchiveCleanupMembershipBypass,
} = require('../../electron/archive-cleanup-membership.cjs') as {
  readonly ARCHIVE_CLEANUP_MEMBERSHIP_TRACKED_TABLES: readonly string[]
  readonly ARCHIVE_CLEANUP_MEMBERSHIP_TRIGGER_NAMES: readonly string[]
  readonly ARCHIVE_CLEANUP_MEMBERSHIP_EVENT_TYPES: readonly string[]
  readonly archiveCleanupMembershipBypassKey: (missionId: string) => string
  readonly archiveCleanupMembershipGenerationKey: (missionId: string) => string
  readonly assertArchiveCleanupMembershipGeneration: (
    db: typeof Database,
    input: { readonly missionId: string; readonly expectedGeneration: number },
  ) => number
  readonly installArchiveCleanupMembershipTriggers: (db: typeof Database, schemaVersion: 13) => void
  readonly readArchiveCleanupMembershipGeneration: (db: typeof Database, missionId: string) => number
  readonly withArchiveCleanupMembershipBypass: <T>(
    db: typeof Database,
    input: { readonly missionId: string; readonly archiveId: string },
    work: () => T,
  ) => T
}

const temporaryDirectories = new Set<string>()
const archiveId = '11111111-1111-4111-8111-111111111111'

afterEach(() => {
  for (const directory of temporaryDirectories) {
    rmSync(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 20 })
  }
  temporaryDirectories.clear()
})

/** Opens one migrated v13 store for trigger-level mutation tests. */
function createDatabase() {
  const userDataPath = mkdtempSync(path.join(tmpdir(), 'sartracker-cleanup-membership-'))
  temporaryDirectories.add(userDataPath)
  const store = createElectronMissionStore({ userDataPath })
  store.close()
  const db = new Database(path.join(userDataPath, 'mission-store.sqlite'))
  db.pragma('foreign_keys = OFF')
  db.prepare(`INSERT INTO missions (
    id, name, status, start_time, paused_seconds, schema_version
  ) VALUES (?, ?, 'active', ?, 0, 13)`).run(
    'mission-a',
    'Membership mission A',
    '2026-09-04T10:00:00.000Z',
  )
  db.prepare(`INSERT INTO missions (
    id, name, status, start_time, paused_seconds, schema_version
  ) VALUES (?, ?, 'active', ?, 0, 13)`).run(
    'mission-b',
    'Membership mission B',
    '2026-09-04T10:00:00.000Z',
  )
  return db
}

describe('archive cleanup membership generation', () => {
  it('installs persistent guards for every non-event cleanup table except replay generation', () => {
    const db = createDatabase()
    try {
      expect(ARCHIVE_CLEANUP_MEMBERSHIP_TRACKED_TABLES).toEqual([
        'coverage_chunks',
        'coverage_invalidations',
        'coverage_missions',
        'devices',
        'drawings',
        'gpx_evidence_points',
        'gpx_evidence_rejections',
        'gpx_import_aliases',
        'gpx_import_batches',
        'gpx_import_failures',
        'gpx_import_revisions',
        'gpx_import_source_receipts',
        'gpx_track_imports',
        'helicopters',
        'ingest_anomalies',
        'ingest_anomaly_deliveries',
        'ingest_anomaly_devices',
        'ingest_anomaly_mission_health',
        'layer_catalog_entries',
        'legacy_event_provenance_quarantine_missions',
        'markers',
        'mission_events',
        'mission_group_membership_events',
        'mission_object_versions',
        'mission_participants',
        'mission_replay_position_day_counts',
        'mission_teams',
        'outings',
        'participant_backfill_checkpoints',
        'position_revisions',
        'positions',
        'search_areas',
        'search_assignments',
        'search_pass_evidence_links',
        'search_passes',
        'tracking_history_checkpoints',
      ])
      expect(ARCHIVE_CLEANUP_MEMBERSHIP_TRACKED_TABLES).not.toContain('mission_replay_generations')
      expect(ARCHIVE_CLEANUP_MEMBERSHIP_EVENT_TYPES).toEqual([
        'device_updated',
        'mission_backup_synced',
        'position_recorded',
      ])
      expect(ARCHIVE_CLEANUP_MEMBERSHIP_TRIGGER_NAMES).toHaveLength(
        ARCHIVE_CLEANUP_MEMBERSHIP_TRACKED_TABLES.length * 3,
      )
      const installed = db.prepare(`SELECT name FROM sqlite_master
        WHERE type = 'trigger' AND name LIKE 'archive_cleanup_membership_%'
        ORDER BY name`).all().map((row: { readonly name: string }) => row.name)
      expect(installed).toEqual([...ARCHIVE_CLEANUP_MEMBERSHIP_TRIGGER_NAMES].sort())
    } finally {
      db.close()
    }
  })

  it('does not tax active-mission tracking writes before an archive can exist', () => {
    const db = createDatabase()
    try {
      db.prepare(`INSERT INTO devices (
        id, mission_id, device_id, name, color, status
      ) VALUES ('device-a', 'mission-a', 'tracker-a', 'Tracker A', '#38bdf8', 'online')`)
        .run()
      db.prepare(`INSERT INTO positions (
        id, mission_id, device_id, lat, lon, timestamp, data_origin,
        received_at, timestamp_source, timestamp_provenance_recorded_at
      ) VALUES (
        'position-a', 'mission-a', 'tracker-a', 52.1, -9.7,
        '2026-09-04T10:00:01.000Z', 'live', '2026-09-04T10:00:01.010Z',
        'fix', '2026-09-04T10:00:01.010Z'
      )`).run()

      expect(readArchiveCleanupMembershipGeneration(db, 'mission-a')).toBe(0)
    } finally {
      db.close()
    }
  })

  it('tracks only cleanup-removable telemetry events after a mission is finished', () => {
    const db = createDatabase()
    try {
      db.prepare(`INSERT INTO mission_events (
        id, mission_id, event_type, timestamp, details_json
      ) VALUES (
        'active-position-event', 'mission-a', 'position_recorded',
        '2026-09-04T10:00:02.000Z', '{}'
      )`).run()
      expect(readArchiveCleanupMembershipGeneration(db, 'mission-a')).toBe(0)

      db.prepare("UPDATE missions SET status = 'finished' WHERE id = 'mission-a'").run()
      db.prepare(`INSERT INTO mission_events (
        id, mission_id, event_type, timestamp, details_json
      ) VALUES (
        'late-device-event', 'mission-a', 'device_updated',
        '2026-09-04T10:00:03.000Z', '{}'
      )`).run()
      expect(readArchiveCleanupMembershipGeneration(db, 'mission-a')).toBe(1)
      db.prepare(`INSERT INTO mission_events (
        id, mission_id, event_type, timestamp, details_json
      ) VALUES (
        'retained-audit-event', 'mission-a', 'mission_finished',
        '2026-09-04T10:00:04.000Z', '{}'
      )`).run()
      expect(readArchiveCleanupMembershipGeneration(db, 'mission-a')).toBe(1)
      db.prepare(`UPDATE mission_events SET details_json = '{"updated":true}'
        WHERE id = 'late-device-event'`).run()
      expect(readArchiveCleanupMembershipGeneration(db, 'mission-a')).toBe(2)
      db.prepare("DELETE FROM mission_events WHERE id = 'late-device-event'").run()
      expect(readArchiveCleanupMembershipGeneration(db, 'mission-a')).toBe(3)
    } finally {
      db.close()
    }
  })

  it('advances on direct insert, update, and delete including coverage and referenced rows', () => {
    const db = createDatabase()
    try {
      db.prepare("UPDATE missions SET status = 'finished' WHERE id = 'mission-a'").run()
      expect(readArchiveCleanupMembershipGeneration(db, 'mission-a')).toBe(0)
      db.prepare(`INSERT INTO coverage_missions (
        mission_id, change_seq, enumerated, updated_at
      ) VALUES ('mission-a', 0, 0, '2026-09-04T10:01:00.000Z')`).run()
      expect(readArchiveCleanupMembershipGeneration(db, 'mission-a')).toBe(1)
      db.prepare(`UPDATE coverage_missions SET enumerated = 1
        WHERE mission_id = 'mission-a'`).run()
      expect(readArchiveCleanupMembershipGeneration(db, 'mission-a')).toBe(2)
      db.prepare("DELETE FROM coverage_missions WHERE mission_id = 'mission-a'").run()
      expect(readArchiveCleanupMembershipGeneration(db, 'mission-a')).toBe(3)

      db.prepare("UPDATE missions SET status = 'finalized' WHERE id = 'mission-a'").run()
      db.prepare(`INSERT INTO coverage_missions (
        mission_id, change_seq, enumerated, updated_at
      ) VALUES ('mission-a', 1, 1, '2026-09-04T10:01:30.000Z')`).run()
      expect(readArchiveCleanupMembershipGeneration(db, 'mission-a')).toBe(4)

      db.prepare(`INSERT INTO search_passes (
        id, mission_id, search_area_id, assignment_id, started_at, outcome,
        coordinator_name, version_sequence, created_at, updated_at
      ) VALUES (
        'pass-a', 'mission-a', 'area-a', 'assignment-a',
        '2026-09-04T10:02:00.000Z', 'full', 'Coordinator', 1,
        '2026-09-04T10:02:00.000Z', '2026-09-04T10:02:00.000Z'
      )`).run()
      const beforeReferencedInsert = readArchiveCleanupMembershipGeneration(db, 'mission-a')
      db.prepare(`INSERT INTO search_pass_evidence_links (
        pass_id, version_sequence, link_kind, target_id
      ) VALUES ('pass-a', 1, 'track', 'track-a')`).run()
      expect(readArchiveCleanupMembershipGeneration(db, 'mission-a'))
        .toBe(beforeReferencedInsert + 1)
      db.prepare(`UPDATE search_pass_evidence_links SET target_id = 'track-b'
        WHERE pass_id = 'pass-a'`).run()
      expect(readArchiveCleanupMembershipGeneration(db, 'mission-a'))
        .toBe(beforeReferencedInsert + 2)
      db.prepare("DELETE FROM search_pass_evidence_links WHERE pass_id = 'pass-a'").run()
      expect(readArchiveCleanupMembershipGeneration(db, 'mission-a'))
        .toBe(beforeReferencedInsert + 3)
    } finally {
      db.close()
    }
  })

  it('suppresses only one transaction-owned mission/archive cleanup and removes the bypass', () => {
    const db = createDatabase()
    try {
      db.prepare("UPDATE missions SET status = 'finished'").run()
      expect(() => withArchiveCleanupMembershipBypass(
        db,
        { missionId: 'mission-a', archiveId },
        () => undefined,
      )).toThrow(/transaction/iu)

      db.transaction(() => withArchiveCleanupMembershipBypass(
        db,
        { missionId: 'mission-a', archiveId },
        () => {
          db.prepare(`INSERT INTO coverage_missions (
            mission_id, change_seq, enumerated, updated_at
          ) VALUES ('mission-a', 0, 0, '2026-09-04T10:03:00.000Z')`).run()
          db.prepare(`INSERT INTO coverage_missions (
            mission_id, change_seq, enumerated, updated_at
          ) VALUES ('mission-b', 0, 0, '2026-09-04T10:03:00.000Z')`).run()
        },
      )).immediate()

      expect(readArchiveCleanupMembershipGeneration(db, 'mission-a')).toBe(0)
      expect(readArchiveCleanupMembershipGeneration(db, 'mission-b')).toBe(1)
      expect(db.prepare(`SELECT 1 FROM metadata
        WHERE key LIKE 'archive_cleanup_membership_bypass_v1:%'`).get()).toBeUndefined()
    } finally {
      db.close()
    }
  })

  it('keeps an external writer out while the transaction-scoped bypass exists', () => {
    const db = createDatabase()
    const external = new Database(db.name)
    try {
      db.prepare("UPDATE missions SET status = 'finalized' WHERE id = 'mission-a'").run()
      external.pragma('busy_timeout = 0')
      db.transaction(() => withArchiveCleanupMembershipBypass(
        db,
        { missionId: 'mission-a', archiveId },
        () => {
          expect(() => external.prepare(`INSERT INTO coverage_missions (
            mission_id, change_seq, enumerated, updated_at
          ) VALUES ('mission-a', 0, 0, '2026-09-04T10:03:30.000Z')`).run())
            .toThrow(/database is locked/iu)
        },
      )).immediate()

      expect(readArchiveCleanupMembershipGeneration(db, 'mission-a')).toBe(0)
      external.prepare(`INSERT INTO coverage_missions (
        mission_id, change_seq, enumerated, updated_at
      ) VALUES ('mission-a', 0, 0, '2026-09-04T10:03:31.000Z')`).run()
      expect(readArchiveCleanupMembershipGeneration(db, 'mission-a')).toBe(1)
    } finally {
      external.close()
      db.close()
    }
  })

  it('fails closed instead of repairing a corrupt generation during a direct write', () => {
    const db = createDatabase()
    try {
      db.prepare("UPDATE missions SET status = 'finished' WHERE id = 'mission-a'").run()
      const key = archiveCleanupMembershipGenerationKey('mission-a')
      db.prepare('INSERT INTO metadata (key, value) VALUES (?, ?)').run(key, 'not-a-number')
      expect(() => readArchiveCleanupMembershipGeneration(db, 'mission-a'))
        .toThrow(/generation.*corrupt/iu)
      expect(() => db.prepare(`INSERT INTO coverage_missions (
        mission_id, change_seq, enumerated, updated_at
      ) VALUES ('mission-a', 0, 0, '2026-09-04T10:04:00.000Z')`).run())
        .toThrow(/generation.*corrupt/iu)
      expect(db.prepare(`SELECT 1 FROM coverage_missions
        WHERE mission_id = 'mission-a'`).get()).toBeUndefined()
    } finally {
      db.close()
    }
  })

  it('rejects a stale or forged cleanup bypass before trusting the generation', () => {
    const db = createDatabase()
    try {
      db.prepare('INSERT INTO metadata (key, value) VALUES (?, ?)').run(
        archiveCleanupMembershipBypassKey('mission-a'),
        archiveId,
      )

      expect(() => assertArchiveCleanupMembershipGeneration(db, {
        missionId: 'mission-a',
        expectedGeneration: 0,
      })).toThrow(/bypass.*outside.*transaction|bypass.*corrupt/iu)
      expect(() => installArchiveCleanupMembershipTriggers(db, 13))
        .toThrow(/bypass.*outside.*transaction/iu)
    } finally {
      db.close()
    }
  })
})
