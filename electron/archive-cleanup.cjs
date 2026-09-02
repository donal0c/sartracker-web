'use strict'

const { createHash } = require('node:crypto')

const {
  createArchiveTableSelection,
  listArchiveInventoryForSchema,
  reconcileArchiveInventory,
} = require('./archive-inventory.cjs')

const CLEANUP_PROGRESS_VERSION = 1
const CLEANUP_BUSY_RETRY_LIMIT = 240
const RETAINED_MISSION_TABLES = new Set(['mission_events', 'missions'])
const CLEANUP_OPERATIONAL_TABLES = new Set([
  'gpx_import_source_receipts',
  'ingest_anomaly_deliveries',
  'participant_backfill_checkpoints',
  'tracking_history_checkpoints',
])
const CLEANUP_BLOCKERS = new Set([
  'archive_custody_busy',
  'archive_custody_mismatch',
  'archive_review_active',
  'cleanup_already_completed',
  'cleanup_in_progress',
  'current_archive_not_verified',
  'current_finalization_epoch_mismatch',
  'evidence_health_not_clean',
  'finalization_fence_active',
  'fresh_non_machine_unlock_required',
  'mission_not_finalized',
  'operational_state_unsettled',
  'verification_proof_invalid',
])

/** Stable, non-reflective cleanup boundary failure. */
class ArchiveCleanupError extends Error {
  /** Creates one bounded cleanup error. */
  constructor(code, message) {
    super(message)
    this.name = 'ArchiveCleanupError'
    this.code = code
  }
}

