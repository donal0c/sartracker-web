import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')
const { createElectronMissionStore } = require('../../electron/mission-store.cjs') as {
  readonly createElectronMissionStore: (options: { readonly userDataPath: string }) => {
    readonly close: () => void
  }
}
const {
  ARCHIVE_INVENTORY_VERSION,
  ARCHIVE_TABLE_INVENTORY,
  ArchiveInventoryError,
  listArchiveInventoryForSchema,
  reconcileArchiveInventory,
  createArchiveInventoryDocument,
  digestArchiveInventoryDocument,
  computeTableContentDigest,
  computeArchivedTableContentDigest,
  createArchiveTableSelection,
} = require('../../electron/archive-inventory.cjs') as ArchiveInventoryModule

type ArchiveDecision =
  | 'mission_rows'
  | 'global_rows'
  | 'derived_excluded'
  | 'operational_excluded'

type ArchiveInventoryEntry = {
  readonly tableName: string
  readonly decision: ArchiveDecision
  readonly sinceSchemaVersion: number
  readonly predicate?: Readonly<Record<string, unknown>>
  readonly reason?: string
  readonly rebuildPath?: string
  readonly retentionPath?: string
}

type ArchiveInventoryModule = {
  readonly ARCHIVE_INVENTORY_VERSION: number
  readonly ARCHIVE_TABLE_INVENTORY: readonly ArchiveInventoryEntry[]
  readonly ArchiveInventoryError: new (...args: readonly unknown[]) => Error & { readonly code: string }
  readonly listArchiveInventoryForSchema: (
    schemaVersion: number,
    options?: { readonly declarations?: readonly ArchiveInventoryEntry[] },
  ) => readonly ArchiveInventoryEntry[]
  readonly reconcileArchiveInventory: (
    db: BetterSqliteDatabase,
    options?: {
      readonly schemaVersion?: number
      readonly declarations?: readonly ArchiveInventoryEntry[]
    },
  ) => {
    readonly inventoryVersion: number
    readonly schemaVersion: number
    readonly tableNames: readonly string[]
  }
  readonly createArchiveInventoryDocument: (input: {
    readonly schemaVersion: number
    readonly declarations?: readonly ArchiveInventoryEntry[]
  }) => Readonly<Record<string, unknown>>
  readonly digestArchiveInventoryDocument: (document: Readonly<Record<string, unknown>>) => string
  readonly computeTableContentDigest: (
    db: BetterSqliteDatabase,
    input: {
      readonly tableName: string
      readonly missionId: string
      readonly schemaVersion?: number
      readonly declarations?: readonly ArchiveInventoryEntry[]
      readonly isCancelled?: () => boolean
      readonly onProgress?: (progress: { readonly rowsProcessed: number }) => void
    },
  ) => { readonly rowCount: number; readonly contentSha256: string }
  readonly computeArchivedTableContentDigest: (
    db: BetterSqliteDatabase,
    input: {
      readonly tableName: string
      readonly schemaVersion?: number
      readonly declarations?: readonly ArchiveInventoryEntry[]
      readonly isCancelled?: () => boolean
      readonly onProgress?: (progress: { readonly rowsProcessed: number }) => void
    },
  ) => { readonly rowCount: number; readonly contentSha256: string }
  readonly createArchiveTableSelection: (input: {
    readonly tableName: string
    readonly missionId: string
    readonly schemaVersion: number
  }) => {
    readonly whereSql: string
    readonly parameters: readonly unknown[]
  }
}

type BetterSqliteDatabase = {
  readonly exec: (sql: string) => unknown
  readonly prepare: (sql: string) => {
    readonly run: (...parameters: readonly unknown[]) => unknown
    readonly all: (...parameters: readonly unknown[]) => readonly Record<string, unknown>[]
  }
  readonly close: () => void
}

