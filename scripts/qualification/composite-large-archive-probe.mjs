#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { createRequire } from 'node:module'
import { execFile as execFileCallback } from 'node:child_process'
import {
  access,
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  statfs,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'
import { pipeline as pipelineCallback } from 'node:stream'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

import { _electron as electron } from 'playwright'
import { generateMissionStoreFixture } from '../../build/seed-mission-store-runtime.js'
import { hashCandidateFile } from './candidate-artifacts.mjs'
import { inspectStandaloneSqliteFixture } from './sqlite-fixture.mjs'
import { compareArchiveDatabaseSnapshots } from './archive-field-oracle.mjs'
import { createCompositeSourceManifest } from './composite-manifest.mjs'
import { ARCHIVE_FIELD_MIN_BYTES, assertArchiveFieldManifest, assertArchiveFieldInventory, selectArchiveFieldSource } from './archive-field-source.mjs'

const execFile = promisify(execFileCallback)
const pipeline = promisify(pipelineCallback)
const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

export const FIELD_ARCHIVE_VARIANT = 'field-archive-37gb'
export const ARCHIVE_SOURCE_MIN_BYTES = ARCHIVE_FIELD_MIN_BYTES
export const ARCHIVE_CIPHERTEXT_MIN_BYTES = 3_500_000_000
export const ARCHIVE_MIN_FREE_SPACE_BYTES = 64 * 1024 ** 3
export const ARCHIVE_CONTAINER_VERSION = 2
export const ARCHIVE_LIFECYCLE_ALLOWLIST = Object.freeze([
  'mission_events', 'mission_archives', 'mission_archive_supplements', 'mission_cleanup_journal',
  'mission_finalization_fences', 'mission_replay_generations',
])
const SHA1 = /^[a-f0-9]{40}$/u
const SHA256 = /^[a-f0-9]{64}$/u
const PASS_PHRASE = 'C20-C22-Field-Archive-37GB-9!x'

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`qualification-composite-large-archive: ${sanitizeError(error)}`)
    process.exitCode = 1
  })
}

/** Parse the fixed large-archive command contract. */
export function parseArgs(argv) {
  if (!Array.isArray(argv)) throw new TypeError('Arguments must be an array.')
  const values = {}
  const names = new Set(['--app', '--evidence', '--expected-head', '--variant'])
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index]
    if (!names.has(name)) throw new Error(`Unknown large-archive-probe argument: ${name}`)
    if (Object.hasOwn(values, name)) throw new Error(`Duplicate large-archive-probe argument: ${name}`)
    const value = argv[index + 1]
    if (typeof value !== 'string' || value === '' || value.startsWith('--')) {
      throw new Error(`Large archive probe requires ${name} followed by a value.`)
    }
    values[name] = value
    index += 1
  }
  for (const name of ['--app', '--evidence', '--expected-head']) {
    if (!Object.hasOwn(values, name)) throw new Error(`Large archive probe requires ${name}.`)
  }
  for (const name of ['--app', '--evidence']) {
    if (!path.isAbsolute(values[name])) throw new Error(`Large archive probe requires an absolute ${name} path.`)
  }
  if (!SHA1.test(values['--expected-head'])) throw new Error('Large archive probe --expected-head must be one SHA-1.')
  const variant = values['--variant'] ?? FIELD_ARCHIVE_VARIANT
  if (variant !== FIELD_ARCHIVE_VARIANT) throw new Error(`Large archive probe has a fixed field archive variant: ${FIELD_ARCHIVE_VARIANT}.`)
  return Object.freeze({
    appPath: path.resolve(values['--app']),
    evidencePath: path.resolve(values['--evidence']),
    expectedHead: values['--expected-head'],
    variant,
  })
}

