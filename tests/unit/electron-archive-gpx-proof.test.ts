import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'

import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')
const { assertGpxProofRecordBound, computeArchiveGpxContentProof } = require(
  '../../electron/archive-gpx-proof.cjs',
) as {
  readonly assertGpxProofRecordBound: (recordCount: number) => void
  readonly computeArchiveGpxContentProof: (
    db: BetterSqliteDatabase,
    missionId: string,
  ) => readonly Readonly<Record<string, unknown>>[]
}

type BetterSqliteDatabase = {
  readonly exec: (sql: string) => unknown
  readonly prepare: (sql: string) => {
    readonly run: (...parameters: readonly unknown[]) => unknown
  }
  readonly close: () => void
}

const databases: BetterSqliteDatabase[] = []

afterEach(() => {
  for (const db of databases) db.close()
  databases.length = 0
})

/** Creates only the authoritative GPX source-custody tables used by the proof. */
function createFixture() {
  const db = new Database(':memory:') as BetterSqliteDatabase
  databases.push(db)
  db.exec(`
    CREATE TABLE gpx_import_revisions (
      id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, import_id TEXT NOT NULL,
      revision_sequence INTEGER NOT NULL, source_revision_sequence INTEGER NOT NULL,
      content_sha256 TEXT, source_bytes_base64 TEXT, completeness TEXT NOT NULL,
      recorded_at TEXT NOT NULL
    );
    CREATE TABLE gpx_import_failures (
      id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, batch_id TEXT NOT NULL,
      content_sha256 TEXT, source_bytes_base64 TEXT, recorded_at TEXT NOT NULL
    );
    CREATE TABLE gpx_track_imports (
      id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, content_sha256 TEXT,
      source_bytes_base64 TEXT, revision_sequence INTEGER NOT NULL,
      imported_at TEXT NOT NULL
    );
  `)
  return db
}

/** Returns canonical retained-byte inputs for one tiny GPX document. */
function source(value: string) {
  const bytes = Buffer.from(value, 'utf8')
  return {
    sha256: createHash('sha256').update(bytes).digest('hex'),
    base64: bytes.toString('base64'),
  }
}

describe('archive GPX source-byte proof', () => {
  it('closes the record bound before projecting an oversized source-root set', () => {
    expect(() => assertGpxProofRecordBound(20_000)).not.toThrow()
    expect(() => assertGpxProofRecordBound(20_001)).toThrowError(
      expect.objectContaining({ code: 'ARCHIVE_GPX_PROOF_LIMIT' }),
    )
  })

  it('resolves presentation-only revisions to their immutable retained source revision', () => {
    const db = createFixture()
    const retained = source('<gpx>source</gpx>')
    db.prepare(`INSERT INTO gpx_import_revisions VALUES (
      'source-row', 'mission-a', 'import-a', 1, 1, ?, ?, 'complete', ?
    )`).run(retained.sha256, retained.base64, '2026-08-29T10:00:00.000Z')
    db.prepare(`INSERT INTO gpx_import_revisions VALUES (
      'presentation-row', 'mission-a', 'import-a', 2, 1, ?, NULL, 'complete', ?
    )`).run(retained.sha256, '2026-08-29T11:00:00.000Z')

    expect(computeArchiveGpxContentProof(db, 'mission-a')).toMatchObject({
      proof_version: 1,
      record_count: 1,
      exact_bytes_count: 1,
      records: [{
        kind: 'source_revision',
        import_id: 'import-a',
        source_revision_sequence: 1,
        completeness: 'complete',
        custody_class: 'exact_bytes',
        recorded_content_sha256: retained.sha256,
        observed_content_sha256: retained.sha256,
        decoded_size_bytes: Buffer.byteLength('<gpx>source</gpx>'),
      }],
    })
  })

  it('rejects changed bytes, missing complete sources and noncanonical base64', () => {
    const attacks = [
      { hash: '0'.repeat(64), base64: source('<gpx/>').base64 },
      { hash: source('<gpx/>').sha256, base64: null },
      { hash: source('<gpx/>').sha256, base64: `${source('<gpx/>').base64}!` },
    ]
    for (const [index, attack] of attacks.entries()) {
      const db = createFixture()
      db.prepare(`INSERT INTO gpx_import_revisions VALUES (
        ?, 'mission-a', 'import-a', 1, 1, ?, ?, 'complete', ?
      )`).run(
        `source-${index}`,
        attack.hash,
        attack.base64,
        '2026-08-29T10:00:00.000Z',
      )
      expect(() => computeArchiveGpxContentProof(db, 'mission-a')).toThrow()
      db.close()
      databases.splice(databases.indexOf(db), 1)
    }
  })

  it('records legacy and pre-read failure limitations without inventing retained bytes', () => {
    const db = createFixture()
    db.prepare(`INSERT INTO gpx_import_revisions VALUES (
      'legacy-row', 'mission-a', 'import-a', 1, 1, NULL, NULL, 'legacy_baseline', ?
    )`).run('2026-08-29T10:00:00.000Z')
    db.prepare(`INSERT INTO gpx_import_failures VALUES (
      'failure-row', 'mission-a', 'batch-a', NULL, NULL, ?
    )`).run('2026-08-29T10:01:00.000Z')

    expect(computeArchiveGpxContentProof(db, 'mission-a')).toMatchObject({
      proof_version: 1,
      record_count: 2,
      exact_bytes_count: 0,
      legacy_unavailable_count: 1,
      failure_unavailable_count: 1,
      records: [
        expect.objectContaining({
          kind: 'source_revision',
          custody_class: 'legacy_unavailable',
          recorded_content_sha256: null,
          observed_content_sha256: null,
        }),
        expect.objectContaining({
          kind: 'import_failure',
          custody_class: 'failure_unavailable',
          recorded_content_sha256: null,
          observed_content_sha256: null,
        }),
      ],
    })
  })
})
