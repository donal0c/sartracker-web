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
  ) => 'live' | 'cleanup_in_progress' | 'archived'
}

/** Creates only the tables needed by the live/archive Review source gate. */
function createDatabase() {
  const database = new Database(':memory:')
  database.exec(`
    CREATE TABLE missions (id TEXT PRIMARY KEY);
    CREATE TABLE mission_cleanup_journal (
      mission_id TEXT PRIMARY KEY,
      state TEXT NOT NULL
    );
    INSERT INTO missions (id) VALUES ('mission-a');
  `)
  return database
}

describe('mission live Review access gate [DON-253]', () => {
  it('treats every completed cleanup as archived even when no custody linkage can be read', () => {
    const database = createDatabase()
    try {
      database.prepare(`INSERT INTO mission_cleanup_journal (mission_id, state)
        VALUES ('mission-a', 'completed')`).run()

      expect(readMissionLiveReviewStorageState(database, 'mission-a')).toBe('archived')
      expect(() => assertMissionLiveReviewAvailable(database, 'mission-a'))
        .toThrow(/archive/iu)
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
        .toThrow(/cleanup/iu)

      database.prepare("UPDATE mission_cleanup_journal SET state = 'unexpected'").run()
      expect(() => readMissionLiveReviewStorageState(database, 'mission-a'))
        .toThrow(/invalid/iu)
    } finally {
      database.close()
    }
  })
})
