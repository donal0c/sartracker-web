#!/usr/bin/env node

// Accelerated packaged-Electron tracking and storage soak (DON-246).
// Simulated time is compressed only in the local Traccar response. Every row
// still crosses the production network proxy, poller, runtime, IPC, SQLite,
// autosave, diagnostics, restart, and support-export boundaries.

import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import {
  access,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright'

import { summarizeResponsiveness } from '../build/electron-map-freeze-probe-lib.js'
import { sanitizeEvidenceText } from '../build/electron-official-map-offline-smoke-lib.js'
import {
  clickExactDotPageControl,
  readExactDotPageControlDisabled,
} from '../build/electron-tracking-soak-exact-action-lib.js'
import {
  auditIndependentExactSoakPage,
  createExactSoakPageEvidenceAccumulator,
  createExactSoakPageTiming,
  createExactSoakMismatchObservation,
  createIndependentExactSoakOracle,
  createTrackingSoakFixtureClock,
} from '../build/electron-tracking-soak-exact-proof-lib.js'
import {
  readCompactExactSoakMapEvidenceInRenderer,
} from '../build/electron-tracking-soak-exact-renderer-proof-lib.js'
import {
  createTrackingSoakFailureReport,
} from '../build/electron-tracking-soak-failure-evidence-lib.js'
import {
  runCleanupStep,
  startTrackingSoakSleepGuard,
  stopOwnedProcess,
} from '../build/electron-tracking-soak-lifecycle-lib.js'
import {
  performOwnedHarnessClick,
} from '../build/electron-tracking-soak-operator-audit-lib.js'
import {
  buildWebGlRendererAttestation,
  buildTrackingGrowthEvidence,
  buildTrackingSoakVerdict,
  clickActionablePointerTarget,
  classifyOperatorInteraction,
  createPositionTruthDigestAccumulator,
  installCadencedRendererProbeInWindow,
  measureOperatorAction,
  parseTrackingSoakArgs,
  parseTrackingSoakRuntimeLog,
  parseDarwinProcessTreeResidentMemory,
  partitionOperatorClickAudit,
  readWebGlRendererInfoFromDocument,
} from '../build/electron-tracking-soak-lib.js'
import {
  buildTrackingSoakExpectedPositionTruthEvidence,
  startTrackingSoakMockServer,
} from '../build/electron-tracking-soak-mock-server.js'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const runtimeLogRelativePath = path.join('logs', 'runtime.log')
const PROCESS_MEMORY_SAMPLE_INTERVAL_MS = 250
const PROCESS_MEMORY_EVIDENCE_INTERVAL_MS = 5_000
const EXACT_PAGE_ACTION_TIMEOUT_MS = 5_000
let exactDotRequestSequence = 0

main().catch((error) => {
  console.error(`electron-tracking-soak: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})

/** Runs one complete packaged soak profile and writes a fail-closed report. */
async function main() {
  const options = parseTrackingSoakArgs(process.argv.slice(2))
  const startedAt = new Date()
  const fixtureClock = createTrackingSoakFixtureClock(
    options.profile,
    startedAt.getTime(),
  )
  const exactSoakRequired = options.profile.name === 'extended'
  const exactSoakPauseCheckpoints = exactSoakRequired
    ? [...options.profile.restartCheckpoints, options.profile.actualBatches]
    : options.profile.restartCheckpoints
  const evidenceDir = path.resolve(options.evidenceDir)
  const userDataDir = path.join(evidenceDir, 'user-data')
  const databasePath = path.join(userDataDir, 'mission-store.sqlite')
  await assertFreshDirectory(evidenceDir)
  await mkdir(userDataDir, { recursive: true })
  await access(options.appPath)

  const mockServer = await startTrackingSoakMockServer({
    statePath: path.join(evidenceDir, 'mock-traccar-state.json'),
    baseTimeMs: fixtureClock.baseTimeMs,
    intervalMs: fixtureClock.intervalMs,
    deviceCount: options.profile.deviceCount,
    movingDeviceCount: options.profile.movingDeviceCount,
    productionPollsPerBatch: options.profile.productionPollsPerBatch,
    maximumBatches: options.profile.actualBatches,
    pauseCheckpoints: exactSoakPauseCheckpoints,
  })
  await seedRuntimeConfiguration(userDataDir, mockServer.baseUrl)

  const launches = []
  const mainRoundTrips = []
  const rendererGaps = []
  const operatorInteractions = []
  const growthCheckpoints = []
  const exactDotRestartAudits = []
  let exactDotProof = exactSoakRequired
    ? null
    : { required: false, passed: true }
  let finalLineTotalAudit = exactSoakRequired
    ? null
    : { required: false, passed: true }
  let restartCheckpointsPassed = 0
  let activeLaunch
  let missionId
  let sleepGuard
  const failureReportPath = path.join(
    evidenceDir,
    'electron-tracking-soak-failure-report.json',
  )
  const exactFailureProgress = {
    phase: 'initializing',
    direction: null,
    pageIndexFromLatest: null,
    completedUiPageObservations: 0,
    completedDirectIpcQueries: 0,
    launchNumber: null,
    targetBatch: null,
    currentBatch: null,
    timing: {},
  }

  try {
    sleepGuard = await startTrackingSoakSleepGuard({
      platform: process.platform,
      parentPid: process.pid,
      spawnProcess: spawn,
      startupTimeoutMs: 2_000,
    })
    sleepGuard.assertHealthy()
    exactFailureProgress.phase = 'tracking'
    activeLaunch = await launchPackagedApp(options, userDataDir, launches.length + 1)
    launches.push(activeLaunch)
    exactFailureProgress.launchNumber = activeLaunch.number
    const missionModelEvidence = await startSyntheticMission(
      activeLaunch,
      fixtureClock.missionOffsetHours,
      options.profile.deviceCount,
    )
    missionId = await readActiveMissionId(activeLaunch.page)
    await recordOperatorInteraction({
      page: activeLaunch.page,
      phase: 'mission-started',
      evidenceDir,
      results: operatorInteractions,
      auditState: activeLaunch.operatorClickAuditState,
    })

    for (const checkpoint of options.profile.restartCheckpoints) {
      await waitForCheckpoint({
        launch: activeLaunch,
        mockServer,
        missionId,
        targetBatch: checkpoint,
        expectedPositions: expectedPositionsAt(options.profile, checkpoint),
        timeoutMs: options.timeoutMs,
        progress: exactFailureProgress,
        sleepGuard,
      })
      let exactDotBeforeRestart = null
      if (exactSoakRequired) {
        exactFailureProgress.phase = 'checkpoint_latest'
        exactFailureProgress.direction = 'latest'
        exactFailureProgress.pageIndexFromLatest = 0
        assertMockPausedAtCheckpoint(mockServer, checkpoint)
        await ensureMissionPaused(activeLaunch)
        exactDotBeforeRestart = await auditLatestExactDotPage({
          fixtureClock,
          launch: activeLaunch,
          missionId,
          profile: options.profile,
          maximumBatches: checkpoint,
          timeoutMs: options.timeoutMs,
          progress: exactFailureProgress,
          sleepGuard,
        })
      }
      growthCheckpoints.push(
        await readGrowthCheckpoint({
          page: activeLaunch.page,
          userDataDir,
          missionId,
          equivalentProductionPolls:
            checkpoint * options.profile.productionPollsPerBatch,
        }),
      )
      await recordOperatorInteraction({
        page: activeLaunch.page,
        phase: `checkpoint-${checkpoint}-before-restart`,
        evidenceDir,
        results: operatorInteractions,
        auditState: activeLaunch.operatorClickAuditState,
      })
      await collectLaunchResponsiveness(activeLaunch, mainRoundTrips, rendererGaps)
      await activeLaunch.page.screenshot({
        path: path.join(evidenceDir, `checkpoint-${checkpoint}-before-restart.png`),
        fullPage: true,
      })
      await closeLaunch(activeLaunch, mainRoundTrips, rendererGaps)
      activeLaunch = undefined

      activeLaunch = await launchPackagedApp(options, userDataDir, launches.length + 1)
      launches.push(activeLaunch)
      exactFailureProgress.launchNumber = activeLaunch.number
      await resumeRecoveredMission(activeLaunch, missionId)
      if (exactSoakRequired) {
        await ensureMissionPaused(activeLaunch)
        const exactDotAfterRestart = await auditLatestExactDotPage({
          fixtureClock,
          launch: activeLaunch,
          missionId,
          profile: options.profile,
          maximumBatches: checkpoint,
          timeoutMs: options.timeoutMs,
          progress: exactFailureProgress,
          sleepGuard,
        })
        assertLatestExactDotParity(
          exactDotBeforeRestart,
          exactDotAfterRestart,
        )
        assertMockPausedAtCheckpoint(mockServer, checkpoint)
        exactDotRestartAudits.push({
          checkpoint,
          beforeRestart: exactDotBeforeRestart,
          afterRestart: exactDotAfterRestart,
          passed: true,
        })
      }
      await recordOperatorInteraction({
        page: activeLaunch.page,
        phase: `checkpoint-${checkpoint}-after-restart`,
        evidenceDir,
        results: operatorInteractions,
        auditState: activeLaunch.operatorClickAuditState,
      })
      if (exactSoakRequired) {
        await ensureMissionActive(activeLaunch)
      }
      await mockServer.resume()
      restartCheckpointsPassed += 1
    }

    await waitForCheckpoint({
      launch: activeLaunch,
      mockServer,
      missionId,
      targetBatch: options.profile.actualBatches,
      expectedPositions: options.profile.expectedPositionRows,
      timeoutMs: options.timeoutMs,
      progress: exactFailureProgress,
      sleepGuard,
    })
    if (exactSoakRequired) {
      exactFailureProgress.phase = 'final_latest_before'
      exactFailureProgress.direction = 'latest'
      exactFailureProgress.pageIndexFromLatest = 0
      assertMockPausedAtCheckpoint(mockServer, options.profile.actualBatches)
      await ensureMissionPaused(activeLaunch)
      const finalLatestBeforeTraversal = await auditLatestExactDotPage({
        fixtureClock,
        launch: activeLaunch,
        missionId,
        profile: options.profile,
        maximumBatches: options.profile.actualBatches,
        timeoutMs: options.timeoutMs,
        progress: exactFailureProgress,
        sleepGuard,
      })
      const traversalProof = await auditFinalExactDotTraversal({
        fixtureClock,
        launch: activeLaunch,
        missionId,
        profile: options.profile,
        restartAudits: exactDotRestartAudits,
        timeoutMs: options.timeoutMs,
        progress: exactFailureProgress,
        sleepGuard,
      })
      exactFailureProgress.phase = 'final_latest_after'
      exactFailureProgress.direction = 'latest'
      exactFailureProgress.pageIndexFromLatest = 0
      const finalLatestAfterTraversal = await auditLatestExactDotPage({
        fixtureClock,
        launch: activeLaunch,
        missionId,
        profile: options.profile,
        maximumBatches: options.profile.actualBatches,
        timeoutMs: options.timeoutMs,
        progress: exactFailureProgress,
        sleepGuard,
      })
      assertLatestExactDotParity(
        finalLatestBeforeTraversal,
        finalLatestAfterTraversal,
      )
      assertMockPausedAtCheckpoint(mockServer, options.profile.actualBatches)
      exactDotProof = finalizeExactDotProof({
        fixtureClock,
        profile: options.profile,
        restartAudits: exactDotRestartAudits,
        finalLatestAudits: [
          finalLatestBeforeTraversal,
          finalLatestAfterTraversal,
        ],
        traversalProof,
      })
      exactFailureProgress.phase = 'line_total'
      exactFailureProgress.direction = null
      exactFailureProgress.pageIndexFromLatest = null
      finalLineTotalAudit = await auditFinalLineTotalParity({
        fixtureClock,
        launch: activeLaunch,
        missionId,
        profile: options.profile,
        timeoutMs: options.timeoutMs,
        progress: exactFailureProgress,
        sleepGuard,
      })
    }
    await waitForBackupEvent(activeLaunch.page, missionId, options.timeoutMs)
    await recordOperatorInteraction({
      page: activeLaunch.page,
      phase: 'final-load',
      evidenceDir,
      results: operatorInteractions,
      auditState: activeLaunch.operatorClickAuditState,
    })
    growthCheckpoints.push(
      await readGrowthCheckpoint({
        page: activeLaunch.page,
        userDataDir,
        missionId,
        equivalentProductionPolls: options.profile.equivalentProductionPolls,
      }),
    )
    const supportBundlePath = await activeLaunch.page.evaluate(async () => {
      const exportBundle = window.sartrackerElectron?.exportSupportBundle
      if (typeof exportBundle !== 'function') {
        throw new Error('Electron support-bundle bridge is unavailable.')
      }
      return exportBundle({
        fileName: 'tracking-soak-support-bundle.txt',
        contents: 'SAR Tracker synthetic packaged tracking soak validation',
      })
    })
    await collectLaunchResponsiveness(activeLaunch, mainRoundTrips, rendererGaps)
    await activeLaunch.page.screenshot({
      path: path.join(evidenceDir, 'final-packaged-state.png'),
      fullPage: true,
    })

    const supportBundle = await readFile(supportBundlePath, 'utf8')
    await writeFile(
      path.join(evidenceDir, 'support-bundle-inspected.txt'),
      sanitizeEvidenceText(supportBundle),
      'utf8',
    )

    await closeLaunch(activeLaunch, mainRoundTrips, rendererGaps)
    activeLaunch = undefined

    const databaseEvidence = inspectDatabase(databasePath, missionId)
    if (
      missionModelEvidence.enabled &&
      (databaseEvidence.participantRows !== 1 || databaseEvidence.teamRows !== 1)
    ) {
      throw new Error(
        `Mission-model soak expected one selected team/participant; observed ${databaseEvidence.teamRows}/${databaseEvidence.participantRows}.`,
      )
    }
    const expectedPositionTruth = buildTrackingSoakExpectedPositionTruthEvidence({
      deviceCount: options.profile.deviceCount,
      movingDeviceCount: options.profile.movingDeviceCount,
      productionPollsPerBatch: options.profile.productionPollsPerBatch,
      maximumBatches: options.profile.actualBatches,
      baseTimeMs: fixtureClock.baseTimeMs,
      intervalMs: fixtureClock.intervalMs,
      statePath: path.join(evidenceDir, 'unused-position-truth-state.json'),
    })
    const positionTruth = {
      actual: databaseEvidence.positionTruth,
      expected: expectedPositionTruth,
      exactMatch: positionTruthDigestsMatch(
        databaseEvidence.positionTruth.full,
        expectedPositionTruth.full,
      ),
      normalPrefixExactMatch: positionTruthDigestsMatch(
        databaseEvidence.positionTruth.normalPrefix,
        expectedPositionTruth.normalPrefix,
      ),
    }
    const runtimeLogBytes = await combinedLogBytes(userDataDir)
    const runtimeTiming = parseTrackingSoakRuntimeLog(await readCombinedRuntimeLog(userDataDir))
    const growth = buildTrackingGrowthEvidence(growthCheckpoints)
    const supportBundleBytes = Buffer.byteLength(supportBundle, 'utf8')
    const mainStats = summarizeResponsiveness(mainRoundTrips, 250)
    const rendererStats = summarizeResponsiveness(rendererGaps, 250)
    const operatorInteractionStats = summarizeResponsiveness(
      operatorInteractions.map((interaction) => interaction.durationMs),
      250,
    )
    const operatorActionStats = summarizeResponsiveness(
      operatorInteractions.flatMap((interaction) =>
        [interaction.openActionDurationMs, interaction.closeActionDurationMs].filter(
          Number.isFinite,
        ),
      ),
      250,
    )
    const operatorExternalActionStats = summarizeResponsiveness(
      operatorInteractions.flatMap((interaction) =>
        [
          interaction.openExternalActionDurationMs,
          interaction.closeExternalActionDurationMs,
        ].filter(Number.isFinite),
      ),
      250,
    )
    const operatorTargetStabilityStats = summarizeResponsiveness(
      operatorInteractions.flatMap((interaction) =>
        [
          interaction.openTargetStabilityWaitMs,
          interaction.closeTargetStabilityWaitMs,
        ].filter(Number.isFinite),
      ),
      250,
    )
    const operatorAuditTailErrors = launches.filter(
      (launch) => (launch.operatorClickAuditTail?.issues.length ?? 0) > 0,
    ).length
    const operatorInteractionErrors = operatorInteractions.filter(
      (interaction) => !interaction.passed,
    ).length + operatorAuditTailErrors
    const operatorInteractionClassifications = countBy(
      [
        ...operatorInteractions.map((interaction) => interaction.classification),
        ...Array.from(
          { length: operatorAuditTailErrors },
          () => 'unexpected_browser_input',
        ),
      ],
    )
    const maximumMemoryLaunch = launches.reduce(
      (maximum, launch) =>
        launch.processMemory.maximumProcessTreeResidentBytes >
        maximum.processMemory.maximumProcessTreeResidentBytes
          ? launch
          : maximum,
      launches[0],
    )
    const processMemory = {
      samples: launches.reduce((sum, launch) => sum + launch.processMemory.samples, 0),
      maximumProcessTreeResidentBytes: Math.max(
        0,
        ...launches.map((launch) => launch.processMemory.maximumProcessTreeResidentBytes),
      ),
      maximumSample: maximumMemoryLaunch?.processMemory.maximumSample ?? null,
      phaseSamples: launches.flatMap((launch) =>
        launch.processMemory.evidenceSamples.map((sample) => ({
          launchNumber: launch.number,
          ...sample,
        })),
      ),
    }
    const rendererCrashes = launches.reduce((sum, launch) => sum + launch.rendererCrashes, 0)
    const webGlRendererAttestation = buildWebGlRendererAttestation({
      platform: process.platform,
      profileName: options.profile.name,
      launches,
    })
    const mockState = mockServer.snapshot()
    const supportBundleRedacted = !containsForbiddenEvidence(supportBundle, [
      'synthetic-soak-secret',
      'synthetic-soak@example.invalid',
      userDataDir,
      os.homedir(),
    ])
    const verdict = buildTrackingSoakVerdict({
      profile: options.profile,
      observedBatches: mockState.completedBatches,
      deviceRows: databaseEvidence.deviceRows,
      positionRows: databaseEvidence.positionRows,
      deviceCreatedEvents: databaseEvidence.events.device_created ?? 0,
      deviceUpdatedEvents: databaseEvidence.events.device_updated ?? 0,
      positionRecordedEvents: databaseEvidence.events.position_recorded ?? 0,
      operationalMissionEvents: databaseEvidence.operationalMissionEvents,
      declaredOperationalEventBudget:
        options.profile.deviceCount +
        1 +
        (missionModelEvidence.enabled ? 1 : 0) +
        options.profile.restartCheckpoints.length * 2 +
        (exactSoakRequired
          ? options.profile.restartCheckpoints.length * 2 + 1
          : 0) +
        (databaseEvidence.events.mission_backup_synced ?? 0),
      unexplainedMissionEvents: databaseEvidence.unexplainedMissionEvents,
      restartCheckpointsPassed,
      backupCycles: databaseEvidence.events.mission_backup_synced ?? 0,
      mainHeartbeatSamples: mainStats.count,
      mainHeartbeatErrors: launches.reduce((sum, launch) => sum + launch.mainHeartbeatErrors, 0),
      mainMaximumMs: mainStats.maxMs,
      rendererSamples: rendererStats.count,
      rendererLaunchSampleCounts: launches.map(
        (launch) => launch.rendererSampleCount ?? 0,
      ),
      rendererMaximumMs: rendererStats.maxMs,
      rendererCrashes,
      operatorInteractionSamples: operatorInteractionStats.count,
      operatorInteractionErrors,
      operatorInteractionMaximumMs: operatorInteractionStats.maxMs,
      operatorActionSamples: operatorActionStats.count,
      operatorActionMaximumMs: operatorActionStats.maxMs,
      operatorExternalActionSamples: operatorExternalActionStats.count,
      operatorExternalActionMaximumMs: operatorExternalActionStats.maxMs,
      webGlRendererAttested: webGlRendererAttestation.passed,
      maximumProcessTreeResidentBytes: processMemory.maximumProcessTreeResidentBytes,
      freezeThresholdMs: options.freezeThresholdMs,
      integrityResult: databaseEvidence.integrityResult,
      walCheckpointBusy: databaseEvidence.walCheckpoint.busy,
      supportBundleInspected: true,
      supportBundleRedacted,
      runtimeLogBytes,
      supportBundleBytes,
      positionTruthExactMatch: positionTruth.exactMatch,
      normalPrefixTruthExactMatch: positionTruth.normalPrefixExactMatch,
      missingSourcePositionIdentityRows:
        databaseEvidence.positionTruth.full.missingSourcePositionIdentityRows,
      exactDotProof,
      finalLineTotalAudit,
    })
    exactFailureProgress.phase = 'closeout'
    sleepGuard.assertHealthy()
    await sleepGuard.stop()
    const report = {
      schemaVersion: 1,
      issue: 'DON-246',
      recordedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
      profile: options.profile,
      fixtureClock,
      acceleration: {
        actualPollIntervalMs: options.pollIntervalMs,
        productionPollIntervalMs: 5_000,
        productionPollsPerBatch: options.profile.productionPollsPerBatch,
      },
      app: {
        basename: path.basename(options.appPath),
        sha256: await sha256File(options.appPath),
      },
      platform: {
        os: `${os.type()} ${os.release()}`,
        architecture: os.arch(),
        node: process.version,
      },
      mockTraccar: mockState,
      missionModel: {
        ...missionModelEvidence,
        persistedParticipantRows: databaseEvidence.participantRows,
        persistedTeamRows: databaseEvidence.teamRows,
      },
      database: databaseEvidence,
      positionTruth,
      growth,
      runtimeTiming,
      responsiveness: {
        mainProcess: mainStats,
        renderer: rendererStats,
        operatorInteractions: {
          ...operatorInteractionStats,
          actionTiming: operatorActionStats,
          externalActionTiming: operatorExternalActionStats,
          targetStabilityTiming: operatorTargetStabilityStats,
          errors: operatorInteractionErrors,
          classifications: operatorInteractionClassifications,
          samples: operatorInteractions,
        },
        rendererThrottledByDesktopSession:
          rendererStats.maxMs >= options.freezeThresholdMs && mainStats.maxMs < options.freezeThresholdMs,
      },
      processMemory,
      rendererCrashes,
      webGlRendererAttestation,
      boundedEvidence: {
        runtimeLogBytes,
        supportBundleBytes,
        supportBundleRedacted,
      },
      restartCheckpointsPassed,
      exactDotProof,
      finalLineTotalAudit,
      hostSleepGuard: sleepGuard.snapshot(),
      launches: launches.map((launch) => ({
        number: launch.number,
        webGlRenderer: launch.webGlRenderer,
        rendererSampleCount: launch.rendererSampleCount ?? 0,
        mainHeartbeatErrors: launch.mainHeartbeatErrors,
        rendererCrashes: launch.rendererCrashes,
        processMemory: createProcessMemoryReport(launch.processMemory),
        operatorClickAuditTail: launch.operatorClickAuditTail,
        exitCode: launch.appProcess.exitCode,
      })),
      verdict,
    }
    await writeJson(path.join(evidenceDir, 'electron-tracking-soak-report.json'), report)
    console.log(
      `[tracking-soak] profile=${options.profile.name} batches=${mockState.completedBatches}/${options.profile.actualBatches} ` +
        `positions=${databaseEvidence.positionRows}/${options.profile.expectedPositionRows} ` +
        `main-max=${mainStats.maxMs.toFixed(1)}ms redundant-slope=${verdict.redundantTelemetrySlopeRowsPerEquivalentPoll} ` +
        `passed=${verdict.passed}`,
    )
    if (!verdict.passed) {
      throw new Error(`Tracking soak failed: ${verdict.failureReasons.join(' ')}`)
    }
  } catch (error) {
    const failureReport = createTrackingSoakFailureReport({
      recordedAt: new Date().toISOString(),
      profileName: options.profile.name,
      error,
      progress: exactFailureProgress,
      rendererLifecycle: activeLaunch?.rendererLifecycle.snapshot(),
      hostSleepGuard: sleepGuard?.snapshot(),
    })
    await writeJson(failureReportPath, failureReport)
    throw error
  } finally {
    let cleanupFailure
    if (activeLaunch !== undefined) {
      try {
        await closeLaunch(activeLaunch, mainRoundTrips, rendererGaps)
      } catch (error) {
        cleanupFailure = error
      }
    }
    await Promise.allSettled(
      launches.map((launch) =>
        writeFile(
          path.join(evidenceDir, `electron-launch-${launch.number}.log`),
          sanitizeEvidenceText(Buffer.concat(launch.logChunks).toString('utf8')),
          'utf8',
        ),
      ),
    )
    await runCleanupStep(() => mockServer.close(), 5_000)
    try {
      await sleepGuard?.stop()
    } catch (error) {
      cleanupFailure ??= error
    }
    if (cleanupFailure !== undefined) {
      const failureReport = createTrackingSoakFailureReport({
        recordedAt: new Date().toISOString(),
        profileName: options.profile.name,
        error: cleanupFailure,
        progress: exactFailureProgress,
        rendererLifecycle: activeLaunch?.rendererLifecycle.snapshot(),
        hostSleepGuard: sleepGuard?.snapshot(),
      })
      await writeJson(failureReportPath, failureReport)
      throw cleanupFailure
    }
  }
}

async function seedRuntimeConfiguration(userDataDir, baseUrl) {
  await writeJson(path.join(userDataDir, 'settings.json'), {
    missionDefaults: {
      autoRefreshEnabled: true,
      autoRefreshIntervalSeconds: 5,
      autoSaveEnabled: true,
      autoSaveIntervalSeconds: 5,
      primaryMissionRoot: '',
      backupMissionRoot: '',
      coordinatorRoster: [],
      adminRoster: [],
    },
    dataSource: {
      providerType: 'traccar_http',
      baseUrl,
      authMode: 'basic',
      email: 'synthetic-soak@example.invalid',
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
    traccar: { basic: { secret: 'synthetic-soak-secret' } },
  })
}

async function launchPackagedApp(options, userDataDir, number) {
  const remoteDebuggingPort = await findFreePort()
  const inspectorPort = await findFreePort()
  const logChunks = []
  const appProcess = spawn(
    options.appPath,
    [`--inspect=${inspectorPort}`, `--remote-debugging-port=${remoteDebuggingPort}`, ...options.extraArgs],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        SARTRACKER_ELECTRON_USER_DATA_PATH: userDataDir,
        SARTRACKER_ELECTRON_SOAK_POLL_INTERVAL_MS: String(options.pollIntervalMs),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  appProcess.on('error', (error) => {
    appProcess.trackingSoakLaunchError = error
  })
  appProcess.stdout.on('data', (chunk) => logChunks.push(chunk))
  appProcess.stderr.on('data', (chunk) => logChunks.push(chunk))
  let browser
  let mainInspector
  try {
    await waitForCdp(remoteDebuggingPort, appProcess)
    mainInspector = await connectMainInspector(inspectorPort, appProcess)
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${remoteDebuggingPort}`)
    const context = browser.contexts()[0]
    const page = context.pages()[0] ?? (await context.waitForEvent('page'))
    const rendererLifecycle = createRendererLifecycleEvidence(
      browser,
      context,
      page,
    )
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.getByTestId('app-shell').waitFor({ state: 'attached', timeout: 60_000 })
    await page.locator('.maplibregl-canvas').waitFor({ state: 'attached', timeout: 60_000 })
    const webGlRenderer = await page.evaluate(readWebGlRendererInfoFromDocument)
    console.log(
      `[tracking-soak] launch=${number} webgl=${webGlRenderer.available ? webGlRenderer.unmaskedRenderer ?? webGlRenderer.renderer : webGlRenderer.reason}`,
    )
    await installRendererProbe(page)
    await installOperatorClickAudit(page)
    rendererLifecycle.markReady()
    const mainHeartbeat = startMainHeartbeat(mainInspector, 50)

    return {
      number,
      appProcess,
      browser,
      page,
      mainInspector,
      mainHeartbeat,
      mainHeartbeatErrors: 0,
      webGlRenderer,
      get rendererCrashes() {
        return rendererLifecycle.snapshot().pageCrashCount
      },
      rendererLifecycle,
      processMemory: {
        samples: 0,
        maximumProcessTreeResidentBytes: 0,
        maximumSample: null,
        evidenceSamples: [],
        lastSampleAtMs: 0,
        lastEvidenceAtMs: 0,
      },
      operatorClickAuditState: {
        initialized: true,
        lastSequence: 0,
      },
      operatorClickAuditTail: null,
      logChunks,
      closed: false,
      closePromise: null,
    }
  } catch (error) {
    await runCleanupStep(() => mainInspector?.close(), 250)
    await runCleanupStep(() => browser?.close(), 2_000)
    let cleanupFailure
    try {
      await stopOwnedProcess(appProcess, {
        termTimeoutMs: 5_000,
        killTimeoutMs: 5_000,
      })
    } catch (cleanupError) {
      cleanupFailure = cleanupError
    }
    await writeFile(
      path.join(path.resolve(options.evidenceDir), `electron-launch-${number}-failed.log`),
      sanitizeEvidenceText(Buffer.concat(logChunks).toString('utf8')),
      'utf8',
    )
    if (cleanupFailure !== undefined) throw cleanupFailure
    throw error
  }
}

/** Records bounded renderer/CDP lifecycle state without URLs or page content. */
function createRendererLifecycleEvidence(browser, context, page) {
  const state = {
    pageCloseCount: 0,
    pageCrashCount: 0,
    browserDisconnectCount: 0,
    replacementPageCount: 0,
    mainFrameNavigationCount: 0,
    lastEvent: 'none',
  }
  let cleanupStarted = false
  const record = (countKey, event) => {
    if (cleanupStarted) return
    state[countKey] += 1
    state.lastEvent = event
  }
  page.on('close', () => record('pageCloseCount', 'page_closed'))
  page.on('crash', () => record('pageCrashCount', 'page_crashed'))
  browser.on('disconnected', () =>
    record('browserDisconnectCount', 'browser_disconnected'))
  context.on('page', (candidate) => {
    if (candidate !== page) {
      record('replacementPageCount', 'replacement_page')
    }
  })
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) {
      record('mainFrameNavigationCount', 'main_frame_navigation')
    }
  })
  return {
    markReady: () => {
      for (const key of [
        'pageCloseCount',
        'pageCrashCount',
        'browserDisconnectCount',
        'replacementPageCount',
        'mainFrameNavigationCount',
      ]) {
        state[key] = 0
      }
      state.lastEvent = 'none'
    },
    beginCleanup: () => {
      cleanupStarted = true
    },
    snapshot: () => ({ ...state }),
  }
}