/** Creates the kill-safe live-row cleanup owner for one open mission store. */
function createArchiveCleanupCoordinator(options) {
  if (options === null || typeof options !== 'object' || Array.isArray(options)
    || typeof options.db?.prepare !== 'function'
    || typeof options.db?.transaction !== 'function'
    || !Number.isSafeInteger(options.schemaVersion) || options.schemaVersion < 1
    || typeof options.now !== 'function'
    || typeof options.yieldToMain !== 'function'
    || typeof options.appendEvent !== 'function') {
    throw new ArchiveCleanupError(
      'ARCHIVE_CLEANUP_INPUT_INVALID',
      'Archive cleanup coordinator input is invalid.',
    )
  }
  const db = options.db
  const schemaVersion = options.schemaVersion
  const now = options.now
  const yieldToMain = options.yieldToMain
  const appendEvent = options.appendEvent
  const batchLimits = normalizeBatchLimits(options.batchLimits)
  let cleanupPlan = null

  /** Reconciles schema drift and returns a child-before-parent cleanup plan. */
  function createCleanupPlan() {
    if (cleanupPlan !== null) return cleanupPlan
    reconcileArchiveInventory(db, { schemaVersion })
    const cleanable = listArchiveInventoryForSchema(schemaVersion)
      .filter((entry) => (
        entry.decision === 'mission_rows' && !RETAINED_MISSION_TABLES.has(entry.tableName)
      ) || (
        entry.decision === 'derived_excluded' && tableHasColumn(db, entry.tableName, 'mission_id')
      ) || (
        entry.decision === 'operational_excluded'
          && CLEANUP_OPERATIONAL_TABLES.has(entry.tableName)
      ))
      .map((entry) => entry.tableName)
    cleanupPlan = orderTablesForDeletion(db, cleanable)
    return cleanupPlan
  }

  /** Computes current eligibility from live state instead of accepting a cached claim. */
  function getEligibility(input) {
    const evidence = normalizeEvidence(input, true)
    const journal = readJournal(db, evidence.missionId)
    if (journal?.state === 'completed' && journalMatchesCurrentEpoch(
      db,
      journal,
      evidence,
    )) {
      return freezeEligibility(false, ['cleanup_already_completed'], 'archived')
    }
    const blockers = readStaticBlockers(db, evidence)
    if (journal?.state === 'in_progress') blockers.push('cleanup_in_progress')
    if (!isCurrentNonMachineUnwrap(evidence)) {
      blockers.push('fresh_non_machine_unlock_required')
    }
    return freezeEligibility(
      blockers.length === 0,
      blockers,
      journal?.state === 'in_progress' ? 'cleanup_in_progress' : 'live',
    )
  }

  /** Starts one explicitly authorized cleanup after rechecking every mutable precondition. */
  async function start(input, executionOptions = {}) {
    const evidence = normalizeEvidence(input, true)
    const execution = normalizeCleanupExecutionOptions(executionOptions)
    const eligibility = getEligibility(evidence)
    if (!eligibility.eligible) throw createEligibilityError(eligibility.blockers)
    const tables = createCleanupPlan()
    const startedAt = now()
    const initialize = db.transaction((assertCustodyUnchanged) => {
      const rechecked = getEligibility(evidence)
      if (!rechecked.eligible) throw createEligibilityError(rechecked.blockers)
      const epoch = readCurrentFinalizationEpoch(db, evidence.missionId)
      const archiveBoundary = readVerifiedArchiveBoundary(db, evidence)
      const progress = Object.freeze({
        version: CLEANUP_PROGRESS_VERSION,
        archiveId: evidence.archiveId,
        ciphertextSha256: evidence.ciphertextSha256,
        sizeBytes: evidence.sizeBytes,
        finalizationEpoch: epoch,
        verificationProofSha256: archiveBoundary.verificationProofSha256,
        tables,
        tableIndex: 0,
        tableBatch: 0,
        deletedRows: 0,
      })
      const existing = readJournal(db, evidence.missionId)
      if (existing === null) {
        db.prepare(`INSERT INTO mission_cleanup_journal (
          mission_id, archive_id, state, progress_json, started_at, updated_at,
          completed_at, last_error
        ) VALUES (?, ?, 'in_progress', ?, ?, ?, NULL, NULL)`).run(
          evidence.missionId,
          evidence.archiveId,
          JSON.stringify(progress),
          startedAt,
          startedAt,
        )
      } else {
        const reset = db.prepare(`UPDATE mission_cleanup_journal SET
          archive_id = ?, state = 'in_progress', progress_json = ?, started_at = ?,
          updated_at = ?, completed_at = NULL, last_error = NULL
          WHERE mission_id = ? AND state = 'completed'`).run(
          evidence.archiveId,
          JSON.stringify(progress),
          startedAt,
          startedAt,
          evidence.missionId,
        )
        if (reset.changes !== 1) {
          throw new ArchiveCleanupError(
            'ARCHIVE_CLEANUP_JOURNAL_MISMATCH',
            'Mission cleanup journal changed before the new finalization epoch could start.',
          )
        }
      }
      db.prepare(`UPDATE mission_archives SET last_non_machine_unwrap_at = ?
        WHERE id = ? AND mission_id = ?`).run(
        evidence.nonMachineUnwrap.authenticatedAt,
        evidence.archiveId,
        evidence.missionId,
      )
      appendEvent(evidence.missionId, 'mission_cleanup_eligible', startedAt, {
        archive_id: evidence.archiveId,
        exhaustive_verification: true,
        non_machine_slot_type: evidence.nonMachineUnwrap.slotType,
        resulting_status: 'finalized',
        storage_state: 'live',
      })
      appendEvent(evidence.missionId, 'mission_cleanup_started', startedAt, {
        archive_id: evidence.archiveId,
        resulting_status: 'finalized',
        storage_state: 'cleanup_in_progress',
      })
      assertCustodyUnchanged()
    })
    commitWithCustody(execution, (assertCustodyUnchanged) =>
      initialize.immediate(assertCustodyUnchanged))
    return runFromJournal(evidence, execution)
  }

  /** Resumes only a journal that already durably records explicit operator initiation. */
  async function resume(input, executionOptions = {}) {
    const evidence = normalizeEvidence(input, false)
    const execution = normalizeCleanupExecutionOptions(executionOptions)
    const journal = readJournal(db, evidence.missionId)
    if (journal === null || journal.state !== 'in_progress') {
      throw new ArchiveCleanupError(
        'ARCHIVE_CLEANUP_NOT_RESUMABLE',
        'Mission cleanup has no interrupted in-progress journal to resume.',
      )
    }
    const progress = normalizeProgress(journal.progress_json)
    if (journal.archive_id !== evidence.archiveId
      || progress.archiveId !== evidence.archiveId
      || progress.ciphertextSha256 !== evidence.ciphertextSha256
      || progress.sizeBytes !== evidence.sizeBytes) {
      throw new ArchiveCleanupError(
        'ARCHIVE_CLEANUP_JOURNAL_MISMATCH',
        'Mission cleanup journal does not match the verified archive identity.',
      )
    }
    const blockers = readStaticBlockers(db, evidence)
    if (blockers.length > 0) throw createEligibilityError(blockers)
    return runFromJournal(evidence, execution)
  }

  /** Advances one transaction-sized cursor at a time and yields after every boundary. */
  async function runFromJournal(evidence, executionOptions) {
    let committedDeletionBatches = 0
    let busyRetries = 0
    try {
      while (true) {
        assertNotCancelled(executionOptions.signal)
        let outcome
        try {
          outcome = advanceOneBoundary(
            evidence,
            executionOptions.faultInjection,
            executionOptions,
          )
          busyRetries = 0
        } catch (error) {
          if (!isRetryableSqliteBusy(error) || busyRetries >= CLEANUP_BUSY_RETRY_LIMIT) {
            throw error
          }
          busyRetries += 1
          await yieldToMain()
          continue
        }
        if (outcome.completed) return outcome.result
        if (outcome.deletedRows > 0) {
          committedDeletionBatches += 1
          executionOptions.onProgress?.(Object.freeze({
            missionId: evidence.missionId,
            archiveId: evidence.archiveId,
            phase: 'cleanup',
            tableName: outcome.tableName,
            deletedRows: outcome.deletedRows,
            totalDeletedRows: outcome.totalDeletedRows,
            tableIndex: outcome.tableIndex,
            tableCount: outcome.tableCount,
          }))
          if (executionOptions.faultInjection?.simulateKillAfterCommittedBatch
            === committedDeletionBatches) {
            const error = new ArchiveCleanupError(
              'ARCHIVE_CLEANUP_SIMULATED_KILL',
              'Archive cleanup stopped after a simulated process kill.',
            )
            error.preserveForRestart = true
            throw error
          }
          const tableKill = executionOptions.faultInjection?.simulateKillAfterTableBatch
          if (tableKill?.tableName === outcome.tableName
            && tableKill?.tableBatch === outcome.tableBatch) {
            const error = new ArchiveCleanupError(
              'ARCHIVE_CLEANUP_SIMULATED_KILL',
              'Archive cleanup stopped after a simulated process kill.',
            )
            error.preserveForRestart = true
            throw error
          }
        }
        await yieldToMain()
      }
    } catch (error) {
      if (error?.preserveForRestart === true) throw error
      const failure = error instanceof ArchiveCleanupError
        && error.code === 'ARCHIVE_CLEANUP_CANCELLED'
        ? error
        : new ArchiveCleanupError(
            'ARCHIVE_CLEANUP_FAILED',
            'Mission cleanup failed safely and will resume from its durable cursor.',
          )
      if (failure !== error) failure.cause = error
      try {
        recordFailure(evidence, failure.code)
      } catch (auditError) {
        const terminal = new ArchiveCleanupError(
          'ARCHIVE_CLEANUP_AUDIT_FAILED',
          'Mission cleanup and its durable failure audit both failed safely.',
        )
        terminal.cause = new AggregateError([error, auditError])
        throw terminal
      }
      throw failure
    }
  }

  /** Commits either one bounded delete page, one table advance, or terminal completion. */
  function advanceOneBoundary(evidence, faultInjection, executionOptions) {
    const advance = db.transaction((assertCustodyUnchanged) => {
      const journal = requireInProgressJournal(db, evidence)
      const progress = normalizeProgress(journal.progress_json)
      assertProgressStillCurrent(db, evidence, progress, createCleanupPlan())
      if (progress.tableIndex >= progress.tables.length) {
        const completedAt = now()
        appendEvent(evidence.missionId, 'mission_cleanup_completed', completedAt, {
          archive_id: evidence.archiveId,
          removed_live_row_count: progress.deletedRows,
          resulting_status: 'finalized',
          storage_state: 'archived',
        })
        const updated = db.prepare(`UPDATE mission_cleanup_journal
          SET state = 'completed', updated_at = ?, completed_at = ?, last_error = NULL
          WHERE mission_id = ? AND archive_id = ? AND state = 'in_progress'`).run(
          completedAt,
          completedAt,
          evidence.missionId,
          evidence.archiveId,
        )
        if (updated.changes !== 1) throw new Error('Cleanup journal changed at completion.')
        const outcome = Object.freeze({
          completed: true,
          result: Object.freeze({
            missionId: evidence.missionId,
            archiveId: evidence.archiveId,
            state: 'completed',
            storageState: 'archived',
            deletedRows: progress.deletedRows,
          }),
        })
        assertCustodyUnchanged()
        return outcome
      }
      const tableName = progress.tables[progress.tableIndex]
      const selection = createCleanupSelection(
        db,
        tableName,
        evidence.missionId,
        schemaVersion,
      )
      const limit = tableName === 'positions'
        ? batchLimits.positions
        : batchLimits.default
      const keyColumns = readTableKeyColumns(db, tableName)
      const selectedKeys = keyColumns.map((column) =>
        column === 'rowid' ? 'archive_row.rowid' : `archive_row.${quoteIdentifier(column)}`)
      const selected = db.prepare(`SELECT ${selectedKeys.join(', ')}
        FROM ${quoteIdentifier(tableName)} AS archive_row
        WHERE ${selection.whereSql}
        ORDER BY ${selectedKeys.join(', ')} LIMIT ?`).all(
        ...selection.parameters,
        limit,
      )
      if (selected.length === 0) {
        const next = { ...progress, tableIndex: progress.tableIndex + 1, tableBatch: 0 }
        updateProgress(db, evidence, next, now())
        const outcome = Object.freeze({
          completed: false,
          deletedRows: 0,
          totalDeletedRows: next.deletedRows,
          tableName,
          tableIndex: next.tableIndex,
          tableCount: next.tables.length,
        })
        assertCustodyUnchanged()
        return outcome
      }
      const outerKeys = keyColumns.map((column) => quoteIdentifier(column))
      const keyExpression = outerKeys.length === 1
        ? outerKeys[0]
        : `(${outerKeys.join(', ')})`
      const deleted = db.prepare(`DELETE FROM ${quoteIdentifier(tableName)}
        WHERE ${keyExpression} IN (
          SELECT ${selectedKeys.join(', ')}
          FROM ${quoteIdentifier(tableName)} AS archive_row
          WHERE ${selection.whereSql}
          ORDER BY ${selectedKeys.join(', ')} LIMIT ?
        )`).run(...selection.parameters, limit)
      if (deleted.changes !== selected.length) {
        throw new Error('Cleanup delete page changed before its cursor could commit.')
      }
      if (faultInjection?.failBeforeJournalUpdateForTable === tableName) {
        throw new Error('Injected cleanup failure before journal update.')
      }
      const next = {
        ...progress,
        tableBatch: progress.tableBatch + 1,
        deletedRows: progress.deletedRows + deleted.changes,
      }
      updateProgress(db, evidence, next, now())
      const outcome = Object.freeze({
        completed: false,
        deletedRows: deleted.changes,
        totalDeletedRows: next.deletedRows,
        tableName,
        tableBatch: next.tableBatch,
        tableIndex: next.tableIndex,
        tableCount: next.tables.length,
      })
      assertCustodyUnchanged()
      return outcome
    })
    return commitWithCustody(executionOptions, (assertCustodyUnchanged) =>
      advance.deferred(assertCustodyUnchanged))
  }

  /** Retains the forward cursor and records only a stable bounded failure code. */
  function recordFailure(evidence, code) {
    const timestamp = now()
    const transaction = db.transaction(() => {
      const journal = readJournal(db, evidence.missionId)
      if (journal === null || journal.archive_id !== evidence.archiveId
        || journal.state !== 'in_progress') return
      db.prepare(`UPDATE mission_cleanup_journal SET updated_at = ?, last_error = ?
        WHERE mission_id = ? AND archive_id = ? AND state = 'in_progress'`).run(
        timestamp,
        code,
        evidence.missionId,
        evidence.archiveId,
      )
      appendEvent(evidence.missionId, 'mission_cleanup_failed', timestamp, {
        archive_id: evidence.archiveId,
        error_code: code,
        resulting_status: 'finalized',
        storage_state: 'cleanup_in_progress',
      })
    })
    transaction.immediate()
  }

  return Object.freeze({ getEligibility, start, resume })
}

