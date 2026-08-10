#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises'
import { createRequire } from 'node:module'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright'

import {
  analyzeBreadcrumbCheckpointProgress,
  analyzeBreadcrumbRequestCoverage,
  analyzeTransientHistoryRetries,
  buildBreadcrumb36HourProofVerdict,
  buildBreadcrumb36HourRenderedOracle,
  buildBreadcrumb36HourVariableSpeedEvidence,
  buildBreadcrumbRestartProofVerdict,
  cleanupOwnedProcess,
  createPersistedBreadcrumbEvidenceAccumulator,
  createRenderedBreadcrumbEvidence,
  parseBreadcrumb36HourProofArgs,
  processExited,
  summarizeBreadcrumbRequestLedger,
  verifyBreadcrumbRuntimeConfiguration,
} from '../build/electron-breadcrumb-36h-proof-lib.js'
import {
  buildBreadcrumb36HourTruthEvidence,
  createBreadcrumb36HourProfile,
  startBreadcrumb36HourMockTraccarServer,
} from '../build/breadcrumb-36h-mock-traccar.js'
import { hasBreadcrumbReconciliationWarning } from '../build/release-smoke-lib.js'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const proofEmail = 'breadcrumb-proof@example.invalid'
const proofSecret = 'synthetic-breadcrumb-proof-secret'

main().catch((error) => {
  console.error(
    `electron-breadcrumb-36h-proof: ${error instanceof Error ? error.message : String(error)}`,
  )
  process.exitCode = 1
})