async function startSyntheticMission(launch, missionOffsetHours, expectedDeviceCount) {
  await launch.page
    .getByTestId('mission-name-input')
    .fill('Synthetic Continuous Soak Mission', { force: true })
  await launch.page
    .getByTestId('mission-offset-input')
    .fill(String(missionOffsetHours), { force: true })
  const participantSelection = launch.page.getByTestId('participant-selection-step')
  const missionModelEnabled = await participantSelection.isVisible().catch(() => false)
  if (missionModelEnabled) {
    await launch.page
      .getByTestId('participant-group-picker')
      .getByText('Synthetic Mission Team', { exact: true })
      .click()
    await launch.page
      .getByTestId('participant-selected-count')
      .filter({ hasText: `${expectedDeviceCount} selected` })
      .waitFor({ timeout: 30_000 })
  }
  await performLaunchOwnedHarnessClick(
    launch,
    'mission-start-btn',
    () => launch.page.getByTestId('mission-start-btn').click({ force: true }),
  )
  await waitForActiveMission(launch.page, 30_000)
  if (missionModelEnabled) {
    await launch.page
      .getByTestId('participant-active-list')
      .filter({ hasText: 'Synthetic Mission Team' })
      .waitFor({ timeout: 30_000 })
  }
  return {
    enabled: missionModelEnabled,
    selectedDeviceCount: missionModelEnabled ? expectedDeviceCount : null,
  }
}

