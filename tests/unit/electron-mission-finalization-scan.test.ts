import { createRequire } from 'node:module'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { prepareLegacyFinalizationRead, readLegacyFinalizationRow } = require(
  '../../electron/mission-finalization-scan.cjs',
) as {
  prepareLegacyFinalizationRead: (db: Database.Database, missionId: string, options?: {
    signal?: AbortSignal; yieldToMain?: () => Promise<void>
  }) => Promise<void>
  readLegacyFinalizationRow: (db: Database.Database, missionId: string, required?: boolean) =>
    undefined | { id: string; event_rowid: number }
}

/** Creates an unindexed legacy event table, including unrelated mission history. */
function seed(db: Database.Database) {
  db.exec(`CREATE TABLE mission_events (id TEXT PRIMARY KEY, mission_id TEXT,
    event_type TEXT, details_json TEXT)`)
  const append = db.prepare('INSERT INTO mission_events VALUES (?, ?, ?, ?)')
  db.transaction(() => {
    for (let index = 0; index < 4_100; index += 1) {
      append.run(`e-${index}`, 'mission', 'position_recorded', '{}')
    }
  })()
}

describe('cooperative legacy finalization lookup [DON-252]', () => {
  it('finishes preparation during unrelated live writes using the existing mission evidence generation', async () => {
    const db = new Database(':memory:')
    try {
      seed(db)
      db.exec(`CREATE TABLE mission_replay_generations (mission_id TEXT PRIMARY KEY, generation INTEGER);
        INSERT INTO mission_replay_generations VALUES ('mission', 1), ('other', 1)`)
      let writes = 0
      await prepareLegacyFinalizationRead(db, 'mission', {
        yieldToMain: async () => {
          writes += 1
          db.prepare('INSERT INTO mission_events VALUES (?, ?, ?, ?)')
            .run(`live-${writes}`, 'other', 'position_recorded', '{}')
          db.exec("UPDATE mission_replay_generations SET generation = generation + 1 WHERE mission_id = 'other'")
        },
      })
      expect(writes).toBeGreaterThan(1)
      expect(readLegacyFinalizationRow(db, 'mission', true)).toBeUndefined()
    } finally { db.close() }
  })

  it('yields between bounded pages and caches a proven absence without a historical scan at admission', async () => {
    const db = new Database(':memory:')
    try {
      seed(db)
      let yields = 0
      await prepareLegacyFinalizationRead(db, 'mission', {
        yieldToMain: async () => { yields += 1 },
      })
      expect(yields).toBeGreaterThan(1)
      expect(readLegacyFinalizationRow(db, 'mission', true)).toBeUndefined()
      expect(() => readLegacyFinalizationRow(db, 'other', true)).toThrow(/changed|prepared/iu)
    } finally { db.close() }
  })

  it('preserves the newest matching legacy event across sparse rowid pages', async () => {
    const db = new Database(':memory:')
    try {
      seed(db)
      db.exec(`INSERT INTO mission_events (rowid, id, mission_id, event_type, details_json)
        VALUES (9000000000, 'newest', 'mission', 'mission_finalized', '{}'),
          (9000000001, 'foreign', 'other', 'mission_finalized', '{}')`)
      await prepareLegacyFinalizationRead(db, 'mission')
      expect(readLegacyFinalizationRow(db, 'mission', true)).toMatchObject({
        id: 'newest', event_rowid: 9_000_000_000,
      })
    } finally { db.close() }
  })

  it('rejects stale preparation after a same-connection write instead of authorizing from the cache', async () => {
    const db = new Database(':memory:')
    try {
      seed(db)
      await prepareLegacyFinalizationRead(db, 'mission')
      db.exec("INSERT INTO mission_events VALUES ('new', 'mission', 'mission_finalized', '{}')")
      expect(() => readLegacyFinalizationRow(db, 'mission', true)).toThrow(/changed/iu)
      await prepareLegacyFinalizationRead(db, 'mission')
      expect(readLegacyFinalizationRow(db, 'mission', true)?.id).toBe('new')
    } finally { db.close() }
  })

  it('rejects external commits both during preparation and before admission', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'finalization-scan-'))
    const db = new Database(path.join(root, 'mission.sqlite'))
    db.pragma('journal_mode = WAL')
    seed(db)
    const other = new Database(path.join(root, 'mission.sqlite'))
    try {
      let wrote = false
      await expect(prepareLegacyFinalizationRead(db, 'mission', {
        yieldToMain: async () => {
          if (!wrote) {
            other.exec("UPDATE mission_events SET details_json = '{\"changed\":true}' WHERE id = 'e-0'")
            wrote = true
          }
        },
      })).rejects.toThrow(/changed/iu)
      await prepareLegacyFinalizationRead(db, 'mission')
      other.exec("INSERT INTO mission_events VALUES ('new', 'mission', 'mission_finalized', '{}')")
      expect(() => db.transaction(() => readLegacyFinalizationRow(db, 'mission', true)).immediate())
        .toThrow(/changed/iu)
    } finally { other.close(); db.close(); rmSync(root, { recursive: true, force: true }) }
  })

  it('rejects target-mission evidence changes from another writer while allowing unrelated commits', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'finalization-generation-'))
    const db = new Database(path.join(root, 'mission.sqlite'))
    db.pragma('journal_mode = WAL')
    seed(db)
    db.exec(`CREATE TABLE mission_replay_generations (mission_id TEXT PRIMARY KEY, generation INTEGER);
      INSERT INTO mission_replay_generations VALUES ('mission', 1), ('other', 1)`)
    const other = new Database(path.join(root, 'mission.sqlite'))
    try {
      await prepareLegacyFinalizationRead(db, 'mission', {
        yieldToMain: async () => {
          other.exec("UPDATE mission_replay_generations SET generation = generation + 1 WHERE mission_id = 'other'")
        },
      })
      expect(readLegacyFinalizationRow(db, 'mission', true)).toBeUndefined()
      let wrote = false
      await expect(prepareLegacyFinalizationRead(db, 'mission', {
        yieldToMain: async () => {
          if (wrote) return
          other.transaction(() => {
            other.exec("INSERT INTO mission_events VALUES ('new', 'mission', 'mission_finalized', '{}')")
            other.exec("UPDATE mission_replay_generations SET generation = generation + 1 WHERE mission_id = 'mission'")
          }).immediate()
          wrote = true
        },
      })).rejects.toThrow(/changed/iu)
      await prepareLegacyFinalizationRead(db, 'mission')
      expect(readLegacyFinalizationRow(db, 'mission', true)?.id).toBe('new')
      other.exec("UPDATE mission_replay_generations SET generation = generation + 1 WHERE mission_id = 'other'")
      expect(db.transaction(() => readLegacyFinalizationRow(db, 'mission', true)).immediate()?.id)
        .toBe('new')
      other.exec("UPDATE mission_replay_generations SET generation = generation + 1 WHERE mission_id = 'mission'")
      expect(() => db.transaction(() => readLegacyFinalizationRow(db, 'mission', true)).immediate()).toThrow(/changed/iu)
    } finally { other.close(); db.close(); rmSync(root, { recursive: true, force: true }) }
  })

  it('cancels between pages without retaining a usable partial lookup', async () => {
    const db = new Database(':memory:')
    try {
      seed(db)
      const controller = new AbortController()
      await expect(prepareLegacyFinalizationRead(db, 'mission', {
        signal: controller.signal,
        yieldToMain: async () => { controller.abort() },
      })).rejects.toMatchObject({ name: 'AbortError' })
      expect(() => readLegacyFinalizationRow(db, 'mission', true)).toThrow()
    } finally { db.close() }
  })
})