/** Validate concrete large-archive facts without trusting aggregate producer flags. */
export function validateLargeArchiveProducerReceipt(report, expected) {
  const failures = []
  if (!isObject(report) || report.schemaVersion !== 1 || report.proofKind !== 'packaged-large-archive-v1'
      || report.contractId !== 'C20-C22' || report.variantId !== FIELD_ARCHIVE_VARIANT) {
    failures.push('The report is not the reviewed C20/C22 field archive schema.')
  }
  const evidencePath = isObject(expected) && typeof expected.evidencePath === 'string' ? path.resolve(expected.evidencePath) : null
  const expectedAppPath = isObject(expected) && typeof expected.appPath === 'string' ? path.resolve(expected.appPath) : null
  const expectedHead = isObject(expected) && typeof expected.sourceHead === 'string' ? expected.sourceHead : null
  if (expectedAppPath !== null && report?.app?.path !== expectedAppPath) failures.push('The runtime executable differs from the expected --app binding.')
  if (expectedHead !== null && report?.source?.expectedHead !== expectedHead) failures.push('The source expected head differs from the controller binding.')
  if (!SHA1.test(report?.source?.head ?? '') || report.source.head !== report.source.observedHead
      || !SHA1.test(report?.source?.expectedHead ?? '') || report.source.observedHead !== report.source.expectedHead
      || report.source.dirty !== false || !Array.isArray(report?.source?.manifest) || report.source.manifest.length === 0) {
    failures.push('Source identity is incomplete or changed during the run.')
  }
  if (!SHA256.test(report?.app?.sha256 ?? '') || !Number.isSafeInteger(report?.app?.sizeBytes) || report.app.sizeBytes < 1
      || typeof report?.app?.path !== 'string' || !path.isAbsolute(report.app.path)) {
    failures.push('Executable identity is incomplete.')
  }
  if (report?.run?.proofMode !== 'packaged-electron' && report?.run?.proofMode !== 'development-electron') {
    failures.push('Runtime proof mode is missing.')
  }
  if (!isObject(report?.runtime) || report.runtime.executablePath !== report?.app?.path
      || !SHA256.test(report.runtime.executableSha256 ?? '') || report.runtime.executableSha256 !== report.app.sha256
      || (report.runtime.proofMode === 'packaged-electron' && (!report.runtime.asarPath?.endsWith('.asar') || !SHA256.test(report.runtime.asarSha256 ?? '')))) {
    failures.push('Runtime executable/asar identity is not retained independently.')
  }
  if (report?.run?.proofMode === 'packaged-electron'
      && (!report.app.packagedAppPath?.endsWith('.asar') || !SHA256.test(report.app.packagedAppSha256 ?? ''))) {
    failures.push('Packaged proof is missing the actual app.asar identity.')
  }
  if (report?.invocation?.networkBlocked !== true || report?.profile?.usedSystemUserProfile !== false
      || !Array.isArray(report?.profile?.observedUserDataPaths)
      || report.profile.observedUserDataPaths.some((value) => value !== report.profile.path)) {
    failures.push('The disposable profile or network boundary is not independently bound.')
  }
  if (!isObject(report?.preflight) || report.preflight.minFreeBytes !== ARCHIVE_MIN_FREE_SPACE_BYTES
      || !Number.isSafeInteger(report.preflight.availableBytes) || report.preflight.availableBytes < ARCHIVE_MIN_FREE_SPACE_BYTES) {
    failures.push('The conservative 64GiB free-space preflight was not retained.')
  }
  validateFixture(report?.sourceFixture, evidencePath, failures)
  validateSnapshot(report?.preArchive, evidencePath, 'prearchive', failures)
  validateSourceTransition(report?.sourceToPreArchive, report?.sourceFixture, report?.preArchive, evidencePath, failures)
  validateArchive(report?.archive, evidencePath, failures)
  validateRestore(report?.reviewRestore, report?.preArchive, evidencePath, failures)
  if (!isObject(report?.mission?.startupRecovery) || report.mission.startupRecovery.missionId !== report.mission.missionId
      || report.mission.startupRecovery.sourceStatus !== 'active' || !['active', 'paused'].includes(report.mission.startupRecovery.observedStatus)
      || report.mission.startupRecovery.implicitResume !== false) failures.push('Startup recovery mission identity is missing.')
  if (!isObject(report?.inventory) || report.inventory.missionId !== report?.mission?.missionId
      || !Array.isArray(report.inventory.tables) || report.inventory.tables.length === 0) failures.push('Independent prearchive/restored inventory is missing.')
  validateCleanup(report?.cleanup, failures)
  if (!Array.isArray(report?.gaps) || report.gaps.length !== 0) failures.push('The fixed large archive workload has producer gaps.')
  const uniqueFailures = [...new Set(failures)]
  return Object.freeze({
    contractId: 'C20-C22', variantId: FIELD_ARCHIVE_VARIANT,
    status: uniqueFailures.length === 0 ? 'PASS' : 'INVALID_EVIDENCE',
    valid: uniqueFailures.length === 0,
    complete: uniqueFailures.length === 0,
    releaseEligible: false,
    failureReasons: Object.freeze(uniqueFailures),
  })
}