/**
 * Exercises a real, non-forced operator interaction while the mission is under load.
 *
 * Renderer animation and direct IPC probes can remain healthy when a modal backdrop or
 * input-capture defect makes the application unusable. Opening and closing Devices covers
 * event dispatch, workspace state, rendering, and a representative tracking-heavy control.
 */
async function recordOperatorInteraction(input) {
  const startedAt = performance.now()
  const auditAtStart = await readOperatorClickAudit(input.page)
  const interactionStartSequence = auditAtStart.lastSequence
  await focusPackagedPage(input.page, 2_000)
  const preflight = await inspectPointerTarget(
    input.page,
    'open-devices-workspace',
  ).catch(() => ({
    documentFocused: false,
    targetFound: false,
    targetReceivesPointer: false,
    hitElement: null,
    centerPoint: null,
  }))
  const result = {
    ...preflight,
    openClickCompleted: false,
    openClickReceived: false,
    workspaceOpened: false,
    mainIpcStatus: 'not_run',
    closeClickCompleted: false,
    closeClickReceived: false,
    workspaceClosed: false,
    openActionDurationMs: null,
    closeActionDurationMs: null,
    openExternalActionDurationMs: null,
    closeExternalActionDurationMs: null,
    openClickDeliveryDurationMs: null,
    closeClickDeliveryDurationMs: null,
    openStateWaitDurationMs: null,
    closeStateWaitDurationMs: null,
    openTargetStabilityWaitMs: null,
    closeTargetStabilityWaitMs: null,
  }
  const errors = []

  if (result.targetFound && result.targetReceivesPointer) {
    const openAction = await measureOperatorAction({
      installRecorder: () =>
        installClickRecorder(
          input.page,
          'open-devices-workspace',
          'workspace-close-btn',
          'actionable',
        ),
      click: () =>
        clickActionablePointerTarget({
          page: input.page,
          preflight,
          testId: 'open-devices-workspace',
          stableDurationMs: 250,
          timeoutMs: 2_000,
        }),
      waitForState: () => waitForRecordedActionState(input.page, 5_000),
      readRecorder: () => readClickRecorder(input.page),
      now: () => performance.now(),
    })
    const openStateVerified =
      openAction.stateReached &&
      await waitForPointerTargetActionable(
        input.page,
        'workspace-close-btn',
        5_000,
      )
    result.openClickCompleted = openAction.clickCompleted
    result.openClickReceived = openAction.clickReceived
    result.workspaceOpened = openStateVerified
    result.openActionDurationMs = openAction.durationMs
    result.openExternalActionDurationMs = openAction.externalDurationMs
    result.openClickDeliveryDurationMs = openAction.clickDeliveryDurationMs
    result.openStateWaitDurationMs = openAction.stateWaitDurationMs
    result.openTargetStabilityWaitMs = openAction.targetStabilityWaitMs
    errors.push(...openAction.errorClasses)
  }

  const mainIpc = await probeMainProcessIpc(input.page, 1_000).catch((error) => ({
    status: 'error',
    durationMs: 0,
    errorClass: safeErrorClass(error),
  }))
  result.mainIpcStatus = mainIpc.status

  const closePreflight = result.workspaceOpened
    ? await inspectPointerTarget(input.page, 'workspace-close-btn').catch(() => ({
        documentFocused: false,
        targetFound: false,
        targetReceivesPointer: false,
        hitElement: null,
        centerPoint: null,
      }))
    : null
  if (result.workspaceOpened && closePreflight?.targetReceivesPointer === true) {
    const closeAction = await measureOperatorAction({
      installRecorder: () =>
        installClickRecorder(
          input.page,
          'workspace-close-btn',
          'devices-workspace',
          'hidden',
        ),
      click: () =>
        clickActionablePointerTarget({
          page: input.page,
          preflight: closePreflight,
          testId: 'workspace-close-btn',
          stableDurationMs: 250,
          timeoutMs: 2_000,
        }),
      waitForState: () => waitForRecordedActionState(input.page, 5_000),
      readRecorder: () => readClickRecorder(input.page),
      now: () => performance.now(),
    })
    const closeStateVerified =
      closeAction.stateReached &&
      await waitForPointerTargetStateStable(
        input.page,
        'devices-workspace',
        'hidden',
        250,
        5_000,
      )
    result.closeClickCompleted = closeAction.clickCompleted
    result.closeClickReceived = closeAction.clickReceived
    result.workspaceClosed = closeStateVerified
    result.closeActionDurationMs = closeAction.durationMs
    result.closeExternalActionDurationMs = closeAction.externalDurationMs
    result.closeClickDeliveryDurationMs = closeAction.clickDeliveryDurationMs
    result.closeStateWaitDurationMs = closeAction.stateWaitDurationMs
    result.closeTargetStabilityWaitMs = closeAction.targetStabilityWaitMs
    errors.push(...closeAction.errorClasses)
  }

  const audit = partitionOperatorClickAudit({
    audit: await readOperatorClickAudit(input.page),
    afterSequence: input.auditState.lastSequence,
    interactionStartSequence,
  })
  const expectedInteractionTestIds = [
    ...(result.openClickCompleted ? ['open-devices-workspace'] : []),
    ...(result.closeClickCompleted ? ['workspace-close-btn'] : []),
  ]
  const auditIssues = inspectOperatorClickAudit(
    audit,
    expectedInteractionTestIds,
  )
  if (auditIssues.length === 0) {
    if (await acknowledgeOperatorClickAudit(input.page, audit.lastSequence)) {
      input.auditState.lastSequence = audit.lastSequence
    } else {
      auditIssues.push('OperatorClickAuditAcknowledgementFailed')
    }
  }
  result.unexpectedInputEvents = auditIssues.length
  errors.push(...auditIssues)

  const classification = classifyOperatorInteraction(result)
  if (!classification.passed) {
    await input.page.screenshot({
      path: path.join(
        input.evidenceDir,
        `operator-interaction-failure-${sanitizeFileSegment(input.phase)}-${classification.classification}.png`,
      ),
      fullPage: true,
    }).catch(() => undefined)
    await input.page.keyboard.press('Escape').catch(() => undefined)
  }

  input.results.push({
    phase: input.phase,
    durationMs: performance.now() - startedAt,
    openActionDurationMs: result.openActionDurationMs,
    closeActionDurationMs: result.closeActionDurationMs,
    openExternalActionDurationMs: result.openExternalActionDurationMs,
    closeExternalActionDurationMs: result.closeExternalActionDurationMs,
    openClickDeliveryDurationMs: result.openClickDeliveryDurationMs,
    closeClickDeliveryDurationMs: result.closeClickDeliveryDurationMs,
    openStateWaitDurationMs: result.openStateWaitDurationMs,
    closeStateWaitDurationMs: result.closeStateWaitDurationMs,
    openTargetStabilityWaitMs: result.openTargetStabilityWaitMs,
    closeTargetStabilityWaitMs: result.closeTargetStabilityWaitMs,
    ...classification,
    preflight,
    closePreflight,
    browserEvents: {
      openClickCompleted: result.openClickCompleted,
      openClickReceived: result.openClickReceived,
      closeClickCompleted: result.closeClickCompleted,
      closeClickReceived: result.closeClickReceived,
    },
    uiState: {
      workspaceOpened: result.workspaceOpened,
      workspaceClosed: result.workspaceClosed,
    },
    mainIpc,
    errorClasses: errors,
    clickAudit: {
      interSampleEvents: audit.interSampleEvents,
      interactionEvents: audit.interactionEvents,
      missingEventCount: audit.missingEventCount,
      lastSequence: audit.lastSequence,
      sequenceRegressed: audit.sequenceRegressed,
      issues: auditIssues,
    },
  })
}

/** Installs a bounded renderer-side audit of trusted click targets for soak diagnosis. */
async function installOperatorClickAudit(page) {
  await page.evaluate(() => {
    window.__SARTRACKER_OPERATOR_CLICK_AUDIT__ = {
      events: [],
      lastSequence: 0,
      acknowledgedSequence: 0,
      droppedEventCount: 0,
    }
    document.addEventListener(
      'click',
      (event) => {
        const audit = window.__SARTRACKER_OPERATOR_CLICK_AUDIT__
        if (audit === undefined) {
          return
        }
        const pathTestIds = event.composedPath().flatMap((entry) =>
          entry instanceof HTMLElement && entry.dataset.testid !== undefined
            ? [entry.dataset.testid]
            : [],
        )
        audit.lastSequence += 1
        audit.events.push({
          sequence: audit.lastSequence,
          atMs: performance.now(),
          trusted: event.isTrusted,
          detail: event.detail,
          clientX: event.clientX,
          clientY: event.clientY,
          pathTestIds,
        })
        if (audit.events.length > 256) {
          audit.events.shift()
          audit.droppedEventCount += 1
        }
      },
      true,
    )
  })
}

/** Reads the bounded renderer-side trusted-click audit. */
async function readOperatorClickAudit(page) {
  return page.evaluate(
    () =>
      window.__SARTRACKER_OPERATOR_CLICK_AUDIT__ ?? {
        events: [],
        lastSequence: 0,
        acknowledgedSequence: 0,
        droppedEventCount: 0,
      },
  )
}

/** Atomically prunes only an already-validated audit prefix. */
async function acknowledgeOperatorClickAudit(page, sequence) {
  return page.evaluate((expectedSequence) => {
    const audit = window.__SARTRACKER_OPERATOR_CLICK_AUDIT__
    if (
      audit === undefined ||
      audit.lastSequence !== expectedSequence ||
      audit.droppedEventCount !== 0 ||
      audit.events.some((event) => event.sequence > expectedSequence)
    ) {
      return false
    }
    audit.events = audit.events.filter(
      (event) => event.sequence > expectedSequence,
    )
    audit.acknowledgedSequence = expectedSequence
    return true
  }, sequence)
}

/** Applies the one ownership boundary to every non-measured harness click. */
function performLaunchOwnedHarnessClick(
  launch,
  expectedTestId,
  click,
  observeAfterClick,
) {
  return performOwnedHarnessClick({
    auditState: launch.operatorClickAuditState,
    expectedTestId,
    readAudit: () => readOperatorClickAudit(launch.page),
    acknowledgeAudit: (sequence) =>
      acknowledgeOperatorClickAudit(launch.page, sequence),
    click,
    observeAfterClick,
  })
}

/** Returns stable error classes for missing, late, extra, or untrusted input evidence. */
function inspectOperatorClickAudit(audit, expectedInteractionTestIds) {
  const issues = []
  if (audit.missingEventCount > 0) {
    issues.push('OperatorClickAuditSequenceGap')
  }
  if (audit.sequenceRegressed) {
    issues.push('OperatorClickAuditSequenceRegression')
  }
  if (audit.interSampleEvents.length > 0) {
    issues.push('UnexpectedInterSampleClick')
  }
  if (
    [...audit.interSampleEvents, ...audit.interactionEvents].some(
      (event) => event.trusted !== true,
    )
  ) {
    issues.push('UntrustedOperatorClick')
  }

  const observedInteractionTestIds = audit.interactionEvents.map(
    (event) => event.pathTestIds?.[0] ?? null,
  )
  if (
    observedInteractionTestIds.length !== expectedInteractionTestIds.length ||
    observedInteractionTestIds.some(
      (testId, index) => testId !== expectedInteractionTestIds[index],
    )
  ) {
    issues.push('UnexpectedOperatorClickSequence')
  }
  return issues
}