/** Runs the packaged initial-history proof and emits a fail-closed report. */
async function main() {
  const options = parseBreadcrumb36HourProofArgs(process.argv.slice(2))
  const proofStartedAtMs = Date.now()
  const phaseTimestamps = {}
  const recordPhase = (phase) => {
    const unixMs = Date.now()
    phaseTimestamps[phase] = {
      iso: new Date(unixMs).toISOString(),
      unixMs,
      elapsedMs: unixMs - proofStartedAtMs,
    }
  }
  recordPhase('proofStarted')
  const evidenceDir = path.resolve(options.evidenceDir)
  await assertFreshEvidenceDirectory(evidenceDir)
  await access(options.appPath)
  const userDataRoot = await mkdtemp(path.join(os.tmpdir(), 'sartracker-breadcrumb-36h-'))
  const userDataDir = path.join(userDataRoot, 'profile')
  const databasePath = path.join(userDataDir, 'mission-store.sqlite')
  await mkdir(userDataDir, { recursive: true })

  const profile = createBreadcrumb36HourProfile({
    sourceNow: new Date().toISOString(),
  })
  const mockServer = await startBreadcrumb36HourMockTraccarServer({
    profile,
    latencyMs: options.latencyMs,
    faults: [{
      kind: 'history',
      deviceId: 1,
      // The first request is the live overlap fetch; occurrence two is the
      // first 2-hour reconciler window, whose exact retry is safety evidence.
      occurrence: 2,
      status: 503,
    }],
  })
  recordPhase('mockServerStarted')
  await seedRuntimeConfiguration(
    userDataDir,
    mockServer.baseUrl,
    options.normalPollIntervalMs,
  )

  let launch = null
  const packagedLaunchLogs = []
  const packagedLaunchAttempts = []
  let report = null
  let runError = null
  let mission = null
  let sourceTruth = null
  let renderedOracle = null
  let variableSpeedEvidence = null
  let midBackfillCheckpoint = null
  let forcedTermination = null
  let midBackfillPersisted = null
  let recoveredMission = null
  let failureRuntimeEvidence = null
  try {
    launch = await launchPackagedApp(options, userDataDir, {
      phase: 'mid-backfill',
      onAttempt: (attempt) => {
        packagedLaunchAttempts.push(attempt.diagnostics)
        packagedLaunchLogs.push({ phase: attempt.phase, logChunks: attempt.logChunks })
      },
    })
    recordPhase('initialPackagedLaunchReady')
    const initialRuntimeConfiguration = await verifyPackagedRuntimeConfiguration({
      page: launch.page,
      expectedBaseUrl: mockServer.baseUrl,
      expectedPollIntervalMs: options.normalPollIntervalMs,
    })
    await installTrackingSetDataCapture(launch.page)
    const missionStartedByProofAtMs = Date.now()
    await launch.page.getByTestId('mission-name-input').fill(
      'Deterministic 36-hour Breadcrumb Proof',
      { force: true },
    )
    await launch.page.getByTestId('mission-offset-input').fill('36', { force: true })
    await launch.page.getByTestId('mission-start-btn').click({ force: true })
    mission = await waitForActiveMission(launch.page, 10_000)
    recordPhase('missionCreated')
    assertBackdatedMission(mission.start_time, missionStartedByProofAtMs)
    sourceTruth = buildBreadcrumb36HourTruthEvidence(profile, {
      from: mission.start_time,
      to: profile.sourceNow,
    })
    renderedOracle = buildBreadcrumb36HourRenderedOracle(profile, {
      from: mission.start_time,
      to: profile.sourceNow,
    })
    variableSpeedEvidence = buildBreadcrumb36HourVariableSpeedEvidence(profile, {
      from: mission.start_time,
      to: profile.sourceNow,
    })
    midBackfillCheckpoint = await waitForMidBackfillCheckpoint({
      page: launch.page,
      mockServer,
      profile,
      missionId: mission.id,
      missionStartedAt: mission.start_time,
      observedFromMs: missionStartedByProofAtMs,
      expectedPositionCount: sourceTruth.totalPositionCount,
      timeoutMs: options.reconciliationTimeoutMs,
    })
    recordPhase('midBackfillCheckpointReached')
    forcedTermination = await forceKillLaunch(launch)
    recordPhase('midBackfillProcessKilled')
    launch = null
    await waitForMockIdle(mockServer, 10_000)
    midBackfillPersisted = inspectPersistedBreadcrumbs(databasePath, mission.id)
    recordPhase('midBackfillDatabaseInspected')

    launch = await launchPackagedApp(options, userDataDir, {
      phase: 'crash-recovery',
      onAttempt: (attempt) => {
        packagedLaunchAttempts.push(attempt.diagnostics)
        packagedLaunchLogs.push({ phase: attempt.phase, logChunks: attempt.logChunks })
      },
    })
    recordPhase('recoveryPackagedLaunchReady')
    const recoveryRuntimeConfiguration = await verifyPackagedRuntimeConfiguration({
      page: launch.page,
      expectedBaseUrl: mockServer.baseUrl,
      expectedPollIntervalMs: options.normalPollIntervalMs,
    })
    await installTrackingSetDataCapture(launch.page)
    const recoveryObservedFromMs = Date.now()
    recoveredMission = await resumeRecoveredMission(
      launch.page,
      mission.id,
      30_000,
    )
    recordPhase('recoveredMissionResumed')
    const milestones = await waitForTrackingMilestones({
      page: launch.page,
      mockServer,
      profile,
      missionStartedAt: mission.start_time,
      observedFromMs: recoveryObservedFromMs,
      reconciliationTimeoutMs: options.reconciliationTimeoutMs,
    })
    const persistenceCompleteMs = await waitForPersistence({
      page: launch.page,
      missionId: mission.id,
      expectedPositionCount: sourceTruth.totalPositionCount,
      observedFromMs: recoveryObservedFromMs,
      timeoutMs: options.persistenceTimeoutMs,
    })
    recordPhase('reconciliationPersistenceComplete')
    const firstRendered = createRenderedBreadcrumbEvidence(
      await readTrackingEvidenceCollection(launch.page),
    )
    await launch.page.waitForTimeout(250)
    const secondRendered = createRenderedBreadcrumbEvidence(
      await readTrackingEvidenceCollection(launch.page),
    )
    const completionCapture = await readTrackingSetDataCapture(launch.page)
    const rendered = {
      ...secondRendered,
      capturedSetDataUpdateCount: completionCapture.updateCount,
      stable:
        firstRendered.featureCount === secondRendered.featureCount &&
        firstRendered.coordinateCount === secondRendered.coordinateCount &&
        firstRendered.coordinateSha256 === secondRendered.coordinateSha256,
      firstObservation: firstRendered,
    }
    const renderedDots = await captureStableBreadcrumbDotEvidence({
      page: launch.page,
      expectedDots: renderedOracle.dotRendered,
      expectedLine: renderedOracle.rendered,
    })
    const reconciliationRequestSnapshot = milestones.requestSnapshot
    const requestEvidence = {
      deviceRequestCount: reconciliationRequestSnapshot.requestLedger.filter(
        (entry) => entry.kind === 'devices',
      ).length,
      historyRequestCount: reconciliationRequestSnapshot.requestLedger.filter(
        (entry) => entry.kind === 'history',
      ).length,
      maximumConcurrentRequests:
        reconciliationRequestSnapshot.maximumConcurrentRequests,
      maximumConcurrentHistoryRequests:
        reconciliationRequestSnapshot.maximumConcurrentHistoryRequests,
      requestLedger: reconciliationRequestSnapshot.requestLedger,
    }
    const timings = {
      currentFixMs: milestones.currentFixMs,
      firstBreadcrumbMs: milestones.firstBreadcrumbMs,
      fullReconciliationMs: milestones.fullReconciliationMs,
      persistenceCompleteMs,
    }

    await launch.page.screenshot({
      path: path.join(evidenceDir, 'packaged-36-hour-complete.png'),
      fullPage: true,
    })
    await closeLaunch(launch)
    recordPhase('completedRunClosed')
    launch = null
    await waitForMockIdle(mockServer, 10_000)

    const persisted = inspectPersistedBreadcrumbs(databasePath, mission.id)
    const baseVerdict = buildBreadcrumb36HourProofVerdict({
      normalPollIntervalMs: options.normalPollIntervalMs,
      timings,
      coverage: milestones.coverage,
      requestEvidence,
      sourceTruth,
      persisted,
      rendered,
      renderedDots,
      renderedOracle,
      variableSpeedEvidence,
    })

    const postCompletionRestarts = []
    const postRestartRuntimeConfigurations = []
    for (
      let restartIndex = 1;
      restartIndex <= options.postCompletionRestartCount;
      restartIndex += 1
    ) {
      const phasePrefix = `postCompletionRestart${restartIndex}`
      const postCompletionRequestStart = mockServer.snapshot().requestLedger.length
      launch = await launchPackagedApp(options, userDataDir, {
        phase: `post-completion-restart-${restartIndex}`,
        onAttempt: (attempt) => {
          packagedLaunchAttempts.push(attempt.diagnostics)
          packagedLaunchLogs.push({ phase: attempt.phase, logChunks: attempt.logChunks })
        },
      })
      recordPhase(`${phasePrefix}PackagedLaunchReady`)
      const postRestartRuntimeConfiguration = await verifyPackagedRuntimeConfiguration({
        page: launch.page,
        expectedBaseUrl: mockServer.baseUrl,
        expectedPollIntervalMs: options.normalPollIntervalMs,
      })
      postRestartRuntimeConfigurations.push(postRestartRuntimeConfiguration)
      recordPhase(`${phasePrefix}RuntimeConfigurationVerified`)
      await installTrackingSetDataCapture(launch.page)
      recordPhase(`${phasePrefix}SetDataCaptureInstalled`)
      const postRestartObservedFromMs = Date.now()
      const restartPhaseTimestamps = {}
      const recordRestartPhase = (phase) => {
        const unixMs = Date.now()
        restartPhaseTimestamps[phase] = {
          unixMs,
          elapsedMs: unixMs - postRestartObservedFromMs,
        }
        recordPhase(`${phasePrefix}${phase[0].toUpperCase()}${phase.slice(1)}`)
      }
      const postRestartMission = await resumeRecoveredMission(
        launch.page,
        mission.id,
        30_000,
        recordRestartPhase,
      )
      const postCompletionRendered = await waitForStableSerializedTrackingEvidence({
        page: launch.page,
        expected: renderedOracle.rendered,
        timeoutMs: 10_000,
        observedFromMs: postRestartObservedFromMs,
      })
      recordRestartPhase('stableRenderObserved')
      await launch.page.screenshot({
        path: path.join(
          evidenceDir,
          restartIndex === 1
            ? 'packaged-36-hour-post-completion-restart.png'
            : `packaged-36-hour-post-completion-restart-${restartIndex}.png`,
        ),
        fullPage: true,
      })
      await closeLaunch(launch)
      recordPhase(`${phasePrefix}RunClosed`)
      launch = null
      await waitForMockIdle(mockServer, 10_000)
      const postCompletionPersisted = inspectPersistedBreadcrumbs(databasePath, mission.id)
      const requestCountAfterRestart =
        mockServer.snapshot().requestLedger.length - postCompletionRequestStart
      postCompletionRestarts.push({
        attempt: restartIndex,
        missionId: postRestartMission.id,
        phaseTimestamps: restartPhaseTimestamps,
        rendered: postCompletionRendered,
        persisted: postCompletionPersisted,
        requestCountAfterRestart,
      })
    }
    const finalRequestSnapshot = mockServer.snapshot()
    const retryEvidence = analyzeTransientHistoryRetries(
      finalRequestSnapshot.requestLedger,
    )
    const restartAttemptVerdicts = postCompletionRestarts.map((restart) =>
      buildBreadcrumbRestartProofVerdict({
        sourcePositionCount: sourceTruth.totalPositionCount,
        midBackfill: {
          persistedRowCount: midBackfillPersisted.rowCount,
          databaseIntegrityResult: midBackfillPersisted.integrityResult,
          coverageComplete: midBackfillCheckpoint.coverage.complete,
          processTerminated: forcedTermination.processTerminated,
        },
        retryEvidence,
        completedPersisted: persisted,
        postCompletionPersisted: restart.persisted,
        completedRendered: rendered,
        postCompletionRendered: restart.rendered,
        restoredMissionMatches:
          recoveredMission.id === mission.id && restart.missionId === mission.id,
        postCompletionRenderMs: restart.rendered.observedMs,
      }),
    )
    const restartVerdict = {
      passed: restartAttemptVerdicts.every((attempt) => attempt.passed),
      failureReasons: restartAttemptVerdicts.flatMap((attempt, index) =>
        attempt.failureReasons.map((reason) => `Restart ${index + 1}: ${reason}`),
      ),
      attempts: restartAttemptVerdicts,
    }
    const verdict = {
      passed: baseVerdict.passed && restartVerdict.passed,
      failureReasons: [
        ...baseVerdict.failureReasons,
        ...restartVerdict.failureReasons,
      ],
    }
    report = {
      schemaVersion: 2,
      proof: 'packaged-electron-36-hour-initial-breadcrumb-history',
      recordedAt: new Date().toISOString(),
      app: {
        basename: path.basename(options.appPath),
        sha256: await sha256File(options.appPath),
      },
      profile: {
        sourceFrom: profile.sourceFrom,
        sourceNow: profile.sourceNow,
        lookbackHours: profile.lookbackHours,
        deviceCount: profile.deviceCount,
        onlineDeviceCount: profile.onlineDeviceCount,
      },
      mission: {
        id: mission.id,
        startTime: mission.start_time,
      },
      normalPollIntervalMs: options.normalPollIntervalMs,
      mockLatencyMs: options.latencyMs,
      phaseTimestamps,
      packagedLaunchAttempts,
      runtimeConfiguration: {
        initial: initialRuntimeConfiguration,
        crashRecovery: recoveryRuntimeConfiguration,
        postCompletionRestart: postRestartRuntimeConfigurations[0],
        postCompletionRestarts: postRestartRuntimeConfigurations,
      },
      resilience: {
        midBackfill: {
          checkpointElapsedMs: midBackfillCheckpoint.observedMs,
          ipcPersistedRowCount: midBackfillCheckpoint.persistedRowCount,
          completedHistoryRequestCount: midBackfillCheckpoint.completedHistoryRequestCount,
          failedHistoryRequestCount: midBackfillCheckpoint.failedHistoryRequestCount,
          coverage: midBackfillCheckpoint.coverage,
          forcedTermination,
          persistedAfterTermination: midBackfillPersisted,
        },
        retryEvidence,
        recoveredMissionId: recoveredMission.id,
        postCompletionRestart: postCompletionRestarts[0],
        postCompletionRestarts,
        verdict: restartVerdict,
      },
      timings,
      sourceTruth,
      renderedOracle,
      variableSpeedEvidence,
      coverage: milestones.coverage,
      requestEvidence,
      persisted,
      rendered,
      renderedDots,
      trackingStatusAtCompletion: milestones.trackingStatusText,
      baseVerdict,
      verdict,
    }
    await writeJson(path.join(evidenceDir, 'electron-breadcrumb-36h-proof.json'), report)
    console.log(
      `[breadcrumb-36h-proof] source=${sourceTruth.totalPositionCount} ` +
        `persisted=${persisted.rowCount} current=${timings.currentFixMs}ms ` +
        `first=${timings.firstBreadcrumbMs}ms complete=${timings.fullReconciliationMs}ms ` +
        `requests=${requestEvidence.historyRequestCount} historyConcurrency=${requestEvidence.maximumConcurrentHistoryRequests} ` +
        `globalConcurrency=${requestEvidence.maximumConcurrentRequests} ` +
        `passed=${verdict.passed}`,
    )
    if (!verdict.passed) {
      throw new Error(`36-hour breadcrumb proof failed: ${verdict.failureReasons.join(' ')}`)
    }
  } catch (error) {
    runError = error
    recordPhase('failureObserved')
    if (launch !== null && mission !== null) {
      failureRuntimeEvidence = await captureFailureRuntimeEvidence(
        launch.page,
        mission.id,
      ).catch((captureError) => ({
        captureErrorClass:
          captureError instanceof Error ? captureError.name : 'UnknownError',
        captureErrorMessage:
          captureError instanceof Error
            ? captureError.message.slice(0, 1_000)
            : String(captureError).slice(0, 1_000),
      }))
      await launch.page.screenshot({
        path: path.join(evidenceDir, 'packaged-36-hour-failure.png'),
        fullPage: true,
      }).catch(() => undefined)
      recordPhase('failureRuntimeCaptured')
    }
  } finally {
    if (launch !== null) {
      await closeLaunch(launch).catch(() => undefined)
      recordPhase('failureRunClosed')
    }
    await waitForMockIdle(mockServer, 10_000).catch(() => undefined)
    const finalMockSnapshot = mockServer.snapshot()
    recordPhase('mockRequestsSettled')
    await mockServer.close().catch(() => undefined)
    recordPhase('mockServerClosed')
    for (const packagedLog of packagedLaunchLogs) {
      const logText = sanitizeEvidenceText(
        Buffer.concat(packagedLog.logChunks).toString('utf8'),
        [userDataRoot, proofSecret],
      )
      if (logText !== '') {
        await writeFile(
          path.join(evidenceDir, `packaged-app-${packagedLog.phase}.log`),
          logText,
          'utf8',
        )
      }
    }
    if (runError !== null && report === null) {
      const persistedAtFailure =
        mission === null
          ? null
          : inspectPersistedBreadcrumbsSafely(databasePath, mission.id)
      const checkpointsAtFailure =
        mission === null
          ? null
          : inspectHistoryCheckpointsSafely(databasePath, mission.id)
      const requiredDeviceIds = profile.devices.map((device) => device.id)
      const onlineDeviceIds = profile.devices
        .filter((device) => device.status === 'online')
        .map((device) => device.id)
      const checkpointProgress =
        mission === null || !Array.isArray(checkpointsAtFailure?.checkpoints)
          ? null
          : analyzeBreadcrumbCheckpointProgress({
              checkpoints: checkpointsAtFailure.checkpoints,
              deviceIds: requiredDeviceIds,
              requiredFrom: mission.start_time,
              requiredTo: profile.sourceNow,
            })
      const requestCoverage =
        mission === null
          ? null
          : analyzeBreadcrumbRequestCoverage({
              requestLedger: finalMockSnapshot.requestLedger,
              deviceIds: onlineDeviceIds,
              requiredFrom: mission.start_time,
              requiredTo: profile.sourceNow,
            })
      recordPhase('failureEvidenceCompleted')
      await writeJson(path.join(evidenceDir, 'electron-breadcrumb-36h-proof-failure.json'), {
        schemaVersion: 2,
        proof: 'packaged-electron-36-hour-initial-breadcrumb-history',
        recordedAt: new Date().toISOString(),
        result: 'error',
        errorClass: runError instanceof Error ? runError.name : 'UnknownError',
        errorMessage:
          runError instanceof Error ? runError.message.slice(0, 1_000) : String(runError).slice(0, 1_000),
        acceptance: {
          reconciliationDeadlineMs: options.reconciliationTimeoutMs,
          normalPollIntervalMs: options.normalPollIntervalMs,
          mockLatencyMs: options.latencyMs,
          postCompletionRestartCount: options.postCompletionRestartCount,
        },
        phaseTimestamps,
        packagedLaunchAttempts,
        profile: {
          sourceFrom: profile.sourceFrom,
          sourceNow: profile.sourceNow,
          lookbackHours: profile.lookbackHours,
          deviceCount: profile.deviceCount,
          onlineDeviceCount: profile.onlineDeviceCount,
        },
        mission: mission === null
          ? null
          : { id: mission.id, startTime: mission.start_time },
        sourceTruth,
        renderedOracle,
        resilience: {
          midBackfillCheckpoint,
          forcedTermination,
          persistedAfterMidBackfillKill: midBackfillPersisted,
          recoveredMissionId: recoveredMission?.id ?? null,
        },
        partialStateAtFailure: {
          runtime: failureRuntimeEvidence,
          persisted: persistedAtFailure,
          checkpoints: checkpointsAtFailure,
          checkpointProgress,
          requestCoverage,
        },
        requestSummary: summarizeBreadcrumbRequestLedger(
          finalMockSnapshot.requestLedger,
        ),
        retryEvidence: analyzeTransientHistoryRetries(
          finalMockSnapshot.requestLedger,
        ),
        mock: finalMockSnapshot,
      })
    }
    await rm(userDataRoot, { recursive: true, force: true })
  }

  if (runError !== null) {
    throw runError
  }
}