/** Run the actual field fixture archive, review, restore, and cleanup path. */
export async function runLargeArchiveProbe(input) {
  const options = normalizeInput(input)
  await access(options.appPath)
  await mkdir(options.evidencePath, { recursive: true, mode: 0o700 })
  const preflight = await checkFreeSpace(options.evidencePath)
  const sourceBefore = await readSourceState()
  if (sourceBefore.head !== options.expectedHead) throw new Error('Large archive probe source head does not match --expected-head.')
  const sourceManifest = await createCompositeSourceManifest(projectRoot)
  const appIdentity = await hashCandidateFile(options.appPath)
  const profilePath = path.join(options.evidencePath, '.profile-field-archive-37gb')
  await rm(profilePath, { recursive: true, force: true })
  await mkdir(profilePath, { recursive: true, mode: 0o700 })
  const startedAt = Date.now()
  const network = { blocked: true, httpRequests: 0, httpsRequests: 0 }
  const observedUserDataPaths = []
  const stderrChunks = []
  const cleanup = {
    closeAttempted: false, closeSucceeded: false,
    profileRemovalAttempted: false, profileRemoved: false,
    applicationClosed: false, reviewClosed: false, plaintextRemoved: false, failure: null,
  }
  let launch = null
  let page = null
  let missionId = null
  let result = null
  try {
    const sourceFixture = await prepareFieldFixture(options.evidencePath, profilePath)
    launch = await launchPackaged(options.appPath, profilePath, options.developmentTestHarness === true)
    attachStderr(launch, stderrChunks)
    page = await launch.firstWindow()
    attachNetworkEgressCounter(page, network)
    observedUserDataPaths.push(await launch.evaluate(({ app }) => app.getPath('userData')))
    await page.getByTestId('app-title').waitFor({ timeout: 30_000 })
    const packagedAppPath = await launch.evaluate(({ app }) => app.getAppPath())
    if (options.developmentTestHarness !== true && (!packagedAppPath.endsWith('.asar'))) {
      throw new Error('Large archive probe did not launch an app.asar package.')
    }
    missionId = sourceFixture.inventory.primary.id
    const runtimeMission = await page.evaluate(async (id) => window.sartrackerElectron?.missionStore?.getMission(id), missionId)
    if (runtimeMission?.id !== missionId || !['active', 'paused'].includes(runtimeMission.status)) {
      throw new Error(`Field archive mission differs from the independently inspected source mission, observed ${String(runtimeMission?.status)}.`)
    }
    const startupRecovery = {
      missionId,
      sourceStatus: sourceFixture.sourceMission.status,
      observedStatus: runtimeMission.status,
      startupPauseObserved: runtimeMission.status === 'paused',
      implicitResume: false,
    }
    const finished = await page.evaluate(async (id) => window.sartrackerElectron?.missionStore?.finishMission(id), missionId)
    if (finished?.status !== 'finished') throw new Error('Field archive mission did not finish through the production preload.')
    const preArchive = await snapshotDatabase(page, options.evidencePath, 'prearchive-mission-store.sqlite', 'C20 prearchive snapshot')
    const preArchiveMission = await readMissionRow(preArchive.databasePath, missionId)
    const sourceToPreArchive = describeMissionTransition(sourceFixture.sourceMission, preArchiveMission, sourceFixture.privateCopyPath, preArchive.databasePath)
    if (sourceToPreArchive.unexpectedChangedFields.length > 0) {
      throw new Error(`Finishing the field source changed unexpected mission fields: ${sourceToPreArchive.unexpectedChangedFields.join(', ')}`)
    }
    const finalized = await finalizeArchive(page, missionId)
    const archiveIdentity = await hashCandidateFile(finalized.archivePath)
    if (archiveIdentity.bytes !== finalized.registrySizeBytes || archiveIdentity.sha256 !== finalized.registrySha256) {
      throw new Error('Final archive bytes differ from the verified registry identity.')
    }
    if (archiveIdentity.bytes < ARCHIVE_CIPHERTEXT_MIN_BYTES) {
      throw new Error(`Final ciphertext is ${archiveIdentity.bytes} bytes; required minimum is ${ARCHIVE_CIPHERTEXT_MIN_BYTES}.`)
    }
    const retainedCiphertextPath = path.join(options.evidencePath, 'ciphertext', `${finalized.archiveId}.sararch`)
    const retainedCiphertext = await copyVerified(archiveIdentity.path, retainedCiphertextPath)
    const reviewRestore = await runArchiveReviewAndRestore(page, missionId, finalized.archiveId)
    cleanup.reviewClosed = reviewRestore.sessionClosed === true
    cleanup.plaintextRemoved = reviewRestore.plaintextCleanupComplete === true
    const restored = await snapshotDatabase(page, options.evidencePath, 'restored-mission-store.sqlite', 'C20 restored snapshot')
    const inventory = await compareArchiveDatabaseSnapshots({ beforePath: preArchive.databasePath, afterPath: restored.databasePath, missionId })
    projectInventoryDigests(preArchive, restored, inventory)
    const sourceAfter = await readSourceState()
    if (sourceAfter.head !== options.expectedHead || sourceAfter.dirty !== sourceBefore.dirty) {
      throw new Error('Source identity changed during the large archive run.')
    }
    result = {
      schemaVersion: 1,
      proofKind: 'packaged-large-archive-v1',
      contractId: 'C20-C22',
      variantId: FIELD_ARCHIVE_VARIANT,
      developmentTestHarness: options.developmentTestHarness,
      source: { head: sourceBefore.head, expectedHead: options.expectedHead, observedHead: sourceBefore.head, dirty: sourceBefore.dirty, manifest: sourceManifest },
      app: {
        path: appIdentity.path, sha256: appIdentity.sha256, sizeBytes: appIdentity.bytes,
        packagedAppPath, packagedAppSha256: options.developmentTestHarness === true ? null : (await hashCandidateFile(packagedAppPath)).sha256,
      },
      invocation: {
        app: '--app', evidence: '--evidence', expectedHead: '--expected-head', variant: FIELD_ARCHIVE_VARIANT,
        networkBlocked: true, userDataPath: profilePath, evidencePath: options.evidencePath,
      },
      profile: {
        path: profilePath, userDataPath: profilePath, observedUserDataPaths,
        removed: false, usedSystemUserProfile: false, sameProfileAcrossRun: observedUserDataPaths.every((value) => value === profilePath),
      },
      mission: { missionId, startupRecovery },
      sourceFixture,
      preArchive,
      sourceToPreArchive,
      archive: {
        archiveId: finalized.archiveId, archivePath: retainedCiphertextPath, runtimeArchivePath: finalized.archivePath, retainedCiphertextPath,
        ciphertextSha256: archiveIdentity.sha256, ciphertextBytes: archiveIdentity.bytes,
        retainedCiphertextSha256: retainedCiphertext.sha256, retainedCiphertextBytes: retainedCiphertext.bytes,
        registrySha256: finalized.registrySha256, registrySizeBytes: finalized.registrySizeBytes,
        thresholdBytes: ARCHIVE_CIPHERTEXT_MIN_BYTES, containerVersion: finalized.containerVersion,
        status: finalized.status, availability: finalized.availability, verified: finalized.verified,
      },
      reviewRestore: {
        ...reviewRestore, restoredDatabasePath: restored.databasePath, restoredClosed: restored.closed,
        restoredSidecarsAbsent: restored.sidecarsAbsent, restoredSha256: restored.sha256, restoredBytes: restored.bytes,
        restoredRowCounts: restored.rowCounts, restoredTableDigests: restored.tableDigests,
        allowlistedDifferences: { tables: [...ARCHIVE_LIFECYCLE_ALLOWLIST], reason: 'archive lifecycle and bounded audit/correction suffix' },
      },
      inventory,
      preflight,
      cleanup: {
        ...cleanup,
      },
      run: {
        proofMode: options.developmentTestHarness === true ? 'development-electron' : 'packaged-electron',
        executablePath: appIdentity.path, executableSha256: appIdentity.sha256,
        asarPath: options.developmentTestHarness === true ? null : packagedAppPath,
        asarSha256: options.developmentTestHarness === true ? null : (await hashCandidateFile(packagedAppPath)).sha256,
        startedAt: new Date(startedAt).toISOString(), finishedAt: new Date().toISOString(), firstPid: launch.process()?.pid ?? null,
      },
      network,
      stderr: boundedStderr(stderrChunks),
      gaps: [],
    }
    result.runtime = {
      proofMode: result.run.proofMode,
      executablePath: result.run.executablePath,
      executableSha256: result.run.executableSha256,
      asarPath: result.run.asarPath,
      asarSha256: result.run.asarSha256,
    }
    return result
  } catch (error) {
    const failure = sanitizeError(error)
    result = createFailureReceipt({ options, profilePath, sourceBefore, sourceManifest, appIdentity, observedUserDataPaths, network, stderrChunks, startedAt, missionId, failure, preflight })
    const enriched = error instanceof Error ? error : new Error(failure)
    enriched.largeArchiveReport = result
    throw enriched
  } finally {
    if (launch !== null) {
      cleanup.closeAttempted = true
      try { await launch.close(); cleanup.closeSucceeded = true } catch (error) { cleanup.failure ??= sanitizeError(error) }
      cleanup.applicationClosed = cleanup.closeSucceeded
    }
    cleanup.profileRemovalAttempted = true
    try { await rm(profilePath, { recursive: true, force: true }); cleanup.profileRemoved = true } catch (error) { cleanup.failure ??= sanitizeError(error) }
    if (result !== null) {
      result.cleanup = { ...cleanup }
      if (result.profile !== undefined) result.profile.removed = cleanup.profileRemoved
    }
  }
}