/** Inspects the real hit-test target at the centre of an operator control. */
async function inspectPointerTarget(page, testId) {
  return page.evaluate((expectedTestId) => {
    const target = document.querySelector(`[data-testid="${expectedTestId}"]`)
    if (!(target instanceof HTMLElement)) {
      return {
        documentFocused: document.hasFocus(),
        targetFound: false,
        targetReceivesPointer: false,
        hitElement: null,
        centerPoint: null,
      }
    }
    const rect = target.getBoundingClientRect()
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
    const documentFocused = document.hasFocus()
    return {
      documentFocused,
      targetFound: true,
      targetReceivesPointer:
        documentFocused &&
        (hit === target || (hit !== null && target.contains(hit))),
      centerPoint: {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      },
      hitElement:
        hit instanceof HTMLElement
          ? {
              tag: hit.tagName.toLowerCase(),
              testId: hit.dataset.testid ?? null,
              id: hit.id || null,
            }
          : null,
    }
  }, testId)
}

/** Brings the packaged document to the foreground before timing pointer input. */
async function focusPackagedPage(page, timeout) {
  await page.bringToFront()
  return page
    .waitForFunction(() => document.hasFocus(), undefined, {
      polling: 16,
      timeout,
    })
    .then(() => true)
    .catch(() => false)
}

/**
 * Installs a trusted-click-to-DOM-state timer inside the renderer.
 *
 * This measures application reaction time without Playwright/CDP transport
 * latency while the external locator assertions still prove final state.
 */
async function installClickRecorder(page, testId, stateTestId, desiredState) {
  await page.evaluate(({ expectedTestId, expectedStateTestId, expectedState }) => {
    window.__SARTRACKER_OPERATOR_CLICK_PROBE_CLEANUP__?.()
    window.__SARTRACKER_OPERATOR_CLICK_PROBE__ = {
      expectedTestId,
      received: false,
      trusted: false,
      clickReceivedAtMs: null,
      stateReachedAtMs: null,
    }
    const stateReached = () => {
      const element = document.querySelector(
        `[data-testid="${expectedStateTestId}"]`,
      )
      const visible =
        element instanceof HTMLElement &&
        element.getClientRects().length > 0 &&
        window.getComputedStyle(element).display !== 'none' &&
        window.getComputedStyle(element).visibility !== 'hidden'
      if (expectedState === 'hidden') {
        return !visible
      }
      if (expectedState === 'visible') {
        return visible
      }
      if (!visible || !(element instanceof HTMLElement)) {
        return false
      }
      const rect = element.getBoundingClientRect()
      const centerX = rect.left + rect.width / 2
      const centerY = rect.top + rect.height / 2
      const centreIsInViewport =
        rect.width > 0 &&
        rect.height > 0 &&
        centerX >= 0 &&
        centerX < window.innerWidth &&
        centerY >= 0 &&
        centerY < window.innerHeight
      if (!centreIsInViewport) {
        return false
      }
      const hit = document.elementFromPoint(centerX, centerY)
      return hit === element || (hit !== null && element.contains(hit))
    }
    let frameId
    let listener
    const cleanup = () => {
      if (frameId !== undefined) {
        window.cancelAnimationFrame(frameId)
      }
      if (listener !== undefined) {
        document.removeEventListener('click', listener, true)
      }
    }
    window.__SARTRACKER_OPERATOR_CLICK_PROBE_CLEANUP__ = cleanup
    const recordStateIfReached = () => {
      const probe = window.__SARTRACKER_OPERATOR_CLICK_PROBE__
      if (
        probe?.clickReceivedAtMs === null ||
        probe?.clickReceivedAtMs === undefined ||
        probe.stateReachedAtMs !== null ||
        !stateReached()
      ) {
        if (
          probe?.clickReceivedAtMs !== null &&
          probe?.clickReceivedAtMs !== undefined
        ) {
          frameId = window.requestAnimationFrame(recordStateIfReached)
        }
        return
      }
      probe.stateReachedAtMs = performance.now()
      cleanup()
    }
    listener = (event) => {
      const path = event.composedPath()
      const received = path.some(
        (entry) =>
          entry instanceof HTMLElement && entry.dataset.testid === expectedTestId,
      )
      if (received) {
        window.__SARTRACKER_OPERATOR_CLICK_PROBE__ = {
          expectedTestId,
          received: true,
          trusted: event.isTrusted,
          clickReceivedAtMs: performance.now(),
          stateReachedAtMs: null,
        }
        document.removeEventListener('click', listener, true)
        frameId = window.requestAnimationFrame(recordStateIfReached)
      }
    }
    document.addEventListener('click', listener, true)
  }, {
    expectedTestId: testId,
    expectedStateTestId: stateTestId,
    expectedState: desiredState,
  })
}

/** Reads trusted delivery and the renderer-internal click-to-state duration. */
async function readClickRecorder(page) {
  return page.evaluate(() => {
    const probe = window.__SARTRACKER_OPERATOR_CLICK_PROBE__
    const actionDurationMs =
      Number.isFinite(probe?.clickReceivedAtMs) &&
      Number.isFinite(probe?.stateReachedAtMs)
        ? Math.max(0, probe.stateReachedAtMs - probe.clickReceivedAtMs)
        : null
    const result = {
      received: probe?.received === true && probe?.trusted === true,
      actionDurationMs,
    }
    window.__SARTRACKER_OPERATOR_CLICK_PROBE_CLEANUP__?.()
    delete window.__SARTRACKER_OPERATOR_CLICK_PROBE_CLEANUP__
    return result
  })
}

/** Probes the real renderer-to-main mission-store IPC with an in-renderer timeout. */
async function probeMainProcessIpc(page, timeoutMs) {
  return page.evaluate(async (timeout) => {
    const info = window.sartrackerElectron?.missionStore.info
    if (typeof info !== 'function') {
      return { status: 'error', durationMs: 0, errorClass: 'BridgeUnavailable' }
    }
    const startedAt = performance.now()
    let timeoutId
    const timeoutResult = new Promise((resolve) => {
      timeoutId = window.setTimeout(
        () => resolve({ status: 'timeout', errorClass: null }),
        timeout,
      )
    })
    const ipcResult = Promise.resolve()
      .then(() => info())
      .then(
        () => ({ status: 'ok', errorClass: null }),
        (error) => ({
          status: 'error',
          errorClass: error instanceof Error ? error.name : 'UnknownError',
        }),
      )
    const result = await Promise.race([ipcResult, timeoutResult])
    window.clearTimeout(timeoutId)
    return {
      ...result,
      durationMs: performance.now() - startedAt,
    }
  }, timeoutMs)
}

/**
 * Requires a target state to remain true throughout a short observation window.
 *
 * Immediate unmount is insufficient for the close gate: a delayed duplicate
 * input can reopen the workspace after the first hidden assertion passes.
 */
async function waitForPointerTargetStateStable(
  page,
  testId,
  state,
  stabilityMs,
  timeoutMs,
) {
  if (state !== 'hidden') {
    throw new Error(`Unsupported stable pointer-target state: ${state}.`)
  }
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const remainedHidden = await page.evaluate(
      async ({ expectedTestId, requiredStabilityMs }) => {
        const isHidden = () => {
          const target = document.querySelector(
            `[data-testid="${expectedTestId}"]`,
          )
          if (!(target instanceof HTMLElement)) {
            return true
          }
          const style = window.getComputedStyle(target)
          const rect = target.getBoundingClientRect()
          return (
            style.display === 'none' ||
            style.visibility === 'hidden' ||
            rect.width <= 0 ||
            rect.height <= 0
          )
        }
        if (!isHidden()) {
          return false
        }
        const startedAt = performance.now()
        return new Promise((resolve) => {
          const observeFrame = (frameTime) => {
            if (!isHidden()) {
              resolve(false)
              return
            }
            if (frameTime - startedAt >= requiredStabilityMs) {
              resolve(true)
              return
            }
            window.requestAnimationFrame(observeFrame)
          }
          window.requestAnimationFrame(observeFrame)
        })
      },
      {
        expectedTestId: testId,
        requiredStabilityMs: stabilityMs,
      },
    ).catch(() => false)
    if (remainedHidden) {
      return true
    }
    await delay(16)
  }
  return false
}

/**
 * Observes renderer-recorded state completion from the external controller.
 *
 * The renderer timestamp is the internal clock. Waiting for that timestamp
 * here adds browser-command delivery and CDP acknowledgement without folding
 * Playwright locator polling into operator latency. A separate DOM/hit-test
 * assertion still verifies the final visible state before the interaction can
 * pass.
 */
async function waitForRecordedActionState(page, timeout) {
  return page
    .waitForFunction(
      () => Number.isFinite(
        window.__SARTRACKER_OPERATOR_CLICK_PROBE__?.stateReachedAtMs,
      ),
      undefined,
      { polling: 16, timeout },
    )
    .then(() => true)
    .catch(() => false)
}

/** Waits until a target's centre can receive a real pointer event. */
async function waitForPointerTargetActionable(page, testId, timeout) {
  return page
    .waitForFunction(
      (expectedTestId) => {
        const target = document.querySelector(`[data-testid="${expectedTestId}"]`)
        if (!(target instanceof HTMLElement)) {
          return false
        }
        const rect = target.getBoundingClientRect()
        const centerX = rect.left + rect.width / 2
        const centerY = rect.top + rect.height / 2
        if (
          rect.width <= 0 ||
          rect.height <= 0 ||
          centerX < 0 ||
          centerX >= window.innerWidth ||
          centerY < 0 ||
          centerY >= window.innerHeight
        ) {
          return false
        }
        const hit = document.elementFromPoint(centerX, centerY)
        return hit === target || (hit !== null && target.contains(hit))
      },
      testId,
      { polling: 'raf', timeout },
    )
    .then(() => true)
    .catch(() => false)
}

/** Returns only an error class so evidence cannot leak operational text. */
function safeErrorClass(error) {
  return error instanceof Error ? error.name : 'UnknownError'
}

/**
 * Waits for mission startup at the packaged persistence boundary.
 *
 * GitHub's Xvfb renderer can blocklist WebGL, so this storage soak must not
 * conflate responsive map/sidebar composition with mission-store readiness.
 * The soak subsequently proves renderer tracking snapshots, packaged IPC,
 * SQLite growth, and autosave. Browser E2E and the separate packaged launch
 * smoke retain the visual assertions.
 */
async function waitForActiveMission(page, timeoutMs) {
  await page.waitForFunction(
    async () => (await window.sartrackerElectron?.missionStore.getActiveMission()) !== null,
    undefined,
    { timeout: timeoutMs },
  )
}

async function resumeRecoveredMission(launch, expectedMissionId) {
  await launch.page.getByTestId('mission-recovery-dialog').waitFor({ state: 'attached', timeout: 60_000 })
  await performLaunchOwnedHarnessClick(
    launch,
    'mission-recovery-dialog',
    () => launch.page.getByRole('button', { name: 'Resume' }).click({ force: true }),
  )
  await waitForActiveMission(launch.page, 30_000)
  const missionId = await readActiveMissionId(launch.page)
  if (missionId !== expectedMissionId) {
    throw new Error(`Restart recovered mission ${missionId}, expected ${expectedMissionId}.`)
  }
}

async function readActiveMissionId(page) {
  return page.evaluate(async () => {
    const mission = await window.sartrackerElectron?.missionStore.getActiveMission()
    if (mission === null || mission === undefined) {
      throw new Error('Packaged runtime has no active mission.')
    }
    return mission.id
  })
}

async function waitForCheckpoint(input) {
  input.progress.phase = 'tracking'
  input.progress.direction = null
  input.progress.pageIndexFromLatest = null
  input.progress.launchNumber = input.launch.number
  input.progress.targetBatch = input.targetBatch
  const deadline = Date.now() + input.timeoutMs
  while (Date.now() < deadline) {
    input.sleepGuard.assertHealthy()
    assertRendererTargetHealthy(input.launch)
    assertProcessAlive(input.launch.appProcess, 'tracking checkpoint')
    if (input.launch.rendererCrashes > 0) {
      throw new Error(`Electron renderer crashed during tracking checkpoint ${input.targetBatch}.`)
    }
    const mockState = input.mockServer.snapshot()
    input.progress.currentBatch = mockState.completedBatches
    await sampleProcessMemory(input.launch, {
      phase: 'checkpoint-drain',
      targetBatch: input.targetBatch,
      completedBatch: mockState.completedBatches,
    })
    const positionRows = await input.launch.page.evaluate(
      async ({ missionId }) =>
        window.sartrackerElectron?.missionStore.countPositions(missionId) ?? 0,
      { missionId: input.missionId },
    )
    if (mockState.completedBatches >= input.targetBatch && positionRows >= input.expectedPositions) {
      return
    }
    await delay(50)
  }
  throw new Error(
    `Timed out at batch ${input.targetBatch}; mock=${input.mockServer.snapshot().completedBatches}.`,
  )
}

/** Fails closed when the measured renderer/CDP target changes or reloads. */
function assertRendererTargetHealthy(launch) {
  const lifecycle = launch.rendererLifecycle.snapshot()
  if (
    lifecycle.pageCloseCount > 0 ||
    lifecycle.pageCrashCount > 0 ||
    lifecycle.browserDisconnectCount > 0 ||
    lifecycle.replacementPageCount > 0 ||
    lifecycle.mainFrameNavigationCount > 0
  ) {
    const error = new Error(
      'Packaged renderer target changed during tracking soak.',
    )
    error.trackingSoakLifecycleFailure = {
      failureClass: 'browser_target_closed',
    }
    throw error
  }
}

/** Pauses the packaged mission and waits until the persisted state agrees. */
async function ensureMissionPaused(launch) {
  const mission = await readActiveMission(launch.page)
  if (mission.status !== 'paused') {
    await performLaunchOwnedHarnessClick(
      launch,
      'mission-pause-resume-btn',
      () => launch.page.getByTestId('mission-pause-resume-btn').click({ force: true }),
    )
  }
  await launch.page.getByTestId('mission-paused-banner').waitFor({
    state: 'visible',
    timeout: 30_000,
  })
  await launch.page.waitForFunction(
    async () =>
      (await window.sartrackerElectron?.missionStore.getActiveMission())?.status ===
      'paused',
    undefined,
    { timeout: 30_000 },
  )
}

