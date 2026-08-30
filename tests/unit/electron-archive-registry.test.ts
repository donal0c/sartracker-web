import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')
const { createElectronMissionStore, CURRENT_SCHEMA_VERSION } = require(
  '../../electron/mission-store.cjs',
) as {
  readonly CURRENT_SCHEMA_VERSION: number
  readonly createElectronMissionStore: (options: { readonly userDataPath: string }) => {
    readonly prepareClose: () => Promise<void>
    readonly close: () => void
  }
}
const {
  LEGACY_ARCHIVE_BACKFILL_LIMIT,
  backfillLegacyArchiveRegistry,
  createArchiveRegistry,
  readLegacyArchiveRegistryBackfillPending,
} = require('../../electron/archive-registry.cjs') as ArchiveRegistryModule
const { inspectArchiveCustodyFile } = require('../../electron/archive-custody-file.cjs') as {
  readonly inspectArchiveCustodyFile: (input: {
    readonly archiveDirectory: string
    readonly archiveRelativePath: string
  }) => Readonly<Record<string, unknown>> & {
    readonly ciphertextSha256: string
    readonly fileIdentity: Readonly<Record<string, unknown>>
    readonly sizeBytes: number
  }
}
const { canonicalJson } = require('../../electron/archive-container.cjs') as {
  readonly canonicalJson: (value: unknown) => string
}
const { listArchiveInventoryForSchema } = require('../../electron/archive-inventory.cjs') as {
  readonly listArchiveInventoryForSchema: (
    schemaVersion: number,
  ) => readonly { readonly tableName: string }[]
}

type DatabaseConnection = {
  readonly exec: (sql: string) => void
  readonly prepare: (sql: string) => {
    readonly get: (...parameters: readonly unknown[]) => Record<string, unknown> | undefined
    readonly all: (...parameters: readonly unknown[]) => readonly Record<string, unknown>[]
    readonly run: (...parameters: readonly unknown[]) => { readonly changes: number }
  }
  readonly close: () => void
}

type ArchiveRow = {
  readonly id: string
  readonly mission_id: string
  readonly request_event_rowid: number
  readonly request_event_id: string
  readonly creation_operation_id: string | null
  readonly protected_finalization_epoch: number | null
  readonly archive_kind: 'finalized' | 'direct' | 'finalized_recovery'
  readonly container_version: 1 | 2
  readonly relative_path: string
  readonly ciphertext_sha256: string | null
  readonly size_bytes: number | null
  readonly created_at: string
  readonly sealed_event_id: string | null
  readonly verified_at: string | null
  readonly verification_proof_json: string | null
  readonly previous_archive_id: string | null
  readonly status: 'sealed' | 'verified' | 'superseded'
  readonly availability: 'unknown' | 'present' | 'missing' | 'not_regular' | 'mismatched' | 'unreadable'
  readonly availability_reason: string | null
  readonly last_reconciled_at: string | null
  readonly last_observed_file_identity: string | null
  readonly slots_json: string
  readonly last_non_machine_unwrap_at: string | null
  readonly legacy_event_rowid: number | null
}

type ArchiveRegistry = {
  readonly registerSealedArchive: (input: {
    readonly id: string
    readonly missionId: string
    readonly requestEventRowid: number
    readonly requestEventId: string
    readonly creationOperationId: string
    readonly protectedFinalizationEpoch: number | null
    readonly archiveKind: 'finalized' | 'direct' | 'finalized_recovery'
    readonly containerVersion: 1 | 2
    readonly relativePath: string
    readonly ciphertextSha256: string
    readonly sizeBytes: number
    readonly createdAt: string
    readonly sealedEventId: string
    readonly previousArchiveId?: string | null
    readonly frameCount: number
    readonly headerSha256: string
    readonly manifestSha256: string
    readonly entryCount: number
    readonly tableCount: number
    readonly slots: readonly { readonly slotType: string; readonly slotId: string }[]
  }) => ArchiveRow
  readonly getArchive: (archiveId: string) => ArchiveRow
  readonly listMissionArchives: (missionId: string) => readonly ArchiveRow[]
  readonly issueVerificationTicket: (archiveId: string) => Readonly<Record<string, unknown>>
  readonly issueReviewTicket: (archiveId: string) => Readonly<Record<string, unknown>>
  readonly recordReviewOpened: (input: Readonly<Record<string, unknown>>) => string
  readonly recordReviewClosed: (input: Readonly<Record<string, unknown>>) => string
  readonly markVerified: (input: {
    readonly archiveId: string
    readonly verifiedAt: string
    readonly verificationProof: Readonly<Record<string, unknown>>
  }) => ArchiveRow
  readonly recordSupplement: (input: {
    readonly id: string
    readonly missionId: string
    readonly archiveId: string
    readonly previousArchiveId: string
    readonly supplementSequence: number
    readonly authority: string
    readonly reason: string
    readonly createdAt: string
    readonly auditEventId: string
  }) => Readonly<Record<string, unknown>>
  readonly reconcileArchiveAvailability: (input?: {
    readonly archiveId?: string
    readonly limit?: number
    readonly cycleStartedAt?: string
  }) => Promise<{
    readonly inspected: number
    readonly unavailable: readonly { readonly archiveId: string; readonly reason: string }[]
    readonly remaining: 0 | 1
  }>
}

type ArchiveRegistryModule = {
  readonly LEGACY_ARCHIVE_BACKFILL_LIMIT: number
  readonly ArchiveRegistryError: new (...args: readonly unknown[]) => Error & {
    readonly code: string
  }
  readonly backfillLegacyArchiveRegistry: (
    db: DatabaseConnection,
    input: { readonly archiveDirectory: string; readonly limit?: number },
  ) => { readonly processed: number; readonly remaining: number }
  readonly readLegacyArchiveRegistryBackfillPending: (
    db: DatabaseConnection,
  ) => number
  readonly createArchiveRegistry: (input: {
    readonly db: DatabaseConnection
    readonly archiveDirectory: string
    readonly statFile?: typeof stat
    readonly appendAuditEvent?: (
      missionId: string,
      eventType: string,
      details: Readonly<Record<string, unknown>>,
    ) => string
    readonly startCustodyReconciliation?: (input: {
      readonly ticket: Readonly<Record<string, unknown>>
      readonly signal?: AbortSignal
    }) => Promise<Readonly<Record<string, unknown>>> & {
      readonly workerExited: Promise<void>
    }
  }) => ArchiveRegistry
}

const temporaryDirectories = new Set<string>()

afterEach(async () => {
  for (const directory of temporaryDirectories) {
    await rm(directory, { recursive: true, force: true })
  }
  temporaryDirectories.clear()
})

/** Creates an app-owned temporary store and returns its database connection. */
async function createFixture(): Promise<{
  readonly userDataPath: string
  readonly archiveDirectory: string
  readonly db: DatabaseConnection
  readonly close: () => void
}> {
  const userDataPath = await mkdtemp(path.join(tmpdir(), 'sartracker-archive-registry-'))
  temporaryDirectories.add(userDataPath)
  const store = createElectronMissionStore({ userDataPath })
  store.close()
  const archiveDirectory = path.join(userDataPath, 'archives')
  await mkdir(archiveDirectory, { recursive: true })
  const db = new Database(path.join(userDataPath, 'mission-store.sqlite')) as DatabaseConnection
  return { userDataPath, archiveDirectory, db, close: () => db.close() }
}

/** Inserts one minimal mission and one exact audit event. */
function insertMissionEvent(
  db: DatabaseConnection,
  input: {
    readonly missionId: string
    readonly eventId: string
    readonly eventType: string
    readonly timestamp: string
    readonly details: Readonly<Record<string, unknown>>
    readonly status?: 'finished' | 'finalized'
  },
): number {
  db.prepare(`INSERT OR IGNORE INTO missions (
    id, name, status, start_time, pause_time, finish_time, paused_seconds, notes, schema_version
  ) VALUES (?, ?, ?, ?, NULL, ?, 0, NULL, ?)`)
    .run(
      input.missionId,
      input.missionId,
      input.status ?? 'finalized',
      '2026-08-29T10:00:00.000Z',
      input.timestamp,
      CURRENT_SCHEMA_VERSION,
    )
  db.prepare(`INSERT INTO mission_events (
    id, mission_id, event_type, timestamp, details_json, recorded_at,
    recording_completeness
  ) VALUES (?, ?, ?, ?, ?, ?, 'complete')`)
    .run(
      input.eventId,
      input.missionId,
      input.eventType,
      input.timestamp,
      JSON.stringify(input.details),
      input.timestamp,
    )
  return Number(db.prepare('SELECT rowid FROM mission_events WHERE id = ?')
    .get(input.eventId)?.rowid)
}

