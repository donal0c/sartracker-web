#!/usr/bin/env node

// Exact-head packaged-Electron archive lifecycle smoke (PR6 / DON-248,
// DON-252, DON-253). Every application operation crosses the public sandboxed
// preload bridge; the harness never opens the mission database directly.

import { execFile, spawn } from 'node:child_process'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright'

import {
  assertArchiveLifecycleSmokeEvidenceOmitsSecrets,
  parseArchiveLifecycleSmokeArgs,
  resolvePackagedApplicationArchivePath,
  validateArchiveLifecycleSmokeEvidence,
} from '../build/electron-archive-lifecycle-smoke-lib.js'

const execFileAsync = promisify(execFile)
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MISSION_NAME = 'Packaged Archive Lifecycle Proof'
const POSITION_CHUNK_SIZE = 512
const FAILURE_MESSAGE_LIMIT = 400

let activeLaunch = null
let passphrase = ''
let recoveryCode = ''

main().catch(async (error) => {
  await stopLaunch(activeLaunch).catch(() => undefined)
  const sanitized = sanitizeFailureMessage(error)
  passphrase = ''
  recoveryCode = ''
  console.error(`electron-archive-lifecycle-smoke: ${sanitized}`)
  process.exitCode = 1
})

/** Runs the complete packaged lifecycle and writes one closed evidence report. */
async function main() {
  const options = parseArchiveLifecycleSmokeArgs(process.argv.slice(2))
  if (!['darwin', 'linux'].includes(process.platform)) {
    throw new Error('Packaged archive-lifecycle smoke supports macOS and Linux only.')
  }
  await access(options.appPath)
  const sourceBefore = await readSourceState()
  assertExactCleanSource(sourceBefore, options.expectedHead, 'before')
  await prepareEvidenceDirectory(options.evidenceDir, [options.appPath, projectRoot])
  const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'sartracker-pr6-archive-smoke-'))

  const startedAtMs = Date.now()
  const packagedApplicationArchivePath = resolvePackagedApplicationArchivePath(
    options.appPath,
    process.platform,
  )
  await requireRegularFileNoSymlink(
    packagedApplicationArchivePath,
    'Packaged application archive',
  )
  const packagedExecutableSha256 = await sha256File(options.appPath)
  const packagedApplicationArchiveSha256 = await sha256File(packagedApplicationArchivePath)
  const observedLaunchExits = []
  const packagedBuildHeadMatches = []
  passphrase = createEphemeralPassphrase()
  let initialLaunch
  let restartedLaunch
  try {
    initialLaunch = await launchPackagedApp(options, userDataDir, 1)
    packagedBuildHeadMatches.push(initialLaunch.packagedBuildHeadMatched)
    activeLaunch = initialLaunch
    const seeded = await seedAndFinishMission(
      initialLaunch.page,
      options.seedPositionRows,
    )
    const finalized = await finalizeAndVerifyArchive(
      initialLaunch.page,
      seeded.missionId,
      passphrase,
    )
    recoveryCode = finalized.recoveryCode
    const firstReview = await runReadOnlyReview({
      page: initialLaunch.page,
      archive: finalized.archive,
      missionId: seeded.missionId,
      secret: passphrase,
      secrets: [passphrase, recoveryCode],
      reviewRoot: path.join(userDataDir, 'archive-review'),
      expectedBreadcrumbCount: seeded.seededPositionRows,
    })
    const interruption = await interruptRestoreAtDecrypt({
      launch: initialLaunch,
      archive: finalized.archive,
      secret: passphrase,
      timeoutMs: options.timeoutMs,
      reviewRoot: path.join(userDataDir, 'archive-review'),
    })
    observedLaunchExits.push({ number: initialLaunch.number, signal: interruption.exitSignal })
    initialLaunch = null
    activeLaunch = null

    restartedLaunch = await launchPackagedApp(options, userDataDir, 2)
    packagedBuildHeadMatches.push(restartedLaunch.packagedBuildHeadMatched)
    activeLaunch = restartedLaunch
    const residualEntriesAfterRestart = await countResidualEntries(
      path.join(userDataDir, 'archive-review'),
    )
    if (residualEntriesAfterRestart !== 0) {
      throw new Error('Startup did not sweep the interrupted archive-review residual.')
    }
    const retainedAfterRestart = await readRetainedArchive(
      restartedLaunch.page,
      seeded.missionId,
      finalized.archive,
    )
    const cleanupResult = await runCleanup({
      page: restartedLaunch.page,
      missionId: seeded.missionId,
      missionName: MISSION_NAME,
      archiveId: finalized.archive.id,
      secret: passphrase,
    })
    const secondReview = await runReadOnlyReview({
      page: restartedLaunch.page,
      archive: retainedAfterRestart,
      missionId: seeded.missionId,
      secret: passphrase,
      secrets: [passphrase, recoveryCode],
      reviewRoot: path.join(userDataDir, 'archive-review'),
      expectedBreadcrumbCount: seeded.seededPositionRows,
    })
    const postCleanup = await assertPostCleanupState({
      page: restartedLaunch.page,
      missionId: seeded.missionId,
      archive: finalized.archive,
    })
    const cleanup = { ...cleanupResult, ...postCleanup }
    const restartedExit = await stopLaunch(restartedLaunch)
    observedLaunchExits.push({ number: restartedLaunch.number, signal: restartedExit.signal })
    restartedLaunch = null
    activeLaunch = null

    const secretScan = await scanProfileForExactSecrets(
      userDataDir,
      [passphrase, recoveryCode],
    )
    const finalResidualEntries = await countArchiveLifecycleResidualEntries(userDataDir)
    await removeDisposableProfile(userDataDir)
    const sourceAfter = await readSourceState()
    assertExactCleanSource(sourceAfter, options.expectedHead, 'after')
    if (await sha256File(options.appPath) !== packagedExecutableSha256) {
      throw new Error('Packaged executable bytes changed during the archive-lifecycle smoke.')
    }
    await requireRegularFileNoSymlink(
      packagedApplicationArchivePath,
      'Packaged application archive',
    )
    if (await sha256File(packagedApplicationArchivePath)
      !== packagedApplicationArchiveSha256) {
      throw new Error('Packaged application archive bytes changed during the lifecycle smoke.')
    }
    const finishedAtMs = Date.now()
    const evidence = {
      schemaVersion: 1,
      proofKind: 'packaged-electron-archive-lifecycle-v1',
      source: {
        expectedHead: options.expectedHead,
        headBefore: sourceBefore.head,
        headAfter: sourceAfter.head,
        treeBefore: sourceBefore.tree,
        treeAfter: sourceAfter.tree,
        worktreeCleanBefore: sourceBefore.clean,
        worktreeCleanAfter: sourceAfter.clean,
        packagedExecutableSha256,
        packagedApplicationArchiveSha256,
        packagedBuildHeadMatched: packagedBuildHeadMatches.length === 2
          && packagedBuildHeadMatches.every((matched) => matched === true),
      },
      run: {
        startedAt: new Date(startedAtMs).toISOString(),
        finishedAt: new Date(finishedAtMs).toISOString(),
        durationMs: finishedAtMs - startedAtMs,
        platform: process.platform,
        architecture: os.arch(),
        nodeVersion: process.version,
        launchCount: 2,
        observedLaunchExitCount: observedLaunchExits.length,
      },
      mission: {
        missionId: seeded.missionId,
        missionNameSha256: sha256Text(MISSION_NAME),
        createdStatus: seeded.createdStatus,
        finishedStatus: seeded.finishedStatus,
        finalizedStatus: finalized.mission.status,
        seededPositionRows: seeded.seededPositionRows,
      },
      archive: {
        archiveId: finalized.archive.id,
        containerVersion: finalized.archive.container_version,
        statusAfterFinalize: finalized.archive.status,
        statusAfterIndependentVerify: finalized.archive.status,
        availability: finalized.archive.availability,
        ciphertextSha256: finalized.archive.ciphertext_sha256,
        sizeBytes: finalized.archive.size_bytes,
        createProgressPhases: sortedUnique(finalized.createProgressPhases),
        verifyProgressPhases: sortedUnique(finalized.verifyProgressPhases),
      },
      reviewBeforeCleanup: firstReview,
      interruptedRestore: {
        supported: true,
        progressTriggered: true,
        triggerPhase: interruption.triggerPhase,
        killSignalRequested: 'SIGKILL',
        exitSignal: interruption.exitSignal,
        residualEntriesBeforeRestart: interruption.residualEntriesBeforeRestart,
        plaintextFileObservedBeforeRestart: interruption.plaintextFileObservedBeforeRestart,
        privacyCanaryDetectedBeforeRestart: interruption.privacyCanaryDetectedBeforeRestart,
        restartSweepCompleted: true,
        residualEntriesAfterRestart,
      },
      cleanup,
      reviewAfterCleanup: secondReview,
      privacy: {
        secretsProvidedOnlyViaPreload: true,
        secretsAbsentFromProcessArguments: true,
        secretsAbsentFromEvidence: true,
        exactSecretScanFiles: secretScan.filesScanned,
        exactSecretMatches: secretScan.matches,
        plaintextResidueEntriesAtEnd: finalResidualEntries,
      },
      verdict: { passed: true, failureReasons: [] },
    }
    assertArchiveLifecycleSmokeEvidenceOmitsSecrets(evidence, [passphrase, recoveryCode])
    const validation = validateArchiveLifecycleSmokeEvidence(evidence)
    if (!validation.passed) {
      throw new Error(`Packaged archive-lifecycle evidence failed ${validation.failureReasons.length} closed gate(s).`)
    }
    const reportPath = path.join(
      options.evidenceDir,
      'electron-archive-lifecycle-smoke-report.json',
    )
    await writeFile(reportPath, `${JSON.stringify(evidence, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    })
    console.log(`electron-archive-lifecycle-smoke: passed; report=${reportPath}`)
    passphrase = ''
    recoveryCode = ''
  } finally {
    await stopLaunch(restartedLaunch).catch(() => undefined)
    await stopLaunch(initialLaunch).catch(() => undefined)
    activeLaunch = null
    await removeDisposableProfile(userDataDir)
  }
}

/** Creates a bounded mission and deterministic breadcrumb evidence through preload IPC. */
async function seedAndFinishMission(page, seededPositionRows) {
  return page.evaluate(async ({ missionName, rowCount, chunkSize }) => {
    const store = window.sartrackerElectron?.missionStore
    if (store === undefined) throw new Error('Mission-store preload bridge is unavailable.')
    const mission = await store.createMission({
      name: missionName,
      start_time: '2026-08-29T08:00:00.000Z',
    })
    if (mission?.status !== 'active' || typeof mission.id !== 'string') {
      throw new Error('Packaged mission creation returned an invalid result.')
    }
    await store.upsertDevice({
      mission_id: mission.id,
      device_id: 'archive-smoke-tracker',
      name: 'Archive Smoke Tracker',
      color: '#0077AA',
      status: 'online',
    })
    const baseMs = Date.parse('2026-08-29T08:00:01.000Z')
    for (let offset = 0; offset < rowCount; offset += chunkSize) {
      const length = Math.min(chunkSize, rowCount - offset)
      const positions = Array.from({ length }, (_unused, localIndex) => {
        const index = offset + localIndex
        return {
          source_position_id: `archive-smoke-${index + 1}`,
          device_id: 'archive-smoke-tracker',
          lat: 52.05 + index / 10_000_000,
          lon: -9.5 - index / 10_000_000,
          timestamp: new Date(baseMs + index * 1_000).toISOString(),
          timestamp_source: 'fix',
          data_origin: 'live',
        }
      })
      const result = await store.addPositionsBulk({
        mission_id: mission.id,
        positions,
      })
      if (result?.insertedPositionCount !== length) {
        throw new Error('Packaged breadcrumb seed did not insert every requested row.')
      }
    }
    const persistedCount = await store.countPositions(mission.id)
    if (persistedCount !== rowCount) {
      throw new Error('Packaged breadcrumb row count did not match the bounded seed.')
    }
    const finished = await store.finishMission(mission.id)
    if (finished?.status !== 'finished') {
      throw new Error('Packaged mission finish returned an invalid result.')
    }
    return {
      missionId: mission.id,
      createdStatus: mission.status,
      finishedStatus: finished.status,
      seededPositionRows: persistedCount,
    }
  }, {
    missionName: MISSION_NAME,
    rowCount: seededPositionRows,
    chunkSize: POSITION_CHUNK_SIZE,
  })
}

/** Finalizes through the independent verifier integrated into the public preload lifecycle. */
async function finalizeAndVerifyArchive(page, missionId, secret) {
  const issuance = await page.evaluate(async (selectedMissionId) => {
    const store = window.sartrackerElectron?.missionStore
    if (store === undefined) throw new Error('Mission-store preload bridge is unavailable.')
    return store.issueMissionArchiveRecoveryCode(selectedMissionId)
  }, missionId)
  if (typeof issuance?.operationId !== 'string' || typeof issuance?.recoveryCode !== 'string') {
    throw new Error('Packaged recovery issuance was invalid.')
  }
  const finalized = await page.evaluate(async (input) => {
    const bridge = window.sartrackerElectron
    if (bridge?.missionStore === undefined
      || typeof bridge.onMissionArchiveProgress !== 'function') {
      throw new Error('Archive preload bridge is unavailable.')
    }
    const progressEntries = []
    const unsubscribe = bridge.onMissionArchiveProgress((progress) => {
      if (progress.operationId === input.operationId) {
        progressEntries.push({ kind: progress.kind, phase: progress.phase })
      }
    })
    try {
      const result = await bridge.missionStore.finalizeMission(input.missionId, {
        operationId: input.operationId,
        passphrase: input.passphrase,
        recoveryCode: input.recoveryCode,
      })
      return { result, progressEntries }
    } finally {
      unsubscribe()
    }
  }, {
    missionId,
    operationId: issuance.operationId,
    passphrase: secret,
    recoveryCode: issuance.recoveryCode,
  })
  const archive = finalized?.result?.archive
  const mission = finalized?.result?.mission
  if (mission?.id !== missionId || mission.status !== 'finalized'
    || archive?.mission_id !== missionId || archive.container_version !== 2
    || archive.status !== 'verified' || archive.availability !== 'present'
    || typeof archive.ciphertext_sha256 !== 'string'
    || !Number.isSafeInteger(archive.size_bytes) || archive.size_bytes < 1) {
    throw new Error('Packaged finalization did not return one verified encrypted archive.')
  }
  const createProgressPhases = finalized.progressEntries
    .filter((entry) => entry.kind === 'create')
    .map((entry) => entry.phase)
  const verifyProgressPhases = finalized.progressEntries
    .filter((entry) => entry.kind === 'verify')
    .map((entry) => entry.phase)
  return {
    mission,
    archive,
    recoveryCode: issuance.recoveryCode,
    createProgressPhases,
    verifyProgressPhases,
  }
}

/** Opens, reads, attacks, and closes one immutable archive-review session. */
async function runReadOnlyReview(input) {
  const operationId = randomUUID()
  const opened = await input.page.evaluate(async (request) => {
    const archiveReview = window.sartrackerElectron?.archiveReview
    if (archiveReview === undefined) throw new Error('Archive-review preload bridge is unavailable.')
    return archiveReview.open({
      operationId: request.operationId,
      archiveId: request.archiveId,
      containerVersion: 2,
      slotType: 'passphrase',
      secret: request.secret,
    })
  }, {
    operationId,
    archiveId: input.archive.id,
    secret: input.secret,
  })
  const openInspection = await inspectReviewResiduals(input.reviewRoot, {
    privacyCanary: MISSION_NAME,
    secrets: input.secrets,
  })
  let review
  let closed = false
  try {
    review = await input.page.evaluate(async (request) => {
      const archiveReview = window.sartrackerElectron?.archiveReview
      if (archiveReview === undefined) {
        throw new Error('Archive-review preload bridge is unavailable.')
      }
      const reviewResult = await archiveReview.read({
        sessionId: request.sessionId,
        requestId: request.readRequestId,
        method: 'readMissionReview',
        input: {
          missionId: request.missionId,
          includeTelemetry: false,
          auditLimit: 5_001,
        },
      })
      const replayResult = await archiveReview.read({
        sessionId: request.sessionId,
        requestId: request.replayRequestId,
        method: 'readMissionReplay',
        input: {
          missionId: request.missionId,
          selectedTime: request.selectedTime,
          timezone: 'Europe/Dublin',
          trackLimit: 1_000,
          objectLimit: 100,
        },
      })
      const missions = await archiveReview.read({
        sessionId: request.sessionId,
        requestId: request.listRequestId,
        method: 'listMissions',
        input: {},
      })
      let mutationDenied = false
      try {
        await archiveReview.read({
          sessionId: request.sessionId,
          requestId: request.mutationRequestId,
          method: 'upsertMarker',
          input: {},
        })
      } catch (error) {
        mutationDenied = error instanceof Error
          && /read-only|unavailable/iu.test(error.message)
      }
      const denialAudited = await archiveReview.read({
        sessionId: request.sessionId,
        requestId: request.denialRequestId,
        method: 'recordMutationDenied',
        input: { attemptedMethod: 'upsertMarker' },
      })
      return {
        reviewResult,
        replayResult,
        missions,
        mutationDenied,
        denialAudited,
      }
    }, {
      sessionId: opened.sessionId,
      missionId: input.missionId,
      selectedTime: new Date(
        Date.parse('2026-08-29T08:00:01.000Z')
          + (input.expectedBreadcrumbCount + 60) * 1_000,
      ).toISOString(),
      readRequestId: randomUUID(),
      replayRequestId: randomUUID(),
      listRequestId: randomUUID(),
      mutationRequestId: randomUUID(),
      denialRequestId: randomUUID(),
    })
  } finally {
    closed = await input.page.evaluate(async (sessionId) => {
      const archiveReview = window.sartrackerElectron?.archiveReview
      if (archiveReview === undefined) {
        throw new Error('Archive-review preload bridge is unavailable.')
      }
      return archiveReview.close({ sessionId })
    }, opened.sessionId)
  }
  const residualEntriesAfterClose = await countResidualEntries(input.reviewRoot)
  const readMissionIdMatched = Array.isArray(review?.missions)
    && review.missions.length === 1
    && review.missions[0]?.id === input.missionId
  const breadcrumbCount = review?.reviewResult?.breadcrumbCount
  const contentSha256 = sha256Text(JSON.stringify({
    missions: review?.missions,
    review: review?.reviewResult,
    replay: review?.replayResult,
  }))
  if (opened?.archiveId !== input.archive.id
    || opened?.missionId !== input.missionId
    || opened?.immutable !== true || opened?.verified !== true
    || opened?.plaintextResidual !== 'permission_restricted_session_open'
    || readMissionIdMatched !== true || review?.mutationDenied !== true
    || review?.denialAudited !== true || closed !== true
    || openInspection.regularFileCount < 1
    || openInspection.directoriesOwnerOnly !== true
    || openInspection.filesOwnerOnly !== true
    || openInspection.privacyCanaryDetected !== true
    || openInspection.exactSecretMatches !== 0
    || residualEntriesAfterClose !== 0
    || breadcrumbCount !== input.expectedBreadcrumbCount) {
    throw new Error('Packaged archive review did not prove the closed read-only lifecycle.')
  }
  return {
    opened: true,
    immutable: true,
    verified: true,
    plaintextResidual: opened.plaintextResidual,
    contentSha256,
    archiveIdMatched: true,
    readMissionIdMatched: true,
    breadcrumbCount,
    openResidualFileCount: openInspection.regularFileCount,
    openDirectoriesOwnerOnly: openInspection.directoriesOwnerOnly,
    openFilesOwnerOnly: openInspection.filesOwnerOnly,
    openPrivacyCanaryDetected: openInspection.privacyCanaryDetected,
    mutationAttempt: 'upsertMarker',
    mutationBoundary: 'preload_read_only',
    mutationDenied: true,
    denialAudited: true,
    closed: true,
    residualEntriesAfterClose,
  }
}

/** Kills the Electron main process on observed decrypt progress and retains the crash residual. */
async function interruptRestoreAtDecrypt(input) {
  const operationId = randomUUID()
  const bindingName = `__sartrackerArchiveSmokeProgress_${operationId.replaceAll('-', '')}`
  let inspectionStarted = false
  let settleTrigger
  let rejectTrigger
  const trigger = new Promise((resolve, reject) => {
    settleTrigger = resolve
    rejectTrigger = reject
  })
  await input.page.exposeFunction(bindingName, async (progress) => {
    if (progress?.operationId !== operationId || progress.phase !== 'decrypt') return false
    if (inspectionStarted) return false
    inspectionStarted = true
    try {
      const deadline = Date.now() + input.timeoutMs
      let inspection = null
      while (Date.now() < deadline) {
        if (input.launch.appProcess.exitCode !== null
          || input.launch.appProcess.signalCode !== null) {
          throw new Error('Electron exited before interrupted restore plaintext was observed.')
        }
        inspection = await inspectReviewResiduals(input.reviewRoot, {
          privacyCanary: MISSION_NAME,
          secrets: [input.secret],
        }).catch((error) => error?.code === 'ENOENT' ? null : Promise.reject(error))
        if (inspection?.regularFileCount > 0
          && inspection.privacyCanaryDetected === true
          && inspection.exactSecretMatches === 0) break
        await delay(25)
      }
      if (inspection?.regularFileCount < 1 || inspection.privacyCanaryDetected !== true) {
        throw new Error('Timed out before interrupted restore plaintext was materially observable.')
      }
      const requested = input.launch.appProcess.kill('SIGKILL')
      if (!requested) throw new Error('Electron rejected the restore SIGKILL request.')
      settleTrigger({ phase: progress.phase, inspection })
      return true
    } catch (error) {
      rejectTrigger(error)
      return false
    }
  })
  await input.page.evaluate((request) => {
    const archiveReview = window.sartrackerElectron?.archiveReview
    const callback = window[request.bindingName]
    if (archiveReview === undefined || typeof callback !== 'function') {
      throw new Error('Archive-review interruption bridge is unavailable.')
    }
    const unsubscribe = archiveReview.onProgress((progress) => {
      if (progress.operationId === request.operationId) void callback(progress)
    })
    void archiveReview.open({
      operationId: request.operationId,
      archiveId: request.archiveId,
      containerVersion: 2,
      slotType: 'passphrase',
      secret: request.secret,
    }).catch(() => undefined).finally(unsubscribe)
    return true
  }, {
    bindingName,
    operationId,
    archiveId: input.archive.id,
    secret: input.secret,
  })
  const observed = await withTimeout(
    trigger,
    input.timeoutMs,
    'Timed out waiting for archive-review decrypt progress.',
  )
  const exit = await withTimeout(
    input.launch.exit,
    30_000,
    'Timed out waiting for the SIGKILLed Electron process to exit.',
  )
  await input.launch.browser.close().catch(() => undefined)
  input.launch.exitResult = exit
  input.launch.closed = true
  if (exit.signal !== 'SIGKILL') {
    throw new Error('Interrupted archive review did not exit with exact SIGKILL.')
  }
  const residualEntriesBeforeRestart = await countResidualEntries(input.reviewRoot)
  if (residualEntriesBeforeRestart < 1) {
    throw new Error('Interrupted archive review left no app-addressable residual to sweep.')
  }
  const postKillInspection = await inspectReviewResiduals(input.reviewRoot, {
    privacyCanary: MISSION_NAME,
    secrets: [input.secret],
  })
  if (postKillInspection.regularFileCount < 1
    || postKillInspection.privacyCanaryDetected !== true
    || postKillInspection.exactSecretMatches !== 0) {
    throw new Error('Interrupted archive review residual was not a material secret-free plaintext file.')
  }
  return {
    triggerPhase: observed.phase,
    exitSignal: exit.signal,
    residualEntriesBeforeRestart,
    plaintextFileObservedBeforeRestart: true,
    privacyCanaryDetectedBeforeRestart: true,
  }
}

/** Confirms restart retained the exact verified archive through the public bridge. */
async function readRetainedArchive(page, missionId, expected) {
  const archives = await page.evaluate(async (selectedMissionId) => {
    const store = window.sartrackerElectron?.missionStore
    if (store === undefined) throw new Error('Mission-store preload bridge is unavailable.')
    return store.listMissionArchives(selectedMissionId)
  }, missionId)
  const retained = Array.isArray(archives)
    ? archives.find((archive) => archive.id === expected.id)
    : undefined
  if (retained?.status !== 'verified' || retained.availability !== 'present'
    || retained.container_version !== 2
    || retained.ciphertext_sha256 !== expected.ciphertext_sha256
    || retained.size_bytes !== expected.size_bytes) {
    throw new Error('Restart did not retain the exact verified archive identity.')
  }
  return retained
}

/** Checks the fresh-credential gate and performs eligibility-gated live-row cleanup. */
async function runCleanup(input) {
  const result = await input.page.evaluate(async (request) => {
    const store = window.sartrackerElectron?.missionStore
    if (store === undefined) throw new Error('Mission-store preload bridge is unavailable.')
    const eligibility = await store.getMissionCleanupEligibility({
      missionId: request.missionId,
      archiveId: request.archiveId,
    })
    const cleanup = await store.startMissionCleanup({
      missionId: request.missionId,
      archiveId: request.archiveId,
      operationId: request.operationId,
      slotType: 'passphrase',
      secret: request.secret,
      confirmation: request.missionName,
    })
    return { eligibility, cleanup }
  }, {
    missionId: input.missionId,
    missionName: input.missionName,
    archiveId: input.archiveId,
    operationId: randomUUID(),
    secret: input.secret,
  })
  const blockers = result.eligibility?.blockers
  const freshCredentialOnlyBlocker = Array.isArray(blockers)
    && blockers.length === 1
    && blockers[0] === 'fresh_non_machine_unlock_required'
  if (result.eligibility?.eligible !== false
    || result.eligibility?.startableWithCredential !== true
    || !freshCredentialOnlyBlocker
    || result.cleanup?.state !== 'completed'
    || result.cleanup?.storageState !== 'archived'
    || !Number.isSafeInteger(result.cleanup?.movedRows)
    || result.cleanup.movedRows < 0) {
    throw new Error('Packaged cleanup did not prove the eligibility-gated archived state.')
  }
  return {
    eligibilityChecked: true,
    eligibleBeforeCredential: false,
    freshCredentialOnlyBlocker,
    completed: true,
    storageState: result.cleanup.storageState,
    movedRows: result.cleanup.movedRows,
  }
}

/** Proves cleanup retained the mission timeline and exact encrypted archive. */
async function assertPostCleanupState(input) {
  const result = await input.page.evaluate(async (request) => {
    const store = window.sartrackerElectron?.missionStore
    if (store === undefined) throw new Error('Mission-store preload bridge is unavailable.')
    const [mission, archives, remainingBreadcrumbRows] = await Promise.all([
      store.getMission(request.missionId),
      store.listMissionArchives(request.missionId),
      store.countPositions(request.missionId),
    ])
    return { mission, archives, remainingBreadcrumbRows }
  }, { missionId: input.missionId })
  const retained = Array.isArray(result.archives)
    ? result.archives.find((archive) => archive.id === input.archive.id)
    : undefined
  if (result.mission?.status !== 'finalized' || result.mission?.storage_state !== 'archived'
    || retained?.status !== 'verified'
    || retained.ciphertext_sha256 !== input.archive.ciphertext_sha256
    || retained.size_bytes !== input.archive.size_bytes
    || result.remainingBreadcrumbRows !== 0) {
    throw new Error('Post-cleanup mission timeline or retained archive identity changed.')
  }
  return { remainingBreadcrumbRows: result.remainingBreadcrumbRows }
}

/** Launches one packaged Electron main process and connects to its sandboxed renderer. */
async function launchPackagedApp(options, userDataDir, number) {
  const remoteDebuggingPort = await findFreePort()
  const appProcess = spawn(
    options.appPath,
    [`--remote-debugging-port=${remoteDebuggingPort}`, ...options.extraArgs],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        SARTRACKER_ELECTRON_USER_DATA_PATH: userDataDir,
        SARTRACKER_ELECTRON_BLOCK_NETWORK: '1',
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    },
  )
  let launchError = null
  appProcess.once('error', (error) => { launchError = error })
  appProcess.stderr?.resume()
  const exit = new Promise((resolve) => {
    appProcess.once('exit', (code, signal) => resolve({ code, signal }))
  })
  let browser
  try {
    await waitForCdp(remoteDebuggingPort, appProcess, () => launchError)
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${remoteDebuggingPort}`)
    const context = browser.contexts()[0]
    const page = context.pages()[0] ?? await context.waitForEvent('page')
    await page.getByTestId('app-shell').waitFor({ state: 'attached', timeout: 60_000 })
    const visibleVersionText = await page.getByTestId('app-title').locator('..').innerText()
    const packagedBuildHeadMatched = visibleVersionText.includes(options.expectedHead)
    if (!packagedBuildHeadMatched) {
      throw new Error('Packaged operator-visible version did not contain the expected exact head.')
    }
    await page.waitForFunction(
      () => typeof window.sartrackerElectron?.missionStore?.createMission === 'function'
        && typeof window.sartrackerElectron?.archiveReview?.open === 'function',
      undefined,
      { timeout: 60_000 },
    )
    return {
      number,
      appProcess,
      browser,
      page,
      exit,
      exitResult: null,
      packagedBuildHeadMatched,
      closed: false,
    }
  } catch (error) {
    await browser?.close().catch(() => undefined)
    if (appProcess.exitCode === null && appProcess.signalCode === null) {
      appProcess.kill('SIGKILL')
    }
    await withTimeout(exit, 10_000, 'Electron launch cleanup timed out.').catch(() => undefined)
    throw error
  }
}