/** Prepare, hash, independently inspect, and privately copy the fixed field fixture. */
async function prepareFieldFixture(evidencePath, profilePath) {
  const root = path.join(evidencePath, 'source-fixture-field')
  const sourcePath = path.join(root, 'mission-store.sqlite')
  const manifestPath = `${sourcePath}.manifest.json`
  const privateCopyPath = path.join(root, 'private-oracle-copy', 'mission-store.sqlite')
  await mkdir(root, { recursive: true, mode: 0o700 })
  const generated = await generateMissionStoreFixture({ preset: 'field', outputPath: sourcePath, force: false, progress: () => undefined })
  await assertClosedSqlite(sourcePath)
  const source = await hashCandidateFile(sourcePath)
  if (source.bytes < ARCHIVE_SOURCE_MIN_BYTES) throw new Error(`Field source fixture is ${source.bytes} bytes; required minimum is ${ARCHIVE_SOURCE_MIN_BYTES}.`)
  await rm(path.dirname(privateCopyPath), { recursive: true, force: true })
  const privateCopy = await copyVerified(source.path, privateCopyPath)
  const profilePathForFixture = path.join(profilePath, 'mission-store.sqlite')
  const profileCopy = await copyVerified(privateCopy.path, profilePathForFixture)
  await assertClosedSqlite(privateCopy.path)
  await assertClosedSqlite(profileCopy.path)
  const manifest = JSON.parse((await readFile(manifestPath)).toString('utf8'))
  const manifestIdentity = await hashCandidateFile(manifestPath)
  if (generated.manifest.database.sha256 !== source.sha256 || generated.manifest.database.bytes !== source.bytes
      || privateCopy.sha256 !== source.sha256 || profileCopy.sha256 !== source.sha256) {
    throw new Error('Field fixture, private oracle copy, and profile copy do not share the exact source identity.')
  }
  return inspectStandaloneSqliteFixture(privateCopy, (inspectionPath) => {
    const database = new Database(inspectionPath, { readonly: true, fileMustExist: true })
    try {
      const inventory = selectArchiveFieldSource(database, manifest, source)
      const sourceMission = database.prepare('SELECT * FROM missions WHERE id = ?').get(inventory.primary.id)
      if (sourceMission === undefined) throw new Error('Field source mission row is missing from the private oracle copy.')
      return Object.freeze({
        preset: 'field', path: source.path, privateCopyPath: privateCopy.path, manifestPath,
        sourceSha256: source.sha256, privateCopySha256: privateCopy.sha256, sourceBytes: source.bytes,
        privateCopyBytes: privateCopy.bytes, manifestSha256: manifestIdentity.sha256, manifest,
        inventory, sourceMission,
      })
    } finally { database.close() }
  })
}

/** Create a closed database copy through the production sync-backup bridge. */
async function snapshotDatabase(page, evidencePath, filename, trigger) {
  const backupPath = await page.evaluate(async (name) => {
    const store = window.sartrackerElectron?.missionStore
    if (store === undefined || typeof store.syncBackup !== 'function') throw new Error('Production sync-backup bridge is unavailable.')
    return store.syncBackup(name)
  }, trigger)
  if (typeof backupPath !== 'string' || !path.isAbsolute(backupPath)) throw new Error('Production sync-backup did not return an absolute snapshot path.')
  await assertClosedSqlite(backupPath)
  const databasePath = path.join(evidencePath, 'snapshots', filename)
  const identity = await copyVerified(backupPath, databasePath)
  await assertClosedSqlite(databasePath)
  return { databasePath: identity.path, sha256: identity.sha256, bytes: identity.bytes, closed: true, sidecarsAbsent: true, rowCounts: {}, tableDigests: {} }
}

