#!/usr/bin/env node

import { execFile } from 'node:child_process'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import {
  constants as fsConstants,
  createWriteStream,
} from 'node:fs'
import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  realpath,
  rm,
  statfs,
  unlink,
} from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

import {
  MAX_ARCHIVE_PROCESS_RSS_BYTES,
  MAX_MAIN_CADENCE_MS,
  MIN_FIELD_FIXTURE_BYTES,
  REQUIRED_SCRYPT_PROFILE,
  parseBreadcrumbPr6QualificationArgs,
  validateBreadcrumbPr6QualificationEvidence,
} from '../build/breadcrumb-pr6-qualification-lib.js'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')
const { createElectronMissionStore } = require('../electron/mission-store.cjs')
const {
  createArchiveReviewSessionManager,
} = require('../electron/archive-review-sessions.cjs')
const {
  SARARCH2_SCRYPT_PROFILE,
  deriveSlotKey,
  generateRecoveryCode,
  zeroBuffer,
} = require('../electron/archive-crypto.cjs')
const { canonicalJson } = require('../electron/archive-container.cjs')
const {
  createArchiveTableSelection,
  listArchiveInventoryForSchema,
} = require('../electron/archive-inventory.cjs')

const execFileAsync = promisify(execFile)
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PROFILE_MARKER = '.breadcrumb-pr6-qualification-owned'
const DATABASE_FILE_NAME = 'mission-store.sqlite'
const ARCHIVE_DIRECTORY_NAME = 'archives'
const REVIEW_DIRECTORY_NAME = 'archive-review'
const MINIMUM_FREE_BYTES = 20 * 1024 * 1024 * 1024
const MAINTENANCE_NO_PROGRESS_TIMEOUT_MS = 120 * 1_000
const MAINTENANCE_POLL_INTERVAL_MS = 1_000
const HEARTBEAT_INTERVAL_MS = 50
const SCAN_CHUNK_BYTES = 64 * 1024
const QUALIFICATION_PHASES = Object.freeze(['create', 'verify', 'restore', 'cleanup'])
const RETAINED_CLEANUP_MISSION_TABLES = new Set(['mission_events', 'missions'])
const QUALIFICATION_CLEANUP_OPERATIONAL_TABLES = new Set([
  'gpx_import_source_receipts',
  'ingest_anomaly_deliveries',
  'participant_backfill_checkpoints',
  'tracking_history_checkpoints',
])
const FAILURE_METADATA_KEYS = Object.freeze([
  'archive_custody_recovery_failure',
  'archive_plaintext_sweep_failure',
  'archive_registry_reconciliation_failure',
  'gpx_receipt_recovery_failure',
  'legacy_archive_registry_backfill_failure',
  'legacy_evidence_backfill_failure',
])
const SHA256 = /^[0-9a-f]{64}$/u
const SAFE_TABLE = /^[A-Za-z_][A-Za-z0-9_]*$/u