/** Appends one exact audit row to the same fixture database and returns its identity. */
function createSameDatabaseAuditAdapter(
  db: DatabaseConnection,
  observed: Readonly<Record<string, unknown>>[] = [],
) {
  return (
    missionId: string,
    eventType: string,
    details: Readonly<Record<string, unknown>>,
  ): string => {
    const eventId = randomUUID()
    const timestamp = new Date().toISOString()
    db.prepare(`INSERT INTO mission_events (
      id, mission_id, event_type, timestamp, details_json, recorded_at,
      recording_completeness
    ) VALUES (?, ?, ?, ?, ?, ?, 'complete')`).run(
      eventId,
      missionId,
      eventType,
      timestamp,
      JSON.stringify(details),
      timestamp,
    )
    observed.push({ missionId, eventType, details, eventId })
    return eventId
  }
}

/** Returns one exact exhaustive verification proof for the registry fixture. */
function verificationProof(overrides: Readonly<Record<string, unknown>> = {}) {
  const tables = listArchiveInventoryForSchema(13).map((declaration, index) => ({
    tableName: declaration.tableName,
    rowCount: index,
    contentSha256: createHash('sha256').update(declaration.tableName).digest('hex'),
  }))
  const sample = {
    selectedTime: '2026-08-29T12:10:00.000Z',
    semanticSha256: createHash('sha256').update('registry-replay').digest('hex'),
    sampledOutingFilterCount: 0,
    totalOutingFilterCount: 0,
    sampledObjectCount: 1,
    totalObjectCount: 1,
    sampledTrackCount: 2,
    totalTrackCount: 2,
  }
  const replayProof = {
    proof_version: 3,
    sample_count: 1,
    sample_strategy: 'mission-start-finish-fence-midpoints-exhaustive-pages-and-outing-filters-v3',
    samples: [{
      selected_time: sample.selectedTime,
      semantic_sha256: sample.semanticSha256,
      sampled_outing_filter_count: sample.sampledOutingFilterCount,
      sampled_object_count: sample.sampledObjectCount,
      sampled_track_count: sample.sampledTrackCount,
      total_outing_filter_count: sample.totalOutingFilterCount,
      total_object_count: sample.totalObjectCount,
      total_track_count: sample.totalTrackCount,
    }],
  }
  return {
    proofVersion: 1,
    exhaustive: true,
    archiveId: '22222222-2222-4222-8222-222222222222',
    archiveKind: 'finalized',
    archiveRelativePath: '22222222-2222-4222-8222-222222222222.sararch',
    missionId: 'verify-mission',
    requestEventRowid: 9,
    requestEventId: '33333333-3333-4333-8333-333333333333',
    creationOperationId: '99999999-9999-4999-8999-999999999999',
    protectedFinalizationEpoch: null,
    createdAt: '2026-08-29T12:10:00.000Z',
    previousArchiveSha256: null,
    containerVersion: 2,
    schemaVersion: 13,
    inventoryVersion: 1,
    ciphertextSha256: 'b'.repeat(64),
    sizeBytes: 2048,
    frameCount: 8,
    headerSha256: 'c'.repeat(64),
    manifestSha256: 'd'.repeat(64),
    custodyFileIdentity: {
      changedTimeNanoseconds: '200', device: '1', inode: '2', linkCount: 1,
      modifiedTimeNanoseconds: '100', sizeBytes: 2048,
    },
    layers: {
      ciphertext: { exhaustive: true, matched: true },
      authenticatedFrames: { exhaustive: true, matched: true },
      entries: { exhaustive: true, matched: true, count: 4 },
      inventory: { exhaustive: true, matched: true, tableCount: 49 },
      gpxSourceBytes: {
        exhaustive: true,
        matched: true,
        recordCount: 0,
        exactBytesCount: 0,
        legacyHashOnlyCount: 0,
        legacyUnavailableCount: 0,
        failureUnavailableCount: 0,
        exactSourceCustodyComplete: true,
      },
      attachments: { exhaustive: true, matched: true, count: 0 },
    },
    tables,
    tableLedgerSha256: createHash('sha256').update(canonicalJson(tables)).digest('hex'),
    replaySemantic: {
      sampled: true,
      matched: true,
      sampleCount: 1,
      sampleStrategy: replayProof.sample_strategy,
      baselineSha256: createHash('sha256').update(canonicalJson(replayProof)).digest('hex'),
      samples: [sample],
    },
    durationMs: 500,
    plaintextSweepConfirmed: true,
    ...overrides,
  }
}

/** Returns the creator receipt that must survive sealing for independent comparison. */
function creationReceipt() {
  return {
    frameCount: 8,
    headerSha256: 'c'.repeat(64),
    manifestSha256: 'd'.repeat(64),
    entryCount: 4,
    tableCount: 49,
  }
}

/** Projects a creator receipt into the immutable sealed-event field names. */
function creationReceiptEventDetails() {
  const receipt = creationReceipt()
  return {
    frame_count: receipt.frameCount,
    header_sha256: receipt.headerSha256,
    manifest_sha256: receipt.manifestSha256,
    entry_count: receipt.entryCount,
    table_count: receipt.tableCount,
  }
}

/** Returns one already-settled reconciliation operation for an injected ticket. */
function completedCustodyOperation(
  ticket: Readonly<Record<string, unknown>>,
  outcome: 'available' | 'missing' | 'not_regular' = 'available',
) {
  const observedSizeBytes = Number(ticket.expectedSizeBytes ?? 64)
  const result = outcome === 'available'
    ? {
        type: 'complete',
        operationId: ticket.operationId,
        registryRowid: ticket.registryRowid,
        archiveId: ticket.archiveId,
        containerVersion: ticket.containerVersion,
        archiveRelativePath: ticket.archiveRelativePath,
        expectedSizeBytes: ticket.expectedSizeBytes,
        expectedCiphertextSha256: ticket.expectedCiphertextSha256,
        outcome,
        observedSizeBytes,
        observedCiphertextSha256: ticket.containerVersion === 1
          && ticket.expectedCiphertextSha256 === null
          ? null
          : ticket.expectedCiphertextSha256 ?? 'a'.repeat(64),
        fileIdentity: {
          changedTimeNanoseconds: '2',
          device: '3',
          inode: String(ticket.registryRowid),
          linkCount: 1,
          modifiedTimeNanoseconds: '1',
          sizeBytes: observedSizeBytes,
        },
      }
    : {
        type: 'complete',
        operationId: ticket.operationId,
        registryRowid: ticket.registryRowid,
        archiveId: ticket.archiveId,
        containerVersion: ticket.containerVersion,
        archiveRelativePath: ticket.archiveRelativePath,
        expectedSizeBytes: ticket.expectedSizeBytes,
        expectedCiphertextSha256: ticket.expectedCiphertextSha256,
        outcome,
        observedSizeBytes: null,
        observedCiphertextSha256: null,
        fileIdentity: null,
      }
  return Object.assign(Promise.resolve(result), { workerExited: Promise.resolve() })
}

/** Returns one rejected reconciliation operation whose physical worker is already joined. */
function rejectedCustodyOperation(error: Error) {
  return Object.assign(Promise.reject(error), { workerExited: Promise.resolve() })
}

/** Backfills deterministic v1 archive rows for durable scheduling tests. */
function seedLegacyArchiveRows(
  db: DatabaseConnection,
  archiveDirectory: string,
  names: readonly string[],
) {
  for (const [index, name] of names.entries()) {
    insertMissionEvent(db, {
      missionId: 'legacy-reconcile-mission',
      eventId: `legacy-reconcile-event-${index}`,
      eventType: 'mission_archived',
      timestamp: `2026-08-29T15:0${index}:00.000Z`,
      details: {
        archive_kind: 'direct',
        archive_path: path.join(archiveDirectory, name),
      },
    })
  }
  expect(backfillLegacyArchiveRegistry(db, { archiveDirectory, limit: names.length }))
    .toMatchObject({ processed: names.length, remaining: 0 })
}

