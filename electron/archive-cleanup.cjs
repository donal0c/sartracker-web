'use strict'

const { createHash } = require('node:crypto')

const {
  createArchiveTableSelection,
  listArchiveInventoryForSchema,
  reconcileArchiveInventory,
} = require('./archive-inventory.cjs')
const {
  cleanupCauseClassForError,
  normalizeCleanupFailureDiagnostic,
} = require('./archive-cleanup-failure.cjs')
const {
  readCurrentMissionFinalizationBoundary,
} = require('./mission-finalization-boundary.cjs')
const {
  ARCHIVE_CLEANUP_MEMBERSHIP_EVENT_TYPES,
  ARCHIVE_CLEANUP_OPERATIONAL_TABLES,
  assertArchiveCleanupMembershipGeneration,
  withArchiveCleanupMembershipBypass,
} = require('./archive-cleanup-membership.cjs')

const CLEANUP_PROGRESS_VERSION = 2
const CLEANUP_GUARD_VERSION = 1
const CLEANUP_GUARD_KEY_PREFIX = 'archive_cleanup_guard_v1:'
const CLEANUP_BUSY_RETRY_LIMIT = 240
const CLEANUP_BUSY_RETRY_DELAY_MS = 25
const RETAINED_MISSION_TABLES = new Set(['missions'])
const RECONSTRUCTED_DERIVED_TABLES = new Set(['mission_replay_generations'])
const CLEANABLE_MISSION_EVENT_TYPES = ARCHIVE_CLEANUP_MEMBERSHIP_EVENT_TYPES
const CLEANABLE_MISSION_EVENT_TYPE_PLACEHOLDERS = CLEANABLE_MISSION_EVENT_TYPES
  .map(() => '?')
  .join(', ')
