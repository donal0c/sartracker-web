// @vitest-environment node
import { createRequire } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ARCHIVE_EVIDENCE_TABLES, compareArchiveDatabaseSnapshots } from '../../scripts/qualification/archive-field-oracle.mjs'
const Database = createRequire(import.meta.url)('better-sqlite3') as typeof import('better-sqlite3')

describe('independent streamed archive table custody', () => {
  it('permits only the explicit active-to-finished transition while preserving fixture rows', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'archive-finish-oracle-'))
    const beforePath = path.join(directory, 'before.sqlite')
    const afterPath = path.join(directory, 'after.sqlite')
    try {
      for (const filename of [beforePath, afterPath]) {
        const db = new Database(filename)
        for (const name of ARCHIVE_EVIDENCE_TABLES) {
          if (name === 'metadata') db.exec("CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT); INSERT INTO metadata VALUES ('schema_version','13')")
          else if (name === 'missions') db.exec("CREATE TABLE missions(id TEXT PRIMARY KEY,status TEXT,start_time TEXT,finish_time TEXT,pause_time TEXT,notes TEXT,paused_seconds INTEGER); INSERT INTO missions VALUES ('m','active','2026-01-01T00:00:00Z',NULL,NULL,'original',0)")
          else if (name === 'mission_events') db.exec('CREATE TABLE mission_events(id TEXT PRIMARY KEY,mission_id TEXT,event_type TEXT,timestamp TEXT,recorded_at TEXT,recording_completeness TEXT,details_json TEXT)')
          else db.exec(`CREATE TABLE "${name}"(id TEXT PRIMARY KEY,mission_id TEXT,event_type TEXT,payload TEXT)`)
        }
        db.exec("INSERT INTO positions VALUES ('p','m',NULL,'original')")
        if (filename === afterPath) {
          db.exec("UPDATE missions SET status='finished',finish_time='2026-01-02T00:00:00Z'")
          db.prepare('INSERT INTO mission_events VALUES (?,?,?,?,?,?,?)').run('f','m','mission_finished','2026-01-02T00:00:00Z','2026-01-02T00:00:00Z','complete',JSON.stringify({status:'finished'}))
        }
        db.close()
      }
      const options = { beforePath, afterPath, missionId: 'm', phase: 'source-to-finished' }
      expect((await compareArchiveDatabaseSnapshots(options)).extraEvents).toHaveLength(1)
      const paused = new Database(afterPath)
      paused.prepare('INSERT INTO mission_events VALUES (?,?,?,?,?,?,?)').run('p','m','mission_paused','2026-01-01T23:59:58Z','2026-01-01T23:59:58Z','complete',JSON.stringify({status:'paused'}))
      paused.exec('UPDATE missions SET paused_seconds=2')
      paused.close()
      expect((await compareArchiveDatabaseSnapshots(options)).extraEvents).toHaveLength(2)
      const wrongDuration = new Database(afterPath)
      wrongDuration.exec('UPDATE missions SET paused_seconds=3')
      wrongDuration.close()
      await expect(compareArchiveDatabaseSnapshots(options)).rejects.toThrow(/finish transition/)
      const repairedDuration = new Database(afterPath)
      repairedDuration.exec('UPDATE missions SET paused_seconds=2')
      repairedDuration.close()
      const changed = new Database(afterPath)
      changed.exec("UPDATE missions SET notes='changed'")
      changed.close()
      await expect(compareArchiveDatabaseSnapshots(options)).rejects.toThrow(/missions/)
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
  it('keeps the independently declared table inventory complete for the current schema', () => {
    const { ARCHIVE_TABLE_INVENTORY } = createRequire(import.meta.url)('../../electron/archive-inventory.cjs') as { ARCHIVE_TABLE_INVENTORY: Array<{ tableName: string; decision: string }> }
    expect([...ARCHIVE_EVIDENCE_TABLES]).toEqual(ARCHIVE_TABLE_INVENTORY.filter(row => ['mission_rows', 'global_rows'].includes(row.decision)).map(row => row.tableName))
  })
  it('compares all included tables and accepts only bounded new lifecycle events', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'archive-field-oracle-'))
    try {
      const beforePath = path.join(directory, 'before.sqlite')
      const afterPath = path.join(directory, 'after.sqlite')
      for (const filename of [beforePath, afterPath]) {
        const db = new Database(filename)
        for (const name of ARCHIVE_EVIDENCE_TABLES) {
          if (name === 'metadata') db.exec('CREATE TABLE metadata(key TEXT PRIMARY KEY, value TEXT); INSERT INTO metadata VALUES (\'schema_version\', \'13\')')
          else db.exec(`CREATE TABLE "${name}"(id TEXT PRIMARY KEY, mission_id TEXT, status TEXT, event_type TEXT, payload TEXT)`)
        }
        db.exec("INSERT INTO missions VALUES ('m','m','finished',NULL,'mission'); INSERT INTO positions VALUES ('p','m',NULL,NULL,'original'); INSERT INTO mission_events VALUES ('b','m',NULL,'mission_started','original')")
        db.close()
      }
      const restored = new Database(afterPath)
      restored.exec("INSERT INTO mission_events VALUES ('a','m',NULL,'mission_archive_requested','custody'); INSERT INTO mission_events VALUES ('c','m',NULL,'mission_unlocked','custody')")
      restored.close()
      const proof = await compareArchiveDatabaseSnapshots({ beforePath, afterPath, missionId: 'm' })
      expect(proof.tables).toHaveLength(30)
      expect(proof.extraEvents.map(row => row.eventType)).toEqual(['mission_archive_requested', 'mission_unlocked'])
      const mutated = new Database(afterPath)
      mutated.exec("UPDATE positions SET payload='changed' WHERE id='p'")
      mutated.close()
      await expect(compareArchiveDatabaseSnapshots({ beforePath, afterPath, missionId: 'm' })).rejects.toThrow(/positions/)
      const changed = new Database(afterPath)
      changed.exec("UPDATE positions SET payload='original'; UPDATE mission_events SET event_type='unexpected_write' WHERE id='a'")
      changed.close()
      await expect(compareArchiveDatabaseSnapshots({ beforePath, afterPath, missionId: 'm' })).rejects.toThrow(/lifecycle/)
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
})