const CURRENT_V12_TABLES = [
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
  'legacy_event_provenance_backfill_state',
  'legacy_event_provenance_quarantine',
  'legacy_event_provenance_quarantine_missions',
  'legacy_gpx_backfill_quarantine',
  'legacy_gpx_backfill_state',
  'legacy_gpx_rowid_scan_state',
  'legacy_mission_object_backfill_state',
  'markers',
  'metadata',
  'mission_events',
  'mission_finalization_fences',
  'mission_group_membership_events',
  'mission_object_versions',
  'mission_participants',
  'mission_replay_generations',
  'mission_replay_position_day_counts',
  'mission_teams',
  'missions',
  'outings',
  'participant_backfill_checkpoints',
  'position_revisions',
  'positions',
  'search_areas',
  'search_assignments',
  'search_pass_evidence_links',
  'search_passes',
  'tracking_history_checkpoints',
] as const

const PLANNED_V13_TABLES = [
  'mission_archive_supplements',
  'mission_archives',
  'mission_cleanup_journal',
] as const

const temporaryDirectories = new Set<string>()

afterEach(() => {
  for (const directory of temporaryDirectories) {
    rmSync(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 })
  }
  temporaryDirectories.clear()
})

/** Creates a v12-shaped store from the current additive schema. */
function createMigratedV12Database(): {
  readonly db: BetterSqliteDatabase
  readonly close: () => void
} {
  const userDataPath = mkdtempSync(path.join(tmpdir(), 'sartracker-archive-inventory-'))
  temporaryDirectories.add(userDataPath)
  const store = createElectronMissionStore({ userDataPath })
  store.close()
  const db = new Database(path.join(userDataPath, 'mission-store.sqlite')) as BetterSqliteDatabase
  db.exec(`
    DROP TABLE mission_cleanup_journal;
    DROP TABLE mission_archive_supplements;
    DROP TABLE mission_archives;
    UPDATE metadata SET value = '12' WHERE key = 'schema_version';
  `)
  return {
    db,
    close: () => db.close(),
  }
}

/** Creates a direct-mission predicate declaration for a synthetic table. */
function createProbeDeclaration(tableName: string): ArchiveInventoryEntry {
  return {
    tableName,
    decision: 'mission_rows',
    sinceSchemaVersion: 12,
    predicate: {
      kind: 'mission_column',
      column: 'mission_id',
      parameter: 'missionId',
    },
  }
}