/** Read only the fixed mission row from a closed snapshot for transition evidence. */
async function readMissionRow(databasePath, missionId) {
  return inspectStandaloneSqliteFixture(await hashCandidateFile(databasePath), (inspectionPath) => {
    const database = new Database(inspectionPath, { readonly: true, fileMustExist: true })
    try {
      const row = database.prepare('SELECT * FROM missions WHERE id = ?').get(missionId)
      if (row === undefined) throw new Error(`Mission row is missing from snapshot: ${missionId}`)
      return row
    } finally { database.close() }
  })
}

/** Describe the exact source-to-finished boundary without broad table exclusions. */
function describeMissionTransition(sourceMission, preArchiveMission, sourceDatabasePath, preArchiveDatabasePath) {
  const keys = [...new Set([...Object.keys(sourceMission ?? {}), ...Object.keys(preArchiveMission ?? {})])].sort()
  const changedFields = keys.filter((key) => JSON.stringify(sourceMission?.[key]) !== JSON.stringify(preArchiveMission?.[key]))
  const allowedMissionFields = ['status', 'pause_time', 'finish_time', 'paused_seconds']
  return {
    sourceDatabasePath, preArchiveDatabasePath, sourceMission, preArchiveMission,
    changedFields, allowedMissionFields,
    unexpectedChangedFields: changedFields.filter((key) => !allowedMissionFields.includes(key)),
  }
}

/** Project the independent archive oracle into both retained snapshot records. */
function projectInventoryDigests(before, after, inventory) {
  before.rowCounts = Object.fromEntries(inventory.tables.map((table) => [table.name, table.sourceRows]))
  before.tableDigests = Object.fromEntries(inventory.tables.map((table) => [table.name, table.sourceSha256]))
  after.rowCounts = Object.fromEntries(inventory.tables.map((table) => [table.name, table.restoredRows]))
  after.tableDigests = Object.fromEntries(inventory.tables.map((table) => [table.name, table.restoredSourceSha256]))
}

/** Finalize a finished field mission through the public recovery-code and archive APIs. */
async function finalizeArchive(page, missionId) {
  const issuance = await page.evaluate(async (id) => window.sartrackerElectron?.missionStore?.issueMissionArchiveRecoveryCode(id), missionId)
  if (typeof issuance?.operationId !== 'string' || typeof issuance.recoveryCode !== 'string') throw new Error('Archive recovery issuance was incomplete.')
  const finalized = await page.evaluate(async (input) => window.sartrackerElectron?.missionStore?.finalizeMission(input.id, {
    operationId: input.operationId, recoveryCode: input.recoveryCode, passphrase: input.passphrase,
  }), { id: missionId, operationId: issuance.operationId, recoveryCode: issuance.recoveryCode, passphrase: PASS_PHRASE })
  const archive = finalized?.archive
  if (finalized?.mission?.status !== 'finalized' || archive?.container_version !== ARCHIVE_CONTAINER_VERSION
      || archive.status !== 'verified' || archive.availability !== 'present' || typeof archive.archive_path !== 'string') {
    throw new Error('Archive finalization did not return a verified v2 archive.')
  }
  const registered = await page.evaluate(async (id) => window.sartrackerElectron?.missionStore?.listMissionArchives(id), missionId)
  const registry = Array.isArray(registered) ? registered.find((entry) => entry?.id === archive.id) : null
  if (registry?.id !== archive.id || registry.status !== 'verified' || registry.ciphertext_sha256 !== archive.ciphertext_sha256) {
    throw new Error('Archive registry did not retain the exact finalized identity.')
  }
  return {
    archiveId: archive.id, archivePath: archive.archive_path, containerVersion: archive.container_version,
    status: archive.status, availability: archive.availability, verified: archive.status === 'verified',
    registrySha256: registry.ciphertext_sha256, registrySizeBytes: Number(registry.size_bytes),
  }
}

