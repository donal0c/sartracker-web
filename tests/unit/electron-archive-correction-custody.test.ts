import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'

import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3') as new (databasePath: string) => TestDatabase
const {
  correctionJournalDirectory,
  recoverCorrectionAttachmentJournals,
  writeCorrectionAttachmentJournal,
} = require('../../electron/archive-correction-custody.cjs') as {
  readonly correctionJournalDirectory: (databasePath: string) => string
  readonly recoverCorrectionAttachmentJournals: (input: {
    readonly databasePath: string
    readonly db: TestDatabase
  }) => { readonly recovered: number }
  readonly writeCorrectionAttachmentJournal: (input: {
    readonly databasePath: string
    readonly missionId: string
    readonly archiveId: string
    readonly operationId: string
    readonly targetRoot: string
    readonly entries: readonly Readonly<Record<string, unknown>>[]
  }) => Promise<string>
}

type TestDatabase = {
  readonly exec: (sql: string) => void
  readonly prepare: (sql: string) => {
    readonly run: (...parameters: readonly unknown[]) => unknown
    readonly get: (...parameters: readonly unknown[]) => Readonly<Record<string, unknown>> | undefined
    readonly all: (...parameters: readonly unknown[]) => readonly Readonly<Record<string, unknown>>[]
  }
  readonly close: () => void
}

const MISSION_ID = '11111111-1111-4111-8111-111111111111'
const ARCHIVE_ID = '22222222-2222-4222-8222-222222222222'
const OPERATION_ID = '33333333-3333-4333-8333-333333333333'
const roots = new Set<string>()

afterEach(async () => {
  await Promise.all([...roots].map((root) => rm(root, { recursive: true, force: true })))
  roots.clear()
})

async function createFixture(status: string, cleanupState: string | null) {
  const root = await mkdtemp(path.join(tmpdir(), 'sartracker-correction-custody-'))
  roots.add(root)
  const databasePath = path.join(root, 'mission-store.sqlite')
  const targetRoot = path.join(root, 'missions', MISSION_ID, 'attachments')
  await mkdir(targetRoot, { recursive: true })
  const db = new Database(databasePath)
  db.exec(`CREATE TABLE missions (id TEXT PRIMARY KEY, status TEXT NOT NULL);
    CREATE TABLE mission_cleanup_journal (mission_id TEXT PRIMARY KEY, state TEXT NOT NULL);
    CREATE TABLE mission_events (mission_id TEXT NOT NULL, event_type TEXT NOT NULL, details_json TEXT);`)
  db.prepare('INSERT INTO missions (id, status) VALUES (?, ?)').run(MISSION_ID, status)
  if (cleanupState !== null) {
    db.prepare('INSERT INTO mission_cleanup_journal (mission_id, state) VALUES (?, ?)')
      .run(MISSION_ID, cleanupState)
  }
  if (status === 'finished') {
    db.prepare('INSERT INTO mission_events (mission_id, event_type, details_json) VALUES (?, ?, ?)')
      .run(MISSION_ID, 'mission_unlocked', JSON.stringify({
        restored_from_archive_id: ARCHIVE_ID,
        archive_correction_operation_id: OPERATION_ID,
      }))
  }
  const journalPath = await writeCorrectionAttachmentJournal({
    databasePath,
    missionId: MISSION_ID,
    archiveId: ARCHIVE_ID,
    operationId: OPERATION_ID,
    targetRoot,
    entries: [{
      sourceRelativePath: 'field.jpg',
      targetPath: path.join(targetRoot, 'field.jpg'),
      preexisting: false,
      sizeBytes: Buffer.byteLength('committed'),
      sha256: createHash('sha256').update('committed').digest('hex'),
    }],
  })
  return { root, databasePath, targetRoot, db, journalPath }
}

describe('archive correction attachment custody recovery', () => {
  it('removes uncommitted canonical and temporary attachment residue on restart', async () => {
    const fixture = await createFixture('finalized', 'completed')
    await writeFile(path.join(fixture.targetRoot, 'field.jpg'), 'orphan', { mode: 0o600 })
    await writeFile(path.join(fixture.targetRoot, '.field.jpg.restore-crash'), 'orphan', { mode: 0o600 })

    expect(recoverCorrectionAttachmentJournals({
      databasePath: fixture.databasePath,
      db: fixture.db,
    })).toEqual({ recovered: 1 })
    await expect(readFile(path.join(fixture.targetRoot, 'field.jpg'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(path.join(fixture.targetRoot, '.field.jpg.restore-crash')))
      .rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(fixture.journalPath)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(correctionJournalDirectory(fixture.databasePath)).not.toBe(fixture.targetRoot)
    fixture.db.close()
  })

  it('preserves canonical bytes when the correction transaction already committed', async () => {
    const fixture = await createFixture('finished', 'completed')
    await writeFile(path.join(fixture.targetRoot, 'field.jpg'), 'committed', { mode: 0o600 })

    expect(recoverCorrectionAttachmentJournals({
      databasePath: fixture.databasePath,
      db: fixture.db,
    })).toEqual({ recovered: 1 })
    await expect(readFile(path.join(fixture.targetRoot, 'field.jpg'), 'utf8'))
      .resolves.toBe('committed')
    await expect(readFile(fixture.journalPath)).rejects.toMatchObject({ code: 'ENOENT' })
    fixture.db.close()
  })

  it('preserves committed correction bytes after a later refinalization', async () => {
    const fixture = await createFixture('finished', 'completed')
    await writeFile(path.join(fixture.targetRoot, 'field.jpg'), 'committed', { mode: 0o600 })
    fixture.db.prepare('UPDATE missions SET status = ? WHERE id = ?').run('finalized', MISSION_ID)

    expect(recoverCorrectionAttachmentJournals({
      databasePath: fixture.databasePath,
      db: fixture.db,
    })).toEqual({ recovered: 1 })
    await expect(readFile(path.join(fixture.targetRoot, 'field.jpg'), 'utf8'))
      .resolves.toBe('committed')
    fixture.db.close()
  })

  it('retains a committed journal when its canonical attachment root is missing', async () => {
    const fixture = await createFixture('finished', 'completed')
    await rm(fixture.targetRoot, { recursive: true, force: true })

    expect(() => recoverCorrectionAttachmentJournals({
      databasePath: fixture.databasePath,
      db: fixture.db,
    })).toThrow(/canonical root/iu)
    await expect(readFile(fixture.journalPath)).resolves.toBeTruthy()
    fixture.db.close()
  })

  it('discards only an incomplete temporary journal publish on restart', async () => {
    const fixture = await createFixture('finished', 'completed')
    await writeFile(path.join(fixture.targetRoot, 'field.jpg'), 'committed', { mode: 0o600 })
    const temporaryJournalPath = `${fixture.journalPath}.tmp`
    await copyFile(fixture.journalPath, temporaryJournalPath)

    expect(recoverCorrectionAttachmentJournals({
      databasePath: fixture.databasePath,
      db: fixture.db,
    })).toEqual({ recovered: 2 })
    await expect(readFile(temporaryJournalPath)).rejects.toMatchObject({ code: 'ENOENT' })
    fixture.db.close()
  })
})