describe('schema v13 archive lifecycle migration', () => {
  it('adds only bounded registry, supplement and cleanup-journal metadata tables', async () => {
    const fixture = await createFixture()
    try {
      expect(CURRENT_SCHEMA_VERSION).toBe(13)
      const tables = fixture.db.prepare(`SELECT name FROM sqlite_master
        WHERE type = 'table' AND name IN (
          'mission_archives', 'mission_archive_supplements', 'mission_cleanup_journal'
        ) ORDER BY name`).all().map((row) => row.name)
      expect(tables).toEqual([
        'mission_archive_supplements',
        'mission_archives',
        'mission_cleanup_journal',
      ])
      expect(fixture.db.prepare("SELECT value FROM metadata WHERE key = 'schema_version'").get())
        .toEqual({ value: '13' })

      const archiveColumns = fixture.db.prepare('PRAGMA table_info(mission_archives)')
        .all().map((row) => row.name)
      expect(archiveColumns).toEqual([
        'id', 'mission_id', 'request_event_rowid', 'request_event_id',
        'creation_operation_id', 'protected_finalization_epoch',
        'archive_kind', 'container_version',
        'relative_path', 'ciphertext_sha256', 'size_bytes', 'created_at', 'sealed_event_id',
        'frame_count', 'header_sha256', 'manifest_sha256', 'entry_count', 'table_count',
        'verified_at', 'verification_proof_json', 'previous_archive_id', 'status',
        'availability', 'availability_reason', 'last_reconciled_at',
        'last_observed_file_identity', 'slots_json', 'last_non_machine_unwrap_at',
        'legacy_event_rowid',
      ])
    } finally {
      fixture.close()
    }
  })

  it('upgrades a schema-v12-shaped store without scanning mission evidence rows', async () => {
    const fixture = await createFixture()
    const databasePath = path.join(fixture.userDataPath, 'mission-store.sqlite')
    fixture.db.exec(`
      DROP TABLE mission_cleanup_journal;
      DROP TABLE mission_archive_supplements;
      DROP TABLE mission_archives;
      UPDATE metadata SET value = '12' WHERE key = 'schema_version';
    `)
    fixture.close()

    const startedAt = performance.now()
    const migrated = createElectronMissionStore({ userDataPath: fixture.userDataPath })
    const durationMs = performance.now() - startedAt
    migrated.close()
    const inspection = new Database(databasePath) as DatabaseConnection
    try {
      expect(inspection.prepare("SELECT value FROM metadata WHERE key = 'schema_version'").get())
        .toEqual({ value: '13' })
      expect(durationMs).toBeLessThan(200)
    } finally {
      inspection.close()
    }
  })

  it('never lets malformed or moved legacy archive metadata block the live store opening', async () => {
    const fixture = await createFixture()
    const databasePath = path.join(fixture.userDataPath, 'mission-store.sqlite')
    let reopened: ReturnType<typeof createElectronMissionStore> | null = null
    try {
      insertMissionEvent(fixture.db, {
        missionId: 'malformed-legacy-mission',
        eventId: 'malformed-legacy-event',
        eventType: 'mission_archived',
        timestamp: '2026-08-29T10:10:00.000Z',
        details: { archive_path: '/placeholder' },
      })
      fixture.db.prepare('UPDATE mission_events SET details_json = ? WHERE id = ?')
        .run('{', 'malformed-legacy-event')
      insertMissionEvent(fixture.db, {
        missionId: 'moved-legacy-mission',
        eventId: 'moved-legacy-event',
        eventType: 'mission_archived',
        timestamp: '2026-08-29T10:11:00.000Z',
        details: {
          archive_path: '/previous-host/sartracker/archives/moved-mission.zip',
          archive_kind: 'direct',
        },
      })
      fixture.db.prepare("DELETE FROM metadata WHERE key = 'legacy_archive_registry_backfill_cursor'")
        .run()
    } finally {
      fixture.close()
    }

    expect(() => {
      reopened = createElectronMissionStore({ userDataPath: fixture.userDataPath })
    }).not.toThrow()
    expect(reopened).not.toBeNull()

    const inspection = new Database(databasePath) as DatabaseConnection
    try {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const count = Number(inspection.prepare(`SELECT COUNT(*) AS count FROM metadata
          WHERE key LIKE 'legacy_archive_registry_issue:%'`).get()?.count ?? 0)
        if (count === 2) break
        await new Promise((resolve) => setTimeout(resolve, 5))
      }
      const issues = inspection.prepare(`SELECT key, value FROM metadata
        WHERE key LIKE 'legacy_archive_registry_issue:%' ORDER BY key`).all()
      expect(issues).toHaveLength(2)
      expect(issues.map((row) => JSON.parse(String(row.value)))).toEqual([
        expect.objectContaining({
          eventId: 'malformed-legacy-event',
          reasonCode: 'malformed_event_details',
        }),
        expect.objectContaining({
          eventId: 'moved-legacy-event',
          reasonCode: 'path_outside_current_custody',
        }),
      ])
    } finally {
      inspection.close()
      await reopened?.prepareClose()
      reopened?.close()
    }
  })

  it('uses the production same-database audit adapter during startup custody reconciliation', async () => {
    const fixture = await createFixture()
    let store: ReturnType<typeof createElectronMissionStore> | null = null
    let inspection: InstanceType<typeof Database> | null = null
    try {
      insertMissionEvent(fixture.db, {
        missionId: 'startup-audit-mission',
        eventId: 'startup-audit-legacy-event',
        eventType: 'mission_archived',
        timestamp: '2026-08-29T10:30:00.000Z',
        status: 'finished',
        details: {
          archive_kind: 'direct',
          archive_path: path.join(fixture.archiveDirectory, 'missing-startup-audit.zip'),
        },
      })
      fixture.db.prepare("DELETE FROM metadata WHERE key = 'legacy_archive_registry_backfill_cursor'")
        .run()
      fixture.db.close()

      store = createElectronMissionStore({ userDataPath: fixture.userDataPath })
      inspection = new Database(path.join(fixture.userDataPath, 'mission-store.sqlite'))
      for (let attempt = 0; attempt < 200; attempt += 1) {
        const event = inspection.prepare(`SELECT details_json FROM mission_events
          WHERE mission_id = 'startup-audit-mission'
            AND event_type = 'mission_archive_unavailable' LIMIT 1`).get()
        if (event !== undefined) break
        await new Promise((resolve) => setTimeout(resolve, 5))
      }
      const event = inspection.prepare(`SELECT details_json FROM mission_events
        WHERE mission_id = 'startup-audit-mission'
          AND event_type = 'mission_archive_unavailable' LIMIT 1`).get()
      expect(event).toBeDefined()
      expect(JSON.parse(String(event?.details_json))).toMatchObject({
        availability: 'missing',
        resulting_status: 'finished',
      })
      expect(inspection.prepare(`SELECT value FROM metadata
        WHERE key = 'archive_registry_reconciliation_failure'`).get()).toBeUndefined()
    } finally {
      inspection?.close()
      if (store !== null) {
        await store.prepareClose()
        store.close()
      }
    }
  })

  it('registers legacy archives asynchronously in bounded 50-event turns after open', async () => {
    const fixture = await createFixture()
    const databasePath = path.join(fixture.userDataPath, 'mission-store.sqlite')
    try {
      for (let index = 0; index < 51; index += 1) {
        const missionId = `migration-legacy-${String(index).padStart(2, '0')}`
        insertMissionEvent(fixture.db, {
          missionId,
          eventId: `migration-legacy-event-${index}`,
          eventType: 'mission_archived',
          timestamp: `2026-08-29T15:${String(index).padStart(2, '0')}:00.000Z`,
          details: {
            archive_path: path.join(fixture.archiveDirectory, `${missionId}.zip`),
            archive_kind: 'direct',
          },
        })
      }
      fixture.db.exec(`
        DROP TABLE mission_cleanup_journal;
        DROP TABLE mission_archive_supplements;
        DROP TABLE mission_archives;
        UPDATE metadata SET value = '12' WHERE key = 'schema_version';
      `)
    } finally {
      fixture.close()
    }

    const migrated = createElectronMissionStore({ userDataPath: fixture.userDataPath })
    const inspection = new Database(databasePath) as DatabaseConnection
    try {
      expect(inspection.prepare('SELECT COUNT(*) AS count FROM mission_archives').get())
        .toEqual({ count: 0 })
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if (inspection.prepare('SELECT COUNT(*) AS count FROM mission_archives').get()?.count === 51) {
          break
        }
        await new Promise((resolve) => setTimeout(resolve, 5))
      }
      expect(inspection.prepare('SELECT COUNT(*) AS count FROM mission_archives').get())
        .toEqual({ count: 51 })
    } finally {
      inspection.close()
      await migrated.prepareClose()
      migrated.close()
    }
  })
})