/** Requires every cleanup transaction to run under one synchronous custody witness. */
function normalizeCleanupExecutionOptions(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)
    || typeof input.withCustodyCommit !== 'function'
    || (input.signal !== undefined && !(input.signal instanceof AbortSignal))
    || (input.onProgress !== undefined && typeof input.onProgress !== 'function')) {
    throw new ArchiveCleanupError(
      'ARCHIVE_CLEANUP_INPUT_INVALID',
      'Archive cleanup execution options are invalid.',
    )
  }
  return Object.freeze({
    withCustodyCommit: input.withCustodyCommit,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
    ...(input.onProgress === undefined ? {} : { onProgress: input.onProgress }),
    ...(input.faultInjection === undefined ? {} : { faultInjection: input.faultInjection }),
  })
}

/** Executes exactly one synchronous database boundary while custody remains pinned. */
function commitWithCustody(executionOptions, commit) {
  let callbackCount = 0
  const result = executionOptions.withCustodyCommit((assertCustodyUnchanged) => {
    callbackCount += 1
    if (callbackCount !== 1 || typeof assertCustodyUnchanged !== 'function') {
      throw new ArchiveCleanupError(
        'ARCHIVE_CLEANUP_INPUT_INVALID',
        'Archive cleanup custody witness is invalid.',
      )
    }
    const committed = commit(assertCustodyUnchanged)
    if (committed !== null && typeof committed === 'object'
      && typeof committed.then === 'function') {
      throw new ArchiveCleanupError(
        'ARCHIVE_CLEANUP_INPUT_INVALID',
        'Archive cleanup custody commits must be synchronous.',
      )
    }
    return committed
  })
  if (callbackCount !== 1 || (result !== null && typeof result === 'object'
    && typeof result.then === 'function')) {
    throw new ArchiveCleanupError(
      'ARCHIVE_CLEANUP_INPUT_INVALID',
      'Archive cleanup custody witness did not complete synchronously.',
    )
  }
  return result
}

