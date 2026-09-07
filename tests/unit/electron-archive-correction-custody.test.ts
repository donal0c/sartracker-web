import { createRequire } from 'node:module'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3') as new (databasePath: string) => TestDatabase
const { deriveArchiveLifecycleEventId } = require(
  '../../electron/mission-finalization-boundary.cjs',
) as {
  readonly deriveArchiveLifecycleEventId: (archiveId: string, kind: string) => string
}
const {
  createCorrectionAttachmentCustodyPlan,
  hasCorrectionAttachmentCustody,
  prepareCorrectionAttachmentCustodyReconciliation,
  readCorrectionAttachmentCustody,
  reconcileCorrectionAttachmentCustody,
  writeCorrectionAttachmentCustody,
} = require('../../electron/archive-correction-custody.cjs') as CustodyModule

type TestDatabase = {
  readonly inTransaction: boolean
  readonly exec: (sql: string) => void
  readonly prepare: (sql: string) => {
    readonly get: (...parameters: readonly unknown[]) => Readonly<Record<string, unknown>> | undefined
    readonly run: (...parameters: readonly unknown[]) => { readonly changes: number; readonly lastInsertRowid: number | bigint }
  }
  readonly transaction: <T>(callback: () => T) => { readonly immediate: () => T }
  readonly close: () => void
}

type CustodyPlan = {
  readonly operationId: string
  readonly entries: readonly Readonly<Record<string, unknown>>[]
}

type CustodyModule = {
  readonly createCorrectionAttachmentCustodyPlan: (
    input: Readonly<Record<string, unknown>>,
  ) => CustodyPlan
  readonly hasCorrectionAttachmentCustody: (db: TestDatabase) => boolean
  readonly prepareCorrectionAttachmentCustodyReconciliation: (input: {
    readonly db: TestDatabase
    readonly plan: CustodyPlan
    readonly inspectEntry: (entry: Readonly<Record<string, unknown>>) => unknown
  }) => Readonly<Record<string, unknown>>
  readonly readCorrectionAttachmentCustody: (db: TestDatabase) => CustodyPlan | null
  readonly reconcileCorrectionAttachmentCustody: (input: {
    readonly db: TestDatabase
    readonly inspection: Readonly<Record<string, unknown>>
    readonly revalidateEntry: (
      entry: Readonly<Record<string, unknown>>,
      observation: unknown,
    ) => string
  }) => Readonly<Record<string, unknown>>
  readonly writeCorrectionAttachmentCustody: (db: TestDatabase, plan: CustodyPlan) => void
}

const MISSION_ID = '11111111-1111-4111-8111-111111111111'
const ARCHIVE_ID = '22222222-2222-4222-8222-222222222222'
const OPERATION_ID = '33333333-3333-4333-8333-333333333333'
const databases: TestDatabase[] = []
const temporaryDirectories: string[] = []