/** Open immutable review, exercise replay and mutation denial, restore, then close the session. */
async function runArchiveReviewAndRestore(page, missionId, archiveId) {
  const operationId = randomUUID()
  const opened = await page.evaluate(async (input) => window.sartrackerElectron?.archiveReview?.open({
    operationId: input.operationId, archiveId: input.archiveId, containerVersion: input.containerVersion,
    slotType: 'passphrase', secret: input.passphrase,
  }), { operationId, archiveId, containerVersion: ARCHIVE_CONTAINER_VERSION, passphrase: PASS_PHRASE })
  if (opened?.archiveId !== archiveId || opened?.missionId !== missionId || opened.immutable !== true || opened.verified !== true) {
    throw new Error('Archive review did not open the exact verified immutable archive.')
  }
  const read = (method, input) => page.evaluate(async (request) => window.sartrackerElectron?.archiveReview?.read({
    sessionId: request.sessionId, requestId: request.requestId, method: request.method, input: request.input,
  }), { sessionId: opened.sessionId, requestId: randomUUID(), method, input })
  // restoreMissionForCorrection closes the review session as part of its
  // cleanup. Keep that product fact separate from the follow-up close call:
  // the latter can legitimately report OWNER_MISMATCH after the session has
  // already been closed by restore.
  let restoreCleanupComplete = false
  let explicitCloseAttempted = false
  let explicitCloseSucceeded = false
  let explicitCloseError = null
  let facts = null
  try {
    const [missions, review, replay] = await Promise.all([
      read('listMissions', {}),
      read('readMissionReview', { missionId, includeTelemetry: false, auditLimit: 100 }),
      read('readMissionReplay', { missionId, selectedTime: new Date().toISOString(), timezone: 'Europe/Dublin', trackLimit: 1000, objectLimit: 100 }),
    ])
    const mutationDenied = await read('recordMutationDenied', { attemptedMethod: 'upsertMarker' })
    const missionCount = Array.isArray(missions) ? missions.filter((entry) => entry?.id === missionId).length : 0
    if (missionCount !== 1 || review?.missionId !== undefined && review.missionId !== missionId || replay?.missionId !== missionId || mutationDenied !== true) {
      throw new Error('Archive review did not retain mission, replay, and mutation-denial identity.')
    }
    const restored = await page.evaluate(async (input) => window.sartrackerElectron?.missionStore?.restoreMissionForCorrection({
      admin_name: 'C20-C22 Large Archive Admin', archiveId: input.archiveId, mission_id: input.missionId,
      operationId: input.operationId, reason: 'C20-C22 large archive restore proof', sessionId: input.sessionId,
    }), { archiveId, missionId, operationId, sessionId: opened.sessionId })
    const restoredMission = await page.evaluate(async (id) => window.sartrackerElectron?.missionStore?.getMission(id), missionId)
    if (restored?.id !== missionId || restored?.status !== 'finished' || restored?.correction?.committed !== true
        || restored?.correction?.cleanupComplete !== true || restoredMission?.storage_state !== 'live') {
      throw new Error('Archive correction restore did not return a committed live mission.')
    }
    restoreCleanupComplete = restored.correction.cleanupComplete === true
    facts = {
      opened: true, immutable: opened.immutable, verified: opened.verified, mutationDenied: true,
      restored: true, returnedStatus: restored.status, storageState: restoredMission.storage_state,
      committed: restored.correction.committed, plaintextCleanupComplete: restored.correction.cleanupComplete,
      sessionClosed: restoreCleanupComplete, explicitCloseAttempted: false,
      explicitCloseSucceeded: false, explicitCloseError: null,
      reviewMissionCount: missionCount, replayMissionId: replay.missionId,
      replayTrackCount: replay.totalTrackCount ?? null,
    }
  } finally {
    explicitCloseAttempted = true
    await page.evaluate(async (sessionId) => window.sartrackerElectron?.archiveReview?.close({ sessionId }), opened.sessionId)
      .then(() => { explicitCloseSucceeded = true })
      .catch((error) => {
        explicitCloseError = {
          name: typeof error?.name === 'string' ? error.name : 'Error',
          code: typeof error?.code === 'string' ? error.code : null,
          message: typeof error?.message === 'string' ? error.message : String(error),
        }
      })
  }
  if (facts === null) throw new Error('Archive review did not produce custody facts.')
  return {
    ...facts,
    sessionClosed: restoreCleanupComplete || explicitCloseSucceeded,
    explicitCloseAttempted,
    explicitCloseSucceeded,
    explicitCloseError,
  }
}

/** Ensure a database snapshot is self-contained and has no adjacent mutable state. */
async function assertClosedSqlite(filename) {
  await lstat(filename)
  for (const suffix of ['-wal', '-shm', '-journal']) {
    try { await lstat(`${filename}${suffix}`) } catch (error) { if (error?.code === 'ENOENT') continue; throw error }
    throw new Error(`Closed archive snapshot has a mutable SQLite sidecar: ${filename}${suffix}`)
  }
}

/** Copy and rehash one file while retaining source immutability. */
async function copyVerified(sourcePath, destinationPath) {
  const before = await hashCandidateFile(sourcePath)
  await mkdir(path.dirname(destinationPath), { recursive: true, mode: 0o700 })
  const temporaryPath = `${destinationPath}.tmp-${randomUUID()}`
  try {
    await pipeline(createReadStream(before.path), createWriteStream(temporaryPath, { flags: 'wx', mode: 0o600 }))
    await rename(temporaryPath, destinationPath)
  } finally { await rm(temporaryPath, { force: true }) }
  const copied = await hashCandidateFile(destinationPath)
  const after = await hashCandidateFile(sourcePath)
  if (copied.sha256 !== before.sha256 || copied.bytes !== before.bytes || after.sha256 !== before.sha256 || after.bytes !== before.bytes) {
    throw new Error(`Archive evidence copy changed source identity: ${sourcePath}`)
  }
  return copied
}

