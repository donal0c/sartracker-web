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
  rename,
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
  archiveLifecycleSmokeBatchInsertedEveryRow,
  assertArchiveLifecycleSmokeEvidenceOmitsSecrets,
  parseArchiveLifecycleSmokeArgs,
  projectArchiveLifecycleSmokeClosedReviewSemantic,
  renderedVersionContainsExactHead,
  resolvePackagedApplicationArchivePath,
  validateArchiveLifecycleSmokeEvidence,
} from '../build/electron-archive-lifecycle-smoke-lib.js'
import {
  startArchiveLifecycleLivenessMockTraccarServer,
} from '../build/electron-archive-lifecycle-liveness-mock-traccar.js'

const execFileAsync = promisify(execFile)
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MISSION_NAME = 'Packaged Archive Lifecycle Proof'
const POSITION_CHUNK_SIZE = 512
const REPLAY_MARKER_COUNT = 101
const REPLAY_OUTING_COUNT = 101
const REPLAY_OBJECT_COUNT = REPLAY_MARKER_COUNT + REPLAY_OUTING_COUNT
const GPX_IMPORT_BATCH_SIZE = 100
const FAILURE_MESSAGE_LIMIT = 400
const LIVENESS_PHASES = Object.freeze(['create', 'verify', 'restore', 'cleanup'])
const LIVENESS_OPERATION_KIND_PATTERN = /^[a-z][a-z0-9_]{0,47}$/u
const LIVENESS_HARD_GATE_MS = 200
const LIVENESS_POLL_INTERVAL_MS = 50
const RENDERER_LIVENESS_LEDGER_CAPACITY = 256
const LIVENESS_MISSION_NAME = 'Packaged Archive Liveness Probe'
const LIVENESS_EMAIL = 'archive-liveness@example.invalid'
const LIVENESS_SECRET = 'synthetic-archive-liveness-secret'
const CLEANUP_STEP_LIMIT = 8
const CLEANUP_FAILURE_DETAIL_LIMIT = CLEANUP_STEP_LIMIT + 1
const CLEANUP_STEP_NAME_LIMIT = 48
const CLEANUP_STEP_NAME_PATTERN = /^[a-z][a-z0-9_]*$/u
const LIVENESS_PROBE_STOP_STEP = 'liveness_probe_stop'
const PROFILE_REMOVAL_STEP = 'profile_removal'
const UNREADABLE_CLEANUP_DETAIL_STEP_PREFIX = 'cleanup_detail_unreadable_'
const UNREADABLE_CLEANUP_DETAIL_MESSAGE = 'Archive-lifecycle cleanup failure detail was unreadable.'
const DIAGNOSTIC_ARRAY_LIMIT = 16
const DIAGNOSTIC_ENTRY_LIMIT = 96
const DIAGNOSTIC_DEPTH_LIMIT = 5
const FAILURE_MESSAGE_INPUT_LIMIT = 4_096
const UNSAFE_FAILURE_MESSAGE = 'Archive-lifecycle failure did not expose a safe message.'
const OVERSIZED_FAILURE_MESSAGE = 'Archive-lifecycle failure message exceeded the bounded evidence limit.'
const OMITTED_DIAGNOSTIC_VALUE = Symbol('omitted_archive_lifecycle_diagnostic_value')
const ARCHIVE_LIFECYCLE_DIAGNOSTIC_KEYS = new Set([
  'activeLaunchNumber',
  'activePhase',
  'auditedAtMs',
  'cleanup',
  'create',
  'currentFixContinuity',
  'currentFixMaxGapMs',
  'currentFixTimeout',
  'emittedAtMs',
  'endedAtMs',
  'errorKinds',
  'freshSampleCount',
  'gapMs',
  'gapType',
  'intervalStartedAtMs',
  'invalidRendererFrame',
  'kind',
  'latestAcknowledgedSequence',
  'latestEmittedAtMs',
  'latestReceivedSequence',
  'latestRequestAgeMs',
  'latestRequestStartedAtMs',
  'latestSourceAgeMs',
  'mainSampleCount',
  'mainWatchdogMaxGapMs',
  'operationCount',
  'operationOverflowCount',
  'operations',
  'oldestPendingRequestAgeMs',
  'oldestPendingSourceAgeMs',
  'pendingCount',
  'phase',
  'phaseMetrics',
  'previousObservedAtMs',
  'rendererFrameMaxGapMs',
  'rendererFrameSampleCount',
  'rendererCurrentFixMonotonicTail',
  'requestAgeMs',
  'requestStartedAtMs',
  'requestToRendererMaxMs',
  'restore',
  'sampleCount',
  'sourceAgeMs',
  'sourceCadence',
  'sourceToRendererMaxMs',
  'startedAtMs',
  'verify',
])

let activeLaunch = null
let passphrase = ''
let recoveryCode = ''

if (process.argv[1] !== undefined
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(async (error) => {
    await stopLaunch(activeLaunch).catch(() => undefined)
    const sanitized = sanitizeFailureMessage(error)
    passphrase = ''
    recoveryCode = ''
    console.error(`electron-archive-lifecycle-smoke: ${sanitized}`)
    process.exitCode = 1
  })
}

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
  const startedAtMs = Date.now()
  const observedLaunchExits = []
  const packagedBuildHeadMatches = []
  let userDataDir = null
  let packagedApplicationArchivePath
  let packagedExecutableSha256
  let packagedApplicationArchiveSha256
  let initialLaunch
  let restartedLaunch
  let mockServer
  let livenessProbe
  let successEvidence = null
  let successReportPath = null
  let lifecycleFailure = null
  let profileCleanupCompleted = false
  try {
    userDataDir = await mkdtemp(path.join(os.tmpdir(), 'sartracker-pr6-archive-smoke-'))
    packagedApplicationArchivePath = resolvePackagedApplicationArchivePath(
      options.appPath,
      process.platform,
    )
    await requireRegularFileNoSymlink(
      packagedApplicationArchivePath,
      'Packaged application archive',
    )
    packagedExecutableSha256 = await sha256File(options.appPath)
    packagedApplicationArchiveSha256 = await sha256File(packagedApplicationArchivePath)
    passphrase = createEphemeralPassphrase()
    mockServer = await startArchiveLifecycleLivenessMockTraccarServer()
    await seedLivenessRuntimeConfiguration(userDataDir, mockServer.baseUrl)
    initialLaunch = await launchPackagedApp(options, userDataDir, 1)
    packagedBuildHeadMatches.push(initialLaunch.packagedBuildHeadMatched)
    activeLaunch = initialLaunch
    const seeded = await seedAndFinishMission(
      initialLaunch.page,
      options.seedPositionRows,
      path.join(userDataDir, 'archive-lifecycle-input-fixtures'),
    )
    livenessProbe = createPackagedLivenessProbe(mockServer)
    await livenessProbe.attachLaunch(initialLaunch)
    const livenessMission = await startLivenessMission(
      initialLaunch.page,
      mockServer.deviceId,
    )
    await livenessProbe.setPhase('create')
    await livenessProbe.waitForPhaseSample('create', options.timeoutMs)
    const [createOperation, verifyOperation] = await livenessProbe.beginPhaseOperations(
      ['create', 'verify'],
      ['finalize_archive', 'verify_archive'],
    )
    const finalized = await livenessProbe.guardOperation(finalizeAndVerifyArchive(
      initialLaunch.page,
      seeded.missionId,
      passphrase,
      (phase) => livenessProbe.setPhaseFromRenderer(phase),
    ), [createOperation, verifyOperation])
    await livenessProbe.setPhase('verify')
    await livenessProbe.completePhaseOperation(createOperation)
    await livenessProbe.completePhaseOperation(verifyOperation)
    const reviewSelectedTime = finalized.mission.finish_time
    const reviewSelectedTimeMs = Date.parse(reviewSelectedTime ?? '')
    if (typeof reviewSelectedTime !== 'string'
      || !Number.isFinite(reviewSelectedTimeMs)
      || new Date(reviewSelectedTimeMs).toISOString() !== reviewSelectedTime) {
      throw new Error('Packaged finalized mission did not retain one canonical finish-time fence.')
    }
    recoveryCode = finalized.recoveryCode
    await livenessProbe.setPhase('restore')
    await livenessProbe.waitForPhaseSample('restore', options.timeoutMs)
    const firstReviewOperation = await livenessProbe.beginPhaseOperation(
      'restore',
      'review_before_cleanup',
    )
    const firstReview = await livenessProbe.guardOperation(runReadOnlyReview({
      page: initialLaunch.page,
      archive: finalized.archive,
      missionId: seeded.missionId,
      secret: passphrase,
      secrets: [passphrase, recoveryCode],
      reviewRoot: path.join(userDataDir, 'archive-review'),
      expectedBreadcrumbCount: seeded.seededPositionRows,
      expectedObjectCount: seeded.seededReplayObjectRows,
      expectedOutingFilterCount: seeded.seededOutingChoices,
      selectedTime: reviewSelectedTime,
    }), firstReviewOperation)
    await livenessProbe.completePhaseOperation(firstReviewOperation)
    const interruptedRestoreOperation = await livenessProbe.beginPhaseOperation(
      'restore',
      'interrupt_decrypt',
    )
    const interruption = await livenessProbe.guardOperation(interruptRestoreAtDecrypt({
      launch: initialLaunch,
      archive: finalized.archive,
      secret: passphrase,
      timeoutMs: options.timeoutMs,
      reviewRoot: path.join(userDataDir, 'archive-review'),
      beforeKill: async () => {
        await livenessProbe.endPhaseOperation(interruptedRestoreOperation)
        await livenessProbe.completePhaseOperation(interruptedRestoreOperation)
        await livenessProbe.detachLaunch(initialLaunch)
      },
    }))
    const restoreSamplesBeforeRestart = livenessProbe.phaseSampleCount('restore')
    observedLaunchExits.push({ number: initialLaunch.number, signal: interruption.exitSignal })
    initialLaunch = null
    activeLaunch = null

    restartedLaunch = await launchPackagedApp(options, userDataDir, 2)
    packagedBuildHeadMatches.push(restartedLaunch.packagedBuildHeadMatched)
    activeLaunch = restartedLaunch
    await resumeLivenessMission(
      restartedLaunch.page,
      livenessMission.mission.id,
      mockServer.deviceId,
      livenessMission.participantScopeRequired,
    )
    await livenessProbe.attachLaunch(restartedLaunch)
    await livenessProbe.setPhase('restore')
    const resumedRestoreOperation = await livenessProbe.beginPhaseOperation(
      'restore',
      'resume_interrupted_restore',
    )
    await livenessProbe.guardOperation((async () => {
      await livenessProbe.waitForPhaseSample(
        'restore',
        options.timeoutMs,
        resumedRestoreOperation.sampleCount + 1,
      )
    })(), resumedRestoreOperation)
    await livenessProbe.completePhaseOperation(resumedRestoreOperation)
    if (livenessProbe.phaseSampleCount('restore') <= restoreSamplesBeforeRestart) {
      throw new Error('Archive-lifecycle restore liveness did not resume after restart.')
    }
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
    await livenessProbe.setPhase('cleanup')
    await livenessProbe.waitForPhaseSample('cleanup', options.timeoutMs)
    const cleanupOperation = await livenessProbe.beginPhaseOperation(
      'cleanup',
      'cleanup_pending_restore',
    )
    const cleanupResult = await livenessProbe.guardOperation(runCleanup({
      page: restartedLaunch.page,
      missionId: seeded.missionId,
      missionName: MISSION_NAME,
      archiveId: finalized.archive.id,
      secret: passphrase,
    }), cleanupOperation)
    await livenessProbe.completePhaseOperation(cleanupOperation)
    await livenessProbe.setPhase('restore')
    const secondReviewOperation = await livenessProbe.beginPhaseOperation(
      'restore',
      'review_after_cleanup',
    )
    const secondReview = await livenessProbe.guardOperation(runReadOnlyReview({
      page: restartedLaunch.page,
      archive: retainedAfterRestart,
      missionId: seeded.missionId,
      secret: passphrase,
      secrets: [passphrase, recoveryCode],
      reviewRoot: path.join(userDataDir, 'archive-review'),
      expectedBreadcrumbCount: seeded.seededPositionRows,
      expectedObjectCount: seeded.seededReplayObjectRows,
      expectedOutingFilterCount: seeded.seededOutingChoices,
      selectedTime: reviewSelectedTime,
    }), secondReviewOperation)
    await livenessProbe.completePhaseOperation(secondReviewOperation)
    await livenessProbe.detachLaunch(restartedLaunch)
    const liveness = await livenessProbe.finish()
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
    successEvidence = {
      schemaVersion: 2,
      proofKind: 'packaged-electron-archive-lifecycle-v2',
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
        seededOutingChoices: seeded.seededOutingChoices,
        seededPositionRows: seeded.seededPositionRows,
        seededReplayObjectRows: seeded.seededReplayObjectRows,
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
      liveness,
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
    assertArchiveLifecycleSmokeEvidenceOmitsSecrets(successEvidence, [passphrase, recoveryCode])
    const validation = validateArchiveLifecycleSmokeEvidence(successEvidence)
    if (!validation.passed) {
      throw new Error(`Packaged archive-lifecycle evidence failed ${validation.failureReasons.length} closed gate(s).`)
    }
  } catch (error) {
    lifecycleFailure = error
  }

  const cleanup = await cleanupArchiveLifecycleResources({
    failure: lifecycleFailure,
    profilePath: userDataDir,
    removeProfile: removeDisposableProfile,
    steps: [
      {
        name: LIVENESS_PROBE_STOP_STEP,
        blocksProfileCleanup: false,
        run: () => livenessProbe?.stop(lifecycleFailure),
      },
      {
        name: 'restarted_launch_stop',
        blocksProfileCleanup: true,
        run: async () => {
          try {
            await stopLaunch(restartedLaunch)
          } catch (error) {
            activeLaunch = restartedLaunch ?? activeLaunch
            throw error
          }
        },
      },
      {
        name: 'initial_launch_stop',
        blocksProfileCleanup: true,
        run: async () => {
          try {
            await stopLaunch(initialLaunch)
          } catch (error) {
            activeLaunch = initialLaunch ?? activeLaunch
            throw error
          }
        },
      },
      {
        name: 'mock_server_close',
        blocksProfileCleanup: false,
        run: () => mockServer?.close(),
      },
    ],
  })
  lifecycleFailure = cleanup.failure
  profileCleanupCompleted = cleanup.profileCleanupCompleted
  if (cleanup.processCleanupCompleted) activeLaunch = null

  if (lifecycleFailure === null && successEvidence === null) {
    lifecycleFailure = new Error('Archive-lifecycle success evidence state is incomplete.')
  }
  if (lifecycleFailure === null) {
    try {
      successReportPath = await writeArchiveLifecycleSuccessReport({
        evidence: successEvidence,
        evidenceDir: options.evidenceDir,
      })
    } catch (error) {
      lifecycleFailure = error
    }
  }
  if (lifecycleFailure !== null) {
    const secrets = [passphrase, recoveryCode].filter((value) => value !== '')
    let failureReportPath
    try {
      failureReportPath = await writeArchiveLifecycleFailureReceipt({
        evidenceDir: options.evidenceDir,
        error: lifecycleFailure,
        expectedHead: options.expectedHead,
        observedLaunchCount: packagedBuildHeadMatches.length,
        processCleanupCompleted: cleanup.processCleanupCompleted,
        profileCleanupCompleted,
        cleanupFailureCount: cleanup.cleanupFailureCount,
        cleanupFailures: cleanup.cleanupFailures,
        secrets,
        sourceBefore,
        startedAtMs,
      })
    } catch (publicationError) {
      throw new AggregateError(
        [lifecycleFailure, publicationError],
        'Archive-lifecycle run failed and its terminal failure receipt could not be published.',
      )
    }
    console.error(`electron-archive-lifecycle-smoke: failure-report=${failureReportPath}`)
    throw lifecycleFailure
  }
  console.log(`electron-archive-lifecycle-smoke: passed; report=${successReportPath}`)
  passphrase = ''
  recoveryCode = ''
}

