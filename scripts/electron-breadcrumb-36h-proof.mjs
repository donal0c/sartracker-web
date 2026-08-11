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
  buildBreadcrumb36HourExactDotPageOracle,
  buildBreadcrumb36HourProofVerdict,
  buildBreadcrumb36HourRenderedOracle,
  buildBreadcrumb36HourVariableSpeedEvidence,
  buildBreadcrumbRestartProofVerdict,
  cleanupOwnedProcess,
  createPersistedBreadcrumbEvidenceAccumulator,
  createRenderedBreadcrumbEvidence,
  measureExactBreadcrumbDotRenderedDeviation,
  normalizeRenderedExactBreadcrumbDotFeaturesForAudit,
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
  let exactDotOracle = null
  let variableSpeedEvidence = null
  let midBackfillCheckpoint = null
  let forcedTermination = null
  let midBackfillPersisted = null
  let recoveredMission = null
  let recoveryExactDotActivation = null
  let finalHistoryCheckpoints = null
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
    await launch.page.getByTestId('open-devices-workspace').click({ force: true })
    await launch.page.getByTestId('devices-workspace').waitFor({ state: 'visible' })
    await launch.page.getByTestId('breadcrumb-mode-dots').click({ force: true })
    await launch.page.keyboard.press('Escape')
    await launch.page.getByTestId('devices-workspace').waitFor({ state: 'hidden' })
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
    exactDotOracle = buildBreadcrumb36HourExactDotPageOracle(profile, {
      from: mission.start_time,
      to: profile.sourceNow,
    }, { pageLimit: 10_000 })
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
    recoveryExactDotActivation = await activateExactBreadcrumbDotProofMode({
      page: launch.page,
      observedFromMs: recoveryObservedFromMs,
      timeoutMs: options.reconciliationTimeoutMs,
    })
    recordPhase('recoveryExactDotsReady')
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
    const completionEvidence = await captureStableBreadcrumbDotEvidence({
      page: launch.page,
      exactDotOracle,
      expectedLine: renderedOracle.rendered,
      dotsScreenshotPath: path.join(
        evidenceDir,
        'packaged-36-hour-exact-dots-complete.png',
      ),
    })
    const renderedDots = completionEvidence.dots
    const rendered = completionEvidence.line
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
    finalHistoryCheckpoints = inspectHistoryCheckpointEvidenceSafely({
      databasePath,
      missionId: mission.id,
      deviceIds: profile.devices.map((device) => device.id),
      requiredFrom: mission.start_time,
      requiredTo: profile.sourceNow,
    })
    const baseVerdict = buildBreadcrumb36HourProofVerdict({
      normalPollIntervalMs: options.normalPollIntervalMs,
      timings,
      coverage: milestones.coverage,
      historyCheckpoints: finalHistoryCheckpoints,
      requestEvidence,
      sourceTruth,
      persisted,
      rendered,
      renderedDots,
      renderedOracle,
      exactDotOracle,
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
      const postRestartExactDotActivation =
        await activateExactBreadcrumbDotProofMode({
          page: launch.page,
          observedFromMs: postRestartObservedFromMs,
          timeoutMs: 10_000,
        })
      const postCompletionExactDots =
        await captureLatestExactBreadcrumbDotEvidence({
          page: launch.page,
          expected: exactDotOracle.pages[0].rendered,
          totalPositionCount: exactDotOracle.totalPositionCount,
          modeActivation: postRestartExactDotActivation,
          observedFromMs: postRestartObservedFromMs,
          timeoutMs: 10_000,
        })
      recordRestartPhase('exactDotsObserved')
      await activateBreadcrumbLineProofMode(launch.page)
      const postCompletionRenderedEvidence = await waitForStableSerializedTrackingEvidence({
        page: launch.page,
        expected: renderedOracle.rendered,
        timeoutMs: 10_000,
        observedFromMs: postRestartObservedFromMs,
      })
      const postCompletionRendered = {
        ...postCompletionRenderedEvidence,
        reportedTotalObserved:
          await readReportedLineBreadcrumbTotalObserved(launch.page),
      }
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
        exactDots: postCompletionExactDots,
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
        exactDotOracle,
        postCompletionExactDots: restart.exactDots,
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
        recoveryExactDotActivation,
        postCompletionRestart: postCompletionRestarts[0],
        postCompletionRestarts,
        verdict: restartVerdict,
      },
      timings,
      sourceTruth,
      renderedOracle,
      exactDotOracle,
      variableSpeedEvidence,
      coverage: milestones.coverage,
      historyCheckpoints: finalHistoryCheckpoints,
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
      const historyCheckpointsAtFailure =
        mission === null
          ? null
          : inspectHistoryCheckpointEvidenceSafely({
              databasePath,
              missionId: mission.id,
              deviceIds: profile.devices.map((device) => device.id),
              requiredFrom: mission.start_time,
              requiredTo: profile.sourceNow,
            })
      const onlineDeviceIds = profile.devices
        .filter((device) => device.status === 'online')
        .map((device) => device.id)
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
        exactDotOracle,
        resilience: {
          midBackfillCheckpoint,
          forcedTermination,
          persistedAfterMidBackfillKill: midBackfillPersisted,
          recoveredMissionId: recoveredMission?.id ?? null,
          recoveryExactDotActivation,
        },
        partialStateAtFailure: {
          runtime: failureRuntimeEvidence,
          persisted: persistedAtFailure,
          checkpoints: historyCheckpointsAtFailure,
          checkpointProgress: historyCheckpointsAtFailure?.progress ?? null,
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

async function activateExactBreadcrumbDotProofMode(input) {
  await input.page.getByTestId('open-devices-workspace').click({ force: true })
  await input.page.getByTestId('devices-workspace').waitFor({ state: 'visible' })
  const dotsMode = input.page.getByTestId('breadcrumb-mode-dots')
  await dotsMode.click({ force: true })
  const sizeLabel = input.page.getByTestId('breadcrumb-size-label')
  const [sizeLabelText, dotsModeClass] = await Promise.all([
    sizeLabel.textContent(),
    dotsMode.getAttribute('class'),
  ])
  if (
    !String(sizeLabelText ?? '').includes('dot diameter') ||
    !String(dotsModeClass ?? '').includes('sar-segment-option-active')
  ) {
    throw new Error('Packaged recovery did not activate exact breadcrumb Dots mode.')
  }
  await input.page.keyboard.press('Escape')
  await input.page.getByTestId('devices-workspace').waitFor({ state: 'hidden' })

  const deadline = input.observedFromMs + input.timeoutMs
  while (Date.now() < deadline) {
    assertProcessAlive(input.page)
    if (await input.page.getByTestId('exact-breadcrumb-dots-unavailable').isVisible()) {
      const message = await input.page
        .getByTestId('exact-breadcrumb-dots-unavailable')
        .textContent()
      throw new Error(
        `Exact breadcrumb Dots mode was unavailable after recovery: ${String(message ?? '').trim()}`,
      )
    }
    const summaryElement = input.page.getByTestId('exact-breadcrumb-dot-page-summary')
    if (await summaryElement.isVisible()) {
      const operatorPage = parseExactBreadcrumbDotPageSummary(
        await summaryElement.textContent(),
      )
      const collection = await readExactBreadcrumbDotSourceCollection(input.page)
      const sourceFeatureCount = (collection.features ?? []).filter(
        (feature) =>
          feature?.properties?.featureKind === 'breadcrumb' &&
          feature?.geometry?.type === 'Point',
      ).length
      if (
        operatorPage.pagePositionCount > 0 &&
        sourceFeatureCount === operatorPage.pagePositionCount
      ) {
        return {
          observedMs: Date.now() - input.observedFromMs,
          selectedMode: 'dots',
          sizeLabel: String(sizeLabelText).trim(),
          sourceFeatureCount,
          operatorPage,
        }
      }
    }
    await input.page.waitForTimeout(50)
  }
  throw new Error(
    'Timed out waiting for exact breadcrumb Dots mode to expose its operator summary and MapLibre source after recovery.',
  )
}

async function captureStableBreadcrumbDotEvidence(input) {
  await input.page.getByTestId('open-devices-workspace').click({ force: true })
  await input.page.getByTestId('devices-workspace').waitFor({ state: 'visible' })
  await input.page.getByTestId('breadcrumb-mode-dots').click({ force: true })
  await input.page.keyboard.press('Escape')
  await input.page.getByTestId('devices-workspace').waitFor({ state: 'hidden' })
  const capturedPages = []
  const seenFeatureIds = new Set()
  let duplicateFeatureIdCount = 0
  let invalidFeatureCount = 0
  let maximumPageObservedMs = 0
  const observedPageSummaries = []
  for (let pageIndex = 0; pageIndex < input.exactDotOracle.pages.length; pageIndex += 1) {
    const observed = await waitForStableExactBreadcrumbDotPage({
      page: input.page,
      expected: input.exactDotOracle.pages[pageIndex].rendered,
      observedFromMs: Date.now(),
      timeoutMs: 10_000,
    })
    maximumPageObservedMs = Math.max(maximumPageObservedMs, observed.observedMs)
    invalidFeatureCount += observed.invalidFeatureCount
    const pageSummaryText = await input.page
      .getByTestId('exact-breadcrumb-dot-page-summary')
      .textContent()
    const pageSummary = parseExactBreadcrumbDotPageSummary(pageSummaryText)
    if (
      pageSummary.pagePositionCount !== observed.featureCount ||
      pageSummary.totalPositionCount !== input.exactDotOracle.totalPositionCount ||
      pageSummary.fromTimestamp !== observed.fromTimestamp ||
      pageSummary.toTimestamp !== observed.toTimestamp
    ) {
      throw new Error(
        `Operator exact-dot page summary disagreed with page ${pageIndex + 1} source evidence.`,
      )
    }
    observedPageSummaries.push(pageSummary)
    for (const featureId of observed.featureIds) {
      if (seenFeatureIds.has(featureId)) {
        duplicateFeatureIdCount += 1
      }
      seenFeatureIds.add(featureId)
    }
    capturedPages.push({ ...observed, operatorPage: pageSummary })
    if (pageIndex + 1 < input.exactDotOracle.pages.length) {
      await input.page.getByTestId('exact-breadcrumb-dots-earlier').click({ force: true })
    }
  }

  const unionDigest = createHash('sha256')
  for (const page of [...capturedPages].reverse()) {
    for (const line of page.canonicalLines) {
      unionDigest.update(line)
    }
  }

  const returnNavigation = []
  for (let pageIndex = capturedPages.length - 2; pageIndex >= 0; pageIndex -= 1) {
    await input.page.getByTestId('exact-breadcrumb-dots-later').click({ force: true })
    const observed = await waitForStableExactBreadcrumbDotPage({
      page: input.page,
      expected: input.exactDotOracle.pages[pageIndex].rendered,
      observedFromMs: Date.now(),
      timeoutMs: 10_000,
    })
    maximumPageObservedMs = Math.max(maximumPageObservedMs, observed.observedMs)
    returnNavigation.push({ pageIndex, observedMs: observed.observedMs })
  }

  const later = input.page.getByTestId('exact-breadcrumb-dots-later')
  const returnedToLatest = await later.isDisabled()
  await input.page.screenshot({
    path: input.dotsScreenshotPath,
    fullPage: true,
  })
  const pageEvidence = capturedPages.map(({ canonicalLines, featureIds, ...page }) => page)
  const dots = {
    stable: pageEvidence.every((page) => page.stable),
    pageLimit: input.exactDotOracle.pageLimit,
    totalPositionCount: observedPageSummaries[0]?.totalPositionCount ?? 0,
    pageCount: pageEvidence.length,
    maximumPagePositionCount: Math.max(0, ...pageEvidence.map((page) => page.featureCount)),
    maximumPageObservedMs,
    duplicateFeatureIdCount,
    uniqueFeatureIdCount: seenFeatureIds.size,
    invalidFeatureCount,
    returnedToLatest,
    pageUnion: {
      renderedPositionCount: pageEvidence.reduce(
        (total, page) => total + page.featureCount,
        0,
      ),
      renderedSourceTruthSha256: unionDigest.digest('hex'),
    },
    pages: pageEvidence,
    returnNavigation,
    supportingScreenshot: path.basename(input.dotsScreenshotPath),
    evidencePath: "GeoJSONSource.getData()/serialize().data for tracking-breadcrumb-dots-exact",
  }

  await input.page.getByTestId('open-devices-workspace').click({ force: true })
  await input.page.getByTestId('devices-workspace').waitFor({ state: 'visible' })
  await input.page.getByTestId('breadcrumb-mode-line').click({ force: true })
  await input.page.keyboard.press('Escape')
  await input.page.getByTestId('devices-workspace').waitFor({ state: 'hidden' })
  const firstRendered = await waitForStableSerializedTrackingEvidence({
    page: input.page,
    expected: input.expectedLine,
    observedFromMs: Date.now(),
    timeoutMs: 10_000,
  })
  const reportedTotalObserved =
    await readReportedLineBreadcrumbTotalObserved(input.page)
  return {
    dots,
    line: {
      ...firstRendered,
      reportedTotalObserved,
      capturedSetDataUpdateCount:
        firstRendered.setDataCapture?.updateCount ?? null,
    },
  }
}

async function readReportedLineBreadcrumbTotalObserved(page) {
  const statusText = String(
    await page.getByTestId('tracking-status').textContent() ?? '',
  )
  const match = /([\d,]+) known fixes across/u.exec(statusText)
  if (match === null) {
    throw new Error('Line mode did not expose its reported known-fix total.')
  }
  const totalObserved = Number(match[1].replaceAll(',', ''))
  if (!Number.isSafeInteger(totalObserved) || totalObserved < 0) {
    throw new Error('Line mode exposed an invalid known-fix total.')
  }
  return totalObserved
}

async function captureLatestExactBreadcrumbDotEvidence(input) {
  const observed = await waitForStableExactBreadcrumbDotPage({
    page: input.page,
    expected: input.expected,
    observedFromMs: input.observedFromMs,
    timeoutMs: input.timeoutMs,
  })
  const operatorPage = parseExactBreadcrumbDotPageSummary(
    await input.page.getByTestId('exact-breadcrumb-dot-page-summary').textContent(),
  )
  if (
    operatorPage.pagePositionCount !== observed.featureCount ||
    operatorPage.totalPositionCount !== input.totalPositionCount ||
    operatorPage.fromTimestamp !== observed.fromTimestamp ||
    operatorPage.toTimestamp !== observed.toTimestamp
  ) {
    throw new Error(
      'Post-completion restart exact-dot operator summary differed from the latest source page.',
    )
  }
  return {
    ...observed,
    modeActivation: input.modeActivation,
    operatorPage,
  }
}

async function activateBreadcrumbLineProofMode(page) {
  await page.getByTestId('open-devices-workspace').click({ force: true })
  await page.getByTestId('devices-workspace').waitFor({ state: 'visible' })
  await page.getByTestId('breadcrumb-mode-line').click({ force: true })
  await page.keyboard.press('Escape')
  await page.getByTestId('devices-workspace').waitFor({ state: 'hidden' })
}

function parseExactBreadcrumbDotPageSummary(value) {
  const match = /^Showing ([\d,]+) exact fixes of ([\d,]+)(?: — (.+) to (.+))?$/u.exec(
    String(value ?? '').trim(),
  )
  if (match === null) {
    throw new Error('Operator exact breadcrumb-dot page summary is malformed or missing.')
  }
  const pagePositionCount = Number(match[1].replaceAll(',', ''))
  const totalPositionCount = Number(match[2].replaceAll(',', ''))
  const fromTimestamp = match[3] ?? null
  const toTimestamp = match[4] ?? null
  if (
    !Number.isSafeInteger(pagePositionCount) ||
    pagePositionCount < 0 ||
    !Number.isSafeInteger(totalPositionCount) ||
    totalPositionCount < pagePositionCount
  ) {
    throw new Error('Operator exact breadcrumb-dot page summary has invalid counts.')
  }
  return {
    pagePositionCount,
    totalPositionCount,
    fromTimestamp,
    toTimestamp,
  }
}

async function waitForStableExactBreadcrumbDotPage(input) {
  const deadline = input.observedFromMs + input.timeoutMs
  let lastSource = null
  let lastRendered = null
  while (Date.now() < deadline) {
    assertProcessAlive(input.page)
    const firstSourceCollection =
      await readExactBreadcrumbDotSourceCollection(input.page)
    const first = createExactBreadcrumbDotPageEvidence(firstSourceCollection)
    lastSource = summarizeExactBreadcrumbDotPageEvidence(first)
    if (exactDotPageEvidenceMatches(first, input.expected)) {
      await fitExactBreadcrumbDotPageForRenderedAudit(input.page)
      const firstRenderedCollection =
        await readRenderedExactBreadcrumbDotLayerCollection(input.page)
      const firstRendered = createExactBreadcrumbDotPageEvidence(
        firstRenderedCollection,
      )
      const firstCoordinateDeviation =
        measureExactBreadcrumbDotRenderedDeviation(
          firstSourceCollection.features,
          firstRenderedCollection.features,
        )
      lastRendered = {
        ...summarizeExactBreadcrumbDotPageEvidence(firstRendered),
        coordinateDeviation: firstCoordinateDeviation,
      }
      if (!renderedExactDotPageMatchesSource(
        firstRendered,
        first,
        firstCoordinateDeviation,
      )) {
        await input.page.waitForTimeout(50)
        continue
      }
      await input.page.waitForTimeout(100)
      const secondSourceCollection =
        await readExactBreadcrumbDotSourceCollection(input.page)
      const second = createExactBreadcrumbDotPageEvidence(secondSourceCollection)
      const secondRenderedCollection =
        await readRenderedExactBreadcrumbDotLayerCollection(input.page)
      const secondRendered = createExactBreadcrumbDotPageEvidence(
        secondRenderedCollection,
      )
      const secondCoordinateDeviation =
        measureExactBreadcrumbDotRenderedDeviation(
          secondSourceCollection.features,
          secondRenderedCollection.features,
        )
      if (
        exactDotPageEvidenceMatches(second, first) &&
        exactDotPageEvidenceMatches(secondRendered, firstRendered) &&
        renderedExactDotPageMatchesSource(
          secondRendered,
          second,
          secondCoordinateDeviation,
        )
      ) {
        return {
          ...second,
          stable: true,
          observedMs: Date.now() - input.observedFromMs,
          renderedLayer: {
            featureCount: secondRendered.featureCount,
            coordinateCount: secondRendered.coordinateCount,
            sourceTruthSha256: secondRendered.sourceTruthSha256,
            identityTimestampSha256:
              secondRendered.identityTimestampSha256,
            invalidFeatureCount: secondRendered.invalidFeatureCount,
            rawRenderedFeatureCount: secondRendered.rawFeatureCount,
            duplicateRenderedFeatureCount:
              secondRendered.rawFeatureCount - secondRendered.featureCount,
            duplicateConflictCount: secondRendered.duplicateConflictCount,
            idTypeCounts: secondRendered.idTypeCounts,
            coordinateDeviation: secondCoordinateDeviation,
          },
        }
      }
    }
    await input.page.waitForTimeout(50)
  }
  throw new Error(
    `Timed out waiting for an exact breadcrumb-dot page from MapLibre. ` +
      `expected=${JSON.stringify(summarizeExactBreadcrumbDotPageEvidence(input.expected))} ` +
      `source=${JSON.stringify(lastSource)} rendered=${JSON.stringify(lastRendered)}`,
  )
}

async function fitExactBreadcrumbDotPageForRenderedAudit(page) {
  await page.evaluate(async () => {
    const map = window.__SARTRACKER_MAP__
    const source = map?.getSource('tracking-breadcrumb-dots-exact')
    if (map === undefined || source === undefined) {
      throw new Error('Exact breadcrumb-dot map/source is unavailable for rendered audit.')
    }
    const data = typeof source.getData === 'function'
      ? await source.getData()
      : typeof source.serialize === 'function'
        ? source.serialize()?.data
        : null
    const coordinates = Array.isArray(data?.features)
      ? data.features.flatMap((feature) => {
          const point = feature?.geometry?.coordinates
          return feature?.geometry?.type === 'Point' &&
            Array.isArray(point) &&
            Number.isFinite(point[0]) &&
            Number.isFinite(point[1])
            ? [[point[0], point[1]]]
            : []
        })
      : []
    if (coordinates.length === 0) {
      throw new Error('Exact breadcrumb-dot page has no finite coordinates to fit.')
    }
    let west = coordinates[0][0]
    let east = coordinates[0][0]
    let south = coordinates[0][1]
    let north = coordinates[0][1]
    for (const [longitude, latitude] of coordinates) {
      west = Math.min(west, longitude)
      east = Math.max(east, longitude)
      south = Math.min(south, latitude)
      north = Math.max(north, latitude)
    }
    if (west === east) {
      west -= 0.000001
      east += 0.000001
    }
    if (south === north) {
      south -= 0.000001
      north += 0.000001
    }
    await new Promise((resolve, reject) => {
      const handleRender = () => {
        window.clearTimeout(timeout)
        resolve()
      }
      const timeout = window.setTimeout(() => {
        map.off('render', handleRender)
        reject(new Error('MapLibre did not render after fitting the exact-dot page.'))
      }, 5_000)
      map.once('render', handleRender)
      map.fitBounds([[west, south], [east, north]], {
        duration: 0,
        padding: 48,
      })
      map.triggerRepaint()
    })
  })
}

async function readRenderedExactBreadcrumbDotLayerCollection(page) {
  const renderedFeatures = await page.evaluate(async () => {
    const map = window.__SARTRACKER_MAP__
    if (map === undefined) {
      throw new Error('MapLibre is unavailable for exact breadcrumb-dot layer evidence.')
    }
    const measureRenderedFeatureScreenPixelErrors = (
      activeMap,
      sourceFeaturesByIdentity,
      renderedFeature,
    ) => {
      const deviceId = typeof renderedFeature?.properties?.deviceId === 'string'
        ? renderedFeature.properties.deviceId.trim()
        : ''
      const sourcePositionId =
        typeof renderedFeature?.properties?.sourcePositionId === 'string'
          ? renderedFeature.properties.sourcePositionId.trim()
          : ''
      const sourceFeature = sourceFeaturesByIdentity.get(
        `${deviceId}:id:${sourcePositionId}`,
      )
      const sourceCoordinates = sourceFeature?.geometry?.coordinates
      const renderedCoordinates = renderedFeature?.geometry?.coordinates
      if (
        !Array.isArray(sourceCoordinates) ||
        !Array.isArray(renderedCoordinates) ||
        !Number.isFinite(sourceCoordinates[0]) ||
        !Number.isFinite(sourceCoordinates[1]) ||
        !Number.isFinite(renderedCoordinates[0]) ||
        !Number.isFinite(renderedCoordinates[1])
      ) {
        return null
      }
      const sourcePoint = activeMap.project(sourceCoordinates)
      const renderedPoint = activeMap.project(renderedCoordinates)
      return {
        x: Math.abs(sourcePoint.x - renderedPoint.x),
        y: Math.abs(sourcePoint.y - renderedPoint.y),
      }
    }
    const rendered = map.queryRenderedFeatures(undefined, {
      layers: ['tracking-breadcrumbs-dots'],
    })
    const exactSource = map.getSource('tracking-breadcrumb-dots-exact')
    const sourceData = typeof exactSource?.getData === 'function'
      ? await exactSource.getData()
      : typeof exactSource?.serialize === 'function'
        ? exactSource.serialize()?.data
        : null
    const sourceByIdentity = new Map(
      Array.isArray(sourceData?.features)
        ? sourceData.features.flatMap((feature) => {
            const deviceId = typeof feature?.properties?.deviceId === 'string'
              ? feature.properties.deviceId.trim()
              : ''
            const sourcePositionId =
              typeof feature?.properties?.sourcePositionId === 'string'
                ? feature.properties.sourcePositionId.trim()
                : ''
            return deviceId === '' || sourcePositionId === ''
              ? []
              : [[`${deviceId}:id:${sourcePositionId}`, feature]]
          })
        : [],
    )
    return rendered.map((feature) => {
      const screenPixelErrors = measureRenderedFeatureScreenPixelErrors(
        map,
        sourceByIdentity,
        feature,
      )
      return {
        type: 'Feature',
        ...(feature.id === undefined ? {} : { id: feature.id }),
        geometry: feature.geometry,
        properties: feature.properties,
        auditScreenPixelErrorX: screenPixelErrors?.x ?? null,
        auditScreenPixelErrorY: screenPixelErrors?.y ?? null,
      }
    })
  })
  return normalizeRenderedExactBreadcrumbDotFeaturesForAudit(renderedFeatures)
}

async function readExactBreadcrumbDotSourceCollection(page) {
  return page.evaluate(async () => {
    const source = window.__SARTRACKER_MAP__?.getSource('tracking-breadcrumb-dots-exact')
    if (source === undefined) {
      throw new Error('Exact breadcrumb-dot MapLibre source is unavailable.')
    }
    const data = typeof source.getData === 'function'
      ? await source.getData()
      : typeof source.serialize === 'function'
        ? source.serialize()?.data
        : null
    if (
      data === null ||
      typeof data !== 'object' ||
      data.type !== 'FeatureCollection' ||
      !Array.isArray(data.features)
    ) {
      throw new Error('Exact breadcrumb-dot source did not expose GeoJSON evidence.')
    }
    return data
  })
}

function createExactBreadcrumbDotPageEvidence(collection) {
  const rows = []
  const featureIds = []
  let invalidFeatureCount = Number(collection.identityValidationErrorCount ?? 0)
  for (const feature of collection.features ?? []) {
    const coordinates = feature?.geometry?.coordinates
    const deviceId = feature?.properties?.deviceId
    const sourcePositionId = feature?.properties?.sourcePositionId
    const timestamp = feature?.properties?.timestamp
    const featureId = feature?.id
    if (
      feature?.geometry?.type !== 'Point' ||
      !Array.isArray(coordinates) ||
      coordinates.length < 2 ||
      !Number.isFinite(coordinates[0]) ||
      !Number.isFinite(coordinates[1]) ||
      typeof deviceId !== 'string' ||
      typeof sourcePositionId !== 'string' ||
      sourcePositionId.trim() === '' ||
      typeof timestamp !== 'string' ||
      !Number.isFinite(Date.parse(timestamp)) ||
      typeof featureId !== 'string' ||
      featureId !== `${deviceId}:id:${sourcePositionId.trim()}`
    ) {
      invalidFeatureCount += 1
      continue
    }
    featureIds.push(featureId)
    rows.push({
      deviceId,
      sourcePositionId: sourcePositionId.trim(),
      timestamp,
      lat: Number(coordinates[1]),
      lon: Number(coordinates[0]),
    })
  }
  rows.sort(compareExactBreadcrumbDotEvidenceRows)
  const digest = createHash('sha256')
  const identityTimestampDigest = createHash('sha256')
  const canonicalLines = rows.map((row) => {
    const line = [
      row.deviceId,
      row.sourcePositionId,
      row.timestamp,
      row.lat.toFixed(7),
      row.lon.toFixed(7),
    ].join('|') + '\n'
    digest.update(line)
    identityTimestampDigest.update(
      [row.deviceId, row.sourcePositionId, row.timestamp].join('|') + '\n',
    )
    return line
  })
  return {
    featureCount: rows.length,
    coordinateCount: rows.length,
    sourceTruthSha256: digest.digest('hex'),
    identityTimestampSha256: identityTimestampDigest.digest('hex'),
    invalidFeatureCount,
    featureIds,
    canonicalLines,
    fromTimestamp: rows[0]?.timestamp ?? null,
    toTimestamp: rows.at(-1)?.timestamp ?? null,
    rawFeatureCount:
      Number.isSafeInteger(collection.rawFeatureCount)
        ? collection.rawFeatureCount
        : rows.length,
    idTypeCounts: collection.idTypeCounts ?? null,
    derivedIdentityCount: collection.derivedIdentityCount ?? null,
    missingStableIdentityCount: collection.missingStableIdentityCount ?? null,
    duplicateDerivedIdentityCount: collection.duplicateDerivedIdentityCount ?? null,
    duplicateConflictCount: collection.duplicateConflictCount ?? null,
    explicitStringIdMismatchCount:
      collection.explicitStringIdMismatchCount ?? null,
  }
}

function compareExactBreadcrumbDotEvidenceRows(left, right) {
  return (
    compareProofCodeUnits(left.timestamp, right.timestamp) ||
    compareProofCodeUnits(left.deviceId, right.deviceId) ||
    compareProofCodeUnits(left.sourcePositionId, right.sourcePositionId)
  )
}

function compareProofCodeUnits(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

function exactDotPageEvidenceMatches(left, right) {
  return (
    left.featureCount === right.featureCount &&
    left.coordinateCount === right.coordinateCount &&
    left.sourceTruthSha256 === right.sourceTruthSha256 &&
    (right.invalidFeatureCount === undefined ||
      left.invalidFeatureCount === right.invalidFeatureCount)
  )
}

function renderedExactDotPageMatchesSource(rendered, source, coordinateDeviation) {
  return (
    rendered.featureCount === source.featureCount &&
    rendered.coordinateCount === source.coordinateCount &&
    rendered.identityTimestampSha256 === source.identityTimestampSha256 &&
    rendered.invalidFeatureCount === source.invalidFeatureCount &&
    coordinateDeviation.passed === true
  )
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
    const [renderCapture, exactDotCollection, trackingStatusText] = await Promise.all([
      readTrackingSetDataCapture(input.page),
      readExactBreadcrumbDotSourceCollection(input.page).catch(() => ({
        type: 'FeatureCollection',
        features: [],
      })),
      input.page.getByTestId('tracking-status').textContent().then((value) => value ?? ''),
    ])
    const sourceData = renderCapture.latest ?? { type: 'FeatureCollection', features: [] }
    const currentPositionCount = (sourceData.features ?? []).filter(
      (feature) => feature.properties?.featureKind === 'device',
    ).length
    const exactBreadcrumbCount = (exactDotCollection.features ?? []).filter(
      (feature) =>
        feature?.properties?.featureKind === 'breadcrumb' &&
        feature?.geometry?.type === 'Point',
    ).length
    if (currentFixMs === null && currentPositionCount > 0) {
      currentFixMs = observedAtMs - input.observedFromMs
    }
    if (firstBreadcrumbMs === null && exactBreadcrumbCount > 0) {
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

function inspectHistoryCheckpointEvidenceSafely(input) {
  const inspection = inspectHistoryCheckpointsSafely(
    input.databasePath,
    input.missionId,
  )
  const evidence = {
    missionId: input.missionId,
    requiredDeviceIds: input.deviceIds.map(String),
    requiredFrom: input.requiredFrom,
    requiredTo: input.requiredTo,
    ...inspection,
  }
  return {
    ...evidence,
    progress: Array.isArray(evidence.checkpoints)
      ? analyzeBreadcrumbCheckpointProgress({
          checkpoints: evidence.checkpoints,
          missionId: evidence.missionId,
          deviceIds: evidence.requiredDeviceIds,
          requiredFrom: evidence.requiredFrom,
          requiredTo: evidence.requiredTo,
        })
      : null,
  }
}

async function captureFailureRuntimeEvidence(page, missionId) {
  const [
    trackingStatusText,
    persistedRowCount,
    checkpoints,
    renderCapture,
    exactSource,
    exactRenderedLayer,
    exactOperatorSummary,
  ] =
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
      readExactBreadcrumbDotSourceCollection(page)
        .then((collection) => summarizeExactBreadcrumbDotPageEvidence(
          createExactBreadcrumbDotPageEvidence(collection),
        ))
        .catch(createProofCaptureError),
      readRenderedExactBreadcrumbDotLayerCollection(page)
        .then((collection) => summarizeExactBreadcrumbDotPageEvidence(
          createExactBreadcrumbDotPageEvidence(collection),
        ))
        .catch(createProofCaptureError),
      page.getByTestId('exact-breadcrumb-dot-page-summary')
        .textContent()
        .then((value) => parseExactBreadcrumbDotPageSummary(value))
        .catch(createProofCaptureError),
    ])
  return {
    capturedAt: new Date().toISOString(),
    trackingStatusText: trackingStatusText.slice(0, 1_000),
    persistedRowCount,
    checkpoints,
    rendered: createRenderedBreadcrumbEvidence(
      renderCapture.latest ?? { type: 'FeatureCollection', features: [] },
    ),
    exactBreadcrumbDots: {
      source: exactSource,
      renderedLayer: exactRenderedLayer,
      operatorPage: exactOperatorSummary,
    },
    capturedSetDataUpdateCount: renderCapture.updateCount,
  }
}

function summarizeExactBreadcrumbDotPageEvidence(evidence) {
  return {
    featureCount: evidence?.featureCount ?? null,
    coordinateCount: evidence?.coordinateCount ?? null,
    sourceTruthSha256: evidence?.sourceTruthSha256 ?? null,
    identityTimestampSha256: evidence?.identityTimestampSha256 ?? null,
    invalidFeatureCount: evidence?.invalidFeatureCount ?? null,
    rawFeatureCount: evidence?.rawFeatureCount ?? null,
    idTypeCounts: evidence?.idTypeCounts ?? null,
    derivedIdentityCount: evidence?.derivedIdentityCount ?? null,
    missingStableIdentityCount: evidence?.missingStableIdentityCount ?? null,
    duplicateDerivedIdentityCount: evidence?.duplicateDerivedIdentityCount ?? null,
    duplicateConflictCount: evidence?.duplicateConflictCount ?? null,
    explicitStringIdMismatchCount:
      evidence?.explicitStringIdMismatchCount ?? null,
    fromTimestamp: evidence?.fromTimestamp ?? null,
    toTimestamp: evidence?.toTimestamp ?? null,
  }
}

function createProofCaptureError(error) {
  return {
    errorClass: error instanceof Error ? error.name : 'UnknownError',
    errorMessage:
      error instanceof Error
        ? error.message.slice(0, 1_000)
        : String(error).slice(0, 1_000),
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