async function captureStableBreadcrumbDotEvidence(input) {
  await input.page.getByTestId('open-devices-workspace').click({ force: true })
  await input.page.getByTestId('devices-workspace').waitFor({ state: 'visible' })
  await input.page.getByTestId('breadcrumb-mode-dots').click({ force: true })
  await input.page.keyboard.press('Escape')
  await input.page.getByTestId('devices-workspace').waitFor({ state: 'hidden' })
  const dots = await waitForStableSerializedTrackingEvidence({
    page: input.page,
    expected: input.expectedDots,
    observedFromMs: Date.now(),
    timeoutMs: 10_000,
  })

  await input.page.getByTestId('open-devices-workspace').click({ force: true })
  await input.page.getByTestId('devices-workspace').waitFor({ state: 'visible' })
  await input.page.getByTestId('breadcrumb-mode-line').click({ force: true })
  await input.page.keyboard.press('Escape')
  await input.page.getByTestId('devices-workspace').waitFor({ state: 'hidden' })
  await waitForStableSerializedTrackingEvidence({
    page: input.page,
    expected: input.expectedLine,
    observedFromMs: Date.now(),
    timeoutMs: 10_000,
  })
  return dots
}

async function seedRuntimeConfiguration(userDataDir, baseUrl, pollIntervalMs) {
  await writeJson(path.join(userDataDir, 'settings.json'), {
    missionDefaults: {
      autoRefreshEnabled: true,
      autoRefreshIntervalSeconds: pollIntervalMs / 1_000,
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
      email: proofEmail,
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
  })
  await writeJson(path.join(userDataDir, 'credentials.json'), {
    version: 1,
    traccar: { basic: { secret: proofSecret } },
  })
}

async function launchPackagedApp(options, userDataDir, instrumentation = {}) {
  const remoteDebuggingPort = await findFreePort()
  const logChunks = []
  const diagnostics = {
    phase: instrumentation.phase ?? 'packaged-launch',
    remoteDebuggingPort,
    spawnedAtUnixMs: Date.now(),
    cdpReadyAtUnixMs: null,
    browserConnectedAtUnixMs: null,
    pageAvailableAtUnixMs: null,
    appShellAttachedAtUnixMs: null,
    mapCanvasAttachedAtUnixMs: null,
    failedAtUnixMs: null,
    failureMessage: null,
    exitCode: null,
    signalCode: null,
    cleanupComplete: false,
  }
  const appProcess = spawn(
    options.appPath,
    [`--remote-debugging-port=${remoteDebuggingPort}`, ...options.extraArgs],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        SARTRACKER_ELECTRON_USER_DATA_PATH: userDataDir,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  appProcess.stdout.on('data', (chunk) => logChunks.push(chunk))
  appProcess.stderr.on('data', (chunk) => logChunks.push(chunk))
  instrumentation.onAttempt?.({
    phase: diagnostics.phase,
    appProcess,
    logChunks,
    diagnostics,
  })
  let browser = null
  try {
    await waitForCdp(remoteDebuggingPort, appProcess)
    diagnostics.cdpReadyAtUnixMs = Date.now()
    browser = await chromium.connectOverCDP(
      `http://127.0.0.1:${remoteDebuggingPort}`,
    )
    diagnostics.browserConnectedAtUnixMs = Date.now()
    const context = browser.contexts()[0]
    const page = context.pages()[0] ?? (await context.waitForEvent('page'))
    diagnostics.pageAvailableAtUnixMs = Date.now()
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.getByTestId('app-shell').waitFor({ state: 'attached', timeout: 60_000 })
    diagnostics.appShellAttachedAtUnixMs = Date.now()
    await page.locator('.maplibregl-canvas').waitFor({ state: 'attached', timeout: 60_000 })
    diagnostics.mapCanvasAttachedAtUnixMs = Date.now()
    return { appProcess, browser, page, logChunks, diagnostics, closed: false }
  } catch (error) {
    diagnostics.failedAtUnixMs = Date.now()
    diagnostics.failureMessage =
      error instanceof Error ? error.message.slice(0, 1_000) : String(error).slice(0, 1_000)
    await browser?.close().catch(() => undefined)
    Object.assign(
      diagnostics,
      await cleanupOwnedProcess(appProcess, { waitForExit }),
    )
    throw error
  }
}

async function verifyPackagedRuntimeConfiguration(input) {
  const runtime = await input.page.evaluate(async () => {
    if (window.sartrackerElectron?.loadRuntimeBootstrapSettings === undefined) {
      throw new Error('Packaged runtime-settings bridge is unavailable.')
    }
    return window.sartrackerElectron.loadRuntimeBootstrapSettings(false)
  })
  return verifyBreadcrumbRuntimeConfiguration({
    runtime,
    expectedBaseUrl: input.expectedBaseUrl,
    expectedPollIntervalMs: input.expectedPollIntervalMs,
    expectedEmail: proofEmail,
    expectedSecret: proofSecret,
  })
}

async function installTrackingSetDataCapture(page) {
  await page.waitForFunction(() => {
    const source = window.__SARTRACKER_MAP__?.getSource('tracking')
    return source !== undefined && typeof source.setData === 'function'
  }, undefined, { timeout: 60_000 })
  await page.evaluate(() => {
    const source = window.__SARTRACKER_MAP__?.getSource('tracking')
    if (source === undefined || typeof source.setData !== 'function') {
      throw new Error('Tracking source is unavailable for setData capture.')
    }
    const originalSetData = source.setData.bind(source)
    window.__SARTRACKER_TRACKING_SET_DATA_CAPTURE__ = {
      updateCount: 0,
      latest: null,
      installedAtUnixMs: Date.now(),
      firstUpdateAtUnixMs: null,
      latestUpdateAtUnixMs: null,
    }
    source.setData = (data) => {
      const capture = window.__SARTRACKER_TRACKING_SET_DATA_CAPTURE__
      if (capture !== undefined) {
        const updatedAtUnixMs = Date.now()
        capture.updateCount += 1
        capture.latest = data
        capture.firstUpdateAtUnixMs ??= updatedAtUnixMs
        capture.latestUpdateAtUnixMs = updatedAtUnixMs
      }
      return originalSetData(data)
    }
  })
}

async function waitForActiveMission(page, timeoutMs) {
  await page.waitForFunction(
    async () => (await window.sartrackerElectron?.missionStore.getActiveMission()) !== null,
    undefined,
    { timeout: timeoutMs },
  )
  return page.evaluate(async () => {
    const mission = await window.sartrackerElectron?.missionStore.getActiveMission()
    if (mission === null || mission === undefined) {
      throw new Error('Packaged 36-hour proof has no active mission.')
    }
    return mission
  })
}

async function resumeRecoveredMission(
  page,
  expectedMissionId,
  timeoutMs,
  recordMilestone = () => undefined,
) {
  const recoveryDialog = page.getByTestId('mission-recovery-dialog')
  await recoveryDialog.waitFor({ state: 'attached', timeout: timeoutMs })
  recordMilestone('recoveryDialogAttached')
  await recoveryDialog.getByRole('button', { name: 'Resume' }).click({ force: true })
  recordMilestone('resumeClicked')
  await recoveryDialog.waitFor({ state: 'detached', timeout: timeoutMs })
  recordMilestone('recoveryDialogDetached')
  const mission = await waitForActiveMission(page, timeoutMs)
  recordMilestone('activeMissionObserved')
  if (mission.id !== expectedMissionId) {
    throw new Error(
      `Restart recovered mission ${mission.id}, expected ${expectedMissionId}.`,
    )
  }
  return mission
}

function assertBackdatedMission(startTime, missionCreatedAtMs) {
  const offsetMs = missionCreatedAtMs - Date.parse(startTime)
  const targetMs = 36 * 60 * 60 * 1000
  if (Math.abs(offsetMs - targetMs) > 60_000) {
    throw new Error(`Mission start offset was ${offsetMs} ms, expected 36 hours.`)
  }
}

async function waitForTrackingMilestones(input) {
  const deadline = input.observedFromMs + input.reconciliationTimeoutMs
  const onlineDeviceIds = input.profile.devices
    .filter((device) => device.status === 'online')
    .map((device) => device.id)
  let currentFixMs = null
  let firstBreadcrumbMs = null
  while (Date.now() < deadline) {
    assertProcessAlive(input.page)
    const observedAtMs = Date.now()
    const [renderCapture, trackingStatusText] = await Promise.all([
      readTrackingSetDataCapture(input.page),
      input.page.getByTestId('tracking-status').textContent().then((value) => value ?? ''),
    ])
    const sourceData = renderCapture.latest ?? { type: 'FeatureCollection', features: [] }
    const rendered = createRenderedBreadcrumbEvidence(sourceData)
    const currentPositionCount = (sourceData.features ?? []).filter(
      (feature) => feature.properties?.featureKind === 'device',
    ).length
    if (currentFixMs === null && currentPositionCount > 0) {
      currentFixMs = observedAtMs - input.observedFromMs
    }
    if (firstBreadcrumbMs === null && rendered.coordinateCount > 0) {
      firstBreadcrumbMs = observedAtMs - input.observedFromMs
    }

    const requestSnapshot = input.mockServer.snapshot()
    const coverage = analyzeBreadcrumbRequestCoverage({
      requestLedger: requestSnapshot.requestLedger,
      deviceIds: onlineDeviceIds,
      requiredFrom: input.missionStartedAt,
      requiredTo: input.profile.sourceNow,
    })
    if (
      currentFixMs !== null &&
      firstBreadcrumbMs !== null &&
      coverage.complete &&
      !hasBreadcrumbReconciliationWarning(trackingStatusText)
    ) {
      return {
        currentFixMs,
        firstBreadcrumbMs,
        fullReconciliationMs: observedAtMs - input.observedFromMs,
        coverage,
        requestSnapshot,
        trackingStatusText: trackingStatusText.slice(0, 1_000),
      }
    }
    await input.page.waitForTimeout(50)
  }
  throw new Error(
    'Timed out waiting for complete 36-hour history within the packaged acceptance deadline.',
  )
}

async function waitForMidBackfillCheckpoint(input) {
  const deadline = input.observedFromMs + input.timeoutMs
  const onlineDeviceIds = input.profile.devices
    .filter((device) => device.status === 'online')
    .map((device) => device.id)
  while (Date.now() < deadline) {
    assertProcessAlive(input.page)
    const requestSnapshot = input.mockServer.snapshot()
    const coverage = analyzeBreadcrumbRequestCoverage({
      requestLedger: requestSnapshot.requestLedger,
      deviceIds: onlineDeviceIds,
      requiredFrom: input.missionStartedAt,
      requiredTo: input.profile.sourceNow,
    })
    const historyRequests = requestSnapshot.requestLedger.filter(
      (entry) => entry.kind === 'history',
    )
    const failedHistoryRequestCount = historyRequests.filter(
      (entry) => entry.outcome === 'failure',
    ).length
    const completedHistoryRequestCount = historyRequests.filter(
      (entry) => entry.outcome === 'success' && entry.httpStatus === 200,
    ).length
    const persistedRowCount = await input.page.evaluate(
      async ({ missionId }) =>
        window.sartrackerElectron?.missionStore.countPositions(missionId) ?? 0,
      { missionId: input.missionId },
    )
    if (coverage.complete) {
      throw new Error(
        '36-hour reconciliation completed before the deterministic crash checkpoint.',
      )
    }
    if (
      failedHistoryRequestCount === 1 &&
      completedHistoryRequestCount >= 8 &&
      persistedRowCount > 0 &&
      persistedRowCount < input.expectedPositionCount
    ) {
      return {
        observedMs: Date.now() - input.observedFromMs,
        persistedRowCount,
        completedHistoryRequestCount,
        failedHistoryRequestCount,
        coverage,
      }
    }
    await input.page.waitForTimeout(25)
  }
  throw new Error(
    'Timed out waiting for one history fault and a non-empty incomplete persisted backfill.',
  )
}

async function waitForPersistence(input) {
  const deadline = input.observedFromMs + input.timeoutMs
  while (Date.now() < deadline) {
    const count = await input.page.evaluate(
      async ({ missionId }) =>
        window.sartrackerElectron?.missionStore.countPositions(missionId) ?? 0,
      { missionId: input.missionId },
    )
    if (count === input.expectedPositionCount) {
      return Date.now() - input.observedFromMs
    }
    if (count > input.expectedPositionCount) {
      throw new Error(
        `Persisted ${count} positions, exceeding source truth ${input.expectedPositionCount}.`,
      )
    }
    await input.page.waitForTimeout(100)
  }
  throw new Error(
    `Timed out waiting for ${input.expectedPositionCount} exact persisted positions.`,
  )
}

async function readTrackingSetDataCapture(page) {
  return page.evaluate(() => {
    const capture = window.__SARTRACKER_TRACKING_SET_DATA_CAPTURE__
    if (capture === undefined) {
      throw new Error('Tracking source setData capture is not installed.')
    }
    return capture
  })
}

async function readTrackingEvidenceCollection(page) {
  const capture = await readTrackingSetDataCapture(page)
  if (capture.latest !== null) {
    return capture.latest
  }
  const serialized = await readSerializedTrackingSourceCollection(page)
  if (serialized === null) {
    throw new Error('Tracking source exposed neither captured nor serialized GeoJSON evidence.')
  }
  return serialized
}

async function readSerializedTrackingSourceCollection(page) {
  return page.evaluate(() => {
    const source = window.__SARTRACKER_MAP__?.getSource('tracking')
    if (source === undefined || typeof source.serialize !== 'function') {
      return null
    }
    const data = source.serialize()?.data
    if (
      data === null ||
      typeof data !== 'object' ||
      data.type !== 'FeatureCollection' ||
      !Array.isArray(data.features)
    ) {
      return null
    }
    return data
  })
}

async function waitForStableSerializedTrackingEvidence(input) {
  const deadline = input.observedFromMs + input.timeoutMs
  let firstNonEmptyMs = null
  let firstExactMs = null
  let readCount = 0
  let maximumReadDurationMs = 0
  while (Date.now() < deadline) {
    assertProcessAlive(input.page)
    const firstReadStartedAtMs = Date.now()
    const firstCapture = await readTrackingSetDataCapture(input.page).catch(() => null)
    const firstCollection = firstCapture?.latest ??
      await readSerializedTrackingSourceCollection(input.page)
    readCount += 1
    maximumReadDurationMs = Math.max(
      maximumReadDurationMs,
      Date.now() - firstReadStartedAtMs,
    )
    if (firstCollection !== null) {
      const first = createRenderedBreadcrumbEvidence(firstCollection)
      if (first.coordinateCount > 0 && firstNonEmptyMs === null) {
        firstNonEmptyMs = Date.now() - input.observedFromMs
      }
      if (renderedEvidenceMatches(first, input.expected)) {
        firstExactMs ??= Date.now() - input.observedFromMs
        await input.page.waitForTimeout(250)
        const secondReadStartedAtMs = Date.now()
        const secondCapture = await readTrackingSetDataCapture(input.page).catch(() => null)
        const secondCollection = secondCapture?.latest ??
          await readSerializedTrackingSourceCollection(input.page)
        readCount += 1
        maximumReadDurationMs = Math.max(
          maximumReadDurationMs,
          Date.now() - secondReadStartedAtMs,
        )
        if (secondCollection !== null) {
          const second = createRenderedBreadcrumbEvidence(secondCollection)
          if (renderedEvidenceMatches(second, first)) {
            const observedMs = Date.now() - input.observedFromMs
            return {
              ...second,
              stable: true,
              observedMs,
              firstNonEmptyMs,
              firstExactMs,
              stableConfirmedMs: observedMs,
              stabilityWaitMs: observedMs - firstExactMs,
              readCount,
              maximumReadDurationMs,
              evidencePath: firstCapture?.latest === null || firstCapture === null
                ? 'GeoJSONSource.serialize().data'
                : 'GeoJSONSource.setData capture',
              setDataCapture: secondCapture === null
                ? null
                : {
                    updateCount: secondCapture.updateCount,
                    installedAtUnixMs: secondCapture.installedAtUnixMs,
                    firstUpdateAtUnixMs: secondCapture.firstUpdateAtUnixMs,
                    latestUpdateAtUnixMs: secondCapture.latestUpdateAtUnixMs,
                    firstUpdateMs: secondCapture.firstUpdateAtUnixMs === null
                      ? null
                      : secondCapture.firstUpdateAtUnixMs - input.observedFromMs,
                    latestUpdateMs: secondCapture.latestUpdateAtUnixMs === null
                      ? null
                      : secondCapture.latestUpdateAtUnixMs - input.observedFromMs,
                  },
              firstObservation: first,
            }
          }
        }
      }
    }
    await input.page.waitForTimeout(100)
  }
  throw new Error(
    'Timed out waiting for exact stable rendered breadcrumb evidence after completed restart.',
  )
}

function renderedEvidenceMatches(left, right) {
  return (
    left.featureCount === right.featureCount &&
    left.coordinateCount === right.coordinateCount &&
    left.deviceCount === right.deviceCount &&
    left.coordinateSha256 === right.coordinateSha256
  )
}

function inspectPersistedBreadcrumbs(databasePath, missionId) {
  const database = new Database(databasePath)
  try {
    const accumulator = createPersistedBreadcrumbEvidenceAccumulator()
    for (const row of database
      .prepare(
        `SELECT source_position_id, device_id, timestamp, lat, lon
         FROM positions
         WHERE mission_id = ?
         ORDER BY CAST(device_id AS INTEGER) ASC, timestamp ASC,
                  CAST(source_position_id AS INTEGER) ASC, source_position_id ASC`,
      )
      .iterate(missionId)) {
      accumulator.add(row)
    }
    return {
      ...accumulator.finish(),
      integrityResult: database.pragma('integrity_check', { simple: true }),
    }
  } finally {
    database.close()
  }
}

function inspectPersistedBreadcrumbsSafely(databasePath, missionId) {
  try {
    return inspectPersistedBreadcrumbs(databasePath, missionId)
  } catch (error) {
    return {
      inspectionErrorClass: error instanceof Error ? error.name : 'UnknownError',
      inspectionErrorMessage:
        error instanceof Error
          ? error.message.slice(0, 1_000)
          : String(error).slice(0, 1_000),
    }
  }
}

function inspectHistoryCheckpointsSafely(databasePath, missionId) {
  let database = null
  try {
    database = new Database(databasePath, { readonly: true, fileMustExist: true })
    return {
      integrityResult: database.pragma('integrity_check', { simple: true }),
      checkpoints: database.prepare(
        `SELECT mission_id, device_id, history_from, reconciled_until, updated_at
         FROM tracking_history_checkpoints
         WHERE mission_id = ?
         ORDER BY CAST(device_id AS INTEGER) ASC, device_id ASC`,
      ).all(missionId),
    }
  } catch (error) {
    return {
      inspectionErrorClass: error instanceof Error ? error.name : 'UnknownError',
      inspectionErrorMessage:
        error instanceof Error
          ? error.message.slice(0, 1_000)
          : String(error).slice(0, 1_000),
    }
  } finally {
    database?.close()
  }
}

async function captureFailureRuntimeEvidence(page, missionId) {
  const [trackingStatusText, persistedRowCount, checkpoints, renderCapture] =
    await Promise.all([
      page.getByTestId('tracking-status').textContent().then((value) => value ?? ''),
      page.evaluate(
        async ({ expectedMissionId }) =>
          window.sartrackerElectron?.missionStore.countPositions(expectedMissionId) ?? 0,
        { expectedMissionId: missionId },
      ),
      page.evaluate(
        async ({ expectedMissionId }) =>
          window.sartrackerElectron?.missionStore.listTrackingHistoryCheckpoints?.(
            expectedMissionId,
          ) ?? [],
        { expectedMissionId: missionId },
      ),
      readTrackingSetDataCapture(page),
    ])
  return {
    capturedAt: new Date().toISOString(),
    trackingStatusText: trackingStatusText.slice(0, 1_000),
    persistedRowCount,
    checkpoints,
    rendered: createRenderedBreadcrumbEvidence(
      renderCapture.latest ?? { type: 'FeatureCollection', features: [] },
    ),
    capturedSetDataUpdateCount: renderCapture.updateCount,
  }
}

async function closeLaunch(launch) {
  if (launch.closed) {
    return
  }
  launch.closed = true
  await launch.browser.close().catch(() => undefined)
  Object.assign(
    launch.diagnostics,
    await cleanupOwnedProcess(launch.appProcess, {
      waitForExit,
      gracefulTimeoutMs: 10_000,
    }),
  )
}

async function forceKillLaunch(launch) {
  if (launch.closed) {
    throw new Error('Cannot force-kill an already closed packaged launch.')
  }
  launch.closed = true
  launch.appProcess.kill('SIGKILL')
  await waitForExit(launch.appProcess, 10_000)
  const processTerminated = processExited(launch.appProcess)
  Object.assign(launch.diagnostics, {
    exitCode: launch.appProcess.exitCode,
    signalCode: launch.appProcess.signalCode,
    cleanupComplete: processTerminated,
  })
  await launch.browser.close().catch(() => undefined)
  if (!processTerminated) {
    throw new Error('Packaged Electron did not terminate after the mid-backfill SIGKILL.')
  }
  return {
    processTerminated,
    requestedSignal: 'SIGKILL',
    exitCode: launch.appProcess.exitCode,
    signalCode: launch.appProcess.signalCode,
  }
}

async function waitForMockIdle(mockServer, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (mockServer.snapshot().activeRequests === 0) {
      return
    }
    await delay(25)
  }
  throw new Error('Mock Traccar still had active requests after packaged process shutdown.')
}

function assertProcessAlive(page) {
  if (page.isClosed()) {
    throw new Error('Packaged renderer closed during the 36-hour proof.')
  }
}

async function findFreePort() {
  const server = net.createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  await new Promise((resolve) => server.close(resolve))
  if (address === null || typeof address === 'string') {
    throw new Error('Could not allocate a packaged proof CDP port.')
  }
  return address.port
}

async function waitForCdp(port, appProcess) {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    if (processExited(appProcess)) {
      throw new Error(
        `Packaged Electron exited before CDP: exit=${String(appProcess.exitCode)} ` +
          `signal=${String(appProcess.signalCode)}.`,
      )
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`)
      if (response.ok) {
        return
      }
    } catch {
      await delay(250)
    }
  }
  throw new Error(`Timed out waiting for packaged Electron CDP on ${port}.`)
}

async function waitForExit(child, timeoutMs) {
  if (processExited(child)) {
    return
  }
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    delay(timeoutMs),
  ])
}

async function assertFreshEvidenceDirectory(directory) {
  await mkdir(directory, { recursive: true })
  const entries = await readdir(directory)
  if (entries.length > 0) {
    throw new Error(`Evidence directory must be empty: ${directory}`)
  }
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

async function sha256File(filePath) {
  const digest = createHash('sha256')
  await new Promise((resolve, reject) => {
    const input = createReadStream(filePath)
    input.on('data', (chunk) => digest.update(chunk))
    input.once('error', reject)
    input.once('end', resolve)
  })
  return digest.digest('hex')
}

function sanitizeEvidenceText(contents, forbiddenValues) {
  let sanitized = String(contents)
  for (const value of forbiddenValues) {
    if (typeof value === 'string' && value !== '') {
      sanitized = sanitized.replaceAll(value, '[REDACTED]')
    }
  }
  return sanitized
}

function delay(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs))
}