/** Creates a bounded mission and deterministic breadcrumb evidence through preload IPC. */
async function seedAndFinishMission(page, seededPositionRows, fixtureRoot) {
  const mission = await page.evaluate(async (missionName) => {
    const store = window.sartrackerElectron?.missionStore
    if (store === undefined) throw new Error('Mission-store preload bridge is unavailable.')
    const created = await store.createMission({
      name: missionName,
      start_time: '2026-08-29T08:00:00.000Z',
    })
    if (created?.status !== 'active' || typeof created.id !== 'string') {
      throw new Error('Packaged mission creation returned an invalid result.')
    }
    await store.upsertDevice({
      mission_id: created.id,
      device_id: 'archive-smoke-tracker',
      name: 'Archive Smoke Tracker',
      color: '#0077AA',
      status: 'online',
    })
    return created
  }, MISSION_NAME)

  const baseMs = Date.parse('2026-08-29T08:00:01.000Z')
  for (let offset = 0; offset < seededPositionRows; offset += POSITION_CHUNK_SIZE) {
    const length = Math.min(POSITION_CHUNK_SIZE, seededPositionRows - offset)
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
    const result = await page.evaluate(async (input) => {
      const store = window.sartrackerElectron?.missionStore
      if (store === undefined) throw new Error('Mission-store preload bridge is unavailable.')
      return store.addPositionsBulk(input)
    }, { mission_id: mission.id, positions })
    if (!archiveLifecycleSmokeBatchInsertedEveryRow(result, length)) {
      throw new Error('Packaged breadcrumb seed did not insert every requested row.')
    }
  }

  const continuationEvidence = await seedReplayContinuationEvidence({
    page,
    missionId: mission.id,
    fixtureRoot,
  })
  const finishedMission = await page.evaluate(async ({ missionId, createdStatus, rowCount }) => {
    const store = window.sartrackerElectron?.missionStore
    if (store === undefined) throw new Error('Mission-store preload bridge is unavailable.')
    const persistedCount = await store.countPositions(missionId)
    if (persistedCount !== rowCount) {
      throw new Error('Packaged breadcrumb row count did not match the bounded seed.')
    }
    const finished = await store.finishMission(missionId)
    if (finished?.status !== 'finished') {
      throw new Error('Packaged mission finish returned an invalid result.')
    }
    return {
      missionId,
      createdStatus,
      finishedStatus: finished.status,
      seededPositionRows: persistedCount,
    }
  }, {
    missionId: mission.id,
    createdStatus: mission.status,
    rowCount: seededPositionRows,
  })
  return { ...finishedMission, ...continuationEvidence }
}

/** Seeds real object and outing-filter continuation pages through the public preload bridge. */
async function seedReplayContinuationEvidence(input) {
  await mkdir(input.fixtureRoot, { recursive: true, mode: 0o700 })
  const gpxPaths = await Promise.all(Array.from(
    { length: REPLAY_OUTING_COUNT },
    async (_unused, index) => {
      const suffix = String(index + 1).padStart(3, '0')
      const firstLat = (52.1 + index / 100_000).toFixed(6)
      const secondLat = (52.1001 + index / 100_000).toFixed(6)
      const filePath = path.join(input.fixtureRoot, `archive-smoke-${suffix}.gpx`)
      const contents = `<gpx version="1.1" creator="sartracker-packaged-smoke"><trk><name>Archive smoke ${suffix}</name><trkseg><trkpt lat="${firstLat}" lon="-9.500000"/><trkpt lat="${secondLat}" lon="-9.500100"/></trkseg></trk></gpx>`
      await writeFile(filePath, contents, { encoding: 'utf8', mode: 0o600 })
      return filePath
    },
  ))
  let seeded
  try {
    seeded = await input.page.evaluate(async (request) => {
      const store = window.sartrackerElectron?.missionStore
      if (store === undefined
        || typeof store.upsertMarker !== 'function'
        || typeof store.createOuting !== 'function'
        || typeof store.endOuting !== 'function'
        || typeof store.importGpxEvidencePaths !== 'function'
        || typeof store.assignGpxImportToOuting !== 'function') {
        throw new Error('Replay continuation preload bridge is unavailable.')
      }
      for (let index = 0; index < request.markerCount; index += 1) {
        const suffix = String(index + 1).padStart(3, '0')
        const marker = await store.upsertMarker({
          id: `archive-smoke-marker-${suffix}`,
          mission_id: request.missionId,
          type: 'clue',
          name: `Archive smoke marker ${suffix}`,
          lat: 52.2 + index / 100_000,
          lon: -9.6 - index / 100_000,
          irish_grid_e: 500_000 + index,
          irish_grid_n: 600_000 + index,
          display_order: index,
          updated_by: 'packaged-smoke',
        })
        if (marker?.id !== `archive-smoke-marker-${suffix}`
          || marker.mission_id !== request.missionId) {
          throw new Error('Packaged marker continuation seed returned an invalid result.')
        }
      }
      const outings = []
      const outingBaseMs = Date.parse('2026-08-29T08:00:00.000Z')
      for (let index = 0; index < request.outingCount; index += 1) {
        const suffix = String(index + 1).padStart(3, '0')
        const startedAt = new Date(outingBaseMs + index * 2_000).toISOString()
        const endedAt = new Date(outingBaseMs + index * 2_000 + 1_000).toISOString()
        const outing = await store.createOuting({
          mission_id: request.missionId,
          label: `Archive smoke outing ${suffix}`,
          started_at: startedAt,
        })
        const ended = await store.endOuting({
          mission_id: request.missionId,
          outing_id: outing.id,
          ended_at: endedAt,
        })
        if (ended?.id !== outing.id || ended.ended_at !== endedAt) {
          throw new Error('Packaged outing continuation seed returned an invalid result.')
        }
        outings.push(ended)
      }
      const imports = []
      for (let offset = 0; offset < request.gpxPaths.length; offset += request.importBatchSize) {
        const batch = await store.importGpxEvidencePaths({
          missionId: request.missionId,
          paths: request.gpxPaths.slice(offset, offset + request.importBatchSize),
        })
        if (!Array.isArray(batch?.imports) || !Array.isArray(batch.failures)
          || batch.failures.length !== 0) {
          throw new Error('Packaged GPX continuation seed did not import every source.')
        }
        imports.push(...batch.imports)
      }
      if (imports.length !== request.outingCount
        || new Set(imports.map((entry) => entry?.id)).size !== request.outingCount) {
        throw new Error('Packaged GPX continuation seed returned duplicate or missing imports.')
      }
      for (let index = 0; index < imports.length; index += 1) {
        const assigned = await store.assignGpxImportToOuting({
          import_id: imports[index].id,
          outing_id: outings[index].id,
          assigned_by: 'packaged-smoke',
        })
        if (assigned?.id !== imports[index].id
          || assigned.outing_id !== outings[index].id) {
          throw new Error('Packaged GPX outing assignment returned an invalid result.')
        }
      }
      const [markers, retainedOutings] = await Promise.all([
        store.listMarkers(request.missionId),
        store.listOutings(request.missionId),
      ])
      if (!Array.isArray(markers) || markers.length !== request.markerCount
        || !Array.isArray(retainedOutings) || retainedOutings.length !== request.outingCount) {
        throw new Error('Packaged Replay continuation seed did not retain every live object.')
      }
      return {
        seededReplayObjectRows: markers.length + retainedOutings.length,
        seededOutingChoices: imports.length,
      }
    }, {
      missionId: input.missionId,
      markerCount: REPLAY_MARKER_COUNT,
      outingCount: REPLAY_OUTING_COUNT,
      importBatchSize: GPX_IMPORT_BATCH_SIZE,
      gpxPaths,
    })
  } finally {
    await rm(input.fixtureRoot, { recursive: true, force: true })
  }
  if (await countResidualEntries(input.fixtureRoot) !== 0
    || seeded?.seededReplayObjectRows !== REPLAY_OBJECT_COUNT
    || seeded?.seededOutingChoices !== REPLAY_OUTING_COUNT) {
    throw new Error('Packaged Replay continuation seed did not close its exact fixture scope.')
  }
  return seeded
}