afterEach(() => {
  for (const database of databases.splice(0)) database.close()
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('SQLite archive correction attachment custody reconciliation', () => {
  it('keeps full inspection outside the writer transaction so a concurrent mission write succeeds', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'sartracker-custody-two-phase-'))
    temporaryDirectories.push(root)
    const databasePath = path.join(root, 'mission-store.sqlite')
    const fixture = createFixture('finalized', databasePath)
    const concurrent = new Database(databasePath)
    databases.push(concurrent)
    const inspection = prepareCorrectionAttachmentCustodyReconciliation({
      db: fixture.db,
      plan: fixture.plan,
      inspectEntry: () => {
        expect(fixture.db.inTransaction).toBe(false)
        concurrent.prepare('INSERT INTO missions (id, status) VALUES (?, ?)')
          .run('concurrent-mission', 'active')
        return Object.freeze({ state: 'pair', proof: 'full-digest-proof' })
      },
    })
    expect(concurrent.prepare('SELECT status FROM missions WHERE id = ?')
      .get('concurrent-mission')).toEqual({ status: 'active' })

    fixture.db.transaction(() => reconcileCorrectionAttachmentCustody({
      db: fixture.db,
      inspection,
      revalidateEntry: (_entry: unknown, observation: unknown) => {
        expect(fixture.db.inTransaction).toBe(true)
        expect(observation).toEqual({ state: 'pair', proof: 'full-digest-proof' })
        return 'pair'
      },
    })).immediate()

    expect(hasCorrectionAttachmentCustody(fixture.db)).toBe(false)
  })

  it.each(['absent', 'peer', 'pair'])(
    'clears an uncommitted %s residue plan without requesting deletion',
    (state) => {
      const fixture = createFixture('finalized')
      const inspected: string[] = []

      const result = reconcileFixture(fixture, state, (entry) => {
        inspected.push(String(entry.targetName))
      })

      expect(result).toEqual({ recovered: 1, committed: false })
      expect(inspected).toHaveLength(1)
      expect(hasCorrectionAttachmentCustody(fixture.db)).toBe(false)
    },
  )

  it('clears a committed exact pair only when mission state and unlock evidence agree', () => {
    const fixture = createFixture('finished')
    insertUnlock(fixture.db, OPERATION_ID)

    expect(reconcileFixture(fixture, 'pair')).toEqual({ recovered: 1, committed: true })
    expect(readCorrectionAttachmentCustody(fixture.db)).toBeNull()
  })

  it('retains custody when a matching unlock event exists but the mission is still finalized', () => {
    const fixture = createFixture('finalized')
    insertUnlock(fixture.db, OPERATION_ID)

    expect(() => reconcileFixture(fixture, 'pair'))
      .toThrow(/not reflected by mission state/iu)
    expect(hasCorrectionAttachmentCustody(fixture.db)).toBe(true)
  })

  it('retains custody when a finished mission has no exact matching unlock', () => {
    const fixture = createFixture('finished')

    expect(() => reconcileFixture(fixture, 'pair')).toThrow(/no matching durable unlock/iu)
    expect(hasCorrectionAttachmentCustody(fixture.db)).toBe(true)
  })

  it('retains custody when unlock details do not attest finished live state', () => {
    const fixture = createFixture('finished')
    insertUnlock(fixture.db, OPERATION_ID, { storage_state: 'archived' })

    expect(() => reconcileFixture(fixture, 'pair')).toThrow(/invalid durable unlock evidence/iu)
    expect(hasCorrectionAttachmentCustody(fixture.db)).toBe(true)
  })

  it('retains custody across a newer finalization boundary', () => {
    const fixture = createFixture('finalized')
    const newerArchiveId = '44444444-4444-4444-8444-444444444444'
    fixture.db.prepare(`UPDATE mission_archives SET status = 'superseded'
      WHERE id = ?`).run(ARCHIVE_ID)
    insertFinalization(fixture.db, newerArchiveId)

    expect(() => reconcileFixture(fixture, 'pair')).toThrow(/finalization boundary changed/iu)
    expect(hasCorrectionAttachmentCustody(fixture.db)).toBe(true)
  })

  it('retains committed custody unless every entry is an exact pair', () => {
    const fixture = createFixture('finished')
    insertUnlock(fixture.db, OPERATION_ID)

    expect(() => reconcileFixture(fixture, 'peer')).toThrow(/committed.*incomplete/iu)
    expect(hasCorrectionAttachmentCustody(fixture.db)).toBe(true)
  })

  it('retains custody when cheap topology revalidation differs from the full proof', () => {
    const fixture = createFixture('finalized')
    const inspection = prepareCorrectionAttachmentCustodyReconciliation({
      db: fixture.db,
      plan: fixture.plan,
      inspectEntry: () => Object.freeze({ state: 'pair' }),
    })

    expect(() => fixture.db.transaction(() => reconcileCorrectionAttachmentCustody({
      db: fixture.db,
      inspection,
      revalidateEntry: () => 'peer',
    })).immediate()).toThrow(/residue changed/iu)
    expect(hasCorrectionAttachmentCustody(fixture.db)).toBe(true)
  })

  it('retains a replacement custody plan that changed after full inspection', () => {
    const fixture = createFixture('finalized')
    const inspection = prepareCorrectionAttachmentCustodyReconciliation({
      db: fixture.db,
      plan: fixture.plan,
      inspectEntry: () => Object.freeze({ state: 'pair' }),
    })
    const replacement = createPlan(
      fixture.finalizedEpoch,
      '55555555-5555-4555-8555-555555555555',
    )
    fixture.db.prepare('UPDATE metadata SET value = ?').run(JSON.stringify(replacement))

    expect(() => fixture.db.transaction(() => reconcileCorrectionAttachmentCustody({
      db: fixture.db,
      inspection,
      revalidateEntry: () => 'pair',
    })).immediate()).toThrow(/record changed/iu)
    expect(readCorrectionAttachmentCustody(fixture.db)?.operationId)
      .toBe('55555555-5555-4555-8555-555555555555')
  })

  it('rejects a second globally admitted custody record', () => {
    const fixture = createFixture('finalized')
    const second = createPlan(fixture.finalizedEpoch, '55555555-5555-4555-8555-555555555555')

    expect(() => writeCorrectionAttachmentCustody(fixture.db, second))
      .toThrow(/already active/iu)
    expect(readCorrectionAttachmentCustody(fixture.db)?.operationId).toBe(OPERATION_ID)
  })
})