/** Normalizes the two bounded row-page sizes. */
function normalizeBatchLimits(input = {}) {
  const positions = input.positions ?? 500
  const fallback = input.default ?? 50
  if (!Number.isSafeInteger(positions) || positions < 1 || positions > 5_000
    || !Number.isSafeInteger(fallback) || fallback < 1 || fallback > 500) {
    throw new ArchiveCleanupError(
      'ARCHIVE_CLEANUP_INPUT_INVALID',
      'Archive cleanup batch limits are invalid.',
    )
  }
  return Object.freeze({ positions, default: fallback })
}

/** Validates internal exact identity/proof claims; secrets never enter this module. */
function normalizeEvidence(input, requireUnwrap) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)
    || typeof input.archiveId !== 'string' || input.archiveId.length < 1
    || Buffer.byteLength(input.archiveId, 'utf8') > 200
    || typeof input.missionId !== 'string' || input.missionId.length < 1
    || Buffer.byteLength(input.missionId, 'utf8') > 200
    || typeof input.ciphertextSha256 !== 'string'
    || !/^[0-9a-f]{64}$/u.test(input.ciphertextSha256)
    || !Number.isSafeInteger(input.sizeBytes) || input.sizeBytes < 1
    || typeof input.verificationProofValidated !== 'boolean'
    || typeof input.custodyReconciled !== 'boolean'
    || typeof input.archiveCustodyIdle !== 'boolean'
    || typeof input.reviewActivity !== 'boolean'
    || input.evidenceHealth === null || typeof input.evidenceHealth !== 'object'
    || !['healthy', 'degraded', 'critical'].includes(input.evidenceHealth.state)
    || !Number.isSafeInteger(input.evidenceHealth.pendingCount)
    || input.evidenceHealth.pendingCount < 0
    || !Number.isSafeInteger(input.evidenceHealth.corruptCount)
    || input.evidenceHealth.corruptCount < 0) {
    throw new ArchiveCleanupError(
      'ARCHIVE_CLEANUP_INPUT_INVALID',
      'Archive cleanup evidence is invalid.',
    )
  }
  const nonMachineUnwrap = input.nonMachineUnwrap === undefined
    ? null
    : normalizeNonMachineUnwrap(input.nonMachineUnwrap)
  if (requireUnwrap && input.nonMachineUnwrap !== undefined
    && input.nonMachineUnwrap !== null && nonMachineUnwrap === null) {
    throw new ArchiveCleanupError(
      'ARCHIVE_CLEANUP_INPUT_INVALID',
      'Archive cleanup non-machine unlock proof is invalid.',
    )
  }
  return Object.freeze({
    archiveId: input.archiveId,
    missionId: input.missionId,
    ciphertextSha256: input.ciphertextSha256,
    sizeBytes: input.sizeBytes,
    verificationProofValidated: input.verificationProofValidated,
    custodyReconciled: input.custodyReconciled,
    archiveCustodyIdle: input.archiveCustodyIdle,
    evidenceHealth: Object.freeze({
      state: input.evidenceHealth.state,
      pendingCount: input.evidenceHealth.pendingCount,
      corruptCount: input.evidenceHealth.corruptCount,
    }),
    reviewActivity: input.reviewActivity,
    nonMachineUnwrap,
  })
}