/** Runs one exact-head Linux reference-host archive lifecycle qualification. */
async function main() {
  const options = parseBreadcrumbPr6QualificationArgs(process.argv.slice(2))
  if (process.platform !== 'linux') {
    throw new Error('The PR6 scale qualifier requires the Linux reference host.')
  }
  await assertEvidenceDestinationSourceNeutral(options.evidencePath)
  await prepareEvidenceDestination(options.evidencePath)

  const sourceBefore = await readRepositorySourceState()
  assertExactSourceState(sourceBefore, options.expectedRepositoryHead)
  const runStartedAtMs = Date.now()
  const runId = randomUUID()
  const profileRoot = await createOwnedProfileRoot()
  const copiedDatabasePath = path.join(profileRoot, DATABASE_FILE_NAME)
  const archiveDirectory = path.join(profileRoot, ARCHIVE_DIRECTORY_NAME)
  const reviewRoot = path.join(profileRoot, REVIEW_DIRECTORY_NAME)
  const rssSampler = startRssSampler()
  let store = null
  let reviewManager = null
  let positionProbe = null
  let passphrase = null
  let recoveryCode = null
  let storeOpen = false

  try {
    await assertMinimumFreeSpace(profileRoot)
    const stagedFixture = await stageClosedFixture({
      fixturePath: options.fixturePath,
      destinationPath: copiedDatabasePath,
    })
    assertFieldScaleFixture(stagedFixture)

    const migrationStartedAt = performance.now()
    const migrationRun = await runWithHeartbeatMonitor(async () => {
      store = createElectronMissionStore({ userDataPath: profileRoot })
      storeOpen = true
      const info = await store.info()
      if (info.database_path !== copiedDatabasePath) {
        throw new Error('The mission store did not open the disposable fixture copy.')
      }
      const settledMaintenance = await waitForMaintenanceSettlement(copiedDatabasePath)
      await delay(HEARTBEAT_INTERVAL_MS + 10)
      return settledMaintenance
    })
    const maintenance = migrationRun.result
    const migrationHeartbeatMaxGapMs = migrationRun.heartbeatMaxGapMs
    const migrationDurationMs = performance.now() - migrationStartedAt
    if (migrationHeartbeatMaxGapMs >= MAX_MAIN_CADENCE_MS) {
      throw new Error('Schema migration exceeded the immutable 200 ms heartbeat gate.')
    }

    const targetMission = await prepareTargetMission(store, options.missionId)
    const probeMission = await store.createMission({
      name: 'PR6 reference-host current-position probe',
    })
    const probeDeviceId = `pr6-probe-${runId}`
    await store.upsertDevice({
      mission_id: probeMission.id,
      device_id: probeDeviceId,
      name: 'PR6 Current Position Probe',
      color: '#0066CC',
      status: 'online',
    })
    positionProbe = startCurrentPositionProbe({
      store,
      missionId: probeMission.id,
      deviceId: probeDeviceId,
      runId,
    })

    passphrase = createEphemeralPassphrase()
    recoveryCode = generateRecoveryCode()
    const phaseDurationsMs = {
      migration: migrationDurationMs,
      create: 0,
      verify: 0,
      restore: 0,
      cleanup: 0,
    }

    positionProbe.setPhase('create')
    const createStartedAt = performance.now()
    let verifyStartedAt = null
    const finalized = await store.finalizeMission(
      targetMission.id,
      { passphrase, recoveryCode },
      {
        operationId: randomUUID(),
        onProgress(update) {
          if (update?.kind !== 'verify' || verifyStartedAt !== null) return
          verifyStartedAt = performance.now()
          phaseDurationsMs.create = verifyStartedAt - createStartedAt
          positionProbe.setPhase('verify')
        },
      },
    )
    if (verifyStartedAt === null) {
      throw new Error('Encrypted finalization did not enter independent verification.')
    }
    phaseDurationsMs.verify = performance.now() - verifyStartedAt
    if (finalized?.mission?.status !== 'finalized'
      || finalized?.archive?.status !== 'verified') {
      throw new Error('Encrypted mission finalization did not finish verified.')
    }

    const stored = readStoredArchiveEvidence(
      copiedDatabasePath,
      targetMission.id,
      finalized.archive.id,
    )
    const archivePath = path.join(archiveDirectory, stored.archive.archiveRelativePath)
    const archiveBeforeCleanup = await hashClosedRegularFile(archivePath)
    if (archiveBeforeCleanup.sha256 !== stored.archive.ciphertextSha256
      || archiveBeforeCleanup.sizeBytes !== stored.archive.sizeBytes) {
      throw new Error('Published archive bytes differ from their verified registry identity.')
    }

    reviewManager = createReviewManager({ store, reviewRoot, archiveDirectory })
    await reviewManager.sweepStartup()
    const timezone = resolvedTimezone()
    positionProbe.setPhase('restore')
    const restoreStartedAt = performance.now()
    const reviewBeforeCleanup = await runReviewProof({
      manager: reviewManager,
      databasePath: copiedDatabasePath,
      reviewRoot,
      archive: stored.archive,
      missionId: targetMission.id,
      selectedTime: stored.selectedTime,
      timezone,
      passphrase,
      recoveryCode,
    })
    phaseDurationsMs.restore = performance.now() - restoreStartedAt

    const eligibility = await store.getMissionCleanupEligibility({
      missionId: targetMission.id,
      archiveId: stored.archive.archiveId,
    }, { reviewActivity: false })
    if (eligibility?.eligible !== false || eligibility?.storageState !== 'live'
      || canonicalJson(eligibility?.blockers)
        !== canonicalJson(['fresh_non_machine_unlock_required'])) {
      throw new Error('Cleanup did not retain its sole fresh non-machine credential blocker.')
    }

    const cleanupLease = reviewManager.acquireCleanupLease(targetMission.id)
    let reviewLeaseHeld = true
    let cleanupResult
    try {
      positionProbe.setPhase('cleanup')
      const cleanupStartedAt = performance.now()
      cleanupResult = await store.startMissionCleanup({
        missionId: targetMission.id,
        archiveId: stored.archive.archiveId,
        slotType: 'recovery',
        secret: recoveryCode,
      }, {
        operationId: randomUUID(),
        onProgress: () => undefined,
        reviewActivity: false,
      })
      phaseDurationsMs.cleanup = performance.now() - cleanupStartedAt
    } finally {
      cleanupLease.release()
    }
    reviewLeaseHeld = reviewLeaseHeld && cleanupResult?.state === 'completed'
    if (cleanupResult?.state !== 'completed' || cleanupResult?.storageState !== 'archived') {
      throw new Error('Eligibility-gated live mission cleanup did not complete.')
    }

    const liveness = await positionProbe.stop()
    positionProbe = null
    const cleanupProof = readCleanupProof({
      databasePath: copiedDatabasePath,
      missionId: targetMission.id,
      archiveId: stored.archive.archiveId,
    })
    const archivedMission = await store.getMission(targetMission.id)
    if (archivedMission.status !== 'finalized' || archivedMission.storage_state !== 'archived') {
      throw new Error('Cleanup did not retain the finalized archived mission stub.')
    }
    const retainedArchives = await store.listMissionArchives(targetMission.id)
    if (!retainedArchives.some((candidate) =>
      candidate.id === stored.archive.archiveId
      && candidate.status === 'verified'
      && candidate.availability === 'present')) {
      throw new Error('Cleanup did not retain the verified archive registry identity.')
    }
    const archiveAfterCleanup = await hashClosedRegularFile(archivePath)
    if (archiveAfterCleanup.sha256 !== archiveBeforeCleanup.sha256
      || archiveAfterCleanup.sizeBytes !== archiveBeforeCleanup.sizeBytes) {
      throw new Error('Immutable archive bytes changed during live-store cleanup.')
    }

    const reviewAfterCleanup = await runReviewProof({
      manager: reviewManager,
      databasePath: copiedDatabasePath,
      reviewRoot,
      archive: stored.archive,
      missionId: targetMission.id,
      selectedTime: stored.selectedTime,
      timezone,
      passphrase,
      recoveryCode,
    })
    if (reviewAfterCleanup.replayPageCount !== reviewBeforeCleanup.replayPageCount
      || reviewAfterCleanup.replayDigest !== reviewBeforeCleanup.replayDigest) {
      throw new Error('Archive-backed Review changed after cleanup.')
    }

    await reviewManager.prepareClose()
    reviewManager = null
    await store.prepareClose()
    store.close()
    storeOpen = false
    store = null

    await proveRestartSweeps({
      profileRoot,
      reviewRoot,
      archiveDirectory,
      missionId: targetMission.id,
      archiveId: stored.archive.archiveId,
    })

    const kdf = await measureProductionKdf()
    const finalResidue = await scanEvidenceRoots({
      roots: residueRoots(archiveDirectory, reviewRoot),
      secrets: [passphrase, recoveryCode],
      privacyCanary: targetMission.id,
    })
    const profileSecretScan = await scanEvidenceRoots({
      roots: [{ label: 'qualification-profile', rootPath: profileRoot }],
      secrets: [passphrase, recoveryCode],
      privacyCanary: null,
    })
    if (finalResidue.unreadableFiles.length > 0
      || finalResidue.appAddressablePlaintextFiles.length > 0
      || finalResidue.secretMatches.length > 0
      || finalResidue.privacyMatches.length > 0
      || profileSecretScan.unreadableFiles.length > 0
      || profileSecretScan.secretMatches.length > 0) {
      throw new Error('App-addressable residue or exact secret scanning failed closed.')
    }

    const fixtureAfter = await inspectClosedFixtureSource(
      options.fixturePath,
      stagedFixture.sourceIdentity,
    )
    if (fixtureAfter.sha256 !== stagedFixture.sourceSha256Before
      || fixtureAfter.sizeBytes !== stagedFixture.sourceBytes) {
      throw new Error('The source fixture changed during disposable-copy qualification.')
    }
    const sourceAfter = await readRepositorySourceState()
    assertSameExactSource(sourceBefore, sourceAfter)
    const resources = await rssSampler.stop()
    const runCompletedAtMs = Date.now()
    const evidence = {
      schema: 'sartracker-breadcrumb-pr6-qualification-v1',
      run: {
        runId,
        startedAt: new Date(runStartedAtMs).toISOString(),
        completedAt: new Date(runCompletedAtMs).toISOString(),
        durationMs: runCompletedAtMs - runStartedAtMs,
        phaseDurationsMs,
      },
      source: {
        repositoryHead: sourceBefore.head,
        repositoryHeadAfterRun: sourceAfter.head,
        repositoryTree: sourceBefore.tree,
        repositoryTreeAfterRun: sourceAfter.tree,
        repositoryDirtyBefore: !sourceBefore.clean,
        repositoryDirtyAfter: !sourceAfter.clean,
      },
      machine: {
        hostname: os.hostname(),
        platform: process.platform,
        release: os.release(),
        architecture: os.arch(),
        cpuCount: os.cpus().length,
        totalMemoryBytes: os.totalmem(),
        nodeVersion: process.version,
      },
      flags: {
        fixtureBasename: path.basename(options.fixturePath),
        missionId: options.missionId,
        timezone,
        heartbeatHardGateMs: MAX_MAIN_CADENCE_MS,
        currentCadenceHardGateMs: MAX_MAIN_CADENCE_MS,
        rssLimitBytes: MAX_ARCHIVE_PROCESS_RSS_BYTES,
      },
      fixture: {
        copiedBeforeOpen: stagedFixture.copiedBeforeOpen,
        sourceWasRegularFile: stagedFixture.sourceWasRegularFile,
        sourceWasSymlink: stagedFixture.sourceWasSymlink,
        sourceWalBytes: stagedFixture.sourceWalBytes,
        sourceShmBytes: stagedFixture.sourceShmBytes,
        sourceSha256Before: stagedFixture.sourceSha256Before,
        sourceSha256After: fixtureAfter.sha256,
        copiedSha256: stagedFixture.copiedSha256,
        sourceBytes: stagedFixture.sourceBytes,
        copiedBytes: stagedFixture.copiedBytes,
      },
      migration: {
        schemaVersion: maintenance.schemaVersion,
        durationMs: migrationDurationMs,
        heartbeatMaxGapMs: migrationHeartbeatMaxGapMs,
        backfillsSettled: maintenance.settled,
        failureMarkers: maintenance.failureMarkers,
      },
      archive: stored.archive,
      completeness: stored.completeness,
      cleanup: {
        state: cleanupResult.state,
        storageState: cleanupResult.storageState,
        preCredentialBlockers: [...eligibility.blockers],
        reviewLeaseHeld,
        deletedTableRowsRemain: cleanupProof.remainingRows,
        retainedMissionStub: cleanupProof.retainedMissionStub,
        retainedArchiveRegistry: cleanupProof.retainedArchiveRegistry,
        archiveSha256After: archiveAfterCleanup.sha256,
      },
      reviewBeforeCleanup,
      reviewAfterCleanup,
      liveness,
      resources,
      residue: {
        rootsChecked: ['archive-staging', 'verification-scratch', 'archive-review-sessions'],
        filesScanned: finalResidue.filesScanned + profileSecretScan.filesScanned,
        bytesScanned: finalResidue.bytesScanned + profileSecretScan.bytesScanned,
        unreadableFiles: [...finalResidue.unreadableFiles, ...profileSecretScan.unreadableFiles],
        appAddressablePlaintextFiles: finalResidue.appAddressablePlaintextFiles,
        secretMatches: [...new Set([
          ...finalResidue.secretMatches,
          ...profileSecretScan.secretMatches,
        ])],
        privacyMatches: finalResidue.privacyMatches,
        claimsForensicSecureErasure: false,
      },
      kdf,
    }
    validateBreadcrumbPr6QualificationEvidence(
      evidence,
      options.expectedRepositoryHead,
    )
    assertEvidencePayloadSafe(evidence, [
      options.fixturePath,
      options.evidencePath,
      profileRoot,
      projectRoot,
      passphrase,
      recoveryCode,
    ])
    await writeQualificationEvidence(options.evidencePath, evidence)
    process.stdout.write(`${JSON.stringify({
      passed: true,
      repositoryHead: sourceAfter.head,
      ciphertextBytes: stored.archive.sizeBytes,
      tableCount: stored.archive.tableCount,
    })}\n`)
  } finally {
    if (positionProbe !== null) await positionProbe.stop().catch(() => undefined)
    if (reviewManager !== null) await reviewManager.prepareClose().catch(() => undefined)
    if (store !== null && storeOpen) {
      await store.prepareClose().catch(() => undefined)
      try { store.close() } catch {}
    }
    await rssSampler.stop().catch(() => undefined)
    passphrase = null
    recoveryCode = null
    await removeOwnedProfileRoot(profileRoot)
  }
}

/** Streams one pinned closed fixture into a new mode-0600 disposable database copy. */
export async function stageClosedFixture({ fixturePath, destinationPath }) {
  const sidecars = await inspectClosedSidecars(fixturePath)
  const source = await openPinnedRegularFile(fixturePath, null, 'fixture')
  let destinationHandle = null
  try {
    const sourceSha256Before = await hashOpenFile(source.handle)
    await mkdir(path.dirname(destinationPath), { recursive: true, mode: 0o700 })
    destinationHandle = await open(destinationPath, 'wx', 0o600)
    await destinationHandle.chmod(0o600)
    await pipeline(
      source.handle.createReadStream({ start: 0, autoClose: false }),
      createWriteStream(destinationPath, {
        fd: destinationHandle.fd,
        autoClose: false,
      }),
    )
    await destinationHandle.sync()
    await destinationHandle.close()
    destinationHandle = null
    await chmod(destinationPath, 0o600)
    const copied = await hashClosedRegularFile(destinationPath)
    if (copied.sha256 !== sourceSha256Before
      || copied.sizeBytes !== source.identity.sizeBytes) {
      throw new Error('The disposable fixture copy differs from the pinned source bytes.')
    }
    return Object.freeze({
      copiedBeforeOpen: true,
      sourceWasRegularFile: true,
      sourceWasSymlink: false,
      sourceWalBytes: sidecars.walBytes,
      sourceShmBytes: sidecars.shmBytes,
      sourceSha256Before,
      copiedSha256: copied.sha256,
      sourceBytes: source.identity.sizeBytes,
      copiedBytes: copied.sizeBytes,
      sourceIdentity: source.identity,
    })
  } finally {
    if (destinationHandle !== null) await destinationHandle.close().catch(() => undefined)
    await source.handle.close().catch(() => undefined)
  }
}

