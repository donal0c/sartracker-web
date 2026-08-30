import path from 'node:path'
import { createRequire } from 'node:module'

import { describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')
const { canonicalJson } = require('../../electron/archive-container.cjs') as {
  readonly canonicalJson: (value: unknown) => string
}
const {
  ACTIVE_ARCHIVE_CUSTODY_JOURNAL_KEY,
  createArchiveCustodyJournal,
} = require('../../electron/archive-custody-journal.cjs') as {
  readonly ACTIVE_ARCHIVE_CUSTODY_JOURNAL_KEY: string
  readonly createArchiveCustodyJournal: (input: {
    readonly db: InstanceType<typeof Database>
    readonly archiveDirectory: string
    readonly now?: () => string
    readonly randomUuid?: () => string
    readonly runCustodyOperation?: (
      ticket: Readonly<Record<string, unknown>>,
      signal?: AbortSignal,
    ) => Promise<Readonly<Record<string, unknown>>>
  }) => {
    readonly planBuildingWithinTransaction: (
      input: Readonly<Record<string, unknown>>,
    ) => Readonly<Record<string, unknown>>
    readonly readActive: () => Readonly<Record<string, unknown>> | null
    readonly readTerminal: (operationId: string) => Readonly<Record<string, unknown>> | null
    readonly recordPublishPrepared: (
      input: Readonly<Record<string, unknown>>,
    ) => Readonly<Record<string, unknown>>
    readonly publishPrepared: (input: {
      readonly operationId: string
      readonly expectedRevision: number
      readonly signal?: AbortSignal
    }) => Promise<Readonly<Record<string, unknown>>>
    readonly completeRegisteredWithinTransaction: (
      input: Readonly<Record<string, unknown>>,
    ) => Readonly<Record<string, unknown>>
    readonly reconcileActive: (input?: {
      readonly signal?: AbortSignal
    }) => Promise<Readonly<Record<string, unknown>> | null>
  }
}

const archiveDirectory = path.resolve('/tmp/sartracker-custody-journal/archives')
const operationId = '11111111-1111-4111-8111-111111111111'
const archiveId = '22222222-2222-4222-8222-222222222222'
const requestEventId = '33333333-3333-4333-8333-333333333333'
const quarantineId = '44444444-4444-4444-8444-444444444444'
const maintenanceOperationId = '55555555-5555-4555-8555-555555555555'
const sealedEventId = '66666666-6666-4666-8666-666666666666'
const finalizedEventId = '77777777-7777-4777-8777-777777777777'
const timestamp = '2026-08-29T22:00:00.000Z'

/** Creates only the durable tables owned by this focused journal boundary. */
function createDatabase() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE missions (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL
    );
    CREATE TABLE mission_events (
      id TEXT PRIMARY KEY,
      mission_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      details_json TEXT
    );
    CREATE TABLE mission_archives (
      id TEXT PRIMARY KEY,
      mission_id TEXT NOT NULL,
      request_event_rowid INTEGER NOT NULL,
      request_event_id TEXT NOT NULL,
      creation_operation_id TEXT,
      protected_finalization_epoch INTEGER,
      archive_kind TEXT NOT NULL,
      container_version INTEGER NOT NULL,
      relative_path TEXT NOT NULL,
      ciphertext_sha256 TEXT,
      size_bytes INTEGER,
      created_at TEXT NOT NULL,
      sealed_event_id TEXT,
      frame_count INTEGER,
      header_sha256 TEXT,
      manifest_sha256 TEXT,
      entry_count INTEGER,
      table_count INTEGER,
      previous_archive_id TEXT,
      status TEXT NOT NULL,
      slots_json TEXT NOT NULL
    );
    INSERT INTO missions (id, status) VALUES ('mission-a', 'finished');
  `)
  return db
}

/** Returns one exact journal-before-create identity without any secret. */
function buildingInput(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    operationId,
    archiveId,
    missionId: 'mission-a',
    requestEventRowid: 42,
    requestEventId,
    archiveKind: 'finalized',
    protectedFinalizationEpoch: null,
    previousArchiveId: null,
    previousArchiveSha256: null,
    fenceRequestedAt: '2026-08-29T21:59:59.000Z',
    createdAt: timestamp,
    temporaryRelativePath: `.staging/${operationId}/${archiveId}.sararch.tmp`,
    finalRelativePath: `${archiveId}.sararch`,
    ...overrides,
  }
}

/** Returns the closed, non-secret receipt emitted by the create worker. */
function creationReceipt(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    containerVersion: 2,
    schemaVersion: 13,
    inventoryVersion: 1,
    ciphertextSha256: 'a'.repeat(64),
    sizeBytes: 4096,
    frameCount: 8,
    headerSha256: 'b'.repeat(64),
    manifestSha256: 'c'.repeat(64),
    inventorySha256: 'd'.repeat(64),
    entryCount: 4,
    tableCount: 49,
    slots: [
      { slotType: 'passphrase', slotId: 'passphrase-v1' },
      { slotType: 'recovery', slotId: 'recovery-v1' },
    ],
    temporaryFileIdentity: {
      changedTimeNanoseconds: '4',
      device: '1',
      inode: '2',
      linkCount: 1,
      modifiedTimeNanoseconds: '3',
      sizeBytes: 4096,
    },
    plaintextCleanupConfirmed: true,
    kdfDurationMs: 250,
    ...overrides,
  }
}

/** Creates one result that exactly echoes a journal-issued maintenance ticket. */
function resultFor(
  ticket: Readonly<Record<string, unknown>>,
  outcome: string,
  overrides: Readonly<Record<string, unknown>> = {},
) {
  return {
    type: 'complete',
    protocolVersion: 1,
    maintenanceOperationId: ticket.maintenanceOperationId,
    creationOperationId: ticket.creationOperationId,
    journalRevision: ticket.journalRevision,
    action: ticket.action,
    sourceRelativePath: ticket.sourceRelativePath,
    targetRelativePath: ticket.targetRelativePath,
    outcome,
    sourceIdentity: null,
    targetIdentity: null,
    directoriesSynced: true,
    ...overrides,
  }
}

/** Inserts the complete registry, audit, and mission witness produced by one seal transaction. */
function insertCompleteRegistryWitness(
  db: InstanceType<typeof Database>,
  overrides: {
    readonly archive?: Readonly<Record<string, unknown>>
    readonly requestDetails?: Readonly<Record<string, unknown>>
    readonly sealDetails?: Readonly<Record<string, unknown>>
    readonly missionStatus?: string
    readonly omitFinalizedEvent?: boolean
  } = {},
) {
  const receipt = creationReceipt()
  const requestDetails = {
    resulting_status: 'finished',
    archive_id: archiveId,
    operation_id: operationId,
    archive_kind: 'finalized',
    archive_relative_path: `${archiveId}.sararch`,
    protected_finalization_epoch: null,
    ...overrides.requestDetails,
  }
  const sealDetails = {
    archive_id: archiveId,
    request_event_rowid: 42,
    request_event_id: requestEventId,
    creation_operation_id: operationId,
    protected_finalization_epoch: null,
    relative_path: `${archiveId}.sararch`,
    ciphertext_sha256: receipt.ciphertextSha256,
    size_bytes: receipt.sizeBytes,
    frame_count: receipt.frameCount,
    header_sha256: receipt.headerSha256,
    manifest_sha256: receipt.manifestSha256,
    inventory_sha256: receipt.inventorySha256,
    entry_count: receipt.entryCount,
    table_count: receipt.tableCount,
    publish_file_identity: receipt.temporaryFileIdentity,
    resulting_status: 'finalized',
    ...overrides.sealDetails,
  }
  db.prepare('UPDATE missions SET status = ? WHERE id = ?')
    .run(overrides.missionStatus ?? 'finalized', 'mission-a')
  db.prepare(`INSERT INTO mission_events (
    rowid, id, mission_id, event_type, timestamp, details_json
  ) VALUES (42, ?, 'mission-a', 'mission_finalize_requested', ?, ?)`)
    .run(requestEventId, '2026-08-29T21:59:59.000Z', JSON.stringify(requestDetails))
  db.prepare(`INSERT INTO mission_events (
    rowid, id, mission_id, event_type, timestamp, details_json
  ) VALUES (43, ?, 'mission-a', 'mission_archive_sealed_v2', ?, ?)`)
    .run(sealedEventId, timestamp, JSON.stringify(sealDetails))
  if (overrides.omitFinalizedEvent !== true) {
    db.prepare(`INSERT INTO mission_events (
      rowid, id, mission_id, event_type, timestamp, details_json
    ) VALUES (44, ?, 'mission-a', 'mission_finalized', ?, ?)`)
      .run(finalizedEventId, timestamp, JSON.stringify({
        resulting_status: 'finalized',
        archive_id: archiveId,
        archive_path: path.join(archiveDirectory, `${archiveId}.sararch`),
        archive_relative_path: `${archiveId}.sararch`,
        container_version: 2,
      }))
  }
  const archive = {
    id: archiveId,
    mission_id: 'mission-a',
    request_event_rowid: 42,
    request_event_id: requestEventId,
    creation_operation_id: operationId,
    protected_finalization_epoch: null,
    archive_kind: 'finalized',
    container_version: 2,
    relative_path: `${archiveId}.sararch`,
    ciphertext_sha256: receipt.ciphertextSha256,
    size_bytes: receipt.sizeBytes,
    created_at: timestamp,
    sealed_event_id: sealedEventId,
    frame_count: receipt.frameCount,
    header_sha256: receipt.headerSha256,
    manifest_sha256: receipt.manifestSha256,
    entry_count: receipt.entryCount,
    table_count: receipt.tableCount,
    previous_archive_id: null,
    status: 'sealed',
    slots_json: canonicalJson(receipt.slots),
    ...overrides.archive,
  }
  db.prepare(`INSERT INTO mission_archives (
    id, mission_id, request_event_rowid, request_event_id,
    creation_operation_id, protected_finalization_epoch, archive_kind,
    container_version, relative_path, ciphertext_sha256, size_bytes, created_at,
    sealed_event_id, frame_count, header_sha256, manifest_sha256, entry_count,
    table_count, previous_archive_id, status, slots_json
  ) VALUES (
    @id, @mission_id, @request_event_rowid, @request_event_id,
    @creation_operation_id, @protected_finalization_epoch, @archive_kind,
    @container_version, @relative_path, @ciphertext_sha256, @size_bytes, @created_at,
    @sealed_event_id, @frame_count, @header_sha256, @manifest_sha256, @entry_count,
    @table_count, @previous_archive_id, @status, @slots_json
  )`).run(archive)
}

describe('archive custody metadata journal', () => {
  it('durably plans exact staging and final paths before create and admits only one active lane', () => {
    const db = createDatabase()
    try {
      const journal = createArchiveCustodyJournal({ db, archiveDirectory })
      const planned = db.transaction(() => journal.planBuildingWithinTransaction(
        buildingInput(),
      )).immediate()

      expect(planned).toMatchObject({
        journalVersion: 1,
        revision: 1,
        state: 'building',
        operationId,
        archiveId,
        temporaryRelativePath: `.staging/${operationId}/${archiveId}.sararch.tmp`,
        finalRelativePath: `${archiveId}.sararch`,
        receipt: null,
        quarantine: null,
      })
      expect(JSON.parse(db.prepare('SELECT value FROM metadata WHERE key = ?')
        .get(ACTIVE_ARCHIVE_CUSTODY_JOURNAL_KEY).value)).toEqual(planned)
      expect(() => journal.planBuildingWithinTransaction(buildingInput({
        operationId: '66666666-6666-4666-8666-666666666666',
        archiveId: '77777777-7777-4777-8777-777777777777',
        temporaryRelativePath: '.staging/66666666-6666-4666-8666-666666666666/77777777-7777-4777-8777-777777777777.sararch.tmp',
        finalRelativePath: '77777777-7777-4777-8777-777777777777.sararch',
      }))).toThrow(/active archive custody operation/iu)
    } finally {
      db.close()
    }
  })

  it('records the closed creation receipt before publish and seals registry plus terminal journal atomically', async () => {
    const db = createDatabase()
    const observedStates: string[] = []
    try {
      const journal = createArchiveCustodyJournal({
        db,
        archiveDirectory,
        now: () => timestamp,
        randomUuid: () => maintenanceOperationId,
        runCustodyOperation: async (ticket) => {
          observedStates.push(String(journal.readActive()?.state))
          return resultFor(ticket, 'moved', {
            targetIdentity: creationReceipt().temporaryFileIdentity,
          })
        },
      })
      journal.planBuildingWithinTransaction(buildingInput())
      const prepared = journal.recordPublishPrepared({
        operationId,
        expectedRevision: 1,
        receipt: creationReceipt(),
        observedAt: timestamp,
      })
      expect(prepared).toMatchObject({ state: 'publish_prepared', revision: 2 })

      await expect(journal.publishPrepared({ operationId, expectedRevision: 2 }))
        .resolves.toMatchObject({ outcome: 'moved' })
      expect(observedStates).toEqual(['publish_prepared'])
      expect(journal.readActive()).toMatchObject({ state: 'publish_prepared', revision: 2 })

      expect(() => db.transaction(() => {
        insertCompleteRegistryWitness(db)
        journal.completeRegisteredWithinTransaction({
          operationId,
          expectedRevision: 2,
          registeredAt: timestamp,
        })
        throw new Error('rollback complete seal')
      }).immediate()).toThrow(/rollback complete seal/iu)
      expect(journal.readActive()).toMatchObject({ state: 'publish_prepared' })
      expect(journal.readTerminal(operationId)).toBeNull()

      db.transaction(() => {
        insertCompleteRegistryWitness(db)
        journal.completeRegisteredWithinTransaction({
          operationId,
          expectedRevision: 2,
          registeredAt: timestamp,
        })
      }).immediate()
      expect(journal.readActive()).toBeNull()
      expect(journal.readTerminal(operationId)).toMatchObject({
        state: 'registered', revision: 3, settledAt: timestamp,
      })
    } finally {
      db.close()
    }
  })

  it('quarantines the exact published bytes after a kill between rename and seal', async () => {
    const db = createDatabase()
    const runCustodyOperation = vi.fn(async (ticket: Readonly<Record<string, unknown>>) => {
      const active = JSON.parse(db.prepare('SELECT value FROM metadata WHERE key = ?')
        .get(ACTIVE_ARCHIVE_CUSTODY_JOURNAL_KEY).value)
      expect(active).toMatchObject({
        state: 'quarantine_planned',
        revision: 3,
        quarantine: {
          quarantineId,
          relativePath: `quarantine/orphan-${quarantineId}/${archiveId}.sararch`,
        },
      })
      return resultFor(ticket, 'moved')
    })
    try {
      const beforeCrash = createArchiveCustodyJournal({
        db,
        archiveDirectory,
        now: () => timestamp,
        randomUuid: () => maintenanceOperationId,
        runCustodyOperation: async (ticket) => resultFor(ticket, 'moved'),
      })
      beforeCrash.planBuildingWithinTransaction(buildingInput())
      beforeCrash.recordPublishPrepared({
        operationId, expectedRevision: 1, receipt: creationReceipt(), observedAt: timestamp,
      })
      await beforeCrash.publishPrepared({ operationId, expectedRevision: 2 })

      const reopened = createArchiveCustodyJournal({
        db,
        archiveDirectory,
        now: () => timestamp,
        randomUuid: vi.fn()
          .mockReturnValueOnce(quarantineId)
          .mockReturnValueOnce(maintenanceOperationId),
        runCustodyOperation,
      })
      await expect(reopened.reconcileActive()).resolves.toMatchObject({
        state: 'quarantined', revision: 4,
      })
      expect(runCustodyOperation).toHaveBeenCalledTimes(1)
      expect(reopened.readActive()).toBeNull()
      expect(reopened.readTerminal(operationId)).toMatchObject({
        state: 'quarantined',
        quarantine: { quarantineId },
      })
      expect(db.prepare('SELECT COUNT(*) AS count FROM mission_archives').get())
        .toEqual({ count: 0 })
    } finally {
      db.close()
    }
  })

  it('resumes an already-planned quarantine after kill without allocating or moving twice', async () => {
    const db = createDatabase()
    let killAfterMove = true
    try {
      const journal = createArchiveCustodyJournal({
        db,
        archiveDirectory,
        now: () => timestamp,
        randomUuid: vi.fn()
          .mockReturnValueOnce(quarantineId)
          .mockReturnValue(maintenanceOperationId),
        runCustodyOperation: async (ticket) => {
          if (killAfterMove) {
            killAfterMove = false
            throw new Error('simulated SIGKILL after rename')
          }
          return resultFor(ticket, 'target_only')
        },
      })
      journal.planBuildingWithinTransaction(buildingInput())
      journal.recordPublishPrepared({
        operationId, expectedRevision: 1, receipt: creationReceipt(), observedAt: timestamp,
      })

      await expect(journal.reconcileActive()).rejects.toThrow(/SIGKILL/iu)
      expect(journal.readActive()).toMatchObject({
        state: 'quarantine_planned', revision: 3,
        quarantine: { quarantineId },
      })
      await expect(journal.reconcileActive()).resolves.toMatchObject({
        state: 'quarantined', revision: 4,
      })
      expect(journal.readTerminal(operationId)).toMatchObject({
        state: 'quarantined', quarantine: { quarantineId },
      })
    } finally {
      db.close()
    }
  })

  it.each([
    ['both_present', 'conflict'],
    ['neither_present', 'missing'],
    ['not_regular', 'conflict'],
  ])('preserves a publish-recovery %s observation as terminal %s', async (
    outcome,
    expectedState,
  ) => {
    const db = createDatabase()
    try {
      const randomUuid = vi.fn()
        .mockReturnValueOnce(quarantineId)
        .mockReturnValue(maintenanceOperationId)
      const journal = createArchiveCustodyJournal({
        db,
        archiveDirectory,
        now: () => timestamp,
        randomUuid,
        runCustodyOperation: async (ticket) => resultFor(ticket, outcome),
      })
      journal.planBuildingWithinTransaction(buildingInput())
      journal.recordPublishPrepared({
        operationId, expectedRevision: 1, receipt: creationReceipt(), observedAt: timestamp,
      })

      await expect(journal.reconcileActive()).resolves.toMatchObject({ state: expectedState })
      expect(journal.readTerminal(operationId)).toMatchObject({ state: expectedState })
      expect(journal.readActive()).toBeNull()
    } finally {
      db.close()
    }
  })

  it('repairs a matching registry witness without touching the filesystem', async () => {
    const db = createDatabase()
    const runCustodyOperation = vi.fn()
    try {
      const journal = createArchiveCustodyJournal({
        db, archiveDirectory, now: () => timestamp, runCustodyOperation,
      })
      journal.planBuildingWithinTransaction(buildingInput())
      journal.recordPublishPrepared({
        operationId, expectedRevision: 1, receipt: creationReceipt(), observedAt: timestamp,
      })
      insertCompleteRegistryWitness(db)

      await expect(journal.reconcileActive()).resolves.toMatchObject({ state: 'registered' })
      expect(runCustodyOperation).not.toHaveBeenCalled()
    } finally {
      db.close()
    }
  })

  it.each([
    ['archive kind', { archive: { archive_kind: 'direct' } }],
    ['protected epoch', { archive: { protected_finalization_epoch: 5 } }],
    ['container receipt', { archive: { frame_count: 9 } }],
    ['slot projection', { archive: { slots_json: '[]' } }],
    ['seal event identity', {
      archive: { sealed_event_id: '88888888-8888-4888-8888-888888888888' },
    }],
    ['seal inventory receipt', { sealDetails: { inventory_sha256: 'e'.repeat(64) } }],
    ['mission lifecycle state', { missionStatus: 'finished' }],
    ['mission finalization audit', { omitFinalizedEvent: true }],
  ])('does not repair registration from a partial %s witness', (_label, witnessOverrides) => {
    const db = createDatabase()
    try {
      const journal = createArchiveCustodyJournal({ db, archiveDirectory })
      journal.planBuildingWithinTransaction(buildingInput())
      journal.recordPublishPrepared({
        operationId, expectedRevision: 1, receipt: creationReceipt(), observedAt: timestamp,
      })
      insertCompleteRegistryWitness(db, witnessOverrides)

      expect(() => db.transaction(() => journal.completeRegisteredWithinTransaction({
        operationId,
        expectedRevision: 2,
        registeredAt: timestamp,
      })).immediate()).toThrowError(expect.objectContaining({
        code: 'ARCHIVE_CUSTODY_JOURNAL_REGISTRY_MISMATCH',
      }))
      expect(journal.readActive()).toMatchObject({ state: 'publish_prepared', revision: 2 })
      expect(journal.readTerminal(operationId)).toBeNull()
    } finally {
      db.close()
    }
  })

  it('settles a registry race during quarantine as an explicit durable conflict', async () => {
    const db = createDatabase()
    try {
      let registeredRowBeforeSettlement: Readonly<Record<string, unknown>> | null = null
      const journal = createArchiveCustodyJournal({
        db,
        archiveDirectory,
        now: () => timestamp,
        randomUuid: vi.fn()
          .mockReturnValueOnce(quarantineId)
          .mockReturnValueOnce(maintenanceOperationId),
        runCustodyOperation: async (ticket) => {
          insertCompleteRegistryWitness(db)
          registeredRowBeforeSettlement = db.prepare('SELECT * FROM mission_archives WHERE id = ?')
            .get(archiveId)
          return resultFor(ticket, 'moved')
        },
      })
      journal.planBuildingWithinTransaction(buildingInput())
      journal.recordPublishPrepared({
        operationId, expectedRevision: 1, receipt: creationReceipt(), observedAt: timestamp,
      })

      await expect(journal.reconcileActive()).resolves.toMatchObject({
        state: 'conflict',
        lastErrorCode: 'registry_appeared_during_quarantine',
      })
      expect(journal.readActive()).toBeNull()
      expect(journal.readTerminal(operationId)).toMatchObject({
        state: 'conflict',
        lastErrorCode: 'registry_appeared_during_quarantine',
      })
      expect(db.prepare('SELECT * FROM mission_archives WHERE id = ?').get(archiveId))
        .toEqual(registeredRowBeforeSettlement)
    } finally {
      db.close()
    }
  })

  it('plans cleanup before sweeping an interrupted building operation', async () => {
    const db = createDatabase()
    try {
      const journal = createArchiveCustodyJournal({
        db,
        archiveDirectory,
        now: () => timestamp,
        randomUuid: () => maintenanceOperationId,
        runCustodyOperation: async (ticket) => {
          expect(journal.readActive()).toMatchObject({
            state: 'staging_cleanup_planned', revision: 2,
          })
          expect(ticket).toMatchObject({
            action: 'staging_cleanup',
            sourceRelativePath: `.staging/${operationId}`,
            targetRelativePath: null,
          })
          return resultFor(ticket, 'removed')
        },
      })
      journal.planBuildingWithinTransaction(buildingInput())

      await expect(journal.reconcileActive()).resolves.toMatchObject({
        state: 'staging_removed', revision: 3,
      })
      expect(journal.readActive()).toBeNull()
    } finally {
      db.close()
    }
  })

  it('rejects stale revisions and substituted maintenance results without inventing custody state', async () => {
    const db = createDatabase()
    try {
      const journal = createArchiveCustodyJournal({
        db,
        archiveDirectory,
        now: () => timestamp,
        randomUuid: () => maintenanceOperationId,
        runCustodyOperation: async (ticket) => resultFor(ticket, 'moved', {
          creationOperationId: '66666666-6666-4666-8666-666666666666',
        }),
      })
      journal.planBuildingWithinTransaction(buildingInput())
      expect(() => journal.recordPublishPrepared({
        operationId, expectedRevision: 2, receipt: creationReceipt(), observedAt: timestamp,
      })).toThrow(/revision/iu)
      journal.recordPublishPrepared({
        operationId, expectedRevision: 1, receipt: creationReceipt(), observedAt: timestamp,
      })

      await expect(journal.publishPrepared({ operationId, expectedRevision: 2 }))
        .rejects.toThrow(/substituted/iu)
      expect(journal.readActive()).toMatchObject({ state: 'publish_prepared', revision: 2 })
      expect(journal.readTerminal(operationId)).toBeNull()
    } finally {
      db.close()
    }
  })

  it('does not report a failed custody action until its physical worker has exited', async () => {
    const db = createDatabase()
    let rejectOperation!: (error: Error) => void
    let resolveWorkerExit!: () => void
    try {
      const operation = new Promise<Readonly<Record<string, unknown>>>((_, reject) => {
        rejectOperation = reject
      })
      const workerExited = new Promise<void>((resolve) => { resolveWorkerExit = resolve })
      Object.defineProperty(operation, 'workerExited', { value: workerExited })
      const journal = createArchiveCustodyJournal({
        db,
        archiveDirectory,
        now: () => timestamp,
        randomUuid: () => maintenanceOperationId,
        runCustodyOperation: () => operation,
      })
      journal.planBuildingWithinTransaction(buildingInput())

      let observed: unknown = null
      const recovery = journal.reconcileActive().catch((error: unknown) => {
        observed = error
      })
      rejectOperation(new Error('simulated worker failure'))
      const outcomeBeforePhysicalExit = await Promise.race([
        recovery.then(() => 'settled'),
        new Promise<string>((resolve) => setTimeout(() => resolve('pending'), 10)),
      ])
      resolveWorkerExit()
      await recovery

      expect(outcomeBeforePhysicalExit).toBe('pending')
      expect(observed).toBeInstanceOf(Error)
    } finally {
      db.close()
    }
  })

  it('fails with a stable journal conflict when terminal history already has different content', async () => {
    const db = createDatabase()
    try {
      const journal = createArchiveCustodyJournal({
        db,
        archiveDirectory,
        now: () => timestamp,
        randomUuid: () => maintenanceOperationId,
        runCustodyOperation: async (ticket) => resultFor(ticket, 'removed'),
      })
      journal.planBuildingWithinTransaction(buildingInput())
      await journal.reconcileActive()
      const originalTerminal = journal.readTerminal(operationId)

      journal.planBuildingWithinTransaction(buildingInput({ missionId: 'mission-b' }))
      await expect(journal.reconcileActive()).rejects.toMatchObject({
        code: 'ARCHIVE_CUSTODY_JOURNAL_TERMINAL_CONFLICT',
      })
      expect(journal.readTerminal(operationId)).toEqual(originalTerminal)
      expect(journal.readActive()).toMatchObject({
        operationId,
        missionId: 'mission-b',
        state: 'staging_cleanup_planned',
      })
    } finally {
      db.close()
    }
  })

  it('maps all malformed persisted record shapes and types to journal corruption', async () => {
    const corruptions = [
      (record: Record<string, unknown>) => { record.unexpected = true },
      (record: Record<string, unknown>) => { record.missionId = 42 },
      (record: Record<string, unknown>) => { record.archiveKind = 'foreign' },
      (record: Record<string, unknown>) => { record.protectedFinalizationEpoch = 0 },
      (record: Record<string, unknown>) => {
        record.previousArchiveId = '88888888-8888-4888-8888-888888888888'
      },
      (record: Record<string, unknown>) => {
        record.state = 'publish_prepared'
        record.revision = 2
      },
      (record: Record<string, unknown>) => {
        record.quarantine = {
          quarantineId,
          relativePath: `quarantine/orphan-${quarantineId}/${archiveId}.sararch`,
        }
      },
    ]
    for (const corrupt of corruptions) {
      const activeDb = createDatabase()
      try {
        const journal = createArchiveCustodyJournal({ db: activeDb, archiveDirectory })
        journal.planBuildingWithinTransaction(buildingInput())
        const active = { ...journal.readActive() }
        corrupt(active)
        activeDb.prepare('UPDATE metadata SET value = ? WHERE key = ?').run(
          canonicalJson(active),
          ACTIVE_ARCHIVE_CUSTODY_JOURNAL_KEY,
        )
        expect(() => journal.readActive()).toThrowError(expect.objectContaining({
          code: 'ARCHIVE_CUSTODY_JOURNAL_CORRUPT',
        }))
      } finally {
        activeDb.close()
      }

      const terminalDb = createDatabase()
      try {
        const journal = createArchiveCustodyJournal({
          db: terminalDb,
          archiveDirectory,
          now: () => timestamp,
          randomUuid: () => maintenanceOperationId,
          runCustodyOperation: async (ticket) => resultFor(ticket, 'removed'),
        })
        journal.planBuildingWithinTransaction(buildingInput())
        await journal.reconcileActive()
        const terminal = { ...journal.readTerminal(operationId) }
        corrupt(terminal)
        terminalDb.prepare('UPDATE metadata SET value = ? WHERE key = ?').run(
          canonicalJson(terminal),
          `archive_custody_operation:${operationId}`,
        )
        expect(() => journal.readTerminal(operationId)).toThrowError(expect.objectContaining({
          code: 'ARCHIVE_CUSTODY_JOURNAL_CORRUPT',
        }))
      } finally {
        terminalDb.close()
      }
    }

    const inputDb = createDatabase()
    try {
      const journal = createArchiveCustodyJournal({ db: inputDb, archiveDirectory })
      expect(() => journal.planBuildingWithinTransaction({
        ...buildingInput(),
        unexpected: true,
      })).toThrowError(expect.objectContaining({
        code: 'ARCHIVE_CUSTODY_JOURNAL_INVALID_INPUT',
      }))
    } finally {
      inputDb.close()
    }
  })

  it('fails closed on noncanonical or identity-substituted durable journal JSON', () => {
    const db = createDatabase()
    try {
      const journal = createArchiveCustodyJournal({ db, archiveDirectory })
      journal.planBuildingWithinTransaction(buildingInput())
      const row = db.prepare('SELECT value FROM metadata WHERE key = ?')
        .get(ACTIVE_ARCHIVE_CUSTODY_JOURNAL_KEY)
      const substituted = JSON.parse(String(row.value))
      substituted.finalRelativePath = 'foreign.sararch'
      db.prepare('UPDATE metadata SET value = ? WHERE key = ?').run(
        JSON.stringify(substituted),
        ACTIVE_ARCHIVE_CUSTODY_JOURNAL_KEY,
      )
      expect(() => journal.readActive()).toThrowError(expect.objectContaining({
        code: 'ARCHIVE_CUSTODY_JOURNAL_CORRUPT',
      }))

      substituted.finalRelativePath = `${archiveId}.sararch`
      db.prepare('UPDATE metadata SET value = ? WHERE key = ?').run(
        JSON.stringify(substituted, null, 2),
        ACTIVE_ARCHIVE_CUSTODY_JOURNAL_KEY,
      )
      expect(() => journal.readActive()).toThrowError(expect.objectContaining({
        code: 'ARCHIVE_CUSTODY_JOURNAL_CORRUPT',
      }))
    } finally {
      db.close()
    }
  })
})