/** Stops one owned packaged process without touching unrelated Electron instances. */
async function stopLaunch(launch) {
  if (launch === null || launch === undefined) return null
  if (launch.closed === true) {
    return launch.exitResult ?? withTimeout(
      launch.exit,
      10_000,
      'Electron shutdown exit was not observable.',
    )
  }
  await launch.browser?.close().catch(() => undefined)
  if (launch.appProcess.exitCode === null && launch.appProcess.signalCode === null) {
    launch.appProcess.kill('SIGTERM')
    const terminated = await Promise.race([
      launch.exit.then(() => true),
      delay(5_000).then(() => false),
    ])
    if (!terminated && launch.appProcess.exitCode === null
      && launch.appProcess.signalCode === null) {
      launch.appProcess.kill('SIGKILL')
    }
  }
  const exitResult = await withTimeout(launch.exit, 10_000, 'Electron shutdown timed out.')
  launch.exitResult = exitResult
  launch.closed = true
  return exitResult
}

/** Polls the local renderer debugging endpoint while asserting the child is alive. */
async function waitForCdp(port, child, readLaunchError) {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    const launchError = readLaunchError()
    if (launchError instanceof Error) {
      throw new Error('Packaged Electron failed to start.')
    }
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error('Packaged Electron exited before renderer readiness.')
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`)
      if (response.ok) return
    } catch {
      // Renderer readiness is polled until the bounded deadline.
    }
    await delay(100)
  }
  throw new Error('Timed out waiting for packaged Electron renderer readiness.')
}

/** Allocates one loopback-only ephemeral debugging port. */
async function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') {
        server.close(() => reject(new Error('Could not allocate a renderer debugging port.')))
        return
      }
      server.close((error) => error === undefined ? resolve(address.port) : reject(error))
    })
  })
}

/** Reads exact repository head/tree/clean identity without mutating Git state. */
async function readSourceState() {
  const [head, tree, statusResult] = await Promise.all([
    runGit(['rev-parse', 'HEAD']),
    runGit(['rev-parse', 'HEAD^{tree}']),
    runGit(['status', '--porcelain=v1', '--untracked-files=all']),
  ])
  return { head: head.trim(), tree: tree.trim(), clean: statusResult.trim() === '' }
}

/** Runs one read-only Git command in the repository. */
async function runGit(args) {
  const result = await execFileAsync('git', args, {
    cwd: projectRoot,
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  })
  return result.stdout
}

/** Requires the exact expected clean source identity at one proof boundary. */
function assertExactCleanSource(source, expectedHead, phase) {
  if (source.head !== expectedHead || source.clean !== true
    || !/^[0-9a-f]{40}$/u.test(source.tree)) {
    throw new Error(`Repository source is not clean and exact-head ${phase} the packaged smoke.`)
  }
}

/** Recreates only the explicit bounded evidence directory. */
async function prepareEvidenceDirectory(directory, protectedPaths) {
  const resolved = path.resolve(directory)
  const root = path.parse(resolved).root
  const containsProtectedPath = protectedPaths.some((protectedPath) => {
    const relative = path.relative(resolved, path.resolve(protectedPath))
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
  })
  if (resolved === root || resolved === os.homedir() || resolved === projectRoot
    || resolved === path.resolve(os.tmpdir()) || containsProtectedPath) {
    throw new Error('Archive-lifecycle evidence directory is too broad to recreate safely.')
  }
  await rm(resolved, { recursive: true, force: true })
  await mkdir(resolved, { recursive: true, mode: 0o700 })
}

/** Sweeps only the disposable profile directory allocated by this smoke process. */
async function removeDisposableProfile(directory) {
  const resolved = path.resolve(directory)
  const temporaryRoot = path.resolve(os.tmpdir())
  if (path.dirname(resolved) !== temporaryRoot
    || !path.basename(resolved).startsWith('sartracker-pr6-archive-smoke-')) {
    throw new Error('Disposable archive-smoke profile path is outside its owned boundary.')
  }
  await rm(resolved, { recursive: true, force: true })
}

/** Requires one packaged payload to be a regular non-symlink file. */
async function requireRegularFileNoSymlink(filePath, label) {
  const identity = await lstat(filePath)
  if (identity.isSymbolicLink() || !identity.isFile()) {
    throw new Error(`${label} is not one regular non-symlink file.`)
  }
  return identity
}

/** Inspects one live Review scratch tree without following symlinks. */
async function inspectReviewResiduals(root, input) {
  const privacyCanary = Buffer.from(input.privacyCanary, 'utf8')
  const secretBuffers = input.secrets.map((secret) => Buffer.from(secret, 'utf8'))
  if (privacyCanary.length < 1 || secretBuffers.length < 1
    || secretBuffers.some((secret) => secret.length < 1)) {
    throw new Error('Archive Review residual inspection input is invalid.')
  }
  let regularFileCount = 0
  let directoriesOwnerOnly = true
  let filesOwnerOnly = true
  let privacyCanaryMatches = 0
  let exactSecretMatches = 0
  /** Recursively inspects only pinned directory entries. */
  const visit = async (directory) => {
    const directoryIdentity = await lstat(directory)
    if (directoryIdentity.isSymbolicLink() || !directoryIdentity.isDirectory()) {
      throw new Error('Archive Review scratch tree contains a non-directory boundary.')
    }
    if ((directoryIdentity.mode & 0o777) !== 0o700) directoriesOwnerOnly = false
    const entries = await readdir(directory)
    for (const name of entries) {
      const entryPath = path.join(directory, name)
      const identity = await lstat(entryPath)
      if (identity.isSymbolicLink()) {
        throw new Error('Archive Review scratch tree contains a symbolic link.')
      }
      if (identity.isDirectory()) {
        await visit(entryPath)
      } else if (identity.isFile()) {
        regularFileCount += 1
        if ((identity.mode & 0o777) !== 0o600) filesOwnerOnly = false
        privacyCanaryMatches += await countExactSecretsInFile(entryPath, [privacyCanary])
        exactSecretMatches += await countExactSecretsInFile(entryPath, secretBuffers)
      } else {
        throw new Error('Archive Review scratch tree contains a non-regular entry.')
      }
    }
  }
  try {
    await visit(root)
    return {
      regularFileCount,
      directoriesOwnerOnly,
      filesOwnerOnly,
      privacyCanaryDetected: privacyCanaryMatches > 0,
      exactSecretMatches,
    }
  } finally {
    privacyCanary.fill(0)
    secretBuffers.forEach((secret) => secret.fill(0))
  }
}

/** Counts every app-addressable file or directory below the review scratch root. */
async function countResidualEntries(root) {
  const entries = await readdir(root, { withFileTypes: true }).catch((error) => {
    if (error?.code === 'ENOENT') return []
    throw error
  })
  let count = 0
  for (const entry of entries) {
    count += 1
    if (entry.isDirectory()) {
      count += await countResidualEntries(path.join(root, entry.name))
    }
  }
  return count
}

/** Counts app-addressable create, verification, and Review scratch residuals. */
async function countArchiveLifecycleResidualEntries(userDataDir) {
  const roots = [
    path.join(userDataDir, 'archives', '.staging'),
    path.join(userDataDir, 'archives', '.verification'),
    path.join(userDataDir, 'archive-review'),
  ]
  const counts = await Promise.all(roots.map((root) => countResidualEntries(root)))
  return counts.reduce((total, count) => total + count, 0)
}

/** Scans every regular profile file for the exact two ephemeral custody values. */
async function scanProfileForExactSecrets(root, secrets) {
  const secretBuffers = secrets.map((secret) => Buffer.from(secret, 'utf8'))
  if (secretBuffers.some((secret) => secret.length < 1)) {
    throw new Error('Archive custody scan input is invalid.')
  }
  let filesScanned = 0
  let matches = 0
  /** Recursively scans regular files without following symbolic links. */
  const visit = async (directory) => {
    const entries = await readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        await visit(entryPath)
      } else if (entry.isFile()) {
        filesScanned += 1
        matches += await countExactSecretsInFile(entryPath, secretBuffers)
      }
    }
  }
  await visit(root)
  return { filesScanned, matches }
}

/** Counts exact byte-string matches in one file without loading it wholesale. */
async function countExactSecretsInFile(filePath, secrets) {
  const maximumSecretBytes = Math.max(...secrets.map((secret) => secret.length))
  let carry = Buffer.alloc(0)
  let processedBytes = 0
  let matches = 0
  for await (const chunk of createReadStream(filePath)) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    const combined = Buffer.concat([carry, bytes])
    const combinedStart = processedBytes - carry.length
    for (const secret of secrets) {
      let offset = 0
      while (offset <= combined.length - secret.length) {
        const found = combined.indexOf(secret, offset)
        if (found < 0) break
        const globalEnd = combinedStart + found + secret.length
        if (globalEnd > processedBytes) matches += 1
        offset = found + 1
      }
    }
    processedBytes += bytes.length
    carry = combined.subarray(Math.max(0, combined.length - maximumSecretBytes + 1))
  }
  return matches
}

/** Streams one file into a lower-case SHA-256 digest. */
async function sha256File(filePath) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filePath)) hash.update(chunk)
  return hash.digest('hex')
}

/** Hashes one bounded non-secret evidence label. */
function sha256Text(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

/** Creates a high-entropy archive passphrase that never crosses CLI or environment. */
function createEphemeralPassphrase() {
  return `Archive!${randomBytes(24).toString('base64url')}9aA`
}

/** Returns one sorted unique phase list for deterministic evidence. */
function sortedUnique(values) {
  return [...new Set(values)].sort()
}

/** Applies one rejecting timeout without blocking the event loop. */
async function withTimeout(promise, timeoutMs, message) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

/** Waits for one short lifecycle interval. */
function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

/** Removes custody-like values and local paths from one terminal failure message. */
function sanitizeFailureMessage(error) {
  let source = error instanceof Error ? error.message : String(error)
  for (const secret of [passphrase, recoveryCode]) {
    if (secret !== '') source = source.replaceAll(secret, '[REDACTED]')
  }
  return source
    .replaceAll(/(?:[0-9A-HJKMNP-TV-Z]{5}-){7}[0-9A-HJKMNP-TV-Z]{5}/gu, '[REDACTED]')
    .replaceAll(/(?:\/[^\s:]+)+/gu, '[PATH]')
    .slice(0, FAILURE_MESSAGE_LIMIT)
}
