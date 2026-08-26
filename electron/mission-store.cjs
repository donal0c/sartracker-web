const fs = require('node:fs/promises')
const path = require('node:path')
const { randomUUID } = require('node:crypto')

const Database = require('better-sqlite3')
const { runBreadcrumbQueryInWorker } = require('./breadcrumb-query-runner.cjs')
const {
  runBreadcrumbDotQueryInWorker,
} = require('./breadcrumb-dot-query-runner.cjs')
const {
  runMissionReviewReadQueryInWorker,
} = require('./mission-review-read-query-runner.cjs')
const { runSqliteBackupInWorker } = require('./sqlite-backup-runner.cjs')
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

const CURRENT_SCHEMA_VERSION = 10
const DATABASE_FILE_NAME = 'mission-store.sqlite'
const BACKUP_FILE_NAME = 'mission-store.backup.sqlite'
const ARCHIVE_DIRECTORY_NAME = 'archives'
const INGEST_ANOMALY_OUTBOX_DIRECTORY_NAME = 'ingest-anomaly-outbox'
const COVERAGE_TILE_CACHE_DIRECTORY_NAME = 'coverage-renderer-cache'
const ARCHIVE_VERSION = 1

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
  const breadcrumbQueryRunner =
    options.runBreadcrumbQueryInWorker ?? runBreadcrumbQueryInWorker
  const breadcrumbDotQueryRunner =
    options.runBreadcrumbDotQueryInWorker ?? runBreadcrumbDotQueryInWorker
  const missionReviewReadQueryRunner =
    options.runMissionReviewReadQueryInWorker ?? runMissionReviewReadQueryInWorker
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
  const outingFixSummaryControllersByRequestId = new Map()
  const coverageQueryControllersByRequestId = new Map()
  const coverageTileControllersByRequestId = new Map()
  const coverageManifestBuildEvidenceByMission = new Map()
  let breadcrumbQueryTail = Promise.resolve()
  let missionReviewWorkerTail = Promise.resolve()
  let outingFixSummaryWorkerTail = Promise.resolve()
  let coverageChunkWorkerTail = Promise.resolve()
  const db = new Database(databasePath)
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = FULL')
  db.pragma('foreign_keys = ON')
  migrate(db)
  const outingStore = createOutingStore({
    db,
    faultInjection: options.outingFaultInjection ?? {},
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

  return {
    close: () => {
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
    createMissionArchive: async (missionId) => {
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
    },
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
          : addPositionsBulk(db, input, false, coverageLedgerFaultInjection),
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
    upsertMarker: async (input) => upsertById(db, 'markers', input, markerDefaults),
    getMarker: async (markerId) => getById(db, 'markers', markerId, 'Marker'),
    listMarkers: async (missionId) =>
      all(db, 'SELECT * FROM markers WHERE mission_id = ? ORDER BY display_order ASC, name ASC', missionId),
    deleteMarker: async (markerId) => deleteById(db, 'markers', markerId),
    upsertDrawing: async (input) => upsertById(db, 'drawings', input, drawingDefaults),
    getDrawing: async (drawingId) => getById(db, 'drawings', drawingId, 'Drawing'),
    listDrawings: async (missionId) =>
      all(db, 'SELECT * FROM drawings WHERE mission_id = ? ORDER BY display_order ASC, name ASC', missionId),
    deleteDrawing: async (drawingId) => deleteById(db, 'drawings', drawingId),
    upsertHelicopter: async (input) => upsertHelicopter(db, input),
    listHelicopters: async (missionId) =>
      all(db, 'SELECT * FROM helicopters WHERE mission_id = ? ORDER BY slot_key ASC', missionId),
    deleteHelicopter: async (helicopterId) => deleteById(db, 'helicopters', helicopterId),
    upsertGpxImport: async (input) => upsertById(db, 'gpx_track_imports', input, gpxDefaults),
    listGpxImports: async (missionId) =>
      all(db, 'SELECT * FROM gpx_track_imports WHERE mission_id = ? ORDER BY display_name ASC, imported_at ASC', missionId),
    deleteGpxImport: async (importId) => deleteById(db, 'gpx_track_imports', importId),
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
      imported_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE,
      UNIQUE (mission_id, source_path)
    );
    CREATE TABLE IF NOT EXISTS mission_events (
      id TEXT PRIMARY KEY,
      mission_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      details_json TEXT,
      FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE
    );
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
    ensureColumnExists(db, 'positions', 'source_position_id', 'TEXT')
    ensureColumnExists(db, 'positions', 'received_at', 'TEXT')
    ensureColumnExists(db, 'positions', 'content_hash', 'TEXT')
    ensureColumnExists(db, 'positions', 'source_kind', 'TEXT')
    ensureColumnExists(db, 'devices', 'group_id', 'TEXT')
    ensureColumnExists(db, 'devices', 'unique_id', 'TEXT')
    // Candidate-v9 stores may contain the rejected global positions index.
    // Dropping it is metadata-only and restores the bounded startup contract.
    db.exec('DROP INDEX IF EXISTS idx_positions_mission_timestamp;')
    ensureColumnExists(db, 'mission_group_membership_events', 'sequence', 'INTEGER')
    db.exec(`
      UPDATE mission_group_membership_events
      SET sequence = rowid
      WHERE sequence IS NULL;
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

    db.prepare("INSERT INTO metadata (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(String(CURRENT_SCHEMA_VERSION))
  })
  applyMigrations()
}

/** Returns whether one named schema table already exists. */
function tableExists(db, tableName) {
  return db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
  ).get(tableName) !== undefined
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
  await outbox.stageRendererEvidenceIncident(scopes, incidentId)
  return { staged_scope_count: scopes.length }
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
  const adminRoster = typeof readAdminRoster === 'function' ? await readAdminRoster() : []
  if (!adminRoster.map((value) => value.trim()).includes(adminName)) {
    appendEvent(db, missionId, 'mission_evidence_loss_acknowledgement_denied', {
      admin_name: adminName,
      reason,
      resulting_status: mission.status,
    })
    throw new Error('Selected admin is not authorized to acknowledge mission evidence loss.')
  }
  const candidate = await outbox.readEvidenceLossAcknowledgementCandidate(missionId)
  const timestamp = now()
  const transaction = db.transaction(() => {
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
    appendEvent(db, missionId, 'mission_archived', { archive_path: finalPath }, createdAt)
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

  appendEvent(db, missionId, 'mission_finalize_requested', { resulting_status: 'finished' })

  let archive = await readRecoverableFinalizeArchive(db, missionId)
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
      appendEvent(db, missionId, 'mission_archive_failed', {
        resulting_status: 'finished',
        error: error instanceof Error ? error.message : String(error),
      })
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
    db.prepare('UPDATE missions SET status = ? WHERE id = ?').run('finalized', missionId)
    insertEvent(db, missionId, 'mission_finalized', now(), {
      resulting_status: 'finalized',
      archive_path: archive.archive_path,
    })
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
  const adminRoster = typeof readAdminRoster === 'function' ? await readAdminRoster() : []
  if (!adminRoster.map((value) => value.trim()).includes(input.admin_name.trim())) {
    appendEvent(db, input.mission_id, 'mission_unlock_denied', {
      admin_name: input.admin_name,
      reason: input.reason,
      resulting_status: 'finalized',
    })
    throw new Error('Selected admin is not authorized to unlock finalized missions.')
  }
  const timestamp = now()
  const transaction = db.transaction(() => {
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
          refreshDeviceContact(db, input.mission_id, input.device_id, timestamp)
        }
      })()
      if (existing.device_id !== input.device_id) {
        throw new Error(
          `Source position ${sourcePositionId} is owned by device ${existing.device_id}; ` +
          `the conflicting observation from ${input.device_id} was retained without changing position truth.`,
        )
      }
      return existing
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
    db.prepare(`INSERT INTO positions (id, mission_id, device_id, source_position_id, name, lat, lon, altitude, speed, battery, accuracy, source, timestamp, data_origin, received_at, content_hash, source_kind)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, input.mission_id, input.device_id, sourcePositionId, input.name ?? null, input.lat, input.lon, input.altitude ?? null, input.speed ?? null, input.battery ?? null, input.accuracy ?? null, input.source ?? null, timestamp, dataOrigin, receivedAt, canonical.contentHash, sourcePositionId === null ? null : 'traccar')
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

function addPositionsBulk(db, input, includePositions = true, coverageFaultInjection = {}) {
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
  const insertPosition = db.prepare(`INSERT INTO positions (id, mission_id, device_id, source_position_id, name, lat, lon, altitude, speed, battery, accuracy, source, timestamp, data_origin, received_at, content_hash, source_kind)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
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
    }, includePositions, coverageFaultInjection)
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
  return all(db, `SELECT p.* FROM positions p
    INNER JOIN (
      SELECT device_id, MAX(timestamp) AS max_timestamp
      FROM positions
      WHERE mission_id = ?
      GROUP BY device_id
    ) latest ON p.device_id = latest.device_id AND p.timestamp = latest.max_timestamp
    WHERE p.mission_id = ?
    ORDER BY p.device_id ASC`, missionId, missionId)
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

function insertEvent(db, missionId, eventType, timestamp, detailsJson) {
  db.prepare('INSERT INTO mission_events (id, mission_id, event_type, timestamp, details_json) VALUES (?, ?, ?, ?, ?)')
    .run(randomUUID(), missionId, eventType, timestamp, detailsJson === undefined || detailsJson === null ? null : JSON.stringify(detailsJson))
}

function now() {
  return new Date().toISOString()
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
}