describe('archive inventory schema reconciliation', () => {
  it('materializes the v13 replay-count table when a genuine legacy store never had it', () => {
    const userDataPath = mkdtempSync(path.join(tmpdir(), 'sartracker-archive-legacy-schema-'))
    temporaryDirectories.add(userDataPath)
    const first = createElectronMissionStore({ userDataPath })
    first.close()
    const databasePath = path.join(userDataPath, 'mission-store.sqlite')
    const legacy = new Database(databasePath) as BetterSqliteDatabase
    legacy.exec(`
      DROP TRIGGER IF EXISTS positions_replay_day_count_insert;
      DROP TRIGGER IF EXISTS positions_replay_day_count_update;
      DROP TRIGGER IF EXISTS positions_replay_day_count_delete;
      DROP TABLE mission_replay_position_day_counts;
      UPDATE metadata SET value = '10' WHERE key = 'schema_version';
    `)
    legacy.close()

    const upgraded = createElectronMissionStore({ userDataPath })
    upgraded.close()
    const inspection = new Database(databasePath) as BetterSqliteDatabase
    try {
      expect(reconcileArchiveInventory(inspection, { schemaVersion: 13 }).tableNames)
        .toContain('mission_replay_position_day_counts')
    } finally {
      inspection.close()
    }
  })

  it('declares every real v12 user table exactly once with auditable metadata', () => {
    const fixture = createMigratedV12Database()
    try {
      const result = reconcileArchiveInventory(fixture.db, { schemaVersion: 12 })
      expect(result).toEqual({
        inventoryVersion: ARCHIVE_INVENTORY_VERSION,
        schemaVersion: 12,
        tableNames: CURRENT_V12_TABLES,
      })

      const declarations = listArchiveInventoryForSchema(12)
      expect(declarations.map((entry) => entry.tableName)).toEqual(CURRENT_V12_TABLES)
      expect(new Set(declarations.map((entry) => entry.tableName)).size).toBe(declarations.length)
      for (const declaration of declarations) {
        if (declaration.decision === 'mission_rows' || declaration.decision === 'global_rows') {
          expect(declaration.predicate, declaration.tableName).toBeTruthy()
        } else {
          expect(declaration.reason, declaration.tableName).toBeTruthy()
          expect(
            declaration.rebuildPath ?? declaration.retentionPath,
            declaration.tableName,
          ).toBeTruthy()
        }
      }
    } finally {
      fixture.close()
    }
  })

  it('adds only the three planned schema-v13 lifecycle tables at v13', () => {
    const fixture = createMigratedV12Database()
    try {
      for (const tableName of PLANNED_V13_TABLES) {
        fixture.db.exec(`CREATE TABLE "${tableName}" (id TEXT PRIMARY KEY, mission_id TEXT)`)
      }

      const result = reconcileArchiveInventory(fixture.db, { schemaVersion: 13 })
      expect(result.tableNames).toEqual([...CURRENT_V12_TABLES, ...PLANNED_V13_TABLES].sort())
      expect(listArchiveInventoryForSchema(13)
        .filter((entry) => entry.sinceSchemaVersion === 13)
        .map((entry) => entry.tableName))
        .toEqual(PLANNED_V13_TABLES)
      expect(listArchiveInventoryForSchema(13)
        .filter((entry) => entry.sinceSchemaVersion === 13)
        .every((entry) => entry.decision === 'operational_excluded'))
        .toBe(true)
      expect(listArchiveInventoryForSchema(12).some((entry) => entry.sinceSchemaVersion === 13))
        .toBe(false)
    } finally {
      fixture.close()
    }
  })

  it('fails closed for an undeclared runtime table', () => {
    const fixture = createMigratedV12Database()
    try {
      fixture.db.exec('CREATE TABLE future_evidence (id TEXT PRIMARY KEY)')
      expect(() => reconcileArchiveInventory(fixture.db, { schemaVersion: 12 })).toThrowError(
        expect.objectContaining({
          name: 'ArchiveInventoryError',
          code: 'ARCHIVE_INVENTORY_UNDECLARED_TABLE',
        }),
      )
    } finally {
      fixture.close()
    }
  })

  it('fails closed when an applicable declaration has no runtime table', () => {
    const fixture = createMigratedV12Database()
    try {
      fixture.db.exec('DROP TABLE markers')
      expect(() => reconcileArchiveInventory(fixture.db, { schemaVersion: 12 })).toThrowError(
        expect.objectContaining({
          name: 'ArchiveInventoryError',
          code: 'ARCHIVE_INVENTORY_MISSING_TABLE',
        }),
      )
    } finally {
      fixture.close()
    }
  })

  it('rejects duplicate declarations and ignores SQLite internal tables', () => {
    const fixture = createMigratedV12Database()
    try {
      const autoDeclaration = createProbeDeclaration('autoincrement_probe')
      fixture.db.exec(`CREATE TABLE autoincrement_probe (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        mission_id TEXT NOT NULL
      )`)
      const withProbe = [...ARCHIVE_TABLE_INVENTORY, autoDeclaration]
      expect(reconcileArchiveInventory(fixture.db, {
        schemaVersion: 12,
        declarations: withProbe,
      }).tableNames).toContain('autoincrement_probe')

      expect(() => reconcileArchiveInventory(fixture.db, {
        schemaVersion: 12,
        declarations: [...withProbe, autoDeclaration],
      })).toThrowError(expect.objectContaining({
        name: 'ArchiveInventoryError',
        code: 'ARCHIVE_INVENTORY_DUPLICATE_DECLARATION',
      }))
    } finally {
      fixture.close()
    }
  })

  it('compiles every included predicate against the runtime schema', () => {
    const fixture = createMigratedV12Database()
    try {
      const declarations = ARCHIVE_TABLE_INVENTORY.map((entry) => entry.tableName === 'missions'
        ? {
            ...entry,
            predicate: {
              kind: 'mission_identity',
              column: 'missing_mission_identity',
              parameterNames: ['missionId'],
            },
          }
        : entry)
      expect(() => reconcileArchiveInventory(fixture.db, {
        schemaVersion: 12,
        declarations,
      })).toThrowError(expect.objectContaining({
        name: 'ArchiveInventoryError',
        code: 'ARCHIVE_INVENTORY_INVALID_PREDICATE',
      }))
    } finally {
      fixture.close()
    }
  })
})

