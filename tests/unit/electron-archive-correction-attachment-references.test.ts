import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')
const { rewriteAttachmentReferences } = require('../../electron/archive-correction-attachment-references.cjs') as {
  rewriteAttachmentReferences: (db: unknown, missionId: string, references: ReadonlyMap<string, string>) => readonly Record<string, unknown>[]
}

/** Creates only the reference tables needed to verify atomic correction path relocation. */
function database() {
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE markers (id TEXT, mission_id TEXT, attachment_path TEXT);
    CREATE TABLE mission_object_versions (id TEXT, mission_id TEXT, object_type TEXT, state_json TEXT);
    CREATE TABLE mission_events (id TEXT, mission_id TEXT, event_type TEXT, details_json TEXT);`)
  db.prepare('INSERT INTO markers VALUES (?, ?, ?)').run('marker', 'mission', '/old/photo.jpg')
  db.prepare('INSERT INTO mission_events VALUES (?, ?, ?, ?)').run('event', 'mission', 'marker_attachment_ingested', JSON.stringify({
    attachment_path: '/old/photo.jpg', relative_path: 'missions/mission/attachments/photo.jpg', custody_version: 2, sha256: 'a'.repeat(64),
  }))
  return db
}

describe('correction attachment reference relocation', () => {
  it.each(['marker', 'marker_version', 'marker_attachment_ingested'])('rejects a missing %s reference and rolls back earlier relocations', (kind) => {
    const db = database()
    try {
      expect(() => db.transaction(() => rewriteAttachmentReferences(db, 'mission', new Map([
        ['marker\0marker', '/new/photo.jpg'], [`${kind}\0missing`, '/new/missing.jpg'],
      ])))()).toThrow(/reference/iu)
      expect(db.prepare('SELECT attachment_path FROM markers').get().attachment_path).toBe('/old/photo.jpg')
    } finally { db.close() }
  })

  it('returns exact old and new path fields for the immutable correction amendment', () => {
    const db = database()
    try {
      const amendments = db.transaction(() => rewriteAttachmentReferences(db, 'mission', new Map([
        ['marker_attachment_ingested\0event', '/new/restored.jpg'],
      ])))()
      expect(amendments).toEqual([{
        referenceKind: 'marker_attachment_ingested', referenceId: 'event',
        previous: { attachment_path: '/old/photo.jpg', relative_path: 'missions/mission/attachments/photo.jpg' },
        replacement: { attachment_path: '/new/restored.jpg', relative_path: 'missions/mission/attachments/restored.jpg' },
      }])
      expect(JSON.parse(db.prepare('SELECT details_json FROM mission_events').get().details_json).sha256).toBe('a'.repeat(64))
    } finally { db.close() }
  })
})