/** Normalizes a successful same-call passphrase/recovery unwrap attestation. */
function normalizeNonMachineUnwrap(input) {
  if (input === null) return null
  if (typeof input !== 'object' || Array.isArray(input)
    || typeof input.archiveId !== 'string'
    || typeof input.missionId !== 'string'
    || !['passphrase', 'recovery'].includes(input.slotType)
    || typeof input.authenticatedAt !== 'string'
    || new Date(input.authenticatedAt).toISOString() !== input.authenticatedAt
    || typeof input.ciphertextSha256 !== 'string'
    || !/^[0-9a-f]{64}$/u.test(input.ciphertextSha256)
    || !Number.isSafeInteger(input.sizeBytes) || input.sizeBytes < 1) return null
  return Object.freeze({ ...input })
}

/** Returns the mutable-state blockers except the same-call non-machine credential. */
function readStaticBlockers(db, evidence) {
  const blockers = []
  const mission = db.prepare('SELECT status FROM missions WHERE id = ?').get(evidence.missionId)
  if (mission?.status !== 'finalized') blockers.push('mission_not_finalized')
  const archive = db.prepare('SELECT * FROM mission_archives WHERE id = ?').get(evidence.archiveId)
  const epoch = readCurrentFinalizationEpoch(db, evidence.missionId)
  const finalizationDetails = readCurrentFinalizationDetails(db, evidence.missionId)
  const currentEpochMatches = archive?.archive_kind === 'finalized'
    ? finalizationDetails.archive_id === evidence.archiveId
    : archive?.archive_kind === 'finalized_recovery'
      && Number(archive.protected_finalization_epoch) === epoch
  if (archive?.mission_id !== evidence.missionId || !currentEpochMatches) {
    blockers.push('current_finalization_epoch_mismatch')
  }
  if (archive?.container_version !== 2
    || archive?.status !== 'verified'
    || archive?.verified_at === null
    || archive?.verification_proof_json === null) {
    blockers.push('current_archive_not_verified')
  }
  if (!evidence.verificationProofValidated) blockers.push('verification_proof_invalid')
  if (!evidence.custodyReconciled
    || archive?.availability !== 'present'
    || archive?.ciphertext_sha256 !== evidence.ciphertextSha256
    || Number(archive?.size_bytes) !== evidence.sizeBytes) {
    blockers.push('archive_custody_mismatch')
  }
  if (db.prepare('SELECT 1 FROM mission_finalization_fences WHERE mission_id = ? LIMIT 1')
    .get(evidence.missionId) !== undefined) blockers.push('finalization_fence_active')
  if (!evidence.archiveCustodyIdle) blockers.push('archive_custody_busy')
  if (db.prepare(`SELECT 1 FROM metadata
    WHERE key IN ('archive_custody_active_operation', 'archive_custody_recovery_failure')
    LIMIT 1`).get() !== undefined) blockers.push('archive_custody_busy')
  if (evidence.evidenceHealth.state !== 'healthy'
    || evidence.evidenceHealth.pendingCount !== 0
    || evidence.evidenceHealth.corruptCount !== 0) {
    blockers.push('evidence_health_not_clean')
  }
  if (db.prepare(`SELECT 1 FROM gpx_import_source_receipts
    WHERE mission_id = ? AND status IN ('pending', 'retained') LIMIT 1`)
    .get(evidence.missionId) !== undefined) blockers.push('operational_state_unsettled')
  if (evidence.reviewActivity) blockers.push('archive_review_active')
  return [...new Set(blockers)]
}