/** Finalizes through the independent verifier integrated into the public preload lifecycle. */
async function finalizeAndVerifyArchive(page, missionId, secret, onPhase) {
  const issuance = await page.evaluate(async (selectedMissionId) => {
    const store = window.sartrackerElectron?.missionStore
    if (store === undefined) throw new Error('Mission-store preload bridge is unavailable.')
    return store.issueMissionArchiveRecoveryCode(selectedMissionId)
  }, missionId)
  if (typeof issuance?.operationId !== 'string' || typeof issuance?.recoveryCode !== 'string') {
    throw new Error('Packaged recovery issuance was invalid.')
  }
  const phaseBindingName = `__sartrackerArchiveLivenessPhase_${issuance.operationId.replaceAll('-', '')}`
  await page.exposeFunction(phaseBindingName, (phase) => onPhase(phase))
  const finalized = await page.evaluate(async (input) => {
    const bridge = window.sartrackerElectron
    if (bridge?.missionStore === undefined
      || typeof bridge.onMissionArchiveProgress !== 'function') {
      throw new Error('Archive preload bridge is unavailable.')
    }
    const progressEntries = []
    const livenessTransitions = []
    let latestLivenessPhase = null
    const unsubscribe = bridge.onMissionArchiveProgress((progress) => {
      if (progress.operationId === input.operationId) {
        progressEntries.push({ kind: progress.kind, phase: progress.phase })
        if ((progress.kind === 'create' || progress.kind === 'verify')
          && progress.kind !== latestLivenessPhase) {
          latestLivenessPhase = progress.kind
          livenessTransitions.push(window[input.phaseBindingName](progress.kind))
        }
      }
    })
    try {
      const result = await bridge.missionStore.finalizeMission(input.missionId, {
        operationId: input.operationId,
        passphrase: input.passphrase,
        recoveryCode: input.recoveryCode,
      })
      await Promise.all(livenessTransitions)
      return { result, progressEntries }
    } finally {
      unsubscribe()
    }
  }, {
    missionId,
    operationId: issuance.operationId,
    passphrase: secret,
    recoveryCode: issuance.recoveryCode,
    phaseBindingName,
  })
  const archive = finalized?.result?.archive
  const projectedMission = finalized?.result?.mission
  if (projectedMission?.id !== missionId || projectedMission.status !== 'finalized'
    || archive?.mission_id !== missionId || archive.container_version !== 2
    || archive.status !== 'verified' || archive.availability !== 'present'
    || typeof archive.ciphertext_sha256 !== 'string'
    || !Number.isSafeInteger(archive.size_bytes) || archive.size_bytes < 1) {
    throw new Error('Packaged finalization did not return one verified encrypted archive.')
  }
  const persistedMission = await page.evaluate(async (selectedMissionId) => {
    const store = window.sartrackerElectron?.missionStore
    if (store === undefined) throw new Error('Mission-store preload bridge is unavailable.')
    return store.getMission(selectedMissionId)
  }, missionId)
  if (persistedMission?.id !== missionId || persistedMission.status !== 'finalized') {
    throw new Error('Packaged finalization did not persist one finalized mission.')
  }
  const createProgressPhases = finalized.progressEntries
    .filter((entry) => entry.kind === 'create')
    .map((entry) => entry.phase)
  const verifyProgressPhases = finalized.progressEntries
    .filter((entry) => entry.kind === 'verify')
    .map((entry) => entry.phase)
  return {
    mission: persistedMission,
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
  const selectedTime = input.selectedTime
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
      const replayQuery = {
        missionId: request.missionId,
        selectedTime: request.selectedTime,
        timezone: 'Europe/Dublin',
        trackLimit: 1_000,
        objectLimit: 100,
      }
      const initialReplayResult = await archiveReview.read({
        sessionId: request.sessionId,
        requestId: request.replayRequestId,
        method: 'readMissionReplay',
        input: replayQuery,
      })
      if (!Number.isSafeInteger(initialReplayResult?.totalTrackCount)
        || initialReplayResult.totalTrackCount < 0
        || !Number.isSafeInteger(initialReplayResult?.totalObjectCount)
        || initialReplayResult.totalObjectCount < 0
        || !Number.isSafeInteger(initialReplayResult?.availableOutingTotalCount)
        || initialReplayResult.availableOutingTotalCount < 0) {
        throw new Error('Packaged Replay initial declared totals are invalid.')
      }
      const maximumTrackPages = initialReplayResult.totalTrackCount + 1
      const maximumObjectPages = initialReplayResult.totalObjectCount + 1
      const maximumOutingFilterPages = initialReplayResult.availableOutingTotalCount + 1
      const trackPages = []
      const seenTrackCursors = new Set()
      let trackCursor = initialReplayResult?.nextCursor
      while (trackCursor !== null) {
        if (typeof trackCursor !== 'string' || trackCursor.length < 1
          || seenTrackCursors.has(trackCursor) || trackPages.length >= maximumTrackPages) {
          throw new Error('Packaged Replay track paging is cyclic or unbounded.')
        }
        seenTrackCursors.add(trackCursor)
        const pageRequest = { ...replayQuery, cursor: trackCursor }
        const result = await archiveReview.read({
          sessionId: request.sessionId,
          requestId: crypto.randomUUID(),
          method: 'readMissionReplayTrackChunk',
          input: pageRequest,
        })
        trackPages.push({ request: pageRequest, result })
        if (!Array.isArray(result?.tracks)
          || (result.tracks.length === 0 && result.nextCursor !== null)) {
          throw new Error('Packaged Replay track paging returned an empty nonterminal page.')
        }
        trackCursor = result.nextCursor
      }
      const objectPages = []
      const seenObjectCursors = new Set()
      let objectCursor = initialReplayResult?.nextObjectCursor
      while (objectCursor !== null) {
        if (typeof objectCursor !== 'string' || objectCursor.length < 1
          || seenObjectCursors.has(objectCursor) || objectPages.length >= maximumObjectPages) {
          throw new Error('Packaged Replay object paging is cyclic or unbounded.')
        }
        seenObjectCursors.add(objectCursor)
        const pageRequest = {
          ...replayQuery,
          objectCursor,
          replayGeneration: initialReplayResult.replayGeneration,
        }
        const result = await archiveReview.read({
          sessionId: request.sessionId,
          requestId: crypto.randomUUID(),
          method: 'readMissionReplayObjectChunk',
          input: pageRequest,
        })
        objectPages.push({ request: pageRequest, result })
        if (!Array.isArray(result?.objects)
          || (result.objects.length === 0 && result.nextObjectCursor !== null)) {
          throw new Error('Packaged Replay object paging returned an empty nonterminal page.')
        }
        objectCursor = result.nextObjectCursor
      }
      const outingFilterPages = []
      const seenOutingFilterCursors = new Set()
      let outingFilterCursor = initialReplayResult?.availableOutingNextCursor
      while (outingFilterCursor !== null) {
        if (typeof outingFilterCursor !== 'string' || outingFilterCursor.length < 1
          || seenOutingFilterCursors.has(outingFilterCursor)
          || outingFilterPages.length >= maximumOutingFilterPages) {
          throw new Error('Packaged Replay outing-filter paging is cyclic or unbounded.')
        }
        seenOutingFilterCursors.add(outingFilterCursor)
        const pageRequest = {
          ...replayQuery,
          filterKind: 'outing',
          filterCursor: outingFilterCursor,
          filterLimit: 100,
          filterSearch: '',
        }
        const result = await archiveReview.read({
          sessionId: request.sessionId,
          requestId: crypto.randomUUID(),
          method: 'readMissionReplayFilterPage',
          input: pageRequest,
        })
        outingFilterPages.push({ request: pageRequest, result })
        if (!Array.isArray(result?.entries)
          || (result.entries.length === 0 && result.nextCursor !== null)) {
          throw new Error('Packaged Replay outing-filter paging returned an empty nonterminal page.')
        }
        outingFilterCursor = result.nextCursor
      }
      const replayResult = {
        query: replayQuery,
        initial: initialReplayResult,
        trackPages,
        objectPages,
        outingFilterPages,
      }
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
      selectedTime,
      expectedBreadcrumbCount: input.expectedBreadcrumbCount,
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
  const closedContent = projectArchiveLifecycleSmokeClosedReviewSemantic({
    missions: review?.missions,
    review: review?.reviewResult,
    replay: review?.replayResult,
  }, {
    missionId: input.missionId,
    selectedTime,
    expectedBreadcrumbCount: input.expectedBreadcrumbCount,
    expectedObjectCount: input.expectedObjectCount,
    expectedOutingFilterCount: input.expectedOutingFilterCount,
  })
  const contentSha256 = sha256Text(JSON.stringify(closedContent))
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
    || breadcrumbCount !== input.expectedBreadcrumbCount
    || closedContent.replayCounts.trackRows !== input.expectedBreadcrumbCount
    || closedContent.replayCounts.objectRows !== input.expectedObjectCount
    || closedContent.replayCounts.outingFilterEntries !== input.expectedOutingFilterCount) {
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
    replayObjectCount: closedContent.replayCounts.objectRows,
    replayOutingFilterCount: closedContent.replayCounts.outingFilterEntries,
    replayTrackCount: closedContent.replayCounts.trackRows,
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
  await input.launch.page.exposeFunction(bindingName, async (progress) => {
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
      await input.beforeKill()
      input.launch.mainInspector.close()
      const requested = input.launch.appProcess.kill('SIGKILL')
      if (!requested) throw new Error('Electron rejected the restore SIGKILL request.')
      settleTrigger({ phase: progress.phase, inspection })
      return true
    } catch (error) {
      rejectTrigger(error)
      return false
    }
  })
  await input.launch.page.evaluate((request) => {
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
  input.launch.mainInspector.close()
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

/** Seeds one isolated accelerated Traccar profile before Electron opens it. */
async function seedLivenessRuntimeConfiguration(userDataDir, baseUrl) {
  await writeFile(path.join(userDataDir, 'settings.json'), `${JSON.stringify({
    missionDefaults: {
      autoRefreshEnabled: true,
      autoRefreshIntervalSeconds: 5,
      autoSaveEnabled: true,
      autoSaveIntervalSeconds: 30,
      primaryMissionRoot: '',
      backupMissionRoot: '',
      coordinatorRoster: [],
      adminRoster: [],
    },
    dataSource: {
      providerType: 'traccar_http',
      baseUrl,
      authMode: 'basic',
      email: LIVENESS_EMAIL,
      autoConnect: true,
      trackingCacheEnabled: false,
      replayEnabled: false,
      replayStart: '',
      replayDurationHours: 4,
    },
    officialMaps: {
      sourceType: 'none',
      sourcePath: '',
      status: 'not_configured',
      username: '',
      availableSources: [],
      serviceCount: 0,
      message: 'Official maps are not configured.',
      packages: [],
    },
    weather: { links: [] },
  }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  await writeFile(path.join(userDataDir, 'credentials.json'), `${JSON.stringify({
    version: 1,
    traccar: { basic: { secret: LIVENESS_SECRET } },
  }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
}

/** Starts the separate live probe mission through the real operator/runtime path. */
async function startLivenessMission(page, expectedDeviceId) {
  await page.getByTestId('mission-name-input').fill(LIVENESS_MISSION_NAME)
  const participantSelection = page.getByTestId('participant-selection-step')
  const missionModelEnabled = await participantSelection.isVisible().catch(() => false)
  if (missionModelEnabled) {
    const deviceCheckboxes = page
      .getByTestId('participant-device-picker')
      .locator('input[type="checkbox"]')
    await deviceCheckboxes.first().waitFor({ state: 'attached', timeout: 30_000 })
    const deviceCount = await deviceCheckboxes.count()
    if (deviceCount !== 1) {
      throw new Error('Archive-lifecycle liveness mission did not receive one mock device.')
    }
    await deviceCheckboxes.first().check({ force: true })
  }
  await page.getByTestId('mission-start-btn').click({ force: true })
  const mission = await waitForActiveMission(page, LIVENESS_MISSION_NAME, 30_000)
  if (missionModelEnabled) {
    await waitForExactLivenessParticipant(
      page,
      mission.id,
      expectedDeviceId,
      30_000,
    )
  }
  return { mission, participantScopeRequired: missionModelEnabled }
}

/** Resumes the live probe mission after the deliberate restore SIGKILL. */
async function resumeLivenessMission(
  page,
  expectedMissionId,
  expectedDeviceId,
  participantScopeRequired,
) {
  const recoveryDialog = page.getByTestId('mission-recovery-dialog')
  await recoveryDialog.waitFor({ state: 'visible', timeout: 30_000 })
  await recoveryDialog.getByRole('button', { name: 'Resume' }).click({ force: true })
  await recoveryDialog.waitFor({ state: 'hidden', timeout: 30_000 })
  const mission = await waitForActiveMission(
    page,
    LIVENESS_MISSION_NAME,
    30_000,
    expectedMissionId,
  )
  if (participantScopeRequired) {
    await waitForExactLivenessParticipant(
      page,
      mission.id,
      expectedDeviceId,
      30_000,
    )
  }
  return mission
}

/** Accepts only one rendered and durable active participant for the probe device. */
export function isExactLivenessParticipantReady(snapshot, expectedDeviceId) {
  if (snapshot === null || typeof snapshot !== 'object' || Array.isArray(snapshot)
    || !Array.isArray(snapshot.renderedParticipants)
    || !Array.isArray(snapshot.participants)) return false
  const expectedId = String(expectedDeviceId)
  if (!/^[1-9][0-9]*$/u.test(expectedId)) return false
  const rendered = snapshot.renderedParticipants
  const active = snapshot.participants.filter((participant) =>
    participant !== null
    && typeof participant === 'object'
    && !Array.isArray(participant)
    && participant.removed_at === null)
  return rendered.length === 1
    && rendered[0] !== null
    && typeof rendered[0] === 'object'
    && !Array.isArray(rendered[0])
    && rendered[0].kind === 'device'
    && rendered[0].traccarDeviceId === expectedId
    && active.length === 1
    && active[0].kind === 'device'
    && active[0].traccar_device_id === expectedId
}

/** Waits for participant persistence and the rendered scope before arming liveness. */
export async function waitForExactLivenessParticipant(
  page,
  missionId,
  expectedDeviceId,
  timeoutMs,
) {
  const deadline = performance.now() + timeoutMs
  while (performance.now() < deadline) {
    const remainingMs = Math.max(1, deadline - performance.now())
    const snapshot = await withTimeout(page.evaluate(async (expectedMissionId) => {
      const activeList = document.querySelector('[data-testid="participant-active-list"]')
      const participants = await window.sartrackerElectron?.missionStore
        .listMissionParticipants?.(expectedMissionId)
      return {
        renderedParticipants: Array.from(
          activeList?.querySelectorAll(':scope > .sar-readout') ?? [],
          (row) => ({
            kind: row.getAttribute('data-participant-kind'),
            traccarDeviceId: row.getAttribute('data-traccar-device-id'),
          }),
        ),
        participants: Array.isArray(participants)
          ? participants.map((participant) => ({
              kind: participant.kind,
              removed_at: participant.removed_at,
              traccar_device_id: participant.traccar_device_id,
            }))
          : null,
      }
    }, missionId), remainingMs,
    'Archive-lifecycle liveness participant readiness read timed out.')
    if (isExactLivenessParticipantReady(snapshot, expectedDeviceId)) return
    const remainingAfterReadMs = deadline - performance.now()
    if (remainingAfterReadMs > 0) await delay(Math.min(25, remainingAfterReadMs))
  }
  throw new Error('Archive-lifecycle liveness participant scope did not become ready.')
}

/** Waits until the backend and renderer agree on one active probe mission. */
export async function waitForActiveMission(
  page,
  expectedName,
  timeoutMs,
  expectedMissionId = null,
) {
  const deadline = performance.now() + timeoutMs
  await page.waitForFunction(async (expected) => {
    const mission = await window.sartrackerElectron?.missionStore.getActiveMission()
    return mission?.status === 'active'
      && mission.name === expected.name
      && (expected.id === null || mission.id === expected.id)
  }, { name: expectedName, id: expectedMissionId }, {
    timeout: Math.max(1, deadline - performance.now()),
  })
  const mission = await withTimeout(
    page.evaluate(async () => window.sartrackerElectron?.missionStore.getActiveMission()),
    Math.max(1, deadline - performance.now()),
    'Archive-lifecycle liveness mission confirmation read timed out.',
  )
  if (mission?.status !== 'active' || mission.name !== expectedName
    || (expectedMissionId !== null && mission.id !== expectedMissionId)) {
    throw new Error(
      'Archive-lifecycle liveness mission did not match the exact expected identity.',
    )
  }
  return mission
}

/**
 * Aggregates source, renderer, main-process, and frame evidence outside the app.
 * Only exact mock-source identities observed at the MapLibre boundary count as
 * complete samples.
 */
export function createPackagedLivenessProbe(mockServer, dependencies = {}) {
  const installRenderer = dependencies.installRendererLivenessProbe
    ?? installRendererLivenessProbe
  const setRendererPhase = dependencies.setRendererLivenessPhase
    ?? setRendererLivenessPhase
  const collectRenderer = dependencies.collectRendererLivenessProbe
    ?? collectRendererLivenessProbe
  const startWatchdog = dependencies.startExternalLaunchWatchdog
    ?? startExternalLaunchWatchdog
  const readNow = dependencies.now ?? Date.now
  const wait = dependencies.delay ?? delay
  if (typeof mockServer?.setPhase !== 'function'
    || typeof mockServer.readCurrentFixSequence !== 'function'
    || typeof mockServer.drainCurrentFixLedger !== 'function') {
    throw new Error('Archive-lifecycle liveness source ledger is not drainable.')
  }
  const byPhase = Object.fromEntries(LIVENESS_PHASES.map((phase) => [phase, {
    sampleCount: 0,
    currentFixMaxGapMs: 0,
    sourceToRendererMaxMs: 0,
    requestToRendererMaxMs: 0,
    mainWatchdogMaxGapMs: 0,
    rendererFrameMaxGapMs: 0,
  }]))
  const channelCounts = Object.fromEntries(LIVENESS_PHASES.map((phase) => [phase, {
    main: 0,
    rendererFrame: 0,
  }]))
  const sourceByIdentity = new Map()
  const retiredSourceByIdentity = new Map()
  const operationCheckpoints = new Map()
  const errors = new Set()
  let currentFixContinuity = null
  let currentFixTimeout = null
  let rendererCurrentFixMonotonicTail = null
  let invalidRendererFrame = null
  // Keep the causal snapshot stable while the error-kind set is unchanged so
  // cleanup can recognize a replay; a genuinely new kind invalidates it.
  let instrumentationFailure = null
  let ignoredInstrumentationFailure = null
  let preserveStopFailureCause = false
  let signalFailure
  const failureSignal = new Promise((resolve) => { signalFailure = resolve })
  const recordError = (kind) => {
    if (errors.has(kind)) return
    errors.add(kind)
    instrumentationFailure = null
    signalFailure(kind)
  }
  let activePhase = null
  let activeContinuityInterval = null
  let activeLaunch = null
  let finished = false
  let operationSerial = Promise.resolve()
  let rendererCollectionSerial = Promise.resolve()
  let rendererCollectionFailure = null
  let rendererPhaseTransitionActive = false
  let sourceEntrySequenceHighWatermark = 0
  let sourceFenceHighWatermark = 0
  let sourceAcknowledgementHighWatermark = 0
  let rendererObservedThroughHighWatermark = 0
  let latestSourceEntry = null

  const enqueue = (operation) => {
    const result = operationSerial.then(operation)
    operationSerial = result.catch(() => undefined)
    return result
  }

  /** Reads one non-regressing source-side operation fence. */
  const readSourceSequenceFence = () => {
    let sequence
    try {
      sequence = mockServer.readCurrentFixSequence()
    } catch {
      recordError('source_sequence_fence_invalid')
      return sourceFenceHighWatermark
    }
    if (!Number.isSafeInteger(sequence) || sequence < 0
      || sequence < sourceEntrySequenceHighWatermark
      || sequence < sourceFenceHighWatermark) {
      recordError('source_sequence_fence_invalid')
      return sourceFenceHighWatermark
    }
    sourceFenceHighWatermark = sequence
    return sequence
  }

  const ingestSourceLedger = () => {
    const drained = mockServer.drainCurrentFixLedger()
    if (!Array.isArray(drained?.entries)
      || !Number.isSafeInteger(drained.overflowCount) || drained.overflowCount < 0) {
      recordError('source_ledger_invalid')
      return
    }
    if (drained.overflowCount > 0) recordError('source_ledger_overflow')
    for (const entry of drained.entries) {
      if (!LIVENESS_PHASES.includes(entry?.phase)
        || !Number.isSafeInteger(entry.sequence) || entry.sequence < 1
        || entry.sequence <= sourceEntrySequenceHighWatermark
        || typeof entry.sourcePositionId !== 'string' || entry.sourcePositionId === ''
        || !Number.isSafeInteger(entry.requestStartedAtMs) || entry.requestStartedAtMs < 0
        || !Number.isSafeInteger(entry.emittedAtMs)
        || entry.emittedAtMs < entry.requestStartedAtMs
        || typeof entry.sourceTimestamp !== 'string'
        || entry.sourceTimestamp !== new Date(entry.emittedAtMs).toISOString()
        || sourceByIdentity.has(entry.sourcePositionId)
        || retiredSourceByIdentity.has(entry.sourcePositionId)) {
        recordError('source_ledger_entry_invalid')
        continue
      }
      sourceEntrySequenceHighWatermark = entry.sequence
      latestSourceEntry = Object.freeze({ ...entry })
      sourceByIdentity.set(entry.sourcePositionId, entry)
    }
  }

  /** Captures a bounded source/request tail at the instant failure evidence is frozen. */
  const buildSourceCadenceDiagnostics = () => {
    const auditedAtMs = readNow()
    if (!Number.isSafeInteger(auditedAtMs) || auditedAtMs < 0) return null
    const pendingSources = [...sourceByIdentity.values()]
    const oldestPending = pendingSources.reduce((oldest, source) => (
      oldest === null || source.requestStartedAtMs < oldest.requestStartedAtMs
        ? source
        : oldest
    ), null)
    const finiteAge = (startedAtMs) => {
      if (!Number.isSafeInteger(startedAtMs) || startedAtMs < 0) return null
      const ageMs = auditedAtMs - startedAtMs
      return Number.isSafeInteger(ageMs) && ageMs >= 0 ? ageMs : null
    }
    return Object.freeze({
      latestReceivedSequence: sourceEntrySequenceHighWatermark,
      latestAcknowledgedSequence: sourceAcknowledgementHighWatermark,
      pendingCount: pendingSources.length,
      latestRequestStartedAtMs: latestSourceEntry?.requestStartedAtMs ?? null,
      latestEmittedAtMs: latestSourceEntry?.emittedAtMs ?? null,
      latestRequestAgeMs: finiteAge(latestSourceEntry?.requestStartedAtMs),
      latestSourceAgeMs: finiteAge(latestSourceEntry?.emittedAtMs),
      oldestPendingRequestAgeMs: finiteAge(oldestPending?.requestStartedAtMs),
      oldestPendingSourceAgeMs: finiteAge(oldestPending?.emittedAtMs),
      auditedAtMs,
    })
  }

  /** Audits one pending source against its immutable request and emission deadline. */
  const auditPendingSourceAt = (source, auditedAtMs) => {
    const requestAgeMs = auditedAtMs - source.requestStartedAtMs
    const sourceAgeMs = auditedAtMs - source.emittedAtMs
    if (requestAgeMs < 0 || sourceAgeMs < 0) {
      recordError('current_fix_clock_invalid')
      return 'invalid'
    }
    if (requestAgeMs < LIVENESS_HARD_GATE_MS
      && sourceAgeMs < LIVENESS_HARD_GATE_MS) return 'within_gate'
    if (currentFixTimeout === null
      || Math.max(requestAgeMs, sourceAgeMs)
        >= Math.max(currentFixTimeout.requestAgeMs, currentFixTimeout.sourceAgeMs)) {
      currentFixTimeout = Object.freeze({
        phase: source.phase,
        requestAgeMs,
        sourceAgeMs,
        requestStartedAtMs: source.requestStartedAtMs,
        emittedAtMs: source.emittedAtMs,
        auditedAtMs,
      })
    }
    recordError('current_fix_not_observed_before_gate')
    return 'expired'
  }

  /** Retains a bounded tombstone so a later stale render fails closed. */
  const rememberRetiredSource = (source) => {
    retiredSourceByIdentity.set(source.sourcePositionId, source)
    while (retiredSourceByIdentity.size > RENDERER_LIVENESS_LEDGER_CAPACITY) {
      const oldestIdentity = retiredSourceByIdentity.keys().next().value
      retiredSourceByIdentity.delete(oldestIdentity)
    }
  }

  /** Retires only snapshots overtaken before their original strict deadline. */
  const acknowledgeSourceSequence = (sequence, observedAtMs) => {
    sourceAcknowledgementHighWatermark = sequence
    for (const [identity, source] of sourceByIdentity) {
      if (source.sequence > sequence) continue
      const deadlineState = auditPendingSourceAt(source, observedAtMs)
      sourceByIdentity.delete(identity)
      if (deadlineState === 'within_gate') rememberRetiredSource(source)
    }
  }

  const expirePendingSources = (auditedThroughMs = readExternalNow()) => {
    if (auditedThroughMs === null) return
    for (const [identity, source] of sourceByIdentity) {
      if (source.requestStartedAtMs > auditedThroughMs
        || source.emittedAtMs > auditedThroughMs) continue
      if (auditPendingSourceAt(source, auditedThroughMs) !== 'within_gate') {
        sourceByIdentity.delete(identity)
      }
    }
  }

  const buildFailureDiagnostics = () => {
    const activeOperations = [...operationCheckpoints.values()]
    return Object.freeze({
      errorKinds: [...errors].sort(),
      activePhase,
      activeLaunchNumber: Number.isSafeInteger(activeLaunch?.number) ? activeLaunch.number : null,
      currentFixContinuity,
      currentFixTimeout,
      rendererCurrentFixMonotonicTail,
      sourceCadence: buildSourceCadenceDiagnostics(),
      invalidRendererFrame,
      operationCount: activeOperations.length,
      operationOverflowCount: Math.max(0, activeOperations.length - LIVENESS_PHASES.length),
      operations: activeOperations.slice(0, LIVENESS_PHASES.length)
        .map((operation) => Object.freeze({
          phase: operation.phase,
          kind: operation.kind,
          startedAtMs: operation.startedAtMs,
          endedAtMs: operation.endedAtMs,
          freshSampleCount: operation.freshSampleCount,
        })),
      phaseMetrics: Object.fromEntries(LIVENESS_PHASES.map((phase) => [phase, Object.freeze({
        ...byPhase[phase],
        mainSampleCount: channelCounts[phase].main,
        rendererFrameSampleCount: channelCounts[phase].rendererFrame,
      })])),
    })
  }

  const throwIfInstrumentationFailed = () => {
    if (errors.size > 0) {
      if (instrumentationFailure === null) {
        instrumentationFailure = new Error(
          `Archive-lifecycle external watchdog recorded an instrumentation failure (${[...errors].sort().join(',')}).`,
        )
        Object.defineProperty(instrumentationFailure, 'archiveLifecycleDiagnostics', {
          configurable: false,
          enumerable: false,
          writable: false,
          value: buildFailureDiagnostics(),
        })
      }
      if (instrumentationFailure === ignoredInstrumentationFailure) return
      throw instrumentationFailure
    }
  }

  const throwRendererCdpFailure = (error, stopMessage) => {
    recordError('renderer_cdp_watchdog_failed')
    if (preserveStopFailureCause) {
      throw new Error(stopMessage, { cause: error })
    }
    throwIfInstrumentationFailed()
  }

  const readExternalNow = () => {
    const currentTimeMs = readNow()
    if (!Number.isSafeInteger(currentTimeMs) || currentTimeMs < 0) {
      recordError('external_watchdog_clock_invalid')
      return null
    }
    return currentTimeMs
  }

  const recordCurrentFixGap = (phase, gapMs, timing = null) => {
    if (!LIVENESS_PHASES.includes(phase)
      || !Number.isFinite(gapMs) || gapMs < 0) {
      recordError('current_fix_clock_invalid')
      return
    }
    byPhase[phase].currentFixMaxGapMs = Math.max(
      byPhase[phase].currentFixMaxGapMs,
      gapMs,
    )
    if (gapMs >= LIVENESS_HARD_GATE_MS) {
      if (timing !== null && (currentFixContinuity === null
        || gapMs >= currentFixContinuity.gapMs)) {
        currentFixContinuity = Object.freeze({ phase, gapMs, ...timing })
      }
      recordError('current_fix_continuity_gate_breached')
    }
  }

  const auditActiveContinuity = (currentTimeMs = readExternalNow()) => {
    const interval = activeContinuityInterval
    if (interval === null || currentTimeMs === null) return
    const boundedTimeMs = interval.endedAtMs === null
      ? currentTimeMs
      : Math.min(currentTimeMs, interval.endedAtMs)
    const previousTimeMs = interval.lastObservedAtMs ?? interval.startedAtMs
    recordCurrentFixGap(interval.phase, Math.max(0, boundedTimeMs - previousTimeMs), {
      intervalStartedAtMs: interval.startedAtMs,
      previousObservedAtMs: previousTimeMs,
      auditedAtMs: boundedTimeMs,
    })
  }

  const beginContinuityInterval = (phase) => {
    if (activeContinuityInterval !== null) {
      recordError('current_fix_continuity_state_invalid')
      return
    }
    const startedAtMs = readExternalNow()
    if (startedAtMs === null) return
    activeContinuityInterval = {
      phase,
      startedAtMs,
      endedAtMs: null,
      lastObservedAtMs: null,
    }
    for (const operation of operationCheckpoints.values()) {
      if (operation.phase === phase && operation.endedAtMs === null) {
        operation.continuitySegmentStartedAtMs = startedAtMs
        operation.continuitySegmentEndedAtMs = null
        operation.continuityLastObservedAtMs = null
      }
    }
  }

  const markContinuityIntervalEnded = (phase, endedAtMs) => {
    const interval = activeContinuityInterval
    if (interval === null || interval.phase !== phase || interval.endedAtMs !== null) {
      recordError('current_fix_continuity_state_invalid')
      return
    }
    interval.endedAtMs = endedAtMs
    for (const operation of operationCheckpoints.values()) {
      if (operation.phase !== phase || operation.endedAtMs !== null
        || operation.continuitySegmentStartedAtMs === null) continue
      if (operation.continuitySegmentEndedAtMs !== null
        || endedAtMs < operation.continuitySegmentStartedAtMs) {
        recordError('current_fix_continuity_state_invalid')
        continue
      }
      operation.continuitySegmentEndedAtMs = endedAtMs
    }
  }

  const closeOperationContinuitySegment = (operation, endedAtMs) => {
    if (operation.continuitySegmentStartedAtMs === null) return
    const segmentEndedAtMs = operation.continuitySegmentEndedAtMs ?? endedAtMs
    if (operation.continuitySegmentEndedAtMs !== null
      && operation.continuitySegmentEndedAtMs !== endedAtMs) {
      recordError('current_fix_continuity_state_invalid')
    }
    const previousTimeMs = operation.continuityLastObservedAtMs
      ?? operation.continuitySegmentStartedAtMs
    recordCurrentFixGap(operation.phase, segmentEndedAtMs - previousTimeMs, {
      intervalStartedAtMs: operation.continuitySegmentStartedAtMs,
      previousObservedAtMs: previousTimeMs,
      auditedAtMs: segmentEndedAtMs,
    })
    operation.continuitySegmentStartedAtMs = null
    operation.continuitySegmentEndedAtMs = null
    operation.continuityLastObservedAtMs = null
  }

  const closeContinuityInterval = (phase, endedAtMs) => {
    const interval = activeContinuityInterval
    if (interval === null || interval.phase !== phase || interval.endedAtMs !== endedAtMs) {
      recordError('current_fix_continuity_state_invalid')
      return
    }
    const previousTimeMs = interval.lastObservedAtMs ?? interval.startedAtMs
    recordCurrentFixGap(phase, endedAtMs - previousTimeMs, {
      intervalStartedAtMs: interval.startedAtMs,
      previousObservedAtMs: previousTimeMs,
      auditedAtMs: endedAtMs,
    })
    for (const operation of operationCheckpoints.values()) {
      if (operation.phase === phase && operation.endedAtMs === null) {
        closeOperationContinuitySegment(operation, endedAtMs)
      }
    }
    activeContinuityInterval = null
  }

  /** Preserves one exact-fix timeline while changing only phase attribution. */
  const transitionActiveContinuityPhase = (previousPhase, nextPhase, switchedAtMs) => {
    const interval = activeContinuityInterval
    if (interval === null || interval.phase !== previousPhase || interval.endedAtMs !== null) {
      recordError('current_fix_continuity_state_invalid')
      return
    }
    for (const operation of operationCheckpoints.values()) {
      if (operation.endedAtMs !== null) continue
      if (operation.phase === previousPhase) {
        closeOperationContinuitySegment(operation, switchedAtMs)
      }
      if (operation.phase === nextPhase) {
        operation.continuitySegmentStartedAtMs = switchedAtMs
        operation.continuitySegmentEndedAtMs = null
        operation.continuityLastObservedAtMs = null
      }
    }
    interval.phase = nextPhase
  }

  const rendererFrameTailIsValid = (frameTail) => frameTail === null || (
    frameTail !== null
    && typeof frameTail === 'object'
    && !Array.isArray(frameTail)
    && JSON.stringify(Object.keys(frameTail).sort()) === JSON.stringify(['gapMs', 'phase'])
    && LIVENESS_PHASES.includes(frameTail.phase)
    && Number.isFinite(frameTail.gapMs)
    && frameTail.gapMs >= 0
  )

  const rendererSnapshotKeys = [
    'currentFixOverflowCount',
    'currentFixTail',
    'currentFixes',
    'frameGapOverflowCount',
    'frameGaps',
    'frameTail',
  ]

  /** Validates the bounded renderer payload before any phase-boundary split. */
  const rendererSnapshotIsValid = (snapshot) => (
    snapshot !== null
    && typeof snapshot === 'object'
    && !Array.isArray(snapshot)
    && JSON.stringify(Object.keys(snapshot).sort()) === JSON.stringify(rendererSnapshotKeys)
    && Array.isArray(snapshot.currentFixes)
    && snapshot.currentFixes.length <= RENDERER_LIVENESS_LEDGER_CAPACITY
    && Array.isArray(snapshot.frameGaps)
    && snapshot.frameGaps.length <= RENDERER_LIVENESS_LEDGER_CAPACITY
    && Number.isSafeInteger(snapshot.currentFixOverflowCount)
    && snapshot.currentFixOverflowCount >= 0
    && Number.isSafeInteger(snapshot.frameGapOverflowCount)
    && snapshot.frameGapOverflowCount >= 0
    && rendererFrameTailIsValid(snapshot.currentFixTail)
    && rendererFrameTailIsValid(snapshot.frameTail)
  )

  /** Splits exact-fix observations around the external request-start watermark. */
  const partitionRendererSnapshotAt = (snapshot, switchedAtMs) => {
    if (!rendererSnapshotIsValid(snapshot)) return null
    const previousCurrentFixes = []
    const nextCurrentFixes = []
    for (const observation of snapshot.currentFixes) {
      if (!Number.isSafeInteger(observation?.observedAtMs)
        || observation.observedAtMs < 0) return null
      if (observation.observedAtMs < switchedAtMs) {
        previousCurrentFixes.push(observation)
      } else {
        nextCurrentFixes.push(observation)
      }
    }
    return {
      previous: {
        currentFixes: previousCurrentFixes,
        currentFixTail: snapshot.currentFixTail,
        frameGaps: snapshot.frameGaps,
        frameTail: snapshot.frameTail,
        currentFixOverflowCount: snapshot.currentFixOverflowCount,
        frameGapOverflowCount: snapshot.frameGapOverflowCount,
      },
      next: {
        currentFixes: nextCurrentFixes,
        currentFixTail: null,
        frameGaps: [],
        frameTail: null,
        currentFixOverflowCount: 0,
        frameGapOverflowCount: 0,
      },
    }
  }

  const recordRendererFrameGap = (frame, countFrame) => {
    if (!LIVENESS_PHASES.includes(frame?.phase)
      || !Number.isFinite(frame?.gapMs) || frame.gapMs < 0) {
      if (invalidRendererFrame === null) {
        const rawGapMs = frame?.gapMs
        let gapType = 'invalid_phase'
        if (typeof rawGapMs !== 'number') gapType = 'non_numeric'
        else if (!Number.isFinite(rawGapMs)) gapType = 'non_finite'
        else if (rawGapMs < 0) gapType = 'negative'
        invalidRendererFrame = Object.freeze({
          phase: LIVENESS_PHASES.includes(frame?.phase) ? frame.phase : null,
          gapMs: Number.isFinite(rawGapMs)
            ? Math.max(-LIVENESS_HARD_GATE_MS, Math.min(LIVENESS_HARD_GATE_MS, rawGapMs))
            : null,
          gapType,
        })
      }
      recordError('renderer_frame_sample_invalid')
      return
    }
    if (countFrame) channelCounts[frame.phase].rendererFrame += 1
    byPhase[frame.phase].rendererFrameMaxGapMs = Math.max(
      byPhase[frame.phase].rendererFrameMaxGapMs,
      frame.gapMs,
    )
    if (frame.gapMs >= LIVENESS_HARD_GATE_MS) {
      recordError('renderer_frame_gate_breached')
    }
  }

  const recordRendererFrameTail = (frameTail) => {
    if (!rendererFrameTailIsValid(frameTail)) {
      recordError('renderer_frame_tail_invalid')
      return
    }
    if (frameTail !== null) recordRendererFrameGap(frameTail, false)
  }

  const recordRendererSnapshot = (
    snapshot,
    observedThroughMs = readExternalNow(),
  ) => {
    if (observedThroughMs === null) return
    if (observedThroughMs < rendererObservedThroughHighWatermark) {
      recordError('external_watchdog_clock_invalid')
      return
    }
    rendererObservedThroughHighWatermark = observedThroughMs
    ingestSourceLedger()
    if (!rendererSnapshotIsValid(snapshot)) {
      recordError('renderer_liveness_snapshot_invalid')
      expirePendingSources(observedThroughMs)
      auditActiveContinuity(observedThroughMs)
      return
    }
    if (snapshot.currentFixOverflowCount > 0) {
      recordError('renderer_current_fix_ledger_overflow')
    }
    if (snapshot.frameGapOverflowCount > 0) {
      recordError('renderer_frame_gap_ledger_overflow')
    }
    if (snapshot.currentFixTail !== null && (
      rendererCurrentFixMonotonicTail === null ||
      snapshot.currentFixTail.gapMs >= rendererCurrentFixMonotonicTail.gapMs
    )) {
      rendererCurrentFixMonotonicTail = Object.freeze({ ...snapshot.currentFixTail })
    }
    for (const frame of snapshot.frameGaps) recordRendererFrameGap(frame, true)
    recordRendererFrameTail(snapshot.frameTail)
    const correlations = []
    let observedSequenceHighWatermark = sourceAcknowledgementHighWatermark
    for (const observation of snapshot.currentFixes) {
      if (observation === null || typeof observation !== 'object'
        || Array.isArray(observation)
        || typeof observation.sourcePositionId !== 'string'
        || observation.sourcePositionId === '') {
        recordError('renderer_current_fix_sample_invalid')
        continue
      }
      const source = sourceByIdentity.get(observation.sourcePositionId)
      if (source === undefined) {
        const retiredSource = retiredSourceByIdentity.get(
          observation.sourcePositionId,
        )
        if (retiredSource === undefined) continue
        retiredSourceByIdentity.delete(observation.sourcePositionId)
        if (observation.sourceTimestamp !== retiredSource.sourceTimestamp) {
          recordError('current_fix_timestamp_identity_mismatch')
          continue
        }
        if (!Number.isSafeInteger(observation.observedAtMs)
          || observation.observedAtMs < 0) {
          recordError('renderer_current_fix_sample_invalid')
          continue
        }
        const sourceToRendererMs = observation.observedAtMs - retiredSource.emittedAtMs
        const requestToRendererMs = observation.observedAtMs
          - retiredSource.requestStartedAtMs
        if (!Number.isFinite(sourceToRendererMs) || sourceToRendererMs < 0
          || !Number.isFinite(requestToRendererMs) || requestToRendererMs < 0) {
          recordError('current_fix_clock_invalid')
          continue
        }
        if (sourceToRendererMs >= LIVENESS_HARD_GATE_MS
          || requestToRendererMs >= LIVENESS_HARD_GATE_MS) {
          recordError('current_fix_gate_breached')
        }
        recordError('renderer_current_fix_sequence_regressed')
        continue
      }
      if (observation.sourceTimestamp !== source.sourceTimestamp) {
        recordError('current_fix_timestamp_identity_mismatch')
        continue
      }
      if (!Number.isSafeInteger(observation.observedAtMs)
        || observation.observedAtMs < 0) {
        recordError('renderer_current_fix_sample_invalid')
        continue
      }
      const sourceToRendererMs = observation.observedAtMs - source.emittedAtMs
      const requestToRendererMs = observation.observedAtMs - source.requestStartedAtMs
      if (!Number.isFinite(sourceToRendererMs) || sourceToRendererMs < 0
        || !Number.isFinite(requestToRendererMs) || requestToRendererMs < 0) {
        recordError('current_fix_clock_invalid')
        continue
      }
      if (source.sequence <= observedSequenceHighWatermark) {
        recordError('renderer_current_fix_sequence_regressed')
        continue
      }
      observedSequenceHighWatermark = source.sequence
      correlations.push({
        observation,
        requestToRendererMs,
        source,
        sourceToRendererMs,
      })
    }
    for (const {
      observation,
      requestToRendererMs,
      source,
      sourceToRendererMs,
    } of correlations) {
      sourceByIdentity.delete(observation.sourcePositionId)
      const phaseEvidence = byPhase[source.phase]
      phaseEvidence.sampleCount += 1
      phaseEvidence.sourceToRendererMaxMs = Math.max(
        phaseEvidence.sourceToRendererMaxMs,
        sourceToRendererMs,
      )
      phaseEvidence.requestToRendererMaxMs = Math.max(
        phaseEvidence.requestToRendererMaxMs,
        requestToRendererMs,
      )
      const interval = activeContinuityInterval
      if (interval === null) {
        recordError('current_fix_continuity_state_invalid')
      } else if (observation.observedAtMs < interval.startedAtMs) {
        recordError('current_fix_clock_invalid')
      } else if (interval.endedAtMs === null
        || observation.observedAtMs < interval.endedAtMs) {
        const previousObservedAtMs = interval.lastObservedAtMs ?? interval.startedAtMs
        recordCurrentFixGap(source.phase, observation.observedAtMs - previousObservedAtMs, {
          intervalStartedAtMs: interval.startedAtMs,
          previousObservedAtMs,
          auditedAtMs: observation.observedAtMs,
        })
        interval.lastObservedAtMs = observation.observedAtMs
      }
      for (const operation of operationCheckpoints.values()) {
        if (operation.phase === source.phase
          && operation.continuitySegmentStartedAtMs !== null
          && source.sequence > operation.startSourceSequence
          && source.requestStartedAtMs >= operation.startedAtMs
          && source.emittedAtMs >= operation.startedAtMs
          && observation.observedAtMs >= operation.startedAtMs
          && source.requestStartedAtMs >= operation.continuitySegmentStartedAtMs
          && source.emittedAtMs >= operation.continuitySegmentStartedAtMs
          && observation.observedAtMs >= operation.continuitySegmentStartedAtMs
          && (operation.continuitySegmentEndedAtMs === null || (
            source.requestStartedAtMs < operation.continuitySegmentEndedAtMs
            && source.emittedAtMs < operation.continuitySegmentEndedAtMs
            && observation.observedAtMs < operation.continuitySegmentEndedAtMs
          ))
          && (operation.endedAtMs === null || (
            source.sequence <= operation.endSourceSequence
            && source.requestStartedAtMs < operation.endedAtMs
            && source.emittedAtMs < operation.endedAtMs
            && observation.observedAtMs < operation.endedAtMs
          ))) {
          operation.freshSampleCount += 1
          if (operation.continuitySegmentStartedAtMs !== null) {
            const previousObservedAtMs = operation.continuityLastObservedAtMs
              ?? operation.continuitySegmentStartedAtMs
            recordCurrentFixGap(
              source.phase,
              observation.observedAtMs - previousObservedAtMs,
              {
                intervalStartedAtMs: operation.continuitySegmentStartedAtMs,
                previousObservedAtMs,
                auditedAtMs: observation.observedAtMs,
              },
            )
            operation.continuityLastObservedAtMs = observation.observedAtMs
          }
        }
      }
      if (sourceToRendererMs >= LIVENESS_HARD_GATE_MS
        || requestToRendererMs >= LIVENESS_HARD_GATE_MS) {
        recordError('current_fix_gate_breached')
      } else {
        acknowledgeSourceSequence(source.sequence, observation.observedAtMs)
        rememberRetiredSource(source)
      }
    }
    expirePendingSources(observedThroughMs)
    auditActiveContinuity(observedThroughMs)
  }

  const recordMainGap = (phase, gapMs, countSample = true) => {
    if (!LIVENESS_PHASES.includes(phase) || !Number.isFinite(gapMs) || gapMs < 0) {
      recordError('main_watchdog_sample_invalid')
      return
    }
    if (countSample) channelCounts[phase].main += 1
    byPhase[phase].mainWatchdogMaxGapMs = Math.max(
      byPhase[phase].mainWatchdogMaxGapMs,
      gapMs,
    )
    if (gapMs >= LIVENESS_HARD_GATE_MS) recordError('main_watchdog_gate_breached')
  }

  /** Reserves the renderer serial queue without imposing one timeout across every transition step. */
  const runExclusiveRendererCollection = async (operation) => {
    if (rendererCollectionFailure !== null) {
      throwRendererCdpFailure(
        rendererCollectionFailure,
        'Archive-lifecycle renderer serialization failed.',
      )
    }
    let started = false
    let signalStarted
    const startedSignal = new Promise((resolve) => { signalStarted = resolve })
    const transaction = rendererCollectionSerial.then(async () => {
      started = true
      signalStarted()
      if (rendererCollectionFailure !== null) {
        throwRendererCdpFailure(
          rendererCollectionFailure,
          'Archive-lifecycle renderer serialization failed.',
        )
      }
      return operation()
    })
    rendererCollectionSerial = transaction.catch(() => undefined)
    try {
      await withTimeout(
        startedSignal,
        LIVENESS_HARD_GATE_MS,
        'Electron renderer liveness collection timed out.',
      )
    } catch (error) {
      if (started) return transaction
      rendererCollectionFailure = error
      throwRendererCdpFailure(
        error,
        'Archive-lifecycle renderer serialization failed.',
      )
    }
    return transaction
  }

  /** Collects one renderer snapshot while the caller owns the renderer serial queue. */
  const collectRendererSnapshotExclusively = async (
    launch,
    cleanup,
    recordSnapshot,
  ) => {
    if (rendererCollectionFailure !== null) throw rendererCollectionFailure
    const observedThroughMs = readExternalNow()
    if (observedThroughMs === null) throwIfInstrumentationFailed()
    const directCollection = Promise.resolve().then(() =>
      collectRenderer(launch.page, cleanup))
    let collectionSettled = false
    void directCollection.then(
      () => { collectionSettled = true },
      () => { collectionSettled = true },
    )
    try {
      const snapshot = await withTimeout(
        directCollection,
        LIVENESS_HARD_GATE_MS,
        cleanup
          ? 'Electron renderer liveness teardown timed out.'
          : 'Electron renderer liveness collection timed out.',
      )
      if (rendererCollectionFailure !== null) throw rendererCollectionFailure
      recordSnapshot(snapshot, observedThroughMs)
      return observedThroughMs
    } catch (error) {
      if (!collectionSettled) rendererCollectionFailure = error
      throw error
    }
  }

  /** Bounds renderer phase mutation and poisons evidence if an uncancelled request times out. */
  const setRendererPhaseBounded = async (page, phase, timeoutMessage) => {
    if (rendererCollectionFailure !== null) throw rendererCollectionFailure
    const phaseRequest = Promise.resolve().then(() => setRendererPhase(page, phase))
    let requestSettled = false
    void phaseRequest.then(
      () => { requestSettled = true },
      () => { requestSettled = true },
    )
    try {
      return await withTimeout(
        phaseRequest,
        LIVENESS_HARD_GATE_MS,
        timeoutMessage,
      )
    } catch (error) {
      if (!requestSettled) rendererCollectionFailure = error
      throw error
    }
  }

  /** Serializes each bounded renderer drain together with source-ledger correlation. */
  const collectAndRecordRendererSnapshot = (
    launch,
    cleanup = false,
    shouldRecord = () => true,
  ) => runExclusiveRendererCollection(() =>
    collectRendererSnapshotExclusively(
      launch,
      cleanup,
      (snapshot, observedThroughMs) => {
        if (shouldRecord()) recordRendererSnapshot(snapshot, observedThroughMs)
      },
    ))

  const collectCurrentRendererSnapshot = async () => {
    if (activeLaunch === null) {
      const observedThroughMs = readExternalNow()
      if (observedThroughMs === null) throwIfInstrumentationFailed()
      ingestSourceLedger()
      expirePendingSources(observedThroughMs)
      return observedThroughMs
    }
    try {
      return await collectAndRecordRendererSnapshot(activeLaunch, false)
    } catch (error) {
      throwRendererCdpFailure(
        error,
        'Archive-lifecycle renderer collection failed during liveness stop.',
      )
    }
  }

  const settlePendingPhase = async (phase) => {
    if (phase === null) {
      await collectCurrentRendererSnapshot()
      throwIfInstrumentationFailed()
      return
    }
    const deadline = readNow() + LIVENESS_HARD_GATE_MS
    while (true) {
      await collectCurrentRendererSnapshot()
      throwIfInstrumentationFailed()
      if (![...sourceByIdentity.values()].some((source) => source.phase === phase)) return
      if (readNow() >= deadline) {
        for (const [identity, source] of sourceByIdentity) {
          if (source.phase === phase) sourceByIdentity.delete(identity)
        }
        recordError('current_fix_not_observed_before_gate')
        throwIfInstrumentationFailed()
      }
      await wait(10)
    }
  }

  const pauseAndSettleActivePhase = async () => {
    const resumablePausedInterval = activePhase === null
      && activeContinuityInterval !== null
      && activeContinuityInterval.endedAtMs !== null
      ? activeContinuityInterval
      : null
    const pausedPhase = activePhase ?? resumablePausedInterval?.phase ?? null
    await mockServer.setPhase(null)
    if (pausedPhase === null) {
      if (activeContinuityInterval !== null) {
        recordError('current_fix_continuity_state_invalid')
      }
      await settlePendingPhase(null)
      return null
    }
    let pausedAtMs = resumablePausedInterval?.endedAtMs ?? null
    if (pausedAtMs === null) {
      pausedAtMs = readExternalNow()
      if (pausedAtMs === null) throwIfInstrumentationFailed()
      markContinuityIntervalEnded(pausedPhase, pausedAtMs)
    }
    activeLaunch?.externalLivenessWatchdog?.setPhase?.(null)
    activePhase = null
    await settlePendingPhase(pausedPhase)
    if (activeLaunch !== null) {
      const launch = activeLaunch
      rendererPhaseTransitionActive = true
      try {
        await runExclusiveRendererCollection(async () => {
          const collectPausedRendererSnapshot = async () => {
            try {
              await collectRendererSnapshotExclusively(
                launch,
                false,
                recordRendererSnapshot,
              )
            } catch (error) {
              throwRendererCdpFailure(
                error,
                'Archive-lifecycle renderer collection failed during liveness stop.',
              )
            }
            throwIfInstrumentationFailed()
          }
          await collectPausedRendererSnapshot()
          let previousFrameTail
          try {
            previousFrameTail = await setRendererPhaseBounded(
              launch.page,
              null,
              'Electron renderer liveness phase pause timed out.',
            )
          } catch (error) {
            throwRendererCdpFailure(
              error,
              'Archive-lifecycle renderer phase pause failed during liveness stop.',
            )
          }
          recordRendererFrameTail(previousFrameTail)
          throwIfInstrumentationFailed()
          await collectPausedRendererSnapshot()
        })
      } finally {
        rendererPhaseTransitionActive = false
      }
      await settlePendingPhase(pausedPhase)
    }
    closeContinuityInterval(pausedPhase, pausedAtMs)
    throwIfInstrumentationFailed()
    return pausedPhase
  }

  const resumePhase = async (phase) => {
    if (activeLaunch !== null) {
      let previousFrameTail
      try {
        previousFrameTail = await setRendererPhaseBounded(
          activeLaunch.page,
          phase,
          'Electron renderer liveness phase transition timed out.',
        )
      } catch (error) {
        throwRendererCdpFailure(
          error,
          'Archive-lifecycle renderer phase transition failed.',
        )
      }
      recordRendererFrameTail(previousFrameTail)
      throwIfInstrumentationFailed()
    }
    beginContinuityInterval(phase)
    throwIfInstrumentationFailed()
    activePhase = phase
    activeLaunch?.externalLivenessWatchdog?.setPhase?.(phase)
    auditActiveContinuity()
    throwIfInstrumentationFailed()
    await mockServer.setPhase(phase)
    auditActiveContinuity()
    throwIfInstrumentationFailed()
  }

  const transitionToPhase = async (phase) => {
    requireLivenessPhase(phase)
    if (activePhase === phase) return
    if (activePhase === null) {
      await resumePhase(phase)
      return
    }
    const previousPhase = activePhase
    await collectCurrentRendererSnapshot()
    throwIfInstrumentationFailed()
    if (activeLaunch === null) {
      await mockServer.setPhase(phase)
      const switchedAtMs = readExternalNow()
      if (switchedAtMs === null) throwIfInstrumentationFailed()
      activePhase = phase
      transitionActiveContinuityPhase(previousPhase, phase, switchedAtMs)
      throwIfInstrumentationFailed()
      return
    }
    const launch = activeLaunch
    rendererPhaseTransitionActive = true
    try {
      await runExclusiveRendererCollection(async () => {
        let previousFrameTail
        try {
          previousFrameTail = await setRendererPhaseBounded(
            launch.page,
            phase,
            'Electron renderer liveness phase transition timed out.',
          )
        } catch (error) {
          throwRendererCdpFailure(
            error,
            'Archive-lifecycle renderer phase transition failed.',
          )
        }
        recordRendererFrameTail(previousFrameTail)
        throwIfInstrumentationFailed()
        await mockServer.setPhase(phase)
        let transitionCommitted = false
        try {
          await collectRendererSnapshotExclusively(
            launch,
            false,
            (snapshot, switchedAtMs) => {
              const partition = partitionRendererSnapshotAt(snapshot, switchedAtMs)
              if (partition === null) {
                recordRendererSnapshot(snapshot, switchedAtMs)
                return
              }
              recordRendererSnapshot(partition.previous, switchedAtMs)
              if (errors.size > 0) return
              activePhase = phase
              launch.externalLivenessWatchdog?.setPhase?.(phase)
              transitionActiveContinuityPhase(previousPhase, phase, switchedAtMs)
              if (errors.size > 0) return
              recordRendererSnapshot(partition.next, switchedAtMs)
              transitionCommitted = true
            },
          )
        } catch (error) {
          throwRendererCdpFailure(
            error,
            'Archive-lifecycle renderer collection failed during liveness stop.',
          )
        }
        throwIfInstrumentationFailed()
        if (!transitionCommitted) {
          recordError('renderer_liveness_snapshot_invalid')
          throwIfInstrumentationFailed()
        }
      })
    } finally {
      rendererPhaseTransitionActive = false
    }
  }

  const attachLaunch = async (launch) => {
    return enqueue(async () => {
      if (finished || activeLaunch !== null) {
        throw new Error('Archive-lifecycle liveness launch attachment is invalid.')
      }
      await installRenderer(launch.page, mockServer.deviceId)
      const preservedPhase = activePhase
      activePhase = null
      activeLaunch = launch
      if (preservedPhase !== null) await resumePhase(preservedPhase)
      const watchdog = startWatchdog({
        launch,
        readPhase: () => activePhase,
        onMainGap: recordMainGap,
        onRendererSnapshot: recordRendererSnapshot,
        collectRendererSnapshot: (cleanup = false, shouldRecord = () => true) => {
          if (!cleanup && rendererPhaseTransitionActive) return Promise.resolve()
          return collectAndRecordRendererSnapshot(launch, cleanup, shouldRecord)
        },
        onError: recordError,
      })
      launch.externalLivenessWatchdog = watchdog
    })
  }

  /** Classifies final delegated renderer-drain failures at the probe boundary. */
  const stopExternalWatchdog = async (launch) => {
    if (launch.externalLivenessWatchdog === undefined) return
    try {
      await launch.externalLivenessWatchdog.stop()
    } catch (error) {
      throwRendererCdpFailure(
        error,
        'Archive-lifecycle renderer watchdog teardown failed.',
      )
    }
  }

  const detachLaunch = async (launch) => {
    return enqueue(async () => {
      if (activeLaunch !== launch) {
        throw new Error('Archive-lifecycle liveness launch detachment is invalid.')
      }
      const preservedPhase = await pauseAndSettleActivePhase()
      if (launch.externalLivenessWatchdog !== undefined) {
        await stopExternalWatchdog(launch)
        launch.externalLivenessWatchdog = undefined
      }
      ingestSourceLedger()
      expirePendingSources()
      throwIfInstrumentationFailed()
      if (sourceByIdentity.size !== 0) {
        recordError('source_identity_left_pending_at_detach')
        throwIfInstrumentationFailed()
      }
      activeLaunch = null
      if (preservedPhase !== null) activePhase = preservedPhase
    })
  }

  const setPhase = async (phase) => {
    return enqueue(() => transitionToPhase(phase))
  }

  const setPhaseFromRenderer = (phase) => {
    return setPhase(phase)
  }

  const beginPhaseOperations = async (
    phases,
    kinds,
  ) => enqueue(async () => {
    const resolvedKinds = kinds === undefined && Array.isArray(phases)
      ? phases.map(() => 'unspecified')
      : kinds
    if (!Array.isArray(phases) || phases.length < 1
      || new Set(phases).size !== phases.length
      || !Array.isArray(resolvedKinds) || resolvedKinds.length !== phases.length
      || Array.from(resolvedKinds).some((kind) => typeof kind !== 'string'
        || !LIVENESS_OPERATION_KIND_PATTERN.test(kind))) {
      throw new Error('Archive-lifecycle liveness operation phases are invalid.')
    }
    for (const phase of phases) requireLivenessPhase(phase)
    throwIfInstrumentationFailed()
    await collectCurrentRendererSnapshot()
    const startSourceSequence = readSourceSequenceFence()
    throwIfInstrumentationFailed()
    const startedAtMs = readNow()
    if (!Number.isSafeInteger(startedAtMs) || startedAtMs < 0) {
      recordError('external_watchdog_clock_invalid')
      throwIfInstrumentationFailed()
    }
    const checkpoints = phases.map((phase, index) => Object.freeze({
      phase,
      kind: resolvedKinds[index],
      sampleCount: byPhase[phase].sampleCount,
    }))
    checkpoints.forEach((checkpoint) => operationCheckpoints.set(checkpoint, {
      phase: checkpoint.phase,
      kind: checkpoint.kind,
      startedAtMs,
      endedAtMs: null,
      startSourceSequence,
      endSourceSequence: null,
      freshSampleCount: 0,
      continuitySegmentStartedAtMs: activePhase === checkpoint.phase ? startedAtMs : null,
      continuitySegmentEndedAtMs: null,
      continuityLastObservedAtMs: null,
    }))
    return checkpoints
  })

  const beginPhaseOperation = async (phase, kind = 'unspecified') => {
    const [checkpoint] = await beginPhaseOperations([phase], [kind])
    return checkpoint
  }

  const endPhaseOperations = async (checkpoints) => enqueue(async () => {
    const operations = checkpoints.map((checkpoint) => operationCheckpoints.get(checkpoint))
    if (operations.some((operation) => operation === undefined || operation.endedAtMs !== null)) {
      throw new Error('Archive-lifecycle liveness operation checkpoint is invalid.')
    }
    const endedAtMs = readNow()
    if (!Number.isSafeInteger(endedAtMs) || endedAtMs < 0
      || operations.some((operation) => endedAtMs < operation.startedAtMs)) {
      recordError('external_watchdog_clock_invalid')
      throwIfInstrumentationFailed()
    }
    const endSourceSequence = readSourceSequenceFence()
    throwIfInstrumentationFailed()
    for (const operation of operations) {
      operation.endedAtMs = endedAtMs
      operation.endSourceSequence = endSourceSequence
    }
    let collectionFailure
    try {
      await collectCurrentRendererSnapshot()
    } catch (error) {
      collectionFailure = error
    } finally {
      for (const operation of operations) {
        closeOperationContinuitySegment(operation, endedAtMs)
      }
      auditActiveContinuity(endedAtMs)
    }
    if (collectionFailure !== undefined) throw collectionFailure
    throwIfInstrumentationFailed()
  })

  const endPhaseOperation = (checkpoint) => endPhaseOperations([checkpoint])

  /** Identifies only the finite source interval owned by one ended operation. */
  const sourceIsPendingFromOperation = (source, operation) => (
    source.phase === operation.phase
    && source.sequence > operation.startSourceSequence
    && source.sequence <= operation.endSourceSequence
    && source.requestStartedAtMs >= operation.startedAtMs
    && source.emittedAtMs >= operation.startedAtMs
    && source.requestStartedAtMs < operation.endedAtMs
    && source.emittedAtMs < operation.endedAtMs
  )

  /** Settles in-window identities without chasing the continuously moving tail. */
  const settlePendingOperationSources = async (operation) => {
    while ([...sourceByIdentity.values()].some((source) =>
      sourceIsPendingFromOperation(source, operation))) {
      await collectCurrentRendererSnapshot()
      throwIfInstrumentationFailed()
      if (![...sourceByIdentity.values()].some((source) =>
        sourceIsPendingFromOperation(source, operation))) return
      await wait(10)
    }
  }

  const completePhaseOperation = async (checkpoint) => enqueue(async () => {
    const operation = operationCheckpoints.get(checkpoint)
    if (operation === undefined || operation.endedAtMs === null) {
      throw new Error('Archive-lifecycle liveness operation checkpoint is invalid.')
    }
    const phase = checkpoint.phase
    await collectCurrentRendererSnapshot()
    await settlePendingOperationSources(operation)
    operationCheckpoints.delete(checkpoint)
    const advanced = byPhase[phase].sampleCount > checkpoint.sampleCount
      && operation.freshSampleCount > 0
    throwIfInstrumentationFailed()
    if (!advanced) {
      throw new Error(
        `Archive-lifecycle ${phase} operation completed without a fresh MapLibre current fix.`,
      )
    }
  })

  const guardOperation = async (operationPromise, checkpoints = []) => {
    throwIfInstrumentationFailed()
    const boundedCheckpoints = Array.isArray(checkpoints) ? checkpoints : [checkpoints]
    for (const checkpoint of boundedCheckpoints) {
      const operation = operationCheckpoints.get(checkpoint)
      if (operation === undefined || operation.endedAtMs !== null) {
        throw new Error('Archive-lifecycle liveness operation checkpoint is invalid.')
      }
    }
    const result = await Promise.race([
      Promise.resolve(operationPromise),
      failureSignal.then(() => throwIfInstrumentationFailed()),
    ])
    if (boundedCheckpoints.length > 0) await endPhaseOperations(boundedCheckpoints)
    return result
  }

  const waitForPhaseSample = async (phase, timeoutMs, minimumCount = 1) => {
    requireLivenessPhase(phase)
    if (!Number.isSafeInteger(minimumCount) || minimumCount < 1) {
      throw new Error('Archive-lifecycle liveness sample target is invalid.')
    }
    const deadline = readNow() + timeoutMs
    while (readNow() < deadline) {
      await collectCurrentRendererSnapshot()
      throwIfInstrumentationFailed()
      if (byPhase[phase].sampleCount >= minimumCount
        && channelCounts[phase].main > 0
        && channelCounts[phase].rendererFrame > 0) return
      await wait(10)
    }
    throw new Error(`Archive-lifecycle ${phase} liveness did not produce a full sample.`)
  }

  const stop = async (knownFailure = null) => {
    return enqueue(async () => {
      const suppressKnownFailure = knownFailure !== null
        && knownFailure === instrumentationFailure
      const previousIgnoredFailure = ignoredInstrumentationFailure
      const previousPreserveStopFailureCause = preserveStopFailureCause
      if (suppressKnownFailure) {
        ignoredInstrumentationFailure = knownFailure
        preserveStopFailureCause = true
      }
      try {
        if (activeLaunch !== null) {
          const launch = activeLaunch
          let launchStopFailure
          try {
            await pauseAndSettleActivePhase()
          } catch (error) {
            launchStopFailure = error
          }
          try {
            await stopExternalWatchdog(launch)
          } catch (error) {
            launchStopFailure = launchStopFailure === undefined
              ? error
              : new AggregateError(
                  [launchStopFailure, error],
                  'Archive-lifecycle liveness stop recorded multiple failures.',
                )
          } finally {
            launch.externalLivenessWatchdog = undefined
            activeLaunch = null
            activePhase = null
            activeContinuityInterval = null
          }
          if (launchStopFailure !== undefined) throw launchStopFailure
        } else {
          await mockServer.setPhase(null)
          activePhase = null
          if (activeContinuityInterval !== null) {
            recordError('current_fix_continuity_state_invalid')
            activeContinuityInterval = null
          }
        }
        ingestSourceLedger()
        expirePendingSources()
        if (sourceByIdentity.size !== 0) recordError('source_identity_left_pending_at_finish')
        throwIfInstrumentationFailed()
      } finally {
        ignoredInstrumentationFailure = previousIgnoredFailure
        preserveStopFailureCause = previousPreserveStopFailureCause
      }
    })
  }

  const finish = async () => {
    if (finished) throw new Error('Archive-lifecycle liveness evidence is already finalized.')
    await stop()
    finished = true
    if (operationCheckpoints.size !== 0) recordError('liveness_operation_not_completed')
    if (activeContinuityInterval !== null) {
      recordError('current_fix_continuity_state_invalid')
    }
    throwIfInstrumentationFailed()
    for (const phase of LIVENESS_PHASES) {
      const evidence = byPhase[phase]
      if (evidence.sampleCount < 1
        || channelCounts[phase].main < 1
        || channelCounts[phase].rendererFrame < 1) {
        throw new Error(`Archive-lifecycle ${phase} liveness evidence is incomplete.`)
      }
      for (const value of [
        evidence.currentFixMaxGapMs,
        evidence.sourceToRendererMaxMs,
        evidence.requestToRendererMaxMs,
        evidence.mainWatchdogMaxGapMs,
        evidence.rendererFrameMaxGapMs,
      ]) {
        if (!Number.isFinite(value) || value < 0 || value >= LIVENESS_HARD_GATE_MS) {
          throw new Error(`Archive-lifecycle ${phase} liveness breached the hard gate.`)
        }
      }
    }
    return {
      provenance: 'packaged-electron-external-watchdog-v1',
      hardGateMs: LIVENESS_HARD_GATE_MS,
      pollProfile: {
        mode: 'time-compressed-validation',
        intervalMs: LIVENESS_POLL_INTERVAL_MS,
      },
      byPhase: Object.fromEntries(LIVENESS_PHASES.map((phase) => [phase, {
        sampleCount: byPhase[phase].sampleCount,
        currentFixMaxGapMs: roundMilliseconds(byPhase[phase].currentFixMaxGapMs),
        sourceToRendererMaxMs: roundMilliseconds(byPhase[phase].sourceToRendererMaxMs),
        requestToRendererMaxMs: roundMilliseconds(byPhase[phase].requestToRendererMaxMs),
        mainWatchdogMaxGapMs: roundMilliseconds(byPhase[phase].mainWatchdogMaxGapMs),
        rendererFrameMaxGapMs: roundMilliseconds(byPhase[phase].rendererFrameMaxGapMs),
      }])),
    }
  }

  return {
    attachLaunch,
    beginPhaseOperation,
    beginPhaseOperations,
    completePhaseOperation,
    detachLaunch,
    endPhaseOperation,
    finish,
    guardOperation,
    setPhase,
    setPhaseFromRenderer,
    stop,
    waitForPhaseSample,
    phaseSampleCount: (phase) => byPhase[phase]?.sampleCount ?? 0,
  }
}

/** Starts independent inspector and renderer-CDP watchdog loops for one launch. */
export function startExternalLaunchWatchdog(input) {
  let stopped = false
  let stopPromise = null
  let attributedPhase = input.readPhase()
  let previousCompletedAt = performance.now()
  const collectRendererSnapshot = async (cleanup) => {
    if (typeof input.collectRendererSnapshot === 'function') {
      await input.collectRendererSnapshot(cleanup, () => cleanup || !stopped)
      return
    }
    return withTimeout(
      collectRendererLivenessProbe(input.launch.page, cleanup),
      LIVENESS_HARD_GATE_MS,
      cleanup
        ? 'Electron renderer liveness teardown timed out.'
        : 'Electron renderer liveness watchdog timed out.',
    )
  }
  /** Records the old phase tail without resetting cross-phase heartbeat continuity. */
  const setPhase = (phase) => {
    if (phase !== null && !LIVENESS_PHASES.includes(phase)) {
      input.onError('main_watchdog_sample_invalid')
      return
    }
    if (phase === attributedPhase) return
    const switchedAt = performance.now()
    const previousPhaseWasActive = LIVENESS_PHASES.includes(attributedPhase)
    if (previousPhaseWasActive) {
      input.onMainGap(attributedPhase, switchedAt - previousCompletedAt, false)
    }
    attributedPhase = phase
    if (!previousPhaseWasActive && LIVENESS_PHASES.includes(phase)) {
      previousCompletedAt = switchedAt
    }
  }
  const mainTask = (async () => {
    while (!stopped) {
      const cycleStartedAt = performance.now()
      try {
        await withTimeout(
          input.launch.mainInspector.evaluate('process.uptime()'),
          LIVENESS_HARD_GATE_MS,
          'Electron main inspector watchdog timed out.',
        )
        const completedAt = performance.now()
        if (!stopped && LIVENESS_PHASES.includes(attributedPhase)) {
          input.onMainGap(attributedPhase, completedAt - previousCompletedAt, true)
        }
        previousCompletedAt = completedAt
      } catch {
        if (!stopped) input.onError('main_inspector_watchdog_failed')
      }
      await delay(Math.max(0, LIVENESS_POLL_INTERVAL_MS -
        (performance.now() - cycleStartedAt)))
    }
  })()
  const rendererTask = (async () => {
    while (!stopped) {
      const cycleStartedAt = performance.now()
      try {
        const snapshot = await collectRendererSnapshot(false)
        if (!stopped && snapshot !== undefined) input.onRendererSnapshot(snapshot)
      } catch {
        if (!stopped) input.onError('renderer_cdp_watchdog_failed')
      }
      await delay(Math.max(0, LIVENESS_POLL_INTERVAL_MS -
        (performance.now() - cycleStartedAt)))
    }
  })()

  return {
    setPhase,
    stop: () => {
      stopPromise ??= (async () => {
        setPhase(null)
        stopped = true
        await Promise.all([mainTask, rendererTask])
        const finalSnapshot = await collectRendererSnapshot(true)
        if (finalSnapshot !== undefined) input.onRendererSnapshot(finalSnapshot)
      })()
      return stopPromise
    },
  }
}

/** Installs the MapLibre identity observer and frame-gap recorder via renderer CDP. */
export async function installRendererLivenessProbe(page, deviceId, timeoutMs = 60_000) {
  const deadline = performance.now() + timeoutMs
  await page.waitForFunction(() => {
    const source = window.__SARTRACKER_MAP__?.getSource('tracking')
    return source !== undefined
      && typeof source.setData === 'function'
      && typeof source.updateData === 'function'
  }, undefined, { timeout: Math.max(1, deadline - performance.now()) })
  await withTimeout(page.evaluate(({ expectedDeviceId, ledgerCapacity, phases }) => {
    window.__SARTRACKER_ARCHIVE_LIVENESS__?.cleanup()
    const source = window.__SARTRACKER_MAP__?.getSource('tracking')
    if (source === undefined
      || typeof source.setData !== 'function'
      || typeof source.updateData !== 'function') {
      throw new Error('Packaged MapLibre tracking source is unavailable.')
    }
    const allowedPhases = new Set(phases)
    const currentFixes = []
    const frameGaps = []
    const originalSetData = source.setData
    const originalUpdateData = source.updateData
    let phase = null
    let previousFrameAt = performance.now()
    let frameId = null
    let stopped = false
    let latestSourcePositionId = null
    let latestCurrentFixMonotonicAt = null
    let latestCurrentFixPhase = null
    let currentFixOverflowCount = 0
    let frameGapOverflowCount = 0

    const appendBounded = (ledger, value, recordOverflow) => {
      if (ledger.length >= ledgerCapacity) {
        ledger.shift()
        recordOverflow()
      }
      ledger.push(value)
    }

    const recordCurrentFix = (value) => {
      if (!allowedPhases.has(phase)) return
      const features = Array.isArray(value?.features)
        ? value.features
        : Array.isArray(value?.add)
          ? value.add
          : []
      const feature = features.find((candidate) =>
        candidate?.properties?.featureKind === 'device'
        && candidate.properties.deviceId === String(expectedDeviceId))
      const sourcePositionId = feature?.properties?.sourcePositionId
      const sourceTimestamp = feature?.properties?.timestamp
      if (typeof sourcePositionId !== 'string' || sourcePositionId === ''
        || typeof sourceTimestamp !== 'string' || sourceTimestamp === ''
        || sourcePositionId === latestSourcePositionId) return
      latestSourcePositionId = sourcePositionId
      latestCurrentFixMonotonicAt = performance.now()
      latestCurrentFixPhase = phase
      appendBounded(currentFixes, {
        phase,
        sourcePositionId,
        sourceTimestamp,
        observedAtMs: Date.now(),
      }, () => { currentFixOverflowCount += 1 })
    }

    source.setData = function setLivenessObservedData(data) {
      const result = Reflect.apply(originalSetData, this, [data])
      recordCurrentFix(data)
      return result
    }
    source.updateData = function updateLivenessObservedData(diff) {
      const result = Reflect.apply(originalUpdateData, this, [diff])
      recordCurrentFix(diff)
      return result
    }

    const frame = () => {
      if (stopped) return
      const observedAt = performance.now()
      if (allowedPhases.has(phase)) {
        appendBounded(
          frameGaps,
          { phase, gapMs: observedAt - previousFrameAt },
          () => { frameGapOverflowCount += 1 },
        )
      }
      previousFrameAt = observedAt
      frameId = window.requestAnimationFrame(frame)
    }
    frameId = window.requestAnimationFrame(frame)

    window.__SARTRACKER_ARCHIVE_LIVENESS__ = {
      setPhase: (nextPhase) => {
        if (nextPhase !== null && !allowedPhases.has(nextPhase)) {
          throw new Error('Renderer liveness phase is invalid.')
        }
        const switchedAt = performance.now()
        const previousFrameTail = allowedPhases.has(phase)
          ? { phase, gapMs: switchedAt - previousFrameAt }
          : null
        const previousPhaseWasActive = allowedPhases.has(phase)
        phase = nextPhase
        latestCurrentFixMonotonicAt = null
        latestCurrentFixPhase = null
        if (!previousPhaseWasActive) previousFrameAt = switchedAt
        return previousFrameTail
      },
      drain: () => {
        const snapshot = {
          currentFixes: currentFixes.splice(0, currentFixes.length),
          currentFixTail: allowedPhases.has(phase)
            && latestCurrentFixPhase === phase
            && latestCurrentFixMonotonicAt !== null
            ? { phase, gapMs: performance.now() - latestCurrentFixMonotonicAt }
            : null,
          frameGaps: frameGaps.splice(0, frameGaps.length),
          frameTail: allowedPhases.has(phase)
            ? { phase, gapMs: performance.now() - previousFrameAt }
            : null,
          currentFixOverflowCount,
          frameGapOverflowCount,
        }
        currentFixOverflowCount = 0
        frameGapOverflowCount = 0
        return snapshot
      },
      cleanup: () => {
        if (stopped) return
        stopped = true
        if (frameId !== null) window.cancelAnimationFrame(frameId)
        source.setData = originalSetData
        source.updateData = originalUpdateData
      },
    }
  }, {
    expectedDeviceId: deviceId,
    ledgerCapacity: RENDERER_LIVENESS_LEDGER_CAPACITY,
    phases: LIVENESS_PHASES,
  }), Math.max(1, deadline - performance.now()),
  'Archive-lifecycle renderer liveness probe installation timed out.')
}

/** Changes the renderer-frame and MapLibre observer phase before source emission. */
async function setRendererLivenessPhase(page, phase) {
  return page.evaluate((nextPhase) => {
    const probe = window.__SARTRACKER_ARCHIVE_LIVENESS__
    if (probe === undefined) throw new Error('Renderer liveness probe is unavailable.')
    return probe.setPhase(nextPhase)
  }, phase)
}

/** Drains bounded renderer observations, optionally restoring MapLibre methods. */
async function collectRendererLivenessProbe(page, cleanup) {
  return page.evaluate((shouldCleanup) => {
    const probe = window.__SARTRACKER_ARCHIVE_LIVENESS__
    if (probe === undefined) throw new Error('Renderer liveness probe is unavailable.')
    const snapshot = probe.drain()
    if (shouldCleanup) {
      probe.cleanup()
      delete window.__SARTRACKER_ARCHIVE_LIVENESS__
    }
    return snapshot
  }, cleanup)
}

/** Rejects unknown lifecycle labels before they can weaken phase attribution. */
function requireLivenessPhase(phase) {
  if (!LIVENESS_PHASES.includes(phase)) {
    throw new Error('Archive-lifecycle liveness phase is invalid.')
  }
}

/** Retains deterministic sub-millisecond watchdog maxima in JSON evidence. */
function roundMilliseconds(value) {
  return Math.round(value * 1_000) / 1_000
}

/** Launches one packaged Electron main process and connects to its sandboxed renderer. */
async function launchPackagedApp(options, userDataDir, number) {
  const remoteDebuggingPort = await findFreePort()
  let inspectorPort = await findFreePort()
  while (inspectorPort === remoteDebuggingPort) inspectorPort = await findFreePort()
  const appProcess = spawn(
    options.appPath,
    [
      `--inspect=${inspectorPort}`,
      `--remote-debugging-port=${remoteDebuggingPort}`,
      ...options.extraArgs,
    ],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        SARTRACKER_ELECTRON_USER_DATA_PATH: userDataDir,
        SARTRACKER_ELECTRON_BLOCK_NETWORK: '1',
        SARTRACKER_ELECTRON_SOAK_POLL_INTERVAL_MS: String(LIVENESS_POLL_INTERVAL_MS),
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
  let mainInspector
  try {
    await waitForCdp(remoteDebuggingPort, appProcess, () => launchError)
    mainInspector = await connectMainInspector(inspectorPort, appProcess)
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${remoteDebuggingPort}`)
    const context = browser.contexts()[0]
    const page = context.pages()[0] ?? await context.waitForEvent('page')
    await page.getByTestId('app-shell').waitFor({ state: 'attached', timeout: 60_000 })
    await page.locator('.maplibregl-canvas').waitFor({ state: 'attached', timeout: 60_000 })
    const visibleVersionText = await page.getByTestId('app-title').locator('..').innerText()
    const packagedBuildHeadMatched = renderedVersionContainsExactHead(
      visibleVersionText,
      options.expectedHead,
    )
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
      mainInspector,
      exit,
      exitResult: null,
      packagedBuildHeadMatched,
      closed: false,
    }
  } catch (error) {
    mainInspector?.close()
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
  await launch.externalLivenessWatchdog?.stop().catch(() => undefined)
  launch.mainInspector?.close()
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

/** Connects an external Runtime inspector to the packaged Electron main process. */
async function connectMainInspector(port, appProcess) {
  const deadline = Date.now() + 60_000
  let webSocketUrl
  while (Date.now() < deadline) {
    if (appProcess.exitCode !== null || appProcess.signalCode !== null) {
      throw new Error('Packaged Electron exited before main-inspector readiness.')
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`)
      if (response.ok) {
        const targets = await response.json()
        webSocketUrl = targets[0]?.webSocketDebuggerUrl
        if (typeof webSocketUrl === 'string') break
      }
    } catch {
      // Main-inspector readiness is polled until the bounded deadline.
    }
    await delay(100)
  }
  if (typeof webSocketUrl !== 'string') {
    throw new Error('Timed out waiting for packaged Electron main-inspector readiness.')
  }

  const socket = new WebSocket(webSocketUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener(
      'error',
      () => reject(new Error('Packaged Electron main inspector failed to connect.')),
      { once: true },
    )
  })
  let requestId = 0
  let closed = false
  const pending = new Map()
  const rejectPending = () => {
    if (closed) return
    closed = true
    for (const request of pending.values()) {
      request.reject(new Error('Packaged Electron main inspector closed.'))
    }
    pending.clear()
  }
  socket.addEventListener('close', rejectPending)
  socket.addEventListener('error', rejectPending)
  socket.addEventListener('message', (event) => {
    let message
    try {
      message = JSON.parse(String(event.data))
    } catch {
      rejectPending()
      return
    }
    const request = pending.get(message.id)
    if (request === undefined) return
    pending.delete(message.id)
    if (message.error !== undefined || message.result?.exceptionDetails !== undefined) {
      request.reject(new Error('Packaged Electron main inspector evaluation failed.'))
      return
    }
    request.resolve(message.result?.result?.value)
  })

  return {
    evaluate: (expression) => new Promise((resolve, reject) => {
      if (closed) {
        reject(new Error('Packaged Electron main inspector is closed.'))
        return
      }
      requestId += 1
      pending.set(requestId, { resolve, reject })
      socket.send(JSON.stringify({
        id: requestId,
        method: 'Runtime.evaluate',
        params: { expression, returnByValue: true },
      }))
    }),
    close: () => {
      if (closed) return
      rejectPending()
      socket.close()
    },
  }
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

/** Accepts one fixed, non-sensitive cleanup stage identifier. */
function cleanupStepNameIsValid(value) {
  return typeof value === 'string'
    && value.length >= 1
    && value.length <= CLEANUP_STEP_NAME_LIMIT
    && CLEANUP_STEP_NAME_PATTERN.test(value)
    && !value.startsWith(UNREADABLE_CLEANUP_DETAIL_STEP_PREFIX)
}

/**
 * Settles owned runtime resources and removes the disposable profile only after
 * every launch stop has been confirmed.
 */
export async function cleanupArchiveLifecycleResources(input) {
  if (!Array.isArray(input?.steps)
    || input.steps.length > CLEANUP_STEP_LIMIT
    || input.steps.some((step) => !cleanupStepNameIsValid(step?.name)
      || step.name === PROFILE_REMOVAL_STEP
      || typeof step?.run !== 'function'
      || typeof step.blocksProfileCleanup !== 'boolean')
    || new Set(input.steps.map((step) => step.name)).size !== input.steps.length
    || typeof input?.removeProfile !== 'function'
    || (input.profilePath !== null && typeof input.profilePath !== 'string')) {
    throw new Error('Archive-lifecycle cleanup inputs are invalid.')
  }
  const primaryFailure = input.failure
  const hasPrimaryFailure = primaryFailure !== null && primaryFailure !== undefined
  let failure = input.failure
  let processCleanupCompleted = true
  const cleanupFailures = []
  const retainCleanupFailure = (step, error) => {
    if (step === LIVENESS_PROBE_STOP_STEP
      && hasPrimaryFailure && error === primaryFailure) return
    cleanupFailures.push(Object.freeze({ step, error }))
  }
  for (const step of input.steps) {
    try {
      await step.run()
    } catch (error) {
      const normalizedError = normalizeNullishCleanupFailure(error, step.name)
      retainCleanupFailure(step.name, normalizedError)
      if (failure === null || failure === undefined) failure = normalizedError
      if (step.blocksProfileCleanup) processCleanupCompleted = false
    }
  }
  let profileCleanupCompleted = input.profilePath === null && processCleanupCompleted
  if (input.profilePath !== null && processCleanupCompleted) {
    try {
      await input.removeProfile(input.profilePath)
      profileCleanupCompleted = true
    } catch (error) {
      const normalizedError = normalizeNullishCleanupFailure(error, PROFILE_REMOVAL_STEP)
      retainCleanupFailure(PROFILE_REMOVAL_STEP, normalizedError)
      if (failure === null || failure === undefined) failure = normalizedError
    }
  }
  return Object.freeze({
    cleanupFailureCount: cleanupFailures.length,
    cleanupFailures: Object.freeze(cleanupFailures),
    failure: failure ?? null,
    processCleanupCompleted,
    profileCleanupCompleted,
  })
}

/** Converts a nullish rejection into one stable, receipt-safe failure. */
function normalizeNullishCleanupFailure(error, step) {
  if (error !== null && error !== undefined) return error
  return new Error(`Archive-lifecycle cleanup step ${step} failed without a reason.`)
}

/** Creates one bounded placeholder when hostile detail access cannot be trusted. */
function unreadableCleanupFailureDetail(index) {
  return Object.freeze({
    step: `${UNREADABLE_CLEANUP_DETAIL_STEP_PREFIX}${index}`,
    error: new Error(UNREADABLE_CLEANUP_DETAIL_MESSAGE),
  })
}

/** Reads one own detail field without trusting proxy traps or accessors. */
function readCleanupFailureDetailField(detail, field) {
  try {
    if (!Object.hasOwn(detail, field)) return { state: 'missing', value: undefined }
    return { state: 'present', value: detail[field] }
  } catch {
    return { state: 'unreadable', value: undefined }
  }
}

/** Classifies array identity without allowing a revoked proxy to escape. */
function safelyIsArray(value) {
  try {
    return Array.isArray(value)
  } catch {
    return null
  }
}

/** Reads one bounded detail list while preserving count consistency. */
function readConsistentCleanupFailureDetails(input) {
  if (!Number.isSafeInteger(input.cleanupFailureCount)
    || input.cleanupFailureCount < 0
    || input.cleanupFailureCount > CLEANUP_FAILURE_DETAIL_LIMIT) {
    throw new Error('Archive-lifecycle cleanup failure count does not match its details.')
  }
  const unreadableDetails = () => Object.freeze(Array.from(
    { length: input.cleanupFailureCount },
    (_entry, index) => unreadableCleanupFailureDetail(index),
  ))
  let details
  try {
    details = input.cleanupFailures
  } catch {
    return unreadableDetails()
  }
  const arrayIdentity = safelyIsArray(details)
  if (arrayIdentity === null) return unreadableDetails()
  if (!arrayIdentity) {
    throw new Error('Archive-lifecycle cleanup failure count does not match its details.')
  }
  let detailCount
  try {
    detailCount = details.length
  } catch {
    return unreadableDetails()
  }
  if (detailCount !== input.cleanupFailureCount) {
    throw new Error('Archive-lifecycle cleanup failure count does not match its details.')
  }
  const names = new Set()
  const projected = []
  for (let index = 0; index < detailCount; index += 1) {
    let detail
    try {
      detail = details[index]
    } catch {
      projected.push(unreadableCleanupFailureDetail(index))
      continue
    }
    const detailArrayIdentity = safelyIsArray(detail)
    if (detailArrayIdentity === null) {
      projected.push(unreadableCleanupFailureDetail(index))
      continue
    }
    if (detail === null || typeof detail !== 'object' || detailArrayIdentity) {
      throw new Error('Archive-lifecycle cleanup failure details are invalid.')
    }
    const step = readCleanupFailureDetailField(detail, 'step')
    const error = readCleanupFailureDetailField(detail, 'error')
    if (step.state === 'unreadable' || error.state === 'unreadable') {
      projected.push(unreadableCleanupFailureDetail(index))
      continue
    }
    if (step.state !== 'present' || error.state !== 'present'
      || !cleanupStepNameIsValid(step.value) || names.has(step.value)) {
      throw new Error('Archive-lifecycle cleanup failure details are invalid.')
    }
    names.add(step.value)
    projected.push(Object.freeze({
      step: step.value,
      error: normalizeNullishCleanupFailure(error.value, step.value),
    }))
  }
  return Object.freeze(projected)
}

/** Projects only known, finite liveness fields into terminal evidence. */
function readProjectedArchiveLifecycleDiagnostics(error, secrets) {
  let diagnostics
  try {
    diagnostics = error?.archiveLifecycleDiagnostics
  } catch {
    return null
  }
  const arrayIdentity = safelyIsArray(diagnostics)
  if (diagnostics === null || typeof diagnostics !== 'object'
    || arrayIdentity !== false) return null
  const seen = new WeakSet()
  const budget = { remaining: DIAGNOSTIC_ENTRY_LIMIT }
  const projected = projectArchiveLifecycleDiagnosticValue(
    diagnostics,
    secrets,
    seen,
    budget,
    0,
  )
  return projected === OMITTED_DIAGNOSTIC_VALUE ? null : projected
}

/** Recursively copies one allow-listed diagnostic value within fixed bounds. */
function projectArchiveLifecycleDiagnosticValue(value, secrets, seen, budget, depth) {
  if (budget.remaining <= 0) return OMITTED_DIAGNOSTIC_VALUE
  budget.remaining -= 1
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') return sanitizeFailureMessage(value, secrets)
  if (depth >= DIAGNOSTIC_DEPTH_LIMIT) return null
  const arrayIdentity = safelyIsArray(value)
  if (arrayIdentity === null) return null
  if (typeof value !== 'object') return null
  if (seen.has(value)) return null
  seen.add(value)
  if (arrayIdentity) {
    const projected = []
    let length
    try {
      length = value.length
    } catch {
      return projected
    }
    if (!Number.isSafeInteger(length) || length < 0) return projected
    const entryCount = Math.min(length, DIAGNOSTIC_ARRAY_LIMIT)
    for (let index = 0; index < entryCount; index += 1) {
      if (budget.remaining <= 0) break
      let entry
      try {
        entry = value[index]
      } catch {
        continue
      }
      const projectedEntry = projectArchiveLifecycleDiagnosticValue(
        entry,
        secrets,
        seen,
        budget,
        depth + 1,
      )
      if (projectedEntry !== OMITTED_DIAGNOSTIC_VALUE) projected.push(projectedEntry)
    }
    return projected
  }
  const projected = {}
  for (const key of ARCHIVE_LIFECYCLE_DIAGNOSTIC_KEYS) {
    if (budget.remaining <= 0) break
    let hasKey
    try {
      hasKey = Object.hasOwn(value, key)
    } catch {
      continue
    }
    if (!hasKey) continue
    let entry
    try {
      entry = value[key]
    } catch {
      continue
    }
    if (entry === undefined || typeof entry === 'function' || typeof entry === 'symbol') continue
    const projectedEntry = projectArchiveLifecycleDiagnosticValue(
      entry,
      secrets,
      seen,
      budget,
      depth + 1,
    )
    if (projectedEntry !== OMITTED_DIAGNOSTIC_VALUE) projected[key] = projectedEntry
  }
  return projected
}

/** Atomically publishes one success report and removes any opposite terminal receipt. */
export async function writeArchiveLifecycleSuccessReport(input, dependencies = {}) {
  return writeArchiveLifecycleTerminalArtifact({
    contents: `${JSON.stringify(input.evidence, null, 2)}\n`,
    evidenceDir: input.evidenceDir,
    fileName: 'electron-archive-lifecycle-smoke-report.json',
    oppositeFileName: 'electron-archive-lifecycle-smoke-failure.json',
  }, dependencies)
}

/** Atomically writes one bounded, sanitized receipt for a non-passing lifecycle run. */
export async function writeArchiveLifecycleFailureReceipt(input, dependencies = {}) {
  if (!Array.isArray(input.secrets)
    || input.secrets.some((secret) => typeof secret !== 'string' || secret.length < 1)) {
    throw new Error('Archive-lifecycle failure receipt secret set is invalid.')
  }
  const cleanupFailureDetails = readConsistentCleanupFailureDetails(input)
  const failedAtMs = Date.now()
  const diagnostics = readProjectedArchiveLifecycleDiagnostics(input.error, input.secrets)
  const cleanupFailures = cleanupFailureDetails.map(({ step, error }) => {
    const cleanupDiagnostics = readProjectedArchiveLifecycleDiagnostics(error, input.secrets)
    return {
      step,
      classification: cleanupDiagnostics === null
        ? 'cleanup_failure'
        : 'external_liveness_gate_failure',
      message: sanitizeFailureMessage(error, input.secrets),
      archiveLifecycleDiagnostics: cleanupDiagnostics,
    }
  })
  const receipt = {
    schemaVersion: 1,
    proofKind: 'packaged-electron-archive-lifecycle-failure-v1',
    source: {
      expectedHead: input.expectedHead,
      headBefore: input.sourceBefore.head,
      treeBefore: input.sourceBefore.tree,
      worktreeCleanBefore: input.sourceBefore.clean,
    },
    run: {
      startedAt: new Date(input.startedAtMs).toISOString(),
      failedAt: new Date(failedAtMs).toISOString(),
      durationMs: Math.max(0, failedAtMs - input.startedAtMs),
      platform: process.platform,
      architecture: os.arch(),
      nodeVersion: process.version,
      observedLaunchCount: input.observedLaunchCount,
    },
    failure: {
      classification: diagnostics === null
        ? 'lifecycle_failure'
        : 'external_liveness_gate_failure',
      message: sanitizeFailureMessage(input.error, input.secrets),
      archiveLifecycleDiagnostics: diagnostics,
    },
    cleanup: {
      cleanupFailureCount: input.cleanupFailureCount,
      failures: cleanupFailures,
      processCleanupCompleted: input.processCleanupCompleted === true,
      profileCleanupCompleted: input.profileCleanupCompleted === true,
    },
    verdict: { passed: false },
  }
  if (input.secrets.length > 0) {
    assertArchiveLifecycleSmokeEvidenceOmitsSecrets(receipt, input.secrets)
  }
  return writeArchiveLifecycleTerminalArtifact({
    contents: `${JSON.stringify(receipt, null, 2)}\n`,
    evidenceDir: input.evidenceDir,
    fileName: 'electron-archive-lifecycle-smoke-failure.json',
    oppositeFileName: 'electron-archive-lifecycle-smoke-report.json',
  }, dependencies)
}

/** Writes one mode-0600 terminal artifact through an owned temporary file. */
async function writeArchiveLifecycleTerminalArtifact(input, dependencies = {}) {
  const writeTemporaryFile = dependencies.writeFile ?? writeFile
  const renameTemporaryFile = dependencies.rename ?? rename
  const removeOwnedPath = dependencies.rm ?? rm
  const reportPath = path.join(input.evidenceDir, input.fileName)
  const oppositePath = path.join(input.evidenceDir, input.oppositeFileName)
  const temporaryPath = path.join(
    input.evidenceDir,
    `.${input.fileName}.${randomUUID()}.tmp`,
  )
  try {
    await writeTemporaryFile(temporaryPath, input.contents, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    })
    await renameTemporaryFile(temporaryPath, reportPath)
    await removeOwnedPath(oppositePath, { force: true })
  } finally {
    await removeOwnedPath(temporaryPath, { force: true }).catch(() => undefined)
  }
  return reportPath
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
    path.join(userDataDir, 'archive-lifecycle-input-fixtures'),
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
function sanitizeFailureMessage(error, secrets = [passphrase, recoveryCode]) {
  return sanitizeBoundedFailureMessage(readBoundedFailureMessage(error), secrets)
}

/** Reads one failure message without invoking hostile object coercion. */
function readBoundedFailureMessage(error) {
  let source
  if (typeof error === 'string') {
    source = error
  } else if (typeof error === 'number' || typeof error === 'boolean'
    || typeof error === 'bigint') {
    source = String(error)
  } else if ((typeof error === 'object' && error !== null)
    || typeof error === 'function') {
    try {
      source = Reflect.get(error, 'message')
    } catch {
      return UNSAFE_FAILURE_MESSAGE
    }
    if (typeof source !== 'string') return UNSAFE_FAILURE_MESSAGE
  } else {
    return UNSAFE_FAILURE_MESSAGE
  }
  if (source.length > FAILURE_MESSAGE_INPUT_LIMIT) return OVERSIZED_FAILURE_MESSAGE
  return source
}

/** Redacts one already-bounded primitive message. */
function sanitizeBoundedFailureMessage(source, secrets) {
  let sanitized = source
  for (const secret of secrets) {
    if (secret !== '') sanitized = sanitized.replaceAll(secret, '[REDACTED]')
  }
  return sanitized
    .replaceAll(/(?:[0-9A-HJKMNP-TV-Z]{5}-){7}[0-9A-HJKMNP-TV-Z]{5}/gu, '[REDACTED]')
    .replaceAll(/(['"`])(?:[A-Za-z]:[\\/]|[\\/]+)[^'"`\r\n]*\1/gu, '$1[PATH]$1')
    // An unquoted path containing spaces has no reliable closing delimiter, so
    // fail closed by redacting from its absolute-path boundary through the line.
    .replaceAll(/(^|[^A-Za-z0-9_\\/])(?:[A-Za-z]:[\\/]|[\\/]+)[^\r\n]*/gu, '$1[PATH]')
    .slice(0, FAILURE_MESSAGE_LIMIT)
}