/** Resumes the packaged mission only after the paused restart audit is complete. */
async function ensureMissionActive(launch) {
  const mission = await readActiveMission(launch.page)
  if (mission.status === 'paused') {
    await performLaunchOwnedHarnessClick(
      launch,
      'mission-pause-resume-btn',
      () => launch.page.getByTestId('mission-pause-resume-btn').click({ force: true }),
    )
  }
  await launch.page.getByTestId('mission-paused-banner').waitFor({
    state: 'hidden',
    timeout: 30_000,
  })
  await launch.page.waitForFunction(
    async () =>
      (await window.sartrackerElectron?.missionStore.getActiveMission())?.status ===
      'active',
    undefined,
    { timeout: 30_000 },
  )
}

/** Reads the active mission or fails before changing its lifecycle state. */
async function readActiveMission(page) {
  return page.evaluate(async () => {
    const mission = await window.sartrackerElectron?.missionStore.getActiveMission()
    if (mission === null || mission === undefined) {
      throw new Error('Packaged runtime has no active mission for exact-dot audit.')
    }
    return mission
  })
}

/** Proves the mock cannot advance while a paused exact checkpoint is audited. */
function assertMockPausedAtCheckpoint(mockServer, expectedBatch) {
  const state = mockServer.snapshot()
  if (state.paused !== true || state.completedBatches !== expectedBatch) {
    throw new Error('Synthetic Traccar source advanced outside exact checkpoint.')
  }
}

/** Audits the exact latest page against formula truth at one paused checkpoint. */
async function auditLatestExactDotPage(input) {
  const oracle = createIndependentExactSoakOracle({
    ...input.profile,
    baseTimeMs: input.fixtureClock.baseTimeMs,
    intervalMs: input.fixtureClock.intervalMs,
    maximumBatches: input.maximumBatches,
    pageLimit: 10_000,
  })
  const memorySampler = startExactAuditMemorySampler(input.launch)
  let query
  let source
  let exactDotPageDurationMs
  let timing
  let rss
  try {
    const expectedPage = prepareExpectedExactSoakSourcePage(oracle, 0)
    const initialPage = await openExactDotWorkspace(
      input.launch,
      () => waitForExactSoakSourcePage({
        page: input.launch.page,
        launch: input.launch,
        pageIndexFromLatest: 0,
        expectedPageEvidence: expectedPage.pageEvidence,
        expectedTotalFixCount: expectedPage.totalFixCount,
        timeoutMs: Math.min(input.timeoutMs, EXACT_PAGE_ACTION_TIMEOUT_MS),
        sleepGuard: input.sleepGuard,
      }),
    )
    const pageStartedAtEpochMs = initialPage.clickStartedAtEpochMs
    source = initialPage.observation
    timing = createExactSoakPageTiming({
      pageStartedAtEpochMs,
      sourceReadStartedAtEpochMs: source.sourceReadStartedAtEpochMs,
      firstFormulaExactSampledAtEpochMs:
        source.firstFormulaExactSampledAtEpochMs,
      stableVerificationDurationMs: source.stableVerificationDurationMs,
    })
    exactDotPageDurationMs = timing.pageActionDurationMs
    input.progress.completedUiPageObservations += 1
    input.progress.timing = { ...timing }
    query = await queryExactDotPage(input.launch.page, {
      missionId: input.missionId,
      direction: 'latest',
      cursor: null,
    })
    input.progress.completedDirectIpcQueries += 1
    const queryRows = normalizeExactSoakStoredPage(query.result.positions)
    const queryEvidence = auditIndependentExactSoakPage(oracle, 0, queryRows)
    assertExactSoakPageEnvelope(query.result, oracle, queryEvidence, 0)
    assertExactSoakPageEvidenceMatch(queryEvidence, source.pageEvidence)
    assertExactPageActionTimings(
      query.durationMs,
      timing.publicationDurationMs,
      exactDotPageDurationMs,
    )
    assertExactStableVerificationTiming(timing.stableVerificationDurationMs)
  } finally {
    rss = await memorySampler.stop()
    await closeExactDotWorkspace(input.launch)
  }
  return {
    passed: true,
    launchNumber: input.launch.number,
    maximumBatches: input.maximumBatches,
    totalPositionCount: oracle.totalFixCount,
    pageCount: oracle.pageCount,
    latestPage: source.pageEvidence,
    baselineBreadcrumbPointCount: source.baselineBreadcrumbPointCount,
    exactDotQueryDurationMs: query.durationMs,
    exactDotPublicationDurationMs: timing.publicationDurationMs,
    exactDotPageDurationMs,
    exactDotStableVerificationDurationMs:
      timing.stableVerificationDurationMs,
    exactDotFingerprintDurationMs: source.fingerprintDurationMs,
    exactDotProofOverheadDurationMs: timing.proofOverheadDurationMs,
    rss,
  }
}

/** Requires the identical exact latest page on both sides of one restart. */
function assertLatestExactDotParity(beforeRestart, afterRestart) {
  if (
    beforeRestart?.passed !== true ||
    afterRestart?.passed !== true ||
    beforeRestart.totalPositionCount !== afterRestart.totalPositionCount ||
    beforeRestart.pageCount !== afterRestart.pageCount ||
    beforeRestart.baselineBreadcrumbPointCount !== 0 ||
    afterRestart.baselineBreadcrumbPointCount !== 0 ||
    beforeRestart.latestPage.positionCount !==
      afterRestart.latestPage.positionCount ||
    beforeRestart.latestPage.sha256 !== afterRestart.latestPage.sha256 ||
    JSON.stringify(beforeRestart.latestPage.range) !==
      JSON.stringify(afterRestart.latestPage.range)
  ) {
    throw new Error('Exact breadcrumb latest-page parity changed across restart.')
  }
}

/**
 * Traverses all 194 exact pages in both directions against formula truth while
 * retaining only bounded page digests/ranges and latency aggregates.
 */
async function auditFinalExactDotTraversal(input) {
  const oracle = createIndependentExactSoakOracle({
    ...input.profile,
    baseTimeMs: input.fixtureClock.baseTimeMs,
    intervalMs: input.fixtureClock.intervalMs,
    maximumBatches: input.profile.actualBatches,
    pageLimit: 10_000,
  })
  const accumulator = createExactSoakPageEvidenceAccumulator(oracle)
  const exactDotPublicationDurationMs = []
  const exactDotPageDurationMs = []
  const exactDotStableVerificationDurationMs = []
  const exactDotFingerprintDurationMs = []
  const exactDotProofOverheadDurationMs = []
  let baselineBreadcrumbPointCount = 0
  let earlierDisabledAtOldest = false
  let laterDisabledAtLatest = false
  let returnedToLatest = false
  let proof = null
  let exactAuditMemory = null
  let outwardTraversalDurationMs = 0
  let laterTraversalDurationMs = 0
  const proofWallStartedAt = performance.now()
  const memorySampler = startExactAuditMemorySampler(input.launch)
  try {
    const expectedLatestPage = prepareExpectedExactSoakSourcePage(oracle, 0)
    const initialPage = await openExactDotWorkspace(
      input.launch,
      () => waitForExactSoakSourcePage({
        page: input.launch.page,
        launch: input.launch,
        pageIndexFromLatest: 0,
        expectedPageEvidence: expectedLatestPage.pageEvidence,
        expectedTotalFixCount: expectedLatestPage.totalFixCount,
        timeoutMs: Math.min(input.timeoutMs, EXACT_PAGE_ACTION_TIMEOUT_MS),
        sleepGuard: input.sleepGuard,
      }),
    )
    const latestPageStartedAtEpochMs = initialPage.clickStartedAtEpochMs
    for (
      let pageIndexFromLatest = 0;
      pageIndexFromLatest < oracle.pageCount;
      pageIndexFromLatest += 1
    ) {
      let pageStartedAtEpochMs = pageIndexFromLatest === 0
        ? latestPageStartedAtEpochMs
        : null
      input.progress.phase = 'outward'
      input.progress.direction = pageIndexFromLatest === 0 ? 'latest' : 'earlier'
      input.progress.pageIndexFromLatest = pageIndexFromLatest
      let source
      if (pageIndexFromLatest > 0) {
        const expectedPage = prepareExpectedExactSoakSourcePage(
          oracle,
          pageIndexFromLatest,
        )
        const ownedClick = await performLaunchOwnedHarnessClick(
          input.launch,
          'exact-breadcrumb-dots-earlier',
          () => clickExactDotPageControl({
            page: input.launch.page,
            testId: 'exact-breadcrumb-dots-earlier',
            pageIndexFromLatest,
            timeoutMs: EXACT_PAGE_ACTION_TIMEOUT_MS,
          }),
          () => waitForExactSoakSourcePage({
            page: input.launch.page,
            launch: input.launch,
            pageIndexFromLatest,
            expectedPageEvidence: expectedPage.pageEvidence,
            expectedTotalFixCount: expectedPage.totalFixCount,
            timeoutMs: Math.min(input.timeoutMs, EXACT_PAGE_ACTION_TIMEOUT_MS),
            sleepGuard: input.sleepGuard,
          }),
        )
        pageStartedAtEpochMs = ownedClick.clickStartedAtEpochMs
        source = ownedClick.observation
      } else {
        source = initialPage.observation
      }
      const timing = createExactSoakPageTiming({
        pageStartedAtEpochMs,
        sourceReadStartedAtEpochMs: source.sourceReadStartedAtEpochMs,
        firstFormulaExactSampledAtEpochMs:
          source.firstFormulaExactSampledAtEpochMs,
        stableVerificationDurationMs: source.stableVerificationDurationMs,
      })
      accumulator.addPageEvidence(pageIndexFromLatest, source.pageEvidence)
      baselineBreadcrumbPointCount += source.baselineBreadcrumbPointCount
      exactDotPublicationDurationMs.push(timing.publicationDurationMs)
      exactDotPageDurationMs.push(timing.pageActionDurationMs)
      exactDotStableVerificationDurationMs.push(
        timing.stableVerificationDurationMs,
      )
      exactDotFingerprintDurationMs.push(source.fingerprintDurationMs)
      exactDotProofOverheadDurationMs.push(timing.proofOverheadDurationMs)
      assertExactUiPageActionTimings(
        timing.publicationDurationMs,
        timing.pageActionDurationMs,
      )
      assertExactStableVerificationTiming(timing.stableVerificationDurationMs)
      outwardTraversalDurationMs += timing.pageActionDurationMs
      input.progress.completedUiPageObservations += 1
      input.progress.timing = {
        ...timing,
        outwardTraversalDurationMs,
      }
    }
    earlierDisabledAtOldest = await readExactDotPageControlDisabled({
      page: input.launch.page,
      testId: 'exact-breadcrumb-dots-earlier',
      timeoutMs: EXACT_PAGE_ACTION_TIMEOUT_MS,
    })
    if (!earlierDisabledAtOldest) {
      throw new Error('Exact breadcrumb Earlier remained enabled at oldest page.')
    }
    if (outwardTraversalDurationMs > 60_000) {
      throw createExactSoakGateFailure(
        'outward_traversal_limit',
        'Exact outward traversal exceeded 60 seconds.',
      )
    }

    for (
      let pageIndexFromLatest = oracle.pageCount - 2;
      pageIndexFromLatest >= 0;
      pageIndexFromLatest -= 1
    ) {
      input.progress.phase = 'later'
      input.progress.direction = 'later'
      input.progress.pageIndexFromLatest = pageIndexFromLatest
      const expectedPage = prepareExpectedExactSoakSourcePage(
        oracle,
        pageIndexFromLatest,
      )
      const ownedClick = await performLaunchOwnedHarnessClick(
        input.launch,
        'exact-breadcrumb-dots-later',
        () => clickExactDotPageControl({
          page: input.launch.page,
          testId: 'exact-breadcrumb-dots-later',
          pageIndexFromLatest,
          timeoutMs: EXACT_PAGE_ACTION_TIMEOUT_MS,
        }),
        () => waitForExactSoakSourcePage({
          page: input.launch.page,
          launch: input.launch,
          pageIndexFromLatest,
          expectedPageEvidence: expectedPage.pageEvidence,
          expectedTotalFixCount: expectedPage.totalFixCount,
          timeoutMs: Math.min(input.timeoutMs, EXACT_PAGE_ACTION_TIMEOUT_MS),
          sleepGuard: input.sleepGuard,
        }),
      )
      const pageStartedAtEpochMs = ownedClick.clickStartedAtEpochMs
      const source = ownedClick.observation
      const timing = createExactSoakPageTiming({
        pageStartedAtEpochMs,
        sourceReadStartedAtEpochMs: source.sourceReadStartedAtEpochMs,
        firstFormulaExactSampledAtEpochMs:
          source.firstFormulaExactSampledAtEpochMs,
        stableVerificationDurationMs: source.stableVerificationDurationMs,
      })
      baselineBreadcrumbPointCount += source.baselineBreadcrumbPointCount
      exactDotPublicationDurationMs.push(timing.publicationDurationMs)
      exactDotPageDurationMs.push(timing.pageActionDurationMs)
      exactDotStableVerificationDurationMs.push(
        timing.stableVerificationDurationMs,
      )
      exactDotFingerprintDurationMs.push(source.fingerprintDurationMs)
      exactDotProofOverheadDurationMs.push(timing.proofOverheadDurationMs)
      assertExactUiPageActionTimings(
        timing.publicationDurationMs,
        timing.pageActionDurationMs,
      )
      assertExactStableVerificationTiming(timing.stableVerificationDurationMs)
      laterTraversalDurationMs += timing.pageActionDurationMs
      input.progress.completedUiPageObservations += 1
      input.progress.timing = {
        ...timing,
        outwardTraversalDurationMs,
        laterTraversalDurationMs,
      }
    }
    laterDisabledAtLatest = await readExactDotPageControlDisabled({
      page: input.launch.page,
      testId: 'exact-breadcrumb-dots-later',
      timeoutMs: EXACT_PAGE_ACTION_TIMEOUT_MS,
    })
    if (laterTraversalDurationMs > 120_000) {
      throw createExactSoakGateFailure(
        'later_traversal_limit',
        'Exact Later traversal exceeded 120 seconds.',
      )
    }
    returnedToLatest = laterDisabledAtLatest
    if (
      !laterDisabledAtLatest ||
      baselineBreadcrumbPointCount !== 0
    ) {
      throw new Error(
        'Exact breadcrumb traversal did not return to latest or baseline contained breadcrumb Points.',
      )
    }
    const traversal = accumulator.finish()
    proof = {
      finalTraversal: traversal,
      returnedToLatest,
      earlierDisabledAtOldest,
      laterDisabledAtLatest,
      baselineBreadcrumbPointCount,
      outwardTraversalDurationMs,
      laterTraversalDurationMs,
      metricSamples: {
        exactDotPublicationDurationMs,
        exactDotPageDurationMs,
        exactDotStableVerificationDurationMs,
        exactDotFingerprintDurationMs,
        exactDotProofOverheadDurationMs,
      },
      proofWallDurationMs: performance.now() - proofWallStartedAt,
    }
  } finally {
    exactAuditMemory = await memorySampler.stop()
    await closeExactDotWorkspace(input.launch)
  }
  if (
    proof === null ||
    exactAuditMemory.sampleCount < 1 ||
    exactAuditMemory.maximumProcessTreeResidentBytes < 1
  ) {
    throw new Error('Exact breadcrumb traversal has no 250ms RSS evidence.')
  }
  return {
    issue: 'DON-260',
    ...proof,
    rss: exactAuditMemory,
  }
}