describe('archive inventory document', () => {
  it('exposes one reviewed selection for extraction without duplicating predicates', () => {
    expect(createArchiveTableSelection({
      tableName: 'positions',
      missionId: 'mission-a',
      schemaVersion: 13,
    })).toEqual({
      whereSql: 'archive_row."mission_id" = ?',
      parameters: ['mission-a'],
    })
    expect(createArchiveTableSelection({
      tableName: 'missions',
      missionId: 'mission-a',
      schemaVersion: 13,
    })).toEqual({
      whereSql: 'archive_row."id" = ?',
      parameters: ['mission-a'],
    })
    expect(() => createArchiveTableSelection({
      tableName: 'coverage_chunks',
      missionId: 'mission-a',
      schemaVersion: 13,
    })).toThrowError(expect.objectContaining({
      code: 'ARCHIVE_INVENTORY_TABLE_EXCLUDED',
    }))
  })

  it('is canonical, stable, deeply immutable and retains all decision details', () => {
    const document = createArchiveInventoryDocument({ schemaVersion: 13 })
    const reversed = createArchiveInventoryDocument({
      schemaVersion: 13,
      declarations: [...ARCHIVE_TABLE_INVENTORY].reverse(),
    })
    expect(document).toEqual(reversed)
    expect(digestArchiveInventoryDocument(document)).toMatch(/^[a-f0-9]{64}$/)
    expect(digestArchiveInventoryDocument(document)).toBe(digestArchiveInventoryDocument(reversed))
    expect(Object.isFrozen(ARCHIVE_TABLE_INVENTORY)).toBe(true)
    expect(ARCHIVE_TABLE_INVENTORY.every((entry) => Object.isFrozen(entry))).toBe(true)
    expect(Object.isFrozen(document)).toBe(true)
    expect((document.tables as readonly ArchiveInventoryEntry[]).find(
      (entry) => entry.tableName === 'positions',
    )?.predicate).toEqual(expect.objectContaining({ kind: 'mission_column' }))
    expect((document.tables as readonly ArchiveInventoryEntry[]).find(
      (entry) => entry.tableName === 'coverage_chunks',
    )).toEqual(expect.objectContaining({
      decision: 'derived_excluded',
      reason: expect.any(String),
      rebuildPath: expect.any(String),
    }))
    expect(() => digestArchiveInventoryDocument({ unsafe: Number.NaN })).toThrow(ArchiveInventoryError)
  })
})