describe('legacy v1 registry backfill', () => {
  it('determines pending work from bounded metadata without scanning mission evidence', () => {
    const preparedSql: string[] = []
    const database = {
      prepare(sql: string) {
        preparedSql.push(sql)
        if (/FROM metadata/iu.test(sql)) {
          return {
            get(key: unknown) {
              if (key === 'legacy_archive_registry_backfill_cursor') return undefined
              if (key === 'legacy_archive_registry_backfill_target') return undefined
              throw new Error('Unexpected metadata key')
            },
          }
        }
        throw new Error('Pending check attempted to scan mission evidence rows.')
      },
    } as unknown as DatabaseConnection

    expect(readLegacyArchiveRegistryBackfillPending(database)).toBe(1)
    expect(preparedSql).toHaveLength(2)
    expect(preparedSql.every((sql) => !/FROM mission_events/iu.test(sql))).toBe(true)
  })

  it('fails closed on non-canonical or regressed durable scan boundaries', async () => {
    const fixture = await createFixture()
    try {
      fixture.db.prepare(`INSERT INTO metadata (key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
        .run('legacy_archive_registry_backfill_cursor', '01')
      fixture.db.prepare(`INSERT INTO metadata (key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
        .run('legacy_archive_registry_backfill_target', '1')

      expect(readLegacyArchiveRegistryBackfillPending(fixture.db)).toBe(1)
      expect(() => backfillLegacyArchiveRegistry(fixture.db, {
        archiveDirectory: fixture.archiveDirectory,
      })).toThrowError(expect.objectContaining({ code: 'ARCHIVE_REGISTRY_INVALID_STATE' }))

      fixture.db.prepare(`UPDATE metadata SET value = '2'
        WHERE key = 'legacy_archive_registry_backfill_cursor'`).run()
      expect(readLegacyArchiveRegistryBackfillPending(fixture.db)).toBe(1)
      expect(() => backfillLegacyArchiveRegistry(fixture.db, {
        archiveDirectory: fixture.archiveDirectory,
      })).toThrowError(expect.objectContaining({ code: 'ARCHIVE_REGISTRY_INVALID_STATE' }))
    } finally {
      fixture.close()
    }
  })

  it('advances a fixed raw-row scan cursor without starving behind unrelated history', async () => {
    const fixture = await createFixture()
    try {
      for (let index = 0; index < 1_001; index += 1) {
        insertMissionEvent(fixture.db, {
          missionId: 'bounded-scan-mission',
          eventId: `bounded-scan-unrelated-${index}`,
          eventType: 'mission_note_updated',
          timestamp: '2026-08-29T10:00:00.000Z',
          details: { sequence: index },
        })
      }
      const archivePath = path.join(fixture.archiveDirectory, 'bounded-scan-legacy.zip')
      insertMissionEvent(fixture.db, {
        missionId: 'bounded-scan-mission',
        eventId: 'bounded-scan-legacy-archive',
        eventType: 'mission_archived',
        timestamp: '2026-08-29T11:10:00.000Z',
        details: { archive_path: archivePath, archive_kind: 'direct' },
      })
      fixture.db.prepare(`DELETE FROM metadata WHERE key IN (
        'legacy_archive_registry_backfill_cursor',
        'legacy_archive_registry_backfill_target'
      )`).run()

      expect(backfillLegacyArchiveRegistry(fixture.db, {
        archiveDirectory: fixture.archiveDirectory,
      })).toEqual({ processed: 0, quarantined: 0, remaining: 1 })
      expect(fixture.db.prepare(`SELECT value FROM metadata
        WHERE key = 'legacy_archive_registry_backfill_cursor'`).get())
        .toEqual({ value: '1000' })
      expect(fixture.db.prepare(`SELECT value FROM metadata
        WHERE key = 'legacy_archive_registry_backfill_target'`).get())
        .toEqual({ value: '1002' })

      expect(backfillLegacyArchiveRegistry(fixture.db, {
        archiveDirectory: fixture.archiveDirectory,
      })).toEqual({ processed: 1, quarantined: 0, remaining: 0 })
      expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM mission_archives').get())
        .toEqual({ count: 1 })
    } finally {
      fixture.close()
    }
  })

  it('pages archive events rather than starving behind unrelated mission history', async () => {
    const fixture = await createFixture()
    try {
      for (let index = 0; index < 60; index += 1) {
        insertMissionEvent(fixture.db, {
          missionId: 'sparse-legacy-mission',
          eventId: `sparse-unrelated-${index}`,
          eventType: 'mission_note_updated',
          timestamp: `2026-08-29T10:${String(index).padStart(2, '0')}:00.000Z`,
          details: { sequence: index },
        })
      }
      const archivePath = path.join(fixture.archiveDirectory, 'sparse-legacy.zip')
      insertMissionEvent(fixture.db, {
        missionId: 'sparse-legacy-mission',
        eventId: 'sparse-legacy-archive',
        eventType: 'mission_archived',
        timestamp: '2026-08-29T11:10:00.000Z',
        details: { archive_path: archivePath, archive_kind: 'direct' },
      })
      fixture.db.prepare(`DELETE FROM metadata WHERE key IN (
        'legacy_archive_registry_backfill_cursor',
        'legacy_archive_registry_backfill_target'
      )`).run()

      expect(backfillLegacyArchiveRegistry(fixture.db, {
        archiveDirectory: fixture.archiveDirectory,
      })).toEqual({ processed: 1, quarantined: 0, remaining: 0 })
      expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM mission_archives').get())
        .toEqual({ count: 1 })
    } finally {
      fixture.close()
    }
  })

  it('processes at most 50 archive events per turn and is restart-idempotent', async () => {
    const fixture = await createFixture()
    try {
      expect(LEGACY_ARCHIVE_BACKFILL_LIMIT).toBe(50)
      for (let index = 0; index < 51; index += 1) {
        const missionId = `legacy-${String(index).padStart(2, '0')}`
        const archivePath = path.join(fixture.archiveDirectory, `${missionId}.zip`)
        insertMissionEvent(fixture.db, {
          missionId,
          eventId: `legacy-event-${index}`,
          eventType: 'mission_archived',
          timestamp: `2026-08-29T11:${String(index).padStart(2, '0')}:00.000Z`,
          details: { archive_path: archivePath, archive_kind: 'direct' },
        })
      }

      expect(backfillLegacyArchiveRegistry(fixture.db, {
        archiveDirectory: fixture.archiveDirectory,
      })).toEqual({ processed: 50, quarantined: 0, remaining: 1 })
      expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM mission_archives').get())
        .toEqual({ count: 50 })

      expect(backfillLegacyArchiveRegistry(fixture.db, {
        archiveDirectory: fixture.archiveDirectory,
      })).toEqual({ processed: 1, quarantined: 0, remaining: 0 })
      expect(backfillLegacyArchiveRegistry(fixture.db, {
        archiveDirectory: fixture.archiveDirectory,
      })).toEqual({ processed: 0, quarantined: 0, remaining: 0 })
      expect(fixture.db.prepare('SELECT COUNT(*) AS count FROM mission_archives').get())
        .toEqual({ count: 51 })
      expect(fixture.db.prepare(`SELECT container_version, ciphertext_sha256, size_bytes,
          status, slots_json FROM mission_archives ORDER BY legacy_event_rowid LIMIT 1`).get())
        .toEqual({
          container_version: 1,
          ciphertext_sha256: null,
          size_bytes: null,
          status: 'sealed',
          slots_json: '[]',
        })
    } finally {
      fixture.close()
    }
  })

  it('issues a path-bounded unencrypted review ticket only while legacy bytes are present', async () => {
    const fixture = await createFixture()
    try {
      const missionId = 'legacy-review-ticket-mission'
      const archivePath = path.join(fixture.archiveDirectory, 'legacy-review-ticket.zip')
      insertMissionEvent(fixture.db, {
        missionId,
        eventId: 'legacy-review-ticket-event',
        eventType: 'mission_archived',
        timestamp: '2026-08-29T11:30:00.000Z',
        details: { archive_path: archivePath, archive_kind: 'finalized' },
      })
      await writeFile(archivePath, 'LEGACY-PLAINTEXT-ZIP-BYTES')
      fixture.db.prepare("DELETE FROM metadata WHERE key = 'legacy_archive_registry_backfill_cursor'")
        .run()
      expect(backfillLegacyArchiveRegistry(fixture.db, {
        archiveDirectory: fixture.archiveDirectory,
      })).toEqual({ processed: 1, quarantined: 0, remaining: 0 })

      const row = fixture.db.prepare(`SELECT id FROM mission_archives
        WHERE mission_id = ?`).get(missionId)
      const archiveId = String(row?.id)
      fixture.db.prepare(`UPDATE mission_archives SET
        availability = 'present', availability_reason = NULL,
        last_reconciled_at = '2026-08-29T11:31:00.000Z'
        WHERE id = ?`).run(archiveId)
      const observed: Readonly<Record<string, unknown>>[] = []
      const registry = createArchiveRegistry({
        db: fixture.db,
        archiveDirectory: fixture.archiveDirectory,
        appendAuditEvent: createSameDatabaseAuditAdapter(fixture.db, observed),
      })

      expect(registry.issueReviewTicket(archiveId)).toEqual({
        archiveId,
        archiveKind: 'direct',
        archiveRelativePath: 'legacy-review-ticket.zip',
        missionId,
        containerVersion: 1,
        status: 'sealed',
        availability: 'present',
        createdAt: '2026-08-29T11:30:00.000Z',
        verifiedAt: null,
        previousArchiveId: null,
        encrypted: false,
        immutable: true,
        slots: [],
      })
      const sessionId = randomUUID()
      expect(registry.recordReviewOpened({
        archiveId,
        missionId,
        sessionId,
        openedAt: '2026-08-29T11:32:00.000Z',
        slotType: 'legacy_unencrypted',
        plaintextResidual: 'permission_restricted_session_open',
      })).toEqual(expect.any(String))
      expect(observed.at(-1)).toMatchObject({
        eventType: 'mission_archive_review_opened',
        details: {
          archive_id: archiveId,
          session_id: sessionId,
          slot_type: 'legacy_unencrypted',
        },
      })

      fixture.db.prepare(`UPDATE mission_archives SET availability = 'missing'
        WHERE id = ?`).run(archiveId)
      expect(() => registry.issueReviewTicket(archiveId)).toThrowError(
        expect.objectContaining({ code: 'ARCHIVE_REGISTRY_REVIEW_UNAVAILABLE' }),
      )
    } finally {
      fixture.close()
    }
  })
})

describe('archive registry transitions and disk reconciliation', () => {
  it('keeps the protected finalization epoch separate from the later recovery request', async () => {
    const fixture = await createFixture()
    try {
      const archiveId = '12121212-1212-4212-8212-121212121212'
      const requestEventId = '34343434-3434-4434-8434-343434343434'
      const operationId = '56565656-5656-4656-8656-565656565656'
      const relativePath = `${archiveId}.sararch`
      const ciphertextSha256 = 'a'.repeat(64)
      insertMissionEvent(fixture.db, {
        missionId: 'recovery-identity-mission',
        eventId: 'recovery-identity-bootstrap',
        eventType: 'mission_started',
        timestamp: '2026-08-29T11:00:00.000Z',
        details: { status: 'active' },
      })
      fixture.db.prepare(`INSERT INTO mission_events (
        rowid, id, mission_id, event_type, timestamp, details_json, recorded_at,
        recording_completeness
      ) VALUES (5, ?, ?, 'mission_finalized', ?, ?, ?, 'complete')`).run(
        '78787878-7878-4878-8878-787878787878',
        'recovery-identity-mission',
        '2026-08-29T11:05:00.000Z',
        JSON.stringify({ resulting_status: 'finalized' }),
        '2026-08-29T11:05:00.000Z',
      )
      fixture.db.prepare(`INSERT INTO mission_events (
        rowid, id, mission_id, event_type, timestamp, details_json, recorded_at,
        recording_completeness
      ) VALUES (6, ?, ?, 'mission_archive_requested', ?, ?, ?, 'complete')`).run(
        requestEventId,
        'recovery-identity-mission',
        '2026-08-29T11:06:00.000Z',
        JSON.stringify({
          archive_id: archiveId,
          archive_kind: 'finalized_recovery',
          archive_relative_path: relativePath,
          operation_id: operationId,
          protected_finalization_epoch: 5,
        }),
        '2026-08-29T11:06:00.000Z',
      )
      insertMissionEvent(fixture.db, {
        missionId: 'recovery-identity-mission',
        eventId: 'recovery-identity-seal',
        eventType: 'mission_archive_sealed_v2',
        timestamp: '2026-08-29T11:07:00.000Z',
        details: {
          archive_id: archiveId,
          request_event_rowid: 6,
          request_event_id: requestEventId,
          creation_operation_id: operationId,
          protected_finalization_epoch: 5,
          relative_path: relativePath,
          ciphertext_sha256: ciphertextSha256,
          size_bytes: 2048,
          ...creationReceiptEventDetails(),
        },
      })
      const registry = createArchiveRegistry({
        db: fixture.db,
        archiveDirectory: fixture.archiveDirectory,
      })

      expect(registry.registerSealedArchive({
        id: archiveId,
        missionId: 'recovery-identity-mission',
        archiveKind: 'finalized_recovery',
        containerVersion: 2,
        relativePath,
        requestEventRowid: 6,
        requestEventId,
        creationOperationId: operationId,
        protectedFinalizationEpoch: 5,
        ciphertextSha256,
        sizeBytes: 2048,
        createdAt: '2026-08-29T11:07:00.000Z',
        sealedEventId: 'recovery-identity-seal',
        ...creationReceipt(),
        slots: [
          { slotType: 'passphrase', slotId: 'passphrase-main' },
          { slotType: 'recovery', slotId: 'recovery-main' },
        ],
      })).toMatchObject({
        request_event_rowid: 6,
        request_event_id: requestEventId,
        creation_operation_id: operationId,
        protected_finalization_epoch: 5,
      })
      expect(registry.issueVerificationTicket(archiveId)).toMatchObject({
        requestEventRowid: 6,
        requestEventId,
        creationOperationId: operationId,
        protectedFinalizationEpoch: 5,
      })
    } finally {
      fixture.close()
    }
  })

  it('registers a sealed v2 archive only when its custody event agrees', async () => {
    const fixture = await createFixture()
    try {
      const archiveId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      const requestEventId = 'abababab-abab-4bab-8bab-abababababab'
      const creationOperationId = 'acacacac-acac-4cac-8cac-acacacacacac'
      const relativePath = `${archiveId}.sararch`
      const ciphertextSha256 = 'a'.repeat(64)
      const requestEventRowid = insertMissionEvent(fixture.db, {
        missionId: 'mission-alpha',
        eventId: requestEventId,
        eventType: 'mission_finalize_requested',
        timestamp: '2026-08-29T11:59:00.000Z',
        details: {
          archive_id: archiveId,
          archive_kind: 'finalized',
          archive_relative_path: relativePath,
          operation_id: creationOperationId,
          protected_finalization_epoch: null,
        },
      })
      insertMissionEvent(fixture.db, {
        missionId: 'mission-alpha',
        eventId: 'seal-event-alpha',
        eventType: 'mission_archive_sealed_v2',
        timestamp: '2026-08-29T12:00:00.000Z',
        details: {
          archive_id: archiveId,
          request_event_rowid: requestEventRowid,
          request_event_id: requestEventId,
          creation_operation_id: creationOperationId,
          protected_finalization_epoch: null,
          relative_path: relativePath,
          ciphertext_sha256: ciphertextSha256,
          size_bytes: 1234,
          ...creationReceiptEventDetails(),
        },
      })
      const registry = createArchiveRegistry({
        db: fixture.db,
        archiveDirectory: fixture.archiveDirectory,
      })

      expect(() => registry.registerSealedArchive({
        id: archiveId,
        missionId: 'mission-alpha',
        requestEventRowid,
        requestEventId,
        creationOperationId,
        protectedFinalizationEpoch: null,
        archiveKind: 'finalized',
        containerVersion: 2,
        relativePath,
        ciphertextSha256,
        sizeBytes: 1235,
        createdAt: '2026-08-29T12:00:00.000Z',
        sealedEventId: 'seal-event-alpha',
        ...creationReceipt(),
        slots: [
          { slotType: 'passphrase', slotId: 'passphrase-main' },
          { slotType: 'recovery', slotId: 'recovery-main' },
        ],
      })).toThrowError(expect.objectContaining({
        name: 'ArchiveRegistryError',
        code: 'ARCHIVE_REGISTRY_EVENT_MISMATCH',
      }))

      expect(registry.registerSealedArchive({
        id: archiveId,
        missionId: 'mission-alpha',
        requestEventRowid,
        requestEventId,
        creationOperationId,
        protectedFinalizationEpoch: null,
        archiveKind: 'finalized',
        containerVersion: 2,
        relativePath,
        ciphertextSha256,
        sizeBytes: 1234,
        createdAt: '2026-08-29T12:00:00.000Z',
        sealedEventId: 'seal-event-alpha',
        ...creationReceipt(),
        slots: [
          { slotType: 'passphrase', slotId: 'passphrase-main' },
          { slotType: 'recovery', slotId: 'recovery-main' },
        ],
      })).toMatchObject({
        id: archiveId,
        mission_id: 'mission-alpha',
        request_event_rowid: requestEventRowid,
        request_event_id: requestEventId,
        creation_operation_id: creationOperationId,
        protected_finalization_epoch: null,
        status: 'sealed',
      })
    } finally {
      fixture.close()
    }
  })

  it('moves sealed to verified only for the registered ciphertext identity', async () => {
    const fixture = await createFixture()
    try {
      const archiveId = '22222222-2222-4222-8222-222222222222'
      const requestEventId = '33333333-3333-4333-8333-333333333333'
      const creationOperationId = '99999999-9999-4999-8999-999999999999'
      const relativePath = `${archiveId}.sararch`
      const requestDetails = {
        archive_id: archiveId,
        operation_id: creationOperationId,
        archive_kind: 'finalized',
        archive_relative_path: relativePath,
        protected_finalization_epoch: null,
      }
      const archiveBytes = Buffer.alloc(2048, 0x41)
      const ciphertextSha256 = createHash('sha256').update(archiveBytes).digest('hex')
      insertMissionEvent(fixture.db, {
        missionId: 'verify-mission',
        eventId: 'verify-seal-event',
        eventType: 'mission_archive_sealed_v2',
        timestamp: '2026-08-29T12:10:00.000Z',
        details: {
          archive_id: archiveId, request_event_rowid: 9,
          request_event_id: requestEventId,
          creation_operation_id: creationOperationId,
          protected_finalization_epoch: null,
          relative_path: relativePath, ciphertext_sha256: ciphertextSha256,
          size_bytes: 2048,
          ...creationReceiptEventDetails(),
        },
      })
      fixture.db.prepare(`INSERT INTO mission_events (
        rowid, id, mission_id, event_type, timestamp, details_json, recorded_at,
        recording_completeness
      ) VALUES (?, ?, ?, 'mission_finalize_requested', ?, ?, ?, 'complete')`)
        .run(
          9,
          requestEventId,
          'verify-mission',
          '2026-08-29T12:00:00.000Z',
          JSON.stringify(requestDetails),
          '2026-08-29T12:00:00.000Z',
      )
      const auditEvents: Readonly<Record<string, unknown>>[] = []
      let registry = createArchiveRegistry({
        db: fixture.db,
        archiveDirectory: fixture.archiveDirectory,
        appendAuditEvent: () => randomUUID(),
      })
      await writeFile(path.join(fixture.archiveDirectory, relativePath), archiveBytes, {
        mode: 0o600,
      })
      registry.registerSealedArchive({
        id: archiveId, missionId: 'verify-mission', requestEventRowid: 9,
        requestEventId, creationOperationId, protectedFinalizationEpoch: null,
        archiveKind: 'finalized', containerVersion: 2, relativePath,
        ciphertextSha256, sizeBytes: 2048, createdAt: '2026-08-29T12:10:00.000Z',
        sealedEventId: 'verify-seal-event',
        ...creationReceipt(),
        slots: [
          { slotType: 'passphrase', slotId: 'passphrase-main' },
          { slotType: 'recovery', slotId: 'recovery-main' },
        ],
      })

      const issuedTicket = registry.issueVerificationTicket(archiveId)
      expect(issuedTicket).toEqual({
        archiveId,
        archiveKind: 'finalized',
        archiveRelativePath: relativePath,
        missionId: 'verify-mission',
        requestEventRowid: 9,
        requestEventId,
        creationOperationId,
        protectedFinalizationEpoch: null,
        createdAt: '2026-08-29T12:10:00.000Z',
        previousArchiveSha256: null,
        containerVersion: 2,
        schemaVersion: 13,
        inventoryVersion: 1,
        ciphertextSha256,
        sizeBytes: 2048,
        ...creationReceipt(),
      })
      expect(Object.isFrozen(issuedTicket)).toBe(true)
      fixture.db.prepare('UPDATE mission_events SET details_json = ? WHERE id = ?')
        .run('{}', requestEventId)
      expect(() => registry.issueVerificationTicket(archiveId)).toThrowError(
        expect.objectContaining({ code: 'ARCHIVE_REGISTRY_EVENT_MISMATCH' }),
      )
      fixture.db.prepare('UPDATE mission_events SET details_json = ? WHERE id = ?')
        .run(JSON.stringify(requestDetails), requestEventId)
      expect(() => fixture.db.prepare('DELETE FROM mission_events WHERE id = ?')
        .run(requestEventId)).toThrowError(/foreign key/iu)
      expect(registry.issueVerificationTicket(archiveId)).toEqual(issuedTicket)

      expect(() => registry.markVerified({
        archiveId,
        verifiedAt: '2026-08-29T12:20:00.000Z',
        verificationProof: verificationProof({ ciphertextSha256: 'c'.repeat(64) }),
      })).toThrowError(expect.objectContaining({
        code: 'ARCHIVE_REGISTRY_INVALID_PROOF',
      }))
      expect(() => registry.markVerified({
        archiveId,
        verifiedAt: '2026-08-29T12:20:00.000Z',
        verificationProof: { proofVersion: 1, exhaustive: true },
      })).toThrowError(expect.objectContaining({
        code: 'ARCHIVE_REGISTRY_INVALID_PROOF',
      }))
      const staleInspection = inspectArchiveCustodyFile({
        archiveDirectory: fixture.archiveDirectory,
        archiveRelativePath: relativePath,
      })
      await writeFile(
        path.join(fixture.archiveDirectory, relativePath),
        Buffer.alloc(archiveBytes.byteLength, 0x42),
      )
      expect(() => registry.markVerified({
        archiveId,
        verifiedAt: '2026-08-29T12:20:00.000Z',
        verificationProof: verificationProof({
          ciphertextSha256,
          custodyFileIdentity: staleInspection.fileIdentity,
        }),
      })).toThrowError(expect.objectContaining({
        code: 'ARCHIVE_REGISTRY_CUSTODY_CHANGED',
      }))
      expect(registry.getArchive(archiveId)).toMatchObject({ status: 'sealed' })

      await writeFile(path.join(fixture.archiveDirectory, relativePath), archiveBytes)
      const currentInspection = inspectArchiveCustodyFile({
        archiveDirectory: fixture.archiveDirectory,
        archiveRelativePath: relativePath,
      })
      const exhaustiveProof = verificationProof({
        ciphertextSha256,
        custodyFileIdentity: currentInspection.fileIdentity,
      })
      expect(() => registry.markVerified({
        archiveId,
        verifiedAt: '2026-08-29T12:20:00.000Z',
        verificationProof: exhaustiveProof,
      })).toThrowError(expect.objectContaining({
        code: 'ARCHIVE_REGISTRY_EVENT_MISMATCH',
      }))
      expect(registry.getArchive(archiveId)).toMatchObject({ status: 'sealed' })

      registry = createArchiveRegistry({
        db: fixture.db,
        archiveDirectory: fixture.archiveDirectory,
        appendAuditEvent: createSameDatabaseAuditAdapter(fixture.db, auditEvents),
      })
      expect(registry.markVerified({
        archiveId,
        verifiedAt: '2026-08-29T12:20:00.000Z',
        verificationProof: exhaustiveProof,
      })).toMatchObject({
        status: 'verified',
        availability: 'present',
        verified_at: '2026-08-29T12:20:00.000Z',
      })
      expect(auditEvents).toEqual([expect.objectContaining({
        missionId: 'verify-mission',
        eventType: 'mission_archive_verified_v2',
        details: expect.objectContaining({
          archive_id: archiveId,
          ciphertext_sha256: ciphertextSha256,
          relative_path: relativePath,
        }),
      })])

      await rm(path.join(fixture.archiveDirectory, relativePath))
      await expect(registry.reconcileArchiveAvailability()).resolves.toMatchObject({
        inspected: 1,
        unavailable: [{
          archiveId,
          reason: 'Archive file is missing from the registered custody path.',
        }],
        remaining: 0,
      })
      expect(registry.getArchive(archiveId)).toMatchObject({
        status: 'verified',
        availability: 'missing',
        availability_reason: 'Archive file is missing from the registered custody path.',
        last_reconciled_at: expect.any(String),
      })
      expect(auditEvents.map((event) => event.eventType)).toEqual([
        'mission_archive_verified_v2',
        'mission_archive_unavailable',
      ])

      await registry.reconcileArchiveAvailability()
      expect(auditEvents.map((event) => event.eventType)).toEqual([
        'mission_archive_verified_v2',
        'mission_archive_unavailable',
      ])

      await writeFile(path.join(fixture.archiveDirectory, relativePath), archiveBytes)
      await registry.reconcileArchiveAvailability()
      expect(registry.getArchive(archiveId)).toMatchObject({
        status: 'verified',
        availability: 'present',
        availability_reason: null,
      })
      expect(auditEvents.map((event) => event.eventType)).toEqual([
        'mission_archive_verified_v2',
        'mission_archive_unavailable',
        'mission_archive_available',
      ])

      await writeFile(
        path.join(fixture.archiveDirectory, relativePath),
        Buffer.alloc(archiveBytes.byteLength, 0x43),
      )
      await registry.reconcileArchiveAvailability()
      expect(registry.getArchive(archiveId)).toMatchObject({
        status: 'verified',
        availability: 'mismatched',
        availability_reason: expect.stringMatching(/sha-256/iu),
      })
    } finally {
      fixture.close()
    }
  })

  it('records a contiguous supplement chain and keeps prior archive rows immutable', async () => {
    const fixture = await createFixture()
    try {
      const registry = createArchiveRegistry({
        db: fixture.db,
        archiveDirectory: fixture.archiveDirectory,
      })
      for (const [archiveId, minute, hash, previousArchiveId, requestEventId,
        creationOperationId] of [
        [
          '44444444-4444-4444-8444-444444444444',
          10,
          'd'.repeat(64),
          null,
          '46464646-4646-4646-8646-464646464646',
          '47474747-4747-4747-8747-474747474747',
        ],
        [
          '55555555-5555-4555-8555-555555555555',
          11,
          'e'.repeat(64),
          '44444444-4444-4444-8444-444444444444',
          '56565656-5656-4656-8656-565656565656',
          '57575757-5757-4757-8757-575757575757',
        ],
      ] as const) {
        const eventId = `event-${archiveId}`
        const relativePath = `${archiveId}.sararch`
        const requestEventRowid = insertMissionEvent(fixture.db, {
          missionId: 'supplement-mission',
          eventId: requestEventId,
          eventType: 'mission_finalize_requested',
          timestamp: `2026-08-29T13:${minute}:00.000Z`,
          details: {
            archive_id: archiveId,
            archive_kind: 'finalized',
            archive_relative_path: relativePath,
            operation_id: creationOperationId,
            protected_finalization_epoch: null,
          },
        })
        insertMissionEvent(fixture.db, {
          missionId: 'supplement-mission',
          eventId,
          eventType: 'mission_archive_sealed_v2',
          timestamp: `2026-08-29T13:${minute}:00.000Z`,
          details: {
            archive_id: archiveId,
            request_event_rowid: requestEventRowid,
            request_event_id: requestEventId,
            creation_operation_id: creationOperationId,
            protected_finalization_epoch: null,
            relative_path: relativePath,
            ciphertext_sha256: hash,
            size_bytes: 1024 + minute,
            ...creationReceiptEventDetails(),
          },
        })
        registry.registerSealedArchive({
          id: archiveId,
          missionId: 'supplement-mission',
          requestEventRowid,
          requestEventId,
          creationOperationId,
          protectedFinalizationEpoch: null,
          archiveKind: 'finalized', containerVersion: 2, relativePath,
          ciphertextSha256: hash, sizeBytes: 1024 + minute,
          createdAt: `2026-08-29T13:${minute}:00.000Z`, sealedEventId: eventId,
          previousArchiveId,
          ...creationReceipt(),
          slots: [
            { slotType: 'passphrase', slotId: 'passphrase-main' },
            { slotType: 'recovery', slotId: 'recovery-main' },
          ],
        })
      }
      insertMissionEvent(fixture.db, {
        missionId: 'supplement-mission',
        eventId: 'supplement-event',
        eventType: 'mission_archive_supplement_recorded',
        timestamp: '2026-08-29T13:30:00.000Z',
        details: {
          archive_id: '55555555-5555-4555-8555-555555555555',
          previous_archive_id: '44444444-4444-4444-8444-444444444444',
          supplement_sequence: 1,
          authority: 'Duty Admin',
          reason: 'Corrected retained casualty notes.',
          resulting_status: 'finalized',
        },
      })

      expect(registry.recordSupplement({
        id: 'supplement-1', missionId: 'supplement-mission',
        archiveId: '55555555-5555-4555-8555-555555555555',
        previousArchiveId: '44444444-4444-4444-8444-444444444444', supplementSequence: 1,
        authority: 'Duty Admin', reason: 'Corrected retained casualty notes.',
        createdAt: '2026-08-29T13:30:00.000Z', auditEventId: 'supplement-event',
      })).toMatchObject({
        supplement_sequence: 1,
        archive_id: '55555555-5555-4555-8555-555555555555',
      })
      expect(registry.getArchive('44444444-4444-4444-8444-444444444444'))
        .toMatchObject({ status: 'superseded' })
      expect(registry.getArchive('55555555-5555-4555-8555-555555555555')).toMatchObject({
        previous_archive_id: '44444444-4444-4444-8444-444444444444', status: 'sealed',
      })
      expect(registry.listMissionArchives('supplement-mission').map((row) => row.id))
        .toEqual([
          '55555555-5555-4555-8555-555555555555',
          '44444444-4444-4444-8444-444444444444',
        ])
    } finally {
      fixture.close()
    }
  })

  it('records missing availability without changing sealed lifecycle or live mission state', async () => {
    const fixture = await createFixture()
    try {
      const archiveId = '66666666-6666-4666-8666-666666666666'
      const requestEventId = '67676767-6767-4767-8767-676767676767'
      const creationOperationId = '68686868-6868-4868-8868-686868686868'
      const relativePath = `${archiveId}.sararch`
      const requestEventRowid = insertMissionEvent(fixture.db, {
        missionId: 'missing-mission',
        eventId: requestEventId,
        eventType: 'mission_finalize_requested',
        timestamp: '2026-08-29T13:59:00.000Z',
        details: {
          archive_id: archiveId,
          archive_kind: 'finalized',
          archive_relative_path: relativePath,
          operation_id: creationOperationId,
          protected_finalization_epoch: null,
        },
      })
      insertMissionEvent(fixture.db, {
        missionId: 'missing-mission', eventId: 'missing-event',
        eventType: 'mission_archive_sealed_v2', timestamp: '2026-08-29T14:00:00.000Z',
        details: {
          archive_id: archiveId,
          request_event_rowid: requestEventRowid,
          request_event_id: requestEventId,
          creation_operation_id: creationOperationId,
          protected_finalization_epoch: null,
          relative_path: relativePath,
          ciphertext_sha256: 'f'.repeat(64), size_bytes: 4096,
          ...creationReceiptEventDetails(),
        },
      })
      const auditEvents: Readonly<Record<string, unknown>>[] = []
      const registry = createArchiveRegistry({
        db: fixture.db,
        archiveDirectory: fixture.archiveDirectory,
        appendAuditEvent: createSameDatabaseAuditAdapter(fixture.db, auditEvents),
      })
      registry.registerSealedArchive({
        id: archiveId,
        missionId: 'missing-mission',
        requestEventRowid,
        requestEventId,
        creationOperationId,
        protectedFinalizationEpoch: null,
        archiveKind: 'finalized', containerVersion: 2, relativePath,
        ciphertextSha256: 'f'.repeat(64), sizeBytes: 4096,
        createdAt: '2026-08-29T14:00:00.000Z', sealedEventId: 'missing-event',
        ...creationReceipt(),
        slots: [
          { slotType: 'passphrase', slotId: 'passphrase-main' },
          { slotType: 'recovery', slotId: 'recovery-main' },
        ],
      })

      await expect(registry.reconcileArchiveAvailability()).resolves.toEqual({
        inspected: 1,
        unavailable: [{
          archiveId,
          reason: 'Archive file is missing from the registered custody path.',
        }],
        remaining: 0,
      })
      expect(registry.getArchive(archiveId)).toMatchObject({
        status: 'sealed',
        availability: 'missing',
        availability_reason: 'Archive file is missing from the registered custody path.',
      })
      expect(fixture.db.prepare('SELECT status FROM missions WHERE id = ?')
        .get('missing-mission')).toEqual({ status: 'finalized' })
      expect(auditEvents).toEqual([expect.objectContaining({
        missionId: 'missing-mission',
        eventType: 'mission_archive_unavailable',
        details: expect.objectContaining({
          archive_id: archiveId,
          relative_path: relativePath,
          reason: 'Archive file is missing from the registered custody path.',
        }),
      })])

      await writeFile(path.join(fixture.archiveDirectory, relativePath), Buffer.alloc(4095))
      await expect(registry.reconcileArchiveAvailability()).resolves.toMatchObject({
        unavailable: [expect.objectContaining({ reason: expect.stringMatching(/size/iu) })],
      })
    } finally {
      fixture.close()
    }
  })

  it('detects same-size ciphertext substitution instead of restoring custody by size alone', async () => {
    const fixture = await createFixture()
    try {
      const archiveId = '77777777-7777-4777-8777-777777777777'
      const requestEventId = '78787878-7878-4878-8878-787878787878'
      const creationOperationId = '79797979-7979-4979-8979-797979797979'
      const relativePath = `${archiveId}.sararch`
      const archivePath = path.join(fixture.archiveDirectory, relativePath)
      const originalBytes = Buffer.alloc(4096, 0x41)
      const ciphertextSha256 = createHash('sha256').update(originalBytes).digest('hex')
      await writeFile(archivePath, originalBytes, { mode: 0o600 })
      const requestEventRowid = insertMissionEvent(fixture.db, {
        missionId: 'substitution-mission',
        eventId: requestEventId,
        eventType: 'mission_finalize_requested',
        timestamp: '2026-08-29T14:19:00.000Z',
        details: {
          archive_id: archiveId,
          archive_kind: 'finalized',
          archive_relative_path: relativePath,
          operation_id: creationOperationId,
          protected_finalization_epoch: null,
        },
      })
      insertMissionEvent(fixture.db, {
        missionId: 'substitution-mission',
        eventId: 'substitution-seal-event',
        eventType: 'mission_archive_sealed_v2',
        timestamp: '2026-08-29T14:20:00.000Z',
        details: {
          archive_id: archiveId,
          request_event_rowid: requestEventRowid,
          request_event_id: requestEventId,
          creation_operation_id: creationOperationId,
          protected_finalization_epoch: null,
          relative_path: relativePath, ciphertext_sha256: ciphertextSha256,
          size_bytes: originalBytes.byteLength,
          ...creationReceiptEventDetails(),
        },
      })
      const auditEvents: Readonly<Record<string, unknown>>[] = []
      const registry = createArchiveRegistry({
        db: fixture.db,
        archiveDirectory: fixture.archiveDirectory,
        appendAuditEvent: createSameDatabaseAuditAdapter(fixture.db, auditEvents),
      })
      registry.registerSealedArchive({
        id: archiveId, missionId: 'substitution-mission',
        requestEventRowid,
        requestEventId,
        creationOperationId,
        protectedFinalizationEpoch: null,
        archiveKind: 'finalized', containerVersion: 2,
        relativePath, ciphertextSha256, sizeBytes: originalBytes.byteLength,
        createdAt: '2026-08-29T14:20:00.000Z',
        sealedEventId: 'substitution-seal-event',
        ...creationReceipt(),
        slots: [
          { slotType: 'passphrase', slotId: 'passphrase-main' },
          { slotType: 'recovery', slotId: 'recovery-main' },
        ],
      })

      await expect(registry.reconcileArchiveAvailability()).resolves.toMatchObject({
        unavailable: [],
      })
      await writeFile(archivePath, Buffer.alloc(originalBytes.byteLength, 0x42))
      await expect(registry.reconcileArchiveAvailability()).resolves.toMatchObject({
        unavailable: [{
          archiveId,
          reason: expect.stringMatching(/sha-256/iu),
        }],
      })
      expect(registry.getArchive(archiveId)).toMatchObject({
        status: 'sealed',
        availability: 'mismatched',
        availability_reason: expect.stringMatching(/sha-256/iu),
      })
      expect(auditEvents).toEqual([
        expect.objectContaining({ eventType: 'mission_archive_unavailable' }),
      ])
    } finally {
      fixture.close()
    }
  })

  it('records a non-regular custody path distinctly without changing archive lifecycle', async () => {
    const fixture = await createFixture()
    try {
      seedLegacyArchiveRows(fixture.db, fixture.archiveDirectory, ['legacy-directory.zip'])
      const auditEvents: Readonly<Record<string, unknown>>[] = []
      const registry = createArchiveRegistry({
        db: fixture.db,
        archiveDirectory: fixture.archiveDirectory,
        appendAuditEvent: createSameDatabaseAuditAdapter(fixture.db, auditEvents),
        startCustodyReconciliation: ({ ticket }) => completedCustodyOperation(
          ticket,
          'not_regular',
        ),
      })

      await expect(registry.reconcileArchiveAvailability({ limit: 1 }))
        .resolves.toMatchObject({
          inspected: 1,
          unavailable: [expect.objectContaining({
            reason: 'Archive custody path is not a regular file.',
          })],
        })
      expect(registry.listMissionArchives('legacy-reconcile-mission')[0]).toMatchObject({
        status: 'sealed',
        availability: 'not_regular',
        availability_reason: 'Archive custody path is not a regular file.',
      })
      expect(auditEvents).toEqual([expect.objectContaining({
        eventType: 'mission_archive_unavailable',
        details: expect.objectContaining({ availability: 'not_regular' }),
      })])
    } finally {
      fixture.close()
    }
  })

  it('resumes oldest-first custody reconciliation fairly across short restarts', async () => {
    const fixture = await createFixture()
    try {
      const names = ['legacy-one.zip', 'legacy-two.zip', 'legacy-three.zip'] as const
      seedLegacyArchiveRows(fixture.db, fixture.archiveDirectory, names)
      const observed: string[] = []
      for (let turn = 0; turn < names.length; turn += 1) {
        const registry = createArchiveRegistry({
          db: fixture.db,
          archiveDirectory: fixture.archiveDirectory,
          startCustodyReconciliation: ({ ticket }) => {
            observed.push(String(ticket.archiveRelativePath))
            return completedCustodyOperation(ticket)
          },
        })
        await expect(registry.reconcileArchiveAvailability({ limit: 1 }))
          .resolves.toMatchObject({ inspected: 1 })
      }
      expect(observed).toEqual(names)
      expect(fixture.db.prepare(`SELECT COUNT(*) AS count FROM mission_archives
        WHERE last_reconciled_at IS NOT NULL`).get()).toEqual({ count: 3 })
    } finally {
      fixture.close()
    }
  })

  it('rehashes one exact requested archive without touching an older registry row', async () => {
    const fixture = await createFixture()
    try {
      seedLegacyArchiveRows(
        fixture.db,
        fixture.archiveDirectory,
        ['legacy-older.zip', 'legacy-selected.zip'],
      )
      const selected = fixture.db.prepare(`SELECT id FROM mission_archives
        WHERE relative_path = ?`).get('legacy-selected.zip') as { readonly id: string }
      const observed: string[] = []
      const registry = createArchiveRegistry({
        db: fixture.db,
        archiveDirectory: fixture.archiveDirectory,
        startCustodyReconciliation: ({ ticket }) => {
          observed.push(String(ticket.archiveRelativePath))
          return completedCustodyOperation(ticket)
        },
      })

      await expect(registry.reconcileArchiveAvailability({ archiveId: selected.id }))
        .resolves.toMatchObject({ inspected: 1, unavailable: [], remaining: 0 })
      expect(observed).toEqual(['legacy-selected.zip'])
      expect(fixture.db.prepare(`SELECT relative_path, last_reconciled_at
        FROM mission_archives ORDER BY legacy_event_rowid`).all()).toMatchObject([
        { relative_path: 'legacy-older.zip', last_reconciled_at: null },
        { relative_path: 'legacy-selected.zip', last_reconciled_at: expect.any(String) },
      ])
    } finally {
      fixture.close()
    }
  })

  it('commits each completed custody row before a later worker failure', async () => {
    const fixture = await createFixture()
    try {
      seedLegacyArchiveRows(
        fixture.db,
        fixture.archiveDirectory,
        ['legacy-one.zip', 'legacy-two.zip', 'legacy-three.zip'],
      )
      let call = 0
      const firstRegistry = createArchiveRegistry({
        db: fixture.db,
        archiveDirectory: fixture.archiveDirectory,
        startCustodyReconciliation: ({ ticket }) => {
          call += 1
          return call === 1
            ? completedCustodyOperation(ticket)
            : rejectedCustodyOperation(new Error('injected worker failure'))
        },
      })
      await expect(firstRegistry.reconcileArchiveAvailability({ limit: 2 }))
        .rejects.toThrow(/injected worker failure/iu)
      expect(fixture.db.prepare(`SELECT relative_path, last_reconciled_at
        FROM mission_archives ORDER BY legacy_event_rowid`).all()).toMatchObject([
        { relative_path: 'legacy-one.zip', last_reconciled_at: expect.any(String) },
        { relative_path: 'legacy-two.zip', last_reconciled_at: null },
        { relative_path: 'legacy-three.zip', last_reconciled_at: null },
      ])

      const resumed: string[] = []
      const secondRegistry = createArchiveRegistry({
        db: fixture.db,
        archiveDirectory: fixture.archiveDirectory,
        startCustodyReconciliation: ({ ticket }) => {
          resumed.push(String(ticket.archiveRelativePath))
          return completedCustodyOperation(ticket)
        },
      })
      await secondRegistry.reconcileArchiveAvailability({ limit: 1 })
      expect(resumed).toEqual(['legacy-two.zip'])
    } finally {
      fixture.close()
    }
  })

  it('rolls back custody observations when the audit event is not in the same database', async () => {
    const fixture = await createFixture()
    try {
      seedLegacyArchiveRows(fixture.db, fixture.archiveDirectory, ['missing-direct.zip'])
      fixture.db.prepare("UPDATE missions SET status = 'finished' WHERE id = ?")
        .run('legacy-reconcile-mission')
      let registry = createArchiveRegistry({
        db: fixture.db,
        archiveDirectory: fixture.archiveDirectory,
        appendAuditEvent: () => randomUUID(),
        startCustodyReconciliation: ({ ticket }) => completedCustodyOperation(ticket, 'missing'),
      })
      await expect(registry.reconcileArchiveAvailability({ limit: 1 }))
        .rejects.toMatchObject({ code: 'ARCHIVE_REGISTRY_EVENT_MISMATCH' })
      expect(registry.listMissionArchives('legacy-reconcile-mission')[0]).toMatchObject({
        availability: 'unknown',
        last_reconciled_at: null,
      })

      const auditEvents: Readonly<Record<string, unknown>>[] = []
      registry = createArchiveRegistry({
        db: fixture.db,
        archiveDirectory: fixture.archiveDirectory,
        appendAuditEvent: createSameDatabaseAuditAdapter(fixture.db, auditEvents),
        startCustodyReconciliation: ({ ticket }) => completedCustodyOperation(ticket, 'missing'),
      })
      await registry.reconcileArchiveAvailability({ limit: 1 })
      expect(auditEvents).toEqual([expect.objectContaining({
        eventType: 'mission_archive_unavailable',
        details: expect.objectContaining({ resulting_status: 'finished' }),
      })])
    } finally {
      fixture.close()
    }
  })
})