/** Launch Electron against only the disposable profile and network block. */
async function launchPackaged(appPath, profilePath, developmentTestHarness) {
  const platformArgs = process.platform === 'linux'
    ? ['--no-sandbox', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-features=Vulkan,DefaultANGLEVulkan,VulkanFromANGLE']
    : []
  const args = developmentTestHarness ? [path.join(projectRoot, 'electron', 'main.cjs'), ...platformArgs] : platformArgs
  const env = { ...process.env, SARTRACKER_ELECTRON_USER_DATA_PATH: profilePath, SARTRACKER_ELECTRON_BLOCK_NETWORK: '1' }
  if (developmentTestHarness) delete env.ELECTRON_RENDERER_URL
  return electron.launch({ executablePath: appPath, args, env, timeout: 30_000 })
}

/** Attach the renderer request counters used by the runtime receipt. */
function attachNetworkEgressCounter(page, network) {
  page.on('request', (request) => {
    const scheme = new URL(request.url()).protocol
    if (scheme === 'http:') network.httpRequests += 1
    if (scheme === 'https:') network.httpsRequests += 1
  })
}

/** Retain bounded child-process stderr facts. */
function attachStderr(launch, chunks) {
  launch.process()?.stderr?.on('data', (chunk) => {
    if (Buffer.byteLength(chunks.join('')) < 256 * 1024) chunks.push(Buffer.from(chunk).toString('utf8').slice(0, 256 * 1024))
  })
}

/** Read source head and dirty state without shell interpolation. */
async function readSourceState() {
  const { stdout: head } = await execFile('git', ['rev-parse', 'HEAD'], { cwd: projectRoot, encoding: 'utf8' })
  const { stdout: status } = await execFile('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: projectRoot, encoding: 'utf8' })
  return { head: head.trim(), dirty: status.trim() !== '' }
}

/** Create a bounded stderr projection without retaining secrets. */
function boundedStderr(chunks) {
  const value = chunks.join('')
  return { sha256: sha256Text(value), byteLength: Buffer.byteLength(value), lines: value.split('\n').slice(-64) }
}

/** Construct a retained failure receipt with the phase and identity facts available so far. */
function createFailureReceipt({ options, profilePath, sourceBefore, sourceManifest, appIdentity, observedUserDataPaths, network, stderrChunks, startedAt, missionId, failure, preflight }) {
  return {
    schemaVersion: 1, proofKind: 'packaged-large-archive-v1', contractId: 'C20-C22', variantId: FIELD_ARCHIVE_VARIANT,
    developmentTestHarness: options.developmentTestHarness,
    source: { head: sourceBefore.head, expectedHead: options.expectedHead, observedHead: sourceBefore.head, dirty: sourceBefore.dirty, manifest: sourceManifest },
    app: { path: appIdentity.path, sha256: appIdentity.sha256, sizeBytes: appIdentity.bytes, packagedAppPath: null, packagedAppSha256: null },
    invocation: { app: '--app', evidence: '--evidence', expectedHead: '--expected-head', variant: FIELD_ARCHIVE_VARIANT, networkBlocked: true, userDataPath: profilePath, evidencePath: options.evidencePath },
    profile: { path: profilePath, userDataPath: profilePath, observedUserDataPaths, removed: false, usedSystemUserProfile: false },
    mission: { missionId }, preflight, network, stderr: boundedStderr(stderrChunks), run: { proofMode: options.developmentTestHarness === true ? 'development-electron' : 'packaged-electron', startedAt: new Date(startedAt).toISOString(), finishedAt: new Date().toISOString(), failure },
    gaps: [{ phase: 'field-archive-37gb', reason: failure }],
  }
}

/** Normalize direct API inputs and enforce the fixed variant/threshold boundary. */
function normalizeInput(input) {
  if (!isObject(input) || !path.isAbsolute(input.appPath) || !path.isAbsolute(input.evidencePath) || !SHA1.test(input.expectedHead)) throw new Error('Large archive probe input is invalid.')
  if (input.variant !== undefined && input.variant !== FIELD_ARCHIVE_VARIANT) throw new Error('Large archive probe variant is fixed to field-archive-37gb.')
  if (input.developmentTestHarness !== undefined && input.developmentTestHarness !== true) throw new Error('Development harness must be explicitly true when supplied.')
  return Object.freeze({ ...input, variant: FIELD_ARCHIVE_VARIANT, developmentTestHarness: input.developmentTestHarness === true })
}

function validateFixture(fixture, evidencePath, failures) {
  try {
    assertArchiveFieldManifest(fixture?.manifest, { sha256: fixture?.sourceSha256, bytes: fixture?.sourceBytes })
    assertArchiveFieldInventory(fixture.manifest, fixture.inventory)
    const manifestDigest = createHash('sha256').update(`${JSON.stringify(fixture.manifest, null, 2)}\n`).digest('hex')
    if (fixture.manifestSha256 !== manifestDigest) throw new Error('Field manifest digest differs.')
  } catch {
    failures.push('The field archive role, manifest identity, or all-position inventory differs.')
  }
  if (!isObject(fixture) || fixture.preset !== 'field' || !absoluteUnder(fixture.path, evidencePath) || !absoluteUnder(fixture.privateCopyPath, evidencePath)
      || !absoluteUnder(fixture.manifestPath, evidencePath) || !SHA256.test(fixture.sourceSha256 ?? '') || fixture.privateCopySha256 !== fixture.sourceSha256
      || !Number.isSafeInteger(fixture.sourceBytes) || fixture.sourceBytes < ARCHIVE_SOURCE_MIN_BYTES
      || fixture.privateCopyBytes !== fixture.sourceBytes || !SHA256.test(fixture.manifestSha256 ?? '') || !isObject(fixture.inventory)) {
    failures.push('The closed field source/private oracle fixture is incomplete or below 3.7GB.')
  }
}

function validateSnapshot(snapshot, evidencePath, label, failures) {
  if (!isObject(snapshot) || !absoluteUnder(snapshot.databasePath, evidencePath) || snapshot.closed !== true || snapshot.sidecarsAbsent !== true
      || !SHA256.test(snapshot.sha256 ?? '') || !Number.isSafeInteger(snapshot.bytes) || snapshot.bytes < 1
      || !isObject(snapshot.rowCounts) || !isObject(snapshot.tableDigests)) failures.push(`The ${label} snapshot is not a retained closed digest.`)
}

function validateSourceTransition(transition, fixture, preArchive, evidencePath, failures) {
  const allowed = new Set(['status', 'pause_time', 'finish_time', 'paused_seconds'])
  if (!isObject(transition) || !absoluteUnder(transition.sourceDatabasePath, evidencePath)
      || transition.sourceDatabasePath !== fixture?.privateCopyPath || transition.preArchiveDatabasePath !== preArchive?.databasePath
      || !isObject(transition.sourceMission) || !isObject(transition.preArchiveMission)
      || transition.sourceMission.status !== 'active' || transition.preArchiveMission.status !== 'finished'
      || !Array.isArray(transition.changedFields) || !transition.changedFields.includes('status')
      || !Array.isArray(transition.unexpectedChangedFields) || transition.unexpectedChangedFields.length !== 0
      || !Array.isArray(transition.allowedMissionFields) || transition.allowedMissionFields.some((field) => !allowed.has(field))) {
    failures.push('Source-to-prearchive custody does not retain the exact finished transition boundary.')
  }
}

function validateArchive(archive, evidencePath, failures) {
  if (!isObject(archive) || !absoluteUnder(archive.archivePath, evidencePath) || !absoluteUnder(archive.retainedCiphertextPath, evidencePath)
      || !path.isAbsolute(archive.runtimeArchivePath) || archive.runtimeArchivePath === archive.archivePath
      || archive.containerVersion !== ARCHIVE_CONTAINER_VERSION
      || archive.status !== 'verified' || archive.availability !== 'present' || archive.verified !== true
      || archive.thresholdBytes !== ARCHIVE_CIPHERTEXT_MIN_BYTES || !SHA256.test(archive.ciphertextSha256 ?? '')
      || !SHA256.test(archive.retainedCiphertextSha256 ?? '') || archive.retainedCiphertextSha256 !== archive.ciphertextSha256
      || !Number.isSafeInteger(archive.ciphertextBytes) || archive.ciphertextBytes < ARCHIVE_CIPHERTEXT_MIN_BYTES
      || archive.retainedCiphertextBytes !== archive.ciphertextBytes) failures.push('The actual v2 ciphertext identity or fixed 3.5GB boundary is missing.')
}

function validateRestore(restore, preArchive, evidencePath, failures) {
  if (!isObject(restore) || restore.opened !== true || restore.immutable !== true || restore.verified !== true
      || restore.mutationDenied !== true || restore.restored !== true || restore.plaintextCleanupComplete !== true
      || restore.sessionClosed !== true || !absoluteUnder(restore.restoredDatabasePath, evidencePath)
      || restore.restoredDatabasePath === preArchive?.databasePath || restore.restoredClosed !== true || restore.restoredSidecarsAbsent !== true
      || !SHA256.test(restore.restoredSha256 ?? '') || !Number.isSafeInteger(restore.restoredBytes) || restore.restoredBytes < 1
      || !isObject(restore.restoredRowCounts) || !isObject(restore.restoredTableDigests)
      || !Array.isArray(restore.allowlistedDifferences?.tables) || restore.allowlistedDifferences.tables.length === 0) {
    failures.push('Archive review/restore did not retain closed restored custody and bounded cleanup facts.')
  }
}

function validateCleanup(cleanup, failures) {
  if (!isObject(cleanup) || cleanup.closeAttempted !== true || cleanup.closeSucceeded !== true
      || cleanup.profileRemovalAttempted !== true || cleanup.profileRemoved !== true || cleanup.applicationClosed !== true
      || cleanup.reviewClosed !== true || cleanup.plaintextRemoved !== true || cleanup.failure !== null) failures.push('Disposable profile cleanup is incomplete.')
}

function absoluteUnder(filename, root) {
  return typeof filename === 'string' && path.isAbsolute(filename) && root !== null
    && path.resolve(filename).startsWith(`${path.resolve(root)}${path.sep}`)
}

function isObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) }
function sha256Text(value) { return createHash('sha256').update(value).digest('hex') }
function sanitizeError(error) { return String(error instanceof Error ? error.message : error).replaceAll(PASS_PHRASE, '[redacted-secret]').slice(0, 500) }