const CLEANUP_OPERATIONAL_TABLES = new Set(ARCHIVE_CLEANUP_OPERATIONAL_TABLES)
const CLEANUP_BLOCKERS = new Set([
  'archive_custody_busy',
  'archive_custody_mismatch',
  'archive_review_active',
  'cleanup_already_completed',
  'cleanup_in_progress',
  'cleanup_journal_invalid',
  'cleanup_membership_changed',
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

/** Builds the complete child-before-parent cleanup plan for one migrated schema. */
function buildArchiveCleanupPlan(db, schemaVersion, reconcile = false) {
  if (reconcile) reconcileArchiveInventory(db, { schemaVersion })
  const cleanable = listArchiveInventoryForSchema(schemaVersion)
    .filter((entry) => (
      entry.decision === 'mission_rows' && !RETAINED_MISSION_TABLES.has(entry.tableName)
    ) || (
      entry.decision === 'derived_excluded'
        && !RECONSTRUCTED_DERIVED_TABLES.has(entry.tableName)
        && tableHasColumn(db, entry.tableName, 'mission_id')
    ) || (
      entry.decision === 'operational_excluded'
        && CLEANUP_OPERATIONAL_TABLES.has(entry.tableName)
    ))
    .map((entry) => entry.tableName)
  const ordered = orderTablesForDeletion(db, cleanable)
  return Object.freeze([
    ...ordered.filter((tableName) => tableName !== 'mission_events'),
    ...(ordered.includes('mission_events') ? ['mission_events'] : []),
  ])
}

/** Attaches a bounded, non-enumerable cleanup diagnostic to a public error. */
function attachCleanupFailureDiagnostic(error, diagnostic) {
  if (error === null || typeof error !== 'object') return error
  Object.defineProperty(error, 'cleanupDiagnostic', {
    value: diagnostic,
    enumerable: false,
    configurable: true,
    writable: false,
  })
  return error
}

/** Creates the kill-safe live-row cleanup owner for one open mission store. */
function createArchiveCleanupCoordinator(options) {
  if (options === null || typeof options !== 'object' || Array.isArray(options)
    || typeof options.db?.prepare !== 'function'
    || typeof options.db?.transaction !== 'function'
    || !Number.isSafeInteger(options.schemaVersion) || options.schemaVersion < 1
    || typeof options.now !== 'function'
    || typeof options.yieldToMain !== 'function'
    || (options.yieldAfterBusyRetry !== undefined
      && typeof options.yieldAfterBusyRetry !== 'function')
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
  const yieldAfterBusyRetry = options.yieldAfterBusyRetry
    ?? (() => new Promise((resolve) => setTimeout(resolve, CLEANUP_BUSY_RETRY_DELAY_MS)))
  const appendEvent = options.appendEvent
  const batchLimits = normalizeBatchLimits(options.batchLimits)
  let cleanupPlan = null

  /** Reconciles schema drift and returns a child-before-parent cleanup plan. */
  function createCleanupPlan() {
    if (cleanupPlan !== null) return cleanupPlan
    cleanupPlan = buildArchiveCleanupPlan(db, schemaVersion, true)
    return cleanupPlan
  }

  /** Computes current eligibility from live state instead of accepting a cached claim. */
  function getEligibility(input) {
    const evidence = normalizeEvidence(input, true)
    const journal = readJournal(db, evidence.missionId)
    const missionStatus = db.prepare('SELECT status FROM missions WHERE id = ?')
      .get(evidence.missionId)?.status
    let guardedJournal = null
    if (journal !== null) {
      try {
        guardedJournal = readGuardedJournal(db, journal)
      } catch {
        return freezeEligibility(false, ['cleanup_journal_invalid'], 'cleanup_in_progress')
      }
    } else {
      try {
        if (readArchiveCleanupGuard(db, evidence.missionId) !== null) {
          return freezeEligibility(false, ['cleanup_journal_invalid'], 'cleanup_in_progress')
        }
      } catch {
        return freezeEligibility(false, ['cleanup_journal_invalid'], 'cleanup_in_progress')
      }
    }
    if (missionStatus === 'finalized' && guardedJournal?.journal.state === 'completed'
      && guardedJournal.progress.archiveId === evidence.archiveId) {
      try {
        assertCompletedJournalCurrent(
          db,
          evidence,
          guardedJournal,
          createCleanupPlan(),
          schemaVersion,
        )
      } catch {
        return freezeEligibility(false, ['cleanup_journal_invalid'], 'cleanup_in_progress')
      }
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
    const initializationContext = {
      substage: 'custody_commit',
      tableName: null,
      cursor: null,
    }
    const initialize = db.transaction((assertCustodyUnchanged) => {
      initializationContext.substage = 'journal_initialize'
      const rechecked = getEligibility(evidence)
      if (!rechecked.eligible) throw createEligibilityError(rechecked.blockers)
      const finalizationBoundary = requireCurrentFinalizationBoundary(db, evidence)
      const archiveBoundary = readVerifiedArchiveBoundary(db, evidence)
      const membershipGeneration = assertArchiveCleanupMembershipGeneration(db, {
        missionId: evidence.missionId,
        expectedGeneration: finalizationBoundary.cleanupMembershipGeneration,
      })
      const existing = readJournal(db, evidence.missionId)
      const existingGuarded = existing === null ? null : readGuardedJournal(db, existing)
      if (existing === null && readArchiveCleanupGuard(db, evidence.missionId) !== null) {
        throw new ArchiveCleanupError(
          'ARCHIVE_CLEANUP_JOURNAL_CORRUPT',
          'Mission cleanup guard exists without its journal.',
        )
      }
      const guardRevision = existingGuarded === null
        ? 0
        : checkedCleanupCountAdd(existingGuarded.guard.revision, 1)
      const progress = Object.freeze({
        version: CLEANUP_PROGRESS_VERSION,
        archiveId: evidence.archiveId,
        ciphertextSha256: evidence.ciphertextSha256,
        sizeBytes: evidence.sizeBytes,
        finalizationEpoch: finalizationBoundary.eventRowid,
        verificationProofSha256: archiveBoundary.verificationProofSha256,
        tables,
        tableIndex: 0,
        tableBatch: 0,
        tableCursor: null,
        missionEventsTargetRowid: finalizationBoundary.eventRowid,
        deletedRows: 0,
        guardRevision,
        membershipGeneration,
      })
      appendEvent(evidence.missionId, 'mission_cleanup_eligible', startedAt, {
        archive_id: evidence.archiveId,
        exhaustive_verification: true,
        non_machine_slot_type: evidence.nonMachineUnwrap.slotType,
        resulting_status: 'finalized',
        storage_state: 'live',
      })
      const startedEventId = appendEvent(
        evidence.missionId,
        'mission_cleanup_started',
        startedAt,
        {
          archive_id: evidence.archiveId,
          cleanup_guard_version: CLEANUP_GUARD_VERSION,
          finalization_event_id: finalizationBoundary.eventId,
          finalization_epoch: finalizationBoundary.eventRowid,
          progress_version: CLEANUP_PROGRESS_VERSION,
          resulting_status: 'finalized',
          storage_state: 'cleanup_in_progress',
        },
      )
      const initialGuard = createCleanupGuard({
        missionId: evidence.missionId,
        progress,
        state: 'in_progress',
        revision: guardRevision,
        finalizationEventId: finalizationBoundary.eventId,
        startedEventId,
        completionEventId: null,
        completedAt: null,
      })
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
        insertCleanupGuard(db, evidence.missionId, initialGuard)
      } else {
        const reset = db.prepare(`UPDATE mission_cleanup_journal SET
          archive_id = ?, state = 'in_progress', progress_json = ?, started_at = ?,
          updated_at = ?, completed_at = NULL, last_error = NULL
          WHERE mission_id = ? AND archive_id = ? AND state = 'completed'
            AND progress_json = ?`).run(
          evidence.archiveId,
          JSON.stringify(progress),
          startedAt,
          startedAt,
          evidence.missionId,
          existing.archive_id,
          existing.progress_json,
        )
        if (reset.changes !== 1) {
          throw new ArchiveCleanupError(
            'ARCHIVE_CLEANUP_JOURNAL_MISMATCH',
            'Mission cleanup journal changed before the new finalization epoch could start.',
          )
        }
        replaceCleanupGuard(
          db,
          evidence.missionId,
          existingGuarded.guardJson,
          initialGuard,
        )
      }
      db.prepare(`UPDATE mission_archives SET last_non_machine_unwrap_at = ?
        WHERE id = ? AND mission_id = ?`).run(
        evidence.nonMachineUnwrap.authenticatedAt,
        evidence.archiveId,
        evidence.missionId,
      )
      initializationContext.substage = 'custody_commit'
      assertCustodyUnchanged()
    })
    let initializeBusyRetries = 0
    while (true) {
      assertNotCancelled(execution.signal)
      try {
        withBusyTimeoutDisabled(db, () => commitWithCustody(execution, (assertCustodyUnchanged) =>
          initialize.immediate(assertCustodyUnchanged)))
        break
      } catch (error) {
        attachCleanupFailureDiagnostic(error, normalizeCleanupFailureDiagnostic({
          ...initializationContext,
          causeClass: cleanupCauseClassForError(error),
        }))
        if (!isRetryableSqliteBusy(error) || initializeBusyRetries >= CLEANUP_BUSY_RETRY_LIMIT) {
          throw error
        }
        initializeBusyRetries += 1
        await yieldAfterBusyRetry()
      }
    }
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
    const guardedJournal = readGuardedJournal(db, journal)
    const progress = guardedJournal.progress
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
    assertProgressStillCurrent(db, evidence, guardedJournal, createCleanupPlan())
    return runFromJournal(evidence, execution)
  }

  /** Advances one transaction-sized cursor at a time and yields after every boundary. */
  async function runFromJournal(evidence, executionOptions) {
    let committedDeletionBatches = 0
    let busyRetries = 0
    const failureContext = {
      substage: 'worker_execute',
      tableName: null,
      cursor: null,
    }
    try {
      while (true) {
        assertNotCancelled(executionOptions.signal)
        let outcome
        try {
          failureContext.substage = 'worker_execute'
          outcome = withBusyTimeoutDisabled(db, () => advanceOneBoundary(
            evidence,
            executionOptions.faultInjection,
            executionOptions,
            failureContext,
          ))
          busyRetries = 0
        } catch (error) {
          if (!isRetryableSqliteBusy(error) || busyRetries >= CLEANUP_BUSY_RETRY_LIMIT) {
            throw error
          }
          busyRetries += 1
          // A setImmediate-only loop can exhaust all retries in a few
          // milliseconds while SQLite still holds the writer lock. Keep the
          // retry asynchronous and paced so the main lane remains responsive.
          await yieldAfterBusyRetry()
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
            tableBatch: outcome.tableBatch,
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
        await yieldToMain()
      }
    } catch (error) {
      const diagnostic = normalizeCleanupFailureDiagnostic({
        ...failureContext,
        causeClass: cleanupCauseClassForError(error),
      })
      if (error?.preserveForRestart === true) {
        attachCleanupFailureDiagnostic(error, diagnostic)
        throw error
      }
      const failure = error instanceof ArchiveCleanupError
        && error.code === 'ARCHIVE_CLEANUP_CANCELLED'
        ? error
        : new ArchiveCleanupError(
            'ARCHIVE_CLEANUP_FAILED',
            'Mission cleanup failed safely and will resume from its durable cursor.',
          )
      if (failure !== error) failure.cause = error
      attachCleanupFailureDiagnostic(failure, diagnostic)
      try {
        await recordFailure(evidence, failure.code)
      } catch (auditError) {
        const terminal = new ArchiveCleanupError(
          'ARCHIVE_CLEANUP_AUDIT_FAILED',
          'Mission cleanup and its durable failure audit both failed safely.',
        )
        terminal.cause = new AggregateError([error, auditError])
        attachCleanupFailureDiagnostic(terminal, normalizeCleanupFailureDiagnostic({
          substage: 'record_failure',
          causeClass: cleanupCauseClassForError(auditError),
          tableName: failureContext.tableName,
          cursor: failureContext.cursor,
        }))
        throw terminal
      }
      throw failure
    }
  }

  /** Commits either one bounded delete page, one table advance, or terminal completion. */
  function advanceOneBoundary(evidence, faultInjection, executionOptions, failureContext) {
    failureContext.substage = 'custody_commit'
    const advance = db.transaction((assertCustodyUnchanged) => {
      failureContext.substage = 'inventory_reconcile'
      const guardedJournal = requireGuardedInProgressJournal(db, evidence)
      const progress = guardedJournal.progress
      failureContext.tableName = progress.tables[progress.tableIndex] ?? null
      failureContext.cursor = {
        tableIndex: progress.tableIndex,
        tableCount: progress.tables.length,
        tableBatch: progress.tableBatch,
        tableCursor: progress.tableCursor,
        missionEventsTargetRowid: progress.missionEventsTargetRowid,
        deletedRows: progress.deletedRows,
        totalDeletedRows: progress.deletedRows,
      }
      assertProgressStillCurrent(db, evidence, guardedJournal, createCleanupPlan())
      if (progress.tableIndex >= progress.tables.length) {
        failureContext.substage = 'completion'
        assertCleanupExhausted(db, evidence.missionId, progress.tables, schemaVersion)
        const completedAt = now()
        const completionEventId = appendEvent(
          evidence.missionId,
          'mission_cleanup_completed',
          completedAt,
          {
          archive_id: evidence.archiveId,
          cleanup_guard_version: CLEANUP_GUARD_VERSION,
          finalization_epoch: progress.finalizationEpoch,
          removed_live_row_count: progress.deletedRows,
          resulting_status: 'finalized',
          storage_state: 'archived',
          },
        )
        completeJournalAndGuard(
          db,
          evidence,
          guardedJournal,
          completedAt,
          completionEventId,
        )
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
        failureContext.substage = 'custody_commit'
        assertCustodyUnchanged()
        return outcome
      }
      const tableName = progress.tables[progress.tableIndex]
      if (tableName === 'mission_events') {
        const cursor = progress.tableCursor ?? 0
        const limit = batchLimits.missionEvents
        failureContext.substage = 'select_page'
        if (faultInjection?.failBeforeSelectForTable === tableName) {
          throw new Error('Injected cleanup failure before select page.')
        }
        const selected = db.prepare(`SELECT rowid FROM mission_events
          WHERE rowid > ? AND rowid <= ? ORDER BY rowid LIMIT ?`).all(
          cursor,
          progress.missionEventsTargetRowid,
          limit,
        )
        if (selected.length === 0) {
          const next = {
            ...progress,
            tableIndex: progress.tableIndex + 1,
            tableBatch: 0,
            tableCursor: null,
          }
          failureContext.substage = 'journal_update'
          updateProgress(db, evidence, guardedJournal, next, now())
          const outcome = Object.freeze({
            completed: false,
            deletedRows: 0,
            totalDeletedRows: next.deletedRows,
            tableName,
            tableIndex: next.tableIndex,
            tableCount: next.tables.length,
          })
          failureContext.substage = 'custody_commit'
          assertCustodyUnchanged()
          return outcome
        }
        const nextCursor = Number(selected.at(-1)?.rowid)
        if (!Number.isSafeInteger(nextCursor) || nextCursor <= cursor
          || nextCursor > progress.missionEventsTargetRowid) {
          throw new ArchiveCleanupError(
            'ARCHIVE_CLEANUP_JOURNAL_CORRUPT',
            'Mission-event cleanup produced an invalid forward cursor.',
          )
        }
        failureContext.substage = 'delete_page'
        if (faultInjection?.failBeforeDeleteForTable === tableName) {
          throw new Error('Injected cleanup failure before delete page.')
        }
        assertArchiveCleanupMembershipGeneration(db, {
          missionId: evidence.missionId,
          expectedGeneration: progress.membershipGeneration,
        })
        const deleted = withArchiveCleanupMembershipBypass(db, {
          missionId: evidence.missionId,
          archiveId: evidence.archiveId,
        }, () => db.prepare(`DELETE FROM mission_events
            WHERE rowid > ? AND rowid <= ? AND mission_id = ?
              AND event_type IN (${CLEANABLE_MISSION_EVENT_TYPE_PLACEHOLDERS})`).run(
          cursor,
          nextCursor,
          evidence.missionId,
          ...CLEANABLE_MISSION_EVENT_TYPES,
        ))
        assertArchiveCleanupMembershipGeneration(db, {
          missionId: evidence.missionId,
          expectedGeneration: progress.membershipGeneration,
        })
        if (faultInjection?.failBeforeJournalUpdateForTable === tableName) {
          throw new Error('Injected cleanup failure before journal update.')
        }
        failureContext.substage = 'journal_update'
        const next = {
          ...progress,
          tableBatch: progress.tableBatch + 1,
          tableCursor: nextCursor,
          deletedRows: checkedCleanupCountAdd(progress.deletedRows, deleted.changes),
        }
        updateProgress(db, evidence, guardedJournal, next, now())
        const outcome = Object.freeze({
          completed: false,
          deletedRows: deleted.changes,
          totalDeletedRows: next.deletedRows,
          tableName,
          tableBatch: next.tableBatch,
          tableIndex: next.tableIndex,
          tableCount: next.tables.length,
        })
        failureContext.substage = 'custody_commit'
        assertCustodyUnchanged()
        return outcome
      }
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
      failureContext.substage = 'select_page'
      if (faultInjection?.failBeforeSelectForTable === tableName) {
        throw new Error('Injected cleanup failure before select page.')
      }
      const selected = db.prepare(`SELECT ${selectedKeys.join(', ')}
        FROM ${quoteIdentifier(tableName)} AS archive_row
        WHERE ${selection.whereSql}
        ORDER BY ${selectedKeys.join(', ')} LIMIT ?`).all(
        ...selection.parameters,
        limit,
      )
      if (selected.length === 0) {
        const next = {
          ...progress,
          tableIndex: progress.tableIndex + 1,
          tableBatch: 0,
          tableCursor: null,
        }
        failureContext.substage = 'journal_update'
        updateProgress(db, evidence, guardedJournal, next, now())
        const outcome = Object.freeze({
          completed: false,
          deletedRows: 0,
          totalDeletedRows: next.deletedRows,
          tableName,
          tableIndex: next.tableIndex,
          tableCount: next.tables.length,
        })
        failureContext.substage = 'custody_commit'
        assertCustodyUnchanged()
        return outcome
      }
      const outerKeys = keyColumns.map((column) => quoteIdentifier(column))
      const keyExpression = outerKeys.length === 1
        ? outerKeys[0]
        : `(${outerKeys.join(', ')})`
      failureContext.substage = 'delete_page'
      if (faultInjection?.failBeforeDeleteForTable === tableName) {
        throw new Error('Injected cleanup failure before delete page.')
      }
      assertArchiveCleanupMembershipGeneration(db, {
        missionId: evidence.missionId,
        expectedGeneration: progress.membershipGeneration,
      })
      const deleted = withArchiveCleanupMembershipBypass(db, {
        missionId: evidence.missionId,
        archiveId: evidence.archiveId,
      }, () => db.prepare(`DELETE FROM ${quoteIdentifier(tableName)}
          WHERE ${keyExpression} IN (
            SELECT ${selectedKeys.join(', ')}
            FROM ${quoteIdentifier(tableName)} AS archive_row
            WHERE ${selection.whereSql}
            ORDER BY ${selectedKeys.join(', ')} LIMIT ?
          )`).run(...selection.parameters, limit))
      assertArchiveCleanupMembershipGeneration(db, {
        missionId: evidence.missionId,
        expectedGeneration: progress.membershipGeneration,
      })
      if (deleted.changes !== selected.length) {
        throw new Error('Cleanup delete page changed before its cursor could commit.')
      }
      if (faultInjection?.failBeforeJournalUpdateForTable === tableName) {
        throw new Error('Injected cleanup failure before journal update.')
      }
      failureContext.substage = 'journal_update'
      const next = {
        ...progress,
        tableBatch: progress.tableBatch + 1,
        tableCursor: null,
        deletedRows: checkedCleanupCountAdd(progress.deletedRows, deleted.changes),
      }
      updateProgress(db, evidence, guardedJournal, next, now())
      const outcome = Object.freeze({
        completed: false,
        deletedRows: deleted.changes,
        totalDeletedRows: next.deletedRows,
        tableName,
        tableBatch: next.tableBatch,
        tableIndex: next.tableIndex,
        tableCount: next.tables.length,
      })
      failureContext.substage = 'custody_commit'
      assertCustodyUnchanged()
      return outcome
    })
    return commitWithCustody(executionOptions, (assertCustodyUnchanged) =>
      advance.immediate(assertCustodyUnchanged))
  }

  /** Retains the forward cursor and records only a stable bounded failure code. */
  async function recordFailure(evidence, code) {
    let retries = 0
    while (true) {
      try {
        return withBusyTimeoutDisabled(db, () => {
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
        })
      } catch (error) {
        if (!isRetryableSqliteBusy(error) || retries >= CLEANUP_BUSY_RETRY_LIMIT) throw error
        retries += 1
        await yieldAfterBusyRetry()
      }
    }
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

/** Runs one cleanup transaction with SQLite lock acquisition made non-blocking. */
function withBusyTimeoutDisabled(db, callback) {
  const previousBusyTimeout = Number(db.pragma('busy_timeout', { simple: true }))
  if (!Number.isSafeInteger(previousBusyTimeout) || previousBusyTimeout < 0) {
    throw new ArchiveCleanupError(
      'ARCHIVE_CLEANUP_STATE_INVALID',
      'SQLite busy-timeout configuration is invalid.',
    )
  }
  db.pragma('busy_timeout = 0')
  try {
    return callback()
  } finally {
    db.pragma(`busy_timeout = ${previousBusyTimeout}`)
  }
}

/** Normalizes the bounded row-page sizes. */
function normalizeBatchLimits(input = {}) {
  const positions = input.positions ?? 500
  const missionEvents = input.missionEvents ?? 1_000
  const fallback = input.default ?? 50
  if (!Number.isSafeInteger(positions) || positions < 1 || positions > 5_000
    || !Number.isSafeInteger(missionEvents) || missionEvents < 1 || missionEvents > 5_000
    || !Number.isSafeInteger(fallback) || fallback < 1 || fallback > 500) {
    throw new ArchiveCleanupError(
      'ARCHIVE_CLEANUP_INPUT_INVALID',
      'Archive cleanup batch limits are invalid.',
    )
  }
  return Object.freeze({ positions, missionEvents, default: fallback })
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
  const finalizationBoundary = readCurrentMissionFinalizationBoundary(db, {
    missionId: evidence.missionId,
    archiveId: evidence.archiveId,
  })
  if (archive?.mission_id !== evidence.missionId || finalizationBoundary === null) {
    blockers.push('current_finalization_epoch_mismatch')
  } else {
    try {
      assertArchiveCleanupMembershipGeneration(db, {
        missionId: evidence.missionId,
        expectedGeneration: finalizationBoundary.cleanupMembershipGeneration,
      })
    } catch {
      blockers.push('cleanup_membership_changed')
    }
    if (hasPostFinalizationCleanableTelemetry(
      db,
      evidence.missionId,
      finalizationBoundary.eventRowid,
    )) {
      blockers.push('cleanup_membership_changed')
    }
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

/** Requires one exact current finalization boundary for this archive identity. */
function requireCurrentFinalizationBoundary(db, evidence) {
  const boundary = readCurrentMissionFinalizationBoundary(db, {
    missionId: evidence.missionId,
    archiveId: evidence.archiveId,
  })
  if (boundary !== null) return boundary
  throw new ArchiveCleanupError(
    'ARCHIVE_CLEANUP_EPOCH_CHANGED',
    'Mission finalization or verified archive identity changed during cleanup.',
  )
}

/** Probes only the rowid suffix beyond the immutable finalization event. */
function hasPostFinalizationCleanableTelemetry(db, missionId, finalizationEventRowid) {
  return db.prepare(`SELECT 1 FROM mission_events
    WHERE rowid > ? AND mission_id = ?
      AND event_type IN (${CLEANABLE_MISSION_EVENT_TYPE_PLACEHOLDERS})
    LIMIT 1`).get(
    finalizationEventRowid,
    missionId,
    ...CLEANABLE_MISSION_EVENT_TYPES,
  ) !== undefined
}

/** Reads one cleanup row without trusting its JSON cursor. */
function readJournal(db, missionId) {
  return db.prepare('SELECT * FROM mission_cleanup_journal WHERE mission_id = ?').get(missionId)
    ?? null
}

/** Derives a bounded metadata key without reflecting a mission identifier into SQL. */
function cleanupGuardKey(missionId) {
  return `${CLEANUP_GUARD_KEY_PREFIX}${createHash('sha256')
    .update(missionId, 'utf8')
    .digest('hex')}`
}

/** Produces the exact byte digest used to bind a journal representation. */
function digestUtf8(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

/** Returns whether an object has exactly the supported bounded key set. */
function hasExactKeys(value, expectedKeys) {
  const keys = Object.keys(value)
  return keys.length === expectedKeys.length
    && keys.every((key) => expectedKeys.includes(key))
}

/** Parses one bounded JSON object or fails the journal closed. */
function parseBoundedJournalObject(input, maximumBytes, message) {
  try {
    if (typeof input !== 'string' || Buffer.byteLength(input, 'utf8') > maximumBytes) {
      throw new Error()
    }
    const parsed = JSON.parse(input)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error()
    return parsed
  } catch {
    throw new ArchiveCleanupError('ARCHIVE_CLEANUP_JOURNAL_CORRUPT', message)
  }
}

/** Returns whether a value is one exact canonical UTC timestamp. */
function isCanonicalTimestamp(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 100) return false
  const milliseconds = Date.parse(value)
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value
}

/** Builds the redundant metadata anchor for one exact journal revision. */
function createCleanupGuard(input) {
  const progressJson = input.progressJson ?? JSON.stringify(input.progress)
  const progress = normalizeProgress(progressJson)
  if (!['in_progress', 'completed'].includes(input.state)
    || !Number.isSafeInteger(input.revision) || input.revision < 0
    || input.revision !== progress.guardRevision
    || typeof input.finalizationEventId !== 'string'
    || input.finalizationEventId.length < 1 || input.finalizationEventId.length > 200
    || typeof input.startedEventId !== 'string'
    || input.startedEventId.length < 1 || input.startedEventId.length > 200
    || (input.completionEventId !== null && (
      typeof input.completionEventId !== 'string'
      || input.completionEventId.length < 1 || input.completionEventId.length > 200
    ))
    || (input.completedAt !== null && !isCanonicalTimestamp(input.completedAt))
    || (input.state === 'completed') !== (input.completionEventId !== null)
    || (input.state === 'completed') !== (input.completedAt !== null)) {
    throw new ArchiveCleanupError(
      'ARCHIVE_CLEANUP_STATE_INVALID',
      'Mission cleanup guard state is invalid.',
    )
  }
  return Object.freeze({
    version: CLEANUP_GUARD_VERSION,
    missionId: input.missionId,
    archiveId: progress.archiveId,
    finalizationEventId: input.finalizationEventId,
    finalizationEpoch: progress.finalizationEpoch,
    ciphertextSha256: progress.ciphertextSha256,
    sizeBytes: progress.sizeBytes,
    verificationProofSha256: progress.verificationProofSha256,
    tablePlanSha256: digestUtf8(JSON.stringify(progress.tables)),
    progressVersion: progress.version,
    membershipGeneration: progress.membershipGeneration,
    state: input.state,
    revision: input.revision,
    progressSha256: digestUtf8(progressJson),
    startedEventId: input.startedEventId,
    completionEventId: input.completionEventId,
    completedAt: input.completedAt,
  })
}

/** Parses the exact bounded metadata anchor shape. */
function normalizeCleanupGuard(input) {
  const parsed = parseBoundedJournalObject(
    input,
    64 * 1024,
    'Mission cleanup journal guard is corrupt.',
  )
  const expectedKeys = [
    'version',
    'missionId',
    'archiveId',
    'finalizationEventId',
    'finalizationEpoch',
    'ciphertextSha256',
    'sizeBytes',
    'verificationProofSha256',
    'tablePlanSha256',
    'progressVersion',
    'membershipGeneration',
    'state',
    'revision',
    'progressSha256',
    'startedEventId',
    'completionEventId',
    'completedAt',
  ]
  if (!hasExactKeys(parsed, expectedKeys)
    || parsed.version !== CLEANUP_GUARD_VERSION
    || typeof parsed.missionId !== 'string' || parsed.missionId.length < 1
    || Buffer.byteLength(parsed.missionId, 'utf8') > 200
    || typeof parsed.archiveId !== 'string' || parsed.archiveId.length < 1
    || Buffer.byteLength(parsed.archiveId, 'utf8') > 200
    || typeof parsed.finalizationEventId !== 'string'
    || parsed.finalizationEventId.length < 1 || parsed.finalizationEventId.length > 200
    || !Number.isSafeInteger(parsed.finalizationEpoch) || parsed.finalizationEpoch < 1
    || typeof parsed.ciphertextSha256 !== 'string'
    || !/^[0-9a-f]{64}$/u.test(parsed.ciphertextSha256)
    || !Number.isSafeInteger(parsed.sizeBytes) || parsed.sizeBytes < 1
    || typeof parsed.verificationProofSha256 !== 'string'
    || !/^[0-9a-f]{64}$/u.test(parsed.verificationProofSha256)
    || typeof parsed.tablePlanSha256 !== 'string'
    || !/^[0-9a-f]{64}$/u.test(parsed.tablePlanSha256)
    || parsed.progressVersion !== CLEANUP_PROGRESS_VERSION
    || !Number.isSafeInteger(parsed.membershipGeneration)
    || parsed.membershipGeneration < 0
    || !['in_progress', 'completed'].includes(parsed.state)
    || !Number.isSafeInteger(parsed.revision) || parsed.revision < 0
    || typeof parsed.progressSha256 !== 'string'
    || !/^[0-9a-f]{64}$/u.test(parsed.progressSha256)
    || typeof parsed.startedEventId !== 'string'
    || parsed.startedEventId.length < 1 || parsed.startedEventId.length > 200
    || (parsed.completionEventId !== null && (
      typeof parsed.completionEventId !== 'string'
      || parsed.completionEventId.length < 1 || parsed.completionEventId.length > 200
    ))
    || (parsed.completedAt !== null && !isCanonicalTimestamp(parsed.completedAt))
    || (parsed.state === 'completed') !== (parsed.completionEventId !== null)
    || (parsed.state === 'completed') !== (parsed.completedAt !== null)) {
    throw new ArchiveCleanupError(
      'ARCHIVE_CLEANUP_JOURNAL_CORRUPT',
      'Mission cleanup journal guard is corrupt.',
    )
  }
  return Object.freeze({ ...parsed })
}

/** Reads the bounded independent metadata copy of one journal's monotonic state. */
function readArchiveCleanupGuard(db, missionId) {
  if (db === null || typeof db !== 'object' || typeof db.prepare !== 'function'
    || typeof missionId !== 'string' || missionId.length < 1
    || Buffer.byteLength(missionId, 'utf8') > 200) {
    throw new ArchiveCleanupError(
      'ARCHIVE_CLEANUP_INPUT_INVALID',
      'Mission cleanup guard input is invalid.',
    )
  }
  const row = db.prepare('SELECT value FROM metadata WHERE key = ?')
    .get(cleanupGuardKey(missionId))
  if (row === undefined) return null
  const guardJson = row.value
  const guard = normalizeCleanupGuard(guardJson)
  if (guard.missionId !== missionId) {
    throw new ArchiveCleanupError(
      'ARCHIVE_CLEANUP_JOURNAL_CORRUPT',
      'Mission cleanup journal guard identity is corrupt.',
    )
  }
  return Object.freeze({ guard, guardJson })
}

/** Inserts the first guard without overwriting any unexplained state. */
function insertCleanupGuard(db, missionId, guard) {
  try {
    db.prepare('INSERT INTO metadata (key, value) VALUES (?, ?)').run(
      cleanupGuardKey(missionId),
      JSON.stringify(guard),
    )
  } catch (error) {
    const wrapped = new ArchiveCleanupError(
      'ARCHIVE_CLEANUP_JOURNAL_CORRUPT',
      'Mission cleanup guard already exists or could not be created.',
    )
    wrapped.cause = error
    throw wrapped
  }
}

/** Replaces only the exact previously validated guard representation. */
function replaceCleanupGuard(db, missionId, previousGuardJson, nextGuard) {
  const updated = db.prepare(`UPDATE metadata SET value = ?
    WHERE key = ? AND value = ?`).run(
    JSON.stringify(nextGuard),
    cleanupGuardKey(missionId),
    previousGuardJson,
  )
  if (updated.changes !== 1) {
    throw new ArchiveCleanupError(
      'ARCHIVE_CLEANUP_JOURNAL_CORRUPT',
      'Mission cleanup guard changed before its next atomic revision.',
    )
  }
}

/** Parses bounded event details without trusting audit-row content. */
function readCleanupEvent(db, missionId, eventId) {
  const row = db.prepare(`SELECT rowid AS event_rowid, id, mission_id, event_type,
      timestamp, details_json FROM mission_events WHERE id = ?`).get(eventId)
  if (row?.mission_id !== missionId || row.id !== eventId
    || !Number.isSafeInteger(Number(row.event_rowid)) || Number(row.event_rowid) < 1
    || !isCanonicalTimestamp(row.timestamp)) {
    throw new ArchiveCleanupError(
      'ARCHIVE_CLEANUP_JOURNAL_CORRUPT',
      'Mission cleanup audit-event identity is corrupt.',
    )
  }
  const details = parseBoundedJournalObject(
    row.details_json,
    64 * 1024,
    'Mission cleanup audit-event details are corrupt.',
  )
  return Object.freeze({ ...row, eventRowid: Number(row.event_rowid), details })
}

/** Verifies both durable copies plus the immutable audit identities they name. */
function readGuardedJournal(db, journal) {
  const progress = normalizeProgress(journal.progress_json)
  const guarded = readArchiveCleanupGuard(db, journal.mission_id)
  if (guarded === null) {
    throw new ArchiveCleanupError(
      'ARCHIVE_CLEANUP_JOURNAL_CORRUPT',
      'Mission cleanup journal has no independent guard.',
    )
  }
  const guard = guarded.guard
  if (journal.archive_id !== guard.archiveId
    || journal.state !== guard.state
    || progress.archiveId !== guard.archiveId
    || progress.finalizationEpoch !== guard.finalizationEpoch
    || progress.missionEventsTargetRowid !== guard.finalizationEpoch
    || progress.ciphertextSha256 !== guard.ciphertextSha256
    || progress.sizeBytes !== guard.sizeBytes
    || progress.verificationProofSha256 !== guard.verificationProofSha256
    || digestUtf8(JSON.stringify(progress.tables)) !== guard.tablePlanSha256
    || progress.version !== guard.progressVersion
    || progress.membershipGeneration !== guard.membershipGeneration
    || progress.guardRevision !== guard.revision
    || digestUtf8(journal.progress_json) !== guard.progressSha256
    || (journal.completed_at ?? null) !== guard.completedAt) {
    throw new ArchiveCleanupError(
      'ARCHIVE_CLEANUP_JOURNAL_CORRUPT',
      'Mission cleanup journal and guard do not match.',
    )
  }
  const finalizationEvent = readCleanupEvent(db, guard.missionId, guard.finalizationEventId)
  if (finalizationEvent.event_type !== 'mission_finalized'
    || finalizationEvent.eventRowid !== guard.finalizationEpoch
    || finalizationEvent.details.resulting_status !== 'finalized') {
    throw new ArchiveCleanupError(
      'ARCHIVE_CLEANUP_JOURNAL_CORRUPT',
      'Mission cleanup finalization identity is corrupt.',
    )
  }
  const startedEvent = readCleanupEvent(db, guard.missionId, guard.startedEventId)
  if (startedEvent.event_type !== 'mission_cleanup_started'
    || startedEvent.timestamp !== journal.started_at
    || startedEvent.details.archive_id !== guard.archiveId
    || startedEvent.details.cleanup_guard_version !== CLEANUP_GUARD_VERSION
    || startedEvent.details.finalization_event_id !== guard.finalizationEventId
    || startedEvent.details.finalization_epoch !== guard.finalizationEpoch
    || startedEvent.details.progress_version !== CLEANUP_PROGRESS_VERSION
    || startedEvent.details.resulting_status !== 'finalized'
    || startedEvent.details.storage_state !== 'cleanup_in_progress') {
    throw new ArchiveCleanupError(
      'ARCHIVE_CLEANUP_JOURNAL_CORRUPT',
      'Mission cleanup start custody is corrupt.',
    )
  }
  if (guard.state === 'completed') {
    const completedEvent = readCleanupEvent(db, guard.missionId, guard.completionEventId)
    if (progress.tableIndex !== progress.tables.length || progress.tableBatch !== 0
      || progress.tableCursor !== null
      || completedEvent.event_type !== 'mission_cleanup_completed'
      || completedEvent.timestamp !== guard.completedAt
      || completedEvent.details.archive_id !== guard.archiveId
      || completedEvent.details.cleanup_guard_version !== CLEANUP_GUARD_VERSION
      || completedEvent.details.finalization_epoch !== guard.finalizationEpoch
      || completedEvent.details.removed_live_row_count !== progress.deletedRows
      || completedEvent.details.resulting_status !== 'finalized'
      || completedEvent.details.storage_state !== 'archived') {
      throw new ArchiveCleanupError(
        'ARCHIVE_CLEANUP_JOURNAL_CORRUPT',
        'Mission cleanup completion custody is corrupt.',
      )
    }
  }
  return Object.freeze({ journal, progress, guard, guardJson: guarded.guardJson })
}

/** Returns one terminal cleanup proof only after both durable copies and audit custody verify. */
function readCompletedArchiveCleanupJournalProof(db, input) {
  if (db === null || typeof db !== 'object' || typeof db.prepare !== 'function'
    || input === null || typeof input !== 'object' || Array.isArray(input)
    || typeof input.missionId !== 'string' || input.missionId.length < 1
    || Buffer.byteLength(input.missionId, 'utf8') > 200
    || typeof input.archiveId !== 'string' || input.archiveId.length < 1
    || Buffer.byteLength(input.archiveId, 'utf8') > 200) {
    throw new ArchiveCleanupError(
      'ARCHIVE_CLEANUP_INPUT_INVALID',
      'Completed mission cleanup proof input is invalid.',
    )
  }
  const journal = readJournal(db, input.missionId)
  if (journal === null || journal.archive_id !== input.archiveId
    || journal.state !== 'completed') {
    throw new ArchiveCleanupError(
      'ARCHIVE_CLEANUP_JOURNAL_MISMATCH',
      'Mission cleanup has no completed journal for the requested archive.',
    )
  }
  const guarded = readGuardedJournal(db, journal)
  const { progress, guard } = guarded
  if (progress.tableIndex !== progress.tables.length
    || progress.tableBatch !== 0 || progress.tableCursor !== null
    || guard.state !== 'completed' || guard.completionEventId === null) {
    throw new ArchiveCleanupError(
      'ARCHIVE_CLEANUP_JOURNAL_CORRUPT',
      'Mission cleanup terminal proof is incomplete.',
    )
  }
  return Object.freeze({
    archiveId: progress.archiveId,
    state: journal.state,
    ciphertextSha256: progress.ciphertextSha256,
    sizeBytes: progress.sizeBytes,
    finalizationEpoch: progress.finalizationEpoch,
    finalizationEventId: guard.finalizationEventId,
    membershipGeneration: progress.membershipGeneration,
    verificationProofSha256: progress.verificationProofSha256,
    missionEventsTargetRowid: progress.missionEventsTargetRowid,
    tables: progress.tables,
    deletedRows: progress.deletedRows,
    guardRevision: guard.revision,
    startedEventId: guard.startedEventId,
    completionEventId: guard.completionEventId,
    completedAt: guard.completedAt,
  })
}

/** Revalidates a completed cleanup against current archive, epoch, plan, and residue state. */
function readCurrentCompletedArchiveCleanupProof(db, input) {
  const terminal = readCompletedArchiveCleanupJournalProof(db, input)
  const schemaVersion = input?.schemaVersion
  if (!Number.isSafeInteger(schemaVersion) || schemaVersion < 1) {
    throw new ArchiveCleanupError(
      'ARCHIVE_CLEANUP_INPUT_INVALID',
      'Completed mission cleanup schema identity is invalid.',
    )
  }
  const archive = db.prepare(`SELECT ciphertext_sha256, size_bytes
    FROM mission_archives WHERE id = ? AND mission_id = ?`).get(
    input.archiveId,
    input.missionId,
  )
  const journal = readJournal(db, input.missionId)
  const guardedJournal = readGuardedJournal(db, journal)
  const evidence = normalizeEvidence({
    archiveId: input.archiveId,
    missionId: input.missionId,
    ciphertextSha256: archive?.ciphertext_sha256,
    sizeBytes: Number(archive?.size_bytes),
    verificationProofValidated: true,
    custodyReconciled: true,
    archiveCustodyIdle: true,
    evidenceHealth: { state: 'healthy', pendingCount: 0, corruptCount: 0 },
    reviewActivity: false,
    nonMachineUnwrap: null,
  }, false)
  assertCompletedJournalCurrent(
    db,
    evidence,
    guardedJournal,
    buildArchiveCleanupPlan(db, schemaVersion),
    schemaVersion,
  )
  return terminal
}

/** Requires one exact guarded in-progress journal identity. */
function requireGuardedInProgressJournal(db, evidence) {
  const journal = readJournal(db, evidence.missionId)
  if (journal === null || journal.state !== 'in_progress'
    || journal.archive_id !== evidence.archiveId) {
    throw new ArchiveCleanupError(
      'ARCHIVE_CLEANUP_JOURNAL_MISMATCH',
      'Mission cleanup journal changed before its next bounded transaction.',
    )
  }
  return readGuardedJournal(db, journal)
}

/** Parses a bounded, forward-only cursor and rejects table-list substitution. */
function normalizeProgress(input) {
  const parsed = parseBoundedJournalObject(
    input,
    64 * 1024,
    'Mission cleanup journal progress is corrupt.',
  )
  const expectedKeys = [
    'version',
    'archiveId',
    'ciphertextSha256',
    'sizeBytes',
    'finalizationEpoch',
    'verificationProofSha256',
    'tables',
    'tableIndex',
    'tableBatch',
    'tableCursor',
    'missionEventsTargetRowid',
    'deletedRows',
    'guardRevision',
    'membershipGeneration',
  ]
  if (!hasExactKeys(parsed, expectedKeys)
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
    || !Number.isSafeInteger(parsed.deletedRows) || parsed.deletedRows < 0
    || !Number.isSafeInteger(parsed.guardRevision) || parsed.guardRevision < 0
    || !Number.isSafeInteger(parsed.membershipGeneration)
    || parsed.membershipGeneration < 0
    || !Number.isSafeInteger(parsed.missionEventsTargetRowid)
    || parsed.missionEventsTargetRowid < 1
    || parsed.missionEventsTargetRowid !== parsed.finalizationEpoch
    || (parsed.tableCursor !== null && (
      !Number.isSafeInteger(parsed.tableCursor)
      || parsed.tableCursor < 0
      || parsed.tableCursor > parsed.missionEventsTargetRowid
      || parsed.tables[parsed.tableIndex] !== 'mission_events'
    ))
    || (parsed.tableIndex === parsed.tables.length && parsed.tableBatch !== 0)) {
    throw new ArchiveCleanupError(
      'ARCHIVE_CLEANUP_JOURNAL_CORRUPT',
      'Mission cleanup journal progress is corrupt.',
    )
  }
  return Object.freeze({
    version: parsed.version,
    archiveId: parsed.archiveId,
    ciphertextSha256: parsed.ciphertextSha256,
    sizeBytes: parsed.sizeBytes,
    finalizationEpoch: parsed.finalizationEpoch,
    verificationProofSha256: parsed.verificationProofSha256,
    tables: Object.freeze([...parsed.tables]),
    tableIndex: parsed.tableIndex,
    tableBatch: parsed.tableBatch,
    tableCursor: parsed.tableCursor,
    missionEventsTargetRowid: parsed.missionEventsTargetRowid,
    deletedRows: parsed.deletedRows,
    guardRevision: parsed.guardRevision,
    membershipGeneration: parsed.membershipGeneration,
  })
}

/** Rechecks epoch, identity and the declarative table plan before every delete. */
function assertProgressStillCurrent(db, evidence, guardedJournal, currentTables) {
  const progress = guardedJournal.progress
  const finalizationBoundary = requireCurrentFinalizationBoundary(db, evidence)
  if (progress.archiveId !== evidence.archiveId
    || progress.ciphertextSha256 !== evidence.ciphertextSha256
    || progress.sizeBytes !== evidence.sizeBytes
    || progress.finalizationEpoch !== finalizationBoundary.eventRowid
    || progress.missionEventsTargetRowid !== finalizationBoundary.eventRowid
    || progress.membershipGeneration !== finalizationBoundary.cleanupMembershipGeneration
    || guardedJournal.guard.finalizationEventId !== finalizationBoundary.eventId) {
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

/** Requires exact current proof, custody, plan and residue before projecting archived state. */
function assertCompletedJournalCurrent(
  db,
  evidence,
  guardedJournal,
  currentTables,
  schemaVersion,
) {
  assertProgressStillCurrent(db, evidence, guardedJournal, currentTables)
  if (guardedJournal.journal.state !== 'completed'
    || guardedJournal.progress.tableIndex !== guardedJournal.progress.tables.length
    || guardedJournal.progress.tableCursor !== null) {
    throw new ArchiveCleanupError(
      'ARCHIVE_CLEANUP_JOURNAL_CORRUPT',
      'Mission cleanup completion state is not terminal.',
    )
  }
  assertCleanupExhausted(
    db,
    evidence.missionId,
    guardedJournal.progress.tables,
    schemaVersion,
  )
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

/** Performs one terminal-only residue probe for every table already declared complete. */
function assertCleanupExhausted(
  db,
  missionId,
  tables,
  schemaVersion,
) {
  for (const tableName of tables) {
    if (tableName === 'mission_events') {
      const residue = db.prepare(`SELECT 1 FROM mission_events
        WHERE mission_id = ?
          AND event_type IN (${CLEANABLE_MISSION_EVENT_TYPE_PLACEHOLDERS})
        LIMIT 1`).get(missionId, ...CLEANABLE_MISSION_EVENT_TYPES)
      if (residue !== undefined) {
        throw new ArchiveCleanupError(
          'ARCHIVE_CLEANUP_JOURNAL_CORRUPT',
          'Mission cleanup cannot complete while live mission-event residue remains.',
        )
      }
      continue
    }
    const selection = createCleanupSelection(db, tableName, missionId, schemaVersion)
    const residue = db.prepare(`SELECT 1 FROM ${quoteIdentifier(tableName)} AS archive_row
      WHERE ${selection.whereSql} LIMIT 1`).get(...selection.parameters)
    if (residue !== undefined) {
      throw new ArchiveCleanupError(
        'ARCHIVE_CLEANUP_JOURNAL_CORRUPT',
        'Mission cleanup cannot complete while declared live-row residue remains.',
      )
    }
  }
}

/** Checks one declaration-owned schema column without accepting a dynamic identifier. */
function tableHasColumn(db, tableName, columnName) {
  return db.prepare(`PRAGMA table_info(${quoteIdentifier(tableName)})`).all()
    .some((column) => column.name === columnName)
}

/** Adds one bounded monotonic counter without losing integer precision. */
function checkedCleanupCountAdd(left, right) {
  if (!Number.isSafeInteger(left) || left < 0
    || !Number.isSafeInteger(right) || right < 0
    || !Number.isSafeInteger(left + right)) {
    throw new ArchiveCleanupError(
      'ARCHIVE_CLEANUP_JOURNAL_CORRUPT',
      'Mission cleanup journal counter is outside the safe integer range.',
    )
  }
  return left + right
}

/** Requires one exact forward transition before its page can commit. */
function assertForwardProgressTransition(current, next) {
  const nextRevision = checkedCleanupCountAdd(current.guardRevision, 1)
  const immutableMatches = current.version === next.version
    && current.archiveId === next.archiveId
    && current.ciphertextSha256 === next.ciphertextSha256
    && current.sizeBytes === next.sizeBytes
    && current.finalizationEpoch === next.finalizationEpoch
    && current.verificationProofSha256 === next.verificationProofSha256
    && current.missionEventsTargetRowid === next.missionEventsTargetRowid
    && current.membershipGeneration === next.membershipGeneration
    && JSON.stringify(current.tables) === JSON.stringify(next.tables)
    && next.guardRevision === nextRevision
  const advancesTable = next.tableIndex === current.tableIndex + 1
    && next.tableBatch === 0
    && next.tableCursor === null
    && next.deletedRows === current.deletedRows
  const currentTable = current.tables[current.tableIndex]
  const advancesPage = next.tableIndex === current.tableIndex
    && next.tableBatch === checkedCleanupCountAdd(current.tableBatch, 1)
    && next.deletedRows >= current.deletedRows
    && (currentTable === 'mission_events'
      ? Number.isSafeInteger(next.tableCursor)
        && next.tableCursor > (current.tableCursor ?? 0)
        && next.tableCursor <= current.missionEventsTargetRowid
      : current.tableCursor === null && next.tableCursor === null)
  if (!immutableMatches || (!advancesTable && !advancesPage)) {
    throw new ArchiveCleanupError(
      'ARCHIVE_CLEANUP_JOURNAL_CORRUPT',
      'Mission cleanup journal attempted a non-forward transition.',
    )
  }
}

/** Updates both exact in-progress cursor copies in the surrounding transaction. */
function updateProgress(db, evidence, current, nextProgress, timestamp) {
  const nextRevision = checkedCleanupCountAdd(current.guard.revision, 1)
  const nextProgressJson = JSON.stringify({
    ...nextProgress,
    guardRevision: nextRevision,
  })
  const next = normalizeProgress(nextProgressJson)
  assertForwardProgressTransition(current.progress, next)
  const nextGuard = createCleanupGuard({
    missionId: evidence.missionId,
    progress: next,
    progressJson: nextProgressJson,
    state: 'in_progress',
    revision: nextRevision,
    finalizationEventId: current.guard.finalizationEventId,
    startedEventId: current.guard.startedEventId,
    completionEventId: null,
    completedAt: null,
  })
  const updated = db.prepare(`UPDATE mission_cleanup_journal
    SET progress_json = ?, updated_at = ?, last_error = NULL
    WHERE mission_id = ? AND archive_id = ? AND state = 'in_progress'
      AND completed_at IS NULL AND progress_json = ?`).run(
    nextProgressJson,
    timestamp,
    evidence.missionId,
    evidence.archiveId,
    current.journal.progress_json,
  )
  if (updated.changes !== 1) {
    throw new ArchiveCleanupError(
      'ARCHIVE_CLEANUP_JOURNAL_CORRUPT',
      'Mission cleanup journal changed before its next atomic revision.',
    )
  }
  replaceCleanupGuard(db, evidence.missionId, current.guardJson, nextGuard)
}

/** Atomically binds SQL completion to one immutable audit event and guard revision. */
function completeJournalAndGuard(
  db,
  evidence,
  current,
  completedAt,
  completionEventId,
) {
  const nextRevision = checkedCleanupCountAdd(current.guard.revision, 1)
  const nextProgressJson = JSON.stringify({
    ...current.progress,
    guardRevision: nextRevision,
  })
  const nextProgress = normalizeProgress(nextProgressJson)
  const nextGuard = createCleanupGuard({
    missionId: evidence.missionId,
    progress: nextProgress,
    progressJson: nextProgressJson,
    state: 'completed',
    revision: nextRevision,
    finalizationEventId: current.guard.finalizationEventId,
    startedEventId: current.guard.startedEventId,
    completionEventId,
    completedAt,
  })
  const updated = db.prepare(`UPDATE mission_cleanup_journal
    SET state = 'completed', progress_json = ?, updated_at = ?, completed_at = ?,
      last_error = NULL
    WHERE mission_id = ? AND archive_id = ? AND state = 'in_progress'
      AND completed_at IS NULL AND progress_json = ?`).run(
    nextProgressJson,
    completedAt,
    completedAt,
    evidence.missionId,
    evidence.archiveId,
    current.journal.progress_json,
  )
  if (updated.changes !== 1) {
    throw new ArchiveCleanupError(
      'ARCHIVE_CLEANUP_JOURNAL_CORRUPT',
      'Mission cleanup journal changed before terminal completion.',
    )
  }
  replaceCleanupGuard(db, evidence.missionId, current.guardJson, nextGuard)
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
  return cleanupCauseClassForError(error) === 'sqlite_busy'
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
  CLEANABLE_MISSION_EVENT_TYPES,
  createArchiveCleanupCoordinator,
  readArchiveCleanupGuard,
  readCompletedArchiveCleanupJournalProof,
  readCurrentCompletedArchiveCleanupProof,
}