/** Requires the current same-call credential proof to bind every immutable identity. */
function isCurrentNonMachineUnwrap(evidence) {
  const unwrap = evidence.nonMachineUnwrap
  return unwrap !== null
    && unwrap.archiveId === evidence.archiveId
    && unwrap.missionId === evidence.missionId
    && unwrap.ciphertextSha256 === evidence.ciphertextSha256
    && unwrap.sizeBytes === evidence.sizeBytes
    && ['passphrase', 'recovery'].includes(unwrap.slotType)
}

/** Reads the immutable rowid epoch of the current finalization event. */
function readCurrentFinalizationEpoch(db, missionId) {
  const row = db.prepare(`SELECT rowid FROM mission_events
    WHERE mission_id = ? AND event_type = 'mission_finalized'
    ORDER BY rowid DESC LIMIT 1`).get(missionId)
  return Number(row?.rowid ?? 0)
}

/** Reads only the bounded current finalization event document. */
function readCurrentFinalizationDetails(db, missionId) {
  const row = db.prepare(`SELECT details_json FROM mission_events
    WHERE mission_id = ? AND event_type = 'mission_finalized'
    ORDER BY rowid DESC LIMIT 1`).get(missionId)
  try {
    const parsed = JSON.parse(row?.details_json ?? '{}')
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

/** Reads one cleanup row without trusting its JSON cursor. */
function readJournal(db, missionId) {
  return db.prepare('SELECT * FROM mission_cleanup_journal WHERE mission_id = ?').get(missionId)
    ?? null
}

/** Requires one exact in-progress journal identity. */
function requireInProgressJournal(db, evidence) {
  const journal = readJournal(db, evidence.missionId)
  if (journal === null || journal.state !== 'in_progress'
    || journal.archive_id !== evidence.archiveId) {
    throw new ArchiveCleanupError(
      'ARCHIVE_CLEANUP_JOURNAL_MISMATCH',
      'Mission cleanup journal changed before its next bounded transaction.',
    )
  }
  return journal
}

/** Parses a bounded, forward-only cursor and rejects table-list substitution. */
function normalizeProgress(input) {
  let parsed
  try {
    if (typeof input !== 'string' || Buffer.byteLength(input, 'utf8') > 64 * 1024) throw new Error()
    parsed = JSON.parse(input)
  } catch {
    throw new ArchiveCleanupError(
      'ARCHIVE_CLEANUP_JOURNAL_CORRUPT',
      'Mission cleanup journal progress is corrupt.',
    )
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)
    || parsed.version !== CLEANUP_PROGRESS_VERSION
    || typeof parsed.archiveId !== 'string'
    || typeof parsed.ciphertextSha256 !== 'string'
    || !/^[0-9a-f]{64}$/u.test(parsed.ciphertextSha256)
    || !Number.isSafeInteger(parsed.sizeBytes) || parsed.sizeBytes < 1
    || !Number.isSafeInteger(parsed.finalizationEpoch) || parsed.finalizationEpoch < 1
    || typeof parsed.verificationProofSha256 !== 'string'
    || !/^[0-9a-f]{64}$/u.test(parsed.verificationProofSha256)
    || !Array.isArray(parsed.tables) || parsed.tables.length < 1 || parsed.tables.length > 100
    || parsed.tables.some((tableName) => typeof tableName !== 'string'
      || !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(tableName))
    || new Set(parsed.tables).size !== parsed.tables.length
    || !Number.isSafeInteger(parsed.tableIndex) || parsed.tableIndex < 0
    || parsed.tableIndex > parsed.tables.length
    || !Number.isSafeInteger(parsed.tableBatch) || parsed.tableBatch < 0
    || !Number.isSafeInteger(parsed.deletedRows) || parsed.deletedRows < 0) {
    throw new ArchiveCleanupError(
      'ARCHIVE_CLEANUP_JOURNAL_CORRUPT',
      'Mission cleanup journal progress is corrupt.',
    )
  }
  return parsed
}

/** Rechecks epoch, identity and the declarative table plan before every delete. */
function assertProgressStillCurrent(db, evidence, progress, currentTables) {
  if (progress.archiveId !== evidence.archiveId
    || progress.ciphertextSha256 !== evidence.ciphertextSha256
    || progress.sizeBytes !== evidence.sizeBytes
    || progress.finalizationEpoch !== readCurrentFinalizationEpoch(db, evidence.missionId)) {
    throw new ArchiveCleanupError(
      'ARCHIVE_CLEANUP_EPOCH_CHANGED',
      'Mission finalization or verified archive identity changed during cleanup.',
    )
  }
  const blockers = readStaticBlockers(db, evidence)
  if (blockers.length > 0) {
    const error = new ArchiveCleanupError(
      'ARCHIVE_CLEANUP_PRECONDITION_CHANGED',
      'Mission cleanup stopped because a mutable safety precondition changed.',
    )
    error.blockers = Object.freeze(blockers)
    throw error
  }
  const archiveBoundary = readVerifiedArchiveBoundary(db, evidence)
  if (archiveBoundary.verificationProofSha256 !== progress.verificationProofSha256) {
    throw new ArchiveCleanupError(
      'ARCHIVE_CLEANUP_PRECONDITION_CHANGED',
      'Mission archive verification proof changed during cleanup.',
    )
  }
  if (JSON.stringify(progress.tables) !== JSON.stringify(currentTables)) {
    throw new ArchiveCleanupError(
      'ARCHIVE_CLEANUP_JOURNAL_CORRUPT',
      'Mission cleanup journal table inventory changed.',
    )
  }
}

/** Returns whether a terminal journal belongs to this exact current finalization epoch. */
function journalMatchesCurrentEpoch(db, journal, evidence) {
  if (journal.archive_id !== evidence.archiveId) return false
  const progress = normalizeProgress(journal.progress_json)
  return progress.archiveId === evidence.archiveId
    && progress.finalizationEpoch === readCurrentFinalizationEpoch(db, evidence.missionId)
}

/** Binds every cleanup batch to the same validated stored verification proof bytes. */
function readVerifiedArchiveBoundary(db, evidence) {
  const archive = db.prepare(`SELECT mission_id, status, availability, verified_at,
      verification_proof_json, ciphertext_sha256, size_bytes
    FROM mission_archives WHERE id = ?`).get(evidence.archiveId)
  if (archive?.mission_id !== evidence.missionId
    || archive.status !== 'verified'
    || archive.availability !== 'present'
    || archive.verified_at === null
    || typeof archive.verification_proof_json !== 'string'
    || archive.verification_proof_json.length < 1
    || Buffer.byteLength(archive.verification_proof_json, 'utf8') > 4 * 1024 * 1024
    || archive.ciphertext_sha256 !== evidence.ciphertextSha256
    || Number(archive.size_bytes) !== evidence.sizeBytes) {
    throw new ArchiveCleanupError(
      'ARCHIVE_CLEANUP_PRECONDITION_CHANGED',
      'Mission archive verification state changed during cleanup.',
    )
  }
  return Object.freeze({
    verificationProofSha256: createHash('sha256')
      .update(archive.verification_proof_json, 'utf8')
      .digest('hex'),
  })
}

/** Selects either archived mission evidence or explicitly disposable mission-scoped state. */
function createCleanupSelection(db, tableName, missionId, schemaVersion) {
  const declaration = listArchiveInventoryForSchema(schemaVersion)
    .find((entry) => entry.tableName === tableName)
  if (declaration?.decision === 'mission_rows') {
    return createArchiveTableSelection({ tableName, missionId, schemaVersion })
  }
  if ((declaration?.decision === 'derived_excluded'
      || CLEANUP_OPERATIONAL_TABLES.has(tableName))
    && tableHasColumn(db, tableName, 'mission_id')) {
    return Object.freeze({ whereSql: 'archive_row."mission_id" = ?', parameters: [missionId] })
  }
  throw new ArchiveCleanupError(
    'ARCHIVE_CLEANUP_SCHEMA_UNSAFE',
    'Mission cleanup table has no explicit mission-scoped disposition.',
  )
}

/** Checks one declaration-owned schema column without accepting a dynamic identifier. */
function tableHasColumn(db, tableName, columnName) {
  return db.prepare(`PRAGMA table_info(${quoteIdentifier(tableName)})`).all()
    .some((column) => column.name === columnName)
}

/** Updates only the exact in-progress archive cursor. */
function updateProgress(db, evidence, progress, timestamp) {
  const updated = db.prepare(`UPDATE mission_cleanup_journal
    SET progress_json = ?, updated_at = ?, last_error = NULL
    WHERE mission_id = ? AND archive_id = ? AND state = 'in_progress'`).run(
    JSON.stringify(progress),
    timestamp,
    evidence.missionId,
    evidence.archiveId,
  )
  if (updated.changes !== 1) throw new Error('Cleanup journal cursor changed.')
}

/** Returns the stable primary-key tuple, falling back to rowid only for rowid tables. */
function readTableKeyColumns(db, tableName) {
  const columns = db.prepare(`PRAGMA table_info(${quoteIdentifier(tableName)})`).all()
    .filter((column) => Number(column.pk) > 0)
    .sort((left, right) => Number(left.pk) - Number(right.pk))
    .map((column) => column.name)
  if (columns.length > 0) return columns
  try {
    db.prepare(`SELECT rowid FROM ${quoteIdentifier(tableName)} LIMIT 0`)
    return ['rowid']
  } catch {
    throw new ArchiveCleanupError(
      'ARCHIVE_CLEANUP_SCHEMA_UNSAFE',
      'Mission cleanup table has no stable row identity.',
    )
  }
}

/** Orders every child table before its cleanable FK parents. */
function orderTablesForDeletion(db, tableNames) {
  const remaining = new Set(tableNames)
  const result = []
  while (remaining.size > 0) {
    const candidates = [...remaining].filter((candidate) => ![...remaining].some((other) => {
      if (other === candidate) return false
      return db.prepare(`PRAGMA foreign_key_list(${quoteIdentifier(other)})`).all()
        .some((foreignKey) => foreignKey.table === candidate)
    })).sort()
    if (candidates.length === 0) {
      throw new ArchiveCleanupError(
        'ARCHIVE_CLEANUP_SCHEMA_UNSAFE',
        'Mission cleanup table dependencies contain an unsupported cycle.',
      )
    }
    for (const candidate of candidates) {
      remaining.delete(candidate)
      result.push(candidate)
    }
  }
  return Object.freeze(result)
}

/** Quotes a declaration-owned SQLite identifier. */
function quoteIdentifier(value) {
  if (typeof value !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(value)) {
    throw new ArchiveCleanupError(
      'ARCHIVE_CLEANUP_SCHEMA_UNSAFE',
      'Mission cleanup table identity is unsafe.',
    )
  }
  return `"${value}"`
}

/** Throws only at transaction boundaries so every committed cursor remains resumable. */
function assertNotCancelled(signal) {
  if (signal?.aborted !== true) return
  throw new ArchiveCleanupError(
    'ARCHIVE_CLEANUP_CANCELLED',
    'Mission cleanup was cancelled after its last durable batch.',
  )
}

/** Identifies transient SQLite writer contention that is safe to retry at a boundary. */
function isRetryableSqliteBusy(error) {
  return typeof error?.code === 'string' && error.code.startsWith('SQLITE_BUSY')
}

/** Produces one frozen, deduplicated eligibility result. */
function freezeEligibility(eligible, blockers, storageState) {
  const normalized = [...new Set(blockers)]
  if (normalized.some((blocker) => !CLEANUP_BLOCKERS.has(blocker))) {
    throw new ArchiveCleanupError(
      'ARCHIVE_CLEANUP_STATE_INVALID',
      'Mission cleanup produced an unsupported eligibility blocker.',
    )
  }
  return Object.freeze({
    eligible,
    blockers: Object.freeze(normalized),
    storageState,
  })
}

/** Maps eligibility detail to one non-reflective terminal error. */
function createEligibilityError(blockers) {
  const error = new ArchiveCleanupError(
    'ARCHIVE_CLEANUP_NOT_ELIGIBLE',
    'Mission cleanup is unavailable because one or more safety preconditions are not met.',
  )
  error.blockers = Object.freeze([...blockers])
  return error
}

module.exports = {
  ArchiveCleanupError,
  createArchiveCleanupCoordinator,
}