/** Parses only the exact completed cleanup journal cursor used for exhaustive zero checks. */
export function parseTerminalCleanupJournal(row, expectedArchiveId, expectedTables) {
  if (row === null || typeof row !== 'object' || Array.isArray(row)
    || row.state !== 'completed' || row.archive_id !== expectedArchiveId) {
    throw new Error('Mission cleanup journal is not terminal for the expected archive.')
  }
  let progress
  try {
    progress = JSON.parse(row.progress_json)
  } catch {
    throw new Error('Mission cleanup journal progress is invalid.')
  }
  if (progress === null || typeof progress !== 'object' || Array.isArray(progress)
    || progress.version !== 1 || progress.archiveId !== expectedArchiveId
    || !SHA256.test(progress.ciphertextSha256)
    || !SHA256.test(progress.verificationProofSha256)
    || !Number.isSafeInteger(progress.sizeBytes) || progress.sizeBytes < 1
    || !Number.isSafeInteger(progress.finalizationEpoch) || progress.finalizationEpoch < 1
    || !Array.isArray(progress.tables) || progress.tables.length < 1
    || progress.tables.length > 100
    || progress.tables.some((tableName) =>
      typeof tableName !== 'string' || !SAFE_TABLE.test(tableName))
    || new Set(progress.tables).size !== progress.tables.length
    || progress.tableIndex !== progress.tables.length
    || !Number.isSafeInteger(progress.tableBatch) || progress.tableBatch < 0
    || !Number.isSafeInteger(progress.deletedRows) || progress.deletedRows < 0) {
    throw new Error('Mission cleanup journal did not exhaust its declared table plan.')
  }
  if (!Array.isArray(expectedTables) || expectedTables.length < 1
    || expectedTables.some((tableName) =>
      typeof tableName !== 'string' || !SAFE_TABLE.test(tableName))
    || new Set(expectedTables).size !== expectedTables.length
    || canonicalJson([...progress.tables].sort())
      !== canonicalJson([...expectedTables].sort())) {
    throw new Error('Mission cleanup journal table plan is not complete for schema v13.')
  }
  return Object.freeze({
    tables: Object.freeze([...progress.tables]),
    deletedRows: progress.deletedRows,
  })
}

/** Requires the copied database itself, not an unrelated attachment, to prove field scale. */
export function assertFieldScaleFixture(input) {
  if (!Number.isSafeInteger(input?.sourceBytes)
    || !Number.isSafeInteger(input?.copiedBytes)
    || input.sourceBytes !== input.copiedBytes
    || input.sourceBytes <= MIN_FIELD_FIXTURE_BYTES) {
    throw new Error('Qualification requires a copied database fixture greater than 2 GiB.')
  }
  return true
}

/** Derives validator-ready liveness evidence and enforces the hard gate locally. */
export function deriveLivenessEvidence(measurements) {
  const byPhase = {}
  let heartbeatMaxGapMs = 0
  let currentPositionMaxCadenceMs = 0
  for (const phase of QUALIFICATION_PHASES) {
    const value = measurements?.[phase]
    if (value === null || typeof value !== 'object'
      || !Array.isArray(value.heartbeatGapsMs) || value.heartbeatGapsMs.length < 1
      || !Array.isArray(value.currentCadencesMs) || value.currentCadencesMs.length < 1
      || !Number.isSafeInteger(value.currentWrites) || value.currentWrites < 1
      || value.visibleWrites !== value.currentWrites) {
      throw new Error(`Current-position proof for ${phase} is incomplete.`)
    }
    const phaseHeartbeat = Math.max(...value.heartbeatGapsMs)
    const phaseCadence = Math.max(...value.currentCadencesMs)
    if (!Number.isFinite(phaseHeartbeat) || phaseHeartbeat < 0
      || !Number.isFinite(phaseCadence) || phaseCadence < 0
      || phaseHeartbeat >= MAX_MAIN_CADENCE_MS
      || phaseCadence >= MAX_MAIN_CADENCE_MS) {
      throw new Error(`Current positions or heartbeat exceeded the 200 ms gate during ${phase}.`)
    }
    byPhase[phase] = Object.freeze({
      heartbeatMaxGapMs: phaseHeartbeat,
      currentPositionMaxCadenceMs: phaseCadence,
      currentWrites: value.currentWrites,
      visibleWrites: value.visibleWrites,
    })
    heartbeatMaxGapMs = Math.max(heartbeatMaxGapMs, phaseHeartbeat)
    currentPositionMaxCadenceMs = Math.max(currentPositionMaxCadenceMs, phaseCadence)
  }
  return Object.freeze({
    heartbeatMaxGapMs,
    currentPositionMaxCadenceMs,
    currentPositionsIndependent: true,
    byPhase: Object.freeze(byPhase),
  })
}

/** Scans regular files below named app roots without following symbolic links. */
export async function scanEvidenceRoots({ roots, secrets, privacyCanary }) {
  const secretPatterns = [...new Set((secrets ?? []).filter((value) =>
    typeof value === 'string' && value.length > 0))]
  const privacyPatterns = typeof privacyCanary === 'string' && privacyCanary.length > 0
    ? [privacyCanary]
    : []
  const result = {
    filesScanned: 0,
    bytesScanned: 0,
    unreadableFiles: [],
    appAddressablePlaintextFiles: [],
    secretMatches: [],
    privacyMatches: [],
  }
  for (const root of roots) {
    await scanNamedRoot(root, secretPatterns, privacyPatterns, result)
  }
  for (const field of [
    'unreadableFiles',
    'appAddressablePlaintextFiles',
    'secretMatches',
    'privacyMatches',
  ]) result[field].sort()
  return Object.freeze({
    ...result,
    unreadableFiles: Object.freeze(result.unreadableFiles),
    appAddressablePlaintextFiles: Object.freeze(result.appAddressablePlaintextFiles),
    secretMatches: Object.freeze(result.secretMatches),
    privacyMatches: Object.freeze(result.privacyMatches),
  })
}