/** Refuse the fixed multi-gigabyte workload without a conservative custody envelope. */
async function checkFreeSpace(directory) {
  const stats = await statfs(directory)
  const availableBytes = Number(stats.bavail) * Number(stats.bsize)
  if (!Number.isSafeInteger(availableBytes) || availableBytes < ARCHIVE_MIN_FREE_SPACE_BYTES) {
    throw new Error(`Large archive evidence requires at least ${ARCHIVE_MIN_FREE_SPACE_BYTES} free bytes; observed ${availableBytes}.`)
  }
  return { availableBytes, minFreeBytes: ARCHIVE_MIN_FREE_SPACE_BYTES, checkedPath: path.resolve(directory) }
}

/** Run the fixed CLI producer and independently reject incomplete output. */
export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv)
  let report
  try {
    report = await runLargeArchiveProbe(options)
    const validation = validateLargeArchiveProducerReceipt(report, options)
    if (!validation.valid) throw new Error(`Large archive producer receipt is invalid: ${validation.failureReasons.join(' | ')}`)
    const reportPath = path.join(options.evidencePath, 'composite-large-archive-report.json')
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    console.log(`qualification-composite-large-archive: report=${reportPath}`)
    return report
  } catch (error) {
    report = error?.largeArchiveReport ?? report
    if (report !== undefined) {
      await writeFile(path.join(options.evidencePath, 'composite-large-archive-failure-receipt.json'), `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 }).catch(() => undefined)
    }
    throw error
  }
}