function reconcileFixture(
  fixture: ReturnType<typeof createFixture>,
  state: string,
  onInspect: (entry: Readonly<Record<string, unknown>>) => void = () => undefined,
) {
  const inspection = prepareCorrectionAttachmentCustodyReconciliation({
    db: fixture.db,
    plan: fixture.plan,
    inspectEntry: (entry) => {
      onInspect(entry)
      return Object.freeze({ state })
    },
  })
  return fixture.db.transaction(() => reconcileCorrectionAttachmentCustody({
    db: fixture.db,
    inspection,
    revalidateEntry: () => state,
  })).immediate()
}

function createFixture(status: string, databasePath = ':memory:') {
  const db = new Database(databasePath)
  databases.push(db)
  db.exec(`CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE missions (id TEXT PRIMARY KEY, status TEXT NOT NULL);
    CREATE TABLE mission_events (
      id TEXT PRIMARY KEY,
      mission_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      details_json TEXT NOT NULL
    );
    CREATE TABLE mission_archives (
      id TEXT PRIMARY KEY,
      mission_id TEXT NOT NULL,
      protected_finalization_epoch INTEGER,
      archive_kind TEXT NOT NULL,
      container_version INTEGER NOT NULL,
      status TEXT NOT NULL,
      request_event_rowid INTEGER NOT NULL
    );`)
  db.prepare('INSERT INTO missions (id, status) VALUES (?, ?)').run(MISSION_ID, status)
  const finalizedEpoch = insertFinalization(db, ARCHIVE_ID)
  const plan = createPlan(finalizedEpoch, OPERATION_ID)
  writeCorrectionAttachmentCustody(db, plan)
  return { db, finalizedEpoch, plan }
}

function createPlan(finalizedEpoch: number, operationId: string) {
  return createCorrectionAttachmentCustodyPlan({
    missionId: MISSION_ID,
    archiveId: ARCHIVE_ID,
    operationId,
    finalizedEpoch,
    targetIdentity: { dev: '1', ino: '2' },
    mappings: [{
      entryName: 'attachments/field-photo.jpg',
      sourceRelativePath: 'Field Photo.jpg',
      sha256: 'a'.repeat(64),
      sizeBytes: 24,
      references: [{ referenceId: 'marker-1', referenceKind: 'marker' }],
    }],
  })
}

function insertFinalization(db: TestDatabase, archiveId: string): number {
  const event = db.prepare(`INSERT INTO mission_events (
    id, mission_id, event_type, timestamp, details_json
  ) VALUES (?, ?, 'mission_finalized', ?, ?)`).run(
    deriveArchiveLifecycleEventId(archiveId, 'mission-finalized'),
    MISSION_ID,
    '2026-09-07T10:00:00.000Z',
    JSON.stringify({
      archive_id: archiveId,
      archive_relative_path: `${archiveId}.sararch`,
      cleanup_membership_generation: 0,
      container_version: 2,
      resulting_status: 'finalized',
    }),
  )
  const rowid = Number(event.lastInsertRowid)
  db.prepare(`INSERT INTO mission_archives (
    id, mission_id, protected_finalization_epoch, archive_kind,
    container_version, status, request_event_rowid
  ) VALUES (?, ?, NULL, 'finalized', 2, 'verified', ?)`).run(
    archiveId,
    MISSION_ID,
    rowid,
  )
  return rowid
}

function insertUnlock(
  db: TestDatabase,
  operationId: string,
  overrides: Readonly<Record<string, unknown>> = {},
): void {
  db.prepare(`INSERT INTO mission_events (
    id, mission_id, event_type, timestamp, details_json
  ) VALUES (?, ?, 'mission_unlocked', ?, ?)`).run(
    deriveArchiveLifecycleEventId(ARCHIVE_ID, 'mission-unlocked'),
    MISSION_ID,
    '2026-09-07T10:01:00.000Z',
    JSON.stringify({
      restored_from_archive_id: ARCHIVE_ID,
      archive_correction_operation_id: operationId,
      resulting_status: 'finished',
      storage_state: 'live',
      ...overrides,
    }),
  )
}