/** Builds the frozen 393-observation exact proof from bounded audit evidence. */
function finalizeExactDotProof(input) {
  const directIpcLatestAudits = [
    ...input.restartAudits.flatMap((audit) => [
      {
        boundary: `checkpoint-${audit.checkpoint}-before-restart`,
        ...audit.beforeRestart,
      },
      {
        boundary: `checkpoint-${audit.checkpoint}-after-restart`,
        ...audit.afterRestart,
      },
    ]),
    {
      boundary: 'final-before-traversal',
      ...input.finalLatestAudits[0],
    },
    {
      boundary: 'final-after-traversal',
      ...input.finalLatestAudits[1],
    },
  ]
  const exactDotDirectIpcQueryDurationMs = directIpcLatestAudits.map(
    (audit) => audit.exactDotQueryDurationMs,
  )
  const exactDotPublicationDurationMs = [
    ...input.traversalProof.metricSamples.exactDotPublicationDurationMs,
    ...directIpcLatestAudits.map(
      (audit) => audit.exactDotPublicationDurationMs,
    ),
  ]
  const exactDotPageDurationMs = [
    ...input.traversalProof.metricSamples.exactDotPageDurationMs,
    ...directIpcLatestAudits.map((audit) => audit.exactDotPageDurationMs),
  ]
  const exactDotStableVerificationDurationMs = [
    ...input.traversalProof.metricSamples
      .exactDotStableVerificationDurationMs,
    ...directIpcLatestAudits.map(
      (audit) => audit.exactDotStableVerificationDurationMs,
    ),
  ]
  const exactDotFingerprintDurationMs = [
    ...input.traversalProof.metricSamples.exactDotFingerprintDurationMs,
    ...directIpcLatestAudits.map(
      (audit) => audit.exactDotFingerprintDurationMs,
    ),
  ]
  const exactDotProofOverheadDurationMs = [
    ...input.traversalProof.metricSamples.exactDotProofOverheadDurationMs,
    ...directIpcLatestAudits.map(
      (audit) => audit.exactDotProofOverheadDurationMs,
    ),
  ]
  const expectedUiObservationCount =
    input.traversalProof.finalTraversal.pageCount * 2 - 1 +
    directIpcLatestAudits.length
  const expectedDirectIpcQueryCount = 6
  if (
    directIpcLatestAudits.length !== expectedDirectIpcQueryCount ||
    exactDotDirectIpcQueryDurationMs.length !== expectedDirectIpcQueryCount ||
    exactDotPublicationDurationMs.length !== expectedUiObservationCount ||
    exactDotPageDurationMs.length !== expectedUiObservationCount ||
    exactDotStableVerificationDurationMs.length !== expectedUiObservationCount ||
    exactDotFingerprintDurationMs.length !== expectedUiObservationCount ||
    exactDotProofOverheadDurationMs.length !== expectedUiObservationCount
  ) {
    throw new Error('Exact breadcrumb observation metrics are incomplete.')
  }
  const metrics = {
    exactDotDirectIpcQueryDurationMs: summarizeResponsiveness(
      exactDotDirectIpcQueryDurationMs,
      250,
    ),
    exactDotPublicationDurationMs: summarizeResponsiveness(
      exactDotPublicationDurationMs,
      250,
    ),
    exactDotPageDurationMs: summarizeResponsiveness(
      exactDotPageDurationMs,
      250,
    ),
    exactDotStableVerificationDurationMs: summarizeResponsiveness(
      exactDotStableVerificationDurationMs,
      250,
    ),
    exactDotFingerprintDurationMs: summarizeResponsiveness(
      exactDotFingerprintDurationMs,
      250,
    ),
    exactDotProofOverheadDurationMs: summarizeResponsiveness(
      exactDotProofOverheadDurationMs,
      250,
    ),
    proofWallDurationMs: input.traversalProof.proofWallDurationMs,
    rssSampleIntervalMs: PROCESS_MEMORY_SAMPLE_INTERVAL_MS,
    rss: input.traversalProof.rss,
  }
  if (
    metrics.exactDotDirectIpcQueryDurationMs.p95Ms > 2_000 ||
    metrics.exactDotPublicationDurationMs.p95Ms > 2_000 ||
    metrics.exactDotPageDurationMs.p95Ms > 2_000 ||
    metrics.exactDotStableVerificationDurationMs.maxMs >
      EXACT_PAGE_ACTION_TIMEOUT_MS
  ) {
    throw new Error('Exact breadcrumb page latency p95 exceeded two seconds.')
  }
  return {
    issue: 'DON-260',
    required: true,
    passed: true,
    fixtureClock: input.fixtureClock,
    directIpcLatestAudits,
    restartAudits: input.restartAudits,
    finalTraversal: input.traversalProof.finalTraversal,
    returnedToLatest: input.traversalProof.returnedToLatest,
    earlierDisabledAtOldest:
      input.traversalProof.earlierDisabledAtOldest,
    laterDisabledAtLatest:
      input.traversalProof.laterDisabledAtLatest,
    baselineBreadcrumbPointCount:
      input.traversalProof.baselineBreadcrumbPointCount,
    explicitPageObservationCount: expectedUiObservationCount,
    directIpcQueryCount: expectedDirectIpcQueryCount,
    outwardTraversalDurationMs:
      input.traversalProof.outwardTraversalDurationMs,
    laterTraversalDurationMs:
      input.traversalProof.laterTraversalDurationMs,
    unavailableCount: 0,
    failureCount: 0,
    unexplainedPublicationCount: 0,
    metrics,
  }
}

/** Fails one explicit exact query/publication/action past the 5s hard limit. */
function assertExactPageActionTimings(queryMs, publicationMs, pageMs) {
  if (
    ![queryMs, publicationMs, pageMs].every(
      (durationMs) =>
        Number.isFinite(durationMs) &&
        durationMs >= 0 &&
        durationMs <= EXACT_PAGE_ACTION_TIMEOUT_MS,
    )
  ) {
    throw new Error('Exact breadcrumb page action exceeded five seconds.')
  }
}

/** Fails one UI source publication/action past the 5s hard limit. */
function assertExactUiPageActionTimings(publicationMs, pageMs) {
  if (
    ![publicationMs, pageMs].every(
      (durationMs) =>
        Number.isFinite(durationMs) &&
        durationMs >= 0 &&
        durationMs <= EXACT_PAGE_ACTION_TIMEOUT_MS,
    )
  ) {
    throw new Error('Exact breadcrumb UI page action exceeded five seconds.')
  }
}

/** Requires the second stable proof observation inside the shared 5s bound. */
function assertExactStableVerificationTiming(durationMs) {
  if (
    !Number.isFinite(durationMs) ||
    durationMs < 0 ||
    durationMs > EXACT_PAGE_ACTION_TIMEOUT_MS
  ) {
    throw createExactSoakGateFailure(
      'ui_page_action_limit',
      'Exact breadcrumb stable verification exceeded five seconds.',
    )
  }
}

/** Starts a continuous 250ms process-tree RSS sampler during exact traversal. */
function startExactAuditMemorySampler(launch) {
  let stopped = false
  let sampleCount = 0
  let maximumProcessTreeResidentBytes = 0
  const task = (async () => {
    while (!stopped) {
      const startedAt = performance.now()
      const sampledAtMs = Date.now()
      const memory = await readProcessTreeResidentMemory(launch.appProcess.pid)
      const sample = memory === null
        ? null
        : recordProcessMemorySample(
            launch,
            memory,
            { phase: 'exact-dot-page-audit' },
            sampledAtMs,
          )
      if (sample !== null) {
        sampleCount += 1
        maximumProcessTreeResidentBytes = Math.max(
          maximumProcessTreeResidentBytes,
          sample.totalResidentBytes,
        )
      }
      await delay(Math.max(
        0,
        PROCESS_MEMORY_SAMPLE_INTERVAL_MS - (performance.now() - startedAt),
      ))
    }
  })()
  return {
    stop: async () => {
      stopped = true
      await task
      return {
        launchNumber: launch.number,
        sampleCount,
        sampleIntervalMs: PROCESS_MEMORY_SAMPLE_INTERVAL_MS,
        maximumProcessTreeResidentBytes,
      }
    },
  }
}

/** Opens Devices and selects the source-authoritative exact Dots mode. */
async function openExactDotWorkspace(launch, observeAfterDotsClick) {
  const workspace = launch.page.getByTestId('devices-workspace')
  if (!(await workspace.isVisible())) {
    await performLaunchOwnedHarnessClick(
      launch,
      'open-devices-workspace',
      () => launch.page.getByTestId('open-devices-workspace').click({
        timeout: EXACT_PAGE_ACTION_TIMEOUT_MS,
      }),
    )
    await workspace.waitFor({
      state: 'visible',
      timeout: EXACT_PAGE_ACTION_TIMEOUT_MS,
    })
  }
  const dotsButton = launch.page.getByTestId('breadcrumb-mode-dots')
  const initialPage = await performLaunchOwnedHarnessClick(
    launch,
    'breadcrumb-mode-dots',
    () => dotsButton.click({ timeout: EXACT_PAGE_ACTION_TIMEOUT_MS }),
    observeAfterDotsClick,
  )
  if (await launch.page.getByTestId('exact-breadcrumb-dots-unavailable').isVisible()) {
    throw new Error('Exact breadcrumb Dots mode is unavailable in packaged soak.')
  }
  const dotsButtonClass = await dotsButton.getAttribute('class')
  if (!String(dotsButtonClass).includes('sar-segment-option-active')) {
    throw new Error('Packaged soak could not activate breadcrumb Dots mode.')
  }
  await performLaunchOwnedHarnessClick(
    launch,
    'workspace-close-btn',
    () => launch.page.getByTestId('workspace-close-btn').click({
      timeout: EXACT_PAGE_ACTION_TIMEOUT_MS,
    }),
  )
  await workspace.waitFor({
    state: 'hidden',
    timeout: EXACT_PAGE_ACTION_TIMEOUT_MS,
  })
  return initialPage
}

/** Restores bounded Line mode after a proof-only audit. */
async function closeExactDotWorkspace(launch) {
  await restoreFinalBreadcrumbLineMode(launch)
}

/**
 * Requires the restored Line summary and live SQLite count to equal independent
 * source truth for two consecutive observations after exact proof settles.
 */
async function auditFinalLineTotalParity(input) {
  input.progress.phase = 'line_total'
  input.progress.direction = null
  input.progress.pageIndexFromLatest = null
  input.progress.launchNumber = input.launch.number
  input.sleepGuard.assertHealthy()
  const oracle = createIndependentExactSoakOracle({
    ...input.profile,
    baseTimeMs: input.fixtureClock.baseTimeMs,
    intervalMs: input.fixtureClock.intervalMs,
    maximumBatches: input.profile.actualBatches,
    pageLimit: 10_000,
  })
  const independentSourceTotal = oracle.totalFixCount
  const recentObservations = []
  let matchingObservations = []
  let failureClass = 'stability_timeout'
  try {
    await restoreFinalBreadcrumbLineMode(input.launch)
  } catch (error) {
    if (error?.trackingSoakAuditFailure !== undefined) throw error
    return {
      required: true,
      passed: false,
      lineModeRestored: false,
      stableObservationCount: 0,
      reportedTotalObserved: null,
      sqlitePositionRows: null,
      independentSourceTotal,
      observations: [],
      failureClass: 'line_mode_unavailable',
    }
  }

  const deadline = Date.now() + Math.min(input.timeoutMs, 10_000)
  while (Date.now() < deadline) {
    input.sleepGuard.assertHealthy()
    assertRendererTargetHealthy(input.launch)
    try {
      const observation = await readFinalLineTotalObservation({
        page: input.launch.page,
        missionId: input.missionId,
        independentSourceTotal,
      })
      recentObservations.push(observation)
      if (recentObservations.length > 2) recentObservations.shift()
      if (
        observation.reportedTotalObserved === independentSourceTotal &&
        observation.sqlitePositionRows === independentSourceTotal
      ) {
        matchingObservations.push(observation)
      } else {
        matchingObservations = []
        failureClass = 'total_mismatch'
      }
      if (matchingObservations.length === 2) {
        const observations = matchingObservations.map(
          (entry, index) => ({ ...entry, observationIndex: index + 1 }),
        )
        return {
          required: true,
          passed: true,
          lineModeRestored: true,
          stableObservationCount: 2,
          reportedTotalObserved: observations[1].reportedTotalObserved,
          sqlitePositionRows: observations[1].sqlitePositionRows,
          independentSourceTotal,
          observations,
          failureClass: null,
        }
      }
    } catch {
      matchingObservations = []
      failureClass = 'observation_unavailable'
    }
    await delay(250)
  }
  const observations = recentObservations.map(
    (entry, index) => ({ ...entry, observationIndex: index + 1 }),
  )
  const last = observations.at(-1)
  return {
    required: true,
    passed: false,
    lineModeRestored: true,
    stableObservationCount: matchingObservations.length,
    reportedTotalObserved: last?.reportedTotalObserved ?? null,
    sqlitePositionRows: last?.sqlitePositionRows ?? null,
    independentSourceTotal,
    observations,
    failureClass,
  }
}

