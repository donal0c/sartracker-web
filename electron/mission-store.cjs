const fs = require('node:fs/promises')
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
const { runSqliteBackupInWorker } = require('./sqlite-backup-runner.cjs')
const { runGpxEvidenceImportInWorker } = require('./gpx-evidence-import-runner.cjs')
const {
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

const { createZipArchive, readZipArchive } = require('./zip-archive.cjs')
const { createOutingStore } = require('./outing-store.cjs')
const {
  backfillLegacyMissionObjectVersions,
  createMissionEvidenceVersionStore,
} = require('./mission-evidence-version-store.cjs')
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

const CURRENT_SCHEMA_VERSION = 12
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
const MAX_SEARCH_OPERATION_TIMESTAMP_LENGTH = 64
const MAX_SEARCH_AREA_GEOMETRY_LENGTH = 512 * 1_024
const MAX_SEARCH_ADVISORY_COVERAGE_LENGTH = 512 * 1_024

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
  const storageDiagnostics = options.storageDiagnostics ?? null
  const coverageLedgerFaultInjection = options.coverageLedgerFaultInjection ?? {}
  const gpxRetirementFaultInjection = options.gpxRetirementFaultInjection ?? {}
  const breadcrumbQueryRunner =
    options.runBreadcrumbQueryInWorker ?? runBreadcrumbQueryInWorker
  const breadcrumbDotQueryRunner =
    options.runBreadcrumbDotQueryInWorker ?? runBreadcrumbDotQueryInWorker
  const missionReviewReadQueryRunner =
    options.runMissionReviewReadQueryInWorker ?? runMissionReviewReadQueryInWorker
  const missionReplayRunner = options.runMissionReplayInWorker ?? runMissionReplayInWorker
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
  const coverageManifestBuildEvidenceByMission = new Map()
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
  const migrationState = migrate(db)
  let legacyGpxBackfillTimer = null
  let legacyGpxBackfillFailure = null
  let storeClosed = false
  const scheduleLegacyGpxBackfill = () => {
    if (storeClosed || migrationState.legacyGpxBackfillRemaining === 0
      || legacyGpxBackfillTimer !== null || legacyGpxBackfillFailure !== null) return
    legacyGpxBackfillTimer = setTimeout(() => {
      legacyGpxBackfillTimer = null
      if (storeClosed) return
      try {
        const result = backfillLegacyGpxRevisions(db, now(), 1)
        migrationState.legacyGpxBackfillRemaining = result.remaining
        scheduleLegacyGpxBackfill()
      } catch (error) {
        legacyGpxBackfillFailure = safeEvidenceFailureReason(error?.message ?? error)
        console.error(`Legacy GPX evidence migration stopped safely: ${legacyGpxBackfillFailure}`)
      }
    }, 10)
  }
  scheduleLegacyGpxBackfill()
  const evidenceVersionStore = createMissionEvidenceVersionStore({
    db,
    faultInjection: options.evidenceVersionFaultInjection ?? {},
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
  let finalizeTail = Promise.resolve()
  const enqueueFinalize = (missionId) => {
    const acknowledgedLossToken = readAcknowledgedEvidenceLossToken(db, missionId)
    const run = finalizeTail.then(() =>
      ingestAnomalyOutbox.runWithHealthyEvidenceFence(
        missionId,
        'finalization',
        () => finalizeMission(
          db,
          missionId,
          backupCoordinator,
          archiveDirectory,
          finalizeMissionFaultInjection,
          archiveFaultInjection,
        ),
        acknowledgedLossToken === null ? {} : { acknowledgedLossToken },
      ))
    finalizeTail = run.catch(() => {})
    return run
  }
  const enqueueArchive = (missionId) => {
    const run = finalizeTail.then(() => {
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
    finalizeTail = run.catch(() => {})
    return run
  }

  return {
    prepareClose: async () => {
      const active = [...activeGpxEvidenceImports]
      for (const entry of active) entry.controller.abort()
      if (active.length === 0) return
      let timeout
      try {
        await Promise.race([
          Promise.all(active.map((entry) => entry.quiesced)),
          new Promise((_, reject) => {
            timeout = setTimeout(() => reject(new Error(
              'A GPX evidence import worker did not exit within the safe shutdown deadline. The mission store remains open and the exit is not marked clean.',
            )), gpxShutdownJoinTimeoutMs)
          }),
        ])
      } finally {
        clearTimeout(timeout)
      }
    },
    close: () => {
      if (activeGpxEvidenceImports.size > 0) {
        throw new Error('Cannot close the mission store while GPX evidence imports are active; call prepareClose first.')
      }
      storeClosed = true
      if (legacyGpxBackfillTimer !== null) {
        clearTimeout(legacyGpxBackfillTimer)
        legacyGpxBackfillTimer = null
      }
      ingestAnomalyOutbox.dispose()
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
    createMission: async (input) => {
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
    listOutings: async (missionId) => outingStore.listOutings(missionId),
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
    upsertDevice: async (input) => upsertDevice(db, input),
    upsertDevicesBulk: async (input) => {
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
    listDevices: async (missionId) => all(db, 'SELECT * FROM devices WHERE mission_id = ? ORDER BY name ASC', missionId),
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
      const query = enqueueMissionReviewRead({
        query: input,
        signal: controller.signal,
      })
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
    readMissionReplay: async (input, requestId) => executeMissionReplayRead(
      input,
      requestId,
      'state',
    ),
    readMissionReplayTrackChunk: async (input, requestId) => executeMissionReplayRead(
      input,
      requestId,
      'chunk',
    ),
    readMissionReplayObjectChunk: async (input, requestId) => executeMissionReplayRead(
      input,
      requestId,
      'objects',
    ),
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
      input,
      markerDefaults,
    ),
    getMarker: async (markerId) => getById(db, 'markers', markerId, 'Marker'),
    listMarkers: async (missionId) =>
      all(db, 'SELECT * FROM markers WHERE mission_id = ? AND retired_at IS NULL ORDER BY display_order ASC, name ASC', missionId),
    deleteMarker: async (markerId) => retireVersionedById(
      db,
      evidenceVersionStore,
      'markers',
      'marker',
      markerId,
    ),
    upsertDrawing: async (input) => upsertDrawingEvidence(db, evidenceVersionStore, input),
    getDrawing: async (drawingId) => getById(db, 'drawings', drawingId, 'Drawing'),
    listDrawings: async (missionId) =>
      all(db, 'SELECT * FROM drawings WHERE mission_id = ? AND retired_at IS NULL ORDER BY display_order ASC, name ASC', missionId),
    deleteDrawing: async (drawingId) => retireDrawingEvidence(db, evidenceVersionStore, drawingId),
    upsertHelicopter: async (input) => upsertHelicopter(db, input),
    listHelicopters: async (missionId) =>
      all(db, 'SELECT * FROM helicopters WHERE mission_id = ? ORDER BY slot_key ASC', missionId),
    deleteHelicopter: async (helicopterId) => deleteById(db, 'helicopters', helicopterId),
    upsertGpxImport: async (input) => projectGpxImportForRenderer(upsertGpxEvidence(db, input)),
    listGpxImports: async (missionId) =>
      all(db, `SELECT * FROM gpx_track_imports
        WHERE mission_id = ? AND retired_at IS NULL AND import_state = 'complete'
        ORDER BY display_name ASC, imported_at ASC`, missionId),
    deleteGpxImport: async (importId) => retireGpxEvidence(
      db,
      importId,
      gpxRetirementFaultInjection,
    ),
    listGpxImportRevisions: async (importId) => all(
      db,
      `SELECT * FROM gpx_import_revisions
        WHERE import_id = ? ORDER BY revision_sequence ASC`,
      importId,
    ),
    listGpxImportPage: async (input) => listGpxImportProjectionPage(db, input),
    listGpxImportRevisionPage: async (input) =>
      listGpxImportRevisionProjectionPage(db, input),
    listGpxImportIssues: async (input) => listGpxImportIssues(db, input),
    updateGpxImportPresentation: async (input) => updateGpxImportPresentation(db, input),
    assignGpxImportToOuting: async (input) =>
      projectGpxImportForRenderer(assignGpxEvidenceToOuting(db, input)),
    importGpxEvidencePaths: async (input) => {
      ensureWritableMission(db, input.missionId)
      if (
        !Array.isArray(input.paths) || input.paths.length < 1 || input.paths.length > 100 ||
        input.paths.some((entry) => typeof entry !== 'string' || entry.length < 1 || entry.length > 4_096)
      ) {
        throw new Error('GPX import paths are invalid.')
      }
      const batchId = randomUUID()
      startGpxImportBatch(db, {
        batchId,
        missionId: input.missionId,
        totalFiles: input.paths.length,
        paths: input.paths,
      })
      const controller = new AbortController()
      const result = enqueueGpxEvidenceImport({
        databasePath,
        missionId: input.missionId,
        paths: input.paths,
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
      return all(
        db,
        `SELECT * FROM search_areas WHERE mission_id = ? AND retired_at IS NULL
          ORDER BY name ASC, id ASC`,
        normalizedMissionId,
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
      return all(
        db,
        `SELECT * FROM search_assignments WHERE mission_id = ? AND retired_at IS NULL
          ORDER BY created_at ASC, id ASC`,
        normalizedMissionId,
      )
    },
    upsertSearchPass: async (input) => upsertSearchPass(db, evidenceVersionStore, input),
    listSearchPasses: async (missionId) => listSearchPassRecords(
      db,
      normalizeBoundedRequiredText(
        missionId, 'Search pass mission', MAX_SEARCH_OPERATION_ID_LENGTH,
      ),
    ),
    listMissionObjectVersions: async (input) => evidenceVersionStore.listVersions(input),
    listLayerCatalogMetadata: async (missionId) => listLayerCatalogMetadata(db, missionId),
    upsertLayerCatalogMetadata: async (input) => upsertLayerCatalogMetadata(db, input),
    clearLayerCatalogMetadata: async (missionId) => clearLayerCatalogMetadata(db, missionId),
    getMission: async (missionId) => getMission(db, missionId),
    listMissions: async () => all(db, 'SELECT * FROM missions ORDER BY start_time DESC'),
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
    pauseMission: async (missionId) => transitionMission(db, missionId, 'active', 'paused'),
    resumeMission: async (missionId) => transitionMission(db, missionId, 'paused', 'active'),
    finishMission: async (missionId) => finishMission(db, missionId),
    finalizeMission: async (missionId) => enqueueFinalize(missionId),
    unlockFinalizedMission: async (input) => unlockFinalizedMission(db, input, options.readAdminRoster),
  }

  /**
   * Caps Mission Review at one physical worker and waits for obsolete worker
   * exit separately from the renderer-facing cancellation promise.
   */
  function enqueueMissionReviewRead(input) {
    const previousWorker = missionReviewWorkerTail
    let releaseWorkerSlot = () => undefined
    const workerSlot = new Promise((resolve) => {
      releaseWorkerSlot = resolve
    })
    missionReviewWorkerTail = previousWorker.then(() => workerSlot)
    return previousWorker.then(() => {
      let operation
      try {
        operation = missionReviewReadQueryRunner({
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

  async function executeMissionReplayRead(input, requestId, kind) {
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
    try {
      return await query
    } finally {
      if (missionReplayQueryControllersByRequestId.get(normalizedRequestId) === activeQuery) {
        missionReplayQueryControllersByRequestId.delete(normalizedRequestId)
      }
    }
  }

  function enqueueMissionReplayRead(input) {
    const previousWorker = missionReplayWorkerTail
    let releaseWorkerSlot = () => undefined
    const workerSlot = new Promise((resolve) => { releaseWorkerSlot = resolve })
    missionReplayWorkerTail = previousWorker.then(() => workerSlot)
    return previousWorker.then(() => {
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
        throw error
      }
      const workerExited = operation.workerExited ?? operation
      void Promise.resolve(workerExited).then(releaseWorkerSlot, releaseWorkerSlot)
      return operation
    })
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

function migrate(db) {
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
    CREATE INDEX IF NOT EXISTS idx_mission_events_replay
      ON mission_events(mission_id, timestamp, event_type, id);
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
    db.exec(`
      UPDATE mission_group_membership_events
      SET sequence = COALESCE(sequence, rowid),
          recorded_at = COALESCE(recorded_at, '${migrationTime}'),
          recording_completeness = COALESCE(recording_completeness, 'legacy_baseline')
      WHERE sequence IS NULL OR recorded_at IS NULL OR recording_completeness IS NULL;
      UPDATE mission_events
      SET recorded_at = COALESCE(recorded_at, '${migrationTime}'),
          recording_completeness = COALESCE(recording_completeness, 'legacy_baseline')
      WHERE recorded_at IS NULL OR recording_completeness IS NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_group_membership_sequence
      ON mission_group_membership_events(sequence);
    `)
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
    backfillLegacyMissionObjectVersions(db, migrationTime)
    recoverUnsettledGpxImportReceipts(db, migrationTime)
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
        CREATE TABLE IF NOT EXISTS mission_replay_position_day_counts (
          mission_id TEXT NOT NULL,
          device_id TEXT NOT NULL,
          known_day TEXT NOT NULL,
          position_count INTEGER NOT NULL CHECK(position_count >= 0),
          PRIMARY KEY (mission_id, device_id, known_day),
          FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE
        );
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
      SET status = 'interrupted', updated_at = ?, finished_at = ? WHERE status = 'running'`)
      .run(migrationTime, migrationTime)

    db.prepare("INSERT INTO metadata (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(String(CURRENT_SCHEMA_VERSION))
  })
  applyMigrations()
  const legacyGpxBackfill = backfillLegacyGpxRevisions(db, migrationTime, 3)
  return { legacyGpxBackfillRemaining: legacyGpxBackfill.remaining }
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

/** Converts every pre-read or retained-but-unpublished receipt into explicit failure evidence. */
function recoverUnsettledGpxImportReceipts(db, migrationTime) {
  const receipts = db.prepare(`SELECT * FROM gpx_import_source_receipts
    WHERE status IN ('pending', 'retained')
    ORDER BY mission_id, batch_id, source_path`).all()
  const batchIds = new Set(db.prepare(`SELECT id FROM gpx_import_batches
    WHERE status = 'running'`).all().map((batch) => batch.id))
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
    const status = interruptedBatchIds.has(batchId) || !fullyAccounted
      ? 'interrupted'
      : failed === 0 ? 'completed' : 'completed_with_failures'
    db.prepare(`UPDATE gpx_import_batches
      SET status = ?, completed_files = ?, failed_files = ?,
          updated_at = ?, finished_at = ?
      WHERE id = ?`).run(status, completed, failed, migrationTime, migrationTime, batchId)
  }
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
  return mission
}

function getActiveMission(db) {
  return db.prepare("SELECT * FROM missions WHERE status IN ('active', 'paused') ORDER BY start_time DESC LIMIT 1").get() ?? null
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
) {
  const mission = getMission(db, missionId)
  if (mission.status !== 'finished' && mission.status !== 'finalized') {
    throw new Error('Only finished or finalized missions can be archived.')
  }
  if (recordArchiveEvent) assertMissionFinalizationNotInProgress(db, missionId)

  const createdAt = now()
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

  for (const attachmentPath of listMarkerAttachmentPaths(db, missionId)) {
    let attachmentBytes
    try {
      attachmentBytes = await fs.readFile(attachmentPath)
    } catch {
      throw new Error(
        `Mission archive cannot be created because marker attachment is missing: ${attachmentPath}`,
      )
    }
    entries.push({ name: `attachments/${path.basename(attachmentPath)}`, data: attachmentBytes })
  }

  await fs.mkdir(archiveDirectory, { recursive: true })
  await validateSqliteSnapshotBuffer(
    archiveSnapshotBytes,
    'Mission archive embedded SQLite snapshot',
    archiveDirectory,
  )
  const archiveBuffer = createZipArchive(entries)

  const archiveName = `${missionId}-${createdAt.replace(/:/g, '-')}.zip`
  const temporaryPath = path.join(archiveDirectory, `${archiveName}.tmp`)
  const finalPath = path.join(archiveDirectory, archiveName)

  await fs.writeFile(temporaryPath, archiveBuffer)
  try {
    validateArchiveFile(archiveBuffer, missionId)
  } catch (error) {
    await fs.rm(temporaryPath, { force: true })
    throw error
  }
  await fs.rename(temporaryPath, finalPath)

  if (recordArchiveEvent) {
    try {
      db.transaction(() => {
        const currentMission = getMission(db, missionId)
        if (currentMission.status !== mission.status) {
          throw new Error('Mission state changed while the archive was being created; retry archive creation.')
        }
        assertMissionFinalizationNotInProgress(db, missionId)
        appendEvent(db, missionId, 'mission_archived', { archive_path: finalPath }, createdAt)
      })()
    } catch (error) {
      await fs.rm(finalPath, { force: true })
      throw error
    }
  }

  return { mission_id: missionId, archive_path: finalPath, created_at: createdAt }
}

async function validateSqliteSnapshotBuffer(snapshotBytes, label, workingDirectory) {
  const temporaryPath = path.join(workingDirectory, `.sqlite-integrity-${randomUUID()}.sqlite`)
  try {
    await fs.writeFile(temporaryPath, snapshotBytes)
    validateSqliteDatabaseFile(temporaryPath, label)
  } finally {
    await removeSqliteFileSet(temporaryPath)
  }
}

function listMarkerAttachmentPaths(db, missionId) {
  return all(
    db,
    `SELECT attachment_path FROM markers
      WHERE mission_id = ? AND attachment_path IS NOT NULL AND TRIM(attachment_path) != ''
      ORDER BY display_order ASC, created_at ASC`,
    missionId,
  ).map((row) => row.attachment_path)
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
}

async function finalizeMission(
  db,
  missionId,
  backupCoordinator,
  archiveDirectory,
  finalizeMissionFaultInjection = {},
  archiveFaultInjection = {},
) {
  const mission = getMission(db, missionId)
  if (mission.status === 'finalized') {
    const existingArchive = await readRecoverableFinalizeArchive(db, missionId)
    if (existingArchive !== null) {
      return { mission, archive: existingArchive }
    }
    throw new Error('Finalized mission is missing a recoverable archive record.')
  }
  if (mission.status !== 'finished') {
    throw new Error('Only finished missions can be finalized.')
  }
  const resumedProtectedFinalization = db.transaction(() => {
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
    ? await readRecoverableFinalizeArchive(db, missionId)
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

async function readRecoverableFinalizeArchive(db, missionId) {
  const latestUnlock = db.prepare(
    `SELECT rowid AS event_rowid, timestamp FROM mission_events
      WHERE mission_id = ? AND event_type = ?
      ORDER BY timestamp DESC, rowid DESC
      LIMIT 1`,
  ).get(missionId, 'mission_unlocked')

  const rows = db.prepare(
    `SELECT rowid AS event_rowid, timestamp, details_json FROM mission_events
      WHERE mission_id = ? AND event_type = ?
      ORDER BY timestamp DESC, rowid DESC`,
  ).all(missionId, 'mission_archive_succeeded')

  for (const row of rows) {
    if (latestUnlock !== undefined && !isEventAfter(row, latestUnlock)) {
      continue
    }
    const details = readEventDetails(row.details_json)
    const archivePath = typeof details.archive_path === 'string' ? details.archive_path : ''
    if (archivePath === '') {
      continue
    }

    try {
      await fs.access(archivePath)
    } catch {
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

async function unlockFinalizedMission(db, input, readAdminRoster) {
  const mission = getMission(db, input.mission_id)
  if (mission.status !== 'finalized') {
    throw new Error('Only finalized missions can be unlocked.')
  }
  const finalizedEpoch = readLatestMissionFinalizedEpoch(db, input.mission_id)
  const adminRoster = typeof readAdminRoster === 'function' ? await readAdminRoster() : []
  if (!adminRoster.map((value) => value.trim()).includes(input.admin_name.trim())) {
    const deniedTransaction = db.transaction(() => {
      assertMissionUnlockEpoch(db, input.mission_id, finalizedEpoch)
      insertEvent(db, input.mission_id, 'mission_unlock_denied', now(), {
        admin_name: input.admin_name,
        reason: input.reason,
        resulting_status: 'finalized',
      })
    })
    deniedTransaction.immediate()
    throw new Error('Selected admin is not authorized to unlock finalized missions.')
  }
  const timestamp = now()
  const transaction = db.transaction(() => {
    assertMissionUnlockEpoch(db, input.mission_id, finalizedEpoch)
    db.prepare('UPDATE missions SET status = ? WHERE id = ?').run('finished', input.mission_id)
    insertEvent(db, input.mission_id, 'mission_unlocked', timestamp, {
      admin_name: input.admin_name,
      reason: input.reason,
      resulting_status: 'finished',
    })
  })
  transaction()
  return getMission(db, input.mission_id)
}

/** Reads the immutable audit identity of the currently finalized mission epoch. */
function readLatestMissionFinalizedEpoch(db, missionId) {
  return db.prepare(`SELECT rowid FROM mission_events
    WHERE mission_id = ? AND event_type = 'mission_finalized'
    ORDER BY rowid DESC LIMIT 1`).get(missionId)?.rowid ?? null
}

/** Prevents an authorization decision from being applied to a newer finalization epoch. */
function assertMissionUnlockEpoch(db, missionId, expectedEpoch) {
  if (
    getMission(db, missionId).status !== 'finalized' ||
    readLatestMissionFinalizedEpoch(db, missionId) !== expectedEpoch
  ) {
    throw new Error('Mission finalization changed while admin authorization was checked. Review and retry the unlock.')
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
    : input
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

/** Baselines a hard-bounded pre-v12 GPX slice without inventing source time or byte provenance. */
function backfillLegacyGpxRevisions(db, migrationTime, maximumImports) {
  const readLegacyPage = db.prepare(`SELECT
      source.id, source.mission_id, source.content_sha256, source.source_bytes_base64,
      source.source_path, source.file_name, source.display_name, source.geometry_json,
      source.metadata_json
    FROM gpx_track_imports AS source
    WHERE NOT EXISTS (
      SELECT 1 FROM gpx_import_revisions AS revision WHERE revision.import_id = source.id
    )
    ORDER BY source.mission_id ASC, source.id ASC LIMIT ?`)
  const insertRevision = db.prepare(`INSERT INTO gpx_import_revisions (
    id, mission_id, import_id, revision_sequence, content_sha256,
    source_bytes_base64, source_path, file_name, display_name, geometry_json,
      metadata_json, timing_class, completeness, recorded_at, audit_event_id
  ) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, 'undated', 'legacy_baseline', ?, NULL)`)
  const updateProjectionGeometry = db.prepare(`UPDATE gpx_track_imports
    SET geometry_json = ? WHERE id = ?`)
  const insertPoint = db.prepare(`INSERT INTO gpx_evidence_points (
    import_id, revision_sequence, segment_index, point_index, track_name,
    lat, lon, elevation, source_time
  ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, NULL)`)
  const insertRejection = db.prepare(`INSERT INTO gpx_evidence_rejections (
    id, import_id, revision_sequence, kind, segment_index, point_index, reason, source_value
  ) VALUES (?, ?, 1, ?, ?, ?, ?, ?)`)
  const legacyImports = readLegacyPage.all(maximumImports)
  for (const entry of legacyImports) {
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
    })
    migrateOne.immediate()
  }
  const remaining = Number(db.prepare(`SELECT COUNT(*) AS count
    FROM gpx_track_imports AS source WHERE NOT EXISTS (
      SELECT 1 FROM gpx_import_revisions AS revision WHERE revision.import_id = source.id
    )`).get().count)
  return { processed: legacyImports.length, remaining }
}

const MAX_INLINE_LEGACY_GPX_GEOMETRY_BYTES = 128 * 1024

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

function normalizeSearchAreaGeometryJson(value) {
  const normalized = normalizeBoundedRequiredText(
    value, 'Search area geometry', MAX_SEARCH_AREA_GEOMETRY_LENGTH,
  )
  let parsed
  try {
    parsed = JSON.parse(normalized)
  } catch {
    throw new Error('Search area geometry must be valid Polygon JSON text.')
  }
  if (
    typeof parsed !== 'object'
    || parsed === null
    || Array.isArray(parsed)
    || parsed.type !== 'Polygon'
    || !Array.isArray(parsed.coordinates)
  ) {
    throw new Error('Search area geometry must be valid Polygon JSON text.')
  }
  return normalized
}

function normalizeOptionalStrictSearchTimestamp(value, label) {
  if (value === undefined || value === null) return undefined
  return normalizeStrictSearchTimestamp(value, label)
}

function normalizeRequiredText(value, label) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} is required.`)
  return value.trim()
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
  db.prepare(`INSERT INTO gpx_import_failures (
    id, batch_id, mission_id, source_path, file_name, content_sha256,
    source_bytes_base64, reason, recorded_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      randomUUID(), input.batchId, input.missionId, input.sourcePath,
      input.fileName, input.contentSha256, input.sourceBytesBase64,
      safeEvidenceFailureReason(input.reason), timestamp,
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
    (SELECT COUNT(*) FROM gpx_track_imports AS imports
      WHERE imports.mission_id = ? AND NOT EXISTS (
        SELECT 1 FROM gpx_import_revisions AS revisions WHERE revisions.import_id = imports.id
      )) AS pending_legacy_backfills`)
    .get(missionId, missionId, missionId, missionId, missionId)
  const count = Number(state.running_batches) + Number(state.unsettled_receipts)
    + Number(state.staging_revisions) + Number(state.staging_imports)
    + Number(state.pending_legacy_backfills)
  if (count > 0) {
    throw new Error(
      `Mission cannot change lifecycle state while GPX evidence import state is unsettled (${count} durable item(s), including any legacy GPX backfill still pending). Wait for the import to settle or restart SAR Tracker to recover it explicitly.`,
    )
  }
}

/** Returns one byte-bounded issue page without absolute paths or retained source bytes. */
function listGpxImportIssues(db, input) {
  const missionId = normalizeRequiredText(input?.missionId, 'GPX issue mission')
  getMission(db, missionId)
  const limit = input?.limit ?? 50
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new Error('GPX import issue page limit must be between 1 and 100.')
  }
  const cursor = decodeGpxImportIssueCursor(input?.cursor)
  const rows = db.prepare(`WITH issues AS (
      SELECT 'failure:' || failures.id AS entry_id,
        failures.batch_id, batches.status AS batch_status,
        failures.source_path, failures.file_name, failures.content_sha256,
        CASE WHEN failures.source_bytes_base64 IS NULL THEN 0 ELSE 1 END AS source_retained,
        failures.reason, failures.recorded_at
      FROM gpx_import_failures AS failures
      JOIN gpx_import_batches AS batches ON batches.id = failures.batch_id
      WHERE failures.mission_id = ?
      UNION ALL
      SELECT 'batch:' || batches.id AS entry_id,
        batches.id AS batch_id, batches.status AS batch_status,
        NULL AS source_path, 'Selected GPX batch' AS file_name, NULL AS content_sha256, 0 AS source_retained,
        'GPX import batch was interrupted before batch completion was durably confirmed; review retained imports and per-file evidence.' AS reason,
        batches.updated_at AS recorded_at
      FROM gpx_import_batches AS batches
      WHERE batches.mission_id = ? AND batches.status = 'interrupted'
        AND NOT EXISTS (SELECT 1 FROM gpx_import_failures WHERE batch_id = batches.id)
    )
    SELECT * FROM issues
    WHERE (? IS NULL OR recorded_at < ? OR (recorded_at = ? AND entry_id < ?))
    ORDER BY recorded_at DESC, entry_id DESC
    LIMIT ?`).all(
      missionId,
      missionId,
      cursor?.recordedAt ?? null,
      cursor?.recordedAt ?? null,
      cursor?.recordedAt ?? null,
      cursor?.entryId ?? null,
      limit + 1,
    )
  const entries = rows.slice(0, limit).map((row) => ({
    id: row.entry_id,
    batch_id: row.batch_id,
    batch_status: row.batch_status,
    file_name: row.file_name,
    content_sha256: row.content_sha256,
    source_retained: Boolean(row.source_retained),
    reason: redactGpxImportIssueReason(row.reason, row.source_path, row.file_name),
    recorded_at: row.recorded_at,
  }))
  const last = entries.at(-1)
  return {
    entries,
    nextCursor: rows.length > limit && last !== undefined
      ? Buffer.from(JSON.stringify({ recordedAt: last.recorded_at, entryId: last.id }), 'utf8')
        .toString('base64url')
      : null,
  }
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
      !Number.isFinite(Date.parse(decoded.recordedAt)) ||
      typeof decoded?.entryId !== 'string' ||
      !/^(failure|batch):[A-Za-z0-9-]+$/u.test(decoded.entryId)
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
        id, mission_id, import_id, revision_sequence, content_sha256,
        source_bytes_base64, source_path, file_name, display_name, geometry_json,
        metadata_json, timing_class, outing_id, import_state, completeness, recorded_at, audit_event_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'complete', ?, ?, ?)`)
        .run(
          randomUUID(), missionId, id, revisionSequence, row.content_sha256,
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
  const revision = db.prepare(`SELECT geometry_json, timing_class, outing_id
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
    ORDER BY segment_index, point_index`).all(current.id, current.revision_sequence)
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
    .all(current.id, current.revision_sequence)
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
  return new Promise((resolve) => setTimeout(resolve, 1))
}

/** Persists large GPX point sets in short writer slices, publishing only after a final fence. */
async function upsertGpxEvidenceChunked(db, input, chunkSize = 25, publicationReceipt = null) {
  if ((input.points?.length ?? 0) <= chunkSize && (input.rejections?.length ?? 0) <= chunkSize) {
    return upsertGpxEvidence(db, input, publicationReceipt)
  }
  const missionId = input.mission_id
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
      id, mission_id, import_id, revision_sequence, content_sha256,
      source_bytes_base64, source_path, file_name, display_name, geometry_json,
      metadata_json, timing_class, outing_id, import_state, completeness,
      recorded_at, audit_event_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'staging', ?, ?, NULL)`)
      .run(
        randomUUID(), missionId, id, revisionSequence, row.content_sha256,
        row.source_bytes_base64, input.source_path, row.file_name, row.display_name,
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
          sourceBytesBase64: row.source_bytes_base64,
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
  const importId = normalizeRequiredText(input?.id, 'GPX import')
  const missionId = normalizeRequiredText(input?.mission_id, 'GPX import mission')
  const displayName = input?.display_name === undefined
    ? undefined
    : normalizeBoundedRequiredText(input.display_name, 'GPX display name', 500)
  if (
    input?.metadata_json !== undefined && input.metadata_json !== null &&
    (typeof input?.metadata_json !== 'string' || input.metadata_json.length > 100_000)
  ) {
    throw new Error('GPX import presentation metadata must be bounded JSON text.')
  }
  if (input.metadata_json !== undefined && input.metadata_json !== null) {
    try {
      JSON.parse(input.metadata_json)
    } catch {
      throw new Error('GPX import presentation metadata must be valid JSON text.')
    }
  }
  const timestamp = now()
  const transaction = db.transaction(() => {
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
        input.metadata_json === undefined ? existing.metadata_json : input.metadata_json,
        timestamp,
        importId,
      )
    insertEvent(db, missionId, 'gpx_import_presentation_updated', timestamp, {
      gpx_import_id: importId,
      fields: [
        ...(displayName === undefined ? [] : ['display_name']),
        ...(input.metadata_json === undefined ? [] : ['metadata_json']),
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

/** Assigns retained GPX evidence to an outing as a new immutable revision. */
function assignGpxEvidenceToOuting(db, input) {
  const importId = normalizeRequiredText(input.import_id, 'GPX import')
  const outingId = normalizeRequiredText(input.outing_id, 'GPX outing')
  const existing = db.prepare('SELECT * FROM gpx_track_imports WHERE id = ?').get(importId)
  if (existing === undefined || existing.retired_at !== null) {
    throw new Error(`Active GPX evidence ${importId} was not found.`)
  }
  const outing = db.prepare('SELECT * FROM outings WHERE id = ?').get(outingId)
  if (outing?.mission_id !== existing.mission_id) {
    throw new Error('GPX evidence outing is not in the same mission.')
  }
  if (existing.outing_id === outingId) return existing
  const timestamp = now()
  const previousSequence = Number(existing.revision_sequence)
  const nextSequence = previousSequence + 1
  const transaction = db.transaction(() => {
    ensureWritableMission(db, existing.mission_id)
    const auditEventId = insertEvent(db, existing.mission_id, 'gpx_import_outing_assigned', timestamp, {
      gpx_import_id: importId,
      outing_id: outingId,
      assigned_by: normalizeOptionalTextValue(input.assigned_by),
      revision_sequence: nextSequence,
    })
    db.prepare(`UPDATE gpx_track_imports
      SET outing_id = ?, revision_sequence = ?, updated_at = ? WHERE id = ?`)
      .run(outingId, nextSequence, timestamp, importId)
    db.prepare(`INSERT INTO gpx_import_revisions (
      id, mission_id, import_id, revision_sequence, content_sha256,
      source_bytes_base64, source_path, file_name, display_name, geometry_json,
      metadata_json, timing_class, outing_id, completeness, recorded_at, audit_event_id
    ) SELECT ?, mission_id, import_id, ?, content_sha256, source_bytes_base64,
      source_path, file_name, display_name, geometry_json, metadata_json, timing_class,
      ?, completeness, ?, ?
    FROM gpx_import_revisions WHERE import_id = ? AND revision_sequence = ?`)
      .run(randomUUID(), nextSequence, outingId, timestamp, auditEventId, importId, previousSequence)
    db.prepare(`INSERT INTO gpx_evidence_points (
      import_id, revision_sequence, segment_index, point_index, track_name,
      lat, lon, elevation, source_time
    ) SELECT import_id, ?, segment_index, point_index, track_name,
      lat, lon, elevation, source_time
    FROM gpx_evidence_points WHERE import_id = ? AND revision_sequence = ?`)
      .run(nextSequence, importId, previousSequence)
    db.prepare(`INSERT INTO gpx_evidence_rejections (
      id, import_id, revision_sequence, kind, segment_index, point_index, reason, source_value
    ) SELECT lower(hex(randomblob(16))), import_id, ?, kind, segment_index,
      point_index, reason, source_value
    FROM gpx_evidence_rejections WHERE import_id = ? AND revision_sequence = ?`)
      .run(nextSequence, importId, previousSequence)
  })
  transaction.immediate()
  return getById(db, 'gpx_track_imports', importId, 'GPX import')
}

/** Retires the transaction-current GPX revision without deleting retained evidence. */
function retireGpxEvidence(db, importId, faultInjection = {}) {
  let retired = false
  const transaction = db.transaction(() => {
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
  if (mission.status === 'finished' || mission.status === 'finalized') {
    throw new Error(
      `Cannot write data to finished mission ${missionId}; resume the mission or unlock it first.`,
    )
  }
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
  insertEvent(db, missionId, eventType, timestamp, detailsJson)
}

function insertEvent(db, missionId, eventType, timestamp, detailsJson, recordedAt = now()) {
  const eventId = randomUUID()
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
  finishGpxImportBatch,
  recordGpxImportFailure,
  recordGpxImportSourceReceipt,
  retainGpxImportSourceBytes,
  settleGpxImportSourceReceipt,
  startGpxImportBatch,
  upsertGpxEvidence,
  upsertGpxEvidenceChunked,
}
