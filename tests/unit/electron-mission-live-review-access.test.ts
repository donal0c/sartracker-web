import { createRequire } from 'node:module'

import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')
const {
  assertMissionLiveReviewAvailable,
  readMissionLiveReviewStorageState,
} = require('../../electron/mission-live-review-access.cjs') as {
  readonly assertMissionLiveReviewAvailable: (database: unknown, missionId: string) => void
  readonly readMissionLiveReviewStorageState: (
    database: unknown,
    missionId: string,
  ) => 'live' | 'cleanup_in_progress' | 'archived' | 'recovery_required'
}

/** Creates only the tables needed by the live/archive Review source gate. */
function createDatabase() {
  const database = new Database(':memory:')
  database.exec(`
    CREATE TABLE missions (id TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'active');
    CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE mission_cleanup_journal (
      mission_id TEXT PRIMARY KEY,
      state TEXT NOT NULL
    );
    INSERT INTO missions (id, status) VALUES ('mission-a', 'active');
  `)
  return database
}

describe('mission live Review access gate [DON-253]', () => {
  it('fails closed when completed cleanup has no verifiable guard or audit custody', () => {
    const database = createDatabase()
    try {
      database.prepare("UPDATE missions SET status = 'finished' WHERE id = 'mission-a'").run()
      database.prepare(`INSERT INTO mission_cleanup_journal (mission_id, state)
        VALUES ('mission-a', 'completed')`).run()

      expect(readMissionLiveReviewStorageState(database, 'mission-a')).toBe('cleanup_in_progress')
      expect(() => assertMissionLiveReviewAvailable(database, 'mission-a'))
        .toThrow(/cleanup/iu)
    } finally {
      database.close()
    }
  })

  it('allows only absent or eligible cleanup state and fails closed for every other state', () => {
    const database = createDatabase()
    try {
      expect(readMissionLiveReviewStorageState(database, 'mission-a')).toBe('live')
      expect(() => assertMissionLiveReviewAvailable(database, 'mission-a')).not.toThrow()

      database.prepare(`INSERT INTO mission_cleanup_journal (mission_id, state)
        VALUES ('mission-a', 'eligible')`).run()
      expect(readMissionLiveReviewStorageState(database, 'mission-a')).toBe('live')

      database.prepare("UPDATE mission_cleanup_journal SET state = 'in_progress'").run()
      expect(readMissionLiveReviewStorageState(database, 'mission-a'))
        .toBe('cleanup_in_progress')
      expect(() => assertMissionLiveReviewAvailable(database, 'mission-a'))
        .toThrow(/Review Archive Cleanup/iu)
      try {
        assertMissionLiveReviewAvailable(database, 'mission-a')
      } catch (error) {
        expect(error).toMatchObject({ code: 'MISSION_REVIEW_CLEANUP_IN_PROGRESS' })
        expect(String((error as Error).message)).not.toMatch(/resume/iu)
      }

      database.prepare("UPDATE mission_cleanup_journal SET state = 'unexpected'").run()
      expect(() => readMissionLiveReviewStorageState(database, 'mission-a'))
        .toThrow(/invalid/iu)
    } finally {
      database.close()
    }
  })

  it('reports custody recovery as a dedicated blocker for finished missions', () => {
    const database = createDatabase()
    try {
      database.prepare("UPDATE missions SET status = 'finished' WHERE id = 'mission-a'").run()
      database.prepare(`INSERT INTO metadata (key, value)
        VALUES ('archive_correction_attachment_recovery_failure', 'pending')`).run()

      expect(readMissionLiveReviewStorageState(database, 'mission-a')).toBe('recovery_required')
      expect(() => assertMissionLiveReviewAvailable(database, 'mission-a'))
        .toThrow(/custody recovery/iu)
      try {
        assertMissionLiveReviewAvailable(database, 'mission-a')
      } catch (error) {
        expect(error).toMatchObject({ code: 'MISSION_REVIEW_CORRECTION_RECOVERY_REQUIRED' })
      }
    } finally {
      database.close()
    }
  })

  it('keeps active live Review available while finished-mission custody recovers', () => {
    const database = createDatabase()
    try {
      database.prepare(`INSERT INTO metadata (key, value)
        VALUES ('archive_correction_attachment_recovery_failure', 'pending')`).run()

      expect(readMissionLiveReviewStorageState(database, 'mission-a')).toBe('live')
      expect(() => assertMissionLiveReviewAvailable(database, 'mission-a')).not.toThrow()
    } finally {
      database.close()
    }
  })
})

describe('mission write fence statement reuse [DON-310]', () => {
  it('prepares each live-state statement once per database across repeated writes', () => {
    const database = createDatabase()
    try {
      const prepare = database.prepare.bind(database)
      const prepared: string[] = []
      database.prepare = (sql: string) => {
        prepared.push(sql)
        return prepare(sql)
      }

      for (let write = 0; write < 50; write += 1) {
        expect(readMissionLiveReviewStorageState(database, 'mission-a')).toBe('live')
      }

      expect(prepared.length).toBeGreaterThan(0)
      expect(new Set(prepared).size).toBe(prepared.length)
    } finally {
      database.close()
    }
  })

  it('still sees cleanup and recovery state written after a cached read', () => {
    const database = createDatabase()
    try {
      expect(readMissionLiveReviewStorageState(database, 'mission-a')).toBe('live')
      database.prepare(`INSERT INTO mission_cleanup_journal (mission_id, state)
        VALUES ('mission-a', 'in_progress')`).run()
      expect(readMissionLiveReviewStorageState(database, 'mission-a')).toBe('cleanup_in_progress')

      database.prepare("DELETE FROM mission_cleanup_journal").run()
      database.prepare("UPDATE missions SET status = 'finished' WHERE id = 'mission-a'").run()
      database.prepare(`INSERT INTO metadata (key, value)
        VALUES ('archive_correction_attachment_recovery_failure', '{}')`).run()
      expect(readMissionLiveReviewStorageState(database, 'mission-a')).toBe('recovery_required')
    } finally {
      database.close()
    }
  })

  it('still sees a schema change made after a cached read', () => {
    const database = new Database(':memory:')
    try {
      database.exec(`
        CREATE TABLE missions (id TEXT PRIMARY KEY);
        CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE mission_cleanup_journal (mission_id TEXT PRIMARY KEY, state TEXT NOT NULL);
        INSERT INTO missions (id) VALUES ('mission-a');
        INSERT INTO metadata (key, value)
          VALUES ('archive_correction_attachment_recovery_failure', '{}');
      `)
      // Without a status column the recovery marker cannot apply.
      expect(readMissionLiveReviewStorageState(database, 'mission-a')).toBe('live')
      database.exec("ALTER TABLE missions ADD COLUMN status TEXT NOT NULL DEFAULT 'finished'")
      expect(readMissionLiveReviewStorageState(database, 'mission-a')).toBe('recovery_required')
    } finally {
      database.close()
    }
  })
})