/** Selects Line explicitly, verifies its active style, and closes Devices. */
async function restoreFinalBreadcrumbLineMode(launch) {
  const workspace = launch.page.getByTestId('devices-workspace')
  if (!(await workspace.isVisible())) {
    await performLaunchOwnedHarnessClick(
      launch,
      'open-devices-workspace',
      () => launch.page.getByTestId('open-devices-workspace').click({
        timeout: EXACT_PAGE_ACTION_TIMEOUT_MS,
      }),
    )
    await workspace.waitFor({
      state: 'visible',
      timeout: EXACT_PAGE_ACTION_TIMEOUT_MS,
    })
  }
  const lineButton = launch.page.getByTestId('breadcrumb-mode-line')
  await performLaunchOwnedHarnessClick(
    launch,
    'breadcrumb-mode-line',
    () => lineButton.click({ timeout: EXACT_PAGE_ACTION_TIMEOUT_MS }),
  )
  const lineButtonClass = await lineButton.getAttribute('class')
  if (!String(lineButtonClass).includes('sar-segment-option-active')) {
    throw new Error('Packaged soak could not restore breadcrumb Line mode.')
  }
  await performLaunchOwnedHarnessClick(
    launch,
    'workspace-close-btn',
    () => launch.page.getByTestId('workspace-close-btn').click({
      timeout: EXACT_PAGE_ACTION_TIMEOUT_MS,
    }),
  )
  await workspace.waitFor({ state: 'hidden', timeout: EXACT_PAGE_ACTION_TIMEOUT_MS })
}

/** Reads one bounded operator summary and mission-store SQLite count. */
async function readFinalLineTotalObservation(input) {
  const observation = await input.page.evaluate(
    async ({ missionId }) => {
      const missionStore = window.sartrackerElectron?.missionStore
      if (missionStore === undefined) {
        throw new Error('Electron mission-store bridge is unavailable.')
      }
      return {
        statusText: document.querySelector(
          '[data-testid="breadcrumb-display-summary"]',
        )?.textContent ?? '',
        sqlitePositionRows: await missionStore.countPositions(missionId),
      }
    },
    { missionId: input.missionId },
  )
  const match = /of at least ([\d,]+) known fixes across/u.exec(
    String(observation.statusText),
  )
  const reportedTotalObserved = match === null
    ? Number.NaN
    : Number(match[1].replaceAll(',', ''))
  if (
    !Number.isSafeInteger(reportedTotalObserved) ||
    reportedTotalObserved < 0 ||
    !Number.isSafeInteger(observation.sqlitePositionRows) ||
    observation.sqlitePositionRows < 0
  ) {
    throw new Error('Restored Line total observation is unavailable or invalid.')
  }
  return {
    reportedTotalObserved,
    sqlitePositionRows: observation.sqlitePositionRows,
    independentSourceTotal: input.independentSourceTotal,
  }
}

/** Measures one production exact-page IPC query without treating it as truth. */
async function queryExactDotPage(page, input) {
  const startedAt = performance.now()
  const result = await page.evaluate(
    async ({ query, requestId, timeoutMs }) => {
      const listExactBreadcrumbDotPage =
        window.sartrackerElectron?.missionStore.listExactBreadcrumbDotPage
      if (typeof listExactBreadcrumbDotPage !== 'function') {
        throw new Error('Exact breadcrumb page IPC is unavailable.')
      }
      let timeoutHandle
      const timeout = new Promise((_resolve, reject) => {
        timeoutHandle = window.setTimeout(
          () => reject(new Error('Exact breadcrumb page IPC exceeded five seconds.')),
          timeoutMs,
        )
      })
      try {
        return await Promise.race([
          listExactBreadcrumbDotPage(query, requestId),
          timeout,
        ])
      } catch (error) {
        const cancelExactBreadcrumbDotQuery =
          window.sartrackerElectron?.missionStore.cancelExactBreadcrumbDotQuery
        if (typeof cancelExactBreadcrumbDotQuery === 'function') {
          void cancelExactBreadcrumbDotQuery(requestId).catch(() => undefined)
        }
        throw error
      } finally {
        window.clearTimeout(timeoutHandle)
      }
    },
    {
      query: {
        missionId: input.missionId,
        activeDeviceIds: [],
        limit: 10_000,
        cursor: input.cursor,
        direction: input.direction,
      },
      requestId: `tracking-soak-exact-${Date.now()}-${++exactDotRequestSequence}`,
      timeoutMs: EXACT_PAGE_ACTION_TIMEOUT_MS,
    },
  )
  return { result, durationMs: performance.now() - startedAt }
}

/** Prepares independent formula truth before the measured product action starts. */
function prepareExpectedExactSoakSourcePage(oracle, pageIndexFromLatest) {
  return {
    pageEvidence: auditIndependentExactSoakPage(
      oracle,
      pageIndexFromLatest,
      oracle.createPage(pageIndexFromLatest),
    ),
    totalFixCount: oracle.totalFixCount,
  }
}

/** Waits for one stable exact MapLibre source page and a clean baseline source. */
async function waitForExactSoakSourcePage(input) {
  const startedAt = performance.now()
  const sourceReadStartedAtEpochMs = Date.now()
  const deadline = Date.now() + input.timeoutMs
  const expectedPageEvidence = input.expectedPageEvidence
  let firstMismatch = null
  let lastMismatch = null
  let mismatchObservationCount = 0
  let firstCoherent = null
  const recordMismatch = (observation) => {
    const mismatch = createExactSoakMismatchObservation({
      sourceEvidence: observation?.source ?? null,
      operatorEvidence: observation?.operator ?? null,
      baselineBreadcrumbPointCount:
        observation?.baselineBreadcrumbPointCount ?? null,
      loading: observation?.loading === true,
      refreshing:
        typeof observation?.refreshing === 'boolean'
          ? observation.refreshing
          : null,
      unavailable: observation?.unavailable === true,
    })
    firstMismatch ??= mismatch
    lastMismatch = mismatch
    mismatchObservationCount += 1
  }
  while (Date.now() < deadline) {
    input.sleepGuard.assertHealthy()
    assertRendererTargetHealthy(input.launch)
    const first = await Promise.race([
      readExactSoakMapSources(input.page),
      delay(Math.max(0, deadline - Date.now())).then(() => null),
    ]).catch(() => null)
    if (first === null) {
      recordMismatch(null)
      firstCoherent = null
      await delay(50)
      continue
    }
    try {
      if (first.unavailable) {
        throw new Error('Exact breadcrumb Dots mode became unavailable.')
      }
      if (
        first.source?.valid !== true ||
        !Number.isSafeInteger(first.sampledAtEpochMs) ||
        first.sampledAtEpochMs < sourceReadStartedAtEpochMs ||
        !Number.isFinite(first.fingerprintDurationMs) ||
        first.fingerprintDurationMs < 0
      ) {
        throw new Error('Exact breadcrumb source fingerprint is invalid.')
      }
      assertExactSoakPageEvidenceMatch(
        expectedPageEvidence,
        first.source,
      )
      assertExactSoakOperatorEvidence(
        first.operator,
        expectedPageEvidence,
        input.expectedTotalFixCount,
      )
      if (first.baselineBreadcrumbPointCount !== 0) {
        throw new Error('Baseline tracking source contained breadcrumb Points.')
      }
      if (firstCoherent !== null) {
        assertExactSoakPageEvidenceMatch(
          firstCoherent.pageEvidence,
          first.source,
        )
        return {
          pageEvidence: first.source,
          baselineBreadcrumbPointCount: 0,
          sourceReadStartedAtEpochMs,
          firstFormulaExactSampledAtEpochMs:
            firstCoherent.sampledAtEpochMs,
          stableVerificationDurationMs: performance.now() - startedAt,
          fingerprintDurationMs: Math.max(
            firstCoherent.fingerprintDurationMs,
            first.fingerprintDurationMs,
          ),
        }
      }
      firstCoherent = {
        pageEvidence: first.source,
        sampledAtEpochMs: first.sampledAtEpochMs,
        fingerprintDurationMs: first.fingerprintDurationMs,
      }
      await delay(100)
      continue
    } catch {
      recordMismatch(first)
      firstCoherent = null
    }
    await delay(50)
  }
  throw createExactSoakPublicationFailure({
    pageIndexFromLatest: input.pageIndexFromLatest,
    expected: {
      positionCount: expectedPageEvidence.positionCount,
      sha256: expectedPageEvidence.sha256,
      range: expectedPageEvidence.range,
    },
    mismatchObservationCount,
    firstMismatch,
    lastMismatch,
  })
}

/** Creates one static-message error with a bounded report-safe evidence payload. */
function createExactSoakPublicationFailure(exactDotPublicationFailure) {
  const error = new Error(
    'Timed out waiting for two formula-exact MapLibre breadcrumb observations.',
  )
  error.name = 'ExactSoakPublicationError'
  error.exactDotPublicationFailure = exactDotPublicationFailure
  return error
}

/** Creates one static-message exact gate failure with no raw diagnostics. */
function createExactSoakGateFailure(failureClass, message) {
  const error = new Error(message)
  error.exactDotGateFailure = { failureClass }
  return error
}

/** Reads only the bounded exact and baseline MapLibre sources plus page summary. */
async function readExactSoakMapSources(page) {
  return page.evaluate(readCompactExactSoakMapEvidenceInRenderer)
}

/** Normalizes production IPC rows into the independent oracle contract. */
function normalizeExactSoakStoredPage(positions) {
  if (!Array.isArray(positions)) {
    throw new Error('Exact breadcrumb IPC page positions are invalid.')
  }
  return positions.map((position) => {
    const sourcePositionId = position?.source_position_id?.trim()
    const timestampMs = Date.parse(position?.timestamp)
    if (
      !/^[1-9]\d*$/u.test(sourcePositionId ?? '') ||
      typeof position?.device_id !== 'string' ||
      position.device_id.trim() === '' ||
      !Number.isFinite(position?.lat) ||
      position.lat < -90 ||
      position.lat > 90 ||
      !Number.isFinite(position?.lon) ||
      position.lon < -180 ||
      position.lon > 180 ||
      !Number.isFinite(timestampMs) ||
      new Date(timestampMs).toISOString() !== position.timestamp
    ) {
      throw new Error('Exact breadcrumb IPC page contains an invalid source fix.')
    }
    return {
      sourcePositionId,
      deviceId: position.device_id,
      timestamp: position.timestamp,
      lat: position.lat,
      lon: position.lon,
    }
  })
}

/** Checks count and navigation metadata for one independently audited page. */
function assertExactSoakPageEnvelope(result, oracle, pageEvidence, pageIndex) {
  const expectedHasEarlier = pageIndex + 1 < oracle.pageCount
  const expectedHasLater = pageIndex > 0
  if (
    result.totalPositionCount !== oracle.totalFixCount ||
    result.pagePositionCount !== pageEvidence.positionCount ||
    result.positions.length !== pageEvidence.positionCount ||
    result.positions.length > oracle.pageLimit ||
    result.fromTimestamp !== pageEvidence.range.fromTimestamp ||
    result.toTimestamp !== pageEvidence.range.toTimestamp ||
    result.hasEarlier !== expectedHasEarlier ||
    result.hasLater !== expectedHasLater ||
    (expectedHasEarlier && typeof result.earlierCursor !== 'string') ||
    (!expectedHasEarlier && result.earlierCursor !== null) ||
    (expectedHasLater && typeof result.laterCursor !== 'string') ||
    (!expectedHasLater && result.laterCursor !== null)
  ) {
    throw new Error('Exact breadcrumb page count or navigation envelope is invalid.')
  }
}

/** Compares bounded exact page identity/time/coordinate digest and range. */
function assertExactSoakPageEvidenceMatch(left, right) {
  if (
    left.positionCount !== right.positionCount ||
    left.sha256 !== right.sha256 ||
    JSON.stringify(left.range) !== JSON.stringify(right.range)
  ) {
    throw new Error('Exact breadcrumb query and MapLibre source page disagree.')
  }
}

/** Checks the operator-visible exact page counts and timestamp range. */
function assertExactSoakOperatorEvidence(operator, pageEvidence, totalCount) {
  if (
    operator?.valid !== true ||
    operator.pagePositionCount !== pageEvidence.positionCount ||
    operator.totalPositionCount !== totalCount ||
    operator.fromTimestamp !== pageEvidence.range.fromTimestamp ||
    operator.toTimestamp !== pageEvidence.range.toTimestamp
  ) {
    throw new Error('Operator exact breadcrumb page summary disagrees with source.')
  }
}

async function waitForBackupEvent(page, missionId, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const count = await page.evaluate(
      async ({ missionId }) => {
        const events = await window.sartrackerElectron?.missionStore.listMissionEvents(missionId)
        return events?.filter((event) => event.event_type === 'mission_backup_synced').length ?? 0
      },
      { missionId },
    )
    if (count > 0) return
    await delay(250)
  }
  throw new Error('Timed out waiting for a completed packaged autosave.')
}

async function closeLaunch(launch, mainRoundTrips, rendererGaps) {
  launch.closePromise ??= (async () => {
    launch.closed = true
    launch.rendererLifecycle.beginCleanup()
    await runCleanupStep(() => collectOperatorClickAuditTail(launch), 500)
    await runCleanupStep(
      () => sampleProcessMemory(launch, { phase: 'launch-close' }),
      500,
    )
    await runCleanupStep(() => launch.mainInspector.close(), 250)
    await runCleanupStep(
      () => collectLaunchResponsiveness(launch, mainRoundTrips, rendererGaps),
      2_000,
    )
    await runCleanupStep(() => launch.browser.close(), 2_000)
    return stopOwnedProcess(launch.appProcess, {
      termTimeoutMs: 10_000,
      killTimeoutMs: 5_000,
    })
  })()
  return launch.closePromise
}

/** Captures any trusted input that arrives after the launch's final measured sample. */
async function collectOperatorClickAuditTail(launch) {
  if (launch.operatorClickAuditTail !== null) {
    return
  }
  if (launch.operatorClickAuditState.initialized !== true) {
    launch.operatorClickAuditTail = {
      interSampleEvents: [],
      interactionEvents: [],
      missingEventCount: 0,
      lastSequence: 0,
      issues: [],
    }
    return
  }

  const snapshot = await readOperatorClickAudit(launch.page)
  const audit = partitionOperatorClickAudit({
    audit: snapshot,
    afterSequence: launch.operatorClickAuditState.lastSequence,
    interactionStartSequence: snapshot.lastSequence,
  })
  launch.operatorClickAuditTail = {
    ...audit,
    issues: inspectOperatorClickAudit(audit, []),
  }
}

/**
 * Stops and records responsiveness probes before evidence-only capture work.
 *
 * Full-page screenshots are harness operations, not operator workload. On a
 * CPU-constrained software renderer they can pause presentation for seconds,
 * so including them would make the measurement manufacture its own release
 * failure. Product work, including support-bundle export, remains inside the
 * measured window.
 */