describe('deterministic table content digest', () => {
  it('compares a source mission selection with the identical full scratch table', () => {
    const source = createMigratedV12Database()
    const scratch = new Database(':memory:') as BetterSqliteDatabase
    const declaration = createProbeDeclaration('comparison_probe')
    const declarations = [...ARCHIVE_TABLE_INVENTORY, declaration]
    const createSql = `CREATE TABLE comparison_probe (
      id TEXT PRIMARY KEY,
      mission_id TEXT NOT NULL,
      value TEXT NOT NULL
    )`
    try {
      source.db.exec(createSql)
      scratch.exec(createSql)
      source.db.prepare(
        'INSERT INTO comparison_probe (rowid, id, mission_id, value) VALUES (?, ?, ?, ?)',
      ).run(41, 'row-a', 'mission-a', 'kept')
      source.db.prepare(
        'INSERT INTO comparison_probe (rowid, id, mission_id, value) VALUES (?, ?, ?, ?)',
      ).run(42, 'row-b', 'mission-b', 'excluded')
      scratch.prepare(
        'INSERT INTO comparison_probe (rowid, id, mission_id, value) VALUES (?, ?, ?, ?)',
      ).run(41, 'row-a', 'mission-a', 'kept')

      expect(computeArchivedTableContentDigest(scratch, {
        tableName: 'comparison_probe',
        schemaVersion: 12,
        declarations,
      })).toEqual(computeTableContentDigest(source.db, {
        tableName: 'comparison_probe',
        missionId: 'mission-a',
        schemaVersion: 12,
        declarations,
      }))
    } finally {
      scratch.close()
      source.close()
    }
  })

  it('exhaustively digests rebuilt and empty operational tables in the archive scratch schema', () => {
    const fixture = createMigratedV12Database()
    const derivedDeclaration: ArchiveInventoryEntry = {
      tableName: 'derived_probe',
      decision: 'derived_excluded',
      sinceSchemaVersion: 12,
      reason: 'Rebuilt from archived mission evidence.',
      rebuildPath: 'archive scratch rebuild fixture',
    }
    const operationalDeclaration: ArchiveInventoryEntry = {
      tableName: 'operational_probe',
      decision: 'operational_excluded',
      sinceSchemaVersion: 12,
      reason: 'Live operational state is never restored.',
      retentionPath: 'empty archive scratch table',
    }
    const declarations = [
      ...ARCHIVE_TABLE_INVENTORY,
      derivedDeclaration,
      operationalDeclaration,
    ]
    try {
      fixture.db.exec(`
        CREATE TABLE derived_probe (
          id TEXT PRIMARY KEY,
          mission_id TEXT NOT NULL,
          value TEXT NOT NULL
        );
        CREATE TABLE operational_probe (
          id TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
        INSERT INTO derived_probe (id, mission_id, value)
          VALUES ('row-a', 'mission-a', 'derived');
      `)

      const derived = computeArchivedTableContentDigest(fixture.db, {
        tableName: 'derived_probe',
        schemaVersion: 12,
        declarations,
      })
      const operational = computeArchivedTableContentDigest(fixture.db, {
        tableName: 'operational_probe',
        schemaVersion: 12,
        declarations,
      })
      expect(derived.rowCount).toBe(1)
      expect(derived.contentSha256).toMatch(/^[a-f0-9]{64}$/)
      expect(operational.rowCount).toBe(0)
      expect(operational.contentSha256).toMatch(/^[a-f0-9]{64}$/)

      fixture.db.prepare('UPDATE derived_probe SET value = ? WHERE id = ?')
        .run('changed', 'row-a')
      expect(computeArchivedTableContentDigest(fixture.db, {
        tableName: 'derived_probe',
        schemaVersion: 12,
        declarations,
      }).contentSha256).not.toBe(derived.contentSha256)
      expect(() => computeTableContentDigest(fixture.db, {
        tableName: 'derived_probe',
        missionId: 'mission-a',
        schemaVersion: 12,
        declarations,
      })).toThrowError(expect.objectContaining({ code: 'ARCHIVE_INVENTORY_TABLE_EXCLUDED' }))
    } finally {
      fixture.close()
    }
  })

  it('covers the authoritative rowid even when a separate primary key orders the table', () => {
    const fixture = createMigratedV12Database()
    const declaration = createProbeDeclaration('rowid_probe')
    const declarations = [...ARCHIVE_TABLE_INVENTORY, declaration]
    try {
      fixture.db.exec(`CREATE TABLE rowid_probe (
        id TEXT PRIMARY KEY,
        mission_id TEXT NOT NULL,
        value TEXT NOT NULL
      )`)
      fixture.db.prepare(
        'INSERT INTO rowid_probe (rowid, id, mission_id, value) VALUES (?, ?, ?, ?)',
      ).run(41, 'row-a', 'mission-a', 'unchanged')

      const input = {
        tableName: 'rowid_probe',
        missionId: 'mission-a',
        schemaVersion: 12,
        declarations,
      } as const
      const original = computeTableContentDigest(fixture.db, input)

      fixture.db.prepare('UPDATE rowid_probe SET rowid = ? WHERE id = ?').run(1041, 'row-a')
      const moved = computeTableContentDigest(fixture.db, input)

      expect(moved.rowCount).toBe(original.rowCount)
      expect(moved.contentSha256).not.toBe(original.contentSha256)
    } finally {
      fixture.close()
    }
  })

  it('is stable, exhaustive, mission-scoped and changes for mutation or deletion', () => {
    const fixture = createMigratedV12Database()
    const declaration = createProbeDeclaration('digest_probe')
    const declarations = [...ARCHIVE_TABLE_INVENTORY, declaration]
    try {
      fixture.db.exec(`CREATE TABLE digest_probe (
        id INTEGER PRIMARY KEY,
        mission_id TEXT NOT NULL,
        value
      )`)
      const insert = fixture.db.prepare(
        'INSERT INTO digest_probe (id, mission_id, value) VALUES (?, ?, ?)',
      )
      insert.run(1, 'mission-a', null)
      insert.run(2, 'mission-a', '1')
      insert.run(3, 'mission-a', 1)
      insert.run(4, 'mission-a', 1.25)
      insert.run(5, 'mission-a', Buffer.from([0, 1, 2, 255]))
      insert.run(6, 'mission-b', 'must-not-affect-mission-a')

      const input = {
        tableName: 'digest_probe',
        missionId: 'mission-a',
        schemaVersion: 12,
        declarations,
      } as const
      const original = computeTableContentDigest(fixture.db, input)
      expect(original.rowCount).toBe(5)
      expect(original.contentSha256).toMatch(/^[a-f0-9]{64}$/)
      expect(computeTableContentDigest(fixture.db, input)).toEqual(original)

      fixture.db.prepare('UPDATE digest_probe SET value = ? WHERE id = ?')
        .run('different', 6)
      expect(computeTableContentDigest(fixture.db, input)).toEqual(original)

      fixture.db.prepare('UPDATE digest_probe SET value = ? WHERE id = ?')
        .run('mutated', 2)
      const mutated = computeTableContentDigest(fixture.db, input)
      expect(mutated.contentSha256).not.toBe(original.contentSha256)

      fixture.db.prepare('DELETE FROM digest_probe WHERE id = ?').run(3)
      const deleted = computeTableContentDigest(fixture.db, input)
      expect(deleted.rowCount).toBe(4)
      expect(deleted.contentSha256).not.toBe(mutated.contentSha256)
    } finally {
      fixture.close()
    }
  })

  it('reports bounded real row progress without changing the exact digest', () => {
    const fixture = createMigratedV12Database()
    const declaration = createProbeDeclaration('progress_probe')
    const declarations = [...ARCHIVE_TABLE_INVENTORY, declaration]
    try {
      fixture.db.exec(`CREATE TABLE progress_probe (
        id INTEGER PRIMARY KEY,
        mission_id TEXT NOT NULL,
        value TEXT NOT NULL
      )`)
      const insert = fixture.db.prepare(
        'INSERT INTO progress_probe (id, mission_id, value) VALUES (?, ?, ?)',
      )
      for (let index = 1; index <= 8_205; index += 1) {
        insert.run(index, 'mission-a', `value-${index}`)
      }
      const input = {
        tableName: 'progress_probe',
        missionId: 'mission-a',
        schemaVersion: 12,
        declarations,
      } as const
      const expected = computeTableContentDigest(fixture.db, input)
      const observedProgress: number[] = []
      const observed = computeTableContentDigest(fixture.db, {
        ...input,
        onProgress: ({ rowsProcessed }) => observedProgress.push(rowsProcessed),
      })

      expect(observed).toEqual(expected)
      expect(observedProgress[0]).toBe(1)
      expect(observedProgress.at(-1)).toBe(expected.rowCount)
      expect(observedProgress.length).toBeGreaterThan(2)
      expect(observedProgress.every((value, index) =>
        index === 0 || value > observedProgress[index - 1]!)).toBe(true)
      expect(Math.max(...observedProgress.map((value, index) =>
        index === 0 ? value : value - observedProgress[index - 1]!))).toBeLessThanOrEqual(4_096)
    } finally {
      fixture.close()
    }
  })

  it('checks cancellation between streamed digest rows', () => {
    const fixture = createMigratedV12Database()
    const declaration = createProbeDeclaration('cancel_probe')
    const declarations = [...ARCHIVE_TABLE_INVENTORY, declaration]
    try {
      fixture.db.exec(`CREATE TABLE cancel_probe (
        id INTEGER PRIMARY KEY,
        mission_id TEXT NOT NULL,
        value TEXT NOT NULL
      )`)
      const insert = fixture.db.prepare(
        'INSERT INTO cancel_probe (id, mission_id, value) VALUES (?, ?, ?)',
      )
      for (let index = 1; index <= 10; index += 1) {
        insert.run(index, 'mission-a', `value-${index}`)
      }
      let cancelled = false
      expect(() => computeTableContentDigest(fixture.db, {
        tableName: 'cancel_probe',
        missionId: 'mission-a',
        schemaVersion: 12,
        declarations,
        isCancelled: () => cancelled,
        onProgress: () => { cancelled = true },
      })).toThrowError(expect.objectContaining({ code: 'ARCHIVE_CANCELLED' }))
    } finally {
      fixture.close()
    }
  })

  it('distinguishes SQLite null, text, integer, real and blob storage classes', () => {
    const fixture = createMigratedV12Database()
    const declaration = createProbeDeclaration('type_probe')
    const declarations = [...ARCHIVE_TABLE_INVENTORY, declaration]
    try {
      fixture.db.exec(`CREATE TABLE type_probe (
        id INTEGER PRIMARY KEY,
        mission_id TEXT NOT NULL,
        value
      )`)
      const insert = fixture.db.prepare(
        'INSERT INTO type_probe (id, mission_id, value) VALUES (?, ?, ?)',
      )
      insert.run(1, 'mission-a', null)
      insert.run(2, 'mission-a', '1')
      insert.run(3, 'mission-a', 1)
      insert.run(4, 'mission-a', 1.0)
      insert.run(5, 'mission-a', Buffer.from('1'))

      const digest = () => computeTableContentDigest(fixture.db, {
        tableName: 'type_probe',
        missionId: 'mission-a',
        schemaVersion: 12,
        declarations,
      }).contentSha256
      const baseline = digest()
      for (const [id, replacement] of [
        [1, ''],
        [2, 1],
        [3, 1.25],
        [4, Buffer.from('1')],
        [5, '1'],
      ] as const) {
        fixture.db.prepare('UPDATE type_probe SET value = ? WHERE id = ?').run(replacement, id)
        expect(digest(), `storage-class replacement for row ${id}`).not.toBe(baseline)
        fixture.db.prepare('DELETE FROM type_probe').run()
        insert.run(1, 'mission-a', null)
        insert.run(2, 'mission-a', '1')
        insert.run(3, 'mission-a', 1)
        insert.run(4, 'mission-a', 1.0)
        insert.run(5, 'mission-a', Buffer.from('1'))
      }
    } finally {
      fixture.close()
    }
  })

  it('bounds referenced global quarantine rows to the requested mission', () => {
    const fixture = createMigratedV12Database()
    try {
      const insertQuarantine = fixture.db.prepare(`INSERT INTO legacy_event_provenance_quarantine (
        table_name, source_rowid, event_id_preview, reason, payload_bytes, detected_at
      ) VALUES (?, ?, ?, ?, ?, ?)`)
      const insertMissionLink = fixture.db.prepare(`INSERT INTO legacy_event_provenance_quarantine_missions (
        mission_id, table_name, source_rowid
      ) VALUES (?, ?, ?)`)
      insertQuarantine.run('mission_events', 1, 'event-a', 'legacy-a', 10, '2026-08-29T10:00:00.000Z')
      insertQuarantine.run('mission_events', 2, 'event-b', 'legacy-b', 20, '2026-08-29T10:01:00.000Z')
      insertMissionLink.run('mission-a', 'mission_events', 1)
      insertMissionLink.run('mission-b', 'mission_events', 2)

      const input = {
        tableName: 'legacy_event_provenance_quarantine',
        missionId: 'mission-a',
        schemaVersion: 12,
      } as const
      const original = computeTableContentDigest(fixture.db, input)
      expect(original.rowCount).toBe(1)

      fixture.db.prepare(`UPDATE legacy_event_provenance_quarantine
        SET reason = ? WHERE source_rowid = ?`).run('changed-other-mission', 2)
      expect(computeTableContentDigest(fixture.db, input)).toEqual(original)

      fixture.db.prepare(`UPDATE legacy_event_provenance_quarantine
        SET reason = ? WHERE source_rowid = ?`).run('changed-requested-mission', 1)
      expect(computeTableContentDigest(fixture.db, input).contentSha256)
        .not.toBe(original.contentSha256)
    } finally {
      fixture.close()
    }
  })

  it('selects a mission identity row by missions.id', () => {
    const fixture = createMigratedV12Database()
    try {
      const insert = fixture.db.prepare(`INSERT INTO missions (
        id, name, status, start_time, paused_seconds, schema_version
      ) VALUES (?, ?, 'finished', ?, 0, 12)`)
      insert.run('mission-a', 'Mission A', '2026-08-29T09:00:00.000Z')
      insert.run('mission-b', 'Mission B', '2026-08-29T09:01:00.000Z')

      const input = {
        tableName: 'missions',
        missionId: 'mission-a',
        schemaVersion: 12,
      } as const
      const original = computeTableContentDigest(fixture.db, input)
      expect(original.rowCount).toBe(1)

      fixture.db.prepare('UPDATE missions SET name = ? WHERE id = ?').run('Other Mission', 'mission-b')
      expect(computeTableContentDigest(fixture.db, input)).toEqual(original)
      fixture.db.prepare('UPDATE missions SET name = ? WHERE id = ?').run('Changed Mission', 'mission-a')
      expect(computeTableContentDigest(fixture.db, input).contentSha256)
        .not.toBe(original.contentSha256)
    } finally {
      fixture.close()
    }
  })

  it('selects long-id legacy GPX quarantine evidence by authoritative source rowid', () => {
    const fixture = createMigratedV12Database()
    try {
      const insertMission = fixture.db.prepare(`INSERT INTO missions (
        id, name, status, start_time, paused_seconds, schema_version
      ) VALUES (?, ?, 'finished', ?, 0, 12)`)
      insertMission.run('mission-a', 'Mission A', '2026-08-29T09:00:00.000Z')
      insertMission.run('mission-b', 'Mission B', '2026-08-29T09:01:00.000Z')

      const insertImport = fixture.db.prepare(`INSERT INTO gpx_track_imports (
        rowid, id, mission_id, source_path, file_name, display_name,
        geometry_json, imported_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      const longMissionAId = `gpx-a-${'x'.repeat(140)}`
      const longMissionBId = `gpx-b-${'y'.repeat(140)}`
      insertImport.run(
        9001,
        longMissionAId,
        'mission-a',
        '/mission-a.gpx',
        'mission-a.gpx',
        'Mission A track',
        '{"type":"LineString","coordinates":[]}',
        '2026-08-29T09:02:00.000Z',
        '2026-08-29T09:02:00.000Z',
      )
      insertImport.run(
        9002,
        longMissionBId,
        'mission-b',
        '/mission-b.gpx',
        'mission-b.gpx',
        'Mission B track',
        '{"type":"LineString","coordinates":[]}',
        '2026-08-29T09:03:00.000Z',
        '2026-08-29T09:03:00.000Z',
      )
      const insertQuarantine = fixture.db.prepare(`INSERT INTO legacy_gpx_backfill_quarantine (
        source_rowid, import_id_preview, reason, geometry_bytes,
        source_bytes_base64_bytes, metadata_bytes, detected_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      insertQuarantine.run(
        9001,
        longMissionAId.slice(0, 100),
        'oversized-a',
        1_000_000,
        2_000_000,
        10,
        '2026-08-29T09:04:00.000Z',
      )
      insertQuarantine.run(
        9002,
        longMissionBId.slice(0, 100),
        'oversized-b',
        1_100_000,
        2_100_000,
        11,
        '2026-08-29T09:05:00.000Z',
      )

      const input = {
        tableName: 'legacy_gpx_backfill_quarantine',
        missionId: 'mission-a',
        schemaVersion: 12,
      } as const
      const original = computeTableContentDigest(fixture.db, input)
      expect(original.rowCount).toBe(1)

      fixture.db.prepare(`UPDATE legacy_gpx_backfill_quarantine
        SET reason = ? WHERE source_rowid = ?`).run('changed-other-mission', 9002)
      expect(computeTableContentDigest(fixture.db, input)).toEqual(original)

      fixture.db.prepare(`UPDATE legacy_gpx_backfill_quarantine
        SET reason = ? WHERE source_rowid = ?`).run('changed-requested-mission', 9001)
      expect(computeTableContentDigest(fixture.db, input).contentSha256)
        .not.toBe(original.contentSha256)
    } finally {
      fixture.close()
    }
  })
})