/** Atomically publishes one new mode-0600 JSON evidence file without overwriting proof. */
export async function writeQualificationEvidence(evidencePath, evidence) {
  const parent = path.dirname(evidencePath)
  await mkdir(parent, { recursive: true, mode: 0o700 })
  try {
    await lstat(evidencePath)
    throw new Error('Qualification evidence already exists.')
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  const temporaryPath = path.join(
    parent,
    `.${path.basename(evidencePath)}.tmp-${process.pid}-${randomUUID()}`,
  )
  let handle = null
  try {
    handle = await open(temporaryPath, 'wx', 0o600)
    await handle.chmod(0o600)
    await handle.writeFile(`${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
    await handle.sync()
    await handle.close()
    handle = null
    try {
      await link(temporaryPath, evidencePath)
    } catch (error) {
      if (error?.code === 'EEXIST') {
        throw new Error('Qualification evidence already exists.')
      }
      throw error
    }
    await chmod(evidencePath, 0o600)
    await unlink(temporaryPath)
    const directoryHandle = await open(parent, fsConstants.O_RDONLY)
    try { await directoryHandle.sync() } finally { await directoryHandle.close() }
  } finally {
    if (handle !== null) await handle.close().catch(() => undefined)
    await unlink(temporaryPath).catch((error) => {
      if (error?.code !== 'ENOENT') throw error
    })
  }
}

/** Opens a regular non-symlink file with descriptor/path identity pinned. */
async function openPinnedRegularFile(filePath, expectedIdentity, label) {
  let pathStat
  try {
    pathStat = await lstat(filePath, { bigint: true })
  } catch {
    throw new Error(`The ${label} is unavailable as a closed regular file.`)
  }
  if (!pathStat.isFile() || pathStat.isSymbolicLink() || pathStat.nlink !== 1n) {
    throw new Error(`The ${label} must be a closed regular file without links.`)
  }
  let handle
  try {
    handle = await open(
      filePath,
      fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0),
    )
    const descriptorStat = await handle.stat({ bigint: true })
    const identity = fileIdentity(descriptorStat)
    if (!descriptorStat.isFile() || descriptorStat.nlink !== 1n
      || identity.device !== pathStat.dev.toString()
      || identity.inode !== pathStat.ino.toString()
      || (expectedIdentity !== null && !sameFileIdentity(identity, expectedIdentity))) {
      throw new Error('identity mismatch')
    }
    return Object.freeze({ handle, identity })
  } catch (error) {
    await handle?.close().catch(() => undefined)
    throw new Error(`The ${label} changed or is not a pinned closed regular file.`)
  }
}

/** Returns the stable file identity used only for in-process source immutability checks. */
function fileIdentity(stat) {
  const sizeBytes = Number(stat.size)
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 1) {
    throw new Error('Pinned file size is invalid.')
  }
  return Object.freeze({
    device: stat.dev.toString(),
    inode: stat.ino.toString(),
    linkCount: Number(stat.nlink),
    sizeBytes,
    modifiedTimeNanoseconds: stat.mtimeNs.toString(),
    changedTimeNanoseconds: stat.ctimeNs.toString(),
  })
}

/** Compares every pinned source identity field exactly. */
function sameFileIdentity(left, right) {
  return Object.keys(left).every((key) => left[key] === right[key])
}

/** Hashes one pinned descriptor from byte zero without closing it. */
async function hashOpenFile(handle) {
  const hash = createHash('sha256')
  for await (const chunk of handle.createReadStream({ start: 0, autoClose: false })) {
    hash.update(chunk)
  }
  return hash.digest('hex')
}

/** Hashes one closed regular file with a pinned descriptor and no path following. */
async function hashClosedRegularFile(filePath) {
  const pinned = await openPinnedRegularFile(filePath, null, 'file')
  try {
    return Object.freeze({
      sha256: await hashOpenFile(pinned.handle),
      sizeBytes: pinned.identity.sizeBytes,
      identity: pinned.identity,
    })
  } finally {
    await pinned.handle.close()
  }
}

/** Re-hashes the source fixture after all work and requires its original inode identity. */
async function inspectClosedFixtureSource(fixturePath, expectedIdentity) {
  await inspectClosedSidecars(fixturePath)
  const pinned = await openPinnedRegularFile(fixturePath, expectedIdentity, 'fixture')
  try {
    return Object.freeze({
      sha256: await hashOpenFile(pinned.handle),
      sizeBytes: pinned.identity.sizeBytes,
    })
  } finally {
    await pinned.handle.close()
  }
}

/** Requires absent or empty regular SQLite sidecars before source-copy qualification. */
async function inspectClosedSidecars(fixturePath) {
  const walBytes = await inspectClosedSidecar(`${fixturePath}-wal`)
  const shmBytes = await inspectClosedSidecar(`${fixturePath}-shm`)
  if (walBytes !== 0 || shmBytes !== 0) {
    throw new Error('The source fixture has a non-empty SQLite sidecar.')
  }
  return Object.freeze({ walBytes, shmBytes })
}

/** Returns one safe sidecar size without opening it. */
async function inspectClosedSidecar(sidecarPath) {
  try {
    const stat = await lstat(sidecarPath)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== 0) {
      return Math.max(1, Number(stat.size) || 1)
    }
    return 0
  } catch (error) {
    if (error?.code === 'ENOENT') return 0
    throw new Error('The source fixture SQLite sidecar is unreadable.')
  }
}

/** Waits for every v13 bounded migration/backfill owner to settle durably. */
export async function waitForMaintenanceSettlement(databasePath, options = {}) {
  const readState = options.readState ?? readMaintenanceState
  const readNow = options.now ?? (() => performance.now())
  const wait = options.wait ?? delay
  const pollIntervalMs = options.pollIntervalMs ?? MAINTENANCE_POLL_INTERVAL_MS
  if (typeof readState !== 'function' || typeof readNow !== 'function'
    || typeof wait !== 'function' || !Number.isFinite(pollIntervalMs)
    || pollIntervalMs < 1 || pollIntervalMs > MAINTENANCE_NO_PROGRESS_TIMEOUT_MS) {
    throw new Error('Schema v13 maintenance watchdog configuration is invalid.')
  }
  const seenTokens = new Set()
  let priorState = null
  let priorToken = null
  let lastProgressAt = readNow()
  if (!Number.isFinite(lastProgressAt)) {
    throw new Error('Schema v13 maintenance watchdog clock is invalid.')
  }
  while (true) {
    const state = readState(databasePath)
    if (state.failureMarkers.length > 0) {
      throw new Error('A durable migration or archive recovery failure marker is present.')
    }
    const observedAt = readNow()
    if (!Number.isFinite(observedAt) || observedAt < lastProgressAt) {
      throw new Error('Schema v13 maintenance watchdog clock is invalid.')
    }
    if (priorToken !== null
      && observedAt - lastProgressAt >= MAINTENANCE_NO_PROGRESS_TIMEOUT_MS) {
      throw new Error(
        'Schema v13 maintenance made no durable semantic progress for 120 seconds.',
      )
    }
    const token = maintenanceProgressToken(state)
    if (priorToken === null) {
      seenTokens.add(token)
      priorState = state
      priorToken = token
      lastProgressAt = observedAt
    } else if (token !== priorToken) {
      if (seenTokens.has(token)) {
        throw new Error('Schema v13 maintenance entered a repeated cyclic progress state.')
      }
      assertMaintenanceProgressDidNotRegress(priorState.progress, state.progress)
      seenTokens.add(token)
      priorState = state
      priorToken = token
      lastProgressAt = observedAt
    }
    if (state.settled) return state
    await wait(pollIntervalMs)
  }
}

/** Reads one closed maintenance snapshot through a separate query-only connection. */
function readMaintenanceState(databasePath) {
  return withReadonlyDatabase(databasePath, (db) => {
    const schemaVersion = Number(db.prepare(`SELECT value FROM metadata
      WHERE key = 'schema_version'`).get()?.value ?? 0)
    const objectCursors = db.prepare(`SELECT object_type AS key,
        scanned_through_id AS cursor, scan_target_id AS target
      FROM legacy_mission_object_backfill_state ORDER BY object_type ASC`).all()
    const eventCursors = db.prepare(`SELECT table_name AS key,
        CAST(scanned_through_id AS TEXT) AS cursor,
        CAST(scan_target_id AS TEXT) AS target
      FROM legacy_event_provenance_backfill_state ORDER BY table_name ASC`).all()
    const safeGpxRow = db.prepare(`SELECT scanned_through_rowid, scan_target_rowid
      FROM legacy_gpx_backfill_state WHERE singleton = 1`).get()
    const unsafeGpxRow = db.prepare(`SELECT low_scanned_through_rowid, low_target_rowid,
        high_scanned_through_rowid, high_target_rowid
      FROM legacy_gpx_rowid_scan_state WHERE singleton = 1`).get()
    const safeGpx = {
      cursor: String(safeGpxRow?.scanned_through_rowid ?? ''),
      target: String(safeGpxRow?.scan_target_rowid ?? ''),
    }
    const unsafeGpx = {
      lowCursor: String(unsafeGpxRow?.low_scanned_through_rowid ?? ''),
      lowTarget: String(unsafeGpxRow?.low_target_rowid ?? ''),
      highCursor: String(unsafeGpxRow?.high_scanned_through_rowid ?? ''),
      highTarget: String(unsafeGpxRow?.high_target_rowid ?? ''),
    }
    const objectPending = objectCursors.filter((row) => row.target !== null
      && (row.cursor === null || row.cursor < row.target)).length
    const eventPending = eventCursors.filter((row) => row.target !== null
      && (row.cursor === null || BigInt(row.cursor) < BigInt(row.target))).length
    const safeGpxPending = integerText(safeGpx.cursor) < integerText(safeGpx.target) ? 1 : 0
    const unsafeGpxPending = integerText(unsafeGpx.lowCursor)
        > integerText(unsafeGpx.lowTarget)
      || integerText(unsafeGpx.highCursor) < integerText(unsafeGpx.highTarget) ? 1 : 0
    const receiptPending = Number(db.prepare(`SELECT COUNT(*) AS count
      FROM gpx_import_source_receipts WHERE status IN ('pending', 'retained')`).get().count)
    const archiveProgress = readLegacyArchiveMaintenanceProgress(db)
    const unknownArchiveCustody = Number(db.prepare(`SELECT COUNT(*) AS count
      FROM mission_archives WHERE availability = 'unknown'`).get().count)
    const unsettledCustody = Number(db.prepare(`SELECT COUNT(*) AS count
      FROM metadata WHERE key = 'archive_custody_active_operation'`).get().count)
    const failureMarkers = db.prepare(`SELECT key FROM metadata
      WHERE key IN (${FAILURE_METADATA_KEYS.map(() => '?').join(', ')})
      ORDER BY key ASC`).all(...FAILURE_METADATA_KEYS).map((row) => row.key)
    const progress = Object.freeze({
      schemaVersion,
      objectCursors: Object.freeze(objectCursors.map((row) => Object.freeze({ ...row }))),
      eventCursors: Object.freeze(eventCursors.map((row) => Object.freeze({ ...row }))),
      safeGpx: Object.freeze(safeGpx),
      unsafeGpx: Object.freeze(unsafeGpx),
      receiptPending,
      archiveCursor: archiveProgress.cursor,
      archiveTarget: archiveProgress.target,
      legacyArchivePending: archiveProgress.pending,
      unknownArchiveCustody,
      unsettledCustody,
    })
    return Object.freeze({
      schemaVersion,
      failureMarkers: Object.freeze(failureMarkers),
      progress,
      settled: schemaVersion === 13
        && objectPending === 0
        && eventPending === 0
        && safeGpxPending === 0
        && unsafeGpxPending === 0
        && receiptPending === 0
        && legacyArchivePending === 0
        && unknownArchiveCustody === 0
        && unsettledCustody === 0,
    })
  })
}

/** Reads only the fixed legacy archive metadata bounds, never mission evidence rows. */
export function readLegacyArchiveMaintenanceProgress(db) {
  if (db === null || typeof db !== 'object' || typeof db.prepare !== 'function') {
    throw new Error('Schema v13 legacy archive maintenance database is invalid.')
  }
  const statement = db.prepare('SELECT value FROM metadata WHERE key = ?')
  const cursor = readOptionalMaintenanceInteger(
    statement.get('legacy_archive_registry_backfill_cursor'),
  )
  const target = readOptionalMaintenanceInteger(
    statement.get('legacy_archive_registry_backfill_target'),
  )
  if (cursor === null || target === null) {
    return Object.freeze({ cursor: null, target: null, pending: 1 })
  }
  if (integerText(cursor) > integerText(target)) {
    throw new Error('Schema v13 legacy archive maintenance bounds are invalid.')
  }
  return Object.freeze({
    cursor,
    target,
    pending: cursor === target ? 0 : 1,
  })
}

/** Reads one optional canonical non-negative integer from a metadata row. */
function readOptionalMaintenanceInteger(row) {
  if (row === undefined) return null
  if (row === null || typeof row !== 'object' || typeof row.value !== 'string'
    || !/^(?:0|[1-9][0-9]*)$/u.test(row.value)) {
    throw new Error('Schema v13 maintenance progress cursor is invalid.')
  }
  return row.value
}

/** Returns one exact semantic token without clocks, paths or operational noise. */
function maintenanceProgressToken(state) {
  if (state === null || typeof state !== 'object' || Array.isArray(state)
    || state.progress === null || typeof state.progress !== 'object'
    || Array.isArray(state.progress)) {
    throw new Error('Schema v13 maintenance progress state is invalid.')
  }
  return canonicalJson(state.progress)
}

/** Rejects every backwards durable cursor or changed captured target. */
function assertMaintenanceProgressDidNotRegress(previous, current) {
  if (!Number.isSafeInteger(previous?.schemaVersion)
    || !Number.isSafeInteger(current?.schemaVersion)
    || current.schemaVersion < previous.schemaVersion) {
    throw new Error('Schema v13 maintenance progress regressed.')
  }
  assertCursorSeriesDidNotRegress(
    previous.objectCursors,
    current.objectCursors,
    compareTextCursor,
  )
  assertCursorSeriesDidNotRegress(
    previous.eventCursors,
    current.eventCursors,
    compareIntegerCursor,
  )
  assertFixedTargetCursorDidNotRegress(previous.safeGpx, current.safeGpx, 'cursor', 'target')
  assertFixedTargetCursorDidNotRegress(
    previous.unsafeGpx,
    current.unsafeGpx,
    'highCursor',
    'highTarget',
  )
  assertFixedTargetCursorDidNotRegress(
    current.unsafeGpx,
    previous.unsafeGpx,
    'lowCursor',
    'lowTarget',
  )
  for (const field of [
    'receiptPending',
    'legacyArchivePending',
    'unsettledCustody',
  ]) {
    if (!Number.isSafeInteger(previous[field]) || previous[field] < 0
      || !Number.isSafeInteger(current[field]) || current[field] < 0
      || current[field] > previous[field]) {
      throw new Error('Schema v13 maintenance progress regressed.')
    }
  }
  assertInitializableFixedTargetCursorDidNotRegress(
    { cursor: previous.archiveCursor, target: previous.archiveTarget },
    { cursor: current.archiveCursor, target: current.archiveTarget },
  )
}

/** Rejects a reordered series, changed target, or backwards cursor. */
function assertCursorSeriesDidNotRegress(previous, current, compareCursor) {
  if (!Array.isArray(previous) || !Array.isArray(current)
    || previous.length !== current.length) {
    throw new Error('Schema v13 maintenance progress regressed.')
  }
  for (let index = 0; index < previous.length; index += 1) {
    const before = previous[index]
    const after = current[index]
    if (before?.key !== after?.key || before?.target !== after?.target
      || compareCursor(before?.cursor, after?.cursor) > 0) {
      throw new Error('Schema v13 maintenance progress regressed.')
    }
  }
}

/** Rejects a changed target or backwards bounded integer cursor. */
function assertFixedTargetCursorDidNotRegress(previous, current, cursorKey, targetKey) {
  if (previous?.[targetKey] !== current?.[targetKey]
    || compareIntegerCursor(previous?.[cursorKey], current?.[cursorKey]) > 0) {
    throw new Error('Schema v13 maintenance progress regressed.')
  }
}

/** Allows one missing-key startup transition, then fixes the target permanently. */
function assertInitializableFixedTargetCursorDidNotRegress(previous, current) {
  const previousInitialized = previous?.cursor !== null && previous?.target !== null
  const currentInitialized = current?.cursor !== null && current?.target !== null
  if ((previous?.cursor === null) !== (previous?.target === null)
    || (current?.cursor === null) !== (current?.target === null)) {
    throw new Error('Schema v13 maintenance progress regressed.')
  }
  if (!previousInitialized) {
    if (!currentInitialized) return
    if (compareIntegerCursor(current.cursor, current.target) > 0) {
      throw new Error('Schema v13 maintenance progress regressed.')
    }
    return
  }
  if (!currentInitialized) {
    throw new Error('Schema v13 maintenance progress regressed.')
  }
  assertFixedTargetCursorDidNotRegress(previous, current, 'cursor', 'target')
}

/** Compares nullable text cursors with null as the not-started minimum. */
function compareTextCursor(left, right) {
  if (left === null) return right === null ? 0 : -1
  if (right === null || typeof left !== 'string' || typeof right !== 'string') return 1
  return left < right ? -1 : left > right ? 1 : 0
}

/** Compares nullable signed-integer text cursors without precision loss. */
function compareIntegerCursor(left, right) {
  if (left === null) return right === null ? 0 : -1
  if (right === null) return 1
  const before = integerText(left)
  const after = integerText(right)
  return before < after ? -1 : before > after ? 1 : 0
}

/** Parses one exact signed integer cursor without accepting numeric noise. */
function integerText(value) {
  if (typeof value !== 'string' || !/^-?(?:0|[1-9][0-9]*)$/u.test(value)) {
    throw new Error('Schema v13 maintenance progress cursor is invalid.')
  }
  return BigInt(value)
}

/** Finishes the selected fixture mission without permitting a prior finalization. */
async function prepareTargetMission(store, missionId) {
  let mission = await store.getMission(missionId)
  if (mission.status === 'finalized') {
    throw new Error('The qualification target is already finalized and cannot prove new creation.')
  }
  const active = await store.getActiveMission()
  if (active !== null && active.id !== missionId) {
    throw new Error('A different active fixture mission prevents the isolated target lifecycle.')
  }
  if (mission.status === 'paused') mission = await store.resumeMission(missionId)
  if (mission.status === 'active') mission = await store.finishMission(missionId)
  if (mission.status !== 'finished') {
    throw new Error('The qualification target could not enter the finished state.')
  }
  return mission
}

/** Generates one high-entropy archive passphrase without retaining its entropy buffer. */
function createEphemeralPassphrase() {
  const entropy = randomBytes(32)
  try {
    return `pr6-${entropy.toString('base64url')}`
  } finally {
    zeroBuffer(entropy)
  }
}

/** Starts sequential current-position writes and immediate latest-position reads. */
function startCurrentPositionProbe({ store, missionId, deviceId, runId }) {
  const measurements = Object.fromEntries(QUALIFICATION_PHASES.map((phase) => [phase, {
    heartbeatGapsMs: [],
    currentCadencesMs: [],
    currentWrites: 0,
    visibleWrites: 0,
    lastVisibleAt: null,
  }]))
  let phase = null
  let timer = null
  let running = true
  let sequence = 0
  let lastTimestampMs = Date.now()
  let lastHeartbeatAt = performance.now()
  let activeTick = Promise.resolve()
  let failure = null

  /** Schedules the next non-overlapping probe turn. */
  const schedule = () => {
    if (!running) return
    timer = setTimeout(() => {
      activeTick = tick().finally(schedule)
    }, HEARTBEAT_INTERVAL_MS)
  }

  /** Writes one unique position and requires it to be immediately current. */
  const tick = async () => {
    const tickStartedAt = performance.now()
    const heartbeatGap = tickStartedAt - lastHeartbeatAt
    lastHeartbeatAt = tickStartedAt
    const tickPhase = phase
    if (tickPhase === null || failure !== null) return
    const bucket = measurements[tickPhase]
    bucket.heartbeatGapsMs.push(heartbeatGap)
    sequence += 1
    lastTimestampMs = Math.max(Date.now(), lastTimestampMs + 1)
    const sourcePositionId = `pr6-${runId}-${sequence}`
    try {
      await store.addPosition({
        mission_id: missionId,
        device_id: deviceId,
        source_position_id: sourcePositionId,
        lat: 53.000001,
        lon: -9.000001,
        timestamp: new Date(lastTimestampMs).toISOString(),
        timestamp_source: 'fix',
      })
      bucket.currentWrites += 1
      const current = await store.latestPositions(missionId)
      const visibleAt = performance.now()
      const visible = current.some((position) =>
        position.device_id === deviceId
        && position.source_position_id === sourcePositionId)
      if (!visible) throw new Error('The just-written probe position was not current.')
      bucket.visibleWrites += 1
      const currentCadence = Math.max(
        visibleAt - tickStartedAt,
        heartbeatGap,
        bucket.lastVisibleAt === null ? 0 : visibleAt - bucket.lastVisibleAt,
      )
      bucket.currentCadencesMs.push(currentCadence)
      bucket.lastVisibleAt = visibleAt
    } catch (error) {
      failure = error
    }
  }

  schedule()
  return Object.freeze({
    /** Moves later probe ticks onto one exact lifecycle phase. */
    setPhase(nextPhase) {
      if (!QUALIFICATION_PHASES.includes(nextPhase)) {
        throw new Error('Current-position probe phase is invalid.')
      }
      phase = nextPhase
    },
    /** Stops after the active tick and derives the closed liveness proof. */
    async stop() {
      running = false
      if (timer !== null) clearTimeout(timer)
      await activeTick
      if (failure !== null) throw failure
      const projected = Object.fromEntries(QUALIFICATION_PHASES.map((name) => [name, {
        heartbeatGapsMs: measurements[name].heartbeatGapsMs,
        currentCadencesMs: measurements[name].currentCadencesMs,
        currentWrites: measurements[name].currentWrites,
        visibleWrites: measurements[name].visibleWrites,
      }]))
      return deriveLivenessEvidence(projected)
    },
  })
}

/** Owns one heartbeat monitor and always stops it when the operation settles. */
export async function runWithHeartbeatMonitor(
  operation,
  monitorFactory = startHeartbeatMonitor,
) {
  if (typeof operation !== 'function' || typeof monitorFactory !== 'function') {
    throw new Error('Migration heartbeat ownership is invalid.')
  }
  const monitor = monitorFactory()
  if (monitor === null || typeof monitor !== 'object'
    || typeof monitor.stop !== 'function') {
    throw new Error('Migration heartbeat monitor is invalid.')
  }
  let result
  let heartbeatMaxGapMs
  try {
    result = await operation()
  } finally {
    heartbeatMaxGapMs = monitor.stop()
  }
  if (!Number.isFinite(heartbeatMaxGapMs) || heartbeatMaxGapMs < 0) {
    throw new Error('Migration heartbeat result is invalid.')
  }
  return Object.freeze({ result, heartbeatMaxGapMs })
}

/** Starts one timer-delay monitor that includes synchronous main-thread stalls. */
function startHeartbeatMonitor() {
  const gaps = []
  let last = performance.now()
  let stoppedMaxGapMs = null
  const timer = setInterval(() => {
    const current = performance.now()
    gaps.push(current - last)
    last = current
  }, HEARTBEAT_INTERVAL_MS)
  return Object.freeze({
    /** Stops and returns the measured maximum timer gap. */
    stop() {
      if (stoppedMaxGapMs !== null) return stoppedMaxGapMs
      clearInterval(timer)
      const final = performance.now()
      gaps.push(final - last)
      stoppedMaxGapMs = Math.max(...gaps)
      return stoppedMaxGapMs
    },
  })
}

/** Reads the durable registry row, seal receipt and complete stored verifier proof. */
function readStoredArchiveEvidence(databasePath, missionId, archiveId) {
  return withReadonlyDatabase(databasePath, (db) => {
    const row = db.prepare(`SELECT archive.*,
        predecessor.ciphertext_sha256 AS previous_archive_sha256
      FROM mission_archives AS archive
      LEFT JOIN mission_archives AS predecessor ON predecessor.id = archive.previous_archive_id
      WHERE archive.id = ? AND archive.mission_id = ?`).get(archiveId, missionId)
    if (row === undefined || typeof row.verification_proof_json !== 'string'
      || Buffer.byteLength(row.verification_proof_json, 'utf8') > 4 * 1024 * 1024) {
      throw new Error('The verified archive registry proof is unavailable.')
    }
    let proof
    let sealDetails
    try {
      proof = JSON.parse(row.verification_proof_json)
      const seal = db.prepare(`SELECT event_type, details_json FROM mission_events
        WHERE id = ? AND mission_id = ?`).get(row.sealed_event_id, missionId)
      if (seal?.event_type !== 'mission_archive_sealed_v2') throw new Error()
      sealDetails = JSON.parse(seal.details_json)
    } catch {
      throw new Error('The archive proof or seal receipt is invalid.')
    }
    if (!SHA256.test(sealDetails?.inventory_sha256 ?? '')) {
      throw new Error('The sealed archive inventory receipt is invalid.')
    }
    const mission = db.prepare('SELECT finish_time FROM missions WHERE id = ?').get(missionId)
    const archive = Object.freeze({
      archiveId: row.id,
      archiveKind: row.archive_kind,
      archiveRelativePath: row.relative_path,
      missionId: row.mission_id,
      requestEventRowid: Number(row.request_event_rowid),
      requestEventId: row.request_event_id,
      creationOperationId: row.creation_operation_id,
      protectedFinalizationEpoch: row.protected_finalization_epoch === null
        ? null
        : Number(row.protected_finalization_epoch),
      createdAt: row.created_at,
      previousArchiveSha256: row.previous_archive_sha256,
      containerVersion: Number(row.container_version),
      schemaVersion: Number(proof.schemaVersion),
      inventoryVersion: Number(proof.inventoryVersion),
      ciphertextSha256: row.ciphertext_sha256,
      sizeBytes: Number(row.size_bytes),
      frameCount: Number(row.frame_count),
      headerSha256: row.header_sha256,
      manifestSha256: row.manifest_sha256,
      inventorySha256: sealDetails.inventory_sha256,
      entryCount: Number(row.entry_count),
      tableCount: Number(row.table_count),
      status: row.status,
      availability: row.availability,
    })
    const proofSha256 = createHash('sha256')
      .update(canonicalJson(proof), 'utf8').digest('hex')
    return Object.freeze({
      archive,
      completeness: Object.freeze({
        verificationProofSha256: proofSha256,
        verificationProof: proof,
      }),
      selectedTime: mission?.finish_time ?? row.created_at,
    })
  })
}

/** Creates the same registry-bound archive-review manager owned by Electron main. */
function createReviewManager({ store, reviewRoot, archiveDirectory }) {
  return createArchiveReviewSessionManager({
    reviewRoot,
    archiveDirectory,
    registry: {
      issueReviewTicket: (archiveId) => store.issueMissionArchiveReviewTicket(archiveId),
      recordReviewOpened: (input) => store.recordMissionArchiveReviewOpened(input),
      recordReviewClosed: (input) => store.recordMissionArchiveReviewClosed(input),
      recordReviewMutationDenied: (input) =>
        store.recordMissionArchiveReviewMutationDenied(input),
    },
  })
}

/** Opens one permission-restricted archive session, reads Replay, denies mutation and sweeps. */
async function runReviewProof({
  manager,
  databasePath,
  reviewRoot,
  archive,
  missionId,
  selectedTime,
  timezone,
  passphrase,
  recoveryCode,
}) {
  const senderId = 6_012
  let session = null
  try {
    session = await manager.open({
      senderId,
      request: {
        operationId: randomUUID(),
        archiveId: archive.archiveId,
        containerVersion: 2,
        slotType: 'passphrase',
      },
      secret: passphrase,
      onProgress: () => undefined,
    })
    await assertPermissionRestrictedReviewTree(reviewRoot, session.sessionId)
    const openScan = await scanEvidenceRoots({
      roots: [{ label: 'archive-review-sessions', rootPath: reviewRoot }],
      secrets: [passphrase, recoveryCode],
      privacyCanary: missionId,
    })
    if (openScan.filesScanned < 1 || openScan.privacyMatches.length < 1
      || openScan.secretMatches.length > 0 || openScan.unreadableFiles.length > 0) {
      throw new Error('Open archive Review residual classification failed.')
    }
    const info = await manager.read({
      senderId,
      sessionId: session.sessionId,
      method: 'info',
      args: [],
    })
    if (info?.read_only !== true || info?.mission_id !== missionId) {
      throw new Error('Archive Review did not expose an immutable read-only source.')
    }
    const replay = await manager.read({
      senderId,
      sessionId: session.sessionId,
      method: 'readMissionReplay',
      args: [{
        missionId,
        selectedTime,
        timezone,
        trackLimit: 1,
        objectLimit: 1,
      }, randomUUID()],
    })
    const replayDigest = createHash('sha256')
      .update(canonicalJson(replay), 'utf8').digest('hex')
    const auditBefore = countMissionEvent(
      databasePath,
      missionId,
      'mission_archive_review_mutation_denied',
    )
    let mutationDenied = false
    try {
      await manager.read({
        senderId,
        sessionId: session.sessionId,
        method: 'createMission',
        args: [{ name: 'denied' }],
      })
    } catch (error) {
      mutationDenied = error?.code === 'ARCHIVE_REVIEW_READ_ONLY'
        && error?.denialAudited === true
    }
    const auditAfter = countMissionEvent(
      databasePath,
      missionId,
      'mission_archive_review_mutation_denied',
    )
    if (!mutationDenied || auditAfter !== auditBefore + 1) {
      throw new Error('Archive Review mutation denial was not durably audited.')
    }
    await manager.close({ senderId, sessionId: session.sessionId })
    session = null
    const closedScan = await scanEvidenceRoots({
      roots: [{ label: 'archive-review-sessions', rootPath: reviewRoot }],
      secrets: [passphrase, recoveryCode],
      privacyCanary: missionId,
    })
    const plaintextSweptAfterClose = closedScan.appAddressablePlaintextFiles.length === 0
      && closedScan.unreadableFiles.length === 0
      && closedScan.secretMatches.length === 0
      && closedScan.privacyMatches.length === 0
    if (!plaintextSweptAfterClose) {
      throw new Error('Archive Review plaintext was not swept after close.')
    }
    return Object.freeze({
      opened: true,
      readOnly: true,
      mutationDenied: true,
      replayPageCount: 1,
      replayDigest,
      openResidualFileCount: openScan.filesScanned,
      openPrivacyCanaryDetected: true,
      closed: true,
      plaintextSweptAfterClose: true,
    })
  } finally {
    if (session !== null) {
      await manager.close({ senderId, sessionId: session.sessionId }).catch(() => undefined)
    }
  }
}

/** Requires 0700 directories, 0600 regular files and no links in one open review session. */
async function assertPermissionRestrictedReviewTree(reviewRoot, sessionId) {
  const rootStat = await lstat(reviewRoot)
  const sessionRoot = path.join(reviewRoot, sessionId)
  const sessionStat = await lstat(sessionRoot)
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()
    || (rootStat.mode & 0o777) !== 0o700
    || !sessionStat.isDirectory() || sessionStat.isSymbolicLink()
    || (sessionStat.mode & 0o777) !== 0o700) {
    throw new Error('Archive Review plaintext directories are not permission restricted.')
  }
  await walkPermissionRestricted(sessionRoot)
}

/** Recursively enforces exact archive-review residual permissions. */
async function walkPermissionRestricted(directoryPath) {
  const entries = await readdir(directoryPath, { withFileTypes: true })
  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry.name)
    const stat = await lstat(entryPath)
    if (stat.isSymbolicLink()) throw new Error('Archive Review residual contains a link.')
    if (stat.isDirectory()) {
      if ((stat.mode & 0o777) !== 0o700) {
        throw new Error('Archive Review residual directory mode is unsafe.')
      }
      await walkPermissionRestricted(entryPath)
    } else if (!stat.isFile() || (stat.mode & 0o777) !== 0o600) {
      throw new Error('Archive Review residual file mode is unsafe.')
    }
  }
}

/** Counts one exact retained review-audit type from a query-only connection. */
function countMissionEvent(databasePath, missionId, eventType) {
  return withReadonlyDatabase(databasePath, (db) => Number(db.prepare(`SELECT COUNT(*) AS count
    FROM mission_events WHERE mission_id = ? AND event_type = ?`).get(
    missionId,
    eventType,
  ).count))
}

/** Proves every terminal journal-planned mission selection is empty after cleanup. */
function readCleanupProof({ databasePath, missionId, archiveId }) {
  return withReadonlyDatabase(databasePath, (db) => {
    const row = db.prepare(`SELECT archive_id, state, progress_json
      FROM mission_cleanup_journal WHERE mission_id = ?`).get(missionId)
    const declarations = listArchiveInventoryForSchema(13)
    const expectedTables = declarations.filter((entry) => (
      entry.decision === 'mission_rows'
        && !RETAINED_CLEANUP_MISSION_TABLES.has(entry.tableName)
    ) || (
      entry.decision === 'derived_excluded'
        && tableHasColumn(db, entry.tableName, 'mission_id')
    ) || (
      entry.decision === 'operational_excluded'
        && QUALIFICATION_CLEANUP_OPERATIONAL_TABLES.has(entry.tableName)
    )).map((entry) => entry.tableName)
    const journal = parseTerminalCleanupJournal(row, archiveId, expectedTables)
    let remainingRows = 0
    for (const tableName of journal.tables) {
      const declaration = declarations.find((candidate) => candidate.tableName === tableName)
      if (declaration === undefined) {
        throw new Error('Cleanup journal names an undeclared schema table.')
      }
      let whereSql
      let parameters
      if (declaration.decision === 'mission_rows') {
        const selection = createArchiveTableSelection({
          tableName,
          missionId,
          schemaVersion: 13,
        })
        whereSql = selection.whereSql
        parameters = selection.parameters
      } else if (['derived_excluded', 'operational_excluded'].includes(declaration.decision)
        && tableHasColumn(db, tableName, 'mission_id')) {
        whereSql = 'archive_row."mission_id" = ?'
        parameters = [missionId]
      } else {
        throw new Error('Cleanup journal table has no mission-scoped zero-check selection.')
      }
      const count = Number(db.prepare(`SELECT COUNT(*) AS count
        FROM ${quoteIdentifier(tableName)} AS archive_row
        WHERE ${whereSql}`).get(...parameters).count)
      if (!Number.isSafeInteger(count) || count < 0) {
        throw new Error('Cleanup row-count proof is invalid.')
      }
      remainingRows += count
    }
    const mission = db.prepare('SELECT status FROM missions WHERE id = ?').get(missionId)
    const archive = db.prepare(`SELECT status, availability FROM mission_archives
      WHERE id = ? AND mission_id = ?`).get(archiveId, missionId)
    return Object.freeze({
      remainingRows,
      retainedMissionStub: mission?.status === 'finalized',
      retainedArchiveRegistry: archive?.status === 'verified'
        && archive?.availability === 'present',
    })
  })
}

/** Returns whether one declared table has a named column. */
function tableHasColumn(db, tableName, columnName) {
  return db.prepare(`PRAGMA table_info(${quoteIdentifier(tableName)})`).all()
    .some((column) => column.name === columnName)
}

/** Quotes one declaration-owned SQLite identifier. */
function quoteIdentifier(value) {
  if (!SAFE_TABLE.test(value)) throw new Error('Schema table identity is unsafe.')
  return `"${value}"`
}

/** Reopens store/review ownership and proves automatic startup plaintext sweeps. */
async function proveRestartSweeps({
  profileRoot,
  reviewRoot,
  archiveDirectory,
  missionId,
  archiveId,
}) {
  const restartedStore = createElectronMissionStore({ userDataPath: profileRoot })
  const restartedManager = createReviewManager({
    store: restartedStore,
    reviewRoot,
    archiveDirectory,
  })
  try {
    await restartedManager.sweepStartup()
    await waitForStartupPlaintextSweep(archiveDirectory, reviewRoot, profileRoot)
    const mission = await restartedStore.getMission(missionId)
    const archives = await restartedStore.listMissionArchives(missionId)
    if (mission.storage_state !== 'archived'
      || !archives.some((archive) => archive.id === archiveId
        && archive.status === 'verified' && archive.availability === 'present')) {
      throw new Error('Restart did not retain the archived mission and verified custody.')
    }
  } finally {
    await restartedManager.prepareClose().catch(() => undefined)
    await restartedStore.prepareClose().catch(() => undefined)
    try { restartedStore.close() } catch {}
  }
}

/** Waits for startup sweeps to empty each app-addressable plaintext root. */
async function waitForStartupPlaintextSweep(archiveDirectory, reviewRoot, profileRoot) {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    const scan = await scanEvidenceRoots({
      roots: residueRoots(archiveDirectory, reviewRoot),
      secrets: [],
      privacyCanary: null,
    })
    const failure = withReadonlyDatabase(path.join(profileRoot, DATABASE_FILE_NAME), (db) =>
      db.prepare(`SELECT 1 FROM metadata
        WHERE key = 'archive_plaintext_sweep_failure'`).get() !== undefined)
    if (!failure && scan.unreadableFiles.length === 0
      && scan.appAddressablePlaintextFiles.length === 0) return
    await delay(HEARTBEAT_INTERVAL_MS)
  }
  throw new Error('Startup did not sweep app-addressable archive plaintext.')
}

/** Returns the three truthful app-addressable plaintext roots and evidence labels. */
function residueRoots(archiveDirectory, reviewRoot) {
  return [
    { label: 'archive-staging', rootPath: path.join(archiveDirectory, '.staging') },
    { label: 'verification-scratch', rootPath: path.join(archiveDirectory, '.verification') },
    { label: 'archive-review-sessions', rootPath: reviewRoot },
  ]
}

/** Measures the exact production scrypt profile and overwrites all mutable key material. */
async function measureProductionKdf() {
  if (canonicalJson(SARARCH2_SCRYPT_PROFILE) !== canonicalJson(REQUIRED_SCRYPT_PROFILE)) {
    throw new Error('The runtime scrypt profile differs from the qualification contract.')
  }
  const secret = randomBytes(32)
  const salt = randomBytes(SARARCH2_SCRYPT_PROFILE.saltBytes)
  let derived = null
  const startedAt = performance.now()
  try {
    derived = await deriveSlotKey({ secret, salt, profile: SARARCH2_SCRYPT_PROFILE })
    return Object.freeze({
      measuredOnHost: true,
      profile: { ...SARARCH2_SCRYPT_PROFILE },
      durationMs: performance.now() - startedAt,
    })
  } finally {
    if (derived !== null) zeroBuffer(derived)
    zeroBuffer(secret)
    zeroBuffer(salt)
  }
}

/** Traverses one logical evidence root and scans every regular file. */
async function scanNamedRoot(root, secrets, privacyPatterns, result) {
  let rootStat
  try {
    rootStat = await lstat(root.rootPath)
  } catch (error) {
    if (error?.code === 'ENOENT') return
    result.unreadableFiles.push(root.label)
    return
  }
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    result.unreadableFiles.push(root.label)
    return
  }
  await scanDirectory(root, '', secrets, privacyPatterns, result)
}

/** Recursively scans one directory without following symbolic links. */
async function scanDirectory(root, relativeDirectory, secrets, privacyPatterns, result) {
  const directoryPath = relativeDirectory === ''
    ? root.rootPath
    : path.join(root.rootPath, ...relativeDirectory.split('/'))
  let entries
  try {
    entries = await readdir(directoryPath, { withFileTypes: true })
  } catch {
    result.unreadableFiles.push(logicalPath(root.label, relativeDirectory))
    return
  }
  entries.sort((left, right) => left.name.localeCompare(right.name, 'en'))
  for (const entry of entries) {
    const relativePath = relativeDirectory === ''
      ? entry.name
      : `${relativeDirectory}/${entry.name}`
    const entryPath = path.join(root.rootPath, ...relativePath.split('/'))
    let stat
    try { stat = await lstat(entryPath) } catch {
      result.unreadableFiles.push(logicalPath(root.label, relativePath))
      continue
    }
    if (stat.isSymbolicLink()) {
      result.unreadableFiles.push(logicalPath(root.label, relativePath))
    } else if (stat.isDirectory()) {
      await scanDirectory(root, relativePath, secrets, privacyPatterns, result)
    } else if (stat.isFile()) {
      await scanRegularEvidenceFile(
        entryPath,
        logicalPath(root.label, relativePath),
        secrets,
        privacyPatterns,
        result,
      )
    } else {
      result.unreadableFiles.push(logicalPath(root.label, relativePath))
    }
  }
}

/** Streams one regular file while retaining only exact-pattern match booleans. */
async function scanRegularEvidenceFile(
  filePath,
  logicalName,
  secrets,
  privacyPatterns,
  result,
) {
  const pinned = await openPinnedRegularFile(filePath, null, 'scan file').catch(() => null)
  if (pinned === null) {
    result.unreadableFiles.push(logicalName)
    return
  }
  const patterns = [...secrets, ...privacyPatterns].map((value) => Buffer.from(value, 'utf8'))
  const maximumPatternBytes = Math.max(1, ...patterns.map((value) => value.byteLength))
  let carry = Buffer.alloc(0)
  let secretMatched = false
  let privacyMatched = false
  let scannedBytes = 0
  try {
    for await (const chunk of pinned.handle.createReadStream({
      start: 0,
      autoClose: false,
      highWaterMark: SCAN_CHUNK_BYTES,
    })) {
      scannedBytes += chunk.byteLength
      const window = carry.length === 0 ? chunk : Buffer.concat([carry, chunk])
      if (!secretMatched) {
        secretMatched = secrets.some((value) => window.includes(Buffer.from(value, 'utf8')))
      }
      if (!privacyMatched) {
        privacyMatched = privacyPatterns.some((value) =>
          window.includes(Buffer.from(value, 'utf8')))
      }
      carry = window.subarray(Math.max(0, window.byteLength - maximumPatternBytes + 1))
    }
  } catch {
    result.unreadableFiles.push(logicalName)
    return
  } finally {
    await pinned.handle.close().catch(() => undefined)
  }
  result.filesScanned += 1
  result.bytesScanned += scannedBytes
  result.appAddressablePlaintextFiles.push(logicalName)
  if (secretMatched) result.secretMatches.push(logicalName)
  if (privacyMatched) result.privacyMatches.push(logicalName)
}

/** Joins one logical root and POSIX relative path without leaking host paths. */
function logicalPath(label, relativePath) {
  return relativePath === '' ? label : `${label}/${relativePath}`
}

/** Opens one query-only SQLite snapshot for a bounded synchronous read. */
function withReadonlyDatabase(databasePath, read) {
  const db = new Database(databasePath, { readonly: true, fileMustExist: true })
  try {
    db.pragma('query_only = ON')
    db.pragma('busy_timeout = 5000')
    return read(db)
  } finally {
    db.close()
  }
}

/** Starts conservative whole-process RSS sampling, including worker-thread allocations. */
function startRssSampler() {
  const samples = [process.memoryUsage().rss]
  let stopped = null
  const timer = setInterval(() => samples.push(process.memoryUsage().rss), HEARTBEAT_INTERVAL_MS)
  return Object.freeze({
    /** Stops once and returns the conservative RSS/VmHWM upper bound. */
    async stop() {
      if (stopped !== null) return stopped
      clearInterval(timer)
      samples.push(process.memoryUsage().rss)
      const baselineProcessRssBytes = samples[0]
      const linuxVmHwmBytes = await readLinuxVmHwmBytes()
      const peakProcessRssBytes = Math.max(linuxVmHwmBytes, ...samples)
      stopped = Object.freeze({
        measurement: 'whole_process_rss_conservative_worker_upper_bound',
        baselineProcessRssBytes,
        peakProcessRssBytes,
        peakDeltaBytes: peakProcessRssBytes - baselineProcessRssBytes,
        linuxVmHwmBytes,
        sampleCount: samples.length,
      })
      if (peakProcessRssBytes > MAX_ARCHIVE_PROCESS_RSS_BYTES) {
        throw new Error('The whole-process archive lifecycle exceeded the 512 MiB RSS gate.')
      }
      return stopped
    },
  })
}

/** Reads Linux's process high-water RSS as bytes. */
async function readLinuxVmHwmBytes() {
  const handle = await open('/proc/self/status', fsConstants.O_RDONLY)
  try {
    const contents = await handle.readFile('utf8')
    const match = /^VmHWM:\s+(\d+)\s+kB$/mu.exec(contents)
    const kibibytes = Number(match?.[1])
    if (!Number.isSafeInteger(kibibytes) || kibibytes < 1) {
      throw new Error('Linux VmHWM evidence is unavailable.')
    }
    return kibibytes * 1024
  } finally {
    await handle.close()
  }
}

/** Reads exact Git HEAD/tree/clean identity without mutating the repository. */
async function readRepositorySourceState() {
  const [{ stdout: head }, { stdout: tree }, { stdout: status }] = await Promise.all([
    execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: projectRoot }),
    execFileAsync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: projectRoot }),
    execFileAsync('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
      cwd: projectRoot,
      maxBuffer: 16 * 1024 * 1024,
    }),
  ])
  return Object.freeze({
    head: head.trim(),
    tree: tree.trim(),
    clean: status.trim() === '',
  })
}

/** Requires one clean exact source head before expensive qualification. */
function assertExactSourceState(source, expectedHead) {
  if (source.head !== expectedHead || !/^[0-9a-f]{40}$/u.test(source.tree) || !source.clean) {
    throw new Error('Qualification requires the clean exact expected repository head and tree.')
  }
}

/** Requires HEAD/tree/clean state to remain exactly unchanged after qualification. */
function assertSameExactSource(before, after) {
  if (after.head !== before.head || after.tree !== before.tree || !after.clean) {
    throw new Error('Repository source identity changed during qualification.')
  }
}

/** Prevents the evidence output itself from making an in-repository source dirty. */
async function assertEvidenceDestinationSourceNeutral(evidencePath) {
  if (!isPathInside(evidencePath, projectRoot)) return
  const relative = path.relative(projectRoot, evidencePath)
  try {
    await execFileAsync('git', ['check-ignore', '-q', '--', relative], { cwd: projectRoot })
  } catch {
    throw new Error('In-repository qualification evidence must be written below an ignored path.')
  }
}

/** Creates and validates the evidence parent without accepting symlink indirection. */
async function prepareEvidenceDestination(evidencePath) {
  const parent = path.dirname(evidencePath)
  await mkdir(parent, { recursive: true, mode: 0o700 })
  const parentStat = await lstat(parent)
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink()
    || await realpath(parent) !== parent) {
    throw new Error('Qualification evidence parent is unsafe.')
  }
  try {
    await lstat(evidencePath)
    throw new Error('Qualification evidence already exists.')
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
}

/** Allocates one marker-owned disposable mode-0700 qualification profile. */
async function createOwnedProfileRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sartracker-breadcrumb-pr6-qualification-'))
  await chmod(root, 0o700)
  const marker = await open(path.join(root, PROFILE_MARKER), 'wx', 0o600)
  try {
    await marker.writeFile('owned\n', 'utf8')
    await marker.sync()
  } finally {
    await marker.close()
  }
  return root
}

/** Removes only this runner's narrow marker-owned disposable profile. */
async function removeOwnedProfileRoot(root) {
  if (!isPathInside(root, path.resolve(os.tmpdir()))
    || root === path.resolve(os.tmpdir())
    || !path.basename(root).startsWith('sartracker-breadcrumb-pr6-qualification-')) {
    throw new Error('Qualification profile cleanup target is unsafe.')
  }
  const markerPath = path.join(root, PROFILE_MARKER)
  let markerStat
  try { markerStat = await lstat(markerPath) } catch (error) {
    if (error?.code === 'ENOENT') return
    throw error
  }
  if (!markerStat.isFile() || markerStat.isSymbolicLink()) {
    throw new Error('Qualification profile lost its ownership marker.')
  }
  await rm(root, { recursive: true, force: false, maxRetries: 5, retryDelay: 50 })
}

/** Requires at least 20 GiB free on the disposable profile filesystem. */
async function assertMinimumFreeSpace(profileRoot) {
  const filesystem = await statfs(profileRoot)
  const availableBytes = Number(filesystem.bavail) * Number(filesystem.bsize)
  if (!Number.isSafeInteger(availableBytes) || availableBytes < MINIMUM_FREE_BYTES) {
    throw new Error('The reference host has less than the fixed 20 GiB free-space preflight.')
  }
}

/** Returns the host's bounded IANA timezone for Replay equality. */
function resolvedTimezone() {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
  if (typeof timezone !== 'string' || timezone.length < 1
    || Buffer.byteLength(timezone, 'utf8') > 128) {
    throw new Error('The reference-host timezone is unavailable.')
  }
  return timezone
}

/** Rejects absolute paths and exact ephemeral secrets anywhere in evidence JSON. */
function assertEvidencePayloadSafe(evidence, forbiddenValues) {
  const serialized = JSON.stringify(evidence)
  if (forbiddenValues.some((value) =>
    typeof value === 'string' && value.length > 0 && serialized.includes(value))) {
    throw new Error('Qualification evidence contains a private path or ephemeral secret.')
  }
}

/** Returns whether one absolute candidate is equal to or nested below an absolute root. */
function isPathInside(candidate, root) {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`)
}

/** Waits one bounded event-loop interval. */
function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

const directlyExecuted = process.argv[1] !== undefined
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (directlyExecuted) {
  await main().catch(() => {
    process.stderr.write('Breadcrumb PR6 qualification failed safely.\n')
    process.exitCode = 1
  })
}
