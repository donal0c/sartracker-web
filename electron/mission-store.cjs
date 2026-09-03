const fs = require('node:fs/promises')
const fsSync = require('node:fs')
const path = require('node:path')
const { createHash, randomUUID } = require('node:crypto')

const Database = require('better-sqlite3')
const { runBreadcrumbQueryInWorker } = require('./breadcrumb-query-runner.cjs')
const {
  runBreadcrumbDotQueryInWorker,
} = require('./breadcrumb-dot-query-runner.cjs')
const {
  runMissionReviewReadQueryInWorker,
} = require('./mission-review-read-query-runner.cjs')
const { runMissionReplayInWorker } = require('./mission-replay-runner.cjs')
const { runSearchOperationPageInWorker } = require('./search-operations-page-runner.cjs')
const { runSqliteBackupInWorker } = require('./sqlite-backup-runner.cjs')
const { runGpxEvidenceImportInWorker } = require('./gpx-evidence-import-runner.cjs')
const {
  startLegacyEvidenceBackfillWorker,
} = require('./legacy-evidence-backfill-runner.cjs')
const {
  DEFAULT_PAGE_BYTE_LIMIT,
  compactGpxDisplayGeometry,
  listGpxImportProjectionPage,
  listGpxImportRevisionProjectionPage,
  packGpxRendererPage,
} = require('./gpx-renderer-boundary.cjs')
const { validateSqliteSnapshotSanity } = require('./sqlite-snapshot-sanity.cjs')
const { isStrictTrackingTimestamp } = require('./tracking-timestamp.cjs')
const {
  compareStringsByCodeUnit,
} = require('./deterministic-string-order.cjs')
const {
  canonicalizeAcceptedPosition,
  classifyPositionIngest,
} = require('./position-ingest-policy.cjs')
const {
  listIngestAnomalies,
  recordConflictAnomaly,
  recordRejectedAnomaly,
  summarizeIngestAnomalies,
} = require('./ingest-anomaly-ledger.cjs')
const {
  createIngestAnomalyOutbox,
} = require('./ingest-anomaly-outbox.cjs')
const { writeFileDurably } = require('./durable-file.cjs')
const {
  backfillLegacyArchiveRegistry,
  createArchiveRegistry,
  readLegacyArchiveRegistryBackfillPending,
} = require('./archive-registry.cjs')
const {
  ACTIVE_ARCHIVE_CUSTODY_JOURNAL_KEY,
  createArchiveCustodyJournal,
} = require('./archive-custody-journal.cjs')
const {
  correctionJournalDirectory,
} = require('./archive-correction-custody.cjs')
const {
  startArchiveCorrectionAttachmentRecovery,
} = require('./archive-correction-custody-recovery-runner.cjs')
const {
  startArchiveCustodyOperation,
} = require('./archive-custody-operation-runner.cjs')
const { startArchiveVerifyWorker } = require('./archive-verify-runner.cjs')
const { startArchivePlaintextSweep } = require('./archive-plaintext-sweep-runner.cjs')
const { startArchiveCorrectionWorker } = require('./archive-correction-runner.cjs')
const {
  startArchiveLegacyPredecessorHash,
} = require('./archive-legacy-predecessor-runner.cjs')
const { startMissionArchiveCreateWorker } = require('./mission-archive-runner.cjs')
const {
  startArchiveCleanupCredentialCheck,
} = require('./archive-cleanup-credential-runner.cjs')
const { createArchiveCleanupCoordinator } = require('./archive-cleanup.cjs')
const {
  assertMissionLiveReviewAvailable: assertMissionLiveReviewSnapshotAvailable,
  readMissionLiveReviewStorageState,
} = require('./mission-live-review-access.cjs')
const {
  normalizeCustodyFileIdentity,
  withPinnedCustodyFileIdentity,
} = require('./archive-custody-file.cjs')

const { createZipArchive, readZipArchive } = require('./zip-archive.cjs')
const { createOutingStore } = require('./outing-store.cjs')
const {
  assertLegacyMissionObjectBackfillSettled,
  backfillLegacyMissionObjectVersions,
  createMissionEvidenceVersionStore,
  initializeLegacyMissionObjectVersionBackfill,
  readLegacyMissionObjectBackfillPending,
} = require('./mission-evidence-version-store.cjs')
const {
  assertLegacyEventProvenanceReady,
  backfillLegacyEventProvenance,
  initializeLegacyEventProvenanceBackfill,
  readLegacyEventProvenanceBackfillPending,
} = require('./mission-event-provenance-backfill.cjs')
const { createParticipantStore } = require('./participant-store.cjs')
const { runOutingFixSummaryInWorker } = require('./outing-fix-summary-runner.cjs')
const { runCoverageQueryInWorker } = require('./coverage-query-runner.cjs')
const {
  assertCoverageClaimMatchesDatabase,
  assertCoverageManifestOutings,
  assertCoverageResultInventory,
  readCoverageQueryResultLimits,
  readCurrentCoverageInventory,
} = require('./coverage-query-result-attestation.cjs')
const {
  normalizeCoverageWorkerResult,
} = require('./coverage-query-result-envelope.cjs')
const { normalizeCoverageTileAddress } = require('./coverage-tile-address.cjs')
const { createCoverageTileRunner } = require('./coverage-tile-runner.cjs')
const {
  assertCoverageBuildCoverage,
  assertCoverageBuildSummaries,
} = require('./coverage-build-attestation.cjs')
const {
  createCoverageChunkIdentity,
  normalizeCoverageCatalogInput,
  normalizeCoverageCatalogWorkerResult,
  normalizeCoverageMissionId,
  normalizeCoverageSelectedKeys,
} = require('./coverage-worker-envelope.cjs')
const {
  appendCoverageInvalidation,
  applyCoverageChunkBuild,
  applyCoverageChunkBuilds,
  applyCoverageEnumeration,
  applyCoverageInvalidationDrain,
  applyCoverageManifestInventory,
  bumpCoverageChangeSequence,
  normalizeCoverageInvalidationDrain,
  recordAcceptedCoveragePositions,
} = require('./coverage-ledger.cjs')

const CURRENT_SCHEMA_VERSION = 13
const MISSION_EVIDENCE_VERSION_SCHEMA = 12
const LEGACY_GPX_BACKFILL_DELAY_MS = 4
const LEGACY_ARCHIVE_REGISTRY_BACKFILL_DELAY_MS = 4
const MAX_GPX_RECEIPT_RECOVERY_ROWS_PER_TURN = 100
const MAX_GPX_RECEIPT_RECOVERY_BYTES_PER_TURN = 1024 * 1024
const MAX_INLINE_GPX_SOURCE_BASE64_LENGTH = 256 * 1024
const MAX_ADMITTED_GPX_IMPORT_BATCHES = 4
const DATABASE_FILE_NAME = 'mission-store.sqlite'
const BACKUP_FILE_NAME = 'mission-store.backup.sqlite'
const ARCHIVE_DIRECTORY_NAME = 'archives'
const INGEST_ANOMALY_OUTBOX_DIRECTORY_NAME = 'ingest-anomaly-outbox'
const COVERAGE_TILE_CACHE_DIRECTORY_NAME = 'coverage-renderer-cache'
const ARCHIVE_VERSION = 1
const MAX_SEARCH_OPERATION_ID_LENGTH = 200
const MAX_SEARCH_OPERATION_LINK_COUNT = 200
const MAX_SEARCH_OPERATION_SHORT_TEXT_LENGTH = 120
const MAX_SEARCH_OPERATION_NOTES_LENGTH = 2_000
const MAX_MARKER_TREATMENT_LOG_BYTES = 512 * 1_024
const MAX_SEARCH_OPERATION_TIMESTAMP_LENGTH = 64
const MAX_SEARCH_AREA_GEOMETRY_LENGTH = 512 * 1_024
const MAX_SEARCH_ADVISORY_COVERAGE_LENGTH = 512 * 1_024
const MAX_MUTABLE_EVIDENCE_GEOMETRY_BYTES = 512 * 1_024
const MAX_MUTABLE_EVIDENCE_METADATA_BYTES = 512 * 1_024
const MAX_MUTABLE_EVIDENCE_COORDINATES = 50_000
const MAX_MUTABLE_EVIDENCE_NESTING_DEPTH = 16
const MAX_MUTABLE_EVIDENCE_PATH_LENGTH = 4_096
const MAX_GPX_RENDERER_ID_LENGTH = 1_000
const MAX_GPX_RENDERER_OUTING_ID_LENGTH = 200
const MAX_GPX_RENDERER_ACTOR_LENGTH = 120
const MAX_GPX_ISSUE_FILE_NAME_LENGTH = 500
const MAX_GPX_ISSUE_HASH_LENGTH = 128
const MAX_GPX_ISSUE_REASON_LENGTH = 1_000
const MAX_GPX_ISSUE_TIMESTAMP_LENGTH = 64
const GPX_ISSUE_TRUNCATION_SUFFIX = '… [truncated for renderer]'
const ARCHIVE_UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u

/** Validates the opaque renderer correlation key used only for worker cancellation. */
function normalizeBreadcrumbQueryRequestId(value, required) {
  if (value === undefined && required === false) {
    return null
  }
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 120 ||
    !/^[A-Za-z0-9._:-]+$/u.test(value)
  ) {
    throw new Error('Breadcrumb query request ID is invalid.')
  }
  return value
}

/** Validates the opaque renderer correlation key used for Review worker cancellation. */
function normalizeMissionReviewRequestId(value, required) {
  if (value === undefined && required === false) return null
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 140 ||
    !/^[A-Za-z0-9._:-]+$/u.test(value)
  ) {
    throw new Error('Mission Review request ID is invalid.')
  }
  return value
}

/** Validates an opaque renderer correlation key used for outing-summary cancellation. */
function normalizeOutingFixSummaryRequestId(value, required) {
  if (value === undefined && required === false) return null
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 140 ||
    !/^[A-Za-z0-9._:-]+$/u.test(value)
  ) {
    throw new Error('Outing fix-summary request ID is invalid.')
  }
  return value
}

/** Validates the opaque renderer key used only for coverage-worker cancellation. */
function normalizeCoverageQueryRequestId(value, required) {
  if (value === undefined && required === false) return null
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 140 ||
    !/^[A-Za-z0-9._:-]+$/u.test(value)
  ) {
    throw new Error('Coverage query request ID is invalid.')
  }
  return value
}

/** Validates the opaque worker stage token returned to one renderer activation. */
function normalizeCoverageTileActivationId(value) {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 100 ||
    !/^coverage-stage-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}-[1-9][0-9]*$/u.test(value)
  ) {
    throw new Error('Coverage tile catalog activation ID is invalid.')
  }
  return value
}

/** Authorizes a bounded claim request against the current canonical inventory. */
function normalizeCoverageClaimInput(database, value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Coverage claim request is invalid.')
  }
  const missionId = normalizeCoverageMissionId(value.missionId)
  getMission(database, missionId)
  const allowed = readCurrentCoverageInventory(database, missionId)
  const selectedKeys = normalizeCoverageSelectedKeys(value.selectedKeys, allowed.size)
  for (const key of selectedKeys) {
    if (!allowed.has(createCoverageChunkIdentity(key))) {
      throw new Error('Coverage claim key is not in the current mission inventory.')
    }
  }
  return { missionId, selectedKeys }
}

/** Authorizes a bounded catalog request and its exact current ledger revisions. */
function normalizeAuthorizedCoverageCatalogInput(database, value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Coverage tile catalog request is invalid.')
  }
  const missionId = normalizeCoverageMissionId(value.missionId)
  getMission(database, missionId)
  const allowed = readCurrentCoverageInventory(database, missionId)
  const normalized = normalizeCoverageCatalogInput(value, allowed.size)
  const readRevision = database.prepare(`SELECT content_rev FROM coverage_chunks
    WHERE mission_id = ? AND device_id = ? AND period_kind = ? AND period_id = ?`)
  for (const descriptor of normalized.chunks) {
    if (!allowed.has(createCoverageChunkIdentity(descriptor.key))) {
      throw new Error('Coverage catalog key is not in the current mission inventory.')
    }
    const row = readRevision.get(
      missionId,
      descriptor.key.device_id,
      descriptor.key.period_kind,
      descriptor.key.period_id,
    )
    if (row === undefined || row.content_rev !== descriptor.contentRev) {
      throw new Error('Coverage catalog chunk does not match its current revision.')
    }
  }
  return normalized
}

/** Copies exact query-worker summaries into a main-owned, revision-bound oracle. */
function createCoverageManifestBuildEvidence(manifest) {
  return new Map(manifest.chunks.map((chunk) => [
    createCoverageChunkIdentity(chunk.key),
    {
      key: { ...chunk.key },
      contentRev: chunk.contentRev,
      fix_count: chunk.exactCount,
      fix_digest: chunk.exactDigest,
      min_ts: chunk.exactMinTs,
      max_ts: chunk.exactMaxTs,
    },
  ]))
}

/** Requires every catalog descriptor to match a prior exact off-main manifest summary. */
function readCoverageManifestBuildEvidence(evidenceByMission, input) {
  if (input.chunks.length === 0) return []
  const missionEvidence = evidenceByMission.get(input.missionId)
  if (missionEvidence === undefined) {
    throw new Error('Coverage tile catalog has no exact manifest attestation.')
  }
  return input.chunks.map((descriptor) => {
    const summary = missionEvidence.get(createCoverageChunkIdentity(descriptor.key))
    if (summary === undefined || summary.contentRev !== descriptor.contentRev) {
      throw new Error('Coverage tile catalog diverged from its exact manifest attestation.')
    }
    return summary
  })
}

/** Returns a valid stage token only when a malformed worker result can be discarded safely. */
function readDiscardableCoverageStageId(value) {
  try {
    return normalizeCoverageTileActivationId(value?.stageId)
  } catch {
    return null
  }
}

/** Validates and copies the complete renderer-owned tile read payload. */
function normalizeCoverageTileReadInput(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Coverage tile request is invalid.')
  }
  if (
    typeof value.missionId !== 'string' ||
    value.missionId.length < 1 ||
    value.missionId.length > 100
  ) {
    throw new Error('Coverage tile mission ID is invalid.')
  }
  if (
    typeof value.periodKey !== 'string' ||
    value.periodKey.length < 1 ||
    value.periodKey.length > 200
  ) {
    throw new Error('Coverage tile period key is invalid.')
  }
  if (
    typeof value.revisionDigest !== 'string' ||
    value.revisionDigest.length < 1 ||
    value.revisionDigest.length > 100
  ) {
    throw new Error('Coverage tile revision is invalid.')
  }
  const address = normalizeCoverageTileAddress(value)
  return {
    missionId: value.missionId,
    periodKey: value.periodKey,
    revisionDigest: value.revisionDigest,
    ...address,
  }
}

/** Validates and copies renderer-owned fields for one exact coverage chunk page. */
function normalizeCoverageChunkReadInput(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Coverage chunk request is invalid.')
  }
  if (
    typeof value.missionId !== 'string' ||
    value.missionId.length < 1 ||
    value.missionId.length > 100
  ) {
    throw new Error('Coverage chunk mission ID is invalid.')
  }
  const key = value.key
  if (
    key === null ||
    typeof key !== 'object' ||
    Array.isArray(key) ||
    typeof key.device_id !== 'string' ||
    key.device_id.length < 1 ||
    key.device_id.length > 100 ||
    !['outing', 'unassigned'].includes(key.period_kind) ||
    typeof key.period_id !== 'string' ||
    key.period_id.length > 100 ||
    (key.period_kind === 'outing' && key.period_id.length < 1) ||
    (key.period_kind === 'unassigned' && key.period_id !== '')
  ) {
    throw new Error('Coverage chunk key is invalid.')
  }
  if (!Number.isSafeInteger(value.expectedContentRev) || value.expectedContentRev < 1) {
    throw new Error('Coverage chunk revision is invalid.')
  }
  const cursor = value.cursor
  if (
    cursor !== undefined && cursor !== null &&
    (
      typeof cursor !== 'object' ||
      Array.isArray(cursor) ||
      !isStrictTrackingTimestamp(cursor.timestamp) ||
      typeof cursor.id !== 'string' ||
      cursor.id.length < 1 ||
      cursor.id.length > 100
    )
  ) {
    throw new Error('Coverage chunk cursor is invalid.')
  }
  if (
    value.limit !== undefined &&
    (!Number.isSafeInteger(value.limit) || value.limit < 1 || value.limit > 10_000)
  ) {
    throw new Error('Coverage chunk page limit is invalid.')
  }
  return {
    missionId: value.missionId,
    key: {
      device_id: key.device_id,
      period_kind: key.period_kind,
      period_id: key.period_id,
    },
    expectedContentRev: value.expectedContentRev,
    ...(cursor === undefined || cursor === null
      ? {}
      : { cursor: { timestamp: cursor.timestamp, id: cursor.id } }),
    ...(value.limit === undefined ? {} : { limit: value.limit }),
  }
}

/**
 * Creates the Electron SQLite mission store.
 */
function createElectronMissionStore(options) {
  const databasePath = path.join(options.userDataPath, DATABASE_FILE_NAME)
  const backupPath = path.join(options.userDataPath, BACKUP_FILE_NAME)
  const archiveDirectory = path.join(options.userDataPath, ARCHIVE_DIRECTORY_NAME)
  const ingestAnomalyOutboxDirectory = path.join(
    options.userDataPath,
    INGEST_ANOMALY_OUTBOX_DIRECTORY_NAME,
  )
  const finalizeMissionFaultInjection = options.finalizeMissionFaultInjection ?? {}
  const archiveFaultInjection = options.archiveFaultInjection ?? {}
  const archiveLifecycleFaultInjection = options.archiveLifecycleFaultInjection ?? {}
  const archiveCorrectionFaultInjection = options.archiveCorrectionFaultInjection ?? {}
  const readArchiveFile = options.readArchiveFile ?? fs.readFile
  const storageDiagnostics = options.storageDiagnostics ?? null
  const coverageLedgerFaultInjection = options.coverageLedgerFaultInjection ?? {}
  const gpxRetirementFaultInjection = options.gpxRetirementFaultInjection ?? {}
  const gpxReceiptRecoveryFaultInjection = options.gpxReceiptRecoveryFaultInjection ?? {}
  const archiveCorrectionAttachmentRecoveryRunner = options.startArchiveCorrectionAttachmentRecovery
    ?? startArchiveCorrectionAttachmentRecovery
  const breadcrumbQueryRunner =
    options.runBreadcrumbQueryInWorker ?? runBreadcrumbQueryInWorker
  const breadcrumbDotQueryRunner =
    options.runBreadcrumbDotQueryInWorker ?? runBreadcrumbDotQueryInWorker
  const missionReviewReadQueryRunner =
    options.runMissionReviewReadQueryInWorker ?? runMissionReviewReadQueryInWorker
  const missionReplayRunner = options.runMissionReplayInWorker ?? runMissionReplayInWorker
  const searchOperationPageRunner = options.runSearchOperationPageInWorker
    ?? runSearchOperationPageInWorker
  const gpxEvidenceImportRunner = options.runGpxEvidenceImportInWorker ?? runGpxEvidenceImportInWorker
  const gpxShutdownJoinTimeoutMs = Number.isFinite(options.gpxShutdownJoinTimeoutMs)
    ? Math.max(1, Math.min(30_000, Number(options.gpxShutdownJoinTimeoutMs)))
    : 5_000
  const outingFixSummaryRunner =
    options.runOutingFixSummaryInWorker ?? runOutingFixSummaryInWorker
  const coverageQueryRunner =
    options.runCoverageQueryInWorker ?? runCoverageQueryInWorker
  const coverageQueryRunnerValidatesResults = coverageQueryRunner === runCoverageQueryInWorker
  const coverageTileRunner = options.coverageTileRunner ?? createCoverageTileRunner({
    databasePath,
    cacheDirectory: path.join(options.userDataPath, COVERAGE_TILE_CACHE_DIRECTORY_NAME),
    onFailure: () => options.onCoverageRendererFailed?.(),
  })
  const onCoverageChanged = options.onCoverageChanged ?? (() => undefined)
  const coveragePerformanceByMission = new Map()
  const activeBreadcrumbQueryControllers = new Set()
  const breadcrumbQueryControllersByRequestId = new Map()
  const breadcrumbDotQueryControllersByRequestId = new Map()
  const missionReviewQueryControllersByRequestId = new Map()
  const missionReplayQueryControllersByRequestId = new Map()
  const outingFixSummaryControllersByRequestId = new Map()
  const coverageQueryControllersByRequestId = new Map()
  const coverageTileControllersByRequestId = new Map()
  const activeGpxEvidenceImports = new Set()
  const activeSearchOperationPageReads = new Set()
  const attachmentLifecycleTails = new Map()
  const coverageManifestBuildEvidenceByMission = new Map()
  const activeArchiveLifecycles = new Set()
  const activeArchiveLifecyclesByOperationId = new Map()
  const activeArchiveWorkerOperations = new Set()
  let archiveCorrectionAdmission = null
  const activeLiveReviewReadsByMission = new Map()
  const cleanupReviewBarrierByMission = new Map()
  let breadcrumbQueryTail = Promise.resolve()
  let missionReviewWorkerTail = Promise.resolve()
  let missionReplayWorkerTail = Promise.resolve()
  let outingFixSummaryWorkerTail = Promise.resolve()
  let coverageChunkWorkerTail = Promise.resolve()
  const queuedGpxEvidenceImports = []
  let gpxImportWorkerActive = false
  const db = new Database(databasePath)
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = FULL')
  db.pragma('foreign_keys = ON')
  const migrationState = migrate(db, archiveDirectory)
  let storeClosed = false
  let archiveCorrectionAttachmentRecoveryFailure = null
  let archiveCorrectionAttachmentRecoveryShutdownRequested = false
  let archiveCorrectionAttachmentRecoveryPromise = Promise.resolve()
  if (fsSync.existsSync(correctionJournalDirectory(databasePath))) {
    try {
      db.prepare(`INSERT INTO metadata (key, value) VALUES (
        'archive_correction_attachment_recovery_failure', 'pending'
      ) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run()
      const operation = archiveCorrectionAttachmentRecoveryRunner({ databasePath })
      activeArchiveWorkerOperations.add(operation)
      archiveCorrectionAttachmentRecoveryPromise = (async () => {
        try {
          await operation
          await Promise.resolve(operation.workerExited ?? operation)
          archiveCorrectionAttachmentRecoveryFailure = null
          if (!storeClosed) {
            db.prepare(`DELETE FROM metadata
              WHERE key = 'archive_correction_attachment_recovery_failure'`).run()
          }
        } catch (error) {
          if (archiveCorrectionAttachmentRecoveryShutdownRequested
            && error?.code === 'ARCHIVE_CANCELLED') {
            return
          }
          archiveCorrectionAttachmentRecoveryFailure =
            'ARCHIVE_CORRECTION_ATTACHMENT_RECOVERY_REQUIRED'
          if (!storeClosed) {
            db.prepare(`INSERT INTO metadata (key, value) VALUES (
              'archive_correction_attachment_recovery_failure', ?
            ) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(
              archiveCorrectionAttachmentRecoveryFailure,
            )
          }
        } finally {
          await Promise.resolve(operation.workerExited ?? operation).catch(() => undefined)
          activeArchiveWorkerOperations.delete(operation)
        }
      })()
    } catch {
      archiveCorrectionAttachmentRecoveryFailure = 'ARCHIVE_CORRECTION_ATTACHMENT_RECOVERY_REQUIRED'
      db.prepare(`INSERT INTO metadata (key, value) VALUES (
        'archive_correction_attachment_recovery_failure', ?
      ) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(
        archiveCorrectionAttachmentRecoveryFailure,
      )
    }
  } else {
    db.prepare(`DELETE FROM metadata
      WHERE key = 'archive_correction_attachment_recovery_failure'`).run()
  }
  const archiveRegistry = createArchiveRegistry({
    db,
    archiveDirectory,
    appendAuditEvent: (missionId, eventType, details) =>
      appendEvent(db, missionId, eventType, details),
    ...(options.startArchiveCustodyReconciliation === undefined
      ? {}
      : { startCustodyReconciliation: options.startArchiveCustodyReconciliation }),
  })
  const archiveCreateRunner = options.startMissionArchiveCreateWorker
    ?? startMissionArchiveCreateWorker
  const archiveVerifyRunner = options.startArchiveVerifyWorker ?? startArchiveVerifyWorker
  const archivePlaintextSweepRunner = options.startArchivePlaintextSweep
    ?? startArchivePlaintextSweep
  const archiveCorrectionRunner = options.startArchiveCorrectionWorker
    ?? startArchiveCorrectionWorker
  const archiveLegacyPredecessorHashRunner = options.startArchiveLegacyPredecessorHash
    ?? startArchiveLegacyPredecessorHash
  const archiveCustodyOperationRunner = options.startArchiveCustodyOperation
    ?? startArchiveCustodyOperation
  const archiveCustodyJournal = createArchiveCustodyJournal({
    db,
    archiveDirectory,
    runCustodyOperation: (ticket, signal) => archiveCustodyOperationRunner({ ticket, signal }),
  })
  const archiveCleanupCredentialRunner = options.startArchiveCleanupCredentialCheck
    ?? startArchiveCleanupCredentialCheck
  const archiveCleanupCoordinator = createArchiveCleanupCoordinator({
    db,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    now,
    yieldToMain: options.yieldArchiveCleanupToMain
      ?? (() => new Promise((resolve) => setImmediate(resolve))),
    appendEvent: (missionId, eventType, timestamp, details) =>
      insertEvent(db, missionId, eventType, timestamp, details),
    ...(options.archiveCleanupBatchLimits === undefined
      ? {}
      : { batchLimits: options.archiveCleanupBatchLimits }),
  })

  /** Refuses new live Review reads while cleanup is waiting to own that mission. */
  const assertStoreLiveMissionReviewAvailable = (missionId) => {
    assertMissionLiveReviewSnapshotAvailable(db, missionId)
    if (!cleanupReviewBarrierByMission.has(missionId)) return
    const error = new Error(
      'Mission live-store cleanup is starting; ordinary Review is unavailable.',
    )
    error.code = 'MISSION_REVIEW_CLEANUP_IN_PROGRESS'
    throw error
  }

  /** Runs one synchronous Review facet in the same snapshot as its storage-source gate. */
  const readLiveMissionReviewFacet = (missionId, read) => db.transaction(() => {
    assertStoreLiveMissionReviewAvailable(missionId)
    return read()
  })()

  /** Tracks one worker-backed Review read so cleanup cannot start between check and use. */
  const trackLiveMissionReviewRead = (missionId, start) => {
    assertStoreLiveMissionReviewAvailable(missionId)
    let operation
    try {
      operation = Promise.resolve(start())
    } catch (error) {
      throw error
    }
    const workerExited = Promise.resolve(operation.workerExited ?? operation)
    const checked = operation.then((result) => {
      assertStoreLiveMissionReviewAvailable(missionId)
      return result
    })
    const reads = activeLiveReviewReadsByMission.get(missionId) ?? new Set()
    activeLiveReviewReadsByMission.set(missionId, reads)
    let tracked
    tracked = Promise.allSettled([checked, workerExited]).then(() => undefined).finally(() => {
      reads.delete(tracked)
      if (reads.size === 0 && activeLiveReviewReadsByMission.get(missionId) === reads) {
        activeLiveReviewReadsByMission.delete(missionId)
      }
    })
    reads.add(tracked)
    return checked
  }

  /** Blocks new Review reads and joins every previously admitted worker before deletion. */
  const acquireCleanupReviewBarrier = async (missionId, operationId) => {
    const currentOwner = cleanupReviewBarrierByMission.get(missionId)
    if (currentOwner !== undefined && currentOwner !== operationId) {
      const error = new Error('Another mission cleanup operation already owns Review exclusion.')
      error.code = 'ARCHIVE_OPERATION_ACTIVE'
      throw error
    }
    cleanupReviewBarrierByMission.set(missionId, operationId)
    const activeReads = activeLiveReviewReadsByMission.get(missionId)
    if (activeReads !== undefined) await Promise.allSettled([...activeReads])
  }

  /** Releases only the exact cleanup operation's live Review exclusion. */
  const releaseCleanupReviewBarrier = (missionId, operationId) => {
    if (cleanupReviewBarrierByMission.get(missionId) === operationId) {
      cleanupReviewBarrierByMission.delete(missionId)
    }
  }
  let gpxReceiptRecoveryTimer = null
  let gpxReceiptRecoveryFailure = null
  let legacyArchiveRegistryBackfillTimer = null
  let legacyArchiveRegistryBackfillFailure = null
  let archiveRegistryReconciliationTimer = null
  let archiveRegistryReconciliationFailure = null
  let archiveRegistryReconciliationCycleStartedAt = null
  let archiveRegistryReconciliationActive = null
  let archiveRegistryReconciliationController = null
  let archiveRegistryReconciliationComplete = false
  // Shutdown is one-way: cancellation of the startup reconciliation pass must
  // not schedule a replacement pass before SQLite closes.
  let archiveRegistryReconciliationShutdownRequested = false
  let archiveCustodyRecoveryTimer = null
  let archiveCustodyRecoveryActive = null
  let archiveCustodyRecoveryController = null
  const persistedArchiveCustodyFailure = db.prepare(`SELECT value FROM metadata
    WHERE key = 'archive_custody_recovery_failure'`).get()?.value
  let archiveCustodyRecoveryFailure = archiveCustodyJournal.hasBlockingConflict()
    || persistedArchiveCustodyFailure !== undefined
    ? 'ARCHIVE_CUSTODY_RECOVERY_REQUIRED'
    : null
  let archiveCustodyRecoveryDidSettle = false
  let resolveArchiveCustodyRecovery
  const archiveCustodyRecoverySettled = new Promise((resolve) => {
    resolveArchiveCustodyRecovery = resolve
  })
  const settleArchiveCustodyRecovery = () => {
    if (archiveCustodyRecoveryDidSettle) return
    archiveCustodyRecoveryDidSettle = true
    resolveArchiveCustodyRecovery()
  }
  let archivePlaintextSweepOperation = null
  let archivePlaintextSweepFailure = null
  let archivePlaintextSweepFinished = false
  let archivePlaintextSweepSettled = Promise.resolve()

  /** Latches one bounded archive-only sweep failure and best-effort persists its gate. */
  const persistArchivePlaintextSweepFailure = (code) => {
    archivePlaintextSweepFailure = code
    if (storeClosed) return
    try {
      db.prepare(`INSERT INTO metadata (key, value) VALUES (
        'archive_plaintext_sweep_failure', ?
      ) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(code)
    } catch {
      // A failed SQLite gate write must not prevent the fixed-root sweep. The
      // in-memory latch still blocks this process; startup will retry any
      // remaining .verification root on the next process instance.
    }
  }

  /** Runs and physically joins one fixed-root plaintext sweep while retaining a durable gate. */
  const runArchivePlaintextSweep = () => {
    archivePlaintextSweepFinished = false
    try {
      archivePlaintextSweepOperation = archivePlaintextSweepRunner({ archiveDirectory })
    } catch (error) {
      archivePlaintextSweepFinished = true
      persistArchivePlaintextSweepFailure(stableArchiveFailureCode(
        error,
        'ARCHIVE_PLAINTEXT_SWEEP_FAILED',
      ))
      archivePlaintextSweepSettled = Promise.resolve()
      return archivePlaintextSweepSettled
    }
    archivePlaintextSweepSettled = (async () => {
      try {
        await archivePlaintextSweepOperation
        await Promise.resolve(
          archivePlaintextSweepOperation.workerExited ?? archivePlaintextSweepOperation,
        )
        archivePlaintextSweepFailure = null
        if (!storeClosed) {
          db.prepare(`DELETE FROM metadata
            WHERE key = 'archive_plaintext_sweep_failure'`).run()
        }
      } catch (error) {
        try {
          await Promise.resolve(
            archivePlaintextSweepOperation.workerExited ?? archivePlaintextSweepOperation,
          )
        } catch {}
        persistArchivePlaintextSweepFailure(stableArchiveFailureCode(
          error,
          'ARCHIVE_PLAINTEXT_SWEEP_FAILED',
        ))
      } finally {
        archivePlaintextSweepFinished = true
      }
    })()
    return archivePlaintextSweepSettled
  }

  /** Starts cleanup only when the fixed verification root exists or is unsafe to inspect. */
  const startArchivePlaintextStartupSweep = () => {
    const verificationRoot = path.join(archiveDirectory, '.verification')
    try {
      fsSync.lstatSync(verificationRoot)
    } catch (error) {
      if (error?.code === 'ENOENT') {
        archivePlaintextSweepFinished = true
        db.prepare(`DELETE FROM metadata
          WHERE key = 'archive_plaintext_sweep_failure'`).run()
        return Promise.resolve()
      }
      archivePlaintextSweepFinished = true
      persistArchivePlaintextSweepFailure('ARCHIVE_PLAINTEXT_SWEEP_SCOPE_INVALID')
      return Promise.resolve()
    }
    return runArchivePlaintextSweep()
  }
  archivePlaintextSweepSettled = startArchivePlaintextStartupSweep()

  /** Gates only archive work on the startup plaintext cleanup result. */
  const assertArchivePlaintextSweepReady = async () => {
    await archivePlaintextSweepSettled
    if (archivePlaintextSweepFailure !== null) {
      const error = new Error(
        'Archive plaintext cleanup requires review before archive work can start.',
      )
      error.code = archivePlaintextSweepFailure
      throw error
    }
  }

  /** Sweeps every verifier failure because forced worker exit bypasses verifier finally cleanup. */
  const recoverArchiveVerificationPlaintext = async () => {
    persistArchivePlaintextSweepFailure('ARCHIVE_VERIFY_PLAINTEXT_CLEANUP_FAILED')
    await runArchivePlaintextSweep()
  }
  const legacyEvidenceBackfillPending = migrationState.legacyGpxBackfillRemaining > 0
    || migrationState.legacyMissionObjectBackfillRemaining > 0
    || migrationState.legacyEventProvenanceBackfillRemaining > 0
  let legacyEvidenceBackfillWorker = null
  let legacyEvidenceBackfillWorkerStopped = !legacyEvidenceBackfillPending
  if (!legacyEvidenceBackfillPending) {
    db.prepare(`DELETE FROM metadata
      WHERE key = 'legacy_evidence_backfill_failure'`).run()
  } else {
    try {
      legacyEvidenceBackfillWorker = (
        options.startLegacyEvidenceBackfillWorker ?? startLegacyEvidenceBackfillWorker
      )({
        databasePath,
        eventPending: migrationState.legacyEventProvenanceBackfillRemaining > 0,
        objectPending: migrationState.legacyMissionObjectBackfillRemaining > 0,
        gpxPending: migrationState.legacyGpxBackfillRemaining > 0,
      })
      void legacyEvidenceBackfillWorker.completion.then(
        (result) => {
          legacyEvidenceBackfillWorkerStopped = true
          if (result?.stopped !== true && !storeClosed) {
            db.prepare(`DELETE FROM metadata
              WHERE key = 'legacy_evidence_backfill_failure'`).run()
          }
        },
        (error) => {
          legacyEvidenceBackfillWorkerStopped = true
          if (!storeClosed) {
            const failure = safeEvidenceFailureReason(error?.message ?? error)
            try {
              db.prepare(`INSERT INTO metadata (key, value) VALUES (
                'legacy_evidence_backfill_failure', ?
              ) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(failure)
            } catch (metadataError) {
              console.error(`Legacy evidence migration failure could not be persisted: ${safeEvidenceFailureReason(metadataError?.message ?? metadataError)}`)
            }
            console.error(`Legacy evidence migration stopped safely: ${failure}`)
          }
        },
      )
    } catch (error) {
      legacyEvidenceBackfillWorkerStopped = true
      const failure = safeEvidenceFailureReason(error?.message ?? error)
      db.prepare(`INSERT INTO metadata (key, value) VALUES (
        'legacy_evidence_backfill_failure', ?
      ) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(failure)
      console.error(`Legacy evidence migration could not start safely: ${failure}`)
    }
  }
  const scheduleGpxReceiptRecovery = () => {
    if (storeClosed || migrationState.gpxReceiptRecoveryRemaining === 0
      || gpxReceiptRecoveryTimer !== null || gpxReceiptRecoveryFailure !== null) return
    gpxReceiptRecoveryTimer = setTimeout(() => {
      gpxReceiptRecoveryTimer = null
      if (storeClosed) return
      try {
        const result = recoverUnsettledGpxImportReceipts(
          db,
          now(),
          MAX_GPX_RECEIPT_RECOVERY_ROWS_PER_TURN,
          gpxReceiptRecoveryFaultInjection,
        )
        migrationState.gpxReceiptRecoveryRemaining = result.remaining
        if (result.remaining === 0) {
          db.prepare(`DELETE FROM metadata
            WHERE key = 'gpx_receipt_recovery_failure'`).run()
        }
        scheduleGpxReceiptRecovery()
      } catch (error) {
        gpxReceiptRecoveryFailure = safeEvidenceFailureReason(error?.message ?? error)
        db.prepare(`INSERT INTO metadata (key, value) VALUES (
          'gpx_receipt_recovery_failure', ?
        ) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
          .run(gpxReceiptRecoveryFailure)
        console.error(`Interrupted GPX receipt recovery stopped safely: ${gpxReceiptRecoveryFailure}`)
      }
    }, LEGACY_GPX_BACKFILL_DELAY_MS)
  }

  /** Continues legacy archive registration in bounded event pages off the open call stack. */
  const scheduleLegacyArchiveRegistryBackfill = () => {
    if (
      storeClosed
      || migrationState.legacyArchiveRegistryBackfillRemaining === 0
      || legacyArchiveRegistryBackfillTimer !== null
      || legacyArchiveRegistryBackfillFailure !== null
    ) return
    legacyArchiveRegistryBackfillTimer = setTimeout(() => {
      legacyArchiveRegistryBackfillTimer = null
      if (storeClosed) return
      try {
        const result = backfillLegacyArchiveRegistry(db, { archiveDirectory })
        migrationState.legacyArchiveRegistryBackfillRemaining = result.remaining
        if (result.remaining === 0) {
          db.prepare(`DELETE FROM metadata
            WHERE key = 'legacy_archive_registry_backfill_failure'`).run()
          scheduleArchiveRegistryReconciliation()
        }
        scheduleLegacyArchiveRegistryBackfill()
      } catch (error) {
        legacyArchiveRegistryBackfillFailure = safeEvidenceFailureReason(
          error?.message ?? error,
        )
        db.prepare(`INSERT INTO metadata (key, value) VALUES (
          'legacy_archive_registry_backfill_failure', ?
        ) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
          .run(legacyArchiveRegistryBackfillFailure)
        console.error(
          `Legacy archive registry backfill stopped safely: ${legacyArchiveRegistryBackfillFailure}`,
        )
      }
    }, LEGACY_ARCHIVE_REGISTRY_BACKFILL_DELAY_MS)
  }

  /** Reconciles registered custody in bounded asynchronous pages after backfill settles. */
  const scheduleArchiveRegistryReconciliation = () => {
    if (
      storeClosed
      || archiveRegistryReconciliationShutdownRequested
      || migrationState.legacyArchiveRegistryBackfillRemaining !== 0
      || archiveRegistryReconciliationTimer !== null
      || archiveRegistryReconciliationActive !== null
      || archiveRegistryReconciliationFailure !== null
      || archiveRegistryReconciliationComplete
    ) return
    archiveRegistryReconciliationTimer = setTimeout(() => {
      archiveRegistryReconciliationTimer = null
      if (storeClosed || archiveRegistryReconciliationShutdownRequested) return
      archiveRegistryReconciliationController = new AbortController()
      archiveRegistryReconciliationCycleStartedAt ??= new Date().toISOString()
      archiveRegistryReconciliationActive = archiveRegistry.reconcileArchiveAvailability({
        cycleStartedAt: archiveRegistryReconciliationCycleStartedAt,
        signal: archiveRegistryReconciliationController.signal,
      }).then((result) => {
        if (result.remaining === 0) {
          archiveRegistryReconciliationComplete = true
          db.prepare(`DELETE FROM metadata
            WHERE key = 'archive_registry_reconciliation_failure'`).run()
        }
        return result
      }).catch((error) => {
        // prepareClose() deliberately aborts this best-effort startup sweep.
        // Cancellation is a clean shutdown outcome, not a durable registry
        // failure that should strand the next process behind a false marker.
        if (error?.name === 'AbortError' || error?.code === 'ARCHIVE_CANCELLED') {
          return
        }
        archiveRegistryReconciliationFailure = safeEvidenceFailureReason(
          error?.message ?? error,
        )
        if (!storeClosed) {
          db.prepare(`INSERT INTO metadata (key, value) VALUES (
            'archive_registry_reconciliation_failure', ?
          ) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
            .run(archiveRegistryReconciliationFailure)
          console.error(
            `Archive registry reconciliation stopped safely: ${archiveRegistryReconciliationFailure}`,
          )
        }
      }).finally(() => {
        archiveRegistryReconciliationActive = null
        archiveRegistryReconciliationController = null
        if (!archiveRegistryReconciliationShutdownRequested) {
          scheduleArchiveRegistryReconciliation()
        }
      })
    }, LEGACY_ARCHIVE_REGISTRY_BACKFILL_DELAY_MS)
  }

  /** Recovers one exact pre-registration custody operation without delaying store open. */
  const scheduleArchiveCustodyRecovery = () => {
    if (storeClosed || archiveCustodyRecoveryDidSettle
      || archiveCustodyRecoveryTimer !== null || archiveCustodyRecoveryActive !== null) return
    try {
      const activeJournal = archiveCustodyJournal.readActive()
      const hasFinalizationFence = db.prepare(`SELECT 1
        FROM mission_finalization_fences LIMIT 1`).get() !== undefined
      if (activeJournal === null
        && !archiveCustodyJournal.hasBlockingConflict()
        && !activeJournalRequestIntegrityIsInvalid(db)
        && (!hasFinalizationFence || !hasUnsettledJournalArchiveFence(db))) {
        archiveCustodyRecoveryFailure = null
        db.prepare(`DELETE FROM metadata
          WHERE key = 'archive_custody_recovery_failure'`).run()
        settleArchiveCustodyRecovery()
        return
      }
    } catch {
      // Corrupt or unreadable custody state remains on the deferred recovery
      // path so store opening stays non-blocking and archive work fails closed.
    }
    archiveCustodyRecoveryTimer = setTimeout(() => {
      archiveCustodyRecoveryTimer = null
      if (storeClosed) {
        settleArchiveCustodyRecovery()
        return
      }
      if (archiveCustodyJournal.hasBlockingConflict()
        || activeJournalRequestIntegrityIsInvalid(db)) {
        archiveCustodyRecoveryFailure = 'ARCHIVE_CUSTODY_RECOVERY_REQUIRED'
        db.prepare(`INSERT INTO metadata (key, value) VALUES (
          'archive_custody_recovery_failure', ?
        ) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
          .run(archiveCustodyRecoveryFailure)
        settleArchiveCustodyRecovery()
        return
      }
      archiveCustodyRecoveryController = new AbortController()
      archiveCustodyRecoveryActive = recoverInterruptedArchiveCustody({
        db,
        archiveDirectory,
        archiveRegistry,
        archiveCustodyJournal,
        archiveLegacyPredecessorHashRunner,
        signal: archiveCustodyRecoveryController.signal,
      }).then(() => {
        if (archiveCustodyJournal.hasBlockingConflict()
          || hasUnsettledJournalArchiveFence(db)) {
          archiveCustodyRecoveryFailure = 'ARCHIVE_CUSTODY_RECOVERY_REQUIRED'
          db.prepare(`INSERT INTO metadata (key, value) VALUES (
            'archive_custody_recovery_failure', ?
          ) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
            .run(archiveCustodyRecoveryFailure)
          return
        }
        archiveCustodyRecoveryFailure = null
        db.prepare(`DELETE FROM metadata
          WHERE key = 'archive_custody_recovery_failure'`).run()
      }).catch((error) => {
        archiveCustodyRecoveryFailure = stableArchiveFailureCode(
          error,
          'ARCHIVE_CUSTODY_RECOVERY_REQUIRED',
        )
        if (!storeClosed) {
          db.prepare(`INSERT INTO metadata (key, value) VALUES (
            'archive_custody_recovery_failure', ?
          ) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
            .run(archiveCustodyRecoveryFailure)
          console.error(
            `Archive custody recovery stopped safely (${archiveCustodyRecoveryFailure}).`,
          )
        }
      }).finally(() => {
        archiveCustodyRecoveryActive = null
        archiveCustodyRecoveryController = null
        settleArchiveCustodyRecovery()
      })
    }, LEGACY_ARCHIVE_REGISTRY_BACKFILL_DELAY_MS)
  }
  scheduleGpxReceiptRecovery()
  scheduleLegacyArchiveRegistryBackfill()
  scheduleArchiveRegistryReconciliation()
  scheduleArchiveCustodyRecovery()
  const evidenceVersionStore = createMissionEvidenceVersionStore({
    db,
    faultInjection: options.evidenceVersionFaultInjection ?? {},
    assertReady: () => assertLegacyMissionObjectBackfillSettled(db),
  })
  const outingStore = createOutingStore({
    db,
    faultInjection: options.outingFaultInjection ?? {},
    recordEvidenceVersion: (input) => {
      evidenceVersionStore.recordVersion(input)
      bumpMissionReplayGeneration(db, input.missionId)
    },
    recordCoverageInvalidation: (input) => appendCoverageInvalidation(db, {
      id: randomUUID(),
      ...input,
      failAfterWrite: coverageLedgerFaultInjection.afterWrite === true,
    }),
  })
  const participantStore = createParticipantStore({
    db,
    faultInjection: options.participantFaultInjection ?? {},
    recordCoverageChange: (missionId, updatedAt) => {
      const changeSeq = bumpCoverageChangeSequence(db, missionId, updatedAt)
      bumpMissionReplayGeneration(db, missionId)
      if (coverageLedgerFaultInjection.afterWrite === true) {
        throw new Error('Injected coverage ledger failure.')
      }
      return changeSeq
    },
  })
  const ingestEvidenceFaultInjection = options.ingestEvidenceFaultInjection ?? {}
  const ingestAnomalyOutbox = createIngestAnomalyOutbox({
    directoryPath: ingestAnomalyOutboxDirectory,
    faultInjection: ingestEvidenceFaultInjection,
    projectEnvelope: (envelope) => {
      if (ingestEvidenceFaultInjection.failProjection === true) {
        throw new Error('Injected ingest anomaly projection failure.')
      }
      recordRejectedAnomaly(db, envelope)
    },
  })
  void ingestAnomalyOutbox.initialize().catch(() => undefined)
  const backupCoordinator = createBackupCoordinator(
    db,
    databasePath,
    backupPath,
    options.backupFaultInjection ?? {},
    storageDiagnostics,
  )
  /** Owns physical worker exit so shutdown never closes SQLite under archive work. */
  const awaitArchiveWorker = async (operation) => {
    activeArchiveWorkerOperations.add(operation)
    try {
      return await operation
    } finally {
      await operation.workerExited
      activeArchiveWorkerOperations.delete(operation)
    }
  }

  /** Rejects synchronous live writes while a correction worker owns the SQLite writer lane. */
  const assertArchiveCorrectionWriterIdle = (missionId = undefined) => {
    if (archiveCorrectionAdmission !== null) {
      if (typeof missionId === 'string') {
        const mission = db.prepare('SELECT status FROM missions WHERE id = ?').get(missionId)
        if (mission?.status === 'active' || mission?.status === 'paused') return
      }
      const error = new Error(
        'Archive correction restore owns the SQLite writer lane; retry this live update after it completes.',
      )
      error.code = 'ARCHIVE_REHYDRATE_LIVE_ACTIVITY'
      throw error
    }
  }

  /** Admits one correction only when no operational mission can contend with its writer turn. */
  const acquireArchiveCorrectionAdmission = async () => {
    await archiveCorrectionAttachmentRecoveryPromise
    if (archiveCorrectionAttachmentRecoveryFailure !== null) {
      const error = new Error(
        'Archive correction attachment custody recovery requires operator review before retry.',
      )
      error.code = archiveCorrectionAttachmentRecoveryFailure
      throw error
    }
    assertArchiveCorrectionWriterIdle()
    if (getActiveMission(db) !== null) {
      const error = new Error(
        'Archive correction restore is deferred while an active or paused mission is operational.',
      )
      error.code = 'ARCHIVE_REHYDRATE_LIVE_ACTIVITY'
      throw error
    }
    const admission = {
      released: false,
      cancel: null,
      workerExited: Promise.resolve(),
    }
    archiveCorrectionAdmission = admission
    return admission
  }

  /** Releases the exact correction admission after its worker has physically exited. */
  const releaseArchiveCorrectionAdmission = (admission) => {
    admission.released = true
    if (archiveCorrectionAdmission === admission) archiveCorrectionAdmission = null
  }

  /** Cancels and joins archive correction before a new operational mission can start. */
  const preemptArchiveCorrectionForOperationalStart = async () => {
    const admission = archiveCorrectionAdmission
    if (admission === null) return
    try { admission.cancel?.() } catch {}
    await Promise.resolve(admission.workerExited).catch(() => undefined)
    if (archiveCorrectionAdmission === admission) archiveCorrectionAdmission = null
  }
  let archiveFamilyTail = Promise.resolve()
  // Unlock reconciliation has its own FIFO so an operator authorization can
  // preempt stale legacy archive validation while still serializing custody workers.
  let archiveUnlockReconciliationTail = Promise.resolve()
  const activeUnlockReconciliationsByMission = new Map()

  /** Advances one bounded legacy-registry generation so a new v1 archive can be reviewed. */
  const ensureLegacyArchiveRegistryForMission = (missionId) => {
    const latest = db.prepare(`SELECT MAX(rowid) AS rowid FROM mission_events
      WHERE mission_id = ? AND event_type IN ('mission_archive_succeeded', 'mission_archived')`)
      .get(missionId)
    const latestRowid = Number(latest?.rowid ?? 0)
    if (!Number.isSafeInteger(latestRowid) || latestRowid < 0) {
      throw new Error('Legacy archive registry boundary is invalid; correction is blocked safely.')
    }
    const targetRow = db.prepare(`SELECT value FROM metadata
      WHERE key = 'legacy_archive_registry_backfill_target'`).get()
    const targetValue = targetRow?.value
    if (targetValue !== undefined && !/^(?:0|[1-9][0-9]*)$/u.test(targetValue)) {
      throw new Error('Legacy archive registry target is invalid; correction is blocked safely.')
    }
    const target = Number(targetValue ?? 0)
    if (!Number.isSafeInteger(target) || target < 0) {
      throw new Error('Legacy archive registry target is invalid; correction is blocked safely.')
    }
    if (latestRowid > target) {
      db.prepare(`INSERT INTO metadata (key, value) VALUES (
        'legacy_archive_registry_backfill_target', ?
      ) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(String(latestRowid))
      migrationState.legacyArchiveRegistryBackfillRemaining = 1
    }
    if (migrationState.legacyArchiveRegistryBackfillRemaining === 0) return
    const result = backfillLegacyArchiveRegistry(db, { archiveDirectory })
    migrationState.legacyArchiveRegistryBackfillRemaining = result.remaining
  }

  /** Reconciles the exact current predecessor before an authorized correction unlock. */
  const reconcileFinalizedMissionArchive = (missionId) => {
    const existing = activeUnlockReconciliationsByMission.get(missionId)
    if (existing !== undefined) return existing.completion
    const controller = new AbortController()
    const lifecycle = { controller, completion: null }
    const predecessor = archiveUnlockReconciliationTail
    const run = waitForArchiveFamilyTurn(predecessor, controller.signal).then(async () => {
      await archiveCustodyRecoverySettled
      if (archiveCustodyRecoveryFailure !== null) {
        const error = new Error(
          'Archive custody recovery requires review before a correction unlock can start.',
        )
        error.code = archiveCustodyRecoveryFailure
        throw error
      }
      ensureLegacyArchiveRegistryForMission(missionId)
      const finalized = db.prepare(`SELECT details_json
        FROM mission_events
        WHERE mission_id = ? AND event_type = 'mission_finalized'
        ORDER BY rowid DESC LIMIT 1`).get(missionId)
      const finalizedDetails = readEventDetails(finalized?.details_json)
      const finalizedArchiveId = typeof finalizedDetails.archive_id === 'string'
        ? finalizedDetails.archive_id
        : null
      const current = archiveRegistry.listMissionArchives(missionId)
        .find((archive) => finalizedArchiveId === null
          ? archive.status !== 'superseded'
          : archive.id === finalizedArchiveId)
      if (current === undefined) {
        const error = new Error(
          'Mission archive predecessor is unavailable from the archive registry; correction is blocked safely.',
        )
        error.code = 'ARCHIVE_SUPPLEMENT_PREDECESSOR_INVALID'
        throw error
      }
      await archiveRegistry.reconcileArchiveAvailability({
        archiveId: current.id,
        signal: controller.signal,
      })
    })
    const completion = run.finally(() => {
      activeArchiveLifecycles.delete(lifecycle)
      if (activeUnlockReconciliationsByMission.get(missionId) === lifecycle) {
        activeUnlockReconciliationsByMission.delete(missionId)
      }
    })
    lifecycle.completion = completion
    activeArchiveLifecycles.add(lifecycle)
    activeUnlockReconciliationsByMission.set(missionId, lifecycle)
    archiveUnlockReconciliationTail = appendArchiveFamilyCompletion(predecessor, completion)
    return completion
  }

  /** Waits for the one archive-family slot while allowing queued cancellation to settle now. */
  const waitForArchiveFamilyTurn = (predecessor, signal) => {
    if (signal?.aborted === true) return Promise.reject(createArchiveCancellationError())
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        signal?.removeEventListener('abort', onAbort)
        reject(createArchiveCancellationError())
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      void predecessor.then(() => {
        signal?.removeEventListener('abort', onAbort)
        if (signal?.aborted === true) {
          reject(createArchiveCancellationError())
          return
        }
        resolve()
      }, () => {
        signal?.removeEventListener('abort', onAbort)
        reject(new Error('The prior archive operation did not settle safely.'))
      })
    })
  }

  /** Retains FIFO ownership even when a queued operation cancels before its turn. */
  const appendArchiveFamilyCompletion = (predecessor, completion) =>
    predecessor.catch(() => undefined).then(() => completion.catch(() => undefined))

  const enqueueFinalize = (missionId, custody, operationContext) => {
    const context = normalizeArchiveOperationContext(operationContext)
    if (context !== null && activeArchiveLifecyclesByOperationId.has(context.operationId)) {
      const error = new Error('Mission archive operation identity is already active.')
      error.code = 'ARCHIVE_OPERATION_ACTIVE'
      return Promise.reject(error)
    }
    const acknowledgedLossToken = readAcknowledgedEvidenceLossToken(db, missionId)
    const controller = new AbortController()
    const predecessor = archiveFamilyTail
    const run = waitForArchiveFamilyTurn(predecessor, controller.signal).then(async () => {
      await assertArchivePlaintextSweepReady()
      await archiveCustodyRecoverySettled
      if (controller.signal.aborted) {
        const error = new Error('Mission archive finalization was cancelled before it started.')
        error.name = 'AbortError'
        throw error
      }
      if (archiveCustodyRecoveryFailure !== null) {
        const error = new Error(
          'Archive custody recovery requires review before another archive can start.',
        )
        error.code = archiveCustodyRecoveryFailure
        throw error
      }
      return ingestAnomalyOutbox.runWithHealthyEvidenceFence(
        missionId,
        'finalization',
        async () => {
          const result = custody === undefined
            ? await finalizeMission(
              db,
              missionId,
              backupCoordinator,
              archiveDirectory,
              finalizeMissionFaultInjection,
              archiveFaultInjection,
              readArchiveFile,
            )
            : await finalizeMissionWithEncryptedArchive({
              db,
              databasePath,
              missionId,
              archiveDirectory,
              archiveRegistry,
              archiveCustodyJournal,
              archiveCreateRunner,
              archiveVerifyRunner,
              archiveLegacyPredecessorHashRunner,
              awaitArchiveWorker,
              recoverArchiveVerificationPlaintext,
              operationId: context?.operationId,
              signal: controller.signal,
              custody,
              onProgress: context === null
                ? undefined
                : (kind, progress) => context.onProgress({ kind, ...progress }),
              faultInjection: archiveLifecycleFaultInjection,
            })
          if (custody === undefined) ensureLegacyArchiveRegistryForMission(missionId)
          return result
        },
        acknowledgedLossToken === null ? {} : { acknowledgedLossToken },
      )
    })
    const lifecycle = { controller, completion: null }
    const completion = run.finally(() => {
      activeArchiveLifecycles.delete(lifecycle)
      if (context !== null
        && activeArchiveLifecyclesByOperationId.get(context.operationId) === lifecycle) {
        activeArchiveLifecyclesByOperationId.delete(context.operationId)
      }
    })
    lifecycle.completion = completion
    activeArchiveLifecycles.add(lifecycle)
    if (context !== null) {
      activeArchiveLifecyclesByOperationId.set(context.operationId, lifecycle)
    }
    archiveFamilyTail = appendArchiveFamilyCompletion(predecessor, completion)
    return completion
  }

  /** Runs an independent exhaustive retry against one exact registered archive. */
  const enqueueArchiveVerification = (verificationInput, operationContext) => {
    const context = normalizeArchiveOperationContext(operationContext)
    if (context !== null && activeArchiveLifecyclesByOperationId.has(context.operationId)) {
      const error = new Error('Mission archive operation identity is already active.')
      error.code = 'ARCHIVE_OPERATION_ACTIVE'
      return Promise.reject(error)
    }
    const normalizedInput = normalizeArchiveVerificationRetryInput(verificationInput)
    const controller = new AbortController()
    const progress = createArchiveLifecycleProgressEmitter(context === null
      ? undefined
      : (kind, update) => context.onProgress({ kind, ...update }))
    const lifecycle = { controller, completion: null }
    const predecessor = archiveFamilyTail
    const run = waitForArchiveFamilyTurn(predecessor, controller.signal).then(async () => {
      await assertArchivePlaintextSweepReady()
      await archiveCustodyRecoverySettled
      if (controller.signal.aborted) {
        const error = new Error('Mission archive verification was cancelled before it started.')
        error.name = 'AbortError'
        error.code = 'ARCHIVE_CANCELLED'
        throw error
      }
      if (archiveCustodyRecoveryFailure !== null) {
        const error = new Error(
          'Archive custody recovery requires review before verification can start.',
        )
        error.code = archiveCustodyRecoveryFailure
        throw error
      }
      const archiveBeforeVerify = archiveRegistry.getArchive(normalizedInput.archiveId)
      assertArchiveVerificationEpochCurrent(db, archiveBeforeVerify)
      const ticket = archiveRegistry.issueVerificationTicket(normalizedInput.archiveId)
      try {
        const proof = await awaitArchiveWorker(archiveVerifyRunner({
          request: {
            ...ticket,
            operationId: context?.operationId ?? randomUUID(),
            archiveDirectory,
            databasePath,
            passphrase: normalizedInput.passphrase,
            recoveryCode: normalizedInput.recoveryCode,
          },
          signal: controller.signal,
          ...(context === null
            ? {}
            : { onProgress: (update) => progress.forward('verify', update) }),
        }))
        const verified = commitArchiveVerificationIfEpochCurrent({
          db,
          archiveRegistry,
          archiveId: normalizedInput.archiveId,
          verificationProof: proof,
        })
        progress.emit('verify', 'verified', 'phases', 1, 1, 'verification-committed')
        return projectArchiveCustodyRow(verified, archiveDirectory, db)
      } catch (error) {
        await recoverArchiveVerificationPlaintext(error)
        const current = archiveRegistry.getArchive(normalizedInput.archiveId)
        appendEvent(db, current.mission_id, 'mission_archive_verification_failed_v2', {
          archive_id: current.id,
          resulting_status: getMission(db, current.mission_id).status,
          error_code: stableArchiveFailureCode(error, 'ARCHIVE_VERIFY_FAILED'),
        })
        throw error
      }
    })
    const completion = run.finally(() => {
      activeArchiveLifecycles.delete(lifecycle)
      if (context !== null
        && activeArchiveLifecyclesByOperationId.get(context.operationId) === lifecycle) {
        activeArchiveLifecyclesByOperationId.delete(context.operationId)
      }
    })
    lifecycle.completion = completion
    activeArchiveLifecycles.add(lifecycle)
    if (context !== null) {
      activeArchiveLifecyclesByOperationId.set(context.operationId, lifecycle)
    }
    archiveFamilyTail = appendArchiveFamilyCompletion(predecessor, completion)
    return completion
  }

  /** Builds one internal cleanup claim from a freshly validated registry review ticket. */
  const buildArchiveCleanupEvidence = async ({
    ticket,
    reviewActivity,
    custodyReconciled,
    nonMachineUnwrap,
  }) => Object.freeze({
    archiveId: ticket.archiveId,
    missionId: ticket.missionId,
    ciphertextSha256: ticket.ciphertextSha256,
    sizeBytes: ticket.sizeBytes,
    verificationProofValidated: true,
    custodyReconciled,
    archiveCustodyIdle: archiveCustodyRecoveryFailure === null
      && !archiveCustodyJournal.hasBlockingConflict()
      && archiveCustodyJournal.readActive() === null,
    evidenceHealth: await getIngestEvidenceHealth(
      db,
      ingestAnomalyOutbox,
      ticket.missionId,
    ),
    reviewActivity,
    nonMachineUnwrap,
  })

  /** Returns a closed fail-safe eligibility result when exact custody cannot be proven. */
  const buildUnavailableArchiveCleanupEligibility = async ({
    archiveId,
    missionId,
    reviewActivity,
  }) => archiveCleanupCoordinator.getEligibility({
    archiveId,
    missionId,
    ciphertextSha256: '0'.repeat(64),
    sizeBytes: 1,
    verificationProofValidated: false,
    custodyReconciled: false,
    archiveCustodyIdle: archiveCustodyRecoveryFailure === null
      && !archiveCustodyJournal.hasBlockingConflict()
      && archiveCustodyJournal.readActive() === null,
    evidenceHealth: await getIngestEvidenceHealth(db, ingestAnomalyOutbox, missionId),
    reviewActivity,
    nonMachineUnwrap: null,
  })

  /** Reconciles one exact archive in the shared archive lane before reporting cleanup checks. */
  const enqueueMissionCleanupEligibility = (input, eligibilityContext) => {
    const normalizedInput = normalizeMissionCleanupResumeInput(input)
    const normalizedContext = normalizeArchiveCleanupEligibilityContext(eligibilityContext)
    const controller = new AbortController()
    const lifecycle = { controller, completion: null }
    const predecessor = archiveFamilyTail
    const run = waitForArchiveFamilyTurn(predecessor, controller.signal).then(async () => {
      await assertArchivePlaintextSweepReady()
      await archiveCustodyRecoverySettled
      const archive = archiveRegistry.getArchive(normalizedInput.archiveId)
      if (archive.mission_id !== normalizedInput.missionId) {
        throw new Error('Mission cleanup archive does not belong to the selected mission.')
      }
      if (archiveCustodyRecoveryFailure !== null) {
        return buildUnavailableArchiveCleanupEligibility({
          ...normalizedInput,
          reviewActivity: normalizedContext.reviewActivity,
        })
      }
      try {
        await archiveRegistry.reconcileArchiveAvailability({
          archiveId: normalizedInput.archiveId,
          signal: controller.signal,
        })
        const ticket = archiveRegistry.issueReviewTicket(normalizedInput.archiveId)
        const evidence = await buildArchiveCleanupEvidence({
          ticket,
          reviewActivity: normalizedContext.reviewActivity,
          custodyReconciled: true,
          nonMachineUnwrap: null,
        })
        return archiveCleanupCoordinator.getEligibility(evidence)
      } catch (error) {
        if (controller.signal.aborted) throw createArchiveCancellationError()
        return buildUnavailableArchiveCleanupEligibility({
          ...normalizedInput,
          reviewActivity: normalizedContext.reviewActivity,
        })
      }
    })
    const completion = run.finally(() => {
      activeArchiveLifecycles.delete(lifecycle)
    })
    lifecycle.completion = completion
    activeArchiveLifecycles.add(lifecycle)
    archiveFamilyTail = appendArchiveFamilyCompletion(predecessor, completion)
    return completion
  }

  /** Runs one cleanup start/resume in the archive family and owns cancellation to exit. */
  const enqueueMissionCleanup = ({ mode, input, operationContext }) => {
    const normalizedInput = mode === 'start'
      ? normalizeMissionCleanupStartInput(input)
      : normalizeMissionCleanupResumeInput(input)
    let cleanupSecret = mode === 'start' ? input.secret : null
    let cleanupReviewBarrierAcquired = false
    const context = normalizeArchiveCleanupOperationContext(operationContext)
    if (activeArchiveLifecyclesByOperationId.has(context.operationId)) {
      const error = new Error('Mission archive operation identity is already active.')
      error.code = 'ARCHIVE_OPERATION_ACTIVE'
      return Promise.reject(error)
    }
    const controller = new AbortController()
    const lifecycle = { controller, completion: null }
    const predecessor = archiveFamilyTail
    const run = waitForArchiveFamilyTurn(predecessor, controller.signal).then(async () => {
      await assertArchivePlaintextSweepReady()
      await archiveCustodyRecoverySettled
      if (archiveCustodyRecoveryFailure !== null) {
        const error = new Error(
          'Archive custody recovery requires review before mission cleanup can start.',
        )
        error.code = archiveCustodyRecoveryFailure
        throw error
      }
      if (controller.signal.aborted) throw createArchiveCancellationError()
      if (mode === 'resume') {
        await archiveRegistry.reconcileArchiveAvailability({
          archiveId: normalizedInput.archiveId,
          signal: controller.signal,
        })
      }
      const ticket = archiveRegistry.issueReviewTicket(normalizedInput.archiveId)
      if (ticket.containerVersion !== 2 || ticket.missionId !== normalizedInput.missionId) {
        const error = new Error('Mission cleanup archive identity is unavailable.')
        error.code = 'ARCHIVE_CLEANUP_IDENTITY_MISMATCH'
        throw error
      }
      let nonMachineUnwrap = null
      let cleanupFileIdentity = ticket.custodyFileIdentity
      if (mode === 'start') {
        const credentialRequest = createArchiveCleanupCredentialRequest({
          ticket,
          archiveDirectory,
          operationId: context.operationId,
          slotType: normalizedInput.slotType,
        })
        let credentialOperation
        try {
          credentialOperation = archiveCleanupCredentialRunner({
            request: credentialRequest,
            secret: cleanupSecret,
            signal: controller.signal,
          })
        } finally {
          cleanupSecret = null
        }
        const credentialResult = await awaitArchiveWorker(credentialOperation)
        const currentTicket = archiveRegistry.issueReviewTicket(normalizedInput.archiveId)
        assertArchiveCleanupTicketUnchanged(ticket, currentTicket)
        assertArchiveCleanupFileIdentityUnchanged(
          ticket.custodyFileIdentity,
          credentialResult.fileIdentity,
        )
        cleanupFileIdentity = credentialResult.fileIdentity
        nonMachineUnwrap = Object.freeze({
          archiveId: credentialResult.archiveId,
          missionId: credentialResult.missionId,
          slotType: credentialResult.slotType,
          authenticatedAt: now(),
          ciphertextSha256: credentialResult.ciphertextSha256,
          sizeBytes: credentialResult.sizeBytes,
        })
      }
      const withCustodyCommit = (commit) => withPinnedCustodyFileIdentity({
        archiveDirectory,
        archiveRelativePath: ticket.archiveRelativePath,
        expectedFileIdentity: cleanupFileIdentity,
      }, commit)
      const evidence = await buildArchiveCleanupEvidence({
        ticket,
        reviewActivity: context.reviewActivity,
        custodyReconciled: true,
        nonMachineUnwrap,
      })
      await acquireCleanupReviewBarrier(normalizedInput.missionId, context.operationId)
      cleanupReviewBarrierAcquired = true
      const execute = () => mode === 'start'
        ? archiveCleanupCoordinator.start(evidence, {
            signal: controller.signal,
            withCustodyCommit,
            onProgress: (progress) => deliverArchiveProgressBestEffort(
              context.onProgress,
              { kind: 'cleanup', ...progress },
            ),
            ...(options.archiveCleanupFaultInjection === undefined
              ? {}
              : { faultInjection: options.archiveCleanupFaultInjection }),
          })
        : archiveCleanupCoordinator.resume(evidence, {
            signal: controller.signal,
            withCustodyCommit,
            onProgress: (progress) => deliverArchiveProgressBestEffort(
              context.onProgress,
              { kind: 'cleanup', ...progress },
            ),
            ...(options.archiveCleanupFaultInjection === undefined
              ? {}
              : { faultInjection: options.archiveCleanupFaultInjection }),
          })
      return ingestAnomalyOutbox.runWithHealthyEvidenceFence(
        normalizedInput.missionId,
        'mission cleanup',
        execute,
      )
    })
    const completion = run.finally(() => {
      cleanupSecret = null
      if (cleanupReviewBarrierAcquired) {
        releaseCleanupReviewBarrier(normalizedInput.missionId, context.operationId)
      }
      activeArchiveLifecycles.delete(lifecycle)
      if (activeArchiveLifecyclesByOperationId.get(context.operationId) === lifecycle) {
        activeArchiveLifecyclesByOperationId.delete(context.operationId)
      }
    })
    lifecycle.completion = completion
    activeArchiveLifecycles.add(lifecycle)
    activeArchiveLifecyclesByOperationId.set(context.operationId, lifecycle)
    archiveFamilyTail = appendArchiveFamilyCompletion(predecessor, completion)
    return completion
  }

  const enqueueArchive = (missionId) => {
    const predecessor = archiveFamilyTail
    const run = predecessor.then(async () => {
      await assertArchivePlaintextSweepReady()
      await archiveCustodyRecoverySettled
      if (archiveCustodyRecoveryFailure !== null) {
        const error = new Error(
          'Archive custody recovery requires review before another archive can start.',
        )
        error.code = archiveCustodyRecoveryFailure
        throw error
      }
      const acknowledgedLossToken = readAcknowledgedEvidenceLossToken(db, missionId)
      return ingestAnomalyOutbox.runWithHealthyEvidenceFence(
        missionId,
        'archive',
        () => createMissionArchive(
          db,
          missionId,
          backupCoordinator,
          archiveDirectory,
          true,
          archiveFaultInjection,
        ),
        acknowledgedLossToken === null ? {} : { acknowledgedLossToken },
      )
    })
    archiveFamilyTail = appendArchiveFamilyCompletion(predecessor, run)
    return run
  }

  /**
   * Reconciles only sealed v2 rows whose newly published bytes have not yet
   * received an availability observation, then returns the fresh projection.
   * Reconciliation stays worker-backed and FIFO with archive lifecycle work;
   * an inspection failure leaves the row explicitly unavailable for a later
   * Refresh instead of hiding the retained mission timeline.
   */
  const listMissionArchivesWithRetryAvailability = async (missionId) => {
    const initial = archiveRegistry.listMissionArchives(missionId)
    const pendingArchiveIds = initial
      .filter((archive) => archive.container_version === 2
        && archive.status === 'sealed'
        && archive.verified_at === null
        && archive.availability === 'unknown')
      .map((archive) => archive.id)
    if (pendingArchiveIds.length === 0) {
      return initial.map((row) => projectArchiveCustodyRow(row, archiveDirectory, db))
    }

    const controller = new AbortController()
    const lifecycle = { controller, completion: null }
    const predecessor = archiveFamilyTail
    const run = waitForArchiveFamilyTurn(predecessor, controller.signal).then(async () => {
      await archiveCustodyRecoverySettled
      if (archiveCustodyRecoveryFailure !== null) return
      for (const archiveId of pendingArchiveIds) {
        try {
          await archiveRegistry.reconcileArchiveAvailability({
            archiveId,
            signal: controller.signal,
          })
        } catch (error) {
          if (controller.signal.aborted || error?.code === 'ARCHIVE_CANCELLED') throw error
          // Keep this archive visibly unavailable; a later Refresh retries the
          // exact worker-backed observation without suppressing other rows.
        }
      }
    })
    const completion = run.finally(() => {
      activeArchiveLifecycles.delete(lifecycle)
    })
    lifecycle.completion = completion
    activeArchiveLifecycles.add(lifecycle)
    archiveFamilyTail = appendArchiveFamilyCompletion(predecessor, completion)
    await completion
    return archiveRegistry.listMissionArchives(missionId)
      .map((row) => projectArchiveCustodyRow(row, archiveDirectory, db))
  }

  return {
    prepareClose: async () => {
      archiveCorrectionAttachmentRecoveryShutdownRequested = true
      archiveRegistryReconciliationShutdownRequested = true
      if (archiveRegistryReconciliationTimer !== null) {
        clearTimeout(archiveRegistryReconciliationTimer)
        archiveRegistryReconciliationTimer = null
      }
      const active = [...activeGpxEvidenceImports]
      for (const entry of active) entry.controller.abort()
      for (const activeQuery of missionReviewQueryControllersByRequestId.values()) {
        activeQuery.controller.abort()
      }
      for (const activeQuery of missionReplayQueryControllersByRequestId.values()) {
        activeQuery.controller.abort()
      }
      const shutdownTasks = active.map((entry) => entry.quiesced)
      shutdownTasks.push(ingestAnomalyOutbox.dispose())
      shutdownTasks.push(archiveCorrectionAttachmentRecoveryPromise.catch(() => undefined))
      shutdownTasks.push(...activeSearchOperationPageReads)
      for (const reads of activeLiveReviewReadsByMission.values()) {
        shutdownTasks.push(...reads)
      }
      shutdownTasks.push(...attachmentLifecycleTails.values())
      if (!archivePlaintextSweepFinished && archivePlaintextSweepOperation !== null) {
        archivePlaintextSweepOperation.cancel?.()
        shutdownTasks.push(archivePlaintextSweepSettled)
        shutdownTasks.push(archivePlaintextSweepOperation.workerExited)
      }
      for (const lifecycle of activeArchiveLifecycles) {
        lifecycle.controller.abort()
        shutdownTasks.push(lifecycle.completion)
      }
      for (const operation of activeArchiveWorkerOperations) {
        operation.cancel?.()
        shutdownTasks.push(operation.workerExited)
      }
      if (archiveCustodyRecoveryTimer !== null) {
        clearTimeout(archiveCustodyRecoveryTimer)
        archiveCustodyRecoveryTimer = null
        settleArchiveCustodyRecovery()
      }
      if (archiveCustodyRecoveryActive !== null) {
        archiveCustodyRecoveryController?.abort()
        shutdownTasks.push(archiveCustodyRecoveryActive)
      }
      if (archiveRegistryReconciliationActive !== null) {
        archiveRegistryReconciliationController?.abort()
        shutdownTasks.push(archiveRegistryReconciliationActive)
      }
      if (!legacyEvidenceBackfillWorkerStopped && legacyEvidenceBackfillWorker !== null) {
        shutdownTasks.push(legacyEvidenceBackfillWorker.terminate().then(() => {
          legacyEvidenceBackfillWorkerStopped = true
        }))
      }
      if (shutdownTasks.length === 0) return
      let timeout
      try {
        const results = await Promise.race([
          Promise.allSettled(shutdownTasks),
          new Promise((_, reject) => {
            timeout = setTimeout(() => reject(new Error(
              'A mission evidence worker did not exit within the safe shutdown deadline. The mission store remains open and the exit is not marked clean.',
            )), gpxShutdownJoinTimeoutMs)
          }),
        ])
        const unexpected = results.find((result) => result.status === 'rejected'
          && result.reason?.name !== 'AbortError'
          && result.reason?.code !== 'ARCHIVE_CANCELLED'
          && result.reason?.code !== 'ARCHIVE_CLEANUP_CANCELLED')
        if (unexpected !== undefined) throw unexpected.reason
      } finally {
        clearTimeout(timeout)
      }
    },
    close: () => {
      if (activeGpxEvidenceImports.size > 0) {
        throw new Error('Cannot close the mission store while GPX evidence imports are active; call prepareClose first.')
      }
      if (activeSearchOperationPageReads.size > 0) {
        throw new Error('Cannot close the mission store while Search Operations page reads are active; call prepareClose first.')
      }
      if (activeLiveReviewReadsByMission.size > 0) {
        throw new Error('Cannot close the mission store while live Mission Review workers are active; call prepareClose first.')
      }
      if (attachmentLifecycleTails.size > 0) {
        throw new Error('Cannot close the mission store while marker attachment custody is active; call prepareClose first.')
      }
      if (!archivePlaintextSweepFinished) {
        throw new Error('Cannot close the mission store while archive plaintext cleanup is active; call prepareClose first.')
      }
      if (!legacyEvidenceBackfillWorkerStopped) {
        throw new Error('Cannot close the mission store while legacy evidence reconstruction is active; call prepareClose first.')
      }
      if (activeArchiveLifecycles.size > 0 || activeArchiveWorkerOperations.size > 0) {
        throw new Error('Cannot close the mission store while archive custody work is active; call prepareClose first.')
      }
      if (archiveCustodyRecoveryActive !== null) {
        throw new Error('Cannot close the mission store while archive custody recovery is active; call prepareClose first.')
      }
      storeClosed = true
      archiveRegistryReconciliationController?.abort()
      if (gpxReceiptRecoveryTimer !== null) {
        clearTimeout(gpxReceiptRecoveryTimer)
        gpxReceiptRecoveryTimer = null
      }
      if (legacyArchiveRegistryBackfillTimer !== null) {
        clearTimeout(legacyArchiveRegistryBackfillTimer)
        legacyArchiveRegistryBackfillTimer = null
      }
      if (archiveRegistryReconciliationTimer !== null) {
        clearTimeout(archiveRegistryReconciliationTimer)
        archiveRegistryReconciliationTimer = null
      }
      if (archiveCustodyRecoveryTimer !== null) {
        clearTimeout(archiveCustodyRecoveryTimer)
        archiveCustodyRecoveryTimer = null
        settleArchiveCustodyRecovery()
      }
      void ingestAnomalyOutbox.dispose()
      for (const controller of activeBreadcrumbQueryControllers) {
        controller.abort()
      }
      activeBreadcrumbQueryControllers.clear()
      breadcrumbQueryControllersByRequestId.clear()
      breadcrumbDotQueryControllersByRequestId.clear()
      for (const activeQuery of missionReviewQueryControllersByRequestId.values()) {
        activeQuery.controller.abort()
      }
      missionReviewQueryControllersByRequestId.clear()
      for (const activeQuery of missionReplayQueryControllersByRequestId.values()) {
        activeQuery.controller.abort()
      }
      missionReplayQueryControllersByRequestId.clear()
      for (const activeQuery of outingFixSummaryControllersByRequestId.values()) {
        activeQuery.controller.abort()
      }
      outingFixSummaryControllersByRequestId.clear()
      for (const activeQuery of coverageQueryControllersByRequestId.values()) {
        activeQuery.controller.abort()
      }
      coverageQueryControllersByRequestId.clear()
      for (const activeQuery of coverageTileControllersByRequestId.values()) {
        activeQuery.controller.abort()
      }
      coverageTileControllersByRequestId.clear()
      void coverageTileRunner.close().catch(() => undefined)
      db.close()
    },
    info: async () => ({
      schema_version: schemaVersion(db),
      synchronous_mode: db.pragma('synchronous', { simple: true }),
      database_path: databasePath,
      backup_path: backupPath,
    }),
    syncBackup: async (trigger) => backupCoordinator.syncBackup(trigger),
    createMissionArchive: async (missionId) => enqueueArchive(missionId),
    listMissionArchives: listMissionArchivesWithRetryAvailability,
    issueMissionArchiveReviewTicket: (archiveId) => archiveRegistry.issueReviewTicket(archiveId),
    getMissionCleanupEligibility: (input, context) =>
      enqueueMissionCleanupEligibility(input, context),
    startMissionCleanup: (input, operationContext) => enqueueMissionCleanup({
      mode: 'start',
      input,
      operationContext,
    }),
    listInterruptedMissionCleanups: async () => db.prepare(`SELECT mission_id, archive_id
      FROM mission_cleanup_journal WHERE state = 'in_progress'
      ORDER BY updated_at ASC, mission_id ASC`).all().map((row) => Object.freeze({
      missionId: row.mission_id,
      archiveId: row.archive_id,
    })),
    resumeMissionCleanup: (input, operationContext) => enqueueMissionCleanup({
      mode: 'resume',
      input,
      operationContext,
    }),
    recordMissionArchiveReviewOpened: (input) => archiveRegistry.recordReviewOpened(input),
    recordMissionArchiveReviewClosed: (input) => archiveRegistry.recordReviewClosed(input),
    recordMissionArchiveReviewMutationDenied: (input) =>
      archiveRegistry.recordReviewMutationDenied(input),
    verifyMissionArchive: async (input, operationContext) =>
      enqueueArchiveVerification(input, operationContext),
    cancelMissionArchiveOperation: async (operationId) => {
      const normalizedOperationId = normalizeArchiveOperationId(operationId)
      const lifecycle = activeArchiveLifecyclesByOperationId.get(normalizedOperationId)
      if (lifecycle === undefined) return false
      lifecycle.controller.abort()
      return true
    },
    createMission: async (input) => {
      await preemptArchiveCorrectionForOperationalStart()
      const mission = createMission(db, input)
      await safeStorageDiagnostic(() =>
        storageDiagnostics?.startMission({ startedAt: mission.start_time }),
      )
      return mission
    },
    createOuting: async (input) => runCoverageMutation(
      input.mission_id,
      () => outingStore.createOuting(input),
    ),
    endOuting: async (input) => runCoverageMutation(
      input.mission_id,
      () => outingStore.endOuting(input),
    ),
    renameOuting: async (input) => outingStore.renameOuting(input),
    editOutingBoundaries: async (input) => runCoverageMutation(
      input.mission_id,
      () => outingStore.editOutingBoundaries(input),
    ),
    listOutings: async (missionId) => readLiveMissionReviewFacet(
      missionId,
      () => outingStore.listOutings(missionId),
    ),
    selectMissionParticipants: async (input) => runCoverageMutation(
      input.mission_id,
      () => participantStore.selectMissionParticipants(input),
    ),
    addMissionParticipant: async (input) => runCoverageMutation(
      input.mission_id,
      () => participantStore.addMissionParticipant(input),
    ),
    removeMissionParticipant: async (input) => runCoverageMutation(
      input.mission_id,
      () => participantStore.removeMissionParticipant(input),
    ),
    listMissionParticipants: async (missionId) =>
      participantStore.listMissionParticipants(missionId),
    recordGroupMembershipEvents: async (input) => runCoverageMutation(
      input.mission_id,
      () => participantStore.recordGroupMembershipEvents(input),
    ),
    listGroupMembershipEvents: async (missionId, teamId) =>
      participantStore.listGroupMembershipEvents(missionId, teamId),
    upsertParticipantBackfillCheckpoint: async (input) => runCoverageMutation(
      input.mission_id,
      () => participantStore.upsertParticipantBackfillCheckpoint(input),
    ),
    listParticipantBackfillCheckpoints: async (missionId) =>
      participantStore.listParticipantBackfillCheckpoints(missionId),
    readOutingFixSummary: async (input, requestId) => {
      const normalizedRequestId = normalizeOutingFixSummaryRequestId(requestId, false)
      if (
        normalizedRequestId !== null &&
        outingFixSummaryControllersByRequestId.has(normalizedRequestId)
      ) {
        throw new Error('Outing fix-summary request ID is already active.')
      }
      const controller = new AbortController()
      const query = enqueueOutingFixSummary({ query: input, signal: controller.signal })
      const activeQuery = { controller, completion: query }
      if (normalizedRequestId !== null) {
        outingFixSummaryControllersByRequestId.set(normalizedRequestId, activeQuery)
      }
      try {
        const result = await query
        return {
          outings: result.outings,
          unassigned_accepted_fix_count: result.unassigned_accepted_fix_count,
          total_accepted_fix_count: result.total_accepted_fix_count,
        }
      } finally {
        if (
          normalizedRequestId !== null &&
          outingFixSummaryControllersByRequestId.get(normalizedRequestId) === activeQuery
        ) {
          outingFixSummaryControllersByRequestId.delete(normalizedRequestId)
        }
      }
    },
    cancelOutingFixSummary: async (requestId) => {
      const normalizedRequestId = normalizeOutingFixSummaryRequestId(requestId, true)
      const activeQuery = outingFixSummaryControllersByRequestId.get(normalizedRequestId)
      if (activeQuery === undefined) return false
      activeQuery.controller.abort()
      await activeQuery.completion.catch(() => undefined)
      return true
    },
    readCoverageManifest: async (missionId, requestId) => executeCoverageRequest(
      requestId,
      async (signal) => {
        getMission(db, missionId)
        const coverageMission = db.prepare(`SELECT change_seq, enumerated
          FROM coverage_missions WHERE mission_id = ?`).get(missionId)
        if (coverageMission?.enumerated !== 1) {
          const enumerationStartedAt = performance.now()
          const enumeration = await runCoverageWorker(
            { kind: 'enumerate', missionId },
            signal,
            false,
          )
          assertCoverageResultInventory(
            db,
            missionId,
            enumeration.chunks,
            (chunk) => chunk,
            'enumeration',
          )
          recordCoveragePerformance(missionId, {
            lastEnumerationDurationMs: performance.now() - enumerationStartedAt,
          })
          applyCoverageEnumeration(db, {
            missionId,
            expectedChangeSeq: enumeration.changeSeq,
            chunks: enumeration.chunks,
            updatedAt: now(),
          })
        }
        await drainCoverageInvalidations(missionId, signal)
        const manifest = await runCoverageWorker(
          { kind: 'manifest', missionId }, signal, false,
        )
        assertCoverageResultInventory(
          db,
          missionId,
          manifest.chunks,
          (chunk) => chunk.key,
          'manifest',
        )
        assertCoverageManifestOutings(db, missionId, manifest.outings)
        const inserted = applyCoverageManifestInventory(db, {
          missionId,
          expectedChangeSeq: manifest.changeSeq,
          chunks: manifest.chunks,
          updatedAt: now(),
        })
        const currentManifest = inserted === 0
          ? manifest
          : await runCoverageWorker({ kind: 'manifest', missionId }, signal, false)
        assertCoverageResultInventory(
          db,
          missionId,
          currentManifest.chunks,
          (chunk) => chunk.key,
          'manifest',
        )
        assertCoverageManifestOutings(db, missionId, currentManifest.outings)
        coverageManifestBuildEvidenceByMission.set(
          missionId,
          createCoverageManifestBuildEvidence(currentManifest),
        )
        return attachCoveragePerformance(missionId, currentManifest)
      },
    ),
    readCoverageChunk: async (input, requestId) => {
      const normalizedInput = normalizeCoverageChunkReadInput(input)
      return executeCoverageRequest(
        requestId,
        async (signal) => {
          const page = await runCoverageWorker(
            { ...normalizedInput, kind: 'chunk-page' }, signal, true,
          )
          if (page.nextCursor !== null) return page
          const summary = await runCoverageWorker({
            kind: 'chunk-summary',
            missionId: normalizedInput.missionId,
            key: normalizedInput.key,
            expectedContentRev: normalizedInput.expectedContentRev,
          }, signal, true)
          const applied = applyCoverageChunkBuild(db, {
            missionId: normalizedInput.missionId,
            deviceId: normalizedInput.key.device_id,
            periodKind: normalizedInput.key.period_kind,
            periodId: normalizedInput.key.period_id,
            expectedContentRev: normalizedInput.expectedContentRev,
            fixCount: summary.fix_count,
            fixDigest: summary.fix_digest,
            minTs: summary.min_ts,
            maxTs: summary.max_ts,
            updatedAt: now(),
          })
          if (!applied) {
            const error = new Error('chunk-stale: coverage chunk revision changed')
            error.code = 'chunk-stale'
            throw error
          }
          return page
        },
      )
    },
    readCoverageClaim: async (input, requestId) => executeCoverageRequest(
      requestId,
      async (signal) => {
        const normalizedInput = normalizeCoverageClaimInput(db, input)
        const claim = await runCoverageWorker(
          {
            kind: 'claim',
            ...normalizedInput,
          },
          signal,
          false,
        )
        const health = await getIngestEvidenceHealth(
          db,
          ingestAnomalyOutbox,
          normalizedInput.missionId,
        )
        // Keep the direct bounded attestation as the final yielding boundary so
        // an accepted write cannot land between proof and the returned claim.
        const attestedClaim = assertCoverageClaimMatchesDatabase(
          db,
          normalizedInput,
          claim,
        )
        const blockers = [...attestedClaim.blockers]
        if (Number(health.pendingCount ?? 0) > 0) blockers.push('ingest_outbox_pending')
        if (health.state !== 'healthy') blockers.push('ingest_health_degraded')
        return {
          changeSeq: attestedClaim.changeSeq,
          databaseReady: blockers.length === 0,
          blockers: [...new Set(blockers)],
          chunkRevisions: attestedClaim.chunkRevisions,
        }
      },
    ),
    cancelCoverageQuery: async (requestId) => {
      const normalizedRequestId = normalizeCoverageQueryRequestId(requestId, true)
      const activeQuery = coverageQueryControllersByRequestId.get(normalizedRequestId)
      if (activeQuery === undefined) return false
      activeQuery.controller.abort()
      await activeQuery.completion.catch(() => undefined)
      return true
    },
    syncCoverageTileCatalog: async (input, requestId) => executeCoverageRequest(
      requestId,
      async (signal) => {
        const normalizedInput = normalizeAuthorizedCoverageCatalogInput(db, input)
        const exactBuildSummaries = readCoverageManifestBuildEvidence(
          coverageManifestBuildEvidenceByMission,
          normalizedInput,
        )
        const buildStartedAt = performance.now()
        const rawResult = await coverageTileRunner.syncCatalog(normalizedInput, { signal })
        let result
        try {
          result = normalizeCoverageCatalogWorkerResult(normalizedInput, rawResult)
        } catch (error) {
          const stageId = readDiscardableCoverageStageId(rawResult)
          if (stageId !== null) {
            await coverageTileRunner.discardCatalog({ stageId }).catch(() => undefined)
          }
          throw error
        }
        if (signal.aborted) {
          await coverageTileRunner.discardCatalog({ stageId: result.stageId })
          throw createCoverageRequestAbortError()
        }
        try {
          assertCoverageBuildCoverage(
            new Set(normalizedInput.chunks.map((chunk) =>
              createCoverageChunkIdentity(chunk.key))),
            result.builds,
          )
          assertCoverageBuildSummaries(result.builds, exactBuildSummaries)
        } catch (error) {
          await coverageTileRunner.discardCatalog({ stageId: result.stageId })
            .catch(() => undefined)
          if (error?.code === 'coverage-build-attestation') {
            await coverageTileRunner.invalidateWorker?.(error)
          }
          throw error
        }
        if (signal.aborted) {
          await coverageTileRunner.discardCatalog({ stageId: result.stageId })
          throw createCoverageRequestAbortError()
        }
        if (result.builds.length > 0) {
          recordCoveragePerformance(normalizedInput.missionId, {
            lastBuildDurationMs: performance.now() - buildStartedAt,
          })
        }
        let appliedBuilds
        try {
          appliedBuilds = applyCoverageChunkBuilds(db, {
            missionId: normalizedInput.missionId,
            builds: result.builds,
            updatedAt: now(),
          })
        } catch (error) {
          await coverageTileRunner.discardCatalog({ stageId: result.stageId })
          throw error
        }
        const rejectedChunks = new Set(appliedBuilds.rejectedChunkKeys)
        if (rejectedChunks.size > 0) {
          await coverageTileRunner.discardCatalog({ stageId: result.stageId })
          const error = new Error('chunk-stale: coverage tile catalog changed during apply')
          error.code = 'chunk-stale'
          throw error
        }
        return {
          activationId: result.stageId,
          missionId: normalizedInput.missionId,
          periods: result.periods,
          delivered: result.delivered,
        }
      },
    ),
    activateCoverageTileCatalog: async (input) => coverageTileRunner.commitCatalog({
      stageId: normalizeCoverageTileActivationId(input?.activationId),
    }),
    finalizeCoverageTileCatalog: async (input) => coverageTileRunner.finalizeCatalog({
      stageId: normalizeCoverageTileActivationId(input?.activationId),
    }),
    discardCoverageTileCatalog: async (input) => coverageTileRunner.discardCatalog({
      stageId: normalizeCoverageTileActivationId(input?.activationId),
    }),
    readCoverageTile: async (input, requestId) => {
      const normalizedInput = normalizeCoverageTileReadInput(input)
      return executeCoverageTileRead(
        requestId,
        (signal) => coverageTileRunner.readTile(normalizedInput, { signal }),
      )
    },
    cancelCoverageTileRead: async (requestId) => {
      const normalizedRequestId = normalizeCoverageQueryRequestId(requestId, true)
      const activeQuery = coverageTileControllersByRequestId.get(normalizedRequestId)
      if (activeQuery === undefined) return false
      activeQuery.controller.abort()
      await activeQuery.completion.catch(() => undefined)
      return true
    },
    upsertDevice: async (input) => {
      assertArchiveCorrectionWriterIdle(input.mission_id)
      return upsertDevice(db, input)
    },
    upsertDevicesBulk: async (input) => {
      assertArchiveCorrectionWriterIdle(input.mission_id)
      const startedAtMs = performance.now()
      const result = upsertDevicesBulk(db, input)
      await safeStorageDiagnostic(() =>
        storageDiagnostics?.recordTrackingBatch({
          durationMs: performance.now() - startedAtMs,
          deviceCount: result.devices.length,
          changedDeviceEventCount: result.changedDeviceEventCount,
          observedAt: new Date().toISOString(),
        }),
      )
      return result.devices
    },
    getDevice: async (missionId, deviceId) => getDevice(db, missionId, deviceId),
    listDevices: async (missionId) => readLiveMissionReviewFacet(
      missionId,
      () => all(db, 'SELECT * FROM devices WHERE mission_id = ? ORDER BY name ASC', missionId),
    ),
    addPosition: async (input) => runCoverageMutation(
      input.mission_id,
      () => addPosition(db, input, coverageLedgerFaultInjection),
    ),
    addPositionsBulk: async (input) => {
      const startedAtMs = performance.now()
      const result = await runCoverageMutation(
        input.mission_id,
        () => addPositionsBulk(db, input, true, coverageLedgerFaultInjection),
      )
      await safeStorageDiagnostic(() =>
        storageDiagnostics?.recordInsertedPositions({
          durationMs: performance.now() - startedAtMs,
          insertedPositionCount: result.insertedPositionCount,
          positionTelemetryEventCount: 0,
          skippedAmbiguousLegacyAdoptionCount:
            result.skippedAmbiguousLegacyAdoptionCount,
        }),
      )
      return result.positions
    },
    persistTrackingPositionsBulk: async (input) => {
      const startedAtMs = performance.now()
      const hasCheckpoints = Array.isArray(input.checkpoints) && input.checkpoints.length > 0
      const result = await runCoverageMutation(
        input.mission_id,
        () => hasCheckpoints
          ? persistTrackingHistoryBatch(db, input, false, coverageLedgerFaultInjection)
          : addPositionsBulk(db, input, false, coverageLedgerFaultInjection, true),
      )
      await safeStorageDiagnostic(() =>
        storageDiagnostics?.recordInsertedPositions({
          durationMs: performance.now() - startedAtMs,
          insertedPositionCount: result.insertedPositionCount,
          positionTelemetryEventCount: 0,
          skippedAmbiguousLegacyAdoptionCount:
            result.skippedAmbiguousLegacyAdoptionCount,
        }),
      )
      return {
        changedPositionCount: result.changedPositionCount,
        insertedPositionCount: result.insertedPositionCount,
        skippedAmbiguousLegacyAdoptionCount:
          result.skippedAmbiguousLegacyAdoptionCount,
      }
    },
    persistTrackingHistoryBatch: async (input) => {
      const startedAtMs = performance.now()
      const result = await runCoverageMutation(
        input.mission_id,
        () => persistTrackingHistoryBatch(db, input, true, coverageLedgerFaultInjection),
      )
      await safeStorageDiagnostic(() =>
        storageDiagnostics?.recordInsertedPositions({
          durationMs: performance.now() - startedAtMs,
          insertedPositionCount: result.insertedPositionCount,
          positionTelemetryEventCount: 0,
          skippedAmbiguousLegacyAdoptionCount:
            result.skippedAmbiguousLegacyAdoptionCount,
        }),
      )
      return result.positions
    },
    listPositions: async (missionId, deviceId) =>
      deviceId === undefined
        ? all(db, 'SELECT * FROM positions WHERE mission_id = ? ORDER BY timestamp ASC', missionId)
        : all(db, 'SELECT * FROM positions WHERE mission_id = ? AND device_id = ? ORDER BY timestamp ASC', missionId, deviceId),
    listRecentPositions: async (missionId, perDeviceLimit) =>
      listRecentPositions(db, missionId, perDeviceLimit),
    listBreadcrumbPositions: async (missionId, perDeviceLimit, requestId) => {
      const normalizedRequestId = normalizeBreadcrumbQueryRequestId(requestId, false)
      if (
        normalizedRequestId !== null &&
        breadcrumbQueryControllersByRequestId.has(normalizedRequestId)
      ) {
        throw new Error('Breadcrumb query request ID is already active.')
      }
      const controller = new AbortController()
      const query = breadcrumbQueryTail.then(() =>
        breadcrumbQueryRunner({
          databasePath,
          missionId,
          perDeviceLimit,
          signal: controller.signal,
        }),
      )
      breadcrumbQueryTail = query.then(
        () => undefined,
        () => undefined,
      )
      const activeQuery = { controller, completion: query }
      activeBreadcrumbQueryControllers.add(controller)
      if (normalizedRequestId !== null) {
        breadcrumbQueryControllersByRequestId.set(normalizedRequestId, activeQuery)
      }
      try {
        const result = await query
        return {
          positions: result.positions,
          deviceTotals: result.deviceTotals,
          deviceSelections: result.deviceSelections,
          droppedPositionCount: result.droppedPositionCount,
        }
      } finally {
        activeBreadcrumbQueryControllers.delete(controller)
        if (
          normalizedRequestId !== null &&
          breadcrumbQueryControllersByRequestId.get(normalizedRequestId) === activeQuery
        ) {
          breadcrumbQueryControllersByRequestId.delete(normalizedRequestId)
        }
      }
    },
    cancelBreadcrumbQuery: async (requestId) => {
      const normalizedRequestId = normalizeBreadcrumbQueryRequestId(requestId, true)
      const activeQuery = breadcrumbQueryControllersByRequestId.get(normalizedRequestId)
      if (activeQuery === undefined) {
        return false
      }
      activeQuery.controller.abort()
      await activeQuery.completion.catch(() => undefined)
      return true
    },
    listExactBreadcrumbDotPage: async (input, requestId) => {
      const normalizedRequestId = normalizeBreadcrumbQueryRequestId(requestId, false)
      if (
        normalizedRequestId !== null &&
        breadcrumbDotQueryControllersByRequestId.has(normalizedRequestId)
      ) {
        throw new Error('Exact breadcrumb-dot query request ID is already active.')
      }
      const controller = new AbortController()
      const query = breadcrumbQueryTail.then(() =>
        breadcrumbDotQueryRunner({
          databasePath,
          query: input,
          signal: controller.signal,
        }),
      )
      breadcrumbQueryTail = query.then(
        () => undefined,
        () => undefined,
      )
      const activeQuery = { controller, completion: query }
      activeBreadcrumbQueryControllers.add(controller)
      if (normalizedRequestId !== null) {
        breadcrumbDotQueryControllersByRequestId.set(normalizedRequestId, activeQuery)
      }
      try {
        const result = await query
        return {
          positions: result.positions,
          totalPositionCount: result.totalPositionCount,
          pagePositionCount: result.pagePositionCount,
          fromTimestamp: result.fromTimestamp,
          toTimestamp: result.toTimestamp,
          hasEarlier: result.hasEarlier,
          hasLater: result.hasLater,
          earlierCursor: result.earlierCursor,
          laterCursor: result.laterCursor,
        }
      } finally {
        activeBreadcrumbQueryControllers.delete(controller)
        if (
          normalizedRequestId !== null &&
          breadcrumbDotQueryControllersByRequestId.get(normalizedRequestId) === activeQuery
        ) {
          breadcrumbDotQueryControllersByRequestId.delete(normalizedRequestId)
        }
      }
    },
    cancelExactBreadcrumbDotQuery: async (requestId) => {
      const normalizedRequestId = normalizeBreadcrumbQueryRequestId(requestId, true)
      const activeQuery = breadcrumbDotQueryControllersByRequestId.get(normalizedRequestId)
      if (activeQuery === undefined) {
        return false
      }
      activeQuery.controller.abort()
      await activeQuery.completion.catch(() => undefined)
      return true
    },
    readMissionReview: async (input, requestId) => {
      const normalizedRequestId = normalizeMissionReviewRequestId(requestId, false)
      if (
        normalizedRequestId !== null &&
        missionReviewQueryControllersByRequestId.has(normalizedRequestId)
      ) {
        throw new Error('Mission Review request ID is already active.')
      }
      const controller = new AbortController()
      const query = trackLiveMissionReviewRead(input?.missionId, () =>
        enqueueMissionReviewRead({
          query: input,
          signal: controller.signal,
        }))
      const activeQuery = { controller, completion: query }
      if (normalizedRequestId !== null) {
        missionReviewQueryControllersByRequestId.set(normalizedRequestId, activeQuery)
      }
      try {
        const result = await query
        return {
          auditEvents: result.auditEvents,
          breadcrumbCount: result.breadcrumbCount,
        }
      } finally {
        if (
          normalizedRequestId !== null &&
          missionReviewQueryControllersByRequestId.get(normalizedRequestId) === activeQuery
        ) {
          missionReviewQueryControllersByRequestId.delete(normalizedRequestId)
        }
      }
    },
    cancelMissionReviewRead: async (requestId) => {
      const normalizedRequestId = normalizeMissionReviewRequestId(requestId, true)
      const activeQuery = missionReviewQueryControllersByRequestId.get(normalizedRequestId)
      if (activeQuery === undefined) return false
      activeQuery.controller.abort()
      await activeQuery.completion.catch(() => undefined)
      return true
    },
    readMissionReplay: async (input, requestId) => {
      return trackLiveMissionReviewRead(input?.missionId, () => {
        assertLegacyMissionObjectBackfillSettled(db)
        assertLegacyEventProvenanceReady(db, input?.missionId)
        assertMissionReplayGpxStateSettled(db, input)
        return executeMissionReplayRead(input, requestId, 'state')
      })
    },
    readMissionReplayTrackChunk: async (input, requestId) => {
      return trackLiveMissionReviewRead(input?.missionId, () => {
        assertLegacyMissionObjectBackfillSettled(db)
        assertLegacyEventProvenanceReady(db, input?.missionId)
        assertMissionReplayGpxStateSettled(db, input)
        return executeMissionReplayRead(input, requestId, 'chunk')
      })
    },
    readMissionReplayObjectChunk: async (input, requestId) => {
      return trackLiveMissionReviewRead(input?.missionId, () => {
        assertLegacyMissionObjectBackfillSettled(db)
        assertLegacyEventProvenanceReady(db, input?.missionId)
        assertMissionReplayGpxStateSettled(db, input)
        return executeMissionReplayRead(input, requestId, 'objects')
      })
    },
    readMissionReplayFilterPage: async (input, requestId) => {
      return trackLiveMissionReviewRead(input?.missionId, () => {
        assertLegacyEventProvenanceReady(db, input?.missionId)
        assertMissionReplayGpxStateSettled(db, input)
        return executeMissionReplayRead(input, requestId, 'filters')
      })
    },
    cancelMissionReplay: async (requestId) => {
      const normalizedRequestId = normalizeMissionReviewRequestId(requestId, true)
      const activeQuery = missionReplayQueryControllersByRequestId.get(normalizedRequestId)
      if (activeQuery === undefined) return false
      activeQuery.controller.abort()
      await activeQuery.completion.catch(() => undefined)
      return true
    },
    listTrackingHistoryCheckpoints: async (missionId) =>
      listTrackingHistoryCheckpoints(db, missionId),
    countPositions: async (missionId, deviceId) => countPositions(db, missionId, deviceId),
    latestPositions: async (missionId) => latestPositions(db, missionId),
    listMissionEvents: async (missionId) =>
      // Tie-break on the implicit monotonic rowid so events written within the same
      // millisecond (e.g. the finalize sequence) keep their true insertion order
      // rather than ordering by a random UUID.
      all(db, 'SELECT * FROM mission_events WHERE mission_id = ? ORDER BY timestamp ASC, rowid ASC', missionId),
    listAuditEvents: async (missionId, options) => listAuditEvents(db, missionId, options),
    listIngestAnomalies: async (missionId, options) =>
      listIngestAnomalies(db, missionId, options),
    recordIngestRejections: async (input) => recordIngestRejections(
      db,
      ingestAnomalyOutbox,
      input,
    ),
    recordIngestEvidenceLoss: async (input) => recordIngestEvidenceLoss(
      db,
      ingestAnomalyOutbox,
      input,
    ),
    stageRendererEvidenceUncertainty: async (input) =>
      updateRendererEvidenceUncertainty(db, ingestAnomalyOutbox, input, 'stage'),
    resolveRendererEvidenceUncertainty: async (input) =>
      updateRendererEvidenceUncertainty(db, ingestAnomalyOutbox, input, 'resolve'),
    stageRendererEvidenceIncident: async (input) =>
      stageRendererEvidenceIncident(db, ingestAnomalyOutbox, input),
    resolveRendererEvidenceIncidents: async (input) =>
      resolveRendererEvidenceIncidents(ingestAnomalyOutbox, input),
    acknowledgeIngestEvidenceLoss: async (input) => acknowledgeIngestEvidenceLoss(
      db,
      ingestAnomalyOutbox,
      input,
      options.readAdminRoster,
    ),
    getIngestEvidenceHealth: async (missionId) => getIngestEvidenceHealth(
      db,
      ingestAnomalyOutbox,
      missionId,
    ),
    upsertMarker: async (input) => upsertVersionedById(
      db,
      evidenceVersionStore,
      'markers',
      'marker',
      normalizeMarkerMutation(input),
      markerDefaults,
    ),
    getMarker: async (markerId) => getById(db, 'markers', markerId, 'Marker'),
    listMarkers: async (missionId) => readLiveMissionReviewFacet(
      missionId,
      () => all(db, 'SELECT * FROM markers WHERE mission_id = ? AND retired_at IS NULL ORDER BY display_order ASC, name ASC', missionId),
    ),
    deleteMarker: async (markerId) => retireVersionedById(
      db,
      evidenceVersionStore,
      'markers',
      'marker',
      normalizeBoundedRequiredText(
        markerId,
        'Marker identity',
        MAX_SEARCH_OPERATION_ID_LENGTH,
      ),
    ),
    upsertDrawing: async (input) => upsertDrawingEvidence(db, evidenceVersionStore, input),
    getDrawing: async (drawingId) => getById(db, 'drawings', drawingId, 'Drawing'),
    listDrawings: async (missionId) => readLiveMissionReviewFacet(
      missionId,
      () => all(db, 'SELECT * FROM drawings WHERE mission_id = ? AND retired_at IS NULL ORDER BY display_order ASC, name ASC', missionId),
    ),
    deleteDrawing: async (drawingId) => retireDrawingEvidence(db, evidenceVersionStore, drawingId),
    upsertHelicopter: async (input) => upsertHelicopter(db, input),
    listHelicopters: async (missionId) => readLiveMissionReviewFacet(
      missionId,
      () => all(db, 'SELECT * FROM helicopters WHERE mission_id = ? ORDER BY slot_key ASC', missionId),
    ),
    deleteHelicopter: async (helicopterId) => deleteById(db, 'helicopters', helicopterId),
    upsertGpxImport: async (input) => projectGpxImportForRenderer(upsertGpxEvidence(db, input)),
    listGpxImports: async (missionId) => readLiveMissionReviewFacet(
      missionId,
      () => all(db, `SELECT * FROM gpx_track_imports
        WHERE mission_id = ? AND retired_at IS NULL AND import_state = 'complete'
          AND EXISTS (
            SELECT 1 FROM gpx_import_revisions AS revisions
            WHERE revisions.import_id = gpx_track_imports.id
          )
        ORDER BY display_name ASC, imported_at ASC`, missionId),
    ),
    deleteGpxImport: async (importId) => retireGpxEvidence(
      db,
      normalizeGpxRendererId(importId, 'GPX import'),
      gpxRetirementFaultInjection,
    ),
    listGpxImportRevisions: async (importId) => all(
      db,
      `SELECT * FROM gpx_import_revisions
        WHERE import_id = ? ORDER BY revision_sequence ASC`,
      importId,
    ),
    listGpxImportPage: async (input) => readLiveMissionReviewFacet(
      input?.missionId,
      () => listGpxImportProjectionPage(db, input),
    ),
    listGpxImportRevisionPage: async (input) =>
      listGpxImportRevisionProjectionPage(db, input),
    listGpxImportIssues: async (input) => listGpxImportIssues(db, input),
    updateGpxImportPresentation: async (input) => updateGpxImportPresentation(db, input),
    assignGpxImportToOuting: async (input) =>
      projectGpxImportForRenderer(assignGpxEvidenceToOuting(db, input)),
    importGpxEvidencePaths: async (input) => {
      const candidate = normalizeGpxRendererRecord(input, 'GPX path import')
      const missionId = normalizeGpxRendererId(candidate.missionId, 'GPX import mission')
      if (
        !Array.isArray(candidate.paths) || candidate.paths.length < 1 || candidate.paths.length > 100 ||
        candidate.paths.some((entry) => typeof entry !== 'string'
          || entry.length < 1 || entry.length > 4_096 || entry.trim() === '')
      ) {
        throw new Error('GPX import paths are invalid.')
      }
      const paths = candidate.paths.map((entry) => entry.trim())
      ensureWritableMission(db, missionId)
      if (migrationState.gpxReceiptRecoveryRemaining > 0
        || gpxReceiptRecoveryFailure !== null) {
        throw new Error(
          'Interrupted GPX evidence receipts are still being recovered in bounded background slices. Current positions remain available; retry the import after recovery completes.',
        )
      }
      const admittedBatchCount = queuedGpxEvidenceImports.length + (gpxImportWorkerActive ? 1 : 0)
      if (admittedBatchCount >= MAX_ADMITTED_GPX_IMPORT_BATCHES) {
        throw new Error(
          'The GPX evidence import queue is full. Wait for an admitted import to settle before adding more files.',
        )
      }
      const batchId = randomUUID()
      startGpxImportBatch(db, {
        batchId,
        missionId,
        totalFiles: paths.length,
        paths,
      })
      const controller = new AbortController()
      const result = enqueueGpxEvidenceImport({
        databasePath,
        missionId,
        paths,
        batchId,
        receiptsStarted: true,
        faultInjection: options.gpxEvidenceImportFaultInjection,
        signal: controller.signal,
      })
      const entry = {
        controller,
        completion: Promise.resolve(result).catch(() => undefined),
        workerExited: result?.workerExited ?? Promise.resolve(),
      }
      entry.quiesced = Promise.allSettled([entry.completion, entry.workerExited])
      activeGpxEvidenceImports.add(entry)
      entry.quiesced.finally(() => activeGpxEvidenceImports.delete(entry))
      return result
    },
    upsertSearchArea: async (input) => upsertSearchArea(db, evidenceVersionStore, input),
    listSearchAreas: async (missionId) => {
      const normalizedMissionId = normalizeBoundedRequiredText(
        missionId, 'Search area mission', MAX_SEARCH_OPERATION_ID_LENGTH,
      )
      return readLiveMissionReviewFacet(
        normalizedMissionId,
        () => all(
          db,
          `SELECT * FROM search_areas WHERE mission_id = ? AND retired_at IS NULL
            ORDER BY name ASC, id ASC`,
          normalizedMissionId,
        ),
      )
    },
    retireSearchArea: async (areaId, actor) => retireSearchArea(
      db,
      evidenceVersionStore,
      areaId,
      actor,
    ),
    upsertSearchAssignment: async (input) => upsertSearchAssignment(
      db,
      evidenceVersionStore,
      input,
    ),
    listSearchAssignments: async (missionId) => {
      const normalizedMissionId = normalizeBoundedRequiredText(
        missionId, 'Search assignment mission', MAX_SEARCH_OPERATION_ID_LENGTH,
      )
      return readLiveMissionReviewFacet(
        normalizedMissionId,
        () => all(
          db,
          `SELECT * FROM search_assignments WHERE mission_id = ? AND retired_at IS NULL
            ORDER BY created_at ASC, id ASC`,
          normalizedMissionId,
        ),
      )
    },
    upsertSearchPass: async (input) => upsertSearchPass(db, evidenceVersionStore, input),
    listSearchPasses: async (missionId) => {
      const normalizedMissionId = normalizeBoundedRequiredText(
        missionId, 'Search pass mission', MAX_SEARCH_OPERATION_ID_LENGTH,
      )
      return readLiveMissionReviewFacet(
        normalizedMissionId,
        () => listSearchPassRecords(db, normalizedMissionId),
      )
    },
    listSearchOperationPage: async (input) => trackLiveMissionReviewRead(
      input?.missionId,
      () => {
        const operation = searchOperationPageRunner({ databasePath, query: input })
        const workerExited = Promise.resolve(operation.workerExited ?? operation)
        activeSearchOperationPageReads.add(workerExited)
        void workerExited.finally(() => activeSearchOperationPageReads.delete(workerExited))
        const result = Promise.resolve(operation)
        Object.defineProperty(result, 'workerExited', { value: workerExited })
        return result
      },
    ),
    listMissionObjectVersions: async (input) => {
      assertLegacyMissionObjectBackfillSettled(db)
      return evidenceVersionStore.listVersions(input)
    },
    listLayerCatalogMetadata: async (missionId) => readLiveMissionReviewFacet(
      missionId,
      () => listLayerCatalogMetadata(db, missionId),
    ),
    upsertLayerCatalogMetadata: async (input) => upsertLayerCatalogMetadata(db, input),
    clearLayerCatalogMetadata: async (missionId) => clearLayerCatalogMetadata(db, missionId),
    getMission: async (missionId) => getMission(db, missionId),
    listMissions: async () => all(db, 'SELECT * FROM missions ORDER BY start_time DESC')
      .map((mission) => projectMissionStorageState(db, mission)),
    listMissionIdsAwaitingEvidenceClosure: async () => all(
      db,
      `SELECT id FROM missions
        WHERE status IN ('active', 'paused', 'finished')
        ORDER BY start_time DESC, rowid DESC`,
    ).map((mission) => mission.id),
    listRendererEvidenceScopesAwaitingClosure: async () => all(
      db,
      `SELECT id, status FROM missions
        WHERE status IN ('active', 'paused', 'finished')
        ORDER BY start_time DESC, rowid DESC`,
    ).map((mission) => ({
      mission_id: mission.id,
      scope_reason: rendererEvidenceScopeReason(mission.status),
    })),
    getActiveMission: async () => getActiveMission(db),
    getRecoverableMission: async () => getActiveMission(db),
    runMarkerAttachmentIngest: async (missionId, writeAttachment, cleanupAttachment) =>
      enqueueAttachmentLifecycleOperation(missionId, async () => {
        ensureWritableMission(db, missionId)
        const attachmentPath = await writeAttachment()
        try {
          db.transaction(() => {
            ensureWritableMission(db, missionId)
            insertEvent(db, missionId, 'marker_attachment_ingested', now(), {
              attachment_path: attachmentPath,
            })
          }).immediate()
          return attachmentPath
        } catch (error) {
          if (typeof cleanupAttachment === 'function') {
            try {
              await cleanupAttachment(attachmentPath)
            } catch (cleanupError) {
              const failure = new Error(
                'Attachment custody cleanup failed after the write was rejected.',
              )
              failure.code = 'ATTACHMENT_CLEANUP_FAILED'
              failure.cause = cleanupError
              throw failure
            }
          }
          throw error
        }
      }),
    pauseMission: async (missionId) => transitionMission(db, missionId, 'active', 'paused'),
    resumeMission: async (missionId) => transitionMission(db, missionId, 'paused', 'active'),
    finishMission: async (missionId) =>
      enqueueAttachmentLifecycleOperation(missionId, () => finishMission(db, missionId)),
    finalizeMission: async (missionId, custody, operationContext) =>
      enqueueFinalize(missionId, custody, operationContext),
    unlockFinalizedMission: (input) => unlockFinalizedMission(
      db,
      input,
      options.readAdminRoster,
      reconcileFinalizedMissionArchive,
      async (rehydrationInput) => {
        const admission = await acquireArchiveCorrectionAdmission()
        try {
          try {
            const operation = archiveCorrectionRunner({
              databasePath,
              snapshotPath: rehydrationInput.snapshotPath,
              missionId: rehydrationInput.missionId,
              archiveId: rehydrationInput.archiveId,
              operationId: rehydrationInput.operationId,
              finalizedEpoch: rehydrationInput.finalizedEpoch,
              adminName: rehydrationInput.adminName,
              reason: rehydrationInput.reason,
              attachmentDirectory: rehydrationInput.attachmentDirectory,
              attachmentMappings: rehydrationInput.attachmentMappings,
              faultInjection: archiveCorrectionFaultInjection,
            })
            admission.cancel = typeof operation?.cancel === 'function'
              ? operation.cancel
              : null
            admission.workerExited = Promise.resolve(operation?.workerExited ?? operation)
            return await awaitArchiveWorker(operation)
          } catch (error) {
            if (isCommittedArchiveCorrection(db, rehydrationInput.missionId, rehydrationInput.archiveId)) {
              return getMission(db, rehydrationInput.missionId)
            }
            throw error
          }
        } finally {
          releaseArchiveCorrectionAdmission(admission)
        }
      },
    ),
  }

  /** Reconciles a worker death that occurred after the durable correction transaction committed. */
  function isCommittedArchiveCorrection(database, missionId, archiveId) {
    const mission = database.prepare('SELECT status FROM missions WHERE id = ?')
      .get(missionId)
    if (mission?.status !== 'finished' || readMissionLiveReviewStorageState(database, missionId) !== 'live') return false
    const event = database.prepare(`SELECT details_json FROM mission_events
      WHERE mission_id = ? AND event_type = 'mission_unlocked'
      ORDER BY rowid DESC LIMIT 1`).get(missionId)
    const details = readEventDetails(event?.details_json)
    return details.restored_from_archive_id === archiveId
  }

  /** Orders asynchronous attachment custody and Finish for one mission. */
  function enqueueAttachmentLifecycleOperation(missionId, execute) {
    const previous = attachmentLifecycleTails.get(missionId) ?? Promise.resolve()
    const operation = previous.then(execute)
    const settledTail = operation.catch(() => undefined)
    attachmentLifecycleTails.set(missionId, settledTail)
    void settledTail.finally(() => {
      if (attachmentLifecycleTails.get(missionId) === settledTail) {
        attachmentLifecycleTails.delete(missionId)
      }
    })
    return operation
  }

  /**
   * Caps Mission Review at one physical worker and waits for obsolete worker
   * exit separately from the renderer-facing cancellation promise.
   */
  function enqueueMissionReviewRead(input) {
    const previousWorker = missionReviewWorkerTail
    let releaseWorkerSlot = () => undefined
    let resolveWorkerExit = () => undefined
    const workerSlot = new Promise((resolve) => {
      releaseWorkerSlot = resolve
    })
    const workerExited = new Promise((resolve) => {
      resolveWorkerExit = resolve
    })
    missionReviewWorkerTail = previousWorker.then(() => workerSlot)
    const result = previousWorker.then(() => {
      let operation
      try {
        operation = missionReviewReadQueryRunner({
          databasePath,
          query: input.query,
          signal: input.signal,
        })
      } catch (error) {
        releaseWorkerSlot()
        resolveWorkerExit()
        throw error
      }
      const physicalExit = operation.workerExited ?? operation
      void Promise.resolve(physicalExit).then(() => {
        releaseWorkerSlot()
        resolveWorkerExit()
      }, () => {
        releaseWorkerSlot()
        resolveWorkerExit()
      })
      return operation
    })
    Object.defineProperty(result, 'workerExited', { value: workerExited })
    return result
  }

  function executeMissionReplayRead(input, requestId, kind) {
    const normalizedRequestId = normalizeMissionReviewRequestId(requestId, false)
    if (
      normalizedRequestId !== null
      && missionReplayQueryControllersByRequestId.has(normalizedRequestId)
    ) {
      throw new Error('Mission replay request ID is already active.')
    }
    const controller = new AbortController()
    const query = enqueueMissionReplayRead({ query: input, signal: controller.signal, kind })
    const activeQuery = { controller, completion: query }
    if (normalizedRequestId !== null) {
      missionReplayQueryControllersByRequestId.set(normalizedRequestId, activeQuery)
    }
    const result = Promise.resolve(query).finally(() => {
      if (missionReplayQueryControllersByRequestId.get(normalizedRequestId) === activeQuery) {
        missionReplayQueryControllersByRequestId.delete(normalizedRequestId)
      }
    })
    Object.defineProperty(result, 'workerExited', {
      value: query.workerExited ?? query,
    })
    return result
  }

  function enqueueMissionReplayRead(input) {
    const previousWorker = missionReplayWorkerTail
    let releaseWorkerSlot = () => undefined
    let resolveWorkerExit = () => undefined
    const workerSlot = new Promise((resolve) => { releaseWorkerSlot = resolve })
    const workerExited = new Promise((resolve) => { resolveWorkerExit = resolve })
    missionReplayWorkerTail = previousWorker.then(() => workerSlot)
    const result = previousWorker.then(() => {
      let operation
      try {
        operation = missionReplayRunner({
          databasePath,
          query: input.query,
          signal: input.signal,
          kind: input.kind,
        })
      } catch (error) {
        releaseWorkerSlot()
        resolveWorkerExit()
        throw error
      }
      const physicalExit = operation.workerExited ?? operation
      void Promise.resolve(physicalExit).then(() => {
        releaseWorkerSlot()
        resolveWorkerExit()
      }, () => {
        releaseWorkerSlot()
        resolveWorkerExit()
      })
      return operation
    })
    Object.defineProperty(result, 'workerExited', { value: workerExited })
    return result
  }

  /**
   * Caps outing summaries at one physical worker. Renderer cancellation may
   * settle before worker termination, so the slot follows workerExited.
   */
  function enqueueOutingFixSummary(input) {
    const previousWorker = outingFixSummaryWorkerTail
    let releaseWorkerSlot = () => undefined
    const workerSlot = new Promise((resolve) => {
      releaseWorkerSlot = resolve
    })
    outingFixSummaryWorkerTail = previousWorker.then(() => workerSlot)
    return previousWorker.then(() => {
      let operation
      try {
        operation = outingFixSummaryRunner({
          databasePath,
          query: input.query,
          signal: input.signal,
        })
      } catch (error) {
        releaseWorkerSlot()
        throw error
      }
      const workerExited = operation.workerExited ?? operation
      void Promise.resolve(workerExited).then(releaseWorkerSlot, releaseWorkerSlot)
      return operation
    })
  }

  /** Runs one renderer-owned coverage operation with cancellation and ID reuse fencing. */
  function executeCoverageRequest(requestId, execute) {
    const normalizedRequestId = normalizeCoverageQueryRequestId(requestId, false)
    if (
      normalizedRequestId !== null &&
      coverageQueryControllersByRequestId.has(normalizedRequestId)
    ) {
      throw new Error('Coverage query request ID is already active.')
    }
    const controller = new AbortController()
    const activeQuery = {
      controller,
      completion: Promise.resolve().then(() => execute(controller.signal)),
    }
    if (normalizedRequestId !== null) {
      coverageQueryControllersByRequestId.set(normalizedRequestId, activeQuery)
    }
    return activeQuery.completion.finally(() => {
      if (
        normalizedRequestId !== null &&
        coverageQueryControllersByRequestId.get(normalizedRequestId) === activeQuery
      ) {
        coverageQueryControllersByRequestId.delete(normalizedRequestId)
      }
    })
  }

  /** Runs one independently cancellable renderer tile read on the shared worker. */
  function executeCoverageTileRead(requestId, execute) {
    const normalizedRequestId = normalizeCoverageQueryRequestId(requestId, false)
    if (
      normalizedRequestId !== null &&
      coverageTileControllersByRequestId.has(normalizedRequestId)
    ) {
      throw new Error('Coverage tile request ID is already active.')
    }
    const controller = new AbortController()
    const activeQuery = {
      controller,
      completion: Promise.resolve().then(() => execute(controller.signal)),
    }
    if (normalizedRequestId !== null) {
      coverageTileControllersByRequestId.set(normalizedRequestId, activeQuery)
    }
    return activeQuery.completion.finally(() => {
      if (
        normalizedRequestId !== null &&
        coverageTileControllersByRequestId.get(normalizedRequestId) === activeQuery
      ) {
        coverageTileControllersByRequestId.delete(normalizedRequestId)
      }
    })
  }

  /** Publishes only a sequence that moved in the just-committed mutation. */
  async function runCoverageMutation(missionId, execute) {
    assertArchiveCorrectionWriterIdle(missionId)
    const before = readCoverageChangeSequence(missionId)
    const result = await execute()
    const after = readCoverageChangeSequence(missionId)
    if (after > before) onCoverageChanged(missionId, after)
    return result
  }

  /** Reads one coordinate-free scalar without creating coverage state. */
  function readCoverageChangeSequence(missionId) {
    return Number(db.prepare(`SELECT change_seq FROM coverage_missions
      WHERE mission_id = ?`).get(missionId)?.change_seq ?? 0)
  }

  /** Drains each durable outing invalidation through worker analysis and bounded applies. */
  async function drainCoverageInvalidations(missionId, signal) {
    const pending = db.prepare(`SELECT id FROM coverage_invalidations
      WHERE mission_id = ? AND drained_at IS NULL ORDER BY created_at ASC, id ASC`)
      .all(missionId)
    for (const row of pending) {
      const analysis = await runCoverageWorker(
        { kind: 'invalidation-analysis', invalidationId: row.id },
        signal,
        false,
      )
      applyCoverageInvalidationDrain(db, {
        invalidationId: row.id,
        affectedKeys: normalizeCoverageInvalidationDrain(db, row.id, analysis),
        drainedAt: now(),
      })
    }
  }

  function recordCoveragePerformance(missionId, update) {
    coveragePerformanceByMission.set(missionId, {
      lastEnumerationDurationMs:
        coveragePerformanceByMission.get(missionId)?.lastEnumerationDurationMs ?? null,
      lastBuildDurationMs:
        coveragePerformanceByMission.get(missionId)?.lastBuildDurationMs ?? null,
      ...update,
    })
  }

  function attachCoveragePerformance(missionId, manifest) {
    const performanceMetrics = coveragePerformanceByMission.get(missionId) ?? {
      lastEnumerationDurationMs: null,
      lastBuildDurationMs: null,
    }
    return {
      ...manifest,
      diagnostics: {
        ...manifest.diagnostics,
        ...performanceMetrics,
      },
    }
  }

  /** Serializes GPX evidence publications so identical concurrent sources share one identity. */
  function enqueueGpxEvidenceImport(input) {
    let resolveResult = () => undefined
    let rejectResult = () => undefined
    let resolveWorkerExit = () => undefined
    const result = new Promise((resolve, reject) => {
      resolveResult = resolve
      rejectResult = reject
    })
    const workerExited = new Promise((resolve) => { resolveWorkerExit = resolve })
    queuedGpxEvidenceImports.push({
      input,
      rejectResult,
      resolveResult,
      resolveWorkerExit,
    })
    Object.defineProperty(result, 'workerExited', { value: workerExited })
    startNextGpxEvidenceImport()
    return result
  }

  /** Starts the next queued GPX import only after the prior worker has exited. */
  function startNextGpxEvidenceImport() {
    if (gpxImportWorkerActive) return
    const queued = queuedGpxEvidenceImports.shift()
    if (queued === undefined) return
    if (queued.input.signal?.aborted === true) {
      const error = new Error('GPX evidence import worker was cancelled before it started.')
      error.name = 'AbortError'
      queued.rejectResult(error)
      queued.resolveWorkerExit()
      startNextGpxEvidenceImport()
      return
    }
    gpxImportWorkerActive = true
    let operation
    try {
      operation = gpxEvidenceImportRunner(queued.input)
    } catch (error) {
      queued.rejectResult(error)
      queued.resolveWorkerExit()
      gpxImportWorkerActive = false
      startNextGpxEvidenceImport()
      return
    }
    void Promise.resolve(operation).then(queued.resolveResult, queued.rejectResult)
    void Promise.resolve(operation.workerExited ?? operation)
      .catch(() => undefined)
      .finally(() => {
        queued.resolveWorkerExit()
        gpxImportWorkerActive = false
        startNextGpxEvidenceImport()
      })
  }

  /** Serializes chunk payload reads while allowing small manifest/claim reads alongside. */
  function runCoverageWorker(query, signal, serializeChunk) {
    const resultLimits = readCoverageQueryResultLimits(db, query)
    if (!serializeChunk) {
      return normalizeCoverageOperation(
        query,
        coverageQueryRunner({ databasePath, query, signal, resultLimits }),
        resultLimits,
      )
    }
    const previousWorker = coverageChunkWorkerTail
    let releaseWorkerSlot = () => undefined
    const workerSlot = new Promise((resolve) => { releaseWorkerSlot = resolve })
    coverageChunkWorkerTail = previousWorker.then(() => workerSlot)
    return previousWorker.then(() => {
      let operation
      try {
        operation = normalizeCoverageOperation(
          query,
          coverageQueryRunner({ databasePath, query, signal, resultLimits }),
          resultLimits,
        )
      } catch (error) {
        releaseWorkerSlot()
        throw error
      }
      const workerExited = operation.workerExited ?? operation
      void Promise.resolve(workerExited).then(releaseWorkerSlot, releaseWorkerSlot)
      return operation
    })
  }

  /** Normalizes injected and production worker operations without losing exit ownership. */
  function normalizeCoverageOperation(query, operation, resultLimits) {
    const normalized = coverageQueryRunnerValidatesResults
      ? Promise.resolve(operation)
      : Promise.resolve(operation).then((result) =>
          normalizeCoverageWorkerResult(query, result, resultLimits))
    Object.defineProperty(normalized, 'workerExited', {
      value: operation.workerExited ?? operation,
    })
    return normalized
  }
}

function migrate(db, archiveDirectory) {
  const migrationTime = now()
  const applyMigrations = db.transaction(() => {
    db.exec(`
    CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `)
  const existingSchemaVersion = readStoredSchemaVersion(db)
  if (existingSchemaVersion > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `Cannot open mission store created by newer mission store schema ${existingSchemaVersion}; this build supports schema ${CURRENT_SCHEMA_VERSION}.`,
    )
  }
  const anomalySummaryRequiresBackfill = !tableExists(
    db,
    'ingest_anomaly_mission_health',
  )
  const participantsRequireGrandfathering = !tableExists(db, 'mission_participants')
  const positionsRequireProvenanceBackfill = !columnExists(
    db,
    'positions',
    'timestamp_provenance_recorded_at',
  )
  const eventProvenanceRequiresBackfill = existingSchemaVersion < MISSION_EVIDENCE_VERSION_SCHEMA
    || !columnExists(db, 'mission_events', 'recorded_at')
    || !columnExists(db, 'mission_events', 'recording_completeness')
    || !columnExists(db, 'mission_group_membership_events', 'sequence')
    || !columnExists(db, 'mission_group_membership_events', 'recorded_at')
    || !columnExists(db, 'mission_group_membership_events', 'recording_completeness')
  const gpxSourceRevisionRequiresBackfill = !columnExists(
    db,
    'gpx_import_revisions',
    'source_revision_sequence',
  )

  db.exec(`
    CREATE TABLE IF NOT EXISTS missions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('idle', 'active', 'paused', 'finished', 'finalized')),
      start_time TEXT NOT NULL,
      pause_time TEXT,
      finish_time TEXT,
      paused_seconds INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      schema_version INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_missions_status ON missions(status);
    CREATE TABLE IF NOT EXISTS outings (
      id TEXT PRIMARY KEY,
      mission_id TEXT NOT NULL,
      label TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE,
      CHECK (ended_at IS NULL OR ended_at > started_at)
    );
    CREATE INDEX IF NOT EXISTS idx_outings_mission_started
      ON outings(mission_id, started_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_outings_mission_active
      ON outings(mission_id) WHERE ended_at IS NULL;
    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY,
      mission_id TEXT NOT NULL,
      device_id TEXT NOT NULL,
      name TEXT NOT NULL,
      color TEXT NOT NULL,
      last_seen TEXT,
      status TEXT NOT NULL CHECK(status IN ('online', 'offline', 'unknown')),
      FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE,
      UNIQUE (mission_id, device_id)
    );
    CREATE TABLE IF NOT EXISTS mission_teams (
      id TEXT PRIMARY KEY,
      mission_id TEXT NOT NULL,
      traccar_group_id TEXT NOT NULL,
      name TEXT NOT NULL,
      frozen_at TEXT NOT NULL,
      FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE,
      UNIQUE (mission_id, traccar_group_id)
    );
    CREATE TABLE IF NOT EXISTS mission_participants (
      id TEXT PRIMARY KEY,
      mission_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('device', 'group')),
      traccar_device_id TEXT,
      mission_team_id TEXT,
      provenance TEXT NOT NULL CHECK (provenance IN ('explicit', 'grandfathered', 'legacy_auto')),
      effective_from TEXT NOT NULL,
      added_at TEXT NOT NULL,
      added_by TEXT,
      removed_at TEXT,
      removed_by TEXT,
      FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE,
      FOREIGN KEY (mission_team_id) REFERENCES mission_teams(id),
      CHECK ((kind = 'device') = (traccar_device_id IS NOT NULL)),
      CHECK ((kind = 'group') = (mission_team_id IS NOT NULL)),
      CHECK (removed_at IS NULL OR removed_at >= added_at)
    );
    CREATE INDEX IF NOT EXISTS idx_mission_participants_mission
      ON mission_participants(mission_id);
    CREATE TABLE IF NOT EXISTS mission_replay_generations (
      mission_id TEXT PRIMARY KEY,
      generation INTEGER NOT NULL CHECK(generation >= 0),
      FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS mission_finalization_fences (
      mission_id TEXT PRIMARY KEY,
      requested_at TEXT NOT NULL,
      FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_mission_participants_active_device
      ON mission_participants(mission_id, traccar_device_id)
      WHERE kind = 'device' AND removed_at IS NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_mission_participants_active_group
      ON mission_participants(mission_id, mission_team_id)
      WHERE kind = 'group' AND removed_at IS NULL;
    CREATE TABLE IF NOT EXISTS mission_group_membership_events (
      id TEXT PRIMARY KEY,
      sequence INTEGER NOT NULL,
      mission_id TEXT NOT NULL,
      mission_team_id TEXT NOT NULL,
      traccar_device_id TEXT NOT NULL,
      change TEXT NOT NULL CHECK (change IN ('member', 'left')),
      observed_at TEXT NOT NULL,
      recorded_at TEXT,
      recording_completeness TEXT CHECK(recording_completeness IN ('complete', 'legacy_baseline')),
      FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE,
      FOREIGN KEY (mission_team_id) REFERENCES mission_teams(id)
    );
    CREATE INDEX IF NOT EXISTS idx_group_membership_mission_team
      ON mission_group_membership_events(mission_id, mission_team_id, observed_at, sequence);
    CREATE TABLE IF NOT EXISTS participant_backfill_checkpoints (
      mission_id TEXT NOT NULL,
      traccar_device_id TEXT NOT NULL,
      window_from TEXT NOT NULL,
      window_to TEXT NOT NULL,
      reconciled_until TEXT NOT NULL,
      completed INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (mission_id, traccar_device_id, window_from),
      FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS positions (
      id TEXT PRIMARY KEY,
      mission_id TEXT NOT NULL,
      device_id TEXT NOT NULL,
      source_position_id TEXT,
      name TEXT,
      lat REAL NOT NULL,
      lon REAL NOT NULL,
      altitude REAL,
      speed REAL,
      battery REAL,
      accuracy REAL,
      source TEXT,
      timestamp TEXT NOT NULL,
      data_origin TEXT NOT NULL DEFAULT 'live' CHECK(data_origin IN ('live', 'cache')),
      received_at TEXT,
      content_hash TEXT,
      source_kind TEXT,
      timestamp_source TEXT CHECK(timestamp_source IS NULL OR timestamp_source = 'fix'),
      timestamp_provenance_recorded_at TEXT,
      FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE,
      FOREIGN KEY (mission_id, device_id) REFERENCES devices(mission_id, device_id)
    );
    CREATE INDEX IF NOT EXISTS idx_positions_mission_device_timestamp ON positions(mission_id, device_id, timestamp);
    CREATE TABLE IF NOT EXISTS coverage_chunks (
      mission_id TEXT NOT NULL,
      device_id TEXT NOT NULL,
      period_kind TEXT NOT NULL CHECK (period_kind IN ('outing', 'unassigned')),
      period_id TEXT NOT NULL DEFAULT '',
      content_rev INTEGER NOT NULL DEFAULT 1,
      built_rev INTEGER,
      fix_count INTEGER,
      fix_digest TEXT,
      min_ts TEXT,
      max_ts TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (mission_id, device_id, period_kind, period_id),
      CHECK ((period_kind = 'outing') = (period_id <> '')),
      FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_coverage_chunks_mission
      ON coverage_chunks(mission_id);
    CREATE TABLE IF NOT EXISTS coverage_missions (
      mission_id TEXT PRIMARY KEY,
      change_seq INTEGER NOT NULL DEFAULT 0,
      enumerated INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS coverage_invalidations (
      id TEXT PRIMARY KEY,
      mission_id TEXT NOT NULL,
      reason TEXT NOT NULL CHECK (reason IN (
        'outing_created',
        'outing_ended',
        'outing_boundaries_edited',
        'enumeration_required'
      )),
      subject_outing_id TEXT NOT NULL,
      old_started_at TEXT,
      old_ended_at TEXT,
      new_started_at TEXT,
      new_ended_at TEXT,
      range_from TEXT NOT NULL,
      range_to TEXT,
      created_at TEXT NOT NULL,
      drained_at TEXT,
      FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_coverage_invalidations_pending
      ON coverage_invalidations(mission_id, drained_at);
    CREATE TABLE IF NOT EXISTS tracking_history_checkpoints (
      mission_id TEXT NOT NULL,
      device_id TEXT NOT NULL,
      history_from TEXT NOT NULL,
      reconciled_until TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (mission_id, device_id),
      FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE,
      FOREIGN KEY (mission_id, device_id) REFERENCES devices(mission_id, device_id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS position_revisions (
      id TEXT PRIMARY KEY,
      mission_id TEXT NOT NULL,
      position_id TEXT NOT NULL,
      source_position_id TEXT NOT NULL,
      corrected_at TEXT NOT NULL,
      changed_fields_json TEXT NOT NULL,
      previous_json TEXT NOT NULL,
      corrected_json TEXT NOT NULL,
      FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE,
      FOREIGN KEY (position_id) REFERENCES positions(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_position_revisions_position_corrected
      ON position_revisions(position_id, corrected_at);
    CREATE TABLE IF NOT EXISTS ingest_anomalies (
      id TEXT PRIMARY KEY,
      mission_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('rejected', 'conflict')),
      anomaly_key TEXT NOT NULL,
      device_id TEXT,
      source_position_id TEXT,
      reason_class TEXT NOT NULL,
      received_at TEXT NOT NULL,
      canonical_payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      occurrence_count INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE,
      UNIQUE (mission_id, kind, anomaly_key)
    );
    CREATE INDEX IF NOT EXISTS idx_ingest_anomalies_mission_created
      ON ingest_anomalies(mission_id, created_at);
    CREATE TABLE IF NOT EXISTS ingest_anomaly_deliveries (
      delivery_id TEXT NOT NULL,
      mission_id TEXT NOT NULL,
      projected_at TEXT NOT NULL,
      PRIMARY KEY (mission_id, delivery_id),
      FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS ingest_anomaly_mission_health (
      mission_id TEXT PRIMARY KEY,
      conflict_count INTEGER NOT NULL DEFAULT 0,
      rejected_count INTEGER NOT NULL DEFAULT 0,
      affected_device_count INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS ingest_anomaly_devices (
      mission_id TEXT NOT NULL,
      device_id TEXT NOT NULL,
      conflict_count INTEGER NOT NULL DEFAULT 0,
      rejected_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (mission_id, device_id),
      FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS markers (
      id TEXT PRIMARY KEY,
      mission_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('ipp_lkp', 'clue', 'hazard', 'casualty')),
      name TEXT NOT NULL,
      description TEXT,
      lat REAL NOT NULL,
      lon REAL NOT NULL,
      irish_grid_e INTEGER NOT NULL,
      irish_grid_n INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      display_order INTEGER NOT NULL DEFAULT 0,
      subject_category TEXT,
      clue_type TEXT,
      confidence REAL,
      found_by TEXT,
      hazard_type TEXT,
      severity TEXT,
      condition TEXT,
      treatment TEXT,
      evacuation_priority TEXT,
      label_size INTEGER,
      updated_by TEXT,
      coordinator_ids TEXT,
      attachment_path TEXT,
      FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS drawings (
      id TEXT PRIMARY KEY,
      mission_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('line', 'search_area', 'range_ring', 'bearing_line', 'search_sector', 'text_label')),
      name TEXT NOT NULL,
      description TEXT,
      color TEXT,
      width REAL,
      distance_m REAL,
      temporary_measure INTEGER,
      label TEXT,
      display_order INTEGER NOT NULL DEFAULT 0,
      geometry_json TEXT NOT NULL,
      metadata_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS helicopters (
      id TEXT PRIMARY KEY,
      mission_id TEXT NOT NULL,
      slot_key TEXT NOT NULL CHECK(slot_key IN ('slot_1', 'slot_2', 'slot_3', 'slot_4')),
      call_sign TEXT NOT NULL,
      hex_id TEXT,
      lat REAL NOT NULL,
      lon REAL NOT NULL,
      altitude REAL,
      speed REAL,
      heading REAL,
      last_update TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE,
      UNIQUE (mission_id, slot_key)
    );
    CREATE TABLE IF NOT EXISTS gpx_track_imports (
      id TEXT PRIMARY KEY,
      mission_id TEXT NOT NULL,
      source_path TEXT NOT NULL,
      file_name TEXT NOT NULL,
      display_name TEXT NOT NULL,
      geometry_json TEXT NOT NULL,
      metadata_json TEXT,
      content_sha256 TEXT,
      source_bytes_base64 TEXT,
      timing_class TEXT NOT NULL DEFAULT 'undated' CHECK(timing_class IN ('fully_dated', 'partially_dated', 'undated')),
      outing_id TEXT,
      import_state TEXT NOT NULL DEFAULT 'complete' CHECK(import_state IN ('staging', 'complete')),
      revision_sequence INTEGER NOT NULL DEFAULT 1,
      retired_at TEXT,
      retired_by TEXT,
      imported_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE,
      FOREIGN KEY (outing_id) REFERENCES outings(id),
      UNIQUE (mission_id, source_path)
    );
    CREATE TABLE IF NOT EXISTS gpx_import_aliases (
      mission_id TEXT NOT NULL,
      import_id TEXT NOT NULL,
      source_path TEXT NOT NULL,
      file_name TEXT NOT NULL,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      PRIMARY KEY (mission_id, source_path),
      FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE,
      FOREIGN KEY (import_id) REFERENCES gpx_track_imports(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS gpx_import_revisions (
      id TEXT PRIMARY KEY,
      mission_id TEXT NOT NULL,
      import_id TEXT NOT NULL,
      revision_sequence INTEGER NOT NULL,
      source_revision_sequence INTEGER NOT NULL CHECK(source_revision_sequence >= 1),
      content_sha256 TEXT,
      source_bytes_base64 TEXT,
      source_path TEXT NOT NULL,
      file_name TEXT NOT NULL,
      display_name TEXT NOT NULL,
      geometry_json TEXT NOT NULL,
      metadata_json TEXT,
      timing_class TEXT NOT NULL CHECK(timing_class IN ('fully_dated', 'partially_dated', 'undated')),
      outing_id TEXT,
      import_state TEXT NOT NULL DEFAULT 'complete' CHECK(import_state IN ('staging', 'complete')),
      completeness TEXT NOT NULL CHECK(completeness IN ('complete', 'legacy_baseline')),
      recorded_at TEXT NOT NULL,
      audit_event_id TEXT,
      UNIQUE (import_id, revision_sequence),
      FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE,
      FOREIGN KEY (import_id) REFERENCES gpx_track_imports(id) ON DELETE CASCADE,
      FOREIGN KEY (outing_id) REFERENCES outings(id),
      FOREIGN KEY (audit_event_id) REFERENCES mission_events(id)
    );
    CREATE INDEX IF NOT EXISTS idx_gpx_revisions_replay
      ON gpx_import_revisions(mission_id, recorded_at, import_id, revision_sequence);
    CREATE TABLE IF NOT EXISTS legacy_gpx_backfill_quarantine (
      source_rowid INTEGER PRIMARY KEY,
      import_id_preview TEXT NOT NULL,
      reason TEXT NOT NULL,
      geometry_bytes INTEGER NOT NULL,
      source_bytes_base64_bytes INTEGER NOT NULL,
      metadata_bytes INTEGER NOT NULL,
      detected_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS legacy_gpx_backfill_state (
      singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
      scanned_through_rowid INTEGER NOT NULL CHECK(scanned_through_rowid >= 0),
      scan_target_rowid INTEGER NOT NULL CHECK(scan_target_rowid >= scanned_through_rowid),
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS legacy_gpx_rowid_scan_state (
      singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
      low_scanned_through_rowid INTEGER NOT NULL CHECK(low_scanned_through_rowid <= 1),
      low_target_rowid INTEGER NOT NULL CHECK(low_target_rowid <= low_scanned_through_rowid),
      high_scanned_through_rowid INTEGER NOT NULL CHECK(high_scanned_through_rowid >= 9007199254740991),
      high_target_rowid INTEGER NOT NULL CHECK(high_target_rowid >= high_scanned_through_rowid),
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS gpx_evidence_points (
      import_id TEXT NOT NULL,
      revision_sequence INTEGER NOT NULL,
      segment_index INTEGER NOT NULL,
      point_index INTEGER NOT NULL,
      track_name TEXT,
      lat REAL NOT NULL CHECK(lat >= -90 AND lat <= 90),
      lon REAL NOT NULL CHECK(lon >= -180 AND lon <= 180),
      elevation REAL,
      source_time TEXT,
      PRIMARY KEY (import_id, revision_sequence, segment_index, point_index),
      FOREIGN KEY (import_id, revision_sequence)
        REFERENCES gpx_import_revisions(import_id, revision_sequence) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_gpx_points_replay
      ON gpx_evidence_points(import_id, revision_sequence, source_time, segment_index, point_index);
    CREATE TABLE IF NOT EXISTS gpx_evidence_rejections (
      id TEXT PRIMARY KEY,
      import_id TEXT NOT NULL,
      revision_sequence INTEGER NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('point', 'segment')),
      segment_index INTEGER NOT NULL,
      point_index INTEGER,
      reason TEXT NOT NULL,
      source_value TEXT,
      FOREIGN KEY (import_id, revision_sequence)
        REFERENCES gpx_import_revisions(import_id, revision_sequence) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS gpx_import_batches (
      id TEXT PRIMARY KEY,
      mission_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('running', 'completed', 'completed_with_failures', 'interrupted')),
      total_files INTEGER NOT NULL,
      completed_files INTEGER NOT NULL DEFAULT 0,
      failed_files INTEGER NOT NULL DEFAULT 0,
      started_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      finished_at TEXT,
      FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS gpx_import_failures (
      id TEXT PRIMARY KEY,
      batch_id TEXT NOT NULL,
      mission_id TEXT NOT NULL,
      source_path TEXT NOT NULL,
      file_name TEXT NOT NULL,
      content_sha256 TEXT,
      source_bytes_base64 TEXT,
      reason TEXT NOT NULL,
      rejection_count INTEGER NOT NULL DEFAULT 0 CHECK(rejection_count >= 0),
      rejections_json TEXT NOT NULL DEFAULT '[]',
      recorded_at TEXT NOT NULL,
      FOREIGN KEY (batch_id) REFERENCES gpx_import_batches(id) ON DELETE CASCADE,
      FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_gpx_import_failures_mission
      ON gpx_import_failures(mission_id, recorded_at, batch_id);
    CREATE TABLE IF NOT EXISTS gpx_import_source_receipts (
      batch_id TEXT NOT NULL,
      mission_id TEXT NOT NULL,
      source_path TEXT NOT NULL,
      file_name TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending', 'retained', 'settled', 'failed')),
      content_sha256 TEXT,
      source_bytes_base64 TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (batch_id, source_path),
      FOREIGN KEY (batch_id) REFERENCES gpx_import_batches(id) ON DELETE CASCADE,
      FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_gpx_import_receipts_unsettled
      ON gpx_import_source_receipts(mission_id, status, updated_at, batch_id);
    CREATE TABLE IF NOT EXISTS search_areas (
      id TEXT PRIMARY KEY,
      mission_id TEXT NOT NULL,
      name TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('active', 'retired')),
      geometry_json TEXT NOT NULL,
      legacy_drawing_id TEXT,
      version_sequence INTEGER NOT NULL DEFAULT 1,
      updated_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      retired_at TEXT,
      FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE,
      UNIQUE (mission_id, legacy_drawing_id)
    );
    CREATE INDEX IF NOT EXISTS idx_search_areas_mission
      ON search_areas(mission_id, retired_at, name, id);
    CREATE TABLE IF NOT EXISTS search_assignments (
      id TEXT PRIMARY KEY,
      mission_id TEXT NOT NULL,
      search_area_id TEXT NOT NULL,
      outing_id TEXT NOT NULL,
      team_id TEXT NOT NULL,
      participant_ids_json TEXT NOT NULL,
      notes TEXT,
      version_sequence INTEGER NOT NULL DEFAULT 1,
      updated_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      retired_at TEXT,
      FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE,
      FOREIGN KEY (search_area_id) REFERENCES search_areas(id),
      FOREIGN KEY (outing_id) REFERENCES outings(id)
    );
    CREATE INDEX IF NOT EXISTS idx_search_assignments_mission
      ON search_assignments(mission_id, outing_id, search_area_id, created_at, id);
    CREATE TABLE IF NOT EXISTS search_passes (
      id TEXT PRIMARY KEY,
      mission_id TEXT NOT NULL,
      search_area_id TEXT NOT NULL,
      assignment_id TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      outcome TEXT NOT NULL CHECK(outcome IN ('full', 'partial', 'aborted')),
      notes TEXT,
      coordinator_name TEXT NOT NULL,
      advisory_coverage_json TEXT,
      version_sequence INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE,
      FOREIGN KEY (search_area_id) REFERENCES search_areas(id),
      FOREIGN KEY (assignment_id) REFERENCES search_assignments(id)
    );
    CREATE INDEX IF NOT EXISTS idx_search_passes_mission
      ON search_passes(mission_id, started_at, search_area_id, id);
    CREATE TABLE IF NOT EXISTS search_pass_evidence_links (
      pass_id TEXT NOT NULL,
      version_sequence INTEGER NOT NULL,
      link_kind TEXT NOT NULL CHECK(link_kind IN ('participant', 'clue', 'track')),
      target_id TEXT NOT NULL,
      PRIMARY KEY (pass_id, version_sequence, link_kind, target_id),
      FOREIGN KEY (pass_id) REFERENCES search_passes(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS mission_events (
      id TEXT PRIMARY KEY,
      mission_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      details_json TEXT,
      recorded_at TEXT,
      recording_completeness TEXT CHECK(recording_completeness IN ('complete', 'legacy_baseline')),
      FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS mission_archives (
      id TEXT PRIMARY KEY,
      mission_id TEXT NOT NULL,
      request_event_rowid INTEGER NOT NULL CHECK(request_event_rowid > 0),
      request_event_id TEXT NOT NULL,
      creation_operation_id TEXT,
      protected_finalization_epoch INTEGER CHECK(
        protected_finalization_epoch IS NULL OR protected_finalization_epoch > 0
      ),
      archive_kind TEXT NOT NULL CHECK(archive_kind IN (
        'finalized', 'direct', 'finalized_recovery'
      )),
      container_version INTEGER NOT NULL CHECK(container_version IN (1, 2)),
      relative_path TEXT NOT NULL UNIQUE,
      ciphertext_sha256 TEXT CHECK(
        ciphertext_sha256 IS NULL
        OR (length(ciphertext_sha256) = 64 AND ciphertext_sha256 = lower(ciphertext_sha256))
      ),
      size_bytes INTEGER CHECK(size_bytes IS NULL OR size_bytes >= 0),
      created_at TEXT NOT NULL,
      sealed_event_id TEXT,
      frame_count INTEGER CHECK(frame_count IS NULL OR frame_count >= 2),
      header_sha256 TEXT CHECK(
        header_sha256 IS NULL
        OR (length(header_sha256) = 64 AND header_sha256 = lower(header_sha256))
      ),
      manifest_sha256 TEXT CHECK(
        manifest_sha256 IS NULL
        OR (length(manifest_sha256) = 64 AND manifest_sha256 = lower(manifest_sha256))
      ),
      entry_count INTEGER CHECK(entry_count IS NULL OR entry_count >= 4),
      table_count INTEGER CHECK(table_count IS NULL OR table_count > 0),
      verified_at TEXT,
      verification_proof_json TEXT,
      previous_archive_id TEXT,
      status TEXT NOT NULL CHECK(status IN (
        'sealed', 'verified', 'superseded'
      )),
      availability TEXT NOT NULL DEFAULT 'unknown' CHECK(availability IN (
        'unknown', 'present', 'missing', 'not_regular', 'mismatched', 'unreadable'
      )),
      availability_reason TEXT,
      last_reconciled_at TEXT,
      last_observed_file_identity TEXT,
      slots_json TEXT NOT NULL,
      last_non_machine_unwrap_at TEXT,
      legacy_event_rowid INTEGER UNIQUE,
      FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE RESTRICT,
      FOREIGN KEY (request_event_id) REFERENCES mission_events(id),
      FOREIGN KEY (sealed_event_id) REFERENCES mission_events(id),
      FOREIGN KEY (previous_archive_id) REFERENCES mission_archives(id),
      CHECK(container_version = 1 OR (
        ciphertext_sha256 IS NOT NULL AND size_bytes IS NOT NULL
        AND creation_operation_id IS NOT NULL
        AND frame_count IS NOT NULL AND header_sha256 IS NOT NULL
        AND manifest_sha256 IS NOT NULL AND entry_count IS NOT NULL
        AND table_count IS NOT NULL
      )),
      CHECK(status != 'verified' OR (verified_at IS NOT NULL AND verification_proof_json IS NOT NULL))
    );
    CREATE INDEX IF NOT EXISTS idx_mission_archives_custody
      ON mission_archives(mission_id, request_event_rowid DESC, created_at DESC, id DESC);
    CREATE TABLE IF NOT EXISTS mission_archive_supplements (
      id TEXT PRIMARY KEY,
      mission_id TEXT NOT NULL,
      archive_id TEXT NOT NULL UNIQUE,
      previous_archive_id TEXT NOT NULL,
      supplement_sequence INTEGER NOT NULL CHECK(supplement_sequence > 0),
      authority TEXT NOT NULL,
      reason TEXT NOT NULL,
      created_at TEXT NOT NULL,
      audit_event_id TEXT NOT NULL UNIQUE,
      FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE RESTRICT,
      FOREIGN KEY (archive_id) REFERENCES mission_archives(id) ON DELETE RESTRICT,
      FOREIGN KEY (previous_archive_id) REFERENCES mission_archives(id) ON DELETE RESTRICT,
      FOREIGN KEY (audit_event_id) REFERENCES mission_events(id),
      UNIQUE (mission_id, supplement_sequence),
      CHECK(archive_id != previous_archive_id)
    );
    CREATE TABLE IF NOT EXISTS mission_cleanup_journal (
      mission_id TEXT PRIMARY KEY,
      archive_id TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('eligible', 'in_progress', 'completed')),
      progress_json TEXT NOT NULL,
      started_at TEXT,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      last_error TEXT,
      FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE RESTRICT,
      FOREIGN KEY (archive_id) REFERENCES mission_archives(id) ON DELETE RESTRICT,
      CHECK((state = 'completed') = (completed_at IS NOT NULL))
    );
    CREATE TABLE IF NOT EXISTS mission_object_versions (
      id TEXT PRIMARY KEY,
      mission_id TEXT NOT NULL,
      object_type TEXT NOT NULL CHECK(object_type IN (
        'marker', 'drawing', 'outing', 'search_area', 'search_assignment', 'search_pass'
      )),
      object_id TEXT NOT NULL,
      version_sequence INTEGER NOT NULL,
      operation TEXT NOT NULL CHECK(operation IN (
        'created', 'updated', 'retired', 'legacy_baseline'
      )),
      effective_at TEXT NOT NULL,
      recorded_at TEXT NOT NULL,
      completeness TEXT NOT NULL CHECK(completeness IN ('complete', 'legacy_baseline')),
      state_json TEXT NOT NULL,
      actor TEXT,
      correlation_id TEXT,
      audit_event_id TEXT,
      FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE,
      FOREIGN KEY (audit_event_id) REFERENCES mission_events(id),
      UNIQUE (mission_id, object_type, object_id, version_sequence)
    );
    CREATE INDEX IF NOT EXISTS idx_mission_object_versions_replay
      ON mission_object_versions(mission_id, recorded_at, effective_at, object_type, object_id, version_sequence);
    CREATE TABLE IF NOT EXISTS legacy_mission_object_backfill_state (
      object_type TEXT PRIMARY KEY CHECK(object_type IN (
        'marker', 'drawing', 'outing', 'search_area', 'search_assignment', 'search_pass'
      )),
      scanned_through_id TEXT,
      scan_target_id TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS legacy_event_provenance_backfill_state (
      table_name TEXT PRIMARY KEY CHECK(table_name IN (
        'mission_events', 'mission_group_membership_events'
      )),
      scanned_through_id TEXT,
      scan_target_id TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS legacy_event_provenance_quarantine (
      table_name TEXT NOT NULL CHECK(table_name IN (
        'mission_events', 'mission_group_membership_events'
      )),
      source_rowid INTEGER NOT NULL,
      event_id_preview TEXT NOT NULL,
      reason TEXT NOT NULL,
      payload_bytes INTEGER NOT NULL CHECK(payload_bytes >= 0),
      detected_at TEXT NOT NULL,
      PRIMARY KEY (table_name, source_rowid)
    );
    CREATE TABLE IF NOT EXISTS legacy_event_provenance_quarantine_missions (
      mission_id TEXT NOT NULL,
      table_name TEXT NOT NULL CHECK(table_name IN (
        'mission_events', 'mission_group_membership_events'
      )),
      source_rowid INTEGER NOT NULL,
      PRIMARY KEY (mission_id, table_name, source_rowid)
    ) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS layer_catalog_entries (
      mission_id TEXT NOT NULL,
      node_id TEXT NOT NULL,
      parent_node_id TEXT,
      node_kind TEXT NOT NULL CHECK(node_kind IN ('group', 'layer', 'feature_item')),
      alias TEXT,
      is_favorite INTEGER NOT NULL DEFAULT 0,
      is_visible INTEGER NOT NULL DEFAULT 1,
      display_order INTEGER NOT NULL DEFAULT 0,
      metadata_json TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (mission_id, node_id),
      FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE
    );
  `)
    ensureColumnExists(db, 'markers', 'updated_by', 'TEXT')
    ensureColumnExists(db, 'markers', 'coordinator_ids', 'TEXT')
    ensureColumnExists(db, 'markers', 'attachment_path', 'TEXT')
    ensureColumnExists(db, 'markers', 'label_size', 'INTEGER')
    ensureColumnExists(db, 'markers', 'retired_at', 'TEXT')
    ensureColumnExists(db, 'markers', 'retired_by', 'TEXT')
    ensureColumnExists(db, 'drawings', 'retired_at', 'TEXT')
    ensureColumnExists(db, 'drawings', 'retired_by', 'TEXT')
    ensureColumnExists(db, 'gpx_track_imports', 'content_sha256', 'TEXT')
    ensureColumnExists(db, 'gpx_track_imports', 'source_bytes_base64', 'TEXT')
    ensureColumnExists(db, 'gpx_track_imports', 'timing_class', "TEXT NOT NULL DEFAULT 'undated'")
    ensureColumnExists(db, 'gpx_track_imports', 'outing_id', 'TEXT')
    ensureColumnExists(db, 'gpx_track_imports', 'import_state', "TEXT NOT NULL DEFAULT 'complete'")
    ensureColumnExists(db, 'gpx_track_imports', 'revision_sequence', 'INTEGER NOT NULL DEFAULT 1')
    ensureColumnExists(db, 'gpx_track_imports', 'retired_at', 'TEXT')
    ensureColumnExists(db, 'gpx_track_imports', 'retired_by', 'TEXT')
    ensureColumnExists(db, 'gpx_import_revisions', 'outing_id', 'TEXT')
    ensureColumnExists(db, 'gpx_import_revisions', 'import_state', "TEXT NOT NULL DEFAULT 'complete'")
    ensureColumnExists(
      db,
      'gpx_import_revisions',
      'source_revision_sequence',
      'INTEGER NOT NULL DEFAULT 1 CHECK(source_revision_sequence >= 1)',
    )
    if (gpxSourceRevisionRequiresBackfill) {
      db.exec(`UPDATE gpx_import_revisions
        SET source_revision_sequence = revision_sequence;`)
    }
    if (existingSchemaVersion === 0) {
      db.exec(`CREATE INDEX IF NOT EXISTS idx_mission_events_replay
        ON mission_events(mission_id, timestamp, event_type, id);`)
    }
    ensureColumnExists(db, 'gpx_import_failures', 'rejection_count', 'INTEGER NOT NULL DEFAULT 0')
    ensureColumnExists(db, 'gpx_import_failures', 'rejections_json', "TEXT NOT NULL DEFAULT '[]'")
    db.exec(`CREATE INDEX IF NOT EXISTS idx_gpx_import_content
      ON gpx_track_imports(mission_id, content_sha256, retired_at);`)
    ensureColumnExists(db, 'positions', 'source_position_id', 'TEXT')
    ensureColumnExists(db, 'positions', 'received_at', 'TEXT')
    ensureColumnExists(db, 'positions', 'content_hash', 'TEXT')
    ensureColumnExists(db, 'positions', 'source_kind', 'TEXT')
    ensureColumnExists(
      db,
      'positions',
      "timestamp_source",
      "TEXT CHECK(timestamp_source IS NULL OR timestamp_source = 'fix')",
    )
    ensureColumnExists(db, 'positions', 'timestamp_provenance_recorded_at', 'TEXT')
    ensureColumnExists(db, 'devices', 'group_id', 'TEXT')
    ensureColumnExists(db, 'devices', 'unique_id', 'TEXT')
    // Candidate-v9 stores may contain the rejected global positions index.
    // Dropping it is metadata-only and restores the bounded startup contract.
    db.exec('DROP INDEX IF EXISTS idx_positions_mission_timestamp;')
    ensureColumnExists(db, 'mission_group_membership_events', 'sequence', 'INTEGER')
    ensureColumnExists(db, 'mission_group_membership_events', 'recorded_at', 'TEXT')
    ensureColumnExists(db, 'mission_group_membership_events', 'recording_completeness', 'TEXT')
    ensureColumnExists(db, 'mission_events', 'recorded_at', 'TEXT')
    ensureColumnExists(db, 'mission_events', 'recording_completeness', 'TEXT')
    initializeLegacyEventProvenanceBackfill(
      db,
      migrationTime,
      eventProvenanceRequiresBackfill,
    )
    ensureColumnExists(db, 'ingest_anomalies', 'first_seen_at', 'TEXT')
    ensureColumnExists(db, 'ingest_anomalies', 'last_seen_at', 'TEXT')
    ensureColumnExists(db, 'ingest_anomalies', 'occurrence_count', 'INTEGER NOT NULL DEFAULT 1')
    db.exec(`
      UPDATE ingest_anomalies
      SET first_seen_at = COALESCE(first_seen_at, received_at, created_at),
          last_seen_at = COALESCE(last_seen_at, received_at, created_at)
      WHERE first_seen_at IS NULL OR last_seen_at IS NULL;
    `)
    ensureMissionScopedAnomalyDeliveries(db)
    if (anomalySummaryRequiresBackfill) {
      backfillIngestAnomalyHealth(db)
    }
    if (participantsRequireGrandfathering) {
      backfillGrandfatheredParticipants(db)
    }
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_positions_mission_source_position_id
      ON positions(mission_id, source_position_id)
      WHERE source_position_id IS NOT NULL;
    `)

    backfillLegacySearchAreas(db, migrationTime)
    recoverInterruptedDirectArchiveFences(db, migrationTime)
    initializeLegacyMissionObjectVersionBackfill(
      db,
      migrationTime,
      existingSchemaVersion < MISSION_EVIDENCE_VERSION_SCHEMA,
    )
    recoverStagingGpxImports(db, migrationTime)
    if (positionsRequireProvenanceBackfill && existingSchemaVersion !== 0
      && tableExists(db, 'mission_replay_position_day_counts')) {
      db.exec(`
        DROP TRIGGER IF EXISTS positions_replay_day_count_insert;
        DROP TRIGGER IF EXISTS positions_replay_day_count_update;
        DROP TRIGGER IF EXISTS positions_replay_day_count_delete;
        DROP TABLE mission_replay_position_day_counts;
      `)
    }
    db.exec(`
      CREATE TABLE IF NOT EXISTS mission_replay_position_day_counts (
        mission_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        known_day TEXT NOT NULL,
        position_count INTEGER NOT NULL CHECK(position_count >= 0),
        PRIMARY KEY (mission_id, device_id, known_day),
        FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE
      );
    `)
    if (existingSchemaVersion === 0) {
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_positions_replay_known_fix
          ON positions(mission_id, received_at, timestamp_provenance_recorded_at, timestamp, id)
          WHERE timestamp_source = 'fix';
        CREATE INDEX IF NOT EXISTS idx_positions_replay_unknown_time
          ON positions(mission_id)
          WHERE timestamp_source IS NULL;
        CREATE INDEX IF NOT EXISTS idx_positions_replay_known_at
          ON positions(
            mission_id,
            MAX(timestamp, received_at, COALESCE(timestamp_provenance_recorded_at, received_at))
          )
          WHERE timestamp_source = 'fix' AND received_at IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_positions_replay_device_known_at
          ON positions(
            mission_id,
            device_id,
            MAX(timestamp, received_at, COALESCE(timestamp_provenance_recorded_at, received_at))
          )
          WHERE timestamp_source = 'fix' AND received_at IS NOT NULL;
        CREATE TRIGGER IF NOT EXISTS positions_replay_day_count_insert
        AFTER INSERT ON positions
        WHEN NEW.timestamp_source = 'fix' AND NEW.received_at IS NOT NULL
        BEGIN
          INSERT INTO mission_replay_position_day_counts (
            mission_id, device_id, known_day, position_count
          ) VALUES (
            NEW.mission_id,
            NEW.device_id,
            substr(MAX(NEW.timestamp, NEW.received_at,
              COALESCE(NEW.timestamp_provenance_recorded_at, NEW.received_at)), 1, 10),
            1
          ) ON CONFLICT(mission_id, device_id, known_day)
          DO UPDATE SET position_count = position_count + 1;
        END;
        CREATE TRIGGER IF NOT EXISTS positions_replay_day_count_update
        AFTER UPDATE OF mission_id, device_id, timestamp, received_at,
          timestamp_source, timestamp_provenance_recorded_at ON positions
        BEGIN
          UPDATE mission_replay_position_day_counts
          SET position_count = position_count - 1
          WHERE OLD.timestamp_source = 'fix' AND OLD.received_at IS NOT NULL
            AND mission_id = OLD.mission_id AND device_id = OLD.device_id
            AND known_day = substr(MAX(OLD.timestamp, OLD.received_at,
              COALESCE(OLD.timestamp_provenance_recorded_at, OLD.received_at)), 1, 10);
          INSERT INTO mission_replay_position_day_counts (
            mission_id, device_id, known_day, position_count
          ) SELECT
            NEW.mission_id,
            NEW.device_id,
            substr(MAX(NEW.timestamp, NEW.received_at,
              COALESCE(NEW.timestamp_provenance_recorded_at, NEW.received_at)), 1, 10),
            1
          WHERE NEW.timestamp_source = 'fix' AND NEW.received_at IS NOT NULL
          ON CONFLICT(mission_id, device_id, known_day)
          DO UPDATE SET position_count = position_count + 1;
        END;
        CREATE TRIGGER IF NOT EXISTS positions_replay_day_count_delete
        AFTER DELETE ON positions
        WHEN OLD.timestamp_source = 'fix' AND OLD.received_at IS NOT NULL
        BEGIN
          UPDATE mission_replay_position_day_counts
          SET position_count = position_count - 1
          WHERE mission_id = OLD.mission_id AND device_id = OLD.device_id
            AND known_day = substr(MAX(OLD.timestamp, OLD.received_at,
              COALESCE(OLD.timestamp_provenance_recorded_at, OLD.received_at)), 1, 10);
        END;
      `)
    }
    db.prepare(`UPDATE gpx_import_batches
      SET status = CASE WHEN failed_files > 0 THEN 'completed_with_failures' ELSE 'completed' END,
        updated_at = ?, finished_at = ?
      WHERE status = 'running'
        AND completed_files + failed_files = total_files
        AND NOT EXISTS (
          SELECT 1 FROM gpx_import_source_receipts AS receipts
          WHERE receipts.batch_id = gpx_import_batches.id
            AND receipts.status IN ('pending', 'retained')
        )`).run(migrationTime, migrationTime)
    db.prepare(`UPDATE gpx_import_batches
      SET status = 'interrupted', updated_at = ?, finished_at = ?
      WHERE status = 'running'`).run(migrationTime, migrationTime)

    db.prepare(`INSERT OR IGNORE INTO legacy_gpx_backfill_state (
      singleton, scanned_through_rowid, scan_target_rowid, updated_at
    ) VALUES (1, 0, COALESCE((SELECT rowid FROM gpx_track_imports
      WHERE rowid BETWEEN 1 AND 9007199254740991
      ORDER BY rowid DESC LIMIT 1), 0), '1970-01-01T00:00:00.000Z')`).run()
    db.prepare(`UPDATE legacy_gpx_backfill_state
      SET scan_target_rowid = COALESCE((SELECT rowid FROM gpx_track_imports
          WHERE rowid BETWEEN 1 AND 9007199254740991
          ORDER BY rowid DESC LIMIT 1), 0),
        scanned_through_rowid = MIN(scanned_through_rowid,
          COALESCE((SELECT rowid FROM gpx_track_imports
            WHERE rowid BETWEEN 1 AND 9007199254740991
            ORDER BY rowid DESC LIMIT 1), 0)),
        updated_at = ?
      WHERE singleton = 1 AND (
        scan_target_rowid != COALESCE((SELECT rowid FROM gpx_track_imports
          WHERE rowid BETWEEN 1 AND 9007199254740991
          ORDER BY rowid DESC LIMIT 1), 0)
        OR scanned_through_rowid > COALESCE((SELECT rowid FROM gpx_track_imports
          WHERE rowid BETWEEN 1 AND 9007199254740991
          ORDER BY rowid DESC LIMIT 1), 0)
      )`).run(migrationTime)
    db.prepare(`INSERT OR IGNORE INTO legacy_gpx_rowid_scan_state (
      singleton, low_scanned_through_rowid, low_target_rowid,
      high_scanned_through_rowid, high_target_rowid, updated_at
    ) VALUES (1, 1,
      COALESCE((SELECT rowid FROM gpx_track_imports WHERE rowid < 1
        ORDER BY rowid ASC LIMIT 1), 1),
      9007199254740991,
      COALESCE((SELECT rowid FROM gpx_track_imports WHERE rowid > 9007199254740991
        ORDER BY rowid DESC LIMIT 1), 9007199254740991),
      '1970-01-01T00:00:00.000Z')`).run()
    db.prepare(`UPDATE legacy_gpx_rowid_scan_state SET
      low_target_rowid = MIN(low_target_rowid, COALESCE((SELECT rowid
        FROM gpx_track_imports WHERE rowid < 1 ORDER BY rowid ASC LIMIT 1), 1)),
      high_target_rowid = MAX(high_target_rowid, COALESCE((SELECT rowid
        FROM gpx_track_imports WHERE rowid > 9007199254740991
        ORDER BY rowid DESC LIMIT 1), 9007199254740991)),
      updated_at = ? WHERE singleton = 1 AND (
        low_target_rowid > COALESCE((SELECT rowid FROM gpx_track_imports
          WHERE rowid < 1 ORDER BY rowid ASC LIMIT 1), 1)
        OR high_target_rowid < COALESCE((SELECT rowid FROM gpx_track_imports
          WHERE rowid > 9007199254740991 ORDER BY rowid DESC LIMIT 1),
          9007199254740991)
      )`).run(migrationTime)

    db.prepare("INSERT INTO metadata (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(String(CURRENT_SCHEMA_VERSION))
  })
  applyMigrations()
  const legacyGpxBackfill = backfillLegacyGpxRevisions(db, migrationTime, 3, false)
  return {
    legacyGpxBackfillRemaining: legacyGpxBackfill.remaining,
    legacyMissionObjectBackfillRemaining: readLegacyMissionObjectBackfillPending(db),
    legacyEventProvenanceBackfillRemaining: readLegacyEventProvenanceBackfillPending(db),
    gpxReceiptRecoveryRemaining: readUnsettledGpxImportReceiptPending(db),
    legacyArchiveRegistryBackfillRemaining: readLegacyArchiveRegistryBackfillPending(db),
  }
}

/** Returns true when an archive-review restore worker has been cancelled. */
function archiveReviewMigrationCancelled(cancellationFlag) {
  return cancellationFlag instanceof Int32Array
    && cancellationFlag.length === 1
    && Atomics.load(cancellationFlag, 0) !== 0
}

/** Stops a scratch-only archive migration without weakening its cleanup boundary. */
function assertArchiveReviewMigrationActive(cancellationFlag) {
  if (!archiveReviewMigrationCancelled(cancellationFlag)) return
  const error = new Error('Archive review migration was cancelled.')
  error.name = 'AbortError'
  error.code = 'ARCHIVE_CANCELLED'
  throw error
}

/**
 * Migrates only a restored archive scratch database to the current read schema.
 * Unlike createElectronMissionStore this starts no timers, custody recovery, or
 * live-store workers. All captured evidence backfills are exhausted synchronously
 * in the caller's restore worker before the read-only session can become visible.
 */
function migrateMissionStoreForArchiveReview(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)
    || typeof input.databasePath !== 'string'
    || !path.isAbsolute(input.databasePath)
    || path.resolve(input.databasePath) !== input.databasePath
    || typeof input.archiveDirectory !== 'string'
    || !path.isAbsolute(input.archiveDirectory)
    || path.resolve(input.archiveDirectory) !== input.archiveDirectory
    || (input.cancellationFlag !== undefined
      && (!(input.cancellationFlag instanceof Int32Array)
        || input.cancellationFlag.length !== 1))
    || (input.onProgress !== undefined && typeof input.onProgress !== 'function')) {
    throw new Error('Archive review scratch migration request is invalid.')
  }
  assertArchiveReviewMigrationActive(input.cancellationFlag)
  const db = new Database(input.databasePath, { fileMustExist: true })
  let completedPages = 0
  const migrationTime = now()
  const reportProgress = (detail) => {
    completedPages += 1
    input.onProgress?.(Object.freeze({ completedPages, detail }))
  }
  try {
    const storedVersion = readStoredSchemaVersion(db)
    if (!Number.isSafeInteger(storedVersion)
      || storedVersion < 1
      || storedVersion > CURRENT_SCHEMA_VERSION) {
      throw new Error('Archive review scratch database schema is unsupported.')
    }
    db.pragma('journal_mode = WAL')
    db.pragma('synchronous = FULL')
    db.pragma('foreign_keys = ON')
    const migrationState = migrate(db, input.archiveDirectory)
    reportProgress('database-schema-migrated')

    while (migrationState.legacyEventProvenanceBackfillRemaining > 0) {
      assertArchiveReviewMigrationActive(input.cancellationFlag)
      migrationState.legacyEventProvenanceBackfillRemaining =
        backfillLegacyEventProvenance(db, migrationTime).remaining
      reportProgress('database-events-prepared')
    }
    while (migrationState.legacyMissionObjectBackfillRemaining > 0) {
      assertArchiveReviewMigrationActive(input.cancellationFlag)
      migrationState.legacyMissionObjectBackfillRemaining =
        backfillLegacyMissionObjectVersions(db, migrationTime).remaining
      reportProgress('database-objects-prepared')
    }
    while (migrationState.legacyGpxBackfillRemaining > 0) {
      assertArchiveReviewMigrationActive(input.cancellationFlag)
      migrationState.legacyGpxBackfillRemaining =
        backfillLegacyGpxRevisions(db, migrationTime).remaining
      reportProgress('database-gpx-prepared')
    }
    assertArchiveReviewMigrationActive(input.cancellationFlag)
    const integrityRows = db.pragma('integrity_check')
    if (!Array.isArray(integrityRows)
      || integrityRows.length !== 1
      || integrityRows[0]?.integrity_check !== 'ok'
      || readStoredSchemaVersion(db) !== CURRENT_SCHEMA_VERSION) {
      throw new Error('Archive review scratch database migration did not verify.')
    }
    db.pragma('wal_checkpoint(TRUNCATE)')
    db.pragma('journal_mode = DELETE')
    reportProgress('database-migration-verified')
    return Object.freeze({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      completedPages,
    })
  } finally {
    db.close()
  }
}

/** Returns whether one named schema table already exists. */
function tableExists(db, tableName) {
  return db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
  ).get(tableName) !== undefined
}

/** Returns whether one named table column is already present. */
function columnExists(db, tableName, columnName) {
  return db.prepare(`PRAGMA table_info(${tableName})`).all()
    .some((column) => column.name === columnName)
}

/** Retains interrupted staged GPX bytes as explicit failures before removing partial rows. */
function recoverStagingGpxImports(db, migrationTime) {
  const staged = db.prepare(`SELECT revisions.*, imports.import_state AS projection_state
    FROM gpx_import_revisions AS revisions
    JOIN gpx_track_imports AS imports ON imports.id = revisions.import_id
    WHERE revisions.import_state = 'staging'
    ORDER BY revisions.mission_id, revisions.import_id, revisions.revision_sequence`).all()
  const byMission = new Map()
  for (const revision of staged) {
    const values = byMission.get(revision.mission_id) ?? []
    values.push(revision)
    byMission.set(revision.mission_id, values)
  }
  for (const [missionId, revisions] of byMission) {
    const missingFailures = revisions.filter((revision) => db.prepare(`SELECT 1
      FROM gpx_import_failures WHERE mission_id = ? AND source_path = ? LIMIT 1`)
      .get(missionId, revision.source_path) === undefined)
    const batchId = missingFailures.length === 0 ? null : randomUUID()
    if (batchId !== null) {
      db.prepare(`INSERT INTO gpx_import_batches (
        id, mission_id, status, total_files, completed_files, failed_files,
        started_at, updated_at, finished_at
      ) VALUES (?, ?, 'interrupted', ?, 0, ?, ?, ?, ?)`).run(
        batchId, missionId, missingFailures.length, missingFailures.length,
        migrationTime, migrationTime, migrationTime,
      )
    }
    for (const revision of revisions) {
      if (batchId !== null && missingFailures.includes(revision)) {
        db.prepare(`INSERT INTO gpx_import_failures (
          id, batch_id, mission_id, source_path, file_name, content_sha256,
          source_bytes_base64, reason, recorded_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          randomUUID(), batchId, missionId, revision.source_path, revision.file_name,
          revision.content_sha256, revision.source_bytes_base64,
          'GPX import was interrupted before its staged evidence could be published.',
          migrationTime,
        )
      }
      db.prepare(`DELETE FROM gpx_import_revisions
        WHERE import_id = ? AND revision_sequence = ?`)
        .run(revision.import_id, revision.revision_sequence)
      if (revision.projection_state === 'staging') {
        db.prepare(`DELETE FROM gpx_track_imports WHERE id = ? AND import_state = 'staging'`)
          .run(revision.import_id)
      }
    }
  }
}

/** Converts one bounded receipt page into explicit failure or exact-settlement evidence. */
function recoverUnsettledGpxImportReceipts(
  db,
  migrationTime,
  maximumRows = MAX_GPX_RECEIPT_RECOVERY_ROWS_PER_TURN,
  faultInjection = {},
) {
  const rowLimit = Math.max(1, Math.min(MAX_GPX_RECEIPT_RECOVERY_ROWS_PER_TURN, maximumRows))
  const transaction = db.transaction(() => {
    const candidates = db.prepare(`SELECT batch_id, mission_id, source_path, file_name,
      status, content_sha256, created_at, updated_at,
      COALESCE(length(CAST(source_bytes_base64 AS BLOB)), 0) AS retained_base64_bytes
    FROM gpx_import_source_receipts
    WHERE status IN ('pending', 'retained')
    ORDER BY mission_id, batch_id, source_path
    LIMIT ?`).all(rowLimit)
    const receipts = []
    let remainingBytes = MAX_GPX_RECEIPT_RECOVERY_BYTES_PER_TURN
    for (const candidate of candidates) {
      const candidateBytes = Number(candidate.retained_base64_bytes)
      if (receipts.length > 0 && candidateBytes > remainingBytes) break
      receipts.push(db.prepare(`SELECT * FROM gpx_import_source_receipts
        WHERE batch_id = ? AND source_path = ?`).get(candidate.batch_id, candidate.source_path))
      remainingBytes = Math.max(0, remainingBytes - Math.min(candidateBytes, remainingBytes))
      if (remainingBytes === 0) break
    }
    const batchIds = new Set()
    const interruptedBatchIds = new Set()
    for (const receipt of receipts) {
      batchIds.add(receipt.batch_id)
      const publicationCandidate = receipt.status === 'retained'
        ? db.prepare(`SELECT revisions.content_sha256, revisions.source_bytes_base64
          FROM gpx_import_revisions AS revisions
          JOIN gpx_track_imports AS imports
            ON imports.id = revisions.import_id
            AND imports.revision_sequence = revisions.revision_sequence
          LEFT JOIN gpx_import_aliases AS aliases
            ON aliases.mission_id = revisions.mission_id
            AND aliases.import_id = revisions.import_id
            AND aliases.source_path = ?
          WHERE revisions.mission_id = ? AND revisions.content_sha256 = ?
            AND revisions.import_state = 'complete'
            AND revisions.completeness = 'complete'
            AND revisions.source_bytes_base64 IS NOT NULL
            AND imports.import_state = 'complete' AND imports.retired_at IS NULL
            AND (revisions.source_path = ? OR aliases.source_path IS NOT NULL)
          LIMIT 1`)
          .get(
            receipt.source_path,
            receipt.mission_id,
            receipt.content_sha256,
            receipt.source_path,
          )
        : undefined
      if (isExactGpxPublicationCandidate(publicationCandidate, receipt.content_sha256)) {
        settleGpxImportSourceReceiptWithinTransaction(db, {
          batchId: receipt.batch_id,
          missionId: receipt.mission_id,
          sourcePath: receipt.source_path,
        }, migrationTime)
        if (faultInjection.afterReceiptSettlement === true) {
          throw new Error('Injected failure after GPX receipt settlement.')
        }
        continue
      }
      interruptedBatchIds.add(receipt.batch_id)
      const existing = db.prepare(`SELECT 1 FROM gpx_import_failures
        WHERE batch_id = ? AND source_path = ? LIMIT 1`).get(receipt.batch_id, receipt.source_path)
      if (existing === undefined) {
        const reason = receipt.status === 'retained'
          ? 'GPX import was interrupted after source bytes were retained but before evidence was published.'
          : 'GPX import was interrupted before source bytes were retained.'
        db.prepare(`INSERT INTO gpx_import_failures (
          id, batch_id, mission_id, source_path, file_name, content_sha256,
          source_bytes_base64, reason, recorded_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          randomUUID(), receipt.batch_id, receipt.mission_id, receipt.source_path,
          receipt.file_name, receipt.content_sha256, receipt.source_bytes_base64,
          reason, migrationTime,
        )
      }
      db.prepare(`UPDATE gpx_import_source_receipts
        SET status = 'failed', updated_at = ? WHERE batch_id = ? AND source_path = ?`)
        .run(migrationTime, receipt.batch_id, receipt.source_path)
    }
    for (const batchId of batchIds) {
      const counts = db.prepare(`SELECT
        (SELECT COUNT(*) FROM gpx_import_source_receipts
          WHERE batch_id = ? AND status = 'settled') AS completed_files,
        (SELECT COUNT(*) FROM gpx_import_failures WHERE batch_id = ?) AS failed_files,
        (SELECT total_files FROM gpx_import_batches WHERE id = ?) AS total_files`)
        .get(batchId, batchId, batchId)
      const completed = Number(counts?.completed_files ?? 0)
      const failed = Number(counts?.failed_files ?? 0)
      const total = Number(counts?.total_files ?? 0)
      const fullyAccounted = completed + failed === total
      const status = interruptedBatchIds.has(batchId) || !fullyAccounted || failed > 0
        ? 'interrupted'
        : 'completed'
      db.prepare(`UPDATE gpx_import_batches
        SET status = ?, completed_files = ?, failed_files = ?,
            updated_at = ?, finished_at = ?
        WHERE id = ?`).run(status, completed, failed, migrationTime, migrationTime, batchId)
    }
    return { remaining: readUnsettledGpxImportReceiptPending(db) }
  })
  return transaction.immediate()
}

/** Returns one when startup still owns interrupted GPX receipts. */
function readUnsettledGpxImportReceiptPending(db) {
  return db.prepare(`SELECT 1 FROM gpx_import_source_receipts
    WHERE status IN ('pending', 'retained') LIMIT 1`).get() === undefined ? 0 : 1
}

/** Verifies that restart reconciliation points to exact retained bytes, not metadata alone. */
function isExactGpxPublicationCandidate(candidate, expectedHash) {
  if (
    candidate === undefined ||
    typeof candidate.content_sha256 !== 'string' ||
    typeof candidate.source_bytes_base64 !== 'string'
  ) {
    return false
  }
  try {
    return normalizeGpxContentHash(
      candidate.content_sha256,
      candidate.source_bytes_base64,
    ) === expectedHash
  } catch {
    return false
  }
}

/** Backfills candidate-v8 anomaly summaries once; field v7 stores have no rows. */
function backfillIngestAnomalyHealth(db) {
  db.exec(`
    INSERT INTO ingest_anomaly_devices (
      mission_id, device_id, conflict_count, rejected_count
    )
    SELECT mission_id, device_id,
      SUM(CASE WHEN kind = 'conflict' THEN 1 ELSE 0 END),
      SUM(CASE WHEN kind = 'rejected' THEN 1 ELSE 0 END)
    FROM ingest_anomalies
    WHERE device_id IS NOT NULL
    GROUP BY mission_id, device_id;

    INSERT INTO ingest_anomaly_mission_health (
      mission_id, conflict_count, rejected_count, affected_device_count
    )
    SELECT anomaly.mission_id,
      SUM(CASE WHEN anomaly.kind = 'conflict' THEN 1 ELSE 0 END),
      SUM(CASE WHEN anomaly.kind = 'rejected' THEN 1 ELSE 0 END),
      COUNT(DISTINCT anomaly.device_id)
    FROM ingest_anomalies AS anomaly
    GROUP BY anomaly.mission_id;
  `)
}

/**
 * Grandfathers every pre-v9 mission device, including finalized missions,
 * without rewriting any source evidence or inventing outing boundaries.
 */
function backfillGrandfatheredParticipants(db) {
  const migratedAt = new Date().toISOString()
  const rows = db.prepare(`SELECT device.mission_id, device.device_id, mission.start_time
    FROM devices AS device
    INNER JOIN missions AS mission ON mission.id = device.mission_id
    ORDER BY device.mission_id ASC, device.device_id ASC`).all()
  const insert = db.prepare(`INSERT INTO mission_participants (
      id, mission_id, kind, traccar_device_id, mission_team_id, provenance,
      effective_from, added_at, added_by, removed_at, removed_by
    ) VALUES (?, ?, 'device', ?, NULL, 'grandfathered', ?, ?, NULL, NULL, NULL)`)
  for (const row of rows) {
    insert.run(randomUUID(), row.mission_id, row.device_id, row.start_time, migratedAt)
  }
}

/** Rebuilds the small delivery-dedup table with mission-scoped identity. */
function ensureMissionScopedAnomalyDeliveries(db) {
  const primaryKeyColumns = db.prepare(
    'PRAGMA table_info(ingest_anomaly_deliveries)',
  ).all()
    .filter((column) => column.pk > 0)
    .sort((left, right) => left.pk - right.pk)
    .map((column) => column.name)
  if (
    primaryKeyColumns.length === 2 &&
    primaryKeyColumns[0] === 'mission_id' &&
    primaryKeyColumns[1] === 'delivery_id'
  ) {
    return
  }
  db.exec(`
    CREATE TABLE ingest_anomaly_deliveries_v8_scoped (
      delivery_id TEXT NOT NULL,
      mission_id TEXT NOT NULL,
      projected_at TEXT NOT NULL,
      PRIMARY KEY (mission_id, delivery_id),
      FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE
    );
    INSERT INTO ingest_anomaly_deliveries_v8_scoped (
      delivery_id, mission_id, projected_at
    ) SELECT delivery_id, mission_id, projected_at
      FROM ingest_anomaly_deliveries;
    DROP TABLE ingest_anomaly_deliveries;
    ALTER TABLE ingest_anomaly_deliveries_v8_scoped
      RENAME TO ingest_anomaly_deliveries;
  `)
}

function schemaVersion(db) {
  return readStoredSchemaVersion(db) || CURRENT_SCHEMA_VERSION
}

function readStoredSchemaVersion(db) {
  const row = db.prepare("SELECT value FROM metadata WHERE key = 'schema_version'").get()
  const value = Number(row?.value ?? 0)
  return Number.isFinite(value) ? value : 0
}

function ensureColumnExists(db, tableName, columnName, columnSql) {
  const existingColumns = db.prepare(`PRAGMA table_info(${tableName})`).all()
  if (existingColumns.some((column) => column.name === columnName)) {
    return
  }

  db.prepare(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnSql}`).run()
}

/** Promotes legacy search-area drawings to stable identities without inventing assignments or passes. */
function backfillLegacySearchAreas(db, migrationTime) {
  db.prepare(`INSERT INTO search_areas (
    id, mission_id, name, status, geometry_json, legacy_drawing_id,
    version_sequence, updated_by, created_at, updated_at, retired_at
  )
  SELECT drawings.id, drawings.mission_id, drawings.name,
    CASE WHEN drawings.retired_at IS NULL THEN 'active' ELSE 'retired' END,
    drawings.geometry_json, drawings.id, 1, NULL,
    drawings.created_at, ?, drawings.retired_at
  FROM drawings
  WHERE drawings.type = 'search_area'
    AND NOT EXISTS (
      SELECT 1 FROM search_areas WHERE search_areas.legacy_drawing_id = drawings.id
    )`).run(migrationTime)
}

/**
 * Delivers bounded renderer-originated rejection envelopes without throwing
 * their persistence failure through the current-position publication path.
 */
async function recordIngestRejections(db, outbox, input) {
  const rejections = Array.isArray(input?.rejections) ? input.rejections : []
  if (typeof input?.mission_id !== 'string' || input.mission_id.trim() === '') {
    throw new Error('Rejected-position evidence requires an active mission identity.')
  }
  if (rejections.length > 256) {
    throw new Error('Rejected-position evidence batch exceeds the bounded delivery hypothesis.')
  }
  const acknowledgedDeliveryIds = []
  for (const rejection of rejections) {
    const envelope = {
      ...rejection,
      missionId: input.mission_id,
    }
    try {
      await outbox.deliver(envelope)
      acknowledgedDeliveryIds.push(rejection.deliveryId)
    } catch {
      // The outbox retains a staged record when possible. Failure class is
      // returned below; anomaly content is deliberately never logged here.
    }
  }
  return {
    acknowledgedDeliveryIds,
    health: await getIngestEvidenceHealth(db, outbox, input.mission_id),
  }
}

/** Combines durable ledger counts with outbox health, excluding evidence content. */
async function getIngestEvidenceHealth(db, outbox, missionId) {
  const health = {
    ...(await mapIngestEvidenceHealth(outbox, missionId)),
    ...summarizeIngestAnomalies(db, missionId),
  }
  if (missionId === undefined || missionId === null) return health
  const acknowledgement = readEvidenceLossAcknowledgement(db, missionId)
  if (acknowledgement === null) return health
  try {
    const candidate = await outbox.readEvidenceLossAcknowledgementCandidate(missionId)
    if (candidate.token !== acknowledgement.lossToken) return health
  } catch {
    return health
  }
  return {
    ...health,
    acknowledgedLoss: {
      adminName: acknowledgement.adminName,
      reason: acknowledgement.reason,
      acknowledgedAt: acknowledgement.acknowledgedAt,
    },
  }
}

/** Persists a bounded marker when renderer memory can no longer retain unique evidence. */
async function recordIngestEvidenceLoss(db, outbox, input) {
  const missionId = typeof input?.mission_id === 'string' ? input.mission_id.trim() : ''
  if (missionId === '') {
    throw new Error('Ingest evidence loss requires a mission identity.')
  }
  if (![
    'mission_persistence_failed',
    'renderer_pending_capacity_exhausted',
    'renderer_pending_evidence_lost',
  ].includes(input?.reason)) {
    throw new Error('Ingest evidence-loss reason is invalid.')
  }
  const mission = getMission(db, missionId)
  if (
    input?.scope_reason !== undefined &&
    input.scope_reason !== rendererEvidenceScopeReason(mission.status)
  ) {
    throw new Error('Renderer evidence-loss mission scope reason does not match mission state.')
  }
  await outbox.markEvidenceLoss(missionId, input.reason)
  return getIngestEvidenceHealth(db, outbox, missionId)
}

/** Stages or resolves one exact soft-deadline renderer evidence incident. */
async function updateRendererEvidenceUncertainty(db, outbox, input, operation) {
  const missionId = typeof input?.mission_id === 'string' ? input.mission_id.trim() : ''
  const incidentId = typeof input?.incident_id === 'string' ? input.incident_id.trim() : ''
  if (missionId === '' || incidentId === '') {
    throw new Error('Renderer evidence uncertainty requires mission and incident identities.')
  }
  const mission = getMission(db, missionId)
  const expectedScopeReason = rendererEvidenceScopeReason(mission.status)
  if (expectedScopeReason === null) {
    throw new Error('Finalized missions cannot receive renderer evidence uncertainty.')
  }
  if (operation === 'stage') {
    if (input.scope_reason !== expectedScopeReason) {
      throw new Error('Renderer evidence uncertainty scope reason does not match mission state.')
    }
    await outbox.stageRendererEvidenceUncertainty(
      missionId,
      incidentId,
      input.scope_reason,
      (queuedScopes) => assertRendererEvidenceScopesStillOpen(db, queuedScopes),
    )
  } else {
    await outbox.resolveRendererEvidenceUncertainty(
      missionId,
      incidentId,
      input.outcome,
    )
  }
  return getIngestEvidenceHealth(db, outbox, missionId)
}

/** Validates every mission scope before the outbox commits one durable incident. */
async function stageRendererEvidenceIncident(db, outbox, input) {
  const incidentId = typeof input?.incident_id === 'string' ? input.incident_id.trim() : ''
  if (incidentId === '' || !Array.isArray(input?.scopes) || input.scopes.length === 0) {
    throw new Error('Renderer evidence incident requires an identity and mission scopes.')
  }
  const scopes = input.scopes.map((scope) => {
    const missionId = typeof scope?.mission_id === 'string' ? scope.mission_id.trim() : ''
    if (missionId === '') {
      throw new Error('Renderer evidence incident mission scope is invalid.')
    }
    const mission = getMission(db, missionId)
    const expectedScopeReason = rendererEvidenceScopeReason(mission.status)
    if (expectedScopeReason === null || scope.scope_reason !== expectedScopeReason) {
      throw new Error('Renderer evidence incident scope reason does not match mission state.')
    }
    return { missionId, scopeReason: expectedScopeReason }
  })
  await outbox.stageRendererEvidenceIncident(
    scopes,
    incidentId,
    (queuedScopes) => assertRendererEvidenceScopesStillOpen(db, queuedScopes),
  )
  return { staged_scope_count: scopes.length }
}

/** Rechecks mutable mission ownership while the outbox finalization fence is held. */
function assertRendererEvidenceScopesStillOpen(db, scopes) {
  for (const scope of scopes) {
    const mission = getMission(db, scope.missionId)
    if (rendererEvidenceScopeReason(mission.status) !== scope.scopeReason) {
      throw new Error('Renderer evidence scope reason does not match mission state.')
    }
  }
}

/** Resolves one or all durable renderer incidents without re-reading mutable mission state. */
async function resolveRendererEvidenceIncidents(outbox, input) {
  if (!['drained', 'lost'].includes(input?.outcome)) {
    throw new Error('Renderer evidence incident outcome is invalid.')
  }
  let incidentId = null
  if (input?.incident_id !== undefined) {
    if (typeof input.incident_id !== 'string' || input.incident_id.trim() === '') {
      throw new Error('Renderer evidence incident identity is invalid.')
    }
    incidentId = input.incident_id.trim()
  }
  const resolvedScopes = await outbox.resolveRendererEvidenceIncidents(
    incidentId,
    input.outcome,
  )
  return {
    resolved_scopes: resolvedScopes.map((scope) => ({
      mission_id: scope.missionId,
      scope_reason: scope.scopeReason,
    })),
  }
}

/** Names the bounded reason one non-finalized mission can own renderer evidence. */
function rendererEvidenceScopeReason(status) {
  if (status === 'active') return 'active_mission'
  if (status === 'paused') return 'paused_recoverable_mission'
  if (status === 'finished') return 'finished_unfinalized_mission'
  return null
}

/** Records an authorized, permanent acceptance of one exact known evidence gap. */
async function acknowledgeIngestEvidenceLoss(db, outbox, input, readAdminRoster) {
  const missionId = typeof input?.mission_id === 'string' ? input.mission_id.trim() : ''
  const adminName = typeof input?.admin_name === 'string' ? input.admin_name.trim() : ''
  const reason = typeof input?.reason === 'string' ? input.reason.trim() : ''
  if (missionId === '' || adminName === '' || reason === '') {
    throw new Error('Evidence-loss acknowledgement requires mission, admin, and reason.')
  }
  if (adminName.length > 160 || reason.length > 2_000) {
    throw new Error('Evidence-loss acknowledgement exceeds the bounded audit limit.')
  }
  const mission = getMission(db, missionId)
  if (mission.status !== 'finished') {
    throw new Error('Evidence loss can be acknowledged only after the mission is finished.')
  }
  assertFinishedMissionBookkeepingAllowed(db, missionId)
  const adminRoster = typeof readAdminRoster === 'function' ? await readAdminRoster() : []
  assertFinishedMissionBookkeepingAllowed(db, missionId)
  if (!adminRoster.map((value) => value.trim()).includes(adminName)) {
    db.transaction(() => {
      assertFinishedMissionBookkeepingAllowed(db, missionId)
      insertEvent(db, missionId, 'mission_evidence_loss_acknowledgement_denied', now(), {
        admin_name: adminName,
        reason,
        resulting_status: 'finished',
      })
    })()
    throw new Error('Selected admin is not authorized to acknowledge mission evidence loss.')
  }
  const candidate = await outbox.readEvidenceLossAcknowledgementCandidate(missionId)
  const timestamp = now()
  const transaction = db.transaction(() => {
    assertFinishedMissionBookkeepingAllowed(db, missionId)
    insertEvent(db, missionId, 'mission_evidence_loss_acknowledged', timestamp, {
      admin_name: adminName,
      reason,
      loss_token: candidate.token,
      loss_reasons: candidate.reasons,
      resulting_status: mission.status,
    })
  })
  transaction()
  return getIngestEvidenceHealth(db, outbox, missionId)
}

/** Returns the latest exact loss-token acknowledgement retained in mission audit. */
function readEvidenceLossAcknowledgement(db, missionId) {
  const event = db.prepare(
    `SELECT timestamp, details_json FROM mission_events
      WHERE mission_id = ? AND event_type = 'mission_evidence_loss_acknowledged'
      ORDER BY timestamp DESC, rowid DESC LIMIT 1`,
  ).get(missionId)
  if (event === undefined) return null
  const details = readEventDetails(event.details_json)
  if (
    typeof details.admin_name !== 'string' ||
    typeof details.reason !== 'string' ||
    typeof details.loss_token !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(details.loss_token)
  ) return null
  return {
    adminName: details.admin_name,
    reason: details.reason,
    lossToken: details.loss_token,
    acknowledgedAt: event.timestamp,
  }
}

/** Returns only the current audit token used by the serialized outbox fence. */
function readAcknowledgedEvidenceLossToken(db, missionId) {
  return readEvidenceLossAcknowledgement(db, missionId)?.lossToken ?? null
}

/** Maps outbox state into the operator/completeness health contract. */
async function mapIngestEvidenceHealth(outbox, missionId) {
  const outboxHealth = await outbox.health(missionId)
  const criticalReasons = new Set([
    'outbox_storage_unavailable',
    'outbox_capacity_exhausted',
    'outbox_corrupt_record',
    'outbox_health_marker_corrupt',
    'outbox_invalid_envelope',
    'mission_persistence_failed',
    'renderer_pending_evidence_lost',
    'renderer_pending_capacity_exhausted',
    'late_evidence_after_finalization',
  ])
  const state = criticalReasons.has(outboxHealth.lastFailure)
    ? 'critical'
    : outboxHealth.pendingCount > 0 || outboxHealth.lastFailure !== null
      ? 'degraded'
      : 'healthy'
  return {
    state,
    reason: outboxHealth.lastFailure,
    pendingCount: outboxHealth.pendingCount,
    corruptCount: outboxHealth.corruptCount,
  }
}

function createBackupCoordinator(
  db,
  databasePath,
  backupPath,
  faultInjection,
  storageDiagnostics,
) {
  let backupTail = Promise.resolve()
  let queueDepth = 0

  const enqueue = (task) => {
    const run = backupTail.then(task, task)
    backupTail = run.catch(() => {})
    return run
  }

  return {
    syncBackup: async (trigger = 'unknown') => {
      const operation = createStorageDiagnosticOperation(storageDiagnostics)
      queueDepth += 1
      await safeStorageDiagnostic(() =>
        operation === null
          ? undefined
          : storageDiagnostics.requested(operation, { queueDepth, trigger }),
      )
      return enqueue(async () => {
        queueDepth = Math.max(0, queueDepth - 1)
        return syncBackup(
          db,
          databasePath,
          backupPath,
          faultInjection,
          storageDiagnostics,
          operation,
        )
      })
    },
  }
}

async function syncBackup(
  db,
  databasePath,
  backupPath,
  faultInjection = {},
  storageDiagnostics = null,
  operation = null,
) {
  await fs.mkdir(path.dirname(backupPath), { recursive: true })
  const temporaryPath = `${backupPath}.tmp-${randomUUID()}`
  let stage = 'started'
  try {
    await safeStorageDiagnostic(() =>
      operation === null ? undefined : storageDiagnostics.started(operation),
    )
    await runSqliteBackupInWorker({
      sourcePath: databasePath,
      targetPath: temporaryPath,
    })
    stage = 'copied'
    await safeStorageDiagnostic(() =>
      operation === null ? undefined : storageDiagnostics.phase(operation, stage),
    )
    if (faultInjection.afterTemporaryBackup === true) {
      throw new Error('Injected backup interruption after temporary backup.')
    }
    if (faultInjection.corruptTemporarySnapshotBeforeSanityCheck === true) {
      await corruptSqliteHeader(temporaryPath)
    }
    stage = 'sanity_check_started'
    await safeStorageDiagnostic(() =>
      operation === null ? undefined : storageDiagnostics.phase(operation, stage),
    )
    await validateSqliteSnapshotSanity(temporaryPath, 'Rolling mission backup')
    stage = 'sanity_checked'
    await safeStorageDiagnostic(() =>
      operation === null ? undefined : storageDiagnostics.phase(operation, stage),
    )
    await fs.rename(temporaryPath, backupPath)
    stage = 'renamed'
    await safeStorageDiagnostic(() =>
      operation === null ? undefined : storageDiagnostics.phase(operation, stage),
    )
  } catch (error) {
    await safeStorageDiagnostic(() =>
      operation === null
        ? undefined
        : storageDiagnostics.failed(operation, {
            stage,
            errorName: error instanceof Error ? error.name : 'UnknownError',
          }),
    )
    await removeSqliteFileSet(temporaryPath)
    throw error
  }

  const activeMission = getActiveMission(db)
  if (activeMission !== null) {
    appendEvent(db, activeMission.id, 'mission_backup_synced', { backup_path: backupPath })
  }
  await safeStorageDiagnostic(() =>
    operation === null ? undefined : storageDiagnostics.completed(operation),
  )
  return backupPath
}

/** Corrupts only the temporary snapshot header for a fail-closed regression seam. */
async function corruptSqliteHeader(databasePath) {
  const fileHandle = await fs.open(databasePath, 'r+')
  try {
    await fileHandle.write(Buffer.from('Not SQLite data!'), 0, 16, 0)
  } finally {
    await fileHandle.close()
  }
}

async function safeStorageDiagnostic(callback) {
  try {
    await callback?.()
  } catch {
    // Diagnostics are fail-open: a local log/checkpoint failure must never block mission storage.
  }
}

function createStorageDiagnosticOperation(storageDiagnostics) {
  try {
    return storageDiagnostics?.createOperation('backup') ?? null
  } catch {
    return null
  }
}

async function removeSqliteFileSet(databasePath) {
  await Promise.all([
    fs.rm(databasePath, { force: true }),
    fs.rm(`${databasePath}-wal`, { force: true }),
    fs.rm(`${databasePath}-shm`, { force: true }),
  ])
}

function validateSqliteDatabaseFile(databasePath, label) {
  let snapshotDb
  try {
    snapshotDb = new Database(databasePath, { readonly: true, fileMustExist: true })
    const integrityResult = snapshotDb.pragma('integrity_check', { simple: true })
    if (integrityResult !== 'ok') {
      throw new Error(`${label} SQLite snapshot failed integrity_check: ${integrityResult}`)
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('SQLite snapshot failed integrity_check')) {
      throw error
    }
    throw new Error(`${label} SQLite snapshot cannot be opened for integrity validation: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    snapshotDb?.close()
  }
}

function createMission(db, input) {
  if (getActiveMission(db) !== null) {
    throw new Error('Cannot create a new mission while another mission is active.')
  }
  const id = randomUUID()
  const startTime = input.start_time ?? now()
  const transaction = db.transaction(() => {
    db.prepare(`INSERT INTO missions (id, name, status, start_time, pause_time, finish_time, paused_seconds, notes, schema_version)
      VALUES (?, ?, 'active', ?, NULL, NULL, 0, ?, ?)`)
      .run(id, input.name, startTime, input.notes ?? null, CURRENT_SCHEMA_VERSION)
    insertEvent(db, id, 'mission_created', startTime, {
      name: input.name,
      notes: input.notes ?? null,
      start_time: startTime,
    })
  })
  transaction()
  return getMission(db, id)
}

function getMission(db, missionId) {
  const mission = db.prepare('SELECT * FROM missions WHERE id = ?').get(missionId)
  if (mission === undefined) {
    throw new Error(`Mission not found: ${missionId}`)
  }
  return projectMissionStorageState(db, mission)
}

function getActiveMission(db) {
  const mission = db.prepare("SELECT * FROM missions WHERE status IN ('active', 'paused') ORDER BY start_time DESC LIMIT 1").get()
  return mission === undefined ? null : projectMissionStorageState(db, mission)
}

/** Projects the current cleanup epoch without adding a mutable mission column. */
function projectMissionStorageState(db, mission) {
  return {
    ...mission,
    storage_state: readMissionLiveReviewStorageState(db, mission.id),
  }
}

function transitionMission(db, missionId, requiredStatus, nextStatus) {
  const mission = getMission(db, missionId)
  if (mission.status !== requiredStatus) {
    throw new Error(`Cannot transition mission with status '${mission.status}'.`)
  }
  const timestamp = now()
  const pauseTime = nextStatus === 'paused' ? timestamp : null
  const eventType = nextStatus === 'paused' ? 'mission_paused' : 'mission_resumed'
  const additionalPausedSeconds =
    requiredStatus === 'paused' ? calculatePausedSeconds(mission.pause_time, timestamp) : 0
  const transaction = db.transaction(() => {
    db.prepare(`UPDATE missions
      SET status = ?,
          pause_time = ?,
          finish_time = NULL,
          paused_seconds = paused_seconds + ?
      WHERE id = ?`)
      .run(nextStatus, pauseTime, additionalPausedSeconds, missionId)
    insertEvent(db, missionId, eventType, timestamp, { status: nextStatus })
  })
  transaction()
  return getMission(db, missionId)
}

function finishMission(db, missionId) {
  const mission = getMission(db, missionId)
  if (mission.status === 'finished' || mission.status === 'finalized') {
    throw new Error('Mission is already finished.')
  }
  const incompleteBackfillCount = db.prepare(`SELECT COUNT(*) AS count
    FROM participant_backfill_checkpoints
    WHERE mission_id = ? AND completed = 0`)
    .get(missionId).count
  if (incompleteBackfillCount > 0) {
    throw new Error(
      `Mission cannot be finished while ${incompleteBackfillCount} participant history backfill checkpoint(s) are incomplete. Keep the mission active and retry history backfill before finishing.`,
    )
  }
  const timestamp = now()
  const additionalPausedSeconds =
    mission.status === 'paused' ? calculatePausedSeconds(mission.pause_time, timestamp) : 0
  const transaction = db.transaction(() => {
    assertLegacyMissionObjectBackfillSettled(db)
    assertLegacyEventProvenanceReady(db, missionId)
    assertNoUnsettledGpxImportState(db, missionId)
    db.prepare(`UPDATE missions
      SET status = ?,
          pause_time = NULL,
          finish_time = ?,
          paused_seconds = paused_seconds + ?
      WHERE id = ?`)
      .run('finished', timestamp, additionalPausedSeconds, missionId)
    insertEvent(db, missionId, 'mission_finished', timestamp, { status: 'finished' })
  })
  transaction()
  return getMission(db, missionId)
}

function calculatePausedSeconds(pauseTime, resumeOrFinishTime) {
  const pauseStartMs = Date.parse(pauseTime ?? '')
  const pauseEndMs = Date.parse(resumeOrFinishTime)
  if (Number.isNaN(pauseStartMs) || Number.isNaN(pauseEndMs)) {
    throw new Error('Mission pause time is invalid; paused duration cannot be calculated.')
  }
  return Math.max(0, Math.floor((pauseEndMs - pauseStartMs) / 1000))
}

/**
 * Builds a real, immutable, standalone archive for a finished or finalized mission and
 * returns its location. Mirrors the Rust reference (`persistence.rs`): a fresh SQLite
 * snapshot plus a manifest, the mission record, and every marker attachment, written to
 * a temporary file and atomically renamed into the per-mission `archives/` directory so
 * a partially-written archive can never be observed. Unlike the shared rolling backup,
 * each archive is uniquely named and is never overwritten by a later mission.
 *
 * @param {boolean} [recordArchiveEvent] when true, append a `mission_archived` event
 *   (matching Rust); finalize passes false because it records its own event sequence.
 */
async function createMissionArchive(
  db,
  missionId,
  backupCoordinator,
  archiveDirectory,
  recordArchiveEvent = true,
  archiveFaultInjection = {},
  archiveEventContext = {},
) {
  if (!recordArchiveEvent) {
    return buildMissionArchive(
      db,
      missionId,
      backupCoordinator,
      archiveDirectory,
      false,
      archiveFaultInjection,
      null,
    )
  }
  const requestedAt = now()
  db.transaction(() => {
    const mission = getMission(db, missionId)
    if (mission.status !== 'finished' && mission.status !== 'finalized') {
      throw new Error('Only finished or finalized missions can be archived.')
    }
    if (archiveEventContext.archive_kind === 'finalized_recovery') {
      if (!Number.isSafeInteger(archiveEventContext.finalization_epoch)) {
        throw new Error('Finalized archive recovery epoch is invalid; retry finalization.')
      }
      assertMissionUnlockEpoch(db, missionId, archiveEventContext.finalization_epoch, {
        requireArchiveReviewable: false,
      })
    }
    assertMissionFinalizationNotInProgress(db, missionId)
    assertLegacyMissionObjectBackfillSettled(db)
    assertLegacyEventProvenanceReady(db, missionId)
    assertNoUnsettledGpxImportState(db, missionId)
    db.prepare(`INSERT INTO mission_finalization_fences (mission_id, requested_at)
      VALUES (?, ?)`).run(missionId, requestedAt)
    insertEvent(db, missionId, 'mission_archive_requested', requestedAt, {
      resulting_status: mission.status,
      archive_kind: archiveEventContext.archive_kind ?? 'direct',
      ...(archiveEventContext.finalization_epoch === undefined
        ? {}
        : { finalization_epoch: archiveEventContext.finalization_epoch }),
      ...(archiveEventContext.replaces_archive_path === undefined
        ? {}
        : { replaces_archive_path: archiveEventContext.replaces_archive_path }),
    })
  })()
  try {
    return await buildMissionArchive(
      db,
      missionId,
      backupCoordinator,
      archiveDirectory,
      true,
      archiveFaultInjection,
      requestedAt,
      archiveEventContext,
    )
  } catch (error) {
    db.transaction(() => {
      const deleted = db.prepare(`DELETE FROM mission_finalization_fences
        WHERE mission_id = ? AND requested_at = ?`).run(missionId, requestedAt)
      if (deleted.changes > 0) {
        appendEvent(db, missionId, 'mission_archive_failed', {
          resulting_status: getMission(db, missionId).status,
          archive_kind: archiveEventContext.archive_kind ?? 'direct',
          ...(archiveEventContext.finalization_epoch === undefined
            ? {}
            : { finalization_epoch: archiveEventContext.finalization_epoch }),
          ...(archiveEventContext.replaces_archive_path === undefined
            ? {}
            : { replaces_archive_path: archiveEventContext.replaces_archive_path }),
          error: error instanceof Error ? error.message : String(error),
        })
      }
    })()
    throw error
  }
}

/** Builds and commits one immutable mission archive under its caller-owned evidence fence. */
async function buildMissionArchive(
  db,
  missionId,
  backupCoordinator,
  archiveDirectory,
  recordArchiveEvent,
  archiveFaultInjection,
  directArchiveFenceToken,
  archiveEventContext = {},
) {
  const mission = getMission(db, missionId)
  if (mission.status !== 'finished' && mission.status !== 'finalized') {
    throw new Error('Only finished or finalized missions can be archived.')
  }
  if (recordArchiveEvent) {
    const fence = db.prepare(`SELECT requested_at FROM mission_finalization_fences
      WHERE mission_id = ?`).get(missionId)
    if (fence?.requested_at !== directArchiveFenceToken) {
      throw new Error('Mission archive evidence fence is missing; retry archive creation.')
    }
  }
  assertLegacyMissionObjectBackfillSettled(db)
  assertLegacyEventProvenanceReady(db, missionId)
  assertNoUnsettledGpxImportState(db, missionId)

  const createdAt = directArchiveFenceToken ?? now()
  const backupPath = await backupCoordinator.syncBackup()
  const snapshotBytes = await fs.readFile(backupPath)
  if (snapshotBytes.length === 0) {
    throw new Error('Mission archive cannot be created from an empty database snapshot.')
  }
  let archiveSnapshotBytes = snapshotBytes
  if (archiveFaultInjection.corruptSnapshotBeforeZip === true) {
    archiveSnapshotBytes = Buffer.from('corrupt sqlite snapshot', 'utf8')
  }

  const manifestBytes = Buffer.from(
    JSON.stringify(
      {
        archive_version: ARCHIVE_VERSION,
        created_at: createdAt,
        mission_id: missionId,
        schema_version: CURRENT_SCHEMA_VERSION,
        snapshot_format: 'sqlite',
      },
      null,
      2,
    ),
    'utf8',
  )
  const missionBytes = Buffer.from(JSON.stringify(mission, null, 2), 'utf8')

  const entries = [
    { name: 'manifest.json', data: manifestBytes },
    { name: 'mission.json', data: missionBytes },
    { name: 'mission-store.sqlite', data: archiveSnapshotBytes },
  ]

  const archiveAttachmentPaths = listMarkerAttachmentPaths(db, missionId)
  const archiveNames = collisionSafeAttachmentArchiveNames(archiveAttachmentPaths)
  for (const attachmentPath of archiveAttachmentPaths) {
    let attachmentBytes
    try {
      attachmentBytes = await fs.readFile(attachmentPath)
    } catch {
      throw new Error(
        `Mission archive cannot be created because marker attachment is missing: ${attachmentPath}`,
      )
    }
    entries.push({ name: `attachments/${archiveNames.get(attachmentPath)}`, data: attachmentBytes })
  }

  await fs.mkdir(archiveDirectory, { recursive: true })
  await validateSqliteSnapshotBuffer(
    archiveSnapshotBytes,
    'Mission archive embedded SQLite snapshot',
    archiveDirectory,
  )
  const archiveBuffer = createZipArchive(entries)

  const archiveName = `${missionId}-${createdAt.replace(/:/g, '-')}.zip`
  const finalPath = path.join(archiveDirectory, archiveName)

  try {
    validateArchiveFile(archiveBuffer, missionId)
  } catch (error) {
    throw error
  }
  await writeFileDurably(finalPath, archiveBuffer)

  if (recordArchiveEvent) {
    try {
      db.transaction(() => {
        const currentMission = getMission(db, missionId)
        if (currentMission.status !== mission.status) {
          throw new Error('Mission state changed while the archive was being created; retry archive creation.')
        }
        const fence = db.prepare(`SELECT requested_at FROM mission_finalization_fences
          WHERE mission_id = ?`).get(missionId)
        if (fence?.requested_at !== directArchiveFenceToken) {
          throw new Error('Mission archive evidence fence changed; retry archive creation.')
        }
        appendEvent(db, missionId, 'mission_archived', {
          archive_path: finalPath,
          archive_kind: archiveEventContext.archive_kind ?? 'direct',
          ...(archiveEventContext.finalization_epoch === undefined
            ? {}
            : { finalization_epoch: archiveEventContext.finalization_epoch }),
          ...(archiveEventContext.replaces_archive_path === undefined
            ? {}
            : { replaces_archive_path: archiveEventContext.replaces_archive_path }),
        }, createdAt)
        db.prepare(`DELETE FROM mission_finalization_fences
          WHERE mission_id = ? AND requested_at = ?`).run(missionId, directArchiveFenceToken)
      })()
    } catch (error) {
      await fs.rm(finalPath, { force: true })
      throw error
    }
  }

  return { mission_id: missionId, archive_path: finalPath, created_at: createdAt }
}

/** Validates a SQLite snapshot and optional read-only mission-evidence assertions. */
async function validateSqliteSnapshotBuffer(
  snapshotBytes,
  label,
  workingDirectory,
  validateSnapshot = null,
) {
  const temporaryPath = path.join(workingDirectory, `.sqlite-integrity-${randomUUID()}.sqlite`)
  try {
    await fs.writeFile(temporaryPath, snapshotBytes)
    validateSqliteDatabaseFile(temporaryPath, label)
    if (validateSnapshot !== null) {
      const snapshotDb = new Database(temporaryPath, { readonly: true, fileMustExist: true })
      try {
        validateSnapshot(snapshotDb)
      } finally {
        snapshotDb.close()
      }
    }
  } finally {
    await removeSqliteFileSet(temporaryPath)
  }
}

function listMarkerAttachmentPaths(db, missionId) {
  const referencedPaths = all(
    db,
    `SELECT attachment_path FROM markers
      WHERE mission_id = ? AND attachment_path IS NOT NULL AND TRIM(attachment_path) != ''
      ORDER BY display_order ASC, created_at ASC`,
    missionId,
  ).map((row) => row.attachment_path)

  const versionRows = all(
    db,
    `SELECT state_json FROM mission_object_versions
      WHERE mission_id = ? AND object_type = 'marker'
      ORDER BY object_id ASC, version_sequence ASC`,
    missionId,
  )
  for (const row of versionRows) {
    let state
    try {
      state = JSON.parse(row.state_json)
    } catch {
      throw new Error('Mission archive cannot enumerate a corrupt marker version attachment.')
    }
    if (typeof state?.attachment_path === 'string' && state.attachment_path.trim() !== '') {
      referencedPaths.push(state.attachment_path)
    }
  }

  const ingestEvents = all(
    db,
    `SELECT details_json FROM mission_events
      WHERE mission_id = ? AND event_type = 'marker_attachment_ingested'
      ORDER BY timestamp ASC, rowid ASC`,
    missionId,
  )
  for (const event of ingestEvents) {
    let details
    try {
      details = JSON.parse(event.details_json)
    } catch {
      throw new Error('Mission archive cannot enumerate a corrupt attachment custody event.')
    }
    if (typeof details?.attachment_path === 'string' && details.attachment_path.trim() !== '') {
      referencedPaths.push(details.attachment_path)
    }
  }

  return [...new Set(referencedPaths.map((attachmentPath) => path.resolve(attachmentPath)))]
}

/** Keeps legacy archive names when unique and disambiguates basename collisions. */
function collisionSafeAttachmentArchiveNames(attachmentPaths) {
  const basenameCounts = new Map()
  for (const attachmentPath of attachmentPaths) {
    const basename = path.basename(attachmentPath)
    basenameCounts.set(basename, (basenameCounts.get(basename) ?? 0) + 1)
  }
  return new Map(attachmentPaths.map((attachmentPath) => {
    const basename = path.basename(attachmentPath)
    if (basenameCounts.get(basename) === 1) return [attachmentPath, basename]
    const pathIdentity = createHash('sha256').update(attachmentPath).digest('hex').slice(0, 12)
    return [attachmentPath, `${pathIdentity}-${basename}`]
  }))
}

/**
 * Verifies a freshly-built archive can be re-read, its CRCs match, the required entries
 * are present, the snapshot is non-empty, and the manifest/mission identify the mission —
 * the same guarantees the Rust reader checks. Surfaces corruption loudly before the
 * archive is committed via atomic rename.
 */
function validateArchiveFile(archiveBuffer, missionId) {
  const entries = readZipArchive(archiveBuffer)
  const manifestEntry = entries.get('manifest.json')
  if (manifestEntry === undefined) {
    throw new Error('Mission archive is missing manifest.json.')
  }
  const manifest = JSON.parse(manifestEntry.toString('utf8'))
  if (manifest.mission_id !== missionId) {
    throw new Error('Mission archive manifest does not match the requested mission.')
  }
  const missionEntry = entries.get('mission.json')
  if (missionEntry === undefined) {
    throw new Error('Mission archive is missing mission.json.')
  }
  const archivedMission = JSON.parse(missionEntry.toString('utf8'))
  if (archivedMission.id !== missionId) {
    throw new Error('Mission archive payload does not match the requested mission.')
  }
  const snapshotEntry = entries.get('mission-store.sqlite')
  if (snapshotEntry === undefined || snapshotEntry.length === 0) {
    throw new Error('Mission archive contains an empty mission-store.sqlite snapshot.')
  }
  return entries
}

/**
 * Reads the one still-open post-finalization correction authorization. A normal
 * first Finish has no such authorization and therefore remains read-only.
 */
function readActiveMissionCorrectionAuthorization(db, missionId) {
  const finalized = db.prepare(`SELECT rowid AS event_rowid, details_json
    FROM mission_events
    WHERE mission_id = ? AND event_type = 'mission_finalized'
    ORDER BY rowid DESC LIMIT 1`).get(missionId)
  if (finalized === undefined) return null
  const unlocked = db.prepare(`SELECT rowid AS event_rowid, id, timestamp, details_json
    FROM mission_events
    WHERE mission_id = ? AND event_type = 'mission_unlocked' AND rowid > ?
    ORDER BY rowid DESC LIMIT 1`).get(missionId, finalized.event_rowid)
  if (unlocked === undefined) return null
  const finalizedDetails = readEventDetails(finalized.details_json)
  const unlockDetails = readEventDetails(unlocked.details_json)
  const authority = typeof unlockDetails.admin_name === 'string'
    ? unlockDetails.admin_name.trim()
    : ''
  const reason = typeof unlockDetails.reason === 'string' ? unlockDetails.reason.trim() : ''
  if (authority === '' || Buffer.byteLength(authority, 'utf8') > 200
    || reason === '' || Buffer.byteLength(reason, 'utf8') > 4_000) {
    throw new Error('Mission correction authorization audit is invalid.')
  }
  return Object.freeze({
    authority,
    reason,
    finalizedEventRowid: Number(finalized.event_rowid),
    previousArchiveId: typeof finalizedDetails.archive_id === 'string'
      ? finalizedDetails.archive_id
      : null,
    unlockEventId: unlocked.id,
    unlockEventRowid: Number(unlocked.event_rowid),
    unlockedAt: unlocked.timestamp,
  })
}

/** Reads one trusted observed file identity retained by custody reconciliation. */
function readObservedArchiveFileIdentity(value) {
  let parsed
  try {
    parsed = JSON.parse(value)
    return normalizeCustodyFileIdentity(parsed)
  } catch {
    const error = new Error('Mission correction predecessor custody identity is unavailable.')
    error.code = 'ARCHIVE_SUPPLEMENT_PREDECESSOR_INVALID'
    throw error
  }
}

/** Binds one re-finalization candidate to the exact archive protected by the active unlock. */
function readActiveArchiveSupplementCandidate(db, archiveRegistry, missionId) {
  const authorization = readActiveMissionCorrectionAuthorization(db, missionId)
  if (authorization === null) return null
  const missionArchives = archiveRegistry.listMissionArchives(missionId)
  const previous = authorization.previousArchiveId === null
    ? missionArchives.find((archive) => archive.status !== 'superseded')
    : missionArchives.find((archive) => archive.id === authorization.previousArchiveId)
  const containerVersion = Number(previous?.container_version)
  if (previous === undefined
    || previous.mission_id !== missionId
    || previous.status === 'superseded'
    || !['sealed', 'verified'].includes(previous.status)
    || ![1, 2].includes(containerVersion)
    || previous.availability !== 'present'
    || (containerVersion === 1 && previous.ciphertext_sha256 !== null)
    || (containerVersion === 2 && previous.ciphertext_sha256 === null)) {
    const error = new Error(
      'Mission correction predecessor archive is unavailable or no longer current.',
    )
    error.code = 'ARCHIVE_SUPPLEMENT_PREDECESSOR_INVALID'
    throw error
  }
  return Object.freeze({
    ...authorization,
    previousArchiveId: previous.id,
    previousArchiveContainerVersion: containerVersion,
    previousArchiveRelativePath: previous.relative_path,
    previousArchiveSha256: containerVersion === 2 ? previous.ciphertext_sha256 : null,
    previousArchiveFileIdentity: readObservedArchiveFileIdentity(
      previous.last_observed_file_identity,
    ),
  })
}

/** Returns whether two supplement candidates describe the same authority and predecessor. */
function sameArchiveSupplementCandidate(left, right) {
  if (left === null || right === null) return left === right
  const fields = [
    'authority',
    'reason',
    'finalizedEventRowid',
    'previousArchiveId',
    'previousArchiveContainerVersion',
    'previousArchiveRelativePath',
    'unlockEventId',
    'unlockEventRowid',
    'unlockedAt',
  ]
  if (fields.some((field) => left[field] !== right[field])) return false
  const identityKeys = [
    'changedTimeNanoseconds',
    'device',
    'inode',
    'linkCount',
    'modifiedTimeNanoseconds',
    'sizeBytes',
  ]
  return (left.previousArchiveContainerVersion !== 2
    || left.previousArchiveSha256 === right.previousArchiveSha256)
    && identityKeys.every((key) =>
      left.previousArchiveFileIdentity?.[key] === right.previousArchiveFileIdentity?.[key])
}

/** Rechecks the exact correction authority and predecessor after asynchronous work. */
function assertArchiveSupplementCandidateCurrent(db, archiveRegistry, missionId, expected) {
  const current = readActiveArchiveSupplementCandidate(db, archiveRegistry, missionId)
  if (!sameArchiveSupplementCandidate(current, expected)) {
    const error = new Error(
      'Mission correction predecessor or authorization changed during archive work.',
    )
    error.code = 'ARCHIVE_SUPPLEMENT_PREDECESSOR_CHANGED'
    throw error
  }
  return current
}

/** Runs and physically joins one optional worker operation. */
async function awaitOwnedArchiveOperation(operation) {
  try {
    return await operation
  } finally {
    await Promise.resolve(operation?.workerExited ?? operation).catch(() => undefined)
  }
}

/** Resolves a legacy predecessor to the SHA-256 of its exact pinned retained bytes. */
async function resolveArchiveSupplementContext(input) {
  let candidate = readActiveArchiveSupplementCandidate(
    input.db,
    input.archiveRegistry,
    input.missionId,
  )
  if (candidate === null) return candidate
  if (candidate.previousArchiveContainerVersion === 2) {
    await input.archiveRegistry.reconcileArchiveAvailability({
      archiveId: candidate.previousArchiveId,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    })
    candidate = readActiveArchiveSupplementCandidate(
      input.db,
      input.archiveRegistry,
      input.missionId,
    )
    if (candidate === null || candidate.previousArchiveContainerVersion !== 2) {
      const error = new Error(
        'Mission correction predecessor changed during its exact custody reconciliation.',
      )
      error.code = 'ARCHIVE_SUPPLEMENT_PREDECESSOR_CHANGED'
      throw error
    }
    return candidate
  }
  const operation = input.archiveLegacyPredecessorHashRunner({
    ticket: {
      operationId: randomUUID(),
      archiveId: candidate.previousArchiveId,
      missionId: input.missionId,
      archiveDirectory: input.archiveDirectory,
      archiveRelativePath: candidate.previousArchiveRelativePath,
      expectedFileIdentity: candidate.previousArchiveFileIdentity,
    },
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  })
  const proof = input.awaitArchiveWorker === undefined
    ? await awaitOwnedArchiveOperation(operation)
    : await input.awaitArchiveWorker(operation)
  assertArchiveSupplementCandidateCurrent(
    input.db,
    input.archiveRegistry,
    input.missionId,
    candidate,
  )
  return Object.freeze({
    ...candidate,
    previousArchiveSha256: proof.sha256,
    previousArchiveFileIdentity: proof.fileIdentity,
  })
}

/** Pins predecessor custody across one short durable main-store transition. */
function withPinnedArchiveSupplementPredecessor(supplement, archiveDirectory, callback) {
  if (supplement === null) {
    return callback(() => undefined)
  }
  return withPinnedCustodyFileIdentity({
    archiveDirectory,
    archiveRelativePath: supplement.previousArchiveRelativePath,
    expectedFileIdentity: supplement.previousArchiveFileIdentity,
  }, callback)
}

async function finalizeMission(
  db,
  missionId,
  backupCoordinator,
  archiveDirectory,
  finalizeMissionFaultInjection = {},
  archiveFaultInjection = {},
  readArchiveFile = fs.readFile,
) {
  const mission = getMission(db, missionId)
  if (mission.status === 'finalized') {
    assertLegacyMissionObjectBackfillSettled(db)
    assertLegacyEventProvenanceReady(db, missionId)
    assertNoUnsettledGpxImportState(db, missionId)
    const finalizedEpoch = readLatestMissionFinalizedEpoch(db, missionId)
    let rejectedArchivePath = null
    let existingArchive = await readRecoverableFinalizeArchive(
      db,
      missionId,
      readArchiveFile,
      (archivePath) => {
        rejectedArchivePath ??= archivePath
      },
      true,
      finalizedEpoch,
    )
    if (existingArchive === null) {
      existingArchive = await createMissionArchive(
        db,
        missionId,
        backupCoordinator,
        archiveDirectory,
        true,
        archiveFaultInjection,
        {
          archive_kind: 'finalized_recovery',
          finalization_epoch: finalizedEpoch,
          ...(rejectedArchivePath === null
            ? {}
            : { replaces_archive_path: rejectedArchivePath }),
        },
      )
    }
    return db.transaction(() => {
      assertMissionUnlockEpoch(db, missionId, finalizedEpoch, {
        requireArchiveReviewable: false,
      })
      return { mission: getMission(db, missionId), archive: existingArchive }
    }).immediate()
  }
  if (mission.status !== 'finished') {
    throw new Error('Only finished missions can be finalized.')
  }
  const resumedProtectedFinalization = db.transaction(() => {
    assertLegacyMissionObjectBackfillSettled(db)
    assertLegacyEventProvenanceReady(db, missionId)
    assertNoUnsettledGpxImportState(db, missionId)
    const existingFence = db.prepare(`SELECT requested_at FROM mission_finalization_fences
      WHERE mission_id = ?`).get(missionId)
    if (existingFence !== undefined) return true
    const requestedAt = now()
    db.prepare(`INSERT INTO mission_finalization_fences (mission_id, requested_at)
      VALUES (?, ?)`).run(missionId, requestedAt)
    insertEvent(db, missionId, 'mission_finalize_requested', requestedAt, {
      resulting_status: 'finished',
    })
    return false
  })()

  let archive = resumedProtectedFinalization
    ? await readRecoverableFinalizeArchive(db, missionId, readArchiveFile)
    : null
  if (archive === null) {
    try {
      archive = await createMissionArchive(
        db,
        missionId,
        backupCoordinator,
        archiveDirectory,
        false,
        archiveFaultInjection,
      )
    } catch (error) {
      db.transaction(() => {
        appendEvent(db, missionId, 'mission_archive_failed', {
          resulting_status: 'finished',
          error: error instanceof Error ? error.message : String(error),
        })
        db.prepare('DELETE FROM mission_finalization_fences WHERE mission_id = ?')
          .run(missionId)
      })()
      throw error
    }

    appendEvent(db, missionId, 'mission_archive_succeeded', {
      resulting_status: 'finished',
      archive_path: archive.archive_path,
    })
  }

  if (finalizeMissionFaultInjection.afterArchiveSucceededEvent === true) {
    throw new Error('Injected finalize interruption after archive success.')
  }

  const transaction = db.transaction(() => {
    assertLegacyMissionObjectBackfillSettled(db)
    assertLegacyEventProvenanceReady(db, missionId)
    assertNoUnsettledGpxImportState(db, missionId)
    const currentMission = getMission(db, missionId)
    if (currentMission.status !== 'finished') {
      throw new Error('Mission finalization state changed before the archive could be sealed.')
    }
    if (db.prepare(`SELECT 1 FROM mission_finalization_fences
      WHERE mission_id = ?`).get(missionId) === undefined) {
      throw new Error('Mission finalization evidence fence is missing; retry finalization.')
    }
    db.prepare('UPDATE missions SET status = ? WHERE id = ?').run('finalized', missionId)
    insertEvent(db, missionId, 'mission_finalized', now(), {
      resulting_status: 'finalized',
      archive_path: archive.archive_path,
    })
    db.prepare('DELETE FROM mission_finalization_fences WHERE mission_id = ?').run(missionId)
  })
  transaction()
  return { mission: getMission(db, missionId), archive }
}

/**
 * Finalizes one finished mission through the journalled SARARCH2 lifecycle.
 * The live store holds SQLite locks only for short identity/state transitions; snapshot,
 * encryption, publish, restore, and exhaustive verification remain worker-owned.
 */
async function finalizeMissionWithEncryptedArchive(input) {
  const {
    db,
    databasePath,
    missionId,
    archiveDirectory,
    archiveRegistry,
    archiveCustodyJournal,
    archiveCreateRunner,
    archiveVerifyRunner,
    archiveLegacyPredecessorHashRunner,
    awaitArchiveWorker,
    recoverArchiveVerificationPlaintext,
    signal,
    custody,
    faultInjection = {},
  } = input
  const archiveId = randomUUID()
  const operationId = input.operationId ?? randomUUID()
  const requestedAt = now()
  const finalizationEventId = deriveArchiveLifecycleEventId(archiveId, 'mission-finalized')
  const supplementEventId = deriveArchiveLifecycleEventId(archiveId, 'supplement')
  const finalRelativePath = `${archiveId}.sararch`
  const temporaryRelativePath = `.staging/${operationId}/${archiveId}.sararch.tmp`
  const progress = createArchiveLifecycleProgressEmitter(input.onProgress)
  const resolvedSupplement = await resolveArchiveSupplementContext({
    db,
    archiveRegistry,
    missionId,
    archiveDirectory,
    archiveLegacyPredecessorHashRunner,
    awaitArchiveWorker,
    signal,
  })

  const requestIdentity = db.transaction(() => {
    const mission = getMission(db, missionId)
    if (mission.status !== 'finished') {
      throw new Error('Only finished missions can be finalized.')
    }
    assertLegacyMissionObjectBackfillSettled(db)
    assertLegacyEventProvenanceReady(db, missionId)
    assertNoUnsettledGpxImportState(db, missionId)
    assertMissionFinalizationNotInProgress(db, missionId)
    const supplement = assertArchiveSupplementCandidateCurrent(
      db,
      archiveRegistry,
      missionId,
      resolvedSupplement,
    )
    const requestSupplement = supplement === null
      ? null
      : Object.freeze({
          ...resolvedSupplement,
          ...supplement,
          previousArchiveSha256: resolvedSupplement.previousArchiveSha256,
          previousArchiveFileIdentity: resolvedSupplement.previousArchiveFileIdentity,
        })
    const supplementSequence = requestSupplement === null
      ? null
      : Number(db.prepare(`SELECT COALESCE(MAX(supplement_sequence), 0) + 1 AS next_sequence
        FROM mission_archive_supplements WHERE mission_id = ?`).get(missionId).next_sequence)
    db.prepare(`INSERT INTO mission_finalization_fences (mission_id, requested_at)
      VALUES (?, ?)`).run(missionId, requestedAt)
    const requestEventId = insertEvent(
      db,
      missionId,
      'mission_finalize_requested',
      requestedAt,
      {
        resulting_status: 'finished',
        archive_id: archiveId,
        operation_id: operationId,
        archive_kind: 'finalized',
        archive_relative_path: finalRelativePath,
        protected_finalization_epoch: null,
        previous_archive_id: requestSupplement?.previousArchiveId ?? null,
        previous_archive_sha256: requestSupplement?.previousArchiveSha256 ?? null,
      },
    )
    const requestEventRowid = Number(db.prepare(`SELECT rowid FROM mission_events
      WHERE id = ?`).get(requestEventId)?.rowid)
    if (!Number.isSafeInteger(requestEventRowid) || requestEventRowid < 1) {
      throw new Error('Mission archive request event could not be pinned safely.')
    }
    archiveCustodyJournal.planBuildingWithinTransaction({
      archiveId,
      archiveKind: 'finalized',
      createdAt: requestedAt,
      fenceRequestedAt: requestedAt,
      finalRelativePath,
      missionId,
      operationId,
      previousArchiveId: requestSupplement?.previousArchiveId ?? null,
      previousArchiveSha256: requestSupplement?.previousArchiveSha256 ?? null,
      protectedFinalizationEpoch: null,
      requestEventId,
      requestEventRowid,
      temporaryRelativePath,
    })
    return Object.freeze({
      requestEventId,
      requestEventRowid,
      supplement: requestSupplement,
      supplementSequence,
    })
  }).immediate()

  if (faultInjection.afterRequestBeforeWorker === true) {
    const interruption = new Error('Simulated archive interruption after durable request.')
    interruption.code = 'ARCHIVE_SIMULATED_INTERRUPTION'
    interruption.preserveArchiveCustodyForRestart = true
    throw interruption
  }

  let registered = false
  try {
    const createRequest = Object.freeze({
      operationId,
      archiveId,
      databasePath,
      archiveDirectory,
      missionId,
      requestEventRowid: requestIdentity.requestEventRowid,
      fenceRequestedAt: requestedAt,
      requestEventId: requestIdentity.requestEventId,
      archiveKind: 'finalized',
      createdAt: requestedAt,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      inventoryVersion: 1,
      previousArchiveId: requestIdentity.supplement?.previousArchiveId ?? null,
      previousArchiveSha256: requestIdentity.supplement?.previousArchiveSha256 ?? null,
      protectedFinalizationEpoch: null,
      passphrase: custody?.passphrase,
      recoveryCode: custody?.recoveryCode,
      finalizationProjection: Object.freeze({
        eventId: finalizationEventId,
        timestamp: requestedAt,
        recordedAt: requestedAt,
        archivePath: path.join(archiveDirectory, finalRelativePath),
        archiveRelativePath: finalRelativePath,
        supplement: requestIdentity.supplement === null
          ? null
          : Object.freeze({
              eventId: supplementEventId,
              sequence: requestIdentity.supplementSequence,
              authority: requestIdentity.supplement.authority,
              reason: requestIdentity.supplement.reason,
            }),
      }),
    })
    const creation = await awaitArchiveWorker(archiveCreateRunner({
      request: createRequest,
      signal,
      ...(input.onProgress === undefined
        ? {}
        : { onProgress: (update) => progress.forward('create', update) }),
    }))
    const receipt = Object.freeze({
      ciphertextSha256: creation.ciphertextSha256,
      containerVersion: creation.containerVersion,
      entryCount: creation.manifestSummary.entryCount,
      frameCount: creation.frameCount,
      headerSha256: creation.headerSha256,
      inventorySha256: creation.manifestSummary.inventorySha256,
      inventoryVersion: creation.inventoryVersion,
      kdfDurationMs: creation.kdfDurationMs,
      manifestSha256: creation.manifestSummary.manifestSha256,
      plaintextCleanupConfirmed: creation.plaintextSweepConfirmed,
      schemaVersion: creation.schemaVersion,
      sizeBytes: creation.sizeBytes,
      slots: creation.slots,
      tableCount: creation.manifestSummary.tableCount,
      temporaryFileIdentity: creation.temporaryFileIdentity,
    })
    progress.emit('create', 'publish', 'files', 0, 1, 'publishing-encrypted-archive')
    db.transaction(() => {
      assertEncryptedArchiveRequestStillCurrent(db, {
        missionId,
        requestedAt,
        requestEventId: requestIdentity.requestEventId,
        requestEventRowid: requestIdentity.requestEventRowid,
        archiveId,
        operationId,
        archiveKind: 'finalized',
        expectedMissionStatuses: ['finished'],
        protectedFinalizationEpoch: null,
        previousArchiveId: requestIdentity.supplement?.previousArchiveId ?? null,
        previousArchiveSha256: requestIdentity.supplement?.previousArchiveSha256 ?? null,
      })
      archiveCustodyJournal.recordPublishPrepared({
        expectedRevision: 1,
        observedAt: now(),
        operationId,
        receipt,
      })
    }).immediate()
    const publishResult = await archiveCustodyJournal.publishPrepared({
      expectedRevision: 2,
      operationId,
      signal,
    })
    progress.emit('create', 'publish', 'files', 1, 1, 'encrypted-archive-published')
    if (faultInjection.afterPublishBeforeSeal === true) {
      const interruption = new Error('Simulated archive interruption after durable publish.')
      interruption.code = 'ARCHIVE_SIMULATED_INTERRUPTION'
      interruption.preserveArchiveCustodyForRestart = true
      throw interruption
    }
    progress.emit('create', 'seal', 'files', 0, 1, 'sealing-archive-custody')
    sealPublishedArchiveFromJournal({
      db,
      archiveDirectory,
      archiveRegistry,
      archiveCustodyJournal,
      operationId,
      expectedRevision: 2,
      publishResult,
      resolvedSupplement: requestIdentity.supplement,
    })
    registered = true
    progress.emit('create', 'seal', 'files', 1, 1, 'archive-custody-sealed')

    const verificationTicket = archiveRegistry.issueVerificationTicket(archiveId)
    const verificationProof = await awaitArchiveWorker(archiveVerifyRunner({
      request: {
        ...verificationTicket,
        operationId,
        archiveDirectory,
        databasePath,
        passphrase: custody.passphrase,
        recoveryCode: custody.recoveryCode,
      },
      signal,
      ...(input.onProgress === undefined
        ? {}
        : { onProgress: (update) => progress.forward('verify', update) }),
    }))
    const verifiedArchive = commitArchiveVerificationIfEpochCurrent({
      db,
      archiveRegistry,
      archiveId,
      verificationProof,
    })
    progress.emit('verify', 'verified', 'phases', 1, 1, 'verification-committed')
    return {
      mission: getMission(db, missionId),
      archive: projectArchiveCustodyRow(verifiedArchive, archiveDirectory, db),
    }
  } catch (error) {
    if (error?.preserveArchiveCustodyForRestart === true) throw error
    if (registered) {
      await recoverArchiveVerificationPlaintext(error)
      const observedFailureCode = stableArchiveFailureCode(error, 'ARCHIVE_VERIFY_FAILED')
      const failureCode = observedFailureCode === 'ARCHIVE_CANCELLED'
        ? 'ARCHIVE_VERIFY_CANCELLED'
        : observedFailureCode.startsWith('ARCHIVE_VERIFY_')
          ? observedFailureCode
          : 'ARCHIVE_VERIFY_FAILED'
      let auditFailure = null
      try {
        if (faultInjection.failVerificationFailureAudit === true) {
          const injected = new Error('Injected post-seal verification-failure audit write failure.')
          injected.code = 'SQLITE_FULL'
          throw injected
        }
        appendEvent(db, missionId, 'mission_archive_verification_failed_v2', {
          archive_id: archiveId,
          resulting_status: getMission(db, missionId).status,
          error_code: failureCode,
        })
      } catch (auditError) {
        auditFailure = auditError
      }
      if (auditFailure !== null) {
        const auditTerminal = new Error(
          'Mission archive verification failed after seal and its failure audit could not be written.',
        )
        auditTerminal.code = 'ARCHIVE_VERIFY_AUDIT_FAILED'
        auditTerminal.cause = new AggregateError(
          [error, auditFailure],
          'Verification and its post-seal failure audit both failed.',
        )
        throw auditTerminal
      }
      if (error?.code === failureCode) throw error
      const failure = new Error(
        failureCode === 'ARCHIVE_VERIFY_CANCELLED'
          ? 'Mission archive verification was cancelled after archive custody was sealed.'
          : 'Mission archive verification failed after archive custody was sealed.',
      )
      failure.code = failureCode
      failure.cause = error
      throw failure
    }
    let settlement
    try {
      settlement = await archiveCustodyJournal.reconcileActive()
    } catch (settlementError) {
      const failure = new Error(
        'Mission archive creation stopped and custody recovery requires review before retrying.',
      )
      failure.code = 'ARCHIVE_CUSTODY_RECOVERY_REQUIRED'
      failure.cause = settlementError
      throw failure
    }
    if (settlement?.state === 'conflict') {
      const failure = new Error(
        'Mission archive custody conflict requires explicit review before retrying.',
      )
      failure.code = 'ARCHIVE_CUSTODY_RECOVERY_REQUIRED'
      failure.cause = error
      throw failure
    }
    db.transaction(() => {
      const fence = db.prepare(`SELECT requested_at FROM mission_finalization_fences
        WHERE mission_id = ?`).get(missionId)
      if (fence?.requested_at !== requestedAt) return
      appendEvent(db, missionId, 'mission_archive_failed', {
        archive_id: archiveId,
        operation_id: operationId,
        resulting_status: getMission(db, missionId).status,
        archive_kind: 'finalized',
        error_code: stableArchiveFailureCode(error, 'ARCHIVE_CREATE_FAILED'),
        custody_outcome: settlement?.state ?? 'none',
      })
      db.prepare(`DELETE FROM mission_finalization_fences
        WHERE mission_id = ? AND requested_at = ?`).run(missionId, requestedAt)
    }).immediate()
    throw error
  }
}

/** Re-sequences the full archive lifecycle and prevents worker completion from overstating custody. */
function createArchiveLifecycleProgressEmitter(onProgress) {
  const sequences = { create: 0, verify: 0 }
  const dispatch = (kind, update) => {
    if (onProgress === undefined) return
    sequences[kind] += 1
    deliverArchiveProgressBestEffort(
      onProgress,
      kind,
      Object.freeze({
        ...update,
        sequence: sequences[kind],
      }),
    )
  }
  return Object.freeze({
    forward(kind, update) {
      dispatch(kind, {
        ...update,
        phase: update.phase === 'complete'
          ? (kind === 'create' ? 'staged' : 'proof')
          : update.phase,
      })
    },
    emit(kind, phase, unit, completed, total, detail) {
      dispatch(kind, { phase, unit, completed, total, detail })
    },
  })
}

/** Keeps a best-effort UI progress observer outside every durable archive outcome. */
function deliverArchiveProgressBestEffort(observer, ...args) {
  try {
    const pending = observer(...args)
    if (pending !== null && typeof pending === 'object'
      && typeof pending.catch === 'function') {
      void pending.catch(() => undefined)
    }
  } catch {}
}

/** Resumes or safely settles the one durable pre-registration custody operation after restart. */
async function recoverInterruptedArchiveCustody(input) {
  const active = input.archiveCustodyJournal.readActive()
  if (active === null) return null
  if (input.signal?.aborted === true) {
    const error = new Error('Archive custody recovery was cancelled.')
    error.name = 'AbortError'
    error.code = 'ARCHIVE_CANCELLED'
    throw error
  }

  const registered = input.db.prepare(`SELECT id FROM mission_archives WHERE id = ?`)
    .get(active.archiveId)
  if (registered !== undefined) {
    const settlement = await input.archiveCustodyJournal.reconcileActive({
      signal: input.signal,
    })
    if (settlement?.state !== 'registered') {
      const error = new Error('Registered archive custody disagrees with its active journal.')
      error.code = 'ARCHIVE_CUSTODY_RECOVERY_REQUIRED'
      throw error
    }
    return input.archiveRegistry.getArchive(active.archiveId)
  }

  let recoveryError = null
  if (active.state === 'publish_prepared') {
    try {
      const resolvedSupplement = active.archiveKind === 'finalized'
        ? await resolveArchiveSupplementContext({
            db: input.db,
            archiveRegistry: input.archiveRegistry,
            missionId: active.missionId,
            archiveDirectory: input.archiveDirectory,
            archiveLegacyPredecessorHashRunner: input.archiveLegacyPredecessorHashRunner,
            signal: input.signal,
          })
        : null
      if ((resolvedSupplement?.previousArchiveId ?? null) !== active.previousArchiveId
        || (resolvedSupplement?.previousArchiveSha256 ?? null)
          !== active.previousArchiveSha256) {
        const error = new Error(
          'Interrupted mission archive predecessor changed before custody recovery.',
        )
        error.code = 'ARCHIVE_SUPPLEMENT_PREDECESSOR_CHANGED'
        throw error
      }
      const publishResult = await input.archiveCustodyJournal.publishPrepared({
        expectedRevision: active.revision,
        operationId: active.operationId,
        signal: input.signal,
      })
      return sealPublishedArchiveFromJournal({
        db: input.db,
        archiveDirectory: input.archiveDirectory,
        archiveRegistry: input.archiveRegistry,
        archiveCustodyJournal: input.archiveCustodyJournal,
        operationId: active.operationId,
        expectedRevision: active.revision,
        publishResult,
        resolvedSupplement,
      })
    } catch (error) {
      if (input.signal?.aborted === true || error?.code === 'ARCHIVE_CANCELLED') throw error
      recoveryError = error
    }
  }

  const settlement = await input.archiveCustodyJournal.reconcileActive({
    signal: input.signal,
  })
  if (settlement === null) return null
  if (settlement.state === 'registered') {
    return input.archiveRegistry.getArchive(active.archiveId)
  }
  if (settlement.state === 'conflict') {
    const error = new Error('Archive custody conflict requires explicit review.')
    error.code = 'ARCHIVE_CUSTODY_RECOVERY_REQUIRED'
    throw error
  }
  recordInterruptedArchiveFailure(input.db, active, settlement, recoveryError)
  return settlement
}

/** Clears only the exact interrupted fence after custody reached a safe terminal outcome. */
function recordInterruptedArchiveFailure(db, active, settlement, cause) {
  db.transaction(() => {
    const expectedMissionStatuses = active.archiveKind === 'finalized'
      ? ['finished']
      : active.archiveKind === 'finalized_recovery'
        ? ['finalized']
        : ['finished', 'finalized']
    assertEncryptedArchiveRequestStillCurrent(db, {
      missionId: active.missionId,
      requestedAt: active.fenceRequestedAt,
      requestEventId: active.requestEventId,
      requestEventRowid: active.requestEventRowid,
      archiveId: active.archiveId,
      operationId: active.operationId,
      archiveKind: active.archiveKind,
      expectedMissionStatuses,
      protectedFinalizationEpoch: active.protectedFinalizationEpoch,
      previousArchiveId: active.previousArchiveId,
      previousArchiveSha256: active.previousArchiveSha256,
    })
    appendEvent(db, active.missionId, 'mission_archive_failed', {
      archive_id: active.archiveId,
      operation_id: active.operationId,
      archive_kind: active.archiveKind,
      protected_finalization_epoch: active.protectedFinalizationEpoch,
      resulting_status: getMission(db, active.missionId).status,
      custody_outcome: settlement.state,
      error_code: stableArchiveFailureCode(cause, 'ARCHIVE_CREATE_INTERRUPTED'),
    })
    const removed = db.prepare(`DELETE FROM mission_finalization_fences
      WHERE mission_id = ? AND requested_at = ?`)
      .run(active.missionId, active.fenceRequestedAt)
    if (removed.changes !== 1) {
      throw new Error('Interrupted archive fence changed before safe settlement.')
    }
  }).immediate()
}

/** Commits one published archive, lifecycle transition, exact fence removal, and journal settlement. */
function sealPublishedArchiveFromJournal(input) {
  const active = input.archiveCustodyJournal.readActive()
  if (active?.operationId !== input.operationId
    || active.revision !== input.expectedRevision
    || active.state !== 'publish_prepared'
    || active.receipt === null) {
    throw new Error('Mission archive custody journal changed before sealing.')
  }
  assertPublishedIdentityMatchesReceipt(input.publishResult?.targetIdentity, active.receipt)
  const mission = getMission(input.db, active.missionId)
  const expectedMissionStatuses = active.archiveKind === 'finalized'
    ? ['finished']
    : active.archiveKind === 'finalized_recovery'
      ? ['finalized']
      : ['finished', 'finalized']
  if (!expectedMissionStatuses.includes(mission.status)) {
    throw new Error('Mission state changed while the encrypted archive was being sealed.')
  }
  assertLegacyMissionObjectBackfillSettled(input.db)
  assertLegacyEventProvenanceReady(input.db, active.missionId)
  assertNoUnsettledGpxImportState(input.db, active.missionId)
  if (active.protectedFinalizationEpoch !== null) {
    if (mission.status !== 'finalized'
      || readLatestMissionFinalizedEpoch(input.db, active.missionId)
        !== active.protectedFinalizationEpoch) {
      throw new Error('Mission finalization epoch changed before archive sealing.')
    }
  }
  const resolvedSupplement = active.archiveKind === 'finalized'
    ? input.resolvedSupplement ?? null
    : null
  const currentSupplement = active.archiveKind === 'finalized'
    ? assertArchiveSupplementCandidateCurrent(
        input.db,
        input.archiveRegistry,
        active.missionId,
        resolvedSupplement,
      )
    : null
  if ((resolvedSupplement?.previousArchiveId ?? null) !== active.previousArchiveId
    || (resolvedSupplement?.previousArchiveSha256 ?? null)
      !== active.previousArchiveSha256
    || (currentSupplement?.previousArchiveId ?? null) !== active.previousArchiveId) {
    throw new Error('Mission archive correction authorization changed before archive sealing.')
  }
  if (active.previousArchiveId !== null) {
    const previous = input.archiveRegistry.getArchive(active.previousArchiveId)
    const previousContainerVersion = Number(previous.container_version)
    if (previous.mission_id !== active.missionId
      || ![1, 2].includes(previousContainerVersion)
      || (previousContainerVersion === 1 && previous.ciphertext_sha256 !== null)
      || (previousContainerVersion === 2
        && previous.ciphertext_sha256 !== active.previousArchiveSha256)
      || resolvedSupplement?.previousArchiveContainerVersion !== previousContainerVersion) {
      throw new Error('Mission archive predecessor changed before archive sealing.')
    }
  } else if (active.previousArchiveSha256 !== null) {
    throw new Error('Mission archive predecessor identity is incomplete.')
  }

  const registeredAt = now()
  return withPinnedArchiveSupplementPredecessor(
    resolvedSupplement,
    input.archiveDirectory,
    (assertPredecessorUnchanged) => input.db.transaction(() => {
    assertPredecessorUnchanged()
    assertArchiveSupplementCandidateCurrent(
      input.db,
      input.archiveRegistry,
      active.missionId,
      resolvedSupplement,
    )
    assertEncryptedArchiveRequestStillCurrent(input.db, {
      missionId: active.missionId,
      requestedAt: active.fenceRequestedAt,
      requestEventId: active.requestEventId,
      requestEventRowid: active.requestEventRowid,
      archiveId: active.archiveId,
      operationId: active.operationId,
      archiveKind: active.archiveKind,
      expectedMissionStatuses,
      protectedFinalizationEpoch: active.protectedFinalizationEpoch,
      previousArchiveId: active.previousArchiveId,
      previousArchiveSha256: active.previousArchiveSha256,
    })
    const current = input.archiveCustodyJournal.readActive()
    if (current?.operationId !== active.operationId
      || current.revision !== input.expectedRevision
      || current.state !== 'publish_prepared') {
      throw new Error('Mission archive custody journal changed inside the seal transaction.')
    }
    assertPredecessorUnchanged()
    const receipt = current.receipt
    const resultingStatus = current.archiveKind === 'finalized'
      ? 'finalized'
      : getMission(input.db, current.missionId).status
    const sealedEventId = insertEvent(
      input.db,
      current.missionId,
      'mission_archive_sealed_v2',
      current.createdAt,
      {
        archive_id: current.archiveId,
        request_event_rowid: current.requestEventRowid,
        request_event_id: current.requestEventId,
        creation_operation_id: current.operationId,
        protected_finalization_epoch: current.protectedFinalizationEpoch,
        relative_path: current.finalRelativePath,
        ciphertext_sha256: receipt.ciphertextSha256,
        size_bytes: receipt.sizeBytes,
        frame_count: receipt.frameCount,
        header_sha256: receipt.headerSha256,
        manifest_sha256: receipt.manifestSha256,
        entry_count: receipt.entryCount,
        table_count: receipt.tableCount,
        inventory_sha256: receipt.inventorySha256,
        publish_file_identity: input.publishResult.targetIdentity,
        resulting_status: resultingStatus,
      },
    )
    const archive = input.archiveRegistry.registerSealedArchive({
      id: current.archiveId,
      missionId: current.missionId,
      requestEventRowid: current.requestEventRowid,
      requestEventId: current.requestEventId,
      creationOperationId: current.operationId,
      protectedFinalizationEpoch: current.protectedFinalizationEpoch,
      archiveKind: current.archiveKind,
      containerVersion: receipt.containerVersion,
      relativePath: current.finalRelativePath,
      ciphertextSha256: receipt.ciphertextSha256,
      sizeBytes: receipt.sizeBytes,
      createdAt: current.createdAt,
      sealedEventId,
      frameCount: receipt.frameCount,
      headerSha256: receipt.headerSha256,
      manifestSha256: receipt.manifestSha256,
      entryCount: receipt.entryCount,
      tableCount: receipt.tableCount,
      previousArchiveId: current.previousArchiveId,
      slots: receipt.slots,
    })
    if (current.archiveKind === 'finalized') {
      if (resolvedSupplement !== null) {
        const supplementSequence = Number(input.db.prepare(`SELECT
            COALESCE(MAX(supplement_sequence), 0) + 1 AS next_sequence
          FROM mission_archive_supplements WHERE mission_id = ?`)
          .get(current.missionId).next_sequence)
        const supplementEventId = deriveArchiveLifecycleEventId(current.archiveId, 'supplement')
        insertEventWithId(
          input.db,
          supplementEventId,
          current.missionId,
          'mission_archive_supplement_recorded',
          current.fenceRequestedAt,
          {
            archive_id: current.archiveId,
            previous_archive_id: resolvedSupplement.previousArchiveId,
            supplement_sequence: supplementSequence,
            authority: resolvedSupplement.authority,
            reason: resolvedSupplement.reason,
            resulting_status: 'finalized',
          },
          current.fenceRequestedAt,
        )
        input.archiveRegistry.recordSupplement({
          id: randomUUID(),
          missionId: current.missionId,
          archiveId: current.archiveId,
          previousArchiveId: resolvedSupplement.previousArchiveId,
          supplementSequence,
          authority: resolvedSupplement.authority,
          reason: resolvedSupplement.reason,
          createdAt: current.fenceRequestedAt,
          auditEventId: supplementEventId,
        })
      }
      input.db.prepare('UPDATE missions SET status = ? WHERE id = ?')
        .run('finalized', current.missionId)
      insertEventWithId(input.db, deriveArchiveLifecycleEventId(current.archiveId, 'mission-finalized'), current.missionId, 'mission_finalized', current.fenceRequestedAt, {
        resulting_status: 'finalized',
        archive_id: current.archiveId,
        archive_path: path.join(input.archiveDirectory, current.finalRelativePath),
        archive_relative_path: current.finalRelativePath,
        container_version: 2,
      }, current.fenceRequestedAt)
    }
    const removed = input.db.prepare(`DELETE FROM mission_finalization_fences
      WHERE mission_id = ? AND requested_at = ?`)
      .run(current.missionId, current.fenceRequestedAt)
    if (removed.changes !== 1) {
      throw new Error('Mission finalization evidence fence changed before sealing.')
    }
    input.archiveCustodyJournal.completeRegisteredWithinTransaction({
      expectedRevision: input.expectedRevision,
      operationId: current.operationId,
      registeredAt,
    })
    return archive
    }).immediate(),
  )
}

/** Requires the published target to be the exact staged inode covered by the creation receipt. */
function assertPublishedIdentityMatchesReceipt(targetIdentity, receipt) {
  const source = receipt.temporaryFileIdentity
  let changedTimeDidNotRegress = false
  try {
    changedTimeDidNotRegress = BigInt(targetIdentity?.changedTimeNanoseconds ?? '-1')
      >= BigInt(source.changedTimeNanoseconds)
  } catch {}
  if (targetIdentity === null || typeof targetIdentity !== 'object'
    || targetIdentity.device !== source.device
    || targetIdentity.inode !== source.inode
    || targetIdentity.modifiedTimeNanoseconds !== source.modifiedTimeNanoseconds
    || targetIdentity.sizeBytes !== source.sizeBytes
    || targetIdentity.linkCount !== 1
    || !changedTimeDidNotRegress) {
    throw new Error('Published mission archive identity differs from its staged creation receipt.')
  }
}

/** Revalidates all immutable request and PR5 fence identities before a custody transition. */
function assertEncryptedArchiveRequestStillCurrent(db, input) {
  if (!input.expectedMissionStatuses.includes(getMission(db, input.missionId).status)) {
    throw new Error('Mission state changed while the encrypted archive was being created.')
  }
  const fence = db.prepare(`SELECT requested_at FROM mission_finalization_fences
    WHERE mission_id = ?`).get(input.missionId)
  const event = db.prepare(`SELECT rowid AS event_rowid, id, mission_id, event_type,
      timestamp, details_json FROM mission_events WHERE id = ?`).get(input.requestEventId)
  let details = null
  try { details = JSON.parse(event?.details_json ?? 'null') } catch {}
  if (fence?.requested_at !== input.requestedAt
    || event?.id !== input.requestEventId
    || Number(event?.event_rowid) !== input.requestEventRowid
    || event?.mission_id !== input.missionId
    || event?.event_type !== (input.archiveKind === 'finalized'
      ? 'mission_finalize_requested'
      : 'mission_archive_requested')
    || event?.timestamp !== input.requestedAt
    || details?.archive_id !== input.archiveId
    || details?.operation_id !== input.operationId
    || details?.archive_kind !== input.archiveKind
    || details?.archive_relative_path !== `${input.archiveId}.sararch`
    || details?.protected_finalization_epoch !== input.protectedFinalizationEpoch
    || details?.previous_archive_id !== input.previousArchiveId
    || details?.previous_archive_sha256 !== input.previousArchiveSha256) {
    throw new Error('Mission archive request or evidence fence changed before custody transition.')
  }
}

/** Projects one registry row for the application API without exposing custody internals. */
function projectArchiveRegistryRow(row, archiveDirectory) {
  return Object.freeze({
    ...row,
    archive_path: path.join(archiveDirectory, row.relative_path),
  })
}

/** Projects one bounded operator-facing custody row without stored proof blobs. */
function projectArchiveCustodyRow(row, archiveDirectory, db) {
  const revision = row.revision_sequence === undefined
    ? db.prepare(`SELECT
        CASE WHEN predecessor.container_version = 1
          THEN json_extract(request.details_json, '$.previous_archive_sha256')
          ELSE predecessor.ciphertext_sha256 END AS previous_archive_sha256,
        json_extract(request.details_json, '$.previous_archive_id')
          AS request_previous_archive_id,
        CASE WHEN supplement.supplement_sequence IS NULL
          THEN 1 ELSE supplement.supplement_sequence + 1 END AS revision_sequence,
        COALESCE(totals.supplement_count, 0) + 1 AS revision_count,
        supplement.authority AS supplement_authority,
        supplement.reason AS supplement_reason,
        supplement.created_at AS supplement_created_at
      FROM mission_archives AS archives
      LEFT JOIN mission_archives AS predecessor
        ON predecessor.id = archives.previous_archive_id
      LEFT JOIN mission_events AS request
        ON request.rowid = archives.request_event_rowid
      LEFT JOIN mission_archive_supplements AS supplement
        ON supplement.archive_id = archives.id
      LEFT JOIN (
        SELECT mission_id, COUNT(*) AS supplement_count
        FROM mission_archive_supplements GROUP BY mission_id
      ) AS totals ON totals.mission_id = archives.mission_id
      WHERE archives.id = ?`).get(row.id)
    : row
  const revisionSequence = Number(revision?.revision_sequence)
  const revisionCount = Number(revision?.revision_count)
  if (!Number.isSafeInteger(revisionSequence) || revisionSequence < 1
    || !Number.isSafeInteger(revisionCount) || revisionCount < revisionSequence
    || (row.previous_archive_id === null
      ? revision?.request_previous_archive_id !== null
      : revision?.request_previous_archive_id !== row.previous_archive_id)
    || (revision?.previous_archive_sha256 !== null
      && (typeof revision?.previous_archive_sha256 !== 'string'
        || !/^[0-9a-f]{64}$/u.test(revision.previous_archive_sha256)))
    || (revisionSequence === 1 && (
      revision?.supplement_authority !== null
      || revision?.supplement_reason !== null
      || revision?.supplement_created_at !== null
    ))
    || (revisionSequence > 1 && (
      typeof revision?.supplement_authority !== 'string'
      || revision.supplement_authority.trim() === ''
      || typeof revision?.supplement_reason !== 'string'
      || revision.supplement_reason.trim() === ''
      || typeof revision?.supplement_created_at !== 'string'
      || Number.isNaN(Date.parse(revision.supplement_created_at))
    ))) {
    throw new Error('Mission archive revision chain is corrupt.')
  }
  let slots
  try {
    slots = JSON.parse(row.slots_json)
  } catch {
    throw new Error('Mission archive slot inventory is corrupt.')
  }
  if (!Array.isArray(slots) || slots.length > 3) {
    throw new Error('Mission archive slot inventory is corrupt.')
  }
  return Object.freeze({
    id: row.id,
    mission_id: row.mission_id,
    request_event_rowid: Number(row.request_event_rowid),
    protected_finalization_epoch: row.protected_finalization_epoch === null
      ? null
      : Number(row.protected_finalization_epoch),
    archive_kind: row.archive_kind,
    container_version: Number(row.container_version),
    relative_path: row.relative_path,
    archive_path: path.join(archiveDirectory, row.relative_path),
    ciphertext_sha256: row.ciphertext_sha256,
    size_bytes: row.size_bytes === null ? null : Number(row.size_bytes),
    created_at: row.created_at,
    verified_at: row.verified_at,
    previous_archive_id: row.previous_archive_id,
    previous_archive_sha256: revision.previous_archive_sha256,
    revision_sequence: revisionSequence,
    revision_count: revisionCount,
    supplement_authority: revision.supplement_authority,
    supplement_reason: revision.supplement_reason,
    supplement_created_at: revision.supplement_created_at,
    status: row.status,
    availability: row.availability,
    availability_reason: row.availability_reason,
    slots: Object.freeze(slots.map((slot) => Object.freeze({
      slotId: slot.slotId,
      slotType: slot.slotType,
    }))),
    last_non_machine_unwrap_at: row.last_non_machine_unwrap_at,
  })
}

/** Validates an optional trusted archive operation context. */
function normalizeArchiveOperationContext(input) {
  if (input === undefined || input === null) return null
  if (typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).sort().join(',') !== 'onProgress,operationId'
    || typeof input.onProgress !== 'function') {
    throw new Error('Mission archive operation context is invalid.')
  }
  return Object.freeze({
    operationId: normalizeArchiveOperationId(input.operationId),
    onProgress: input.onProgress,
  })
}

/** Validates the non-secret mission/archive pair shared by cleanup query and resume. */
function normalizeMissionCleanupResumeInput(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).sort().join(',') !== 'archiveId,missionId'
    || typeof input.archiveId !== 'string' || input.archiveId.length < 1
    || Buffer.byteLength(input.archiveId, 'utf8') > 200
    || typeof input.missionId !== 'string' || input.missionId.length < 1
    || Buffer.byteLength(input.missionId, 'utf8') > 200
    || /[\u0000-\u001f\u007f]/u.test(input.archiveId)
    || /[\u0000-\u001f\u007f]/u.test(input.missionId)) {
    throw new Error('Mission cleanup identity is invalid.')
  }
  return Object.freeze({ archiveId: input.archiveId, missionId: input.missionId })
}

/** Validates one bounded non-machine cleanup credential without retaining a copy. */
function normalizeMissionCleanupStartInput(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).sort().join(',') !== 'archiveId,missionId,secret,slotType') {
    throw new Error('Mission cleanup request is invalid.')
  }
  const identity = normalizeMissionCleanupResumeInput({
    archiveId: input.archiveId,
    missionId: input.missionId,
  })
  if (!['passphrase', 'recovery'].includes(input.slotType)
    || typeof input.secret !== 'string'
    || Buffer.byteLength(input.secret, 'utf8') < 1
    || Buffer.byteLength(input.secret, 'utf8') > 1_024
    || /[\u0000-\u001f\u007f]/u.test(input.secret)) {
    throw new Error('Mission cleanup credential is invalid.')
  }
  return Object.freeze({ ...identity, slotType: input.slotType })
}

/** Validates the main-owned review-state snapshot used by an eligibility read. */
function normalizeArchiveCleanupEligibilityContext(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).join(',') !== 'reviewActivity'
    || typeof input.reviewActivity !== 'boolean') {
    throw new Error('Mission cleanup eligibility context is invalid.')
  }
  return Object.freeze({ reviewActivity: input.reviewActivity })
}

/** Validates the main-owned cleanup operation identity, progress sink and review lease state. */
function normalizeArchiveCleanupOperationContext(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).sort().join(',') !== 'onProgress,operationId,reviewActivity'
    || typeof input.onProgress !== 'function'
    || typeof input.reviewActivity !== 'boolean'
    || typeof input.operationId !== 'string'
    || !ARCHIVE_UUID_V4.test(input.operationId)) {
    throw new Error('Mission cleanup operation context is invalid.')
  }
  return Object.freeze({
    operationId: input.operationId,
    onProgress: input.onProgress,
    reviewActivity: input.reviewActivity,
  })
}

/** Projects a registry-issued review ticket into the closed credential worker request. */
function createArchiveCleanupCredentialRequest({
  ticket,
  archiveDirectory,
  operationId,
  slotType,
}) {
  return Object.freeze({
    archiveId: ticket.archiveId,
    archiveKind: ticket.archiveKind,
    archiveRelativePath: ticket.archiveRelativePath,
    missionId: ticket.missionId,
    requestEventRowid: ticket.requestEventRowid,
    requestEventId: ticket.requestEventId,
    creationOperationId: ticket.creationOperationId,
    protectedFinalizationEpoch: ticket.protectedFinalizationEpoch,
    createdAt: ticket.createdAt,
    previousArchiveSha256: ticket.previousArchiveSha256,
    containerVersion: ticket.containerVersion,
    schemaVersion: ticket.schemaVersion,
    inventoryVersion: ticket.inventoryVersion,
    ciphertextSha256: ticket.ciphertextSha256,
    sizeBytes: ticket.sizeBytes,
    frameCount: ticket.frameCount,
    headerSha256: ticket.headerSha256,
    manifestSha256: ticket.manifestSha256,
    entryCount: ticket.entryCount,
    tableCount: ticket.tableCount,
    archiveDirectory,
    operationId,
    slotType,
  })
}

/** Prevents a registry or proof substitution while the fresh credential worker runs. */
function assertArchiveCleanupTicketUnchanged(expected, current) {
  const keys = [
    'archiveId', 'archiveKind', 'archiveRelativePath', 'missionId',
    'requestEventRowid', 'requestEventId', 'creationOperationId',
    'protectedFinalizationEpoch', 'createdAt', 'previousArchiveSha256',
    'containerVersion', 'schemaVersion', 'inventoryVersion', 'ciphertextSha256',
    'sizeBytes', 'frameCount', 'headerSha256', 'manifestSha256', 'entryCount',
    'tableCount', 'verifiedAt', 'availability', 'status',
  ]
  if (keys.some((key) => expected[key] !== current[key])) {
    const error = new Error('Mission cleanup archive identity changed during credential proof.')
    error.code = 'ARCHIVE_CLEANUP_IDENTITY_CHANGED'
    throw error
  }
  assertArchiveCleanupFileIdentityUnchanged(
    expected.custodyFileIdentity,
    current.custodyFileIdentity,
  )
}

/** Requires two independently normalized custody identities to name one unchanged file. */
function assertArchiveCleanupFileIdentityUnchanged(expectedInput, currentInput) {
  const expected = normalizeCustodyFileIdentity(expectedInput)
  const current = normalizeCustodyFileIdentity(currentInput)
  if (Object.keys(expected).some((key) => expected[key] !== current[key])) {
    const error = new Error('Mission cleanup archive file identity changed.')
    error.code = 'ARCHIVE_CLEANUP_IDENTITY_CHANGED'
    throw error
  }
}

/** Requires one bounded archive operation identity for cancellation ownership. */
function normalizeArchiveOperationId(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 100
    || Buffer.byteLength(value, 'utf8') > 100
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(value)) {
    throw new Error('Mission archive operation identity is invalid.')
  }
  return value
}

/** Creates the stable cancellation used before any archive-family worker is entered. */
function createArchiveCancellationError() {
  const error = new Error('Mission archive operation was cancelled before it started.')
  error.name = 'AbortError'
  error.code = 'ARCHIVE_CANCELLED'
  return error
}

/** Validates the exact two-secret retry request before it can enter a worker queue. */
function normalizeArchiveVerificationRetryInput(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).sort().join(',') !== 'archiveId,passphrase,recoveryCode'
    || typeof input.archiveId !== 'string' || input.archiveId.length < 1
    || Buffer.byteLength(input.archiveId, 'utf8') > 200
    || typeof input.passphrase !== 'string' || input.passphrase.length < 14
    || Buffer.byteLength(input.passphrase, 'utf8') > 1_024
    || typeof input.recoveryCode !== 'string'
    || !/^(?:[0-9A-HJKMNP-TV-Z]{5}-){7}[0-9A-HJKMNP-TV-Z]{5}$/u
      .test(input.recoveryCode)) {
    throw new Error('Mission archive verification request is invalid.')
  }
  return Object.freeze({
    archiveId: input.archiveId,
    passphrase: input.passphrase,
    recoveryCode: input.recoveryCode,
  })
}

/** Prevents delayed verification from blessing a superseded finalization epoch. */
function assertArchiveVerificationEpochCurrent(db, archive) {
  const mission = getMission(db, archive.mission_id)
  if (archive.archive_kind === 'finalized') {
    const finalized = db.prepare(`SELECT rowid AS event_rowid, details_json
      FROM mission_events WHERE mission_id = ? AND event_type = 'mission_finalized'
      ORDER BY rowid DESC LIMIT 1`).get(archive.mission_id)
    const details = readEventDetails(finalized?.details_json)
    if (mission.status !== 'finalized' || details.archive_id !== archive.id) {
      const error = new Error(
        'Mission finalization epoch changed before archive verification could commit.',
      )
      error.code = 'ARCHIVE_VERIFY_EPOCH_CHANGED'
      throw error
    }
    return
  }
  if (archive.protected_finalization_epoch !== null
    && (mission.status !== 'finalized'
      || readLatestMissionFinalizedEpoch(db, archive.mission_id)
        !== Number(archive.protected_finalization_epoch))) {
    const error = new Error(
      'Mission finalization epoch changed before archive verification could commit.',
    )
    error.code = 'ARCHIVE_VERIFY_EPOCH_CHANGED'
    throw error
  }
}

/** Atomically rechecks the protected mission epoch and commits one verification proof. */
function commitArchiveVerificationIfEpochCurrent(input) {
  const commit = input.db.transaction(() => {
    const archive = input.archiveRegistry.getArchive(input.archiveId)
    assertArchiveVerificationEpochCurrent(input.db, archive)
    return input.archiveRegistry.markVerified({
      archiveId: input.archiveId,
      verificationProof: input.verificationProof,
      verifiedAt: now(),
    })
  })
  return commit.immediate()
}

/** Maps an internal failure to a stable bounded audit code without reflecting secrets. */
function stableArchiveFailureCode(error, fallback) {
  return typeof error?.code === 'string' && /^ARCHIVE_[A-Z0-9_]{1,100}$/u.test(error.code)
    ? error.code
    : fallback
}

async function readRecoverableFinalizeArchive(
  db,
  missionId,
  readArchiveFile = fs.readFile,
  onRejectedArchive = () => undefined,
  includeDirectArchives = false,
  expectedFinalizedEpoch = null,
) {
  const latestUnlock = db.prepare(
    `SELECT rowid AS event_rowid, timestamp FROM mission_events
      WHERE mission_id = ? AND event_type = ?
      ORDER BY timestamp DESC, rowid DESC
      LIMIT 1`,
  ).get(missionId, 'mission_unlocked')

  const rows = includeDirectArchives
    ? db.prepare(
      `SELECT rowid AS event_rowid, event_type, timestamp, details_json FROM mission_events
        WHERE mission_id = ? AND event_type IN (?, ?)
        ORDER BY timestamp DESC, rowid DESC`,
    ).all(missionId, 'mission_archive_succeeded', 'mission_archived')
    : db.prepare(
      `SELECT rowid AS event_rowid, event_type, timestamp, details_json FROM mission_events
        WHERE mission_id = ? AND event_type = ?
        ORDER BY timestamp DESC, rowid DESC`,
    ).all(missionId, 'mission_archive_succeeded')

  for (const row of rows) {
    if (latestUnlock !== undefined && !isEventAfter(row, latestUnlock)) {
      continue
    }
    const details = readEventDetails(row.details_json)
    if (row.event_type === 'mission_archived' && (
      details.archive_kind !== 'finalized_recovery'
      || details.finalization_epoch !== expectedFinalizedEpoch
    )) {
      continue
    }
    const archivePath = typeof details.archive_path === 'string' ? details.archive_path : ''
    if (archivePath === '') {
      continue
    }

    try {
      const archiveBytes = await readArchiveFile(archivePath)
      const entries = validateArchiveFile(archiveBytes, missionId)
      await validateSqliteSnapshotBuffer(
        entries.get('mission-store.sqlite'),
        'Recovered mission archive embedded SQLite snapshot',
        path.dirname(archivePath),
        (snapshotDb) => {
          assertLegacyMissionObjectBackfillSettled(snapshotDb)
          assertLegacyEventProvenanceReady(snapshotDb, missionId)
          assertNoUnsettledGpxImportState(snapshotDb, missionId)
        },
      )
    } catch {
      onRejectedArchive(archivePath)
      continue
    }

    return {
      mission_id: missionId,
      archive_path: archivePath,
      created_at: typeof row.timestamp === 'string' ? row.timestamp : now(),
    }
  }
  return null
}

function isEventAfter(candidate, reference) {
  const candidateTimestamp = typeof candidate.timestamp === 'string' ? candidate.timestamp : ''
  const referenceTimestamp = typeof reference.timestamp === 'string' ? reference.timestamp : ''
  if (candidateTimestamp > referenceTimestamp) {
    return true
  }
  if (candidateTimestamp < referenceTimestamp) {
    return false
  }
  return Number(candidate.event_rowid) > Number(reference.event_rowid)
}

function readEventDetails(input) {
  if (typeof input !== 'string' || input.trim() === '') {
    return {}
  }

  try {
    const parsed = JSON.parse(input)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

async function unlockFinalizedMission(
  db,
  input,
  readAdminRoster,
  reconcileFinalizedArchive = async () => undefined,
  rehydrateArchivedMission = null,
) {
  const missionId = normalizeBoundedRequiredText(
    input?.mission_id,
    'Mission correction mission identity',
    200,
  )
  const adminName = normalizeCorrectionAuthorityInput(
    input?.admin_name,
    'Mission correction authority',
    160,
  )
  const reason = normalizeCorrectionAuthorityInput(
    input?.reason,
    'Mission correction reason',
    4_000,
  )
  const operationId = typeof input?.operation_id === 'string'
    && /^[A-Za-z0-9_-]{1,200}$/u.test(input.operation_id)
    ? input.operation_id
    : undefined
  const mission = getMission(db, missionId)
  if (mission.status !== 'finalized') {
    throw new Error('Only finalized missions can be unlocked.')
  }
  if (mission.storage_state === 'cleanup_in_progress') {
    throw new Error(
      'Mission live-store archival is in progress. Wait for its durable cleanup to finish or recover before unlocking.',
    )
  }
  if (mission.storage_state === 'archived') {
    if (rehydrateArchivedMission === null
      || typeof input?.snapshot_path !== 'string'
      || typeof input?.archive_id !== 'string') {
      throw new Error(
        'This mission is archived. Open its verified archive and choose Restore for correction before requesting an unlock.',
      )
    }
    const finalized = db.prepare(`SELECT details_json FROM mission_events
      WHERE mission_id = ? AND event_type = 'mission_finalized'
      ORDER BY rowid DESC LIMIT 1`).get(missionId)
    const finalizedDetails = readEventDetails(finalized?.details_json)
    if (finalizedDetails.archive_id !== input.archive_id) {
      const error = new Error('Archived mission correction archive is not the current finalization.')
      error.code = 'ARCHIVE_REHYDRATE_EPOCH_CHANGED'
      throw error
    }
    await reconcileFinalizedArchive(missionId)
    assertCurrentFinalizedArchiveReviewable(db, missionId)
    const finalizedEpoch = readLatestMissionFinalizedEpoch(db, missionId)
    const adminRoster = typeof readAdminRoster === 'function' ? await readAdminRoster() : []
    if (!adminRoster.map((value) => value.trim()).includes(adminName)) {
      const deniedTransaction = db.transaction(() => {
        const current = getMission(db, missionId)
        if (current.status !== 'finalized' || current.storage_state !== 'archived'
          || readLatestMissionFinalizedEpoch(db, missionId) !== finalizedEpoch) {
          const error = new Error('Mission finalization changed while admin authorization was checked.')
          error.code = 'ARCHIVE_REHYDRATE_EPOCH_CHANGED'
          throw error
        }
        insertEvent(db, missionId, 'mission_unlock_denied', now(), {
          admin_name: adminName,
          reason,
          resulting_status: 'finalized',
          storage_state: 'archived',
        })
      })
      deniedTransaction.immediate()
      throw new Error('Selected admin is not authorized to unlock finalized missions.')
    }
    await rehydrateArchivedMission({
      missionId,
      archiveId: input.archive_id,
      operationId,
      snapshotPath: input.snapshot_path,
      attachmentDirectory: input.attachment_directory
        ?? path.join(path.dirname(input.snapshot_path), 'attachments'),
      attachmentMappings: input.attachment_mappings ?? [],
      finalizedEpoch,
      adminName,
      reason,
      onRestored: () => {
        const current = getMission(db, missionId)
        if (current.status !== 'finalized'
          || current.storage_state !== 'archived'
          || readLatestMissionFinalizedEpoch(db, missionId) !== finalizedEpoch) {
          const error = new Error(
            'Mission finalization or archive storage changed before correction unlock could commit.',
          )
          error.code = 'ARCHIVE_REHYDRATE_EPOCH_CHANGED'
          throw error
        }
        db.prepare('UPDATE missions SET status = ? WHERE id = ?').run('finished', missionId)
        insertEvent(db, missionId, 'mission_unlocked', now(), {
          admin_name: adminName,
          reason,
          restored_from_archive_id: input.archive_id,
          resulting_status: 'finished',
          storage_state: 'live',
        })
      },
    })
    return getMission(db, missionId)
  }
  assertMissionFinalizationNotInProgress(db, missionId)
  await reconcileFinalizedArchive(missionId)
  assertCurrentFinalizedArchiveReviewable(db, missionId)
  const finalizedEpoch = readLatestMissionFinalizedEpoch(db, missionId)
  const adminRoster = typeof readAdminRoster === 'function' ? await readAdminRoster() : []
  if (!adminRoster.map((value) => value.trim()).includes(adminName)) {
    const deniedTransaction = db.transaction(() => {
      assertMissionUnlockEpoch(db, missionId, finalizedEpoch)
      insertEvent(db, missionId, 'mission_unlock_denied', now(), {
        admin_name: adminName,
        reason,
        resulting_status: 'finalized',
      })
    })
    deniedTransaction.immediate()
    throw new Error('Selected admin is not authorized to unlock finalized missions.')
  }
  await reconcileFinalizedArchive(missionId)
  const timestamp = now()
  const transaction = db.transaction(() => {
    assertMissionUnlockEpoch(db, missionId, finalizedEpoch)
    db.prepare('UPDATE missions SET status = ? WHERE id = ?').run('finished', missionId)
    insertEvent(db, missionId, 'mission_unlocked', timestamp, {
      admin_name: adminName,
      reason,
      resulting_status: 'finished',
    })
  })
  transaction()
  return getMission(db, missionId)
}

/** Reads the immutable audit identity of the currently finalized mission epoch. */
function readLatestMissionFinalizedEpoch(db, missionId) {
  return db.prepare(`SELECT rowid FROM mission_events
    WHERE mission_id = ? AND event_type = 'mission_finalized'
    ORDER BY rowid DESC LIMIT 1`).get(missionId)?.rowid ?? null
}

/** Prevents an authorization decision from being applied to a newer finalization epoch. */
function assertMissionUnlockEpoch(
  db,
  missionId,
  expectedEpoch,
  { requireArchiveReviewable = true } = {},
) {
  assertMissionFinalizationNotInProgress(db, missionId)
  const mission = getMission(db, missionId)
  if (
    mission.status !== 'finalized' ||
    mission.storage_state !== 'live' ||
    readLatestMissionFinalizedEpoch(db, missionId) !== expectedEpoch
  ) {
    throw new Error('Mission finalization changed, or its live-storage state changed, while admin authorization was checked. Review and retry the unlock.')
  }
  if (requireArchiveReviewable) assertCurrentFinalizedArchiveReviewable(db, missionId)
}

/** Requires a v2 predecessor to be fully verified before it can enter a correction chain. */
function assertCurrentFinalizedArchiveReviewable(db, missionId) {
  const finalized = db.prepare(`SELECT details_json FROM mission_events
    WHERE mission_id = ? AND event_type = 'mission_finalized'
    ORDER BY rowid DESC LIMIT 1`).get(missionId)
  const archiveId = readEventDetails(finalized?.details_json).archive_id
  const archive = typeof archiveId === 'string' && archiveId.length > 0
    ? db.prepare(`SELECT container_version, status, verified_at,
        verification_proof_json, availability
      FROM mission_archives WHERE id = ? AND mission_id = ?`).get(archiveId, missionId)
    : db.prepare(`SELECT container_version, status, verified_at,
        verification_proof_json, availability
      FROM mission_archives
      WHERE mission_id = ? AND status != 'superseded'
      ORDER BY request_event_rowid DESC, rowid DESC LIMIT 1`).get(missionId)
  if (archive === undefined) {
    throw new Error(
      'Mission archive predecessor is unavailable from the archive registry; a correction unlock cannot create a reviewable supplemental chain.',
    )
  }
  if (Number(archive.container_version) === 1) {
    if (!['sealed', 'superseded'].includes(archive.status)
      || archive.availability !== 'present') {
      throw new Error(
        'Mission archive predecessor custody availability must be present before a correction unlock can create a reviewable supplemental chain.',
      )
    }
    return
  }
  if (Number(archive.container_version) !== 2) {
    throw new Error(
      'Mission archive predecessor format is unsupported; correction is blocked safely.',
    )
  }
  if (archive.status !== 'verified'
    || typeof archive.verified_at !== 'string'
    || archive.verified_at.length < 1
    || typeof archive.verification_proof_json !== 'string'
    || archive.verification_proof_json.length < 1
    || archive.availability !== 'present') {
    throw new Error(
      'Mission archive verification and custody availability must complete before a correction unlock can create a reviewable supplemental chain.',
    )
  }
}

function upsertDevice(db, input) {
  ensureWritableMission(db, input.mission_id)
  const id = randomUUID()
  const timestamp = localMissionObservationTimestamp(db, input.mission_id)
  // Electron intentionally diverges from the legacy Rust reference: last_seen remains
  // current on every poll, while device_updated describes only an operator-visible change.
  const existing = db
    .prepare('SELECT id, name, color, status FROM devices WHERE mission_id = ? AND device_id = ?')
    .get(input.mission_id, input.device_id)
  const transaction = db.transaction(() => {
    db.prepare(`INSERT INTO devices (
        id, mission_id, device_id, name, color, last_seen, status, group_id, unique_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(mission_id, device_id) DO UPDATE SET
        name = excluded.name, color = excluded.color, last_seen = excluded.last_seen,
        status = excluded.status, group_id = excluded.group_id, unique_id = excluded.unique_id`)
      .run(
        id, input.mission_id, input.device_id, input.name, input.color,
        input.last_seen ?? null, input.status, input.group_id ?? null,
        input.unique_id ?? null,
      )
    if (existing === undefined && input.participant_provenance === 'legacy_auto') {
      insertLegacyAutoParticipant(db, input.mission_id, input.device_id, timestamp)
    }
    if (existing === undefined || hasDeviceAuditChange(existing, input)) {
      insertEvent(
        db,
        input.mission_id,
        existing === undefined ? 'device_created' : 'device_updated',
        timestamp,
        {
          device_id: input.device_id,
          name: input.name,
          status: input.status,
          color: input.color,
        },
      )
    }
  })
  transaction()
  return getDevice(db, input.mission_id, input.device_id)
}

/** Records the flag-off first-contact participant window in the device transaction. */
function insertLegacyAutoParticipant(db, missionId, deviceId, observedAt) {
  const active = db.prepare(`SELECT 1 FROM mission_participants
    WHERE mission_id = ? AND kind = 'device' AND traccar_device_id = ?
      AND removed_at IS NULL`).get(missionId, deviceId)
  if (active !== undefined) return
  const participantId = randomUUID()
  db.prepare(`INSERT INTO mission_participants (
      id, mission_id, kind, traccar_device_id, mission_team_id, provenance,
      effective_from, added_at, added_by, removed_at, removed_by
    ) VALUES (?, ?, 'device', ?, NULL, 'legacy_auto', ?, ?, NULL, NULL, NULL)`)
    .run(participantId, missionId, deviceId, observedAt, observedAt)
  insertEvent(db, missionId, 'participant_added', observedAt, {
    participant_id: participantId,
    kind: 'device',
    traccar_device_id: deviceId,
    provenance: 'legacy_auto',
    effective_from: observedAt,
    effective_from_defaulted: true,
  })
}

/**
 * Upserts many devices in a SINGLE transaction (one commit → one fsync at synchronous=FULL).
 * The tracking poller previously upserted each device in its own transaction, so a 32-device
 * mission produced 32 fsync'd writes on the main process every poll — tens of seconds of
 * event-loop blocking on a slow field disk (DON-240). Emits device_created on first contact and
 * device_updated only for a name/status/color change, matching upsertDevice.
 */
function upsertDevicesBulk(db, input) {
  ensureWritableMission(db, input.mission_id)
  const devices = Array.isArray(input.devices) ? input.devices : []
  if (devices.length === 0) {
    return { devices: [], changedDeviceEventCount: 0 }
  }

  const existsStmt = db.prepare(
    'SELECT id, name, color, status FROM devices WHERE mission_id = ? AND device_id = ?',
  )
  const upsertStmt = db.prepare(`INSERT INTO devices (
      id, mission_id, device_id, name, color, last_seen, status, group_id, unique_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(mission_id, device_id) DO UPDATE SET
      name = excluded.name, color = excluded.color, last_seen = excluded.last_seen,
      status = excluded.status, group_id = excluded.group_id, unique_id = excluded.unique_id`)

  let changedDeviceEventCount = 0
  const observationTimestamp = localMissionObservationTimestamp(db, input.mission_id)
  const transaction = db.transaction(() => {
    for (const device of devices) {
      const existing = existsStmt.get(input.mission_id, device.device_id)
      const id = randomUUID()
      const timestamp = observationTimestamp
      upsertStmt.run(
        id,
        input.mission_id,
        device.device_id,
        device.name,
        device.color,
        device.last_seen ?? null,
        device.status,
        device.group_id ?? null,
        device.unique_id ?? null,
      )
      if (existing === undefined && input.participant_provenance === 'legacy_auto') {
        insertLegacyAutoParticipant(db, input.mission_id, device.device_id, timestamp)
      }
      if (existing === undefined || hasDeviceAuditChange(existing, device)) {
        const eventType = existing === undefined ? 'device_created' : 'device_updated'
        insertEvent(db, input.mission_id, eventType, timestamp, {
          device_id: device.device_id,
          name: device.name,
          status: device.status,
          color: device.color,
        })
        if (eventType === 'device_updated') changedDeviceEventCount += 1
      }
    }
  })
  transaction()

  return {
    devices: devices.map((device) => getDevice(db, input.mission_id, device.device_id)),
    changedDeviceEventCount,
  }
}

/** Returns local observation time without allowing audit events before mission start. */
function localMissionObservationTimestamp(db, missionId) {
  const missionStart = getMission(db, missionId).start_time
  const observedAt = now()
  return observedAt < missionStart ? missionStart : observedAt
}

/** Returns whether persisted device fields other than the polling heartbeat changed. */
function hasDeviceAuditChange(existing, input) {
  return (
    existing.name !== input.name ||
    existing.color !== input.color ||
    existing.status !== input.status
  )
}

function getDevice(db, missionId, deviceId) {
  const device = db.prepare('SELECT * FROM devices WHERE mission_id = ? AND device_id = ?').get(missionId, deviceId)
  if (device === undefined) {
    throw new Error(`Device not found: ${deviceId}`)
  }
  return device
}

function addPosition(db, input, coverageFaultInjection = {}) {
  ensureWritableMission(db, input.mission_id)
  validateLatLon(input.lat, input.lon, 'Position')
  getDevice(db, input.mission_id, input.device_id)
  const timestamp = normalizePositionTimestamp(input.timestamp)
  const dataOrigin = input.data_origin ?? 'live'
  const sourcePositionId = normalizeSourcePositionId(input.source_position_id)
  const timestampSource = normalizePositionTimestampSource(input.timestamp_source)
  const receivedAt = now()
  const normalizedInput = {
    ...input,
    source_position_id: sourcePositionId,
    timestamp,
  }
  const canonical = canonicalizeAcceptedPosition(normalizedInput)
  if (sourcePositionId !== null) {
    const existing = findPositionBySourceIdentity(
      db,
      input.mission_id,
      sourcePositionId,
    )
    if (existing !== undefined) {
      const decision = classifyPositionIngest({
        existing,
        incoming: normalizedInput,
      })
      db.transaction(() => {
        if (decision.decision === 'conflict') {
          recordConflictAnomaly(db, {
            missionId: input.mission_id,
            sourcePositionId,
            incoming: normalizedInput,
            receivedAt,
          })
        }
        if (existing.device_id === input.device_id) {
          if (decision.decision === 'duplicate' && timestampSource === 'fix'
            && existing.timestamp_source === null) {
            db.prepare(`UPDATE positions SET timestamp_source = 'fix',
              timestamp_provenance_recorded_at = ? WHERE id = ?`)
              .run(receivedAt, existing.id)
            bumpMissionReplayGeneration(db, input.mission_id)
          }
          refreshDeviceContact(db, input.mission_id, input.device_id, timestamp)
        }
      })()
      if (existing.device_id !== input.device_id) {
        throw new Error(
          `Source position ${sourcePositionId} is owned by device ${existing.device_id}; ` +
          `the conflicting observation from ${input.device_id} was retained without changing position truth.`,
        )
      }
      return getById(db, 'positions', existing.id, 'Position')
    }
    const adopt = db.transaction(() => {
      const result = adoptSourceIdentityForLegacyPosition(
        db,
        input.mission_id,
        sourcePositionId,
        input,
        timestamp,
        dataOrigin,
      )
      if (result !== undefined && result !== AMBIGUOUS_LEGACY_ADOPTION) {
        recordAcceptedCoveragePositions(db, {
          missionId: input.mission_id,
          positions: [result],
          updatedAt: receivedAt,
          failAfterWrite: coverageFaultInjection.afterWrite === true,
        })
      }
      return result
    })
    const adopted = adopt()
    if (adopted === AMBIGUOUS_LEGACY_ADOPTION) {
      throw createAmbiguousLegacyAdoptionError(sourcePositionId)
    }
    if (adopted !== undefined) {
      return adopted
    }
  }

  const id = randomUUID()
  const transaction = db.transaction(() => {
    db.prepare(`INSERT INTO positions (id, mission_id, device_id, source_position_id, name, lat, lon, altitude, speed, battery, accuracy, source, timestamp, data_origin, received_at, content_hash, source_kind, timestamp_source, timestamp_provenance_recorded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, input.mission_id, input.device_id, sourcePositionId, input.name ?? null, input.lat, input.lon, input.altitude ?? null, input.speed ?? null, input.battery ?? null, input.accuracy ?? null, input.source ?? null, timestamp, dataOrigin, receivedAt, canonical.contentHash, sourcePositionId === null ? null : 'traccar', timestampSource, timestampSource === 'fix' ? receivedAt : null)
    db.prepare(
      `UPDATE devices
       SET last_seen = CASE
         WHEN last_seen IS NULL OR julianday(?) > julianday(last_seen) THEN ?
         ELSE last_seen
       END,
       status = 'online'
       WHERE mission_id = ? AND device_id = ?`,
    ).run(timestamp, timestamp, input.mission_id, input.device_id)
    recordAcceptedCoveragePositions(db, {
      missionId: input.mission_id,
      positions: [{ device_id: input.device_id, timestamp }],
      updatedAt: receivedAt,
      failAfterWrite: coverageFaultInjection.afterWrite === true,
    })
  })
  transaction()
  return getById(db, 'positions', id, 'Position')
}

function addPositionsBulk(
  db,
  input,
  includePositions = true,
  coverageFaultInjection = {},
  requireFixTimeProvenance = false,
) {
  ensureWritableMission(db, input.mission_id)
  const positions = Array.isArray(input.positions) ? input.positions : []
  if (positions.length === 0) {
    return {
      positions: [],
      changedPositionCount: 0,
      insertedPositionCount: 0,
      skippedAmbiguousLegacyAdoptionCount: 0,
    }
  }

  const deviceExists = db.prepare('SELECT id FROM devices WHERE mission_id = ? AND device_id = ?')
  const existingPositionByCoordinate = db.prepare(
    'SELECT id FROM positions WHERE mission_id = ? AND device_id = ? AND timestamp = ? AND lat = ? AND lon = ? LIMIT 1',
  )
  const existingPositionBySourceIdentity = db.prepare(
    'SELECT * FROM positions WHERE mission_id = ? AND source_position_id = ? LIMIT 1',
  )
  const insertPosition = db.prepare(`INSERT INTO positions (id, mission_id, device_id, source_position_id, name, lat, lon, altitude, speed, battery, accuracy, source, timestamp, data_origin, received_at, content_hash, source_kind, timestamp_source, timestamp_provenance_recorded_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  const retainFixTimeProvenance = db.prepare(
    `UPDATE positions SET timestamp_source = 'fix',
      timestamp_provenance_recorded_at = ?
      WHERE id = ? AND timestamp_source IS NULL`,
  )
  const updateDevice = db.prepare(
    `UPDATE devices
     SET last_seen = CASE
       WHEN last_seen IS NULL OR julianday(?) > julianday(last_seen) THEN ?
       ELSE last_seen
     END,
     status = 'online'
     WHERE mission_id = ? AND device_id = ?`,
  )
  const seenInBatch = new Set()
  const changedIds = includePositions ? [] : null
  let changedPositionCount = 0
  let insertedPositionCount = 0
  let skippedAmbiguousLegacyAdoptionCount = 0
  let replayEligibilityChanged = false
  const acceptedCoveragePositions = []

  const transaction = db.transaction(() => {
    const receivedAt = now()
    for (const position of positions) {
      validateLatLon(position.lat, position.lon, 'Position')
      if (deviceExists.get(input.mission_id, position.device_id) === undefined) {
        throw new Error(`Device not found: ${position.device_id}`)
      }

      const timestamp = normalizePositionTimestamp(position.timestamp)
      const dataOrigin = position.data_origin ?? 'live'
      const sourcePositionId = normalizeSourcePositionId(
        position.source_position_id,
      )
      const timestampSource = normalizePositionTimestampSource(position.timestamp_source)
      if (requireFixTimeProvenance && timestampSource !== 'fix') {
        throw new Error(
          'Tracking evidence persistence requires authoritative Traccar fixTime provenance.',
        )
      }
      const normalizedPosition = {
        ...position,
        source_position_id: sourcePositionId,
        timestamp,
      }
      const canonical = canonicalizeAcceptedPosition(normalizedPosition)
      if (sourcePositionId !== null) {
        const existing = existingPositionBySourceIdentity.get(
          input.mission_id,
          sourcePositionId,
        )
        if (existing !== undefined) {
          const decision = classifyPositionIngest({
            existing,
            incoming: normalizedPosition,
          })
          if (decision.decision === 'conflict') {
            recordConflictAnomaly(db, {
              missionId: input.mission_id,
              sourcePositionId,
              incoming: normalizedPosition,
              receivedAt,
            })
          }
          if (existing.device_id === position.device_id) {
            if (decision.decision === 'duplicate' && timestampSource === 'fix') {
              const promotion = retainFixTimeProvenance.run(receivedAt, existing.id)
              replayEligibilityChanged = replayEligibilityChanged || promotion.changes > 0
            }
            updateDevice.run(
              timestamp,
              timestamp,
              input.mission_id,
              position.device_id,
            )
          }
          continue
        }
        const adopted = adoptSourceIdentityForLegacyPosition(
          db,
          input.mission_id,
          sourcePositionId,
          position,
          timestamp,
          dataOrigin,
        )
        if (adopted === AMBIGUOUS_LEGACY_ADOPTION) {
          skippedAmbiguousLegacyAdoptionCount += 1
          continue
        }
        if (adopted !== undefined) {
          changedPositionCount += 1
          changedIds?.push(adopted.id)
          acceptedCoveragePositions.push(adopted)
          continue
        }
      } else {
        const positionKey = createPositionIdentityKey(position, timestamp)
        if (seenInBatch.has(positionKey)) {
          continue
        }
        seenInBatch.add(positionKey)

        if (
          existingPositionByCoordinate.get(
            input.mission_id,
            position.device_id,
            timestamp,
            position.lat,
            position.lon,
          ) !== undefined
        ) {
          continue
        }
      }

      const id = randomUUID()
      insertPosition.run(
        id,
        input.mission_id,
        position.device_id,
        sourcePositionId,
        position.name ?? null,
        position.lat,
        position.lon,
        position.altitude ?? null,
        position.speed ?? null,
        position.battery ?? null,
        position.accuracy ?? null,
        position.source ?? null,
        timestamp,
        dataOrigin,
        receivedAt,
        canonical.contentHash,
        sourcePositionId === null ? null : 'traccar',
        timestampSource,
        timestampSource === 'fix' ? receivedAt : null,
      )
      updateDevice.run(timestamp, timestamp, input.mission_id, position.device_id)
      changedPositionCount += 1
      changedIds?.push(id)
      insertedPositionCount += 1
      acceptedCoveragePositions.push({ device_id: position.device_id, timestamp })
    }
    recordAcceptedCoveragePositions(db, {
      missionId: input.mission_id,
      positions: acceptedCoveragePositions,
      updatedAt: receivedAt,
      failAfterWrite: coverageFaultInjection.afterWrite === true,
    })
    if (replayEligibilityChanged) bumpMissionReplayGeneration(db, input.mission_id)
  })

  transaction()
  return {
    positions: changedIds?.map((id) => getById(db, 'positions', id, 'Position')) ?? [],
    changedPositionCount,
    insertedPositionCount,
    skippedAmbiguousLegacyAdoptionCount,
  }
}

function persistTrackingHistoryBatch(
  db,
  input,
  includePositions = true,
  coverageFaultInjection = {},
) {
  ensureWritableMission(db, input.mission_id)
  const checkpoints = Array.isArray(input.checkpoints) ? input.checkpoints : []
  let positionResult = {
    positions: [],
    changedPositionCount: 0,
    insertedPositionCount: 0,
    skippedAmbiguousLegacyAdoptionCount: 0,
  }
  const deviceExists = db.prepare(
    'SELECT id FROM devices WHERE mission_id = ? AND device_id = ?',
  )
  const readCheckpoint = db.prepare(
    `SELECT history_from, reconciled_until
     FROM tracking_history_checkpoints
     WHERE mission_id = ? AND device_id = ?`,
  )
  const upsertCheckpoint = db.prepare(
    `INSERT INTO tracking_history_checkpoints (
       mission_id, device_id, history_from, reconciled_until, updated_at
     ) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(mission_id, device_id) DO UPDATE SET
       history_from = excluded.history_from,
       reconciled_until = excluded.reconciled_until,
       updated_at = excluded.updated_at`,
  )

  const transaction = db.transaction(() => {
    const added = addPositionsBulk(db, {
      mission_id: input.mission_id,
      positions: Array.isArray(input.positions) ? input.positions : [],
    }, includePositions, coverageFaultInjection, true)
    positionResult = {
      ...added,
      skippedAmbiguousLegacyAdoptionCount:
        added.skippedAmbiguousLegacyAdoptionCount ?? 0,
    }

    for (const checkpoint of checkpoints) {
      if (
        typeof checkpoint?.device_id !== 'string' ||
        checkpoint.device_id.trim() === ''
      ) {
        throw new Error('Tracking history checkpoint device id is required.')
      }
      const deviceId = checkpoint.device_id.trim()
      if (deviceExists.get(input.mission_id, deviceId) === undefined) {
        throw new Error(`Device not found: ${deviceId}`)
      }
      const historyFrom = normalizeCheckpointTimestamp(
        checkpoint.history_from,
        'history start',
      )
      const reconciledUntil = normalizeCheckpointTimestamp(
        checkpoint.reconciled_until,
        'reconciled-until cursor',
      )
      if (Date.parse(reconciledUntil) < Date.parse(historyFrom)) {
        throw new Error(
          'Tracking history checkpoint reconciled-until cursor is before history start.',
        )
      }
      const existing = readCheckpoint.get(input.mission_id, deviceId)
      if (existing !== undefined && historyFrom > existing.history_from) {
        throw new Error(
          'Tracking history checkpoint start does not match the stored mission-device checkpoint.',
        )
      }
      if (
        existing !== undefined &&
        historyFrom < existing.history_from &&
        reconciledUntil < existing.history_from
      ) {
        continue
      }
      if (
        existing !== undefined &&
        existing.history_from === historyFrom &&
        Date.parse(existing.reconciled_until) >= Date.parse(reconciledUntil)
      ) {
        continue
      }
      const storedReconciledUntil =
        existing !== undefined && existing.reconciled_until > reconciledUntil
          ? existing.reconciled_until
          : reconciledUntil
      upsertCheckpoint.run(
        input.mission_id,
        deviceId,
        historyFrom,
        storedReconciledUntil,
        now(),
      )
    }
  })

  transaction()
  return positionResult
}

function listTrackingHistoryCheckpoints(db, missionId) {
  return all(
    db,
    `SELECT mission_id, device_id, history_from, reconciled_until
     FROM tracking_history_checkpoints
     WHERE mission_id = ?
     ORDER BY device_id ASC`,
    missionId,
  )
}

function normalizeCheckpointTimestamp(value, label) {
  if (!isStrictTrackingTimestamp(value)) {
    throw new Error(`Tracking history checkpoint ${label} must be a valid ISO8601 date-time.`)
  }
  return new Date(Date.parse(value)).toISOString()
}

function normalizeSourcePositionId(value) {
  if (value == null) {
    return null
  }
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('Position source identity must be a non-empty string.')
  }
  return value.trim()
}

function normalizePositionTimestamp(value) {
  if (value == null) {
    return now()
  }
  if (!isStrictTrackingTimestamp(value)) {
    throw new Error('Position timestamp must be a valid ISO8601 date-time.')
  }
  return new Date(Date.parse(value.trim())).toISOString()
}

/** Retains only the provenance that can authorize exact breadcrumb evidence. */
function normalizePositionTimestampSource(value) {
  if (value == null) return null
  if (value !== 'fix') {
    throw new Error('Position timestamp provenance must be authoritative Traccar fixTime.')
  }
  return 'fix'
}

/** Refreshes contact liveness without changing immutable position truth. */
function refreshDeviceContact(db, missionId, deviceId, timestamp) {
  db.prepare(`
    UPDATE devices
    SET last_seen = CASE
      WHEN last_seen IS NULL OR julianday(?) > julianday(last_seen) THEN ?
      ELSE last_seen
    END,
    status = 'online'
    WHERE mission_id = ? AND device_id = ?
  `).run(timestamp, timestamp, missionId, deviceId)
}

const AMBIGUOUS_LEGACY_ADOPTION = Symbol('ambiguous-legacy-adoption')

function findPositionBySourceIdentity(db, missionId, sourcePositionId) {
  return db
    .prepare(
      'SELECT * FROM positions WHERE mission_id = ? AND source_position_id = ? LIMIT 1',
    )
    .get(missionId, sourcePositionId)
}

function adoptSourceIdentityForLegacyPosition(
  db,
  missionId,
  sourcePositionId,
  input,
  timestamp,
  dataOrigin,
) {
  const candidates = db
    .prepare(
      `SELECT * FROM positions
       WHERE mission_id = ? AND device_id = ? AND source_position_id IS NULL
         AND timestamp = ? AND lat = ? AND lon = ?
         AND name IS ? AND altitude IS ? AND speed IS ? AND battery IS ?
         AND accuracy IS ? AND source IS ? AND data_origin = ?
       ORDER BY rowid ASC
       LIMIT 2`,
    )
    .all(
      missionId,
      input.device_id,
      timestamp,
      input.lat,
      input.lon,
      input.name ?? null,
      input.altitude ?? null,
      input.speed ?? null,
      input.battery ?? null,
      input.accuracy ?? null,
      input.source ?? null,
      dataOrigin,
    )
  if (candidates.length === 0) {
    return undefined
  }
  if (candidates.length > 1) {
    return AMBIGUOUS_LEGACY_ADOPTION
  }

  const candidate = candidates[0]
  db.prepare(
    'UPDATE positions SET source_position_id = ? WHERE id = ? AND source_position_id IS NULL',
  ).run(sourcePositionId, candidate.id)
  return {
    ...candidate,
    source_position_id: sourcePositionId,
  }
}

function createAmbiguousLegacyAdoptionError(sourcePositionId) {
  return new Error(
    `Position source identity conflict for ${sourcePositionId}: more than one exact legacy fix could be upgraded.`,
  )
}

function createPositionIdentityKey(position, timestamp) {
  return `${position.device_id}:fix:${timestamp}:${Number(position.lat).toFixed(7)}:${Number(position.lon).toFixed(7)}`
}

function countPositions(db, missionId, deviceId) {
  const row =
    deviceId === undefined
      ? db.prepare('SELECT COUNT(*) AS count FROM positions WHERE mission_id = ?').get(missionId)
      : db.prepare('SELECT COUNT(*) AS count FROM positions WHERE mission_id = ? AND device_id = ?').get(missionId, deviceId)
  return Number(row?.count ?? 0)
}

/**
 * Returns a fixed-size recent render/cursor window per device. Each lookup uses
 * the mission/device/timestamp index, so restart work is bounded independently
 * of total mission duration and never scans the complete positions table.
 */
function listRecentPositions(db, missionId, perDeviceLimit) {
  if (!Number.isInteger(perDeviceLimit) || perDeviceLimit < 1 || perDeviceLimit > 5_000) {
    throw new Error('Recent position limit must be a positive integer no greater than 5000.')
  }

  const deviceIds = db
    .prepare('SELECT device_id FROM devices WHERE mission_id = ? ORDER BY device_id ASC')
    .all(missionId)
    .map((row) => row.device_id)
  const selectRecent = db.prepare(`
    SELECT * FROM positions
    WHERE mission_id = ? AND device_id = ?
    ORDER BY timestamp DESC, rowid DESC
    LIMIT ?
  `)
  const positions = []
  for (const deviceId of deviceIds) {
    positions.push(...selectRecent.all(missionId, deviceId, perDeviceLimit).reverse())
  }
  return positions.sort((left, right) =>
    compareStringsByCodeUnit(left.timestamp, right.timestamp) ||
    compareStringsByCodeUnit(left.device_id, right.device_id) ||
    compareStringsByCodeUnit(left.id, right.id),
  )
}

function latestPositions(db, missionId) {
  return all(db, `SELECT position.*
    FROM devices AS device
    JOIN positions AS position ON position.id = (
      SELECT candidate.id
      FROM positions AS candidate
      WHERE candidate.mission_id = device.mission_id
        AND candidate.device_id = device.device_id
      ORDER BY candidate.timestamp DESC, candidate.id DESC
      LIMIT 1
    )
    WHERE device.mission_id = ?
    ORDER BY device.device_id ASC`, missionId)
}

// High-volume tracking heartbeats excluded from the review audit log by default.
// Mirrors src/features/mission-review/audit-events.ts (kept in sync by tests).
const TELEMETRY_EVENT_TYPES = ['device_updated', 'position_recorded', 'mission_backup_synced']
const DEFAULT_AUDIT_EVENT_LIMIT = 500
const MAX_AUDIT_EVENT_LIMIT = 5000

/**
 * Returns operator-meaningful mission events for the review audit log, ordered most
 * recent first and capped, so a long mission never transfers an unbounded event set
 * across IPC. Telemetry heartbeats are excluded unless `includeTelemetry` is set.
 */
function listAuditEvents(db, missionId, options) {
  const includeTelemetry = options?.includeTelemetry === true
  const requestedLimit = options?.limit
  const limit = clampAuditLimit(requestedLimit)

  if (includeTelemetry) {
    return all(
      db,
      'SELECT * FROM mission_events WHERE mission_id = ? ORDER BY timestamp DESC, rowid DESC LIMIT ?',
      missionId,
      limit,
    )
  }

  const placeholders = TELEMETRY_EVENT_TYPES.map(() => '?').join(', ')
  return all(
    db,
    `SELECT * FROM mission_events
     WHERE mission_id = ? AND event_type NOT IN (${placeholders})
     ORDER BY timestamp DESC, rowid DESC
     LIMIT ?`,
    missionId,
    ...TELEMETRY_EVENT_TYPES,
    limit,
  )
}

function clampAuditLimit(requestedLimit) {
  if (typeof requestedLimit !== 'number' || !Number.isFinite(requestedLimit)) {
    return DEFAULT_AUDIT_EVENT_LIMIT
  }
  const rounded = Math.floor(requestedLimit)
  if (rounded < 1) {
    return 1
  }
  return Math.min(rounded, MAX_AUDIT_EVENT_LIMIT)
}

function upsertHelicopter(db, input) {
  ensureWritableMission(db, input.mission_id)
  validateLatLon(input.lat, input.lon, 'Helicopter')
  const existing = db.prepare('SELECT id FROM helicopters WHERE mission_id = ? AND slot_key = ?').get(input.mission_id, input.slot_key)
  const id = input.id ?? existing?.id ?? randomUUID()
  const timestamp = input.last_update ?? now()
  const audit = AUDIT_EVENT_TABLES.helicopters
  const transaction = db.transaction(() => {
    db.prepare(`INSERT INTO helicopters (id, mission_id, slot_key, call_sign, hex_id, lat, lon, altitude, speed, heading, last_update, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(mission_id, slot_key) DO UPDATE SET
        call_sign = excluded.call_sign, hex_id = excluded.hex_id, lat = excluded.lat, lon = excluded.lon,
        altitude = excluded.altitude, speed = excluded.speed, heading = excluded.heading,
        last_update = excluded.last_update, updated_at = excluded.updated_at`)
      .run(id, input.mission_id, input.slot_key, input.call_sign, input.hex_id ?? null, input.lat, input.lon, input.altitude ?? null, input.speed ?? null, input.heading ?? null, timestamp, timestamp, timestamp)
    insertEvent(
      db,
      input.mission_id,
      existing === undefined ? audit.created : audit.updated,
      timestamp,
      audit.upsertDetails({ id, slot_key: input.slot_key, call_sign: input.call_sign, hex_id: input.hex_id ?? null }),
    )
  })
  transaction()
  return getById(db, 'helicopters', id, 'Helicopter')
}

/**
 * Audit-event metadata for the generic upsert/delete helpers, keeping Electron's
 * emitted event types and detail payloads in lock-step with the Rust reference
 * (`src-tauri/src/persistence.rs`) and the browser harness. Each entry names the
 * create/update/delete event types and builds the operator-facing detail object
 * recorded against the mission timeline.
 */
const AUDIT_EVENT_TABLES = {
  markers: {
    created: 'marker_created',
    updated: 'marker_updated',
    deleted: 'marker_deleted',
    upsertDetails: (row) => ({
      marker_id: row.id,
      marker_type: row.type,
      name: row.name,
      display_order: row.display_order,
      updated_by: row.updated_by ?? null,
      coordinator_ids: row.coordinator_ids ?? null,
      attachment_path: row.attachment_path ?? null,
    }),
    deleteDetails: (row) => ({
      marker_id: row.id,
      marker_type: row.type,
      name: row.name,
    }),
  },
  drawings: {
    created: 'drawing_created',
    updated: 'drawing_updated',
    deleted: 'drawing_deleted',
    upsertDetails: (row) => ({
      drawing_id: row.id,
      drawing_type: row.type,
      name: row.name,
      display_order: row.display_order,
    }),
    deleteDetails: (row) => ({
      drawing_id: row.id,
      drawing_type: row.type,
      name: row.name,
    }),
  },
  helicopters: {
    created: 'helicopter_created',
    updated: 'helicopter_updated',
    deleted: 'helicopter_deleted',
    upsertDetails: (row) => ({
      helicopter_id: row.id,
      slot_key: row.slot_key,
      call_sign: row.call_sign,
      hex_id: row.hex_id ?? null,
    }),
    deleteDetails: (row) => ({
      helicopter_id: row.id,
      slot_key: row.slot_key,
      call_sign: row.call_sign,
    }),
  },
  gpx_track_imports: {
    created: 'gpx_import_created',
    updated: 'gpx_import_updated',
    deleted: 'gpx_import_deleted',
    upsertDetails: (row) => ({
      gpx_import_id: row.id,
      source_path: row.source_path,
      file_name: row.file_name,
      display_name: row.display_name,
    }),
    deleteDetails: (row) => ({
      gpx_import_id: row.id,
      source_path: row.source_path,
      file_name: row.file_name,
      display_name: row.display_name,
    }),
  },
}

const IMMUTABLE_UPSERT_COLUMNS = {
  markers: new Set(['id', 'mission_id', 'created_at']),
  drawings: new Set(['id', 'mission_id', 'created_at']),
  gpx_track_imports: new Set(['id', 'mission_id', 'imported_at']),
}

function upsertById(db, table, input, defaults) {
  const row = defaults(input)
  const existing = db.prepare(`SELECT id, mission_id FROM ${table} WHERE id = ?`).get(row.id)
  const missionId = existing?.mission_id ?? input.mission_id
  if (existing !== undefined && existing.mission_id !== input.mission_id) {
    throw new Error(`Cannot move ${table} row ${row.id} to a different mission.`)
  }
  ensureWritableMission(db, missionId)
  const columns = Object.keys(row)
  const placeholders = columns.map(() => '?').join(', ')
  const immutableColumns = IMMUTABLE_UPSERT_COLUMNS[table] ?? new Set(['id'])
  const assignments = columns
    .filter((column) => !immutableColumns.has(column))
    .map((column) => `${column} = excluded.${column}`)
    .join(', ')
  const audit = AUDIT_EVENT_TABLES[table]
  const transaction = db.transaction(() => {
    db.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})
      ON CONFLICT(id) DO UPDATE SET ${assignments}`).run(...columns.map((column) => row[column]))
    insertEvent(
      db,
      missionId,
      existing === undefined ? audit.created : audit.updated,
      row.updated_at ?? now(),
      audit.upsertDetails(row),
    )
  })
  transaction()
  return getById(db, table, row.id, table)
}

/** Persists one current projection and its complete immutable version/audit identity atomically. */
function upsertVersionedById(
  db,
  evidenceVersionStore,
  table,
  objectType,
  input,
  defaults,
) {
  const row = defaults(input)
  const existing = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(row.id)
  const missionId = existing?.mission_id ?? input.mission_id
  if (existing !== undefined && existing.mission_id !== input.mission_id) {
    throw new Error(`Cannot move ${table} row ${row.id} to a different mission.`)
  }
  if (existing?.retired_at !== null && existing?.retired_at !== undefined) {
    throw new Error(`Cannot update retired ${objectType} evidence ${row.id}.`)
  }
  ensureWritableMission(db, missionId)
  const columns = Object.keys(row)
  const placeholders = columns.map(() => '?').join(', ')
  const immutableColumns = IMMUTABLE_UPSERT_COLUMNS[table] ?? new Set(['id'])
  const assignments = columns
    .filter((column) => !immutableColumns.has(column))
    .map((column) => `${column} = excluded.${column}`)
    .join(', ')
  const audit = AUDIT_EVENT_TABLES[table]
  const transaction = db.transaction(() => {
    db.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})
      ON CONFLICT(id) DO UPDATE SET ${assignments}`).run(...columns.map((column) => row[column]))
    const projected = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(row.id)
    const timestamp = projected.updated_at ?? now()
    const auditEventId = insertEvent(
      db,
      missionId,
      existing === undefined ? audit.created : audit.updated,
      timestamp,
      audit.upsertDetails(projected),
    )
    evidenceVersionStore.recordVersion({
      missionId,
      objectType,
      objectId: row.id,
      operation: existing === undefined ? 'created' : 'updated',
      effectiveAt: timestamp,
      recordedAt: timestamp,
      state: projected,
      actor: projected.updated_by ?? null,
      auditEventId,
    })
  })
  transaction()
  return getById(db, table, row.id, table)
}

/** Replaces destructive deletion with an append-only retirement revision. */
function retireVersionedById(db, evidenceVersionStore, table, objectType, id) {
  const existing = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id)
  if (existing === undefined || existing.retired_at !== null) return false
  ensureWritableMission(db, existing.mission_id)
  const audit = AUDIT_EVENT_TABLES[table]
  const timestamp = now()
  const actor = existing.updated_by ?? null
  const transaction = db.transaction(() => {
    db.prepare(`UPDATE ${table} SET retired_at = ?, retired_by = ? WHERE id = ?`)
      .run(timestamp, actor, id)
    const projected = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id)
    const auditEventId = insertEvent(
      db,
      existing.mission_id,
      audit.deleted,
      timestamp,
      { ...audit.deleteDetails(existing), retired: true },
    )
    evidenceVersionStore.recordVersion({
      missionId: existing.mission_id,
      objectType,
      objectId: id,
      operation: 'retired',
      effectiveAt: timestamp,
      recordedAt: timestamp,
      state: projected,
      actor,
      auditEventId,
    })
  })
  transaction()
  return true
}

/** Normalizes one renderer-owned marker before any lookup or JSON version serialization. */
function normalizeMarkerMutation(input) {
  const candidate = normalizeMutableEvidenceRecord(input, 'Marker')
  const markerType = normalizeBoundedEvidenceRequiredText(
    candidate.type, 'Marker type', MAX_SEARCH_OPERATION_SHORT_TEXT_LENGTH,
  )
  if (!['ipp_lkp', 'clue', 'hazard', 'casualty'].includes(markerType)) {
    throw new Error('Marker type is invalid.')
  }
  return {
    id: normalizeBoundedEvidenceOptionalText(
      candidate.id, 'Marker identity', MAX_SEARCH_OPERATION_ID_LENGTH,
    ),
    mission_id: normalizeBoundedEvidenceRequiredText(
      candidate.mission_id, 'Marker mission', MAX_SEARCH_OPERATION_ID_LENGTH,
    ),
    type: markerType,
    name: normalizeBoundedEvidenceRequiredText(
      candidate.name, 'Marker name', MAX_SEARCH_OPERATION_SHORT_TEXT_LENGTH,
    ),
    description: normalizeBoundedEvidenceOptionalText(
      candidate.description, 'Marker description', MAX_SEARCH_OPERATION_NOTES_LENGTH,
    ),
    lat: normalizeRequiredFiniteEvidenceNumber(candidate.lat, 'Marker latitude'),
    lon: normalizeRequiredFiniteEvidenceNumber(candidate.lon, 'Marker longitude'),
    irish_grid_e: normalizeRequiredSafeInteger(candidate.irish_grid_e, 'Marker ITM easting'),
    irish_grid_n: normalizeRequiredSafeInteger(candidate.irish_grid_n, 'Marker ITM northing'),
    display_order: normalizeRequiredSafeInteger(candidate.display_order, 'Marker display order'),
    subject_category: normalizeMarkerShortText(candidate.subject_category, 'subject category'),
    clue_type: normalizeMarkerShortText(candidate.clue_type, 'clue type'),
    confidence: normalizeOptionalFiniteEvidenceNumber(candidate.confidence, 'Marker confidence'),
    found_by: normalizeMarkerShortText(candidate.found_by, 'found by'),
    hazard_type: normalizeMarkerShortText(candidate.hazard_type, 'hazard type'),
    severity: normalizeMarkerShortText(candidate.severity, 'severity'),
    condition: normalizeMarkerShortText(candidate.condition, 'condition'),
    treatment: normalizeMarkerTreatment(candidate.treatment),
    evacuation_priority: normalizeMarkerShortText(
      candidate.evacuation_priority, 'evacuation priority',
    ),
    label_size: normalizeOptionalSafeInteger(candidate.label_size, 'Marker label size'),
    updated_by: normalizeMarkerShortText(candidate.updated_by, 'coordinator'),
    coordinator_ids: normalizeBoundedEvidenceOptionalText(
      candidate.coordinator_ids, 'Marker coordinator ids', MAX_SEARCH_OPERATION_NOTES_LENGTH,
    ),
    attachment_path: normalizeBoundedEvidenceOptionalText(
      candidate.attachment_path, 'Marker attachment path', MAX_MUTABLE_EVIDENCE_PATH_LENGTH,
    ),
  }
}

/** Normalizes one optional marker short-text field. */
function normalizeMarkerShortText(value, label) {
  return normalizeBoundedEvidenceOptionalText(
    value, `Marker ${label}`, MAX_SEARCH_OPERATION_SHORT_TEXT_LENGTH,
  )
}

/** Normalizes one cumulative casualty treatment log inside its evidence envelope. */
function normalizeMarkerTreatment(value) {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new Error('Marker treatment log must be text.')
  const normalized = value.trim()
  if (normalized === '') return null
  if (Buffer.byteLength(normalized, 'utf8') > MAX_MARKER_TREATMENT_LOG_BYTES) {
    throw new Error(
      `Marker treatment log must be ${MAX_MARKER_TREATMENT_LOG_BYTES} UTF-8 bytes or fewer. `
      + 'Earlier saved entries remain preserved; shorten only the newest unsaved update.',
    )
  }
  return normalized
}

function markerDefaults(input) {
  validateLatLon(input.lat, input.lon, 'Marker')
  const timestamp = now()
  return {
    id: input.id ?? randomUUID(),
    mission_id: input.mission_id,
    type: input.type,
    name: input.name,
    description: input.description ?? null,
    lat: input.lat,
    lon: input.lon,
    irish_grid_e: input.irish_grid_e,
    irish_grid_n: input.irish_grid_n,
    created_at: timestamp,
    updated_at: timestamp,
    display_order: input.display_order,
    subject_category: input.subject_category ?? null,
    clue_type: input.clue_type ?? null,
    confidence: input.confidence ?? null,
    found_by: input.found_by ?? null,
    hazard_type: input.hazard_type ?? null,
    severity: input.severity ?? null,
    condition: input.condition ?? null,
    treatment: input.treatment ?? null,
    evacuation_priority: input.evacuation_priority ?? null,
    label_size: input.label_size ?? null,
    updated_by: input.updated_by ?? null,
    coordinator_ids: input.coordinator_ids ?? null,
    attachment_path: input.attachment_path ?? null,
  }
}

function drawingDefaults(input) {
  const timestamp = now()
  return {
    id: input.id ?? randomUUID(),
    mission_id: input.mission_id,
    type: input.type,
    name: input.name,
    description: input.description ?? null,
    color: input.color ?? null,
    width: input.width ?? null,
    distance_m: input.distance_m ?? null,
    temporary_measure: input.temporary_measure === undefined || input.temporary_measure === null ? null : Number(Boolean(input.temporary_measure)),
    label: input.label ?? null,
    display_order: input.display_order,
    geometry_json: input.geometry_json,
    metadata_json: input.metadata_json ?? null,
    created_at: timestamp,
    updated_at: timestamp,
  }
}

/** Normalizes any non-search drawing before persistence and immutable versioning. */
function normalizeDrawingMutation(input) {
  const candidate = normalizeMutableEvidenceRecord(input, 'Drawing')
  const drawingType = normalizeBoundedEvidenceRequiredText(
    candidate.type, 'Drawing type', MAX_SEARCH_OPERATION_SHORT_TEXT_LENGTH,
  )
  if (!['line', 'range_ring', 'bearing_line', 'search_sector', 'text_label'].includes(drawingType)) {
    throw new Error('Drawing type is invalid.')
  }
  return {
    id: normalizeBoundedEvidenceOptionalText(
      candidate.id, 'Drawing identity', MAX_SEARCH_OPERATION_ID_LENGTH,
    ),
    mission_id: normalizeBoundedEvidenceRequiredText(
      candidate.mission_id, 'Drawing mission', MAX_SEARCH_OPERATION_ID_LENGTH,
    ),
    type: drawingType,
    name: normalizeBoundedEvidenceRequiredText(
      candidate.name, 'Drawing name', MAX_SEARCH_OPERATION_SHORT_TEXT_LENGTH,
    ),
    description: normalizeBoundedEvidenceOptionalText(
      candidate.description, 'Drawing description', MAX_SEARCH_OPERATION_NOTES_LENGTH,
    ),
    color: normalizeBoundedEvidenceOptionalText(
      candidate.color, 'Drawing colour', MAX_SEARCH_OPERATION_SHORT_TEXT_LENGTH,
    ),
    width: normalizeOptionalFiniteEvidenceNumber(candidate.width, 'Drawing width'),
    distance_m: normalizeOptionalFiniteEvidenceNumber(candidate.distance_m, 'Drawing distance'),
    temporary_measure: normalizeOptionalEvidenceBoolean(
      candidate.temporary_measure, 'Drawing temporary measure',
    ),
    label: normalizeBoundedEvidenceOptionalText(
      candidate.label, 'Drawing label', MAX_SEARCH_OPERATION_SHORT_TEXT_LENGTH,
    ),
    display_order: normalizeRequiredSafeInteger(
      candidate.display_order, 'Drawing display order',
    ),
    geometry_json: normalizeMutableEvidenceGeometryJson(
      candidate.geometry_json, 'Drawing geometry',
    ),
    metadata_json: normalizeBoundedEvidenceOptionalJson(
      candidate.metadata_json, 'Drawing metadata', MAX_MUTABLE_EVIDENCE_METADATA_BYTES,
    ),
  }
}

/** Normalizes the complete UI-owned search-area drawing envelope before persistence. */
function normalizeSearchAreaDrawingMutation(input) {
  const candidate = normalizeSearchOperationRecord(input, 'Search area drawing')
  return {
    id: normalizeOptionalSearchOperationIdentity(candidate.id, 'Search area identity'),
    mission_id: normalizeBoundedRequiredText(
      candidate.mission_id, 'Search area mission', MAX_SEARCH_OPERATION_ID_LENGTH,
    ),
    type: 'search_area',
    name: normalizeBoundedRequiredText(
      candidate.name, 'Search area name', MAX_SEARCH_OPERATION_SHORT_TEXT_LENGTH,
    ),
    description: normalizeBoundedOptionalTextValue(
      candidate.description, 'Search area description', MAX_SEARCH_OPERATION_NOTES_LENGTH,
    ),
    color: normalizeBoundedOptionalTextValue(
      candidate.color, 'Search area colour', MAX_SEARCH_OPERATION_SHORT_TEXT_LENGTH,
    ),
    width: normalizeOptionalFiniteSearchNumber(candidate.width, 'Search area width'),
    distance_m: normalizeOptionalFiniteSearchNumber(
      candidate.distance_m, 'Search area distance',
    ),
    temporary_measure: normalizeOptionalSearchBoolean(
      candidate.temporary_measure, 'Search area temporary-measure flag',
    ),
    label: normalizeBoundedOptionalTextValue(
      candidate.label, 'Search area label', MAX_SEARCH_OPERATION_SHORT_TEXT_LENGTH,
    ),
    display_order: normalizeSearchDisplayOrder(candidate.display_order),
    geometry_json: normalizeSearchAreaGeometryJson(candidate.geometry_json),
    metadata_json: normalizeBoundedOptionalJsonText(
      candidate.metadata_json,
      'Search area metadata',
      MAX_SEARCH_AREA_GEOMETRY_LENGTH,
    ),
  }
}

/** Normalizes a stable search-area mutation before any database lookup. */
function normalizeSearchAreaMutation(input) {
  const candidate = normalizeSearchOperationRecord(input, 'Search area')
  const status = candidate.status === undefined
    ? undefined
    : normalizeSearchAreaStatus(candidate.status)
  return {
    id: normalizeOptionalSearchOperationIdentity(candidate.id, 'Search area identity'),
    mission_id: normalizeBoundedRequiredText(
      candidate.mission_id, 'Search area mission', MAX_SEARCH_OPERATION_ID_LENGTH,
    ),
    name: normalizeBoundedRequiredText(
      candidate.name, 'Search area name', MAX_SEARCH_OPERATION_SHORT_TEXT_LENGTH,
    ),
    status,
    geometry_json: normalizeSearchAreaGeometryJson(candidate.geometry_json),
    legacy_drawing_id: normalizeOptionalSearchOperationIdentity(
      candidate.legacy_drawing_id, 'Search area legacy drawing identity',
    ),
    updated_by: normalizeBoundedOptionalTextValue(
      candidate.updated_by, 'Search area coordinator', MAX_SEARCH_OPERATION_SHORT_TEXT_LENGTH,
    ),
    effective_at: normalizeOptionalStrictSearchTimestamp(
      candidate.effective_at, 'Search area effective time',
    ),
  }
}

/** Normalizes an assignment mutation before any database lookup or list processing. */
function normalizeSearchAssignmentMutation(input) {
  const candidate = normalizeSearchOperationRecord(input, 'Search assignment')
  return {
    id: normalizeOptionalSearchOperationIdentity(candidate.id, 'Search assignment identity'),
    mission_id: normalizeBoundedRequiredText(
      candidate.mission_id, 'Search assignment mission', MAX_SEARCH_OPERATION_ID_LENGTH,
    ),
    search_area_id: normalizeBoundedRequiredText(
      candidate.search_area_id, 'Search assignment area', MAX_SEARCH_OPERATION_ID_LENGTH,
    ),
    outing_id: normalizeBoundedRequiredText(
      candidate.outing_id, 'Search assignment outing', MAX_SEARCH_OPERATION_ID_LENGTH,
    ),
    team_id: normalizeBoundedRequiredText(
      candidate.team_id, 'Search assignment team', MAX_SEARCH_OPERATION_SHORT_TEXT_LENGTH,
    ),
    participant_ids: normalizeIdList(
      candidate.participant_ids, 'Search assignment participant links',
    ),
    notes: normalizeBoundedOptionalTextValue(
      candidate.notes, 'Search assignment notes', MAX_SEARCH_OPERATION_NOTES_LENGTH,
    ),
    updated_by: normalizeBoundedOptionalTextValue(
      candidate.updated_by,
      'Search assignment coordinator',
      MAX_SEARCH_OPERATION_SHORT_TEXT_LENGTH,
    ),
    effective_at: normalizeOptionalStrictSearchTimestamp(
      candidate.effective_at, 'Search assignment effective time',
    ),
  }
}

/** Normalizes a coordinator-declared pass before any database lookup or list processing. */
function normalizeSearchPassMutation(input) {
  const candidate = normalizeSearchOperationRecord(input, 'Search pass')
  const endedAt = candidate.ended_at === null || candidate.ended_at === undefined
    ? null
    : normalizeStrictSearchTimestamp(candidate.ended_at, 'Search pass end time')
  return {
    id: normalizeOptionalSearchOperationIdentity(candidate.id, 'Search pass identity'),
    mission_id: normalizeBoundedRequiredText(
      candidate.mission_id, 'Search pass mission', MAX_SEARCH_OPERATION_ID_LENGTH,
    ),
    search_area_id: normalizeBoundedRequiredText(
      candidate.search_area_id, 'Search pass area', MAX_SEARCH_OPERATION_ID_LENGTH,
    ),
    assignment_id: normalizeBoundedRequiredText(
      candidate.assignment_id, 'Search pass assignment', MAX_SEARCH_OPERATION_ID_LENGTH,
    ),
    started_at: normalizeStrictSearchTimestamp(candidate.started_at, 'Search pass start time'),
    ended_at: endedAt,
    outcome: normalizeSearchPassOutcome(candidate.outcome),
    notes: normalizeBoundedOptionalTextValue(
      candidate.notes, 'Search pass notes', MAX_SEARCH_OPERATION_NOTES_LENGTH,
    ),
    coordinator_name: normalizeBoundedRequiredText(
      candidate.coordinator_name,
      'Search pass coordinator',
      MAX_SEARCH_OPERATION_SHORT_TEXT_LENGTH,
    ),
    advisory_coverage_json:
      candidate.advisory_coverage_json === null
      || candidate.advisory_coverage_json === undefined
        ? undefined
        : normalizeBoundedOptionalJsonText(
          candidate.advisory_coverage_json,
          'Search pass advisory coverage',
          MAX_SEARCH_ADVISORY_COVERAGE_LENGTH,
        ),
    participant_ids: normalizeOptionalSearchIdList(
      candidate.participant_ids, 'Search pass participant links',
    ),
    clue_ids: normalizeOptionalSearchIdList(candidate.clue_ids, 'Search pass clue links'),
    track_evidence_ids: normalizeOptionalSearchIdList(
      candidate.track_evidence_ids, 'Search pass track links',
    ),
  }
}

function upsertDrawingEvidence(db, versionStore, input) {
  const normalizedInput = input?.type === 'search_area'
    ? normalizeSearchAreaDrawingMutation(input)
    : normalizeDrawingMutation(input)
  const transaction = db.transaction(() => {
    const drawing = upsertVersionedById(
      db, versionStore, 'drawings', 'drawing', normalizedInput, drawingDefaults,
    )
    if (drawing.type === 'search_area') {
      upsertSearchArea(db, versionStore, {
        id: drawing.id,
        mission_id: drawing.mission_id,
        name: drawing.name,
        status: 'active',
        geometry_json: drawing.geometry_json,
        legacy_drawing_id: drawing.id,
        effective_at: drawing.updated_at,
      })
    }
    return drawing
  })
  return transaction()
}

function retireDrawingEvidence(db, versionStore, drawingId) {
  const normalizedDrawingId = normalizeBoundedRequiredText(
    drawingId,
    'Drawing identity',
    MAX_SEARCH_OPERATION_ID_LENGTH,
  )
  const transaction = db.transaction(() => {
    const drawing = db.prepare('SELECT * FROM drawings WHERE id = ?').get(normalizedDrawingId)
    if (drawing === undefined || drawing.retired_at !== null) return false
    if (drawing.type === 'search_area') retireSearchArea(db, versionStore, normalizedDrawingId, null)
    return retireVersionedById(
      db, versionStore, 'drawings', 'drawing', normalizedDrawingId,
    )
  })
  return transaction()
}

/** Creates or revises one stable search area and its immutable complete state. */
function upsertSearchArea(db, versionStore, input) {
  const normalizedInput = normalizeSearchAreaMutation(input)
  const missionId = normalizedInput.mission_id
  ensureWritableMission(db, missionId)
  const id = normalizedInput.id ?? randomUUID()
  const existing = db.prepare('SELECT * FROM search_areas WHERE id = ?').get(id)
  assertSameMission(existing, missionId, 'search area', id)
  if (existing?.retired_at !== null && existing?.retired_at !== undefined) {
    throw new Error(`Cannot update retired search area ${id}.`)
  }
  const timestamp = now()
  const status = normalizedInput.status ?? existing?.status ?? 'active'
  const row = {
    id,
    mission_id: missionId,
    name: normalizedInput.name,
    status,
    geometry_json: normalizedInput.geometry_json,
    legacy_drawing_id: existing?.legacy_drawing_id ?? normalizedInput.legacy_drawing_id ?? null,
    version_sequence: Number(existing?.version_sequence ?? 0) + 1,
    updated_by: normalizedInput.updated_by,
    created_at: existing?.created_at ?? timestamp,
    updated_at: timestamp,
    retired_at: status === 'retired' ? timestamp : null,
  }
  writeSearchOperationVersion(db, versionStore, {
    table: 'search_areas', objectType: 'search_area', row, existing,
    effectiveAt: normalizedInput.effective_at ?? timestamp,
    actor: row.updated_by,
    operation: status === 'retired' ? 'retired' : undefined,
  })
  return db.prepare('SELECT * FROM search_areas WHERE id = ?').get(id)
}

/** Retires a stable search area while retaining all assignments, passes, and earlier geometry. */
function retireSearchArea(db, versionStore, areaId, actor) {
  const normalizedAreaId = normalizeBoundedRequiredText(
    areaId, 'Search area identity', MAX_SEARCH_OPERATION_ID_LENGTH,
  )
  const normalizedActor = normalizeBoundedOptionalTextValue(
    actor, 'Search area coordinator', MAX_SEARCH_OPERATION_SHORT_TEXT_LENGTH,
  )
  const transaction = db.transaction(() => {
    const existing = db.prepare('SELECT * FROM search_areas WHERE id = ?').get(normalizedAreaId)
    if (existing === undefined || existing.retired_at !== null) return false
    ensureWritableMission(db, existing.mission_id)
    const timestamp = now()
    const row = {
      ...existing,
      status: 'retired',
      version_sequence: Number(existing.version_sequence) + 1,
      updated_by: normalizedActor ?? existing.updated_by,
      updated_at: timestamp,
      retired_at: timestamp,
    }
    writeSearchOperationVersion(db, versionStore, {
      table: 'search_areas',
      objectType: 'search_area',
      row,
      existing,
      effectiveAt: timestamp,
      actor: row.updated_by,
      operation: 'retired',
    })
    return true
  })
  return transaction.immediate()
}

/** Creates or revises one outing-scoped area assignment; repeated assignments stay distinct. */
function upsertSearchAssignment(db, versionStore, input) {
  const normalizedInput = normalizeSearchAssignmentMutation(input)
  const missionId = normalizedInput.mission_id
  ensureWritableMission(db, missionId)
  const areaId = normalizedInput.search_area_id
  const outingId = normalizedInput.outing_id
  const area = db.prepare('SELECT * FROM search_areas WHERE id = ?').get(areaId)
  const outing = db.prepare('SELECT * FROM outings WHERE id = ?').get(outingId)
  if (area?.mission_id !== missionId) throw new Error('Search assignment area is not in this mission.')
  if (area.retired_at !== null || area.status === 'retired') {
    throw new Error(`Cannot assign a retired search area ${area.id}.`)
  }
  if (outing?.mission_id !== missionId) throw new Error('Search assignment outing is not in this mission.')
  const id = normalizedInput.id ?? randomUUID()
  const existing = db.prepare('SELECT * FROM search_assignments WHERE id = ?').get(id)
  assertSameMission(existing, missionId, 'search assignment', id)
  if (existing?.retired_at !== null && existing?.retired_at !== undefined) {
    throw new Error(`Cannot update retired search assignment ${id}.`)
  }
  if (
    existing !== undefined
    && (existing.search_area_id !== area.id || existing.outing_id !== outing.id)
    && db.prepare('SELECT 1 FROM search_passes WHERE assignment_id = ? LIMIT 1').get(id) !== undefined
  ) {
    throw new Error(
      `Cannot change search assignment scope ${id} after a recorded search pass; create a new assignment.`,
    )
  }
  const participantIds = normalizedInput.participant_ids
  const timestamp = now()
  const row = {
    id,
    mission_id: missionId,
    search_area_id: area.id,
    outing_id: outing.id,
    team_id: normalizedInput.team_id,
    participant_ids_json: JSON.stringify(participantIds),
    notes: normalizedInput.notes,
    version_sequence: Number(existing?.version_sequence ?? 0) + 1,
    updated_by: normalizedInput.updated_by,
    created_at: existing?.created_at ?? timestamp,
    updated_at: timestamp,
    retired_at: null,
  }
  writeSearchOperationVersion(db, versionStore, {
    table: 'search_assignments', objectType: 'search_assignment', row, existing,
    effectiveAt: normalizedInput.effective_at ?? timestamp,
    actor: row.updated_by,
    beforeProjection: () => assertParticipantIdsBelongToMission(db, missionId, participantIds),
  })
  return db.prepare('SELECT * FROM search_assignments WHERE id = ?').get(id)
}

/** Records only a coordinator-declared pass outcome; advisory coverage cannot set this field. */
function upsertSearchPass(db, versionStore, input) {
  const normalizedInput = normalizeSearchPassMutation(input)
  const missionId = normalizedInput.mission_id
  ensureWritableMission(db, missionId)
  const mission = getMission(db, missionId)
  const areaId = normalizedInput.search_area_id
  const assignmentId = normalizedInput.assignment_id
  const area = db.prepare('SELECT * FROM search_areas WHERE id = ?').get(areaId)
  const assignment = db.prepare('SELECT * FROM search_assignments WHERE id = ?').get(assignmentId)
  if (area?.mission_id !== missionId) throw new Error('Search pass area is not in this mission.')
  if (area.retired_at !== null || area.status === 'retired') {
    throw new Error(`Cannot record a pass against retired search area ${area.id}.`)
  }
  if (assignment?.mission_id !== missionId || assignment.search_area_id !== area.id) {
    throw new Error('Search pass assignment does not match this mission and area.')
  }
  if (assignment.retired_at !== null) {
    throw new Error(`Cannot record a pass against retired search assignment ${assignment.id}.`)
  }
  const outing = db.prepare('SELECT * FROM outings WHERE id = ?').get(assignment.outing_id)
  if (outing?.mission_id !== missionId) {
    throw new Error('Search pass assignment outing is not in this mission.')
  }
  const id = normalizedInput.id ?? randomUUID()
  const existing = db.prepare('SELECT * FROM search_passes WHERE id = ?').get(id)
  assertSameMission(existing, missionId, 'search pass', id)
  const timestamp = now()
  const startedAt = normalizedInput.started_at
  const endedAt = normalizedInput.ended_at
  if (endedAt !== null && endedAt < startedAt) {
    throw new Error('Search pass end time cannot precede its start time.')
  }
  assertSearchPassWindowWithinOuting({
    mission,
    outing,
    startedAt,
    endedAt,
    currentTime: timestamp,
  })
  if (endedAt === null) {
    throw new Error('A coordinator-declared search pass outcome requires an explicit pass end time.')
  }
  const previousLinks = existing === undefined ? null : readSearchPassLinks(
    db,
    id,
    Number(existing.version_sequence),
  )
  const links = {
    participant_ids: normalizeIdList(
      normalizedInput.participant_ids ?? previousLinks?.participant_ids,
      'Search pass participant links',
    ),
    clue_ids: normalizeIdList(
      normalizedInput.clue_ids ?? previousLinks?.clue_ids,
      'Search pass clue links',
    ),
    track_evidence_ids: normalizeIdList(
      normalizedInput.track_evidence_ids ?? previousLinks?.track_evidence_ids,
      'Search pass track links',
    ),
  }
  const row = {
    id,
    mission_id: missionId,
    search_area_id: area.id,
    assignment_id: assignment.id,
    started_at: startedAt,
    ended_at: endedAt,
    outcome: normalizedInput.outcome,
    notes: normalizedInput.notes,
    coordinator_name: normalizedInput.coordinator_name,
    advisory_coverage_json: normalizedInput.advisory_coverage_json === undefined
      ? existing?.advisory_coverage_json ?? null
      : normalizedInput.advisory_coverage_json,
    version_sequence: Number(existing?.version_sequence ?? 0) + 1,
    created_at: existing?.created_at ?? timestamp,
    updated_at: timestamp,
  }
  writeSearchOperationVersion(db, versionStore, {
    table: 'search_passes', objectType: 'search_pass', row, existing,
    effectiveAt: startedAt,
    actor: row.coordinator_name,
    state: { ...row, ...links, outcome_authority: 'coordinator_declared' },
    beforeProjection: () => assertSearchPassLinksBelongToMission(db, missionId, links),
    afterProjection: () => writeSearchPassLinks(db, id, row.version_sequence, links),
  })
  return { ...db.prepare('SELECT * FROM search_passes WHERE id = ?').get(id), ...links }
}

/** Fails closed when a declared pass is outside its coordinator-owned outing. */
function assertSearchPassWindowWithinOuting(input) {
  const startedAtMs = Date.parse(input.startedAt)
  const endedAtMs = input.endedAt === null ? null : Date.parse(input.endedAt)
  const missionStartMs = Date.parse(input.mission.start_time)
  const outingStartMs = Date.parse(input.outing.started_at)
  const outingEndMs = input.outing.ended_at === null ? null : Date.parse(input.outing.ended_at)
  const currentTimeMs = Date.parse(input.currentTime)
  if (startedAtMs < missionStartMs) {
    throw new Error('Search pass start cannot be before the mission start.')
  }
  if (startedAtMs < outingStartMs) {
    throw new Error('Search pass start cannot be before its assignment outing start.')
  }
  if (startedAtMs > currentTimeMs) {
    throw new Error('Search pass start cannot be in the future.')
  }
  if (endedAtMs !== null && endedAtMs > currentTimeMs) {
    throw new Error('Search pass end cannot be in the future.')
  }
  if (outingEndMs !== null) {
    if (startedAtMs >= outingEndMs) {
      throw new Error('Search pass start must be before its assignment outing end.')
    }
    if (endedAtMs === null) {
      throw new Error('A pass in an ended outing must have an explicit pass end.')
    }
    if (endedAtMs > outingEndMs) {
      throw new Error('Search pass end cannot be after its assignment outing end.')
    }
  }
}

function writeSearchOperationVersion(db, versionStore, input) {
  const columns = Object.keys(input.row)
  const immutableColumns = new Set(['id', 'mission_id', 'created_at'])
  const assignments = columns
    .filter((column) => !immutableColumns.has(column))
    .map((column) => `${column} = excluded.${column}`)
    .join(', ')
  const operation = input.operation ?? (input.existing === undefined ? 'created' : 'updated')
  const recordedAt = input.row.updated_at
  const transaction = db.transaction(() => {
    ensureWritableMission(db, input.row.mission_id)
    input.beforeProjection?.()
    db.prepare(`INSERT INTO ${input.table} (${columns.join(', ')})
      VALUES (${columns.map(() => '?').join(', ')})
      ON CONFLICT(id) DO UPDATE SET ${assignments}`)
      .run(...columns.map((column) => input.row[column]))
    input.afterProjection?.()
    const auditEventId = insertEvent(
      db,
      input.row.mission_id,
      `${input.objectType}_${operation}`,
      recordedAt,
      { object_id: input.row.id, version_sequence: input.row.version_sequence },
    )
    versionStore.recordVersion({
      missionId: input.row.mission_id,
      objectType: input.objectType,
      objectId: input.row.id,
      operation,
      effectiveAt: input.effectiveAt,
      recordedAt,
      state: input.state ?? input.row,
      actor: input.actor,
      auditEventId,
    })
  })
  transaction.immediate()
}

/** Fails the pass transaction unless every evidence link resolves inside its mission. */
function assertSearchPassLinksBelongToMission(db, missionId, links) {
  assertParticipantIdsBelongToMission(db, missionId, links.participant_ids)
  const readClue = db.prepare(`SELECT 1 FROM markers
    WHERE id = ? AND mission_id = ? AND type = 'clue'`)
  for (const clueId of links.clue_ids) {
    if (readClue.get(clueId, missionId) === undefined) {
      throw new Error(`Search pass clue ${clueId} is not in this mission.`)
    }
  }
  const readTrackEvidence = db.prepare(`SELECT 1 FROM positions
      WHERE id = ? AND mission_id = ?
    UNION ALL
    SELECT 1 FROM gpx_track_imports WHERE id = ? AND mission_id = ? LIMIT 1`)
  for (const trackEvidenceId of links.track_evidence_ids) {
    if (readTrackEvidence.get(
      trackEvidenceId, missionId, trackEvidenceId, missionId,
    ) === undefined) {
      throw new Error(`Search pass track evidence ${trackEvidenceId} is not in this mission.`)
    }
  }
}

/** Rejects invented or cross-mission participant identities atomically. */
function assertParticipantIdsBelongToMission(db, missionId, participantIds) {
  const readParticipant = db.prepare(`SELECT 1 FROM mission_participants
    WHERE id = ? AND mission_id = ?`)
  for (const participantId of participantIds) {
    if (readParticipant.get(participantId, missionId) === undefined) {
      throw new Error(`Search participant ${participantId} is not in this mission.`)
    }
  }
}

/** Returns search passes with their exact current-revision evidence links. */
function listSearchPassRecords(db, missionId) {
  return db.prepare(`SELECT * FROM search_passes WHERE mission_id = ?
    ORDER BY started_at ASC, id ASC`).all(missionId).map((pass) => ({
    ...pass,
    ...readSearchPassLinks(db, pass.id, Number(pass.version_sequence)),
  }))
}

function writeSearchPassLinks(db, passId, versionSequence, links) {
  const rows = [
    ...links.participant_ids.map((targetId) => ['participant', targetId]),
    ...links.clue_ids.map((targetId) => ['clue', targetId]),
    ...links.track_evidence_ids.map((targetId) => ['track', targetId]),
  ]
  for (const [kind, targetId] of rows) {
    db.prepare(`INSERT INTO search_pass_evidence_links (
      pass_id, version_sequence, link_kind, target_id
    ) VALUES (?, ?, ?, ?)`).run(passId, versionSequence, kind, targetId)
  }
}

function readSearchPassLinks(db, passId, versionSequence) {
  const result = { participant_ids: [], clue_ids: [], track_evidence_ids: [] }
  const keyByKind = { participant: 'participant_ids', clue: 'clue_ids', track: 'track_evidence_ids' }
  for (const row of db.prepare(`SELECT link_kind, target_id FROM search_pass_evidence_links
    WHERE pass_id = ? AND version_sequence = ? ORDER BY link_kind, target_id`)
    .all(passId, versionSequence)) {
    result[keyByKind[row.link_kind]].push(row.target_id)
  }
  return result
}

const MAX_LEGACY_GPX_METADATA_CANDIDATES_PER_TURN = 10_000
const MAX_LEGACY_GPX_UNSETTLED_METADATA_CANDIDATES_PER_TURN = 100
const MAX_LEGACY_GPX_UNSAFE_ROWID_CANDIDATES_PER_TURN = 100

/** Quarantines a bounded signed-int64 rowid page entirely inside SQLite's exact integer domain. */
function scanUnsafeLegacyGpxRowids(db, migrationTime, maximumCandidates) {
  const state = db.prepare(`SELECT
      low_scanned_through_rowid > low_target_rowid AS low_pending,
      high_scanned_through_rowid < high_target_rowid AS high_pending
    FROM legacy_gpx_rowid_scan_state WHERE singleton = 1`).get()
  const direction = Number(state.low_pending) === 1
    ? 'low'
    : Number(state.high_pending) === 1 ? 'high' : null
  if (direction === null) return { remaining: 0 }
  const isLow = direction === 'low'
  const pagePredicate = isLow
    ? `source.rowid < scan.low_scanned_through_rowid
       AND source.rowid >= scan.low_target_rowid`
    : `source.rowid > scan.high_scanned_through_rowid
       AND source.rowid <= scan.high_target_rowid`
  const pageOrder = isLow ? 'DESC' : 'ASC'
  const pageBoundary = isLow ? 'MIN(source_rowid)' : 'MAX(source_rowid)'
  const cursorColumn = isLow ? 'low_scanned_through_rowid' : 'high_scanned_through_rowid'
  const targetColumn = isLow ? 'low_target_rowid' : 'high_target_rowid'
  const transaction = db.transaction(() => {
    db.prepare(`WITH page(source_rowid) AS (
        SELECT source.rowid FROM gpx_track_imports AS source
        JOIN legacy_gpx_rowid_scan_state AS scan ON scan.singleton = 1
        WHERE ${pagePredicate}
        ORDER BY source.rowid ${pageOrder} LIMIT ?
      )
      INSERT OR IGNORE INTO legacy_gpx_backfill_quarantine (
        source_rowid, import_id_preview, reason, geometry_bytes,
        source_bytes_base64_bytes, metadata_bytes, detected_at
      ) SELECT source.rowid, substr(source.id, 1, 100),
        'legacy_rowid_outside_safe_envelope',
        length(CAST(source.geometry_json AS BLOB)),
        length(CAST(COALESCE(source.source_bytes_base64, '') AS BLOB)),
        length(CAST(COALESCE(source.metadata_json, '') AS BLOB)), ?
      FROM gpx_track_imports AS source
      JOIN page ON page.source_rowid = source.rowid
      WHERE NOT EXISTS (
        SELECT 1 FROM gpx_import_revisions AS revision WHERE revision.import_id = source.id
      )`).run(maximumCandidates, migrationTime)
    db.prepare(`WITH page(source_rowid) AS (
        SELECT source.rowid FROM gpx_track_imports AS source
        JOIN legacy_gpx_rowid_scan_state AS scan ON scan.singleton = 1
        WHERE ${pagePredicate}
        ORDER BY source.rowid ${pageOrder} LIMIT ?
      )
      UPDATE legacy_gpx_rowid_scan_state
      SET ${cursorColumn} = COALESCE((SELECT ${pageBoundary} FROM page), ${targetColumn}),
        updated_at = ? WHERE singleton = 1`).run(maximumCandidates, migrationTime)
  })
  transaction.immediate()
  const remaining = db.prepare(`SELECT CASE WHEN
      low_scanned_through_rowid > low_target_rowid
      OR high_scanned_through_rowid < high_target_rowid THEN 1 ELSE 0 END AS count
    FROM legacy_gpx_rowid_scan_state WHERE singleton = 1`).get()
  return { remaining: Number(remaining.count) }
}

/** Baselines a hard-bounded pre-v12 GPX slice without inventing source time or byte provenance. */
function backfillLegacyGpxRevisions(
  db,
  migrationTime,
  maximumImports,
  migrateBoundedRows = true,
  maximumCandidates = migrateBoundedRows
    ? MAX_LEGACY_GPX_METADATA_CANDIDATES_PER_TURN
    : maximumImports,
) {
  const unsafeScan = scanUnsafeLegacyGpxRowids(
    db,
    migrationTime,
    Math.min(maximumCandidates, MAX_LEGACY_GPX_UNSAFE_ROWID_CANDIDATES_PER_TURN),
  )
  if (unsafeScan.remaining > 0) return { processed: 0, remaining: 1 }
  const state = db.prepare(`SELECT scanned_through_rowid, scan_target_rowid
    FROM legacy_gpx_backfill_state WHERE singleton = 1`).get()
  const readPageEnd = db.prepare(`SELECT MAX(source_rowid) AS page_end FROM (
      SELECT source.rowid AS source_rowid FROM gpx_track_imports AS source
      WHERE source.rowid > ? AND source.rowid <= ?
      ORDER BY source.rowid ASC LIMIT ?
    )`)
  const readLegacyPage = db.prepare(`SELECT
      source.rowid AS source_rowid,
      substr(source.id, 1, 100) AS import_id_preview,
      length(CAST(source.id AS BLOB)) AS id_bytes,
      length(CAST(source.mission_id AS BLOB)) AS mission_id_bytes,
      length(CAST(source.source_path AS BLOB)) AS source_path_bytes,
      length(CAST(source.file_name AS BLOB)) AS file_name_bytes,
      length(CAST(source.display_name AS BLOB)) AS display_name_bytes,
      length(CAST(source.geometry_json AS BLOB)) AS geometry_bytes,
      length(CAST(COALESCE(source.metadata_json, '') AS BLOB)) AS metadata_bytes,
      length(CAST(COALESCE(source.source_bytes_base64, '') AS BLOB))
        AS source_bytes_base64_bytes
    FROM gpx_track_imports AS source
    WHERE source.rowid > ? AND source.rowid <= ?
      AND NOT EXISTS (
        SELECT 1 FROM gpx_import_revisions AS revision WHERE revision.import_id = source.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM legacy_gpx_backfill_quarantine AS quarantine
        WHERE quarantine.source_rowid = source.rowid
      )
    ORDER BY source.rowid ASC LIMIT ?`)
  const readBoundedLegacy = db.prepare(`SELECT
      source.id, source.mission_id, source.content_sha256, source.source_bytes_base64,
      source.source_path, source.file_name, source.display_name, source.geometry_json,
      source.metadata_json
    FROM gpx_track_imports AS source WHERE source.rowid = ?`)
  const quarantineLegacy = db.prepare(`INSERT OR IGNORE INTO legacy_gpx_backfill_quarantine (
      source_rowid, import_id_preview, reason, geometry_bytes,
      source_bytes_base64_bytes, metadata_bytes, detected_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`)
  const advanceCursor = db.prepare(`UPDATE legacy_gpx_backfill_state
    SET scanned_through_rowid = ?, updated_at = ? WHERE singleton = 1`)
  const insertRevision = db.prepare(`INSERT INTO gpx_import_revisions (
    id, mission_id, import_id, revision_sequence, source_revision_sequence, content_sha256,
    source_bytes_base64, source_path, file_name, display_name, geometry_json,
      metadata_json, timing_class, completeness, recorded_at, audit_event_id
  ) VALUES (?, ?, ?, 1, 1, ?, ?, ?, ?, ?, ?, ?, 'undated', 'legacy_baseline', ?, NULL)`)
  const updateProjectionGeometry = db.prepare(`UPDATE gpx_track_imports
    SET geometry_json = ? WHERE id = ?`)
  const insertPoint = db.prepare(`INSERT INTO gpx_evidence_points (
    import_id, revision_sequence, segment_index, point_index, track_name,
    lat, lon, elevation, source_time
  ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, NULL)`)
  const insertRejection = db.prepare(`INSERT INTO gpx_evidence_rejections (
    id, import_id, revision_sequence, kind, segment_index, point_index, reason, source_value
  ) VALUES (?, ?, 1, ?, ?, ?, ?, ?)`)
  const pageEnd = Number(readPageEnd.get(
    state.scanned_through_rowid,
    state.scan_target_rowid,
    maximumCandidates,
  )?.page_end ?? state.scan_target_rowid)
  const legacyCandidates = readLegacyPage.all(
    state.scanned_through_rowid,
    pageEnd,
    Math.min(maximumCandidates, MAX_LEGACY_GPX_UNSETTLED_METADATA_CANDIDATES_PER_TURN),
  )
  let processed = 0
  let cursor = Number(state.scanned_through_rowid)
  let persistedCursor = cursor
  let cursorBlocked = false
  for (const candidate of legacyCandidates) {
    if (processed >= maximumImports) break
    const quarantineReason = legacyGpxBackfillQuarantineReason(candidate)
    if (quarantineReason !== null) {
      const quarantineOne = db.transaction(() => {
        quarantineLegacy.run(
          candidate.source_rowid,
          candidate.import_id_preview,
          quarantineReason,
          candidate.geometry_bytes,
          candidate.source_bytes_base64_bytes,
          candidate.metadata_bytes,
          migrationTime,
        )
        if (!cursorBlocked) advanceCursor.run(candidate.source_rowid, migrationTime)
      })
      quarantineOne.immediate()
      if (!cursorBlocked) {
        cursor = Number(candidate.source_rowid)
        persistedCursor = cursor
      }
      processed += 1
      if (processed >= maximumImports) break
      continue
    }
    if (!migrateBoundedRows) {
      cursorBlocked = true
      continue
    }
    if (processed >= maximumImports) break
    const entry = readBoundedLegacy.get(candidate.source_rowid)
    if (entry === undefined) {
      cursor = Number(candidate.source_rowid)
      continue
    }
    const migrateOne = db.transaction(() => {
      const migration = readLegacyGpxMigrationProjection(entry.geometry_json)
      insertRevision.run(
        randomUUID(), entry.mission_id, entry.id, entry.content_sha256 ?? null,
        entry.source_bytes_base64 ?? null, entry.source_path, entry.file_name,
        entry.display_name, entry.geometry_json, entry.metadata_json ?? null,
        migrationTime,
      )
      updateProjectionGeometry.run(migration.geometryJson, entry.id)
      for (const rejection of migration.rejections) {
        insertRejection.run(
          randomUUID(), entry.id, rejection.kind, rejection.segmentIndex,
          rejection.pointIndex, rejection.reason, rejection.sourceValue,
        )
      }
      for (const point of migration.points) {
        insertPoint.run(
          entry.id,
          point.segmentIndex,
          point.pointIndex,
          entry.display_name,
          point.lat,
          point.lon,
          point.elevation,
        )
      }
      advanceCursor.run(candidate.source_rowid, migrationTime)
    })
    migrateOne.immediate()
    cursor = Number(candidate.source_rowid)
    persistedCursor = cursor
    processed += 1
    if (processed >= maximumImports) break
  }
  if (legacyCandidates.length === 0 && cursor < pageEnd) cursor = pageEnd
  if (cursor > persistedCursor) advanceCursor.run(cursor, migrationTime)
  const remaining = cursor < Number(state.scan_target_rowid) ? 1 : 0
  return { processed, remaining }
}

const MAX_INLINE_LEGACY_GPX_GEOMETRY_BYTES = 128 * 1024
const MAX_INLINE_LEGACY_GPX_SOURCE_BYTES = 128 * 1024
const MAX_INLINE_LEGACY_GPX_METADATA_BYTES = 100 * 1024

/** Classifies one legacy row using only SQLite-side byte lengths before selecting its text. */
function legacyGpxBackfillQuarantineReason(candidate) {
  if (Number(candidate.geometry_bytes) > MAX_INLINE_LEGACY_GPX_GEOMETRY_BYTES) {
    return 'legacy_geometry_over_byte_envelope'
  }
  if (Number(candidate.source_bytes_base64_bytes) > MAX_INLINE_LEGACY_GPX_SOURCE_BYTES) {
    return 'legacy_source_bytes_over_byte_envelope'
  }
  if (Number(candidate.metadata_bytes) > MAX_INLINE_LEGACY_GPX_METADATA_BYTES) {
    return 'legacy_metadata_over_byte_envelope'
  }
  if (Number(candidate.id_bytes) > 1_000 || Number(candidate.mission_id_bytes) > 1_000
    || Number(candidate.file_name_bytes) > 1_000 || Number(candidate.display_name_bytes) > 1_000
    || Number(candidate.source_path_bytes) > 10_000) {
    return 'legacy_identity_over_byte_envelope'
  }
  return null
}

/** Produces a bounded legacy projection without scanning arbitrarily large coordinate arrays. */
function readLegacyGpxMigrationProjection(geometryJson) {
  if (Buffer.byteLength(geometryJson, 'utf8') > MAX_INLINE_LEGACY_GPX_GEOMETRY_BYTES) {
    return {
      geometryJson: '{"type":"MultiLineString","coordinates":[]}',
      points: [],
      rejections: [{
        kind: 'segment', segmentIndex: -1, pointIndex: null,
        reason: 'Legacy geometry exceeds the bounded startup migration budget; the original artifact is retained in the immutable baseline revision but is not reconstructed as exact point evidence.',
        sourceValue: null,
      }],
    }
  }
  try {
    const parsed = JSON.parse(geometryJson)
    const segments = parsed?.type === 'LineString'
      ? [parsed.coordinates]
      : parsed?.type === 'MultiLineString' ? parsed.coordinates : null
    if (!Array.isArray(segments)) throw new Error('unsupported geometry')
    const points = []
    const rejections = []
    const displaySegments = []
    for (const [segmentIndex, segment] of segments.entries()) {
      if (!Array.isArray(segment)) {
        rejections.push({
          kind: 'segment', segmentIndex, pointIndex: null,
          reason: 'invalid_segment', sourceValue: boundedLegacyGpxSourceValue(segment),
        })
        continue
      }
      const displayPoints = []
      for (const [pointIndex, coordinate] of segment.entries()) {
        if (!Array.isArray(coordinate)) {
          rejections.push({
            kind: 'point', segmentIndex, pointIndex,
            reason: 'invalid_coordinates', sourceValue: boundedLegacyGpxSourceValue(coordinate),
          })
          continue
        }
        const lon = Number(coordinate[0])
        const lat = Number(coordinate[1])
        if (!Number.isFinite(lat) || lat < -90 || lat > 90
          || !Number.isFinite(lon) || lon < -180 || lon > 180) {
          rejections.push({
            kind: 'point', segmentIndex, pointIndex,
            reason: 'invalid_coordinates', sourceValue: boundedLegacyGpxSourceValue(coordinate),
          })
          continue
        }
        const elevationSource = coordinate[2]
        const elevation = elevationSource === undefined || elevationSource === null
          ? null
          : Number(elevationSource)
        if (elevation !== null && !Number.isFinite(elevation)) {
          rejections.push({
            kind: 'point', segmentIndex, pointIndex,
            reason: 'invalid_elevation', sourceValue: boundedLegacyGpxSourceValue(elevationSource),
          })
        }
        points.push({
          segmentIndex, pointIndex, lat, lon,
          elevation: elevation !== null && Number.isFinite(elevation) ? elevation : null,
        })
        displayPoints.push([lon, lat])
      }
      if (displayPoints.length >= 2) {
        displaySegments.push(displayPoints)
      } else {
        rejections.push({
          kind: 'segment', segmentIndex, pointIndex: null,
          reason: 'insufficient_segment_points', sourceValue: String(displayPoints.length),
        })
      }
    }
    return {
      geometryJson: JSON.stringify({ type: 'MultiLineString', coordinates: displaySegments }),
      points,
      rejections,
    }
  } catch {
    return {
      geometryJson: '{"type":"MultiLineString","coordinates":[]}',
      points: [],
      rejections: [{
        kind: 'segment', segmentIndex: -1, pointIndex: null,
        reason: 'Legacy geometry could not be rendered safely; the original artifact is retained in the immutable baseline revision.',
        sourceValue: null,
      }],
    }
  }
}

/** Bounds legacy source fragments retained beside explicit migration rejections. */
function boundedLegacyGpxSourceValue(value) {
  try {
    return JSON.stringify(value).slice(0, 500)
  } catch {
    return String(value).slice(0, 500)
  }
}

function normalizeIdList(value, label) {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new Error('Search operation evidence links must be a list.')
  if (value.length > MAX_SEARCH_OPERATION_LINK_COUNT) {
    throw new Error(`${label} may contain at most ${MAX_SEARCH_OPERATION_LINK_COUNT} identities.`)
  }
  return [...new Set(value.map((entry) => normalizeBoundedRequiredText(
    entry,
    label,
    MAX_SEARCH_OPERATION_ID_LENGTH,
  )))].sort()
}

function normalizeBoundedRequiredText(value, label, maximumLength) {
  if (value === undefined || value === null) throw new Error(`${label} is required.`)
  if (typeof value !== 'string') throw new Error(`${label} must be text.`)
  if (value.length > maximumLength) {
    throw new Error(`${label} must be ${maximumLength} characters or fewer.`)
  }
  const normalized = value.trim()
  if (normalized === '') throw new Error(`${label} is required.`)
  if (normalized.length > maximumLength) {
    throw new Error(`${label} must be ${maximumLength} characters or fewer.`)
  }
  return normalized
}

/** Validates a correction authority field using the IPC's byte and control policy. */
function normalizeCorrectionAuthorityInput(value, label, maximumBytes) {
  if (typeof value !== 'string'
    || value.trim() === ''
    || Buffer.byteLength(value, 'utf8') > maximumBytes
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) {
    throw new Error(`${label} is invalid.`)
  }
  return value.trim()
}

function normalizeBoundedOptionalTextValue(value, label, maximumLength) {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string') throw new Error(`${label} must be text.`)
  if (value.length > maximumLength) {
    throw new Error(`${label} must be ${maximumLength} characters or fewer.`)
  }
  const normalized = value.trim()
  if (normalized === '') return null
  return normalized
}

function normalizeSearchOperationRecord(value, label) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} input must be an object.`)
  }
  return value
}

function normalizeOptionalSearchOperationIdentity(value, label) {
  if (value === undefined || value === null) return null
  return normalizeBoundedRequiredText(value, label, MAX_SEARCH_OPERATION_ID_LENGTH)
}

function normalizeOptionalSearchIdList(value, label) {
  if (value === undefined || value === null) return undefined
  return normalizeIdList(value, label)
}

function normalizeSearchAreaStatus(value) {
  if (value !== 'active' && value !== 'retired') {
    throw new Error('Search area status is invalid.')
  }
  return value
}

function normalizeSearchPassOutcome(value) {
  if (value !== 'full' && value !== 'partial' && value !== 'aborted') {
    throw new Error('Search pass coordinator outcome is invalid.')
  }
  return value
}

function normalizeSearchDisplayOrder(value) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new Error('Search area display order must be a finite integer.')
  }
  return value
}

function normalizeOptionalFiniteSearchNumber(value, label) {
  if (value === undefined || value === null) return null
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number.`)
  }
  return value
}

function normalizeOptionalSearchBoolean(value, label) {
  if (value === undefined || value === null) return null
  if (typeof value !== 'boolean') throw new Error(`${label} must be true or false.`)
  return value
}

function normalizeBoundedOptionalJsonText(value, label, maximumLength) {
  const normalized = normalizeBoundedOptionalTextValue(value, label, maximumLength)
  if (normalized === null) return null
  try {
    JSON.parse(normalized)
  } catch {
    throw new Error(`${label} must be valid JSON text.`)
  }
  return normalized
}

/** Requires a plain evidence mutation envelope before field reads. */
function normalizeMutableEvidenceRecord(value, label) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} evidence input is invalid.`)
  }
  return value
}

/** Normalizes one required evidence string using its UTF-8 persistence envelope. */
function normalizeBoundedEvidenceRequiredText(value, label, maximumBytes) {
  if (typeof value !== 'string') throw new Error(`${label} is invalid.`)
  const normalized = value.trim()
  if (normalized === '' || Buffer.byteLength(normalized, 'utf8') > maximumBytes) {
    throw new Error(`${label} is invalid.`)
  }
  return normalized
}

/** Normalizes one optional evidence string using its UTF-8 persistence envelope. */
function normalizeBoundedEvidenceOptionalText(value, label, maximumBytes) {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new Error(`${label} is invalid.`)
  const normalized = value.trim()
  if (normalized === '') return null
  if (Buffer.byteLength(normalized, 'utf8') > maximumBytes) {
    throw new Error(`${label} is invalid.`)
  }
  return normalized
}

/** Normalizes one optional bounded JSON string without retaining parsed renderer objects. */
function normalizeBoundedEvidenceOptionalJson(value, label, maximumBytes) {
  const normalized = normalizeBoundedEvidenceOptionalText(value, label, maximumBytes)
  if (normalized === null) return null
  try {
    JSON.parse(normalized)
  } catch {
    throw new Error(`${label} is invalid.`)
  }
  return normalized
}

/** Requires one finite renderer number without coercion. */
function normalizeRequiredFiniteEvidenceNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} is invalid.`)
  }
  return value
}

/** Normalizes one optional finite renderer number without coercion. */
function normalizeOptionalFiniteEvidenceNumber(value, label) {
  if (value === undefined || value === null) return null
  return normalizeRequiredFiniteEvidenceNumber(value, label)
}

/** Requires one safe integer used by the persisted evidence projection. */
function normalizeRequiredSafeInteger(value, label) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new Error(`${label} is invalid.`)
  }
  return value
}

/** Normalizes one optional safe integer without renderer coercion. */
function normalizeOptionalSafeInteger(value, label) {
  if (value === undefined || value === null) return null
  return normalizeRequiredSafeInteger(value, label)
}

/** Normalizes one optional boolean used by a drawing projection. */
function normalizeOptionalEvidenceBoolean(value, label) {
  if (value === undefined || value === null) return null
  if (typeof value !== 'boolean') throw new Error(`${label} is invalid.`)
  return value
}

/** Parses and validates a bounded GeoJSON coordinate tree without recursive stack growth. */
function normalizeMutableEvidenceGeometryJson(value, label, expectedType = null) {
  const normalized = normalizeBoundedEvidenceRequiredText(
    value, label, MAX_MUTABLE_EVIDENCE_GEOMETRY_BYTES,
  )
  let parsed
  try {
    parsed = JSON.parse(normalized)
  } catch {
    throw new Error(`${label} is invalid.`)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)
    || typeof parsed.type !== 'string' || !Array.isArray(parsed.coordinates)
    || (expectedType !== null && parsed.type !== expectedType)) {
    throw new Error(`${label} is invalid.`)
  }
  const pending = [{ value: parsed.coordinates, depth: 0 }]
  let coordinateCount = 0
  while (pending.length > 0) {
    const candidate = pending.pop()
    if (candidate.depth > MAX_MUTABLE_EVIDENCE_NESTING_DEPTH
      || !Array.isArray(candidate.value)) {
      throw new Error(`${label} is invalid.`)
    }
    if (candidate.value.length === 0) continue
    if (candidate.value.length >= 2
      && candidate.value.every((item) => typeof item === 'number' && Number.isFinite(item))) {
      const [longitude, latitude] = candidate.value
      validateLatLon(latitude, longitude, label)
      coordinateCount += 1
      if (coordinateCount > MAX_MUTABLE_EVIDENCE_COORDINATES) {
        throw new Error(`${label} is invalid.`)
      }
      continue
    }
    for (const child of candidate.value) {
      if (!Array.isArray(child)) throw new Error(`${label} is invalid.`)
      pending.push({ value: child, depth: candidate.depth + 1 })
    }
  }
  return normalized
}

function normalizeSearchAreaGeometryJson(value) {
  if (typeof value === 'string' && value.length > MAX_SEARCH_AREA_GEOMETRY_LENGTH) {
    throw new Error(
      `Search area geometry must be no more than ${MAX_SEARCH_AREA_GEOMETRY_LENGTH} characters.`,
    )
  }
  try {
    return normalizeMutableEvidenceGeometryJson(
      value, 'Search area geometry', 'Polygon',
    )
  } catch {
    throw new Error(
      'Search area geometry must be valid Polygon JSON text within the bounded evidence envelope.',
    )
  }
}

function normalizeOptionalStrictSearchTimestamp(value, label) {
  if (value === undefined || value === null) return undefined
  return normalizeStrictSearchTimestamp(value, label)
}

function normalizeRequiredText(value, label) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} is required.`)
  return value.trim()
}

/** Requires a plain renderer-supplied GPX request envelope. */
function normalizeGpxRendererRecord(value, label) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} input must be an object.`)
  }
  return value
}

/** Preflights a GPX renderer identity before any database lookup. */
function normalizeGpxRendererId(value, label, maximumLength = MAX_GPX_RENDERER_ID_LENGTH) {
  return normalizeBoundedRequiredText(value, label, maximumLength)
}

function normalizeOptionalTextValue(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

function assertSameMission(existing, missionId, label, id) {
  if (existing !== undefined && existing.mission_id !== missionId) {
    throw new Error(`Cannot move ${label} ${id} to a different mission.`)
  }
}

/** Starts one durable GPX batch marker before any file can be accepted. */
function startGpxImportBatch(db, input) {
  const timestamp = now()
  const transaction = db.transaction(() => {
    ensureWritableMission(db, input.missionId)
    db.prepare(`INSERT INTO gpx_import_batches (
      id, mission_id, status, total_files, completed_files, failed_files,
      started_at, updated_at, finished_at
    ) VALUES (?, ?, 'running', ?, 0, 0, ?, ?, NULL)`)
      .run(input.batchId, input.missionId, input.totalFiles, timestamp, timestamp)
    for (const sourcePath of input.paths ?? []) {
      db.prepare(`INSERT INTO gpx_import_source_receipts (
        batch_id, mission_id, source_path, file_name, status,
        content_sha256, source_bytes_base64, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'pending', NULL, NULL, ?, ?)`)
        .run(
          input.batchId,
          input.missionId,
          sourcePath,
          path.basename(sourcePath),
          timestamp,
          timestamp,
        )
    }
  })
  transaction.immediate()
}

/** Durably records the selected source identity before the first filesystem read. */
function recordGpxImportSourceReceipt(db, input) {
  const timestamp = now()
  const transaction = db.transaction(() => {
    ensureWritableMission(db, input.missionId)
    db.prepare(`INSERT INTO gpx_import_source_receipts (
      batch_id, mission_id, source_path, file_name, status,
      content_sha256, source_bytes_base64, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'pending', NULL, NULL, ?, ?)`)
      .run(
        input.batchId,
        input.missionId,
        input.sourcePath,
        input.fileName,
        timestamp,
        timestamp,
      )
  })
  transaction.immediate()
}

/** Retains exact bytes and their verified digest immediately after a successful source read. */
function retainGpxImportSourceBytes(db, input) {
  const normalizedHash = normalizeGpxContentHash(input.contentSha256, input.sourceBytesBase64)
  const timestamp = now()
  const transaction = db.transaction(() => {
    ensureWritableMission(db, input.missionId)
    const result = db.prepare(`UPDATE gpx_import_source_receipts
      SET status = 'retained', content_sha256 = ?, source_bytes_base64 = ?, updated_at = ?
      WHERE batch_id = ? AND mission_id = ? AND source_path = ? AND status = 'pending'`)
      .run(
        normalizedHash,
        input.sourceBytesBase64,
        timestamp,
        input.batchId,
        input.missionId,
        input.sourcePath,
      )
    if (result.changes !== 1) {
      throw new Error('GPX source receipt was not pending when retained bytes were recorded.')
    }
  })
  transaction.immediate()
}

/** Marks one published GPX source receipt settled in the same batch accounting transaction. */
function settleGpxImportSourceReceipt(db, input) {
  const timestamp = now()
  const transaction = db.transaction(() => {
    ensureWritableMission(db, input.missionId)
    settleGpxImportSourceReceiptWithinTransaction(db, input, timestamp)
  })
  transaction.immediate()
}

/** Settles one retained source receipt inside its caller's publication transaction. */
function settleGpxImportSourceReceiptWithinTransaction(db, input, timestamp) {
  const result = db.prepare(`UPDATE gpx_import_source_receipts
    SET status = 'settled', source_bytes_base64 = NULL, updated_at = ?
    WHERE batch_id = ? AND mission_id = ? AND source_path = ? AND status = 'retained'`)
    .run(timestamp, input.batchId, input.missionId, input.sourcePath)
  if (result.changes !== 1) {
    throw new Error('GPX source receipt was not retained when the import was published.')
  }
  db.prepare(`UPDATE gpx_import_batches
    SET completed_files = completed_files + 1, updated_at = ? WHERE id = ?`)
    .run(timestamp, input.batchId)
}

/** Records one retained malformed/read-failed GPX source and advances its batch. */
function recordGpxImportFailure(db, input) {
  const timestamp = now()
  const transaction = db.transaction(() => {
    ensureWritableMission(db, input.missionId)
    recordGpxImportFailureWithinTransaction(db, input, timestamp)
  })
  transaction.immediate()
}

/** Records one GPX failure exactly once inside an existing writer transaction. */
function recordGpxImportFailureWithinTransaction(db, input, timestamp) {
  const existingFailure = db.prepare(`SELECT 1 FROM gpx_import_failures
    WHERE batch_id = ? AND source_path = ? LIMIT 1`).get(input.batchId, input.sourcePath)
  if (existingFailure !== undefined) return false
  const receipt = db.prepare(`SELECT status FROM gpx_import_source_receipts
    WHERE batch_id = ? AND mission_id = ? AND source_path = ?`).get(
    input.batchId,
    input.missionId,
    input.sourcePath,
  )
  if (receipt?.status === 'settled') {
    throw new Error('Published GPX source evidence cannot be changed into an import failure.')
  }
  const rejections = normalizeGpxFailureRejections(input.rejections)
  db.prepare(`INSERT INTO gpx_import_failures (
    id, batch_id, mission_id, source_path, file_name, content_sha256,
    source_bytes_base64, reason, rejection_count, rejections_json, recorded_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      randomUUID(), input.batchId, input.missionId, input.sourcePath,
      input.fileName, input.contentSha256, input.sourceBytesBase64,
      safeEvidenceFailureReason(input.reason), rejections.length,
      JSON.stringify(rejections), timestamp,
    )
  db.prepare(`UPDATE gpx_import_batches
    SET failed_files = failed_files + 1, updated_at = ? WHERE id = ?`)
    .run(timestamp, input.batchId)
  db.prepare(`UPDATE gpx_import_source_receipts
    SET status = 'failed',
        content_sha256 = COALESCE(content_sha256, ?),
        source_bytes_base64 = COALESCE(source_bytes_base64, ?),
        updated_at = ?
    WHERE batch_id = ? AND mission_id = ? AND source_path = ?
      AND status IN ('pending', 'retained')`)
    .run(
      input.contentSha256,
      input.sourceBytesBase64,
      timestamp,
      input.batchId,
      input.missionId,
      input.sourcePath,
    )
  return true
}

/** Retains structured parser rejection provenance on a failed GPX source. */
function normalizeGpxFailureRejections(value) {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new Error('GPX failure rejections are invalid.')
  return value.map((entry) => {
    if (entry === null || typeof entry !== 'object'
      || !['point', 'segment'].includes(entry.kind)
      || !Number.isSafeInteger(entry.segment_index) || entry.segment_index < 0
      || (entry.point_index !== null
        && (!Number.isSafeInteger(entry.point_index) || entry.point_index < 0))
      || typeof entry.reason !== 'string' || entry.reason.trim() === ''
      || (entry.source_value !== null && typeof entry.source_value !== 'string')) {
      throw new Error('GPX failure rejection entry is invalid.')
    }
    return {
      kind: entry.kind,
      segment_index: entry.segment_index,
      point_index: entry.point_index,
      reason: entry.reason,
      source_value: entry.source_value,
    }
  })
}

/** Closes one durable GPX batch with an explicit complete or partial status. */
function finishGpxImportBatch(db, batchId, missionId) {
  const timestamp = now()
  const transaction = db.transaction(() => {
    ensureWritableMission(db, missionId)
    const unsettled = db.prepare(`SELECT COUNT(*) AS count
      FROM gpx_import_source_receipts
      WHERE batch_id = ? AND status IN ('pending', 'retained')`).get(batchId).count
    if (unsettled > 0) {
      throw new Error(`GPX import batch ${batchId} cannot finish while ${unsettled} source receipt(s) are unsettled.`)
    }
    db.prepare(`UPDATE gpx_import_batches
      SET status = CASE WHEN failed_files > 0 THEN 'completed_with_failures' ELSE 'completed' END,
          updated_at = ?, finished_at = ? WHERE id = ?`)
      .run(timestamp, timestamp, batchId)
  })
  transaction.immediate()
}

/** Bounds failure text stored and returned to the operator. */
function safeEvidenceFailureReason(value) {
  return String(value ?? 'Unknown GPX evidence failure').replace(/[\r\n]+/gu, ' ').trim().slice(0, 1_000)
}

/** Fails mission lifecycle transitions closed while any durable GPX write state is unsettled. */
function assertNoUnsettledGpxImportState(db, missionId) {
  const state = db.prepare(`SELECT
    (SELECT COUNT(*) FROM gpx_import_batches
      WHERE mission_id = ? AND status = 'running') AS running_batches,
    (SELECT COUNT(*) FROM gpx_import_source_receipts
      WHERE mission_id = ? AND status IN ('pending', 'retained')) AS unsettled_receipts,
    (SELECT COUNT(*) FROM gpx_import_revisions
      WHERE mission_id = ? AND import_state = 'staging') AS staging_revisions,
    (SELECT COUNT(*) FROM gpx_track_imports
      WHERE mission_id = ? AND import_state = 'staging') AS staging_imports,
    (SELECT CASE WHEN
        safe.scanned_through_rowid < safe.scan_target_rowid
        OR unsafe.low_scanned_through_rowid > unsafe.low_target_rowid
        OR unsafe.high_scanned_through_rowid < unsafe.high_target_rowid
      THEN 1 ELSE 0 END
      FROM legacy_gpx_backfill_state AS safe
      JOIN legacy_gpx_rowid_scan_state AS unsafe ON unsafe.singleton = safe.singleton
      WHERE safe.singleton = 1) AS pending_legacy_backfills,
    (SELECT COUNT(*) FROM gpx_track_imports AS imports
      JOIN legacy_gpx_backfill_quarantine AS quarantine
        ON quarantine.source_rowid = imports.rowid
      WHERE imports.mission_id = ?) AS quarantined_legacy_backfills`)
    .get(missionId, missionId, missionId, missionId, missionId)
  const count = Number(state.running_batches) + Number(state.unsettled_receipts)
    + Number(state.staging_revisions) + Number(state.staging_imports)
    + Number(state.pending_legacy_backfills) + Number(state.quarantined_legacy_backfills)
  if (count > 0) {
    const quarantineNotice = Number(state.quarantined_legacy_backfills) === 0
      ? ''
      : ` ${state.quarantined_legacy_backfills} legacy GPX artifact(s) are quarantined outside the safe reconstruction envelope (size, identity, or storage key); the retained originals require a bounded repair path before custody can be declared complete.`
    throw new Error(
      `Mission cannot change lifecycle state while GPX evidence import state is unsettled (${count} durable item(s), including any legacy GPX backfill still pending).${quarantineNotice} Wait for the import to settle or restart SAR Tracker to recover it explicitly.`,
    )
  }
}

/** Preflights Replay against startup-owned GPX receipts without blocking unrelated missions. */
function assertMissionReplayGpxStateSettled(db, input) {
  const candidate = normalizeGpxRendererRecord(input, 'Mission Replay')
  const missionId = normalizeGpxRendererId(candidate.missionId, 'Mission Replay mission')
  const pendingReceipt = db.prepare(`SELECT 1 FROM gpx_import_source_receipts
    WHERE mission_id = ? AND status IN ('pending', 'retained') LIMIT 1`).get(missionId)
  if (pendingReceipt !== undefined) {
    throw new Error(
      'Replay cannot reconstruct GPX evidence while interrupted durable source receipts are unsettled. Current positions remain available; retry after bounded background recovery completes.',
    )
  }
}

/** Returns one byte-bounded issue page without absolute paths or retained source bytes. */
function listGpxImportIssues(db, input) {
  const candidate = normalizeGpxRendererRecord(input, 'GPX issue query')
  const missionId = normalizeGpxRendererId(candidate.missionId, 'GPX issue mission')
  getMission(db, missionId)
  const limit = candidate.limit ?? 50
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new Error('GPX import issue page limit must be between 1 and 100.')
  }
  const cursor = decodeGpxImportIssueCursor(candidate.cursor)
  const rows = db.prepare(`WITH issues AS (
      SELECT 'failure' AS issue_kind, failures.rowid AS issue_order_rowid,
        substr(failures.batch_id, 1, 1000) AS batch_id,
        length(CAST(failures.batch_id AS BLOB)) > 1000 AS batch_id_truncated,
        substr(batches.status, 1, 100) AS batch_status,
        length(CAST(batches.status AS BLOB)) > 100 AS batch_status_truncated,
        substr(failures.source_path, 1, 4096) AS source_path,
        length(CAST(failures.source_path AS BLOB)) > 4096 AS source_path_truncated,
        substr(failures.file_name, 1, 500) AS file_name,
        length(CAST(failures.file_name AS BLOB)) > 500 AS file_name_truncated,
        substr(failures.content_sha256, 1, 128) AS content_sha256,
        length(CAST(COALESCE(failures.content_sha256, '') AS BLOB)) > 128
          AS content_sha256_truncated,
        CASE WHEN failures.source_bytes_base64 IS NULL THEN 0 ELSE 1 END AS source_retained,
        failures.rejection_count AS rejection_count,
        substr(failures.reason, 1, 1000) AS reason,
        length(CAST(failures.reason AS BLOB)) > 1000 AS reason_truncated,
        substr(failures.recorded_at, 1, 64) AS recorded_at,
        length(CAST(failures.recorded_at AS BLOB)) > 64 AS recorded_at_truncated
      FROM gpx_import_failures AS failures
      JOIN gpx_import_batches AS batches ON batches.id = failures.batch_id
      WHERE failures.mission_id = ?
      UNION ALL
      SELECT 'batch' AS issue_kind, batches.rowid AS issue_order_rowid,
        substr(batches.id, 1, 1000) AS batch_id,
        length(CAST(batches.id AS BLOB)) > 1000 AS batch_id_truncated,
        substr(batches.status, 1, 100) AS batch_status,
        length(CAST(batches.status AS BLOB)) > 100 AS batch_status_truncated,
        NULL AS source_path, 0 AS source_path_truncated,
        'Selected GPX batch' AS file_name, 0 AS file_name_truncated,
        NULL AS content_sha256, 0 AS content_sha256_truncated, 0 AS source_retained,
        0 AS rejection_count,
        'GPX import batch was interrupted before batch completion was durably confirmed; review retained imports and per-file evidence.' AS reason,
        0 AS reason_truncated,
        substr(batches.updated_at, 1, 64) AS recorded_at,
        length(CAST(batches.updated_at AS BLOB)) > 64 AS recorded_at_truncated
      FROM gpx_import_batches AS batches
      WHERE batches.mission_id = ? AND batches.status = 'interrupted'
        AND NOT EXISTS (SELECT 1 FROM gpx_import_failures WHERE batch_id = batches.id)
      UNION ALL
      SELECT 'quarantine' AS issue_kind, quarantine.source_rowid AS issue_order_rowid,
        NULL AS batch_id, 0 AS batch_id_truncated,
        'interrupted' AS batch_status, 0 AS batch_status_truncated,
        NULL AS source_path, 0 AS source_path_truncated,
        substr(quarantine.import_id_preview, 1, 500) AS file_name,
        length(CAST(COALESCE(quarantine.import_id_preview, '') AS BLOB)) > 500
          AS file_name_truncated,
        NULL AS content_sha256, 0 AS content_sha256_truncated, 1 AS source_retained,
        0 AS rejection_count,
        'Legacy GPX evidence is quarantined outside the safe reconstruction envelope (size, identity, or storage key). The original remains retained; map projection, mission completion, and archive custody stay blocked until bounded repair.' AS reason,
        0 AS reason_truncated,
        substr(quarantine.detected_at, 1, 64) AS recorded_at,
        length(CAST(quarantine.detected_at AS BLOB)) > 64 AS recorded_at_truncated
      FROM legacy_gpx_backfill_quarantine AS quarantine
      JOIN gpx_track_imports AS imports ON imports.rowid = quarantine.source_rowid
      WHERE imports.mission_id = ?
    )
    SELECT issue_kind, CAST(issue_order_rowid AS TEXT) AS issue_rowid,
      batch_id, batch_id_truncated, batch_status, batch_status_truncated,
      source_path, source_path_truncated, file_name, file_name_truncated,
      content_sha256, content_sha256_truncated, source_retained,
      rejection_count,
      reason, reason_truncated, recorded_at, recorded_at_truncated
    FROM issues
    WHERE (? IS NULL OR recorded_at < ?
      OR (recorded_at = ? AND issue_kind < ?)
      OR (recorded_at = ? AND issue_kind = ?
        AND issue_order_rowid < CAST(? AS INTEGER)))
    ORDER BY recorded_at DESC, issue_kind DESC, issue_order_rowid DESC
    LIMIT ?`).all(
      missionId,
      missionId,
      missionId,
      cursor?.recordedAt ?? null,
      cursor?.recordedAt ?? null,
      cursor?.recordedAt ?? null,
      cursor?.issueKind ?? null,
      cursor?.recordedAt ?? null,
      cursor?.issueKind ?? null,
      cursor?.issueRowid ?? null,
      limit + 1,
    )
  const projected = rows.map(projectGpxImportIssueForRenderer)
  const packed = packGpxRendererPage(projected, {
    limit,
    byteLimit: DEFAULT_PAGE_BYTE_LIMIT - 2_048,
  })
  const entries = packed.entries
  const lastRow = rows[entries.length - 1]
  return {
    entries,
    nextCursor: packed.hasMore && lastRow !== undefined
      ? Buffer.from(JSON.stringify({
          recordedAt: lastRow.recorded_at,
          issueKind: lastRow.issue_kind,
          issueRowid: lastRow.issue_rowid,
        }), 'utf8')
        .toString('base64url')
      : null,
  }
}

/** Projects one persisted issue through bounded, explicit renderer scalars. */
function projectGpxImportIssueForRenderer(row) {
  const warnings = [
    ...(row.batch_id_truncated ? ['batch_id_truncated'] : []),
    ...(row.batch_status_truncated ? ['batch_status_truncated'] : []),
    ...(row.source_path_truncated ? ['source_path_truncated'] : []),
    ...(row.file_name_truncated ? ['file_name_truncated'] : []),
    ...(row.content_sha256_truncated ? ['content_sha256_truncated'] : []),
    ...(row.reason_truncated ? ['reason_truncated'] : []),
    ...(row.recorded_at_truncated ? ['recorded_at_truncated'] : []),
  ]
  const reason = row.source_path_truncated
    ? 'Persisted GPX issue reason is retained but its oversized source path prevents safe renderer display.'
    : redactGpxImportIssueReason(row.reason, row.source_path, row.file_name)
  return {
    id: `${row.issue_kind}:${row.issue_rowid}`,
    batch_id: boundGpxIssueProjectionText(row.batch_id, MAX_GPX_RENDERER_ID_LENGTH, row.batch_id_truncated),
    batch_status: boundGpxIssueProjectionText(row.batch_status, 100, row.batch_status_truncated),
    file_name: boundGpxIssueProjectionText(row.file_name, MAX_GPX_ISSUE_FILE_NAME_LENGTH, row.file_name_truncated),
    content_sha256: boundGpxIssueProjectionText(row.content_sha256, MAX_GPX_ISSUE_HASH_LENGTH, row.content_sha256_truncated),
    source_retained: Boolean(row.source_retained),
    rejection_count: Number(row.rejection_count),
    reason: boundGpxIssueProjectionText(reason, MAX_GPX_ISSUE_REASON_LENGTH, row.reason_truncated),
    recorded_at: boundGpxIssueProjectionText(row.recorded_at, MAX_GPX_ISSUE_TIMESTAMP_LENGTH, row.recorded_at_truncated),
    ...(warnings.length === 0 ? {} : { projection_warnings: warnings }),
  }
}

/** Marks renderer truncation explicitly while enforcing one scalar limit. */
function boundGpxIssueProjectionText(value, maximumLength, truncated) {
  if (value === null || value === undefined) return null
  const text = String(value)
  if (!truncated && text.length <= maximumLength) return text
  return `${text.slice(0, Math.max(0, maximumLength - GPX_ISSUE_TRUNCATION_SUFFIX.length))}${GPX_ISSUE_TRUNCATION_SUFFIX}`
}

function redactGpxImportIssueReason(reason, sourcePath, fileName) {
  const bounded = safeEvidenceFailureReason(reason)
  if (typeof sourcePath !== 'string' || sourcePath.length === 0) return bounded
  const withoutFilePath = bounded.split(sourcePath).join(fileName ?? 'selected GPX file')
  const directoryPath = path.dirname(sourcePath)
  return directoryPath === '.' || directoryPath === path.parse(directoryPath).root
    ? withoutFilePath
    : withoutFilePath.split(directoryPath).join('selected GPX directory')
}

function decodeGpxImportIssueCursor(value) {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string' || value.length < 1 || value.length > 500) {
    throw new Error('GPX import issue cursor is invalid.')
  }
  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    if (
      typeof decoded?.recordedAt !== 'string' ||
      decoded.recordedAt.length < 1 ||
      decoded.recordedAt.length > MAX_GPX_ISSUE_TIMESTAMP_LENGTH ||
      typeof decoded?.issueKind !== 'string' ||
      !/^(failure|batch|quarantine)$/u.test(decoded.issueKind) ||
      typeof decoded?.issueRowid !== 'string' ||
      !/^-?(?:0|[1-9][0-9]{0,18})$/u.test(decoded.issueRowid)
    ) {
      throw new Error('invalid')
    }
    return decoded
  } catch {
    throw new Error('GPX import issue cursor is invalid.')
  }
}

/** Stores an exact GPX source as append-only evidence, deduplicated by byte digest. */
function upsertGpxEvidence(db, input, publicationReceipt = null) {
  const missionId = input.mission_id
  assertNoUnsettledLegacyGpxTarget(db, input.id, missionId, input.source_path)
  const timestamp = now()
  const normalizedHash = normalizeGpxContentHash(
    input.content_sha256,
    input.source_bytes_base64,
  )
  const displayGeometryJson = compactGpxDisplayGeometry(input.geometry_json)
  const existingById = input.id === undefined || input.id === null
    ? undefined
    : db.prepare('SELECT * FROM gpx_track_imports WHERE id = ?').get(input.id)
  const existingByPath = db.prepare(
    'SELECT * FROM gpx_track_imports WHERE mission_id = ? AND source_path = ?',
  ).get(missionId, input.source_path)
  const existingByAlias = db.prepare(`SELECT imports.* FROM gpx_import_aliases AS aliases
    JOIN gpx_track_imports AS imports ON imports.id = aliases.import_id
    WHERE aliases.mission_id = ? AND aliases.source_path = ?`)
    .get(missionId, input.source_path)
  assertGpxIdentityPathAgreement(existingById, existingByPath, existingByAlias)
  const existing = existingById ?? existingByPath ?? existingByAlias
  if (existing !== undefined && existing.mission_id !== missionId) {
    throw new Error(`Cannot move GPX evidence ${existing.id} to a different mission.`)
  }
  if (existing?.import_state === 'staging') {
    throw new Error(`GPX evidence ${existing.id} has an interrupted staged import that must be recovered before retrying.`)
  }

  if (normalizedHash !== null && existing === undefined) {
    const contentMatch = db.prepare(`SELECT * FROM gpx_track_imports
      WHERE mission_id = ? AND content_sha256 = ? AND retired_at IS NULL
        AND import_state = 'complete'
        AND EXISTS (
          SELECT 1 FROM gpx_import_revisions AS revisions
          WHERE revisions.import_id = gpx_track_imports.id
        )
      ORDER BY imported_at ASC LIMIT 1`).get(missionId, normalizedHash)
    if (contentMatch !== undefined && contentMatch.id !== existing?.id) {
      assertSameHashGpxEvidenceMatches(db, contentMatch, input, displayGeometryJson)
      const transaction = db.transaction(() => {
        ensureWritableMission(db, missionId)
        const current = db.prepare('SELECT * FROM gpx_track_imports WHERE id = ?').get(contentMatch.id)
        if (current === undefined || current.mission_id !== missionId
          || current.retired_at !== null || current.import_state !== 'complete'
          || current.content_sha256 !== normalizedHash
          || Number(current.revision_sequence) !== Number(contentMatch.revision_sequence)) {
          throw new Error('GPX evidence changed while a same-content alias was being checked; retry the import.')
        }
        upsertGpxAlias(db, missionId, current.id, input.source_path, input.file_name, timestamp)
        insertEvent(db, missionId, 'gpx_import_alias_added', timestamp, {
          gpx_import_id: current.id,
          source_path: input.source_path,
          content_sha256: normalizedHash,
        })
        if (publicationReceipt !== null) {
          settleGpxImportSourceReceiptWithinTransaction(db, publicationReceipt, timestamp)
        }
      })
      transaction.immediate()
      return getById(db, 'gpx_track_imports', contentMatch.id, 'GPX import')
    }
  }

  if (existing?.retired_at !== null && existing?.retired_at !== undefined) {
    throw new Error(`Cannot update retired GPX evidence ${existing.id}.`)
  }

  const id = existing?.id ?? input.id ?? randomUUID()
  const changedSource = existing !== undefined
    && (normalizedHash === null || normalizedHash !== existing.content_sha256)
  const revisionSequence = existing === undefined
    ? 1
    : changedSource ? Number(existing.revision_sequence) + 1 : Number(existing.revision_sequence)
  const row = {
    id,
    mission_id: missionId,
    source_path: existing?.source_path ?? input.source_path,
    file_name: input.file_name,
    display_name: input.display_name,
    geometry_json: displayGeometryJson,
    metadata_json: input.metadata_json ?? null,
    content_sha256: normalizedHash ?? existing?.content_sha256 ?? null,
    source_bytes_base64: input.source_bytes_base64 ?? existing?.source_bytes_base64 ?? null,
    timing_class: normalizeGpxTimingClass(input.timing_class ?? existing?.timing_class ?? 'undated'),
    outing_id: input.outing_id ?? existing?.outing_id ?? null,
    import_state: 'complete',
    revision_sequence: revisionSequence,
    retired_at: null,
    retired_by: null,
    imported_at: existing?.imported_at ?? timestamp,
    updated_at: timestamp,
  }
  const shouldRecordRevision = existing === undefined || changedSource
  const completeness = normalizedHash === null || input.source_bytes_base64 === undefined
    ? 'legacy_baseline'
    : 'complete'
  if (existing !== undefined && !changedSource) {
    assertSameHashGpxEvidenceMatches(db, existing, input, displayGeometryJson)
  }

  const transaction = db.transaction(() => {
    ensureWritableMission(db, missionId)
    if (existing !== undefined && !changedSource) {
      const current = db.prepare('SELECT * FROM gpx_track_imports WHERE id = ?').get(existing.id)
      if (current === undefined || current.mission_id !== missionId
        || current.retired_at !== null || current.import_state !== 'complete'
        || current.content_sha256 !== normalizedHash
        || Number(current.revision_sequence) !== Number(existing.revision_sequence)) {
        throw new Error('GPX evidence changed while an idempotent retry was being checked; retry the import.')
      }
      upsertGpxAlias(db, missionId, current.id, input.source_path, input.file_name, timestamp)
      if (publicationReceipt !== null) {
        settleGpxImportSourceReceiptWithinTransaction(db, publicationReceipt, timestamp)
      }
      return
    }
    const columns = Object.keys(row)
    const assignments = columns
      .filter((column) => !IMMUTABLE_UPSERT_COLUMNS.gpx_track_imports.has(column))
      .map((column) => `${column} = excluded.${column}`)
      .join(', ')
    db.prepare(`INSERT INTO gpx_track_imports (${columns.join(', ')})
      VALUES (${columns.map(() => '?').join(', ')})
      ON CONFLICT(id) DO UPDATE SET ${assignments}`)
      .run(...columns.map((column) => row[column]))
    upsertGpxAlias(db, missionId, id, input.source_path, input.file_name, timestamp)
    const auditEventId = insertEvent(
      db,
      missionId,
      existing === undefined ? 'gpx_import_created' : 'gpx_import_updated',
      timestamp,
      {
        gpx_import_id: id,
        source_path: input.source_path,
        file_name: input.file_name,
        display_name: input.display_name,
        content_sha256: row.content_sha256,
        revision_sequence: revisionSequence,
        timing_class: row.timing_class,
        completeness,
      },
    )
    if (shouldRecordRevision) {
      db.prepare(`INSERT INTO gpx_import_revisions (
        id, mission_id, import_id, revision_sequence, source_revision_sequence, content_sha256,
        source_bytes_base64, source_path, file_name, display_name, geometry_json,
        metadata_json, timing_class, outing_id, import_state, completeness, recorded_at, audit_event_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'complete', ?, ?, ?)`)
        .run(
          randomUUID(), missionId, id, revisionSequence, revisionSequence, row.content_sha256,
          row.source_bytes_base64, input.source_path, row.file_name, row.display_name,
          displayGeometryJson, row.metadata_json, row.timing_class, row.outing_id, completeness,
          timestamp, auditEventId,
        )
      for (const point of input.points ?? []) {
        db.prepare(`INSERT INTO gpx_evidence_points (
          import_id, revision_sequence, segment_index, point_index, track_name,
          lat, lon, elevation, source_time
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(
            id, revisionSequence, point.segment_index, point.point_index,
            point.track_name ?? null, point.lat, point.lon, point.elevation ?? null,
            point.timestamp === null || point.timestamp === undefined
              ? null
              : normalizeIsoTimestamp(point.timestamp, 'GPX source time'),
          )
      }
      for (const rejection of input.rejections ?? []) {
        db.prepare(`INSERT INTO gpx_evidence_rejections (
          id, import_id, revision_sequence, kind, segment_index, point_index, reason, source_value
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(
            randomUUID(), id, revisionSequence, rejection.kind,
            rejection.segment_index, rejection.point_index ?? null,
            rejection.reason, rejection.source_value ?? null,
          )
      }
    }
    if (publicationReceipt !== null) {
      settleGpxImportSourceReceiptWithinTransaction(db, publicationReceipt, timestamp)
    }
  })
  transaction.immediate()
  return getById(db, 'gpx_track_imports', id, 'GPX import')
}

/** Refuses same-byte retries whose evidence projection or parsed rows disagree. */
function assertSameHashGpxEvidenceMatches(db, current, input, displayGeometryJson) {
  const revision = db.prepare(`SELECT geometry_json, timing_class, outing_id,
      source_revision_sequence
    FROM gpx_import_revisions
    WHERE import_id = ? AND revision_sequence = ? AND import_state = 'complete'`)
    .get(current.id, current.revision_sequence)
  const requestedTimingClass = normalizeGpxTimingClass(input.timing_class ?? current.timing_class)
  const requestedOutingId = input.outing_id ?? current.outing_id ?? null
  if (revision === undefined
    || revision.geometry_json !== displayGeometryJson
    || revision.timing_class !== requestedTimingClass
    || (revision.outing_id ?? null) !== requestedOutingId) {
    throw new Error('The same retained GPX bytes cannot change evidence fields; use the presentation or outing-assignment operation instead.')
  }
  const retainedPoints = db.prepare(`SELECT segment_index, point_index, track_name,
    lat, lon, elevation, source_time AS timestamp
    FROM gpx_evidence_points WHERE import_id = ? AND revision_sequence = ?
    ORDER BY segment_index, point_index`).all(current.id, revision.source_revision_sequence)
  const requestedPoints = (input.points ?? []).map((point) => ({
    segment_index: point.segment_index,
    point_index: point.point_index,
    track_name: point.track_name ?? null,
    lat: point.lat,
    lon: point.lon,
    elevation: point.elevation ?? null,
    timestamp: point.timestamp === null || point.timestamp === undefined
      ? null
      : normalizeIsoTimestamp(point.timestamp, 'GPX source time'),
  }))
  if (JSON.stringify(retainedPoints) !== JSON.stringify(requestedPoints)) {
    throw new Error('The same retained GPX bytes cannot change evidence fields; parsed points differ from the retained revision.')
  }
  const retainedRejections = db.prepare(`SELECT kind, segment_index, point_index, reason, source_value
    FROM gpx_evidence_rejections WHERE import_id = ? AND revision_sequence = ?
    ORDER BY segment_index, COALESCE(point_index, -1), kind, reason, COALESCE(source_value, '')`)
    .all(current.id, revision.source_revision_sequence)
  const requestedRejections = (input.rejections ?? []).map((rejection) => ({
    kind: rejection.kind,
    segment_index: rejection.segment_index,
    point_index: rejection.point_index ?? null,
    reason: rejection.reason,
    source_value: rejection.source_value ?? null,
  })).sort((left, right) => left.segment_index - right.segment_index
    || (left.point_index ?? -1) - (right.point_index ?? -1)
    || left.kind.localeCompare(right.kind)
    || left.reason.localeCompare(right.reason)
    || String(left.source_value ?? '').localeCompare(String(right.source_value ?? '')))
  if (JSON.stringify(retainedRejections) !== JSON.stringify(requestedRejections)) {
    throw new Error('The same retained GPX bytes cannot change evidence fields; retained rejection evidence differs.')
  }
}

/** Yields after each GPX writer slice so current-position writers can acquire WAL ownership. */
function yieldGpxWriterTurn() {
  return new Promise((resolve) => setTimeout(resolve, 5))
}

/** Persists large GPX point sets in short writer slices, publishing only after a final fence. */
async function upsertGpxEvidenceChunked(db, input, chunkSize = 25, publicationReceipt = null) {
  if ((input.points?.length ?? 0) <= chunkSize
    && (input.rejections?.length ?? 0) <= chunkSize
    && (input.source_bytes_base64?.length ?? 0) <= MAX_INLINE_GPX_SOURCE_BASE64_LENGTH) {
    return upsertGpxEvidence(db, input, publicationReceipt)
  }
  const missionId = input.mission_id
  assertNoUnsettledLegacyGpxTarget(db, input.id, missionId, input.source_path)
  const timestamp = now()
  const normalizedHash = normalizeGpxContentHash(input.content_sha256, input.source_bytes_base64)
  const existingById = input.id === undefined || input.id === null
    ? undefined
    : db.prepare('SELECT * FROM gpx_track_imports WHERE id = ?').get(input.id)
  const existingByPath = db.prepare(
    'SELECT * FROM gpx_track_imports WHERE mission_id = ? AND source_path = ?',
  ).get(missionId, input.source_path)
  const existingByAlias = db.prepare(`SELECT imports.* FROM gpx_import_aliases AS aliases
    JOIN gpx_track_imports AS imports ON imports.id = aliases.import_id
    WHERE aliases.mission_id = ? AND aliases.source_path = ?`)
    .get(missionId, input.source_path)
  assertGpxIdentityPathAgreement(existingById, existingByPath, existingByAlias)
  const existing = existingById ?? existingByPath ?? existingByAlias
  if (existing !== undefined && existing.mission_id !== missionId) {
    throw new Error(`Cannot move GPX evidence ${existing.id} to a different mission.`)
  }
  if (existing?.import_state === 'staging') {
    throw new Error(`GPX evidence ${existing.id} has an interrupted staged import that must be recovered before retrying.`)
  }
  if (existing?.retired_at !== null && existing?.retired_at !== undefined) {
    throw new Error(`Cannot update retired GPX evidence ${existing.id}.`)
  }
  if (existing === undefined) {
    const contentMatch = db.prepare(`SELECT * FROM gpx_track_imports
      WHERE mission_id = ? AND content_sha256 = ? AND retired_at IS NULL
        AND import_state = 'complete'
        AND EXISTS (
          SELECT 1 FROM gpx_import_revisions AS revisions
          WHERE revisions.import_id = gpx_track_imports.id
        )
      ORDER BY imported_at ASC LIMIT 1`).get(missionId, normalizedHash)
    if (contentMatch !== undefined) return upsertGpxEvidence(
      db,
      input,
      publicationReceipt,
    )
  }
  if (existing !== undefined && normalizedHash === existing.content_sha256) {
    return upsertGpxEvidence(
      db,
      input,
      publicationReceipt,
    )
  }

  const id = existing?.id ?? input.id ?? randomUUID()
  const revisionSequence = existing === undefined ? 1 : Number(existing.revision_sequence) + 1
  const completeness = normalizedHash === null || input.source_bytes_base64 === undefined
    ? 'legacy_baseline'
    : 'complete'
  const displayGeometryJson = compactGpxDisplayGeometry(input.geometry_json)
  const row = {
    id,
    mission_id: missionId,
    source_path: existing?.source_path ?? input.source_path,
    file_name: input.file_name,
    display_name: input.display_name,
    geometry_json: displayGeometryJson,
    metadata_json: input.metadata_json ?? null,
    content_sha256: normalizedHash ?? existing?.content_sha256 ?? null,
    // Exact bytes are authoritative in the immutable revision. Keeping a
    // second multi-megabyte copy in the active projection doubles one writer
    // turn and can delay current-position commits on slower field storage.
    source_bytes_base64: null,
    timing_class: normalizeGpxTimingClass(input.timing_class ?? existing?.timing_class ?? 'undated'),
    outing_id: input.outing_id ?? existing?.outing_id ?? null,
    import_state: 'complete',
    revision_sequence: revisionSequence,
    retired_at: null,
    retired_by: null,
    imported_at: existing?.imported_at ?? timestamp,
    updated_at: timestamp,
  }

  const stage = db.transaction(() => {
    ensureWritableMission(db, missionId)
    if (existing === undefined) {
      const stagedRow = { ...row, import_state: 'staging' }
      const columns = Object.keys(stagedRow)
      db.prepare(`INSERT INTO gpx_track_imports (${columns.join(', ')})
        VALUES (${columns.map(() => '?').join(', ')})`)
        .run(...columns.map((column) => stagedRow[column]))
    }
    db.prepare(`INSERT INTO gpx_import_revisions (
      id, mission_id, import_id, revision_sequence, source_revision_sequence, content_sha256,
      source_bytes_base64, source_path, file_name, display_name, geometry_json,
      metadata_json, timing_class, outing_id, import_state, completeness,
      recorded_at, audit_event_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'staging', ?, ?, NULL)`)
      .run(
        randomUUID(), missionId, id, revisionSequence, revisionSequence, row.content_sha256,
        input.source_bytes_base64 ?? null, input.source_path, row.file_name, row.display_name,
        row.geometry_json, row.metadata_json, row.timing_class, row.outing_id,
        completeness, timestamp,
      )
  })
  stage.immediate()
  await yieldGpxWriterTurn()

  const pointStatement = db.prepare(`INSERT INTO gpx_evidence_points (
    import_id, revision_sequence, segment_index, point_index, track_name,
    lat, lon, elevation, source_time
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  for (let offset = 0; offset < (input.points?.length ?? 0); offset += chunkSize) {
    const chunk = input.points.slice(offset, offset + chunkSize)
    const writeChunk = db.transaction(() => {
      ensureWritableMission(db, missionId)
      for (const point of chunk) {
        pointStatement.run(
          id, revisionSequence, point.segment_index, point.point_index,
          point.track_name ?? null, point.lat, point.lon, point.elevation ?? null,
          point.timestamp === null || point.timestamp === undefined
            ? null
            : normalizeIsoTimestamp(point.timestamp, 'GPX source time'),
        )
      }
    })
    writeChunk.immediate()
    await yieldGpxWriterTurn()
  }
  const rejectionStatement = db.prepare(`INSERT INTO gpx_evidence_rejections (
    id, import_id, revision_sequence, kind, segment_index, point_index, reason, source_value
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
  for (let offset = 0; offset < (input.rejections?.length ?? 0); offset += chunkSize) {
    const chunk = input.rejections.slice(offset, offset + chunkSize)
    const writeChunk = db.transaction(() => {
      ensureWritableMission(db, missionId)
      for (const rejection of chunk) {
        rejectionStatement.run(
          randomUUID(), id, revisionSequence, rejection.kind, rejection.segment_index,
          rejection.point_index ?? null, rejection.reason, rejection.source_value ?? null,
        )
      }
    })
    writeChunk.immediate()
    await yieldGpxWriterTurn()
  }

  await yieldGpxWriterTurn()

  const publish = db.transaction(() => {
    ensureWritableMission(db, missionId)
    const publicationTimestamp = now()
    const current = db.prepare('SELECT * FROM gpx_track_imports WHERE id = ?').get(id)
    const currentMatchesStage = existing === undefined
      ? current?.mission_id === missionId && current.import_state === 'staging'
        && Number(current.revision_sequence) === revisionSequence
        && current.source_path === row.source_path
        && current.content_sha256 === row.content_sha256
      : current?.mission_id === existing.mission_id && current.import_state === 'complete'
        && current.retired_at === null
        && Number(current.revision_sequence) === Number(existing.revision_sequence)
        && current.source_path === existing.source_path
        && current.content_sha256 === existing.content_sha256
        && current.metadata_json === existing.metadata_json
        && current.outing_id === existing.outing_id
        && current.updated_at === existing.updated_at
    if (!currentMatchesStage) {
      const reason = current?.retired_at !== null && current?.retired_at !== undefined
        ? 'GPX evidence was retired while its replacement revision was staged; the staged revision was not published.'
        : 'GPX evidence changed while its replacement revision was staged; the stale revision was not published.'
      db.prepare(`DELETE FROM gpx_import_revisions
        WHERE import_id = ? AND revision_sequence = ? AND import_state = 'staging'`)
        .run(id, revisionSequence)
      if (existing === undefined) {
        db.prepare(`DELETE FROM gpx_track_imports
          WHERE id = ? AND revision_sequence = ? AND import_state = 'staging'`)
          .run(id, revisionSequence)
      }
      if (publicationReceipt !== null) {
        recordGpxImportFailureWithinTransaction(db, {
          batchId: publicationReceipt.batchId,
          missionId: publicationReceipt.missionId,
          sourcePath: publicationReceipt.sourcePath,
          fileName: row.file_name,
          contentSha256: row.content_sha256,
          sourceBytesBase64: input.source_bytes_base64 ?? null,
          reason,
        }, publicationTimestamp)
      }
      return { published: false, reason }
    }
    const publishedRow = {
      ...row,
      imported_at: existing?.imported_at ?? publicationTimestamp,
      updated_at: publicationTimestamp,
    }
    const columns = Object.keys(publishedRow)
    const assignments = columns
      .filter((column) => !IMMUTABLE_UPSERT_COLUMNS.gpx_track_imports.has(column))
      .map((column) => `${column} = excluded.${column}`)
      .join(', ')
    db.prepare(`INSERT INTO gpx_track_imports (${columns.join(', ')})
      VALUES (${columns.map(() => '?').join(', ')})
      ON CONFLICT(id) DO UPDATE SET ${assignments}`)
      .run(...columns.map((column) => publishedRow[column]))
    if (existing === undefined) {
      db.prepare(`UPDATE gpx_track_imports SET imported_at = ? WHERE id = ?`)
        .run(publicationTimestamp, id)
    }
    upsertGpxAlias(db, missionId, id, input.source_path, input.file_name, publicationTimestamp)
    const auditEventId = insertEvent(
      db,
      missionId,
      existing === undefined ? 'gpx_import_created' : 'gpx_import_updated',
      publicationTimestamp,
      {
        gpx_import_id: id,
        source_path: input.source_path,
        content_sha256: row.content_sha256,
        revision_sequence: revisionSequence,
        timing_class: row.timing_class,
        completeness,
      },
    )
    db.prepare(`UPDATE gpx_import_revisions
      SET import_state = 'complete', recorded_at = ?, audit_event_id = ?
      WHERE import_id = ? AND revision_sequence = ?`)
      .run(publicationTimestamp, auditEventId, id, revisionSequence)
    if (publicationReceipt !== null) {
      settleGpxImportSourceReceiptWithinTransaction(
        db,
        publicationReceipt,
        publicationTimestamp,
      )
    }
    return { published: true, reason: null }
  })
  const publication = publish.immediate()
  if (!publication.published) throw new Error(publication.reason)
  return getById(db, 'gpx_track_imports', id, 'GPX import')
}

/** Updates renderer presentation metadata without resending or rewriting retained GPX evidence. */
function updateGpxImportPresentation(db, input) {
  const candidate = normalizeGpxRendererRecord(input, 'GPX presentation')
  const importId = normalizeGpxRendererId(candidate.id, 'GPX import')
  const missionId = normalizeGpxRendererId(candidate.mission_id, 'GPX import mission')
  const displayName = candidate.display_name === undefined
    ? undefined
    : normalizeBoundedRequiredText(candidate.display_name, 'GPX display name', 500)
  if (
    candidate.metadata_json !== undefined && candidate.metadata_json !== null &&
    (typeof candidate.metadata_json !== 'string' || candidate.metadata_json.length > 100_000)
  ) {
    throw new Error('GPX import presentation metadata must be bounded JSON text.')
  }
  if (candidate.metadata_json !== undefined && candidate.metadata_json !== null) {
    try {
      JSON.parse(candidate.metadata_json)
    } catch {
      throw new Error('GPX import presentation metadata must be valid JSON text.')
    }
  }
  const timestamp = now()
  const transaction = db.transaction(() => {
    assertNoUnsettledLegacyGpxTarget(db, importId, missionId, null)
    ensureWritableMission(db, missionId)
    const existing = db.prepare(`SELECT id, mission_id, import_state, retired_at,
      display_name, metadata_json
      FROM gpx_track_imports WHERE id = ?`).get(importId)
    if (existing === undefined || existing.mission_id !== missionId) {
      throw new Error('Active GPX evidence was not found in the requested mission.')
    }
    if (existing.import_state !== 'complete' || existing.retired_at !== null) {
      throw new Error('Only active, complete GPX evidence presentation can be updated.')
    }
    db.prepare(`UPDATE gpx_track_imports
      SET display_name = ?, metadata_json = ?, updated_at = ? WHERE id = ?`)
      .run(
        displayName ?? existing.display_name,
        candidate.metadata_json === undefined ? existing.metadata_json : candidate.metadata_json,
        timestamp,
        importId,
      )
    insertEvent(db, missionId, 'gpx_import_presentation_updated', timestamp, {
      gpx_import_id: importId,
      fields: [
        ...(displayName === undefined ? [] : ['display_name']),
        ...(candidate.metadata_json === undefined ? [] : ['metadata_json']),
      ],
    })
  })
  transaction.immediate()
  return projectGpxImportForRenderer(
    getById(db, 'gpx_track_imports', importId, 'GPX import'),
  )
}

/** Removes exact retained bytes and enforces the single-response renderer budget. */
function projectGpxImportForRenderer(row) {
  const { source_bytes_base64: _retainedSourceBytes, ...projection } = row
  return packGpxRendererPage([projection], { limit: 1 }).entries[0]
}

/** Reads one GPX projection without materializing retained source bytes in Electron main. */
function readGpxImportWithoutRetainedBytes(db, importId) {
  const row = db.prepare(`SELECT id, mission_id, source_path, file_name, display_name,
      geometry_json, metadata_json, content_sha256, timing_class, outing_id,
      import_state, revision_sequence, retired_at, retired_by, imported_at, updated_at
    FROM gpx_track_imports WHERE id = ?`).get(importId)
  if (row === undefined) throw new Error(`GPX import ${importId} was not found.`)
  return row
}

/** Assigns retained GPX evidence to an outing as a new immutable revision. */
function assignGpxEvidenceToOuting(db, input) {
  const candidate = normalizeGpxRendererRecord(input, 'GPX outing assignment')
  const importId = normalizeGpxRendererId(candidate.import_id, 'GPX import')
  const outingId = normalizeGpxRendererId(
    candidate.outing_id,
    'GPX outing',
    MAX_GPX_RENDERER_OUTING_ID_LENGTH,
  )
  const assignedBy = normalizeBoundedOptionalTextValue(
    candidate.assigned_by,
    'GPX outing assignment coordinator',
    MAX_GPX_RENDERER_ACTOR_LENGTH,
  )
  assertNoUnsettledLegacyGpxTarget(db, importId, null, null)
  const existing = db.prepare(`SELECT id, mission_id, outing_id, import_state,
      retired_at, revision_sequence
    FROM gpx_track_imports WHERE id = ?`).get(importId)
  if (existing === undefined || existing.retired_at !== null) {
    throw new Error(`Active GPX evidence ${importId} was not found.`)
  }
  const outing = db.prepare('SELECT * FROM outings WHERE id = ?').get(outingId)
  if (outing?.mission_id !== existing.mission_id) {
    throw new Error('GPX evidence outing is not in the same mission.')
  }
  if (existing.outing_id === outingId) return readGpxImportWithoutRetainedBytes(db, importId)
  const timestamp = now()
  const previousSequence = Number(existing.revision_sequence)
  const nextSequence = previousSequence + 1
  const transaction = db.transaction(() => {
    ensureWritableMission(db, existing.mission_id)
    const auditEventId = insertEvent(db, existing.mission_id, 'gpx_import_outing_assigned', timestamp, {
      gpx_import_id: importId,
      outing_id: outingId,
      assigned_by: assignedBy,
      revision_sequence: nextSequence,
    })
    db.prepare(`UPDATE gpx_track_imports
      SET outing_id = ?, revision_sequence = ?, updated_at = ? WHERE id = ?`)
      .run(outingId, nextSequence, timestamp, importId)
    db.prepare(`INSERT INTO gpx_import_revisions (
      id, mission_id, import_id, revision_sequence, source_revision_sequence, content_sha256,
      source_bytes_base64, source_path, file_name, display_name, geometry_json,
      metadata_json, timing_class, outing_id, completeness, recorded_at, audit_event_id
    ) SELECT ?, mission_id, import_id, ?, source_revision_sequence, content_sha256, NULL,
      source_path, file_name, display_name, geometry_json, metadata_json, timing_class,
      ?, completeness, ?, ?
    FROM gpx_import_revisions WHERE import_id = ? AND revision_sequence = ?`)
      .run(randomUUID(), nextSequence, outingId, timestamp, auditEventId, importId, previousSequence)
  })
  transaction.immediate()
  return readGpxImportWithoutRetainedBytes(db, importId)
}

/** Retires the transaction-current GPX revision without deleting retained evidence. */
function retireGpxEvidence(db, importId, faultInjection = {}) {
  let retired = false
  const transaction = db.transaction(() => {
    assertNoUnsettledLegacyGpxTarget(db, importId, null, null)
    const existing = db.prepare('SELECT * FROM gpx_track_imports WHERE id = ?').get(importId)
    if (existing === undefined || existing.retired_at !== null) return
    ensureWritableMission(db, existing.mission_id)
    const timestamp = now()
    db.prepare('UPDATE gpx_track_imports SET retired_at = ?, updated_at = ? WHERE id = ?')
      .run(timestamp, timestamp, importId)
    insertEvent(db, existing.mission_id, 'gpx_import_deleted', timestamp, {
      gpx_import_id: importId,
      content_sha256: existing.content_sha256,
      revision_sequence: existing.revision_sequence,
      retired: true,
    })
    retired = true
  })
  faultInjection.beforeTransaction?.()
  transaction.immediate()
  return retired
}

function upsertGpxAlias(db, missionId, importId, sourcePath, fileName, timestamp) {
  db.prepare(`INSERT INTO gpx_import_aliases (
    mission_id, import_id, source_path, file_name, first_seen_at, last_seen_at
  ) VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(mission_id, source_path) DO UPDATE SET
    import_id = excluded.import_id,
    file_name = excluded.file_name,
    last_seen_at = excluded.last_seen_at`)
    .run(missionId, importId, sourcePath, fileName, timestamp, timestamp)
}

function assertGpxIdentityPathAgreement(...candidates) {
  const identities = [...new Set(candidates.filter(Boolean).map((candidate) => candidate.id))]
  if (identities.length > 1) {
    throw new Error(
      `GPX identity ${identities[0]} cannot use a path that belongs to different GPX evidence ${identities[1]}.`,
    )
  }
}

/** Prevents a revisionless legacy artifact from changing before reconstruction or bounded repair. */
function assertNoUnsettledLegacyGpxTarget(db, importId, missionId, sourcePath) {
  const byId = importId === undefined || importId === null
    ? undefined
    : db.prepare(`SELECT 1 FROM gpx_track_imports AS imports
        WHERE imports.id = ? AND NOT EXISTS (
          SELECT 1 FROM gpx_import_revisions AS revisions WHERE revisions.import_id = imports.id
        ) LIMIT 1`).get(importId)
  const byPath = missionId === undefined || missionId === null
    || sourcePath === undefined || sourcePath === null
    ? undefined
    : db.prepare(`SELECT 1 FROM gpx_track_imports AS imports
        WHERE imports.mission_id = ? AND imports.source_path = ? AND NOT EXISTS (
          SELECT 1 FROM gpx_import_revisions AS revisions WHERE revisions.import_id = imports.id
        ) LIMIT 1`)
      .get(missionId, sourcePath)
  if (byId !== undefined || byPath !== undefined) {
    throw new Error(
      'Revisionless legacy GPX evidence cannot be changed or retired while bounded reconstruction or quarantine repair remains unsettled.',
    )
  }
}

function normalizeGpxContentHash(value, sourceBytesBase64) {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/i.test(value)) {
    throw new Error('GPX source content hash must be a SHA-256 hexadecimal digest.')
  }
  const normalized = value.toLowerCase()
  if (sourceBytesBase64 !== undefined && sourceBytesBase64 !== null) {
    if (typeof sourceBytesBase64 !== 'string') {
      throw new Error('GPX retained source bytes must be Base64 text.')
    }
    const bytes = Buffer.from(sourceBytesBase64, 'base64')
    if (bytes.toString('base64') !== sourceBytesBase64.replace(/\s+/gu, '')) {
      throw new Error('GPX retained source bytes are not valid Base64.')
    }
    const actual = createHash('sha256').update(bytes).digest('hex')
    if (actual !== normalized) {
      throw new Error('GPX source content hash does not match retained source bytes.')
    }
  }
  return normalized
}

function normalizeGpxTimingClass(value) {
  if (!['fully_dated', 'partially_dated', 'undated'].includes(value)) {
    throw new Error('GPX timing class is invalid.')
  }
  return value
}

function normalizeIsoTimestamp(value, label) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${label} is invalid.`)
  }
  return new Date(Date.parse(value)).toISOString()
}

/** Requires an explicit-offset, calendar-valid instant for coordinator pass evidence. */
function normalizeStrictSearchTimestamp(value, label) {
  const normalized = normalizeBoundedRequiredText(
    value,
    label,
    MAX_SEARCH_OPERATION_TIMESTAMP_LENGTH,
  )
  if (!isStrictTrackingTimestamp(normalized)) {
    throw new Error(`${label} must be a valid ISO8601 date-time with an explicit offset.`)
  }
  return new Date(Date.parse(normalized)).toISOString()
}

function gpxDefaults(input) {
  const timestamp = now()
  return {
    id: input.id ?? randomUUID(),
    mission_id: input.mission_id,
    source_path: input.source_path,
    file_name: input.file_name,
    display_name: input.display_name,
    geometry_json: input.geometry_json,
    metadata_json: input.metadata_json ?? null,
    imported_at: timestamp,
    updated_at: timestamp,
  }
}

function listLayerCatalogMetadata(db, missionId) {
  return all(
    db,
    `SELECT mission_id, node_id, parent_node_id, node_kind, alias, is_favorite, is_visible,
            display_order, metadata_json, updated_at
       FROM layer_catalog_entries
      WHERE mission_id = ?
      ORDER BY parent_node_id ASC, display_order ASC, node_id ASC`,
    missionId,
  ).map(fromLayerCatalogRow)
}

function upsertLayerCatalogMetadata(db, input) {
  ensureWritableMission(db, input.missionId)
  const timestamp = now()
  const transaction = db.transaction(() => {
    db.prepare(`INSERT INTO layer_catalog_entries (
      mission_id, node_id, parent_node_id, node_kind, alias, is_favorite, is_visible,
      display_order, metadata_json, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(mission_id, node_id) DO UPDATE SET
      parent_node_id = excluded.parent_node_id,
      node_kind = excluded.node_kind,
      alias = excluded.alias,
      is_favorite = excluded.is_favorite,
      is_visible = excluded.is_visible,
      display_order = excluded.display_order,
      metadata_json = excluded.metadata_json,
      updated_at = excluded.updated_at`)
    .run(
      input.missionId,
      input.nodeId,
      input.parentNodeId,
      input.nodeKind,
      input.alias ?? null,
      Number(input.isFavorite ?? false),
      Number(input.isVisible ?? true),
      input.displayOrder ?? 0,
      input.metadataJson ?? null,
      timestamp,
    )
    insertEvent(db, input.missionId, 'layer_catalog_metadata_updated', timestamp, {
      node_id: input.nodeId,
      parent_node_id: input.parentNodeId,
      node_kind: input.nodeKind,
      is_visible: Boolean(input.isVisible ?? true),
    })
  })
  transaction()
  const row = db.prepare(`SELECT mission_id, node_id, parent_node_id, node_kind, alias, is_favorite,
      is_visible, display_order, metadata_json, updated_at
      FROM layer_catalog_entries
      WHERE mission_id = ? AND node_id = ?`)
    .get(input.missionId, input.nodeId)
  return fromLayerCatalogRow(row)
}

function clearLayerCatalogMetadata(db, missionId) {
  ensureWritableMission(db, missionId)
  const transaction = db.transaction(() => {
    db.prepare('DELETE FROM layer_catalog_entries WHERE mission_id = ?').run(missionId)
    insertEvent(db, missionId, 'layer_catalog_repaired', now(), {
      action: 'reset_metadata',
      mission_id: missionId,
    })
  })
  transaction()
}

function fromLayerCatalogRow(row) {
  return {
    missionId: row.mission_id,
    nodeId: row.node_id,
    parentNodeId: row.parent_node_id,
    nodeKind: row.node_kind,
    alias: row.alias,
    isFavorite: Boolean(row.is_favorite),
    isVisible: Boolean(row.is_visible),
    displayOrder: row.display_order,
    metadataJson: row.metadata_json,
    updatedAt: row.updated_at,
  }
}

function getById(db, table, id, label) {
  const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id)
  if (row === undefined) {
    throw new Error(`${label} not found: ${id}`)
  }
  return row
}

/**
 * Deletes a row by id, mirroring the Rust reference: a no-op (returns false) when the
 * row is absent, otherwise enforcing the writable-mission guard so records on a
 * finished/finalized (locked) mission cannot be silently destroyed, and emitting the
 * matching `*_deleted` audit event inside the same transaction as the row removal.
 */
function deleteById(db, table, id) {
  const existing = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id)
  if (existing === undefined) {
    return false
  }
  ensureWritableMission(db, existing.mission_id)
  const audit = AUDIT_EVENT_TABLES[table]
  const transaction = db.transaction(() => {
    db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id)
    insertEvent(db, existing.mission_id, audit.deleted, now(), audit.deleteDetails(existing))
  })
  transaction()
  return true
}

function all(db, sql, ...params) {
  return db.prepare(sql).all(...params)
}

function ensureWritableMission(db, missionId) {
  const mission = getMission(db, missionId)
  if (mission.status === 'finalized'
    || (mission.status === 'finished'
      && readActiveMissionCorrectionAuthorization(db, missionId) === null)) {
    throw new Error(
      `Cannot write data to finished mission ${missionId}; resume the mission or unlock it first.`,
    )
  }
  if (mission.status === 'finished') assertMissionFinalizationNotInProgress(db, missionId)
}

/** Rejects finished-mission bookkeeping while its immutable archive is being sealed. */
function assertMissionFinalizationNotInProgress(db, missionId) {
  const pending = db.prepare(`SELECT 1 FROM mission_finalization_fences
    WHERE mission_id = ?`).get(missionId)
  if (pending !== undefined) {
    throw new Error(
      'Mission finalization is in progress; retry this change after finalization completes.',
    )
  }
}

/** Returns a safely parsed active journal identity for migration fence ownership. */
function readArchiveCustodyMigrationIdentity(db) {
  const row = db.prepare('SELECT value FROM metadata WHERE key = ?')
    .get(ACTIVE_ARCHIVE_CUSTODY_JOURNAL_KEY)
  if (row === undefined) return null
  try {
    const record = JSON.parse(row.value)
    if (record === null || typeof record !== 'object' || Array.isArray(record)
      || record.journalVersion !== 1
      || !['building', 'publish_prepared', 'staging_cleanup_planned', 'quarantine_planned']
        .includes(record.state)
      || !ARCHIVE_UUID_V4.test(record.operationId)
      || !ARCHIVE_UUID_V4.test(record.archiveId)
      || !ARCHIVE_UUID_V4.test(record.requestEventId)
      || typeof record.missionId !== 'string' || record.missionId.length < 1
      || !Number.isSafeInteger(record.requestEventRowid) || record.requestEventRowid < 1
      || typeof record.fenceRequestedAt !== 'string'
      || Number.isNaN(Date.parse(record.fenceRequestedAt))
      || !['finalized', 'direct', 'finalized_recovery'].includes(record.archiveKind)
      || record.finalRelativePath !== `${record.archiveId}.sararch`
      || (record.protectedFinalizationEpoch !== null
        && (!Number.isSafeInteger(record.protectedFinalizationEpoch)
          || record.protectedFinalizationEpoch < 1))) {
      return Object.freeze({ corrupt: true })
    }
    return Object.freeze({ corrupt: false, record })
  } catch {
    return Object.freeze({ corrupt: true })
  }
}

/** Returns whether request details identify the journalled SARARCH2 lifecycle. */
function isJournalArchiveRequest(details) {
  return details !== null && typeof details === 'object'
    && ARCHIVE_UUID_V4.test(details.archive_id)
    && ARCHIVE_UUID_V4.test(details.operation_id)
    && ['finalized', 'direct', 'finalized_recovery'].includes(details.archive_kind)
    && details.archive_relative_path === `${details.archive_id}.sararch`
    && Object.hasOwn(details, 'protected_finalization_epoch')
}

/** Returns whether one exact active journal record owns the request fence. */
function journalOwnsArchiveFence(identity, fence, details) {
  if (!journalOwnsArchiveFenceIdentity(identity, fence)) return false
  const record = identity.record
  return record.archiveId === details.archive_id
    && record.operationId === details.operation_id
    && record.archiveKind === details.archive_kind
    && record.finalRelativePath === details.archive_relative_path
    && record.protectedFinalizationEpoch === details.protected_finalization_epoch
}

/** Returns whether the active journal owns a fence before trusting event details. */
function journalOwnsArchiveFenceIdentity(identity, fence) {
  if (identity === null || identity.corrupt === true) return false
  const record = identity.record
  return record.missionId === fence.mission_id
    && record.fenceRequestedAt === fence.requested_at
    && record.requestEventId === fence.event_id
    && record.requestEventRowid === Number(fence.event_rowid)
}

/** Detects a corrupt or incomplete request row before recovery can settle its journal. */
function activeJournalRequestIntegrityIsInvalid(db) {
  const identity = readArchiveCustodyMigrationIdentity(db)
  if (identity === null) return false
  if (identity.corrupt === true) return true
  const record = identity.record
  const row = db.prepare(`SELECT fence.mission_id, fence.requested_at,
      event.rowid AS event_rowid, event.id AS event_id, event.details_json
    FROM mission_finalization_fences AS fence
    INNER JOIN mission_events AS event
      ON event.mission_id = fence.mission_id
      AND event.timestamp = fence.requested_at
    WHERE fence.mission_id = ? AND fence.requested_at = ?
      AND event.rowid = ? AND event.id = ?`).get(
    record.missionId,
    record.fenceRequestedAt,
    record.requestEventRowid,
    record.requestEventId,
  )
  if (row === undefined || !journalOwnsArchiveFenceIdentity(identity, row)) return true
  const details = readEventDetails(row.details_json)
  return !isJournalArchiveRequest(details) || !journalOwnsArchiveFence(identity, row, details)
}

/** Detects a journal-shaped fence that cannot be treated as a legacy interrupted ZIP. */
function hasUnsettledJournalArchiveFence(db) {
  const rows = db.prepare(`SELECT event.details_json
    FROM mission_finalization_fences AS fence
    INNER JOIN mission_events AS event
      ON event.mission_id = fence.mission_id
      AND event.event_type IN ('mission_archive_requested', 'mission_finalize_requested')
      AND event.timestamp = fence.requested_at`).all()
  return rows.some((row) => isJournalArchiveRequest(readEventDetails(row.details_json)))
}

/** Recovers a legacy direct-archive crash without weakening a journal-owned fence. */
function recoverInterruptedDirectArchiveFences(db, migrationTime) {
  const hasFence = db.prepare(`SELECT 1 FROM mission_finalization_fences
    LIMIT 1`).get()
  if (hasFence === undefined) return
  const activeIdentity = readArchiveCustodyMigrationIdentity(db)
  const interrupted = db.prepare(`SELECT fence.mission_id, fence.requested_at,
      event.rowid AS event_rowid, event.id AS event_id, event.details_json
    FROM mission_finalization_fences AS fence
    INNER JOIN mission_events AS event
      ON event.mission_id = fence.mission_id
      AND event.event_type = 'mission_archive_requested'
      AND event.timestamp = fence.requested_at`).all()
  let unresolvedJournalFence = false
  for (const fence of interrupted) {
    const requestedDetails = readEventDetails(fence.details_json)
    if (journalOwnsArchiveFenceIdentity(activeIdentity, fence)) {
      if (!isJournalArchiveRequest(requestedDetails)
        || !journalOwnsArchiveFence(activeIdentity, fence, requestedDetails)) {
        unresolvedJournalFence = true
      }
      continue
    }
    if (activeIdentity?.corrupt === true) {
      unresolvedJournalFence = true
      continue
    }
    if (isJournalArchiveRequest(requestedDetails)) {
      if (!journalOwnsArchiveFence(activeIdentity, fence, requestedDetails)) {
        unresolvedJournalFence = true
      }
      continue
    }
    insertEvent(db, fence.mission_id, 'mission_archive_failed', migrationTime, {
      resulting_status: getMission(db, fence.mission_id).status,
      archive_kind: requestedDetails.archive_kind ?? 'direct',
      ...(requestedDetails.finalization_epoch === undefined
        ? {}
        : { finalization_epoch: requestedDetails.finalization_epoch }),
      ...(requestedDetails.replaces_archive_path === undefined
        ? {}
        : { replaces_archive_path: requestedDetails.replaces_archive_path }),
      error: 'SAR Tracker restarted before the direct mission archive could be sealed; retry archive creation.',
    })
    db.prepare(`DELETE FROM mission_finalization_fences
      WHERE mission_id = ? AND requested_at = ?`).run(fence.mission_id, fence.requested_at)
  }
  if (unresolvedJournalFence || activeIdentity?.corrupt === true) {
    db.prepare(`INSERT INTO metadata (key, value) VALUES (
      'archive_custody_recovery_failure', 'ARCHIVE_CUSTODY_RECOVERY_REQUIRED'
    ) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run()
  }
}

/** Revalidates a finished-only write after any asynchronous prerequisite settles. */
function assertFinishedMissionBookkeepingAllowed(db, missionId) {
  const mission = getMission(db, missionId)
  if (mission.status !== 'finished') {
    throw new Error('Finished-mission bookkeeping is unavailable after finalization.')
  }
  assertMissionFinalizationNotInProgress(db, missionId)
}

function validateLatLon(lat, lon, label) {
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    throw new Error(`${label} latitude must be a finite value between -90 and 90.`)
  }
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
    throw new Error(`${label} longitude must be a finite value between -180 and 180.`)
  }
}

function appendEvent(db, missionId, eventType, detailsJson, timestamp = now()) {
  return insertEvent(db, missionId, eventType, timestamp, detailsJson)
}

function insertEvent(db, missionId, eventType, timestamp, detailsJson, recordedAt = now()) {
  return insertEventWithId(db, randomUUID(), missionId, eventType, timestamp, detailsJson, recordedAt)
}

function insertEventWithId(db, eventId, missionId, eventType, timestamp, detailsJson, recordedAt = now()) {
  db.prepare(`INSERT INTO mission_events (
    id, mission_id, event_type, timestamp, details_json, recorded_at, recording_completeness
  ) VALUES (?, ?, ?, ?, ?, ?, 'complete')`)
    .run(
      eventId,
      missionId,
      eventType,
      timestamp,
      detailsJson === undefined || detailsJson === null ? null : JSON.stringify(detailsJson),
      recordedAt,
    )
  bumpMissionReplayGeneration(db, missionId)
  return eventId
}

/** Derives one stable UUID-shaped lifecycle event identity from an archive identity. */
function deriveArchiveLifecycleEventId(archiveId, kind) {
  const digest = createHash('sha256')
    .update(`sartracker-archive-lifecycle:${kind}:${archiveId}`, 'utf8')
    .digest('hex')
  const bytes = digest.slice(0, 32).split('')
  bytes[12] = '4'
  bytes[16] = ['8', '9', 'a', 'b'][Number.parseInt(bytes[16], 16) % 4]
  return `${bytes.slice(0, 8).join('')}-${bytes.slice(8, 12).join('')}-${bytes.slice(12, 16).join('')}-${bytes.slice(16, 20).join('')}-${bytes.slice(20).join('')}`
}

function now() {
  return new Date().toISOString()
}

/** Invalidates open replay track cursors after evidence becomes newly queryable. */
function bumpMissionReplayGeneration(db, missionId) {
  db.prepare(`INSERT INTO mission_replay_generations (mission_id, generation)
    VALUES (?, 1)
    ON CONFLICT(mission_id) DO UPDATE SET generation = generation + 1`)
    .run(missionId)
}

/** Creates the stable cancellation error surfaced by renderer-owned coverage reads. */
function createCoverageRequestAbortError() {
  const error = new Error('Coverage tile request was cancelled.')
  error.name = 'AbortError'
  return error
}

module.exports = {
  CURRENT_SCHEMA_VERSION,
  createElectronMissionStore,
  migrateMissionStoreForArchiveReview,
  finishGpxImportBatch,
  recordGpxImportFailure,
  recordGpxImportSourceReceipt,
  retainGpxImportSourceBytes,
  settleGpxImportSourceReceipt,
  startGpxImportBatch,
  backfillLegacyGpxRevisions,
  upsertGpxEvidence,
  upsertGpxEvidenceChunked,
}