async function collectLaunchResponsiveness(launch, mainRoundTrips, rendererGaps) {
  if (launch.responsivenessCollected === true) {
    return
  }
  launch.responsivenessCollected = true
  const heartbeat = await launch.mainHeartbeat.stop()
  launch.mainHeartbeatErrors = heartbeat.errors
  mainRoundTrips.push(...heartbeat.roundTrips)
  const launchRendererGaps = await collectRendererProbe(launch.page).catch(() => [])
  launch.rendererSampleCount = launchRendererGaps.length
  rendererGaps.push(...launchRendererGaps)
}

async function sampleProcessMemory(launch, context = {}) {
  const sampledAtMs = Date.now()
  if (
    sampledAtMs - launch.processMemory.lastSampleAtMs <
    PROCESS_MEMORY_SAMPLE_INTERVAL_MS
  ) {
    return null
  }
  launch.processMemory.lastSampleAtMs = sampledAtMs
  const memory = await readProcessTreeResidentMemory(launch.appProcess.pid)
  if (memory === null) return null
  return recordProcessMemorySample(
    launch,
    memory,
    context,
    sampledAtMs,
  )
}

/** Records one process-tree RSS observation into bounded launch evidence. */
function recordProcessMemorySample(launch, memory, context, sampledAtMs) {
  launch.processMemory.lastSampleAtMs = sampledAtMs
  launch.processMemory.samples += 1
  const sample = {
    observedAt: new Date(sampledAtMs).toISOString(),
    phase: context.phase ?? 'tracking',
    targetBatch: context.targetBatch ?? null,
    completedBatch: context.completedBatch ?? null,
    totalResidentBytes: memory.totalResidentBytes,
    processes: memory.processes,
  }
  if (
    memory.totalResidentBytes >
    launch.processMemory.maximumProcessTreeResidentBytes
  ) {
    launch.processMemory.maximumProcessTreeResidentBytes =
      memory.totalResidentBytes
    launch.processMemory.maximumSample = sample
  }
  if (
    launch.processMemory.evidenceSamples.length === 0 ||
    sampledAtMs - launch.processMemory.lastEvidenceAtMs >=
      PROCESS_MEMORY_EVIDENCE_INTERVAL_MS
  ) {
    launch.processMemory.evidenceSamples.push(sample)
    launch.processMemory.lastEvidenceAtMs = sampledAtMs
  }
  return sample
}

async function readProcessTreeResidentMemory(rootPid) {
  if (!Number.isInteger(rootPid)) return null
  if (process.platform === 'darwin') {
    const processList = await readDarwinProcessList().catch(() => null)
    return processList === null
      ? null
      : parseDarwinProcessTreeResidentMemory(processList, rootPid)
  }
  if (process.platform !== 'linux') return null
  const pending = [rootPid]
  const visited = new Set()
  const processes = []
  while (pending.length > 0) {
    const pid = pending.pop()
    if (!Number.isInteger(pid) || visited.has(pid)) continue
    visited.add(pid)
    const [status, children] = await Promise.all([
      readFile(`/proc/${pid}/status`, 'utf8').catch(() => ''),
      readFile(`/proc/${pid}/task/${pid}/children`, 'utf8').catch(() => ''),
    ])
    const residentMatch = status.match(/^VmRSS:\s+(\d+)\s+kB$/mu)
    if (residentMatch !== null) {
      processes.push({
        pid,
        parentPid: null,
        residentBytes: Number(residentMatch[1]) * 1_024,
        kind: pid === rootPid ? 'main' : 'other',
      })
    }
    for (const child of children.trim().split(/\s+/u)) {
      if (child !== '') pending.push(Number(child))
    }
  }
  const totalResidentBytes = processes.reduce(
    (total, entry) => total + entry.residentBytes,
    0,
  )
  return totalResidentBytes > 0
    ? { totalResidentBytes, processes }
    : null
}

async function readDarwinProcessList() {
  return new Promise((resolve, reject) => {
    execFile(
      '/bin/ps',
      ['-axo', 'pid=,ppid=,rss=,command='],
      { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 },
      (error, stdout) => {
        if (error !== null) {
          reject(error)
          return
        }
        resolve(stdout)
      },
    )
  })
}

function createProcessMemoryReport(processMemory) {
  return {
    samples: processMemory.samples,
    maximumProcessTreeResidentBytes:
      processMemory.maximumProcessTreeResidentBytes,
    maximumSample: processMemory.maximumSample,
    evidenceSamples: processMemory.evidenceSamples,
  }
}

function inspectDatabase(databasePath, missionId) {
  const database = new Database(databasePath)
  try {
    const walRows = database.pragma('wal_checkpoint(PASSIVE)')
    const wal = walRows[0] ?? { busy: -1, log: -1, checkpointed: -1 }
    const integrityResult = database.pragma('integrity_check', { simple: true })
    const events = Object.fromEntries(
      database
        .prepare('SELECT event_type, COUNT(*) AS count FROM mission_events WHERE mission_id = ? GROUP BY event_type')
        .all(missionId)
        .map((row) => [row.event_type, Number(row.count)]),
    )
    const operationalMissionEvents = Object.entries(events)
      .filter(([eventType]) => !['device_updated', 'position_recorded'].includes(eventType))
      .reduce((sum, [, count]) => sum + count, 0)
    const declaredEventTypes = new Set([
      'mission_created',
      'mission_paused',
      'mission_resumed',
      'mission_backup_synced',
      'device_created',
      'device_updated',
      'position_recorded',
      'participants_selected',
      'group_membership_changed',
    ])
    const unexplainedMissionEvents = Object.entries(events)
      .filter(([eventType]) => !declaredEventTypes.has(eventType))
      .reduce((sum, [, count]) => sum + count, 0)
    const fullPositionTruth = createPositionTruthDigestAccumulator()
    const normalPrefixPositionTruth = createPositionTruthDigestAccumulator()
    for (const row of database
      .prepare(
        `SELECT source_position_id, device_id, timestamp, lat, lon
         FROM positions
         WHERE mission_id = ?
         ORDER BY CAST(source_position_id AS INTEGER) ASC, source_position_id ASC`,
      )
      .iterate(missionId)) {
      fullPositionTruth.add(row)
      if (isNormalProfilePositionIdentity(row.source_position_id)) {
        normalPrefixPositionTruth.add(row)
      }
    }
    return {
      databaseBytes:
        Number(database.pragma('page_count', { simple: true })) *
        Number(database.pragma('page_size', { simple: true })),
      deviceRows: Number(
        database.prepare('SELECT COUNT(*) AS count FROM devices WHERE mission_id = ?').get(missionId).count,
      ),
      participantRows: Number(
        database.prepare('SELECT COUNT(*) AS count FROM mission_participants WHERE mission_id = ?').get(missionId).count,
      ),
      teamRows: Number(
        database.prepare('SELECT COUNT(*) AS count FROM mission_teams WHERE mission_id = ?').get(missionId).count,
      ),
      positionRows: Number(
        database.prepare('SELECT COUNT(*) AS count FROM positions WHERE mission_id = ?').get(missionId).count,
      ),
      events,
      operationalMissionEvents,
      unexplainedMissionEvents,
      positionTruth: {
        full: fullPositionTruth.finish(),
        normalPrefix: normalPrefixPositionTruth.finish(),
        normalPrefixBatch: 480,
      },
      integrityResult,
      walCheckpoint: {
        busy: Number(wal.busy),
        logFrames: Number(wal.log),
        checkpointedFrames: Number(wal.checkpointed),
      },
    }
  } finally {
    database.close()
  }
}

function isNormalProfilePositionIdentity(sourcePositionId) {
  const numericIdentity = Number(sourcePositionId)
  return (
    Number.isSafeInteger(numericIdentity) &&
    numericIdentity > 0 &&
    (numericIdentity < 1_000_000 || Math.floor(numericIdentity / 1_000_000) <= 480)
  )
}

function positionTruthDigestsMatch(actual, expected) {
  return (
    actual.rowCount === expected.rowCount &&
    actual.missingSourcePositionIdentityRows === 0 &&
    expected.missingSourcePositionIdentityRows === 0 &&
    actual.sha256 === expected.sha256
  )
}

function expectedPositionsAt(profile, batch) {
  return batch * profile.productionPollsPerBatch * profile.movingDeviceCount +
    (profile.deviceCount - profile.movingDeviceCount)
}

function sanitizeFileSegment(value) {
  return String(value).replaceAll(/[^a-z0-9-]+/giu, '-')
}

/** Counts stable diagnostic enum values. */
function countBy(values) {
  const counts = {}
  for (const value of values) {
    counts[value] = (counts[value] ?? 0) + 1
  }
  return counts
}

async function readGrowthCheckpoint(input) {
  const counts = await input.page.evaluate(
    async ({ missionId }) => {
      const missionStore = window.sartrackerElectron?.missionStore
      if (missionStore === undefined) throw new Error('Electron mission-store bridge is unavailable.')
      const [positionRows, events] = await Promise.all([
        missionStore.countPositions(missionId),
        missionStore.listMissionEvents(missionId),
      ])
      return {
        positionRows,
        redundantEventRows: events.filter((event) =>
          event.event_type === 'device_updated' || event.event_type === 'position_recorded').length,
      }
    },
    { missionId: input.missionId },
  )
  const mainDatabaseBytes = await fileBytes(path.join(input.userDataDir, 'mission-store.sqlite'))
  const walBytes = await fileBytes(path.join(input.userDataDir, 'mission-store.sqlite-wal'))
  return {
    equivalentProductionPolls: input.equivalentProductionPolls,
    databaseBytes: mainDatabaseBytes + walBytes,
    positionRows: counts.positionRows,
    redundantEventRows: counts.redundantEventRows,
  }
}

async function readCombinedRuntimeLog(userDataDir) {
  const parts = []
  for (const name of [`${runtimeLogRelativePath}.1`, runtimeLogRelativePath]) {
    const contents = await readFile(path.join(userDataDir, name), 'utf8').catch((error) => {
      if (error?.code === 'ENOENT') return ''
      throw error
    })
    if (contents !== '') parts.push(contents)
  }
  return parts.join('\n')
}

async function fileBytes(filePath) {
  return stat(filePath).then((value) => value.size).catch((error) => {
    if (error?.code === 'ENOENT') return 0
    throw error
  })
}

async function combinedLogBytes(userDataDir) {
  let total = 0
  for (const name of [runtimeLogRelativePath, `${runtimeLogRelativePath}.1`]) {
    total += await stat(path.join(userDataDir, name)).then((value) => value.size).catch(() => 0)
  }
  return total
}

function containsForbiddenEvidence(contents, forbiddenValues) {
  return forbiddenValues.some(
    (value) => typeof value === 'string' && value.length > 0 && contents.includes(value),
  )
}

async function installRendererProbe(page) {
  await page.evaluate(installCadencedRendererProbeInWindow)
}

async function collectRendererProbe(page) {
  return page.evaluate(() => {
    const gaps = window.__TRACKING_SOAK_RENDERER_GAPS__ ?? []
    window.__TRACKING_SOAK_RENDERER_PROBE_CLEANUP__?.()
    delete window.__TRACKING_SOAK_RENDERER_PROBE_CLEANUP__
    return gaps
  })
}

function startMainHeartbeat(mainInspector, intervalMs) {
  let stopped = false
  const roundTrips = []
  let errors = 0
  const task = (async () => {
    while (!stopped) {
      const startedAt = performance.now()
      try {
        await mainInspector.evaluate('process.uptime()')
        roundTrips.push(performance.now() - startedAt)
      } catch {
        errors += 1
      }
      await delay(Math.max(0, intervalMs - (performance.now() - startedAt)))
    }
    return { roundTrips, errors }
  })()
  return {
    stop: async () => {
      stopped = true
      return task
    },
  }
}

async function connectMainInspector(port, appProcess) {
  const deadline = Date.now() + 60_000
  let webSocketUrl
  while (Date.now() < deadline) {
    assertProcessAlive(appProcess, 'main inspector startup')
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`)
      if (response.ok) {
        const targets = await response.json()
        webSocketUrl = targets[0]?.webSocketDebuggerUrl
        if (typeof webSocketUrl === 'string') break
      }
    } catch {
      // Inspector startup is polled until the deadline.
    }
    await delay(250)
  }
  if (webSocketUrl === undefined) throw new Error('Timed out waiting for Electron main inspector.')

  const socket = new WebSocket(webSocketUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', () => reject(new Error('Electron main inspector failed.')), { once: true })
  })
  let requestId = 0
  const pending = new Map()
  let closed = false
  const rejectPending = () => {
    closed = true
    for (const request of pending.values()) {
      request.reject(new Error('Electron main inspector closed.'))
    }
    pending.clear()
  }
  socket.addEventListener('close', rejectPending)
  socket.addEventListener('error', rejectPending)
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data))
    const request = pending.get(message.id)
    if (request === undefined) return
    pending.delete(message.id)
    if (message.error !== undefined || message.result?.exceptionDetails !== undefined) {
      request.reject(new Error('Electron main inspector evaluation failed.'))
    } else {
      request.resolve(message.result)
    }
  })
  return {
    evaluate: (expression) => new Promise((resolve, reject) => {
      if (closed || socket.readyState !== 1) {
        reject(new Error('Electron main inspector is unavailable.'))
        return
      }
      requestId += 1
      pending.set(requestId, { resolve, reject })
      try {
        socket.send(JSON.stringify({ id: requestId, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }))
      } catch {
        pending.delete(requestId)
        reject(new Error('Electron main inspector is unavailable.'))
      }
    }),
    close: () => {
      rejectPending()
      socket.close()
    },
  }
}

async function waitForCdp(port, appProcess) {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    assertProcessAlive(appProcess, 'renderer CDP startup')
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`)
      if (response.ok) return
    } catch {
      // Renderer CDP startup is polled until the deadline.
    }
    await delay(250)
  }
  throw new Error('Timed out waiting for Electron remote debugging.')
}

async function findFreePort() {
  const net = await import('node:net')
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') {
        reject(new Error('Could not allocate a local probe port.'))
        return
      }
      server.close(() => resolve(address.port))
    })
  })
}

function assertProcessAlive(child, phase) {
  if (child.trackingSoakLaunchError instanceof Error) {
    throw new Error(`Electron failed to launch during ${phase}: ${child.trackingSoakLaunchError.message}`)
  }
  if (child.exitCode !== null || child.signalCode !== null) {
    throw new Error(`Electron exited during ${phase}.`)
  }
}

async function assertFreshDirectory(directory) {
  await rm(directory, { recursive: true, force: true })
  await mkdir(directory, { recursive: true })
}

async function sha256File(filePath) {
  const hash = createHash('sha256')
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', resolve)
  })
  return hash.digest('hex')
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}
