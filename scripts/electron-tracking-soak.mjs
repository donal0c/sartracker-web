#!/usr/bin/env node

// Accelerated packaged-Electron tracking and storage soak (DON-246).
// Simulated time is compressed only in the local Traccar response. Every row
// still crosses the production network proxy, poller, runtime, IPC, SQLite,
// autosave, diagnostics, restart, and support-export boundaries.

import { spawn } from 'node:child_process'
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
  buildWebGlRendererAttestation,
  buildTrackingGrowthEvidence,
  buildTrackingSoakVerdict,
  classifyOperatorInteraction,
  createPositionTruthDigestAccumulator,
  measureOperatorAction,
  parseTrackingSoakArgs,
  parseTrackingSoakRuntimeLog,
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

main().catch((error) => {
  console.error(`electron-tracking-soak: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})

/** Runs one complete packaged soak profile and writes a fail-closed report. */
async function main() {
  const options = parseTrackingSoakArgs(process.argv.slice(2))
  const evidenceDir = path.resolve(options.evidenceDir)
  const userDataDir = path.join(evidenceDir, 'user-data')
  const databasePath = path.join(userDataDir, 'mission-store.sqlite')
  await assertFreshDirectory(evidenceDir)
  await mkdir(userDataDir, { recursive: true })
  await access(options.appPath)

  const mockServer = await startTrackingSoakMockServer({
    statePath: path.join(evidenceDir, 'mock-traccar-state.json'),
    deviceCount: options.profile.deviceCount,
    movingDeviceCount: options.profile.movingDeviceCount,
    productionPollsPerBatch: options.profile.productionPollsPerBatch,
    maximumBatches: options.profile.actualBatches,
    pauseCheckpoints: options.profile.restartCheckpoints,
  })
  await seedRuntimeConfiguration(userDataDir, mockServer.baseUrl)

  const launches = []
  const mainRoundTrips = []
  const rendererGaps = []
  const operatorInteractions = []
  const growthCheckpoints = []
  let restartCheckpointsPassed = 0
  let activeLaunch
  let missionId
  const startedAt = new Date()

  try {
    activeLaunch = await launchPackagedApp(options, userDataDir, launches.length + 1)
    launches.push(activeLaunch)
    await startSyntheticMission(activeLaunch.page)
    missionId = await readActiveMissionId(activeLaunch.page)
    await recordOperatorInteraction({
      page: activeLaunch.page,
      phase: 'mission-started',
      evidenceDir,
      results: operatorInteractions,
    })

    for (const checkpoint of options.profile.restartCheckpoints) {
      await waitForCheckpoint({
        launch: activeLaunch,
        mockServer,
        missionId,
        targetBatch: checkpoint,
        expectedPositions: expectedPositionsAt(options.profile, checkpoint),
        timeoutMs: options.timeoutMs,
      })
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
      })
      await activeLaunch.page.screenshot({
        path: path.join(evidenceDir, `checkpoint-${checkpoint}-before-restart.png`),
        fullPage: true,
      })
      await closeLaunch(activeLaunch, mainRoundTrips, rendererGaps)
      activeLaunch = undefined

      await mockServer.resume()
      activeLaunch = await launchPackagedApp(options, userDataDir, launches.length + 1)
      launches.push(activeLaunch)
      await resumeRecoveredMission(activeLaunch.page, missionId)
      await recordOperatorInteraction({
        page: activeLaunch.page,
        phase: `checkpoint-${checkpoint}-after-restart`,
        evidenceDir,
        results: operatorInteractions,
      })
      restartCheckpointsPassed += 1
    }

    await waitForCheckpoint({
      launch: activeLaunch,
      mockServer,
      missionId,
      targetBatch: options.profile.actualBatches,
      expectedPositions: options.profile.expectedPositionRows,
      timeoutMs: options.timeoutMs,
    })
    await waitForBackupEvent(activeLaunch.page, missionId, options.timeoutMs)
    await recordOperatorInteraction({
      page: activeLaunch.page,
      phase: 'final-load',
      evidenceDir,
      results: operatorInteractions,
    })
    growthCheckpoints.push(
      await readGrowthCheckpoint({
        page: activeLaunch.page,
        userDataDir,
        missionId,
        equivalentProductionPolls: options.profile.equivalentProductionPolls,
      }),
    )
    await activeLaunch.page.screenshot({
      path: path.join(evidenceDir, 'final-packaged-state.png'),
      fullPage: true,
    })

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
    const supportBundle = await readFile(supportBundlePath, 'utf8')
    await writeFile(
      path.join(evidenceDir, 'support-bundle-inspected.txt'),
      sanitizeEvidenceText(supportBundle),
      'utf8',
    )

    await closeLaunch(activeLaunch, mainRoundTrips, rendererGaps)
    activeLaunch = undefined

    const databaseEvidence = inspectDatabase(databasePath, missionId)
    const expectedPositionTruth = buildTrackingSoakExpectedPositionTruthEvidence({
      deviceCount: options.profile.deviceCount,
      movingDeviceCount: options.profile.movingDeviceCount,
      productionPollsPerBatch: options.profile.productionPollsPerBatch,
      maximumBatches: options.profile.actualBatches,
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
    const operatorInteractionErrors = operatorInteractions.filter(
      (interaction) => !interaction.passed,
    ).length
    const operatorInteractionClassifications = countBy(
      operatorInteractions.map((interaction) => interaction.classification),
    )
    const processMemory = {
      samples: launches.reduce((sum, launch) => sum + launch.processMemory.samples, 0),
      maximumProcessTreeResidentBytes: Math.max(
        0,
        ...launches.map((launch) => launch.processMemory.maximumProcessTreeResidentBytes),
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
        options.profile.restartCheckpoints.length * 2 +
        (databaseEvidence.events.mission_backup_synced ?? 0),
      unexplainedMissionEvents: databaseEvidence.unexplainedMissionEvents,
      restartCheckpointsPassed,
      backupCycles: databaseEvidence.events.mission_backup_synced ?? 0,
      mainHeartbeatSamples: mainStats.count,
      mainHeartbeatErrors: launches.reduce((sum, launch) => sum + launch.mainHeartbeatErrors, 0),
      mainMaximumMs: mainStats.maxMs,
      rendererSamples: rendererStats.count,
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
    })
    const report = {
      schemaVersion: 1,
      issue: 'DON-246',
      recordedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
      profile: options.profile,
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
      launches: launches.map((launch) => ({
        number: launch.number,
        webGlRenderer: launch.webGlRenderer,
        mainHeartbeatErrors: launch.mainHeartbeatErrors,
        rendererCrashes: launch.rendererCrashes,
        processMemory: launch.processMemory,
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
  } finally {
    if (activeLaunch !== undefined) {
      await closeLaunch(activeLaunch, mainRoundTrips, rendererGaps).catch(() => undefined)
    }
    await Promise.all(
      launches.map((launch) =>
        writeFile(
          path.join(evidenceDir, `electron-launch-${launch.number}.log`),
          sanitizeEvidenceText(Buffer.concat(launch.logChunks).toString('utf8')),
          'utf8',
        ),
      ),
    )
    await mockServer.close()
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
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.getByTestId('app-shell').waitFor({ state: 'attached', timeout: 60_000 })
    await page.locator('.maplibregl-canvas').waitFor({ state: 'attached', timeout: 60_000 })
    const webGlRenderer = await page.evaluate(readWebGlRendererInfoFromDocument)
    console.log(
      `[tracking-soak] launch=${number} webgl=${webGlRenderer.available ? webGlRenderer.unmaskedRenderer ?? webGlRenderer.renderer : webGlRenderer.reason}`,
    )
    await installRendererProbe(page)
    let rendererCrashes = 0
    page.on('crash', () => {
      rendererCrashes += 1
    })
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
        return rendererCrashes
      },
      processMemory: { samples: 0, maximumProcessTreeResidentBytes: 0 },
      logChunks,
      closed: false,
    }
  } catch (error) {
    mainInspector?.close()
    await browser?.close().catch(() => undefined)
    appProcess.kill('SIGTERM')
    await waitForExit(appProcess, 5_000)
    await writeFile(
      path.join(path.resolve(options.evidenceDir), `electron-launch-${number}-failed.log`),
      sanitizeEvidenceText(Buffer.concat(logChunks).toString('utf8')),
      'utf8',
    )
    throw error
  }
}

async function startSyntheticMission(page) {
  await page
    .getByTestId('mission-name-input')
    .fill('Synthetic Continuous Soak Mission', { force: true })
  await page.getByTestId('mission-start-btn').click({ force: true })
  await waitForActiveMission(page, 30_000)
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
  const preflight = await inspectPointerTarget(
    input.page,
    'open-devices-workspace',
  ).catch(() => ({
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
  }
  const errors = []

  if (result.targetFound) {
    const openAction = await measureOperatorAction({
      installRecorder: () =>
        installClickRecorder(
          input.page,
          'open-devices-workspace',
          'workspace-close-btn',
          'actionable',
        ),
      click: () =>
        clickInspectedPointerTarget(input.page, preflight, 'open-devices-workspace'),
      waitForState: () =>
        waitForPointerTargetActionable(
          input.page,
          'workspace-close-btn',
          5_000,
        ),
      readRecorder: () => readClickRecorder(input.page),
      now: () => performance.now(),
    })
    result.openClickCompleted = openAction.clickCompleted
    result.openClickReceived = openAction.clickReceived
    result.workspaceOpened = openAction.stateReached
    result.openActionDurationMs = openAction.durationMs
    result.openExternalActionDurationMs = openAction.externalDurationMs
    result.openClickDeliveryDurationMs = openAction.clickDeliveryDurationMs
    result.openStateWaitDurationMs = openAction.stateWaitDurationMs
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
        targetFound: false,
        targetReceivesPointer: false,
        hitElement: null,
        centerPoint: null,
      }))
    : null
  if (result.workspaceOpened) {
    const closeAction = await measureOperatorAction({
      installRecorder: () =>
        installClickRecorder(
          input.page,
          'workspace-close-btn',
          'devices-workspace',
          'hidden',
        ),
      click: () =>
        clickInspectedPointerTarget(input.page, closePreflight, 'workspace-close-btn'),
      waitForState: () =>
        waitForLocatorState(
          input.page.getByTestId('devices-workspace'),
          'hidden',
          5_000,
        ),
      readRecorder: () => readClickRecorder(input.page),
      now: () => performance.now(),
    })
    result.closeClickCompleted = closeAction.clickCompleted
    result.closeClickReceived = closeAction.clickReceived
    result.workspaceClosed = closeAction.stateReached
    result.closeActionDurationMs = closeAction.durationMs
    result.closeExternalActionDurationMs = closeAction.externalDurationMs
    result.closeClickDeliveryDurationMs = closeAction.clickDeliveryDurationMs
    result.closeStateWaitDurationMs = closeAction.stateWaitDurationMs
    errors.push(...closeAction.errorClasses)
  }

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
  })
}

/** Inspects the real hit-test target at the centre of an operator control. */
async function inspectPointerTarget(page, testId) {
  return page.evaluate((expectedTestId) => {
    const target = document.querySelector(`[data-testid="${expectedTestId}"]`)
    if (!(target instanceof HTMLElement)) {
      return {
        targetFound: false,
        targetReceivesPointer: false,
        hitElement: null,
        centerPoint: null,
      }
    }
    const rect = target.getBoundingClientRect()
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
    return {
      targetFound: true,
      targetReceivesPointer: hit === target || (hit !== null && target.contains(hit)),
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

/**
 * Sends a trusted pointer click at a previously verified on-screen target.
 *
 * The preceding hit-test is the actionability gate. Using the mouse path keeps
 * command-to-state timing focused on Chromium input delivery and application
 * response rather than Playwright locator polling.
 */
async function clickInspectedPointerTarget(page, preflight, testId) {
  if (
    preflight?.targetReceivesPointer !== true ||
    !Number.isFinite(preflight.centerPoint?.x) ||
    !Number.isFinite(preflight.centerPoint?.y)
  ) {
    throw new Error(`Pointer target ${testId} was not actionable at its inspected centre.`)
  }
  await page.mouse.click(preflight.centerPoint.x, preflight.centerPoint.y)
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

/** Waits for one UI state without converting a timeout into an opaque thrown error. */
async function waitForLocatorState(locator, state, timeout) {
  return locator
    .waitFor({ state, timeout })
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

async function resumeRecoveredMission(page, expectedMissionId) {
  await page.getByTestId('mission-recovery-dialog').waitFor({ state: 'attached', timeout: 60_000 })
  await page.getByRole('button', { name: 'Resume' }).click({ force: true })
  await waitForActiveMission(page, 30_000)
  const missionId = await readActiveMissionId(page)
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
  const deadline = Date.now() + input.timeoutMs
  while (Date.now() < deadline) {
    assertProcessAlive(input.launch.appProcess, 'tracking checkpoint')
    if (input.launch.rendererCrashes > 0) {
      throw new Error(`Electron renderer crashed during tracking checkpoint ${input.targetBatch}.`)
    }
    await sampleProcessMemory(input.launch)
    const mockState = input.mockServer.snapshot()
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
  if (launch.closed) return
  launch.closed = true
  await sampleProcessMemory(launch)
  const heartbeat = await launch.mainHeartbeat.stop()
  launch.mainHeartbeatErrors = heartbeat.errors
  mainRoundTrips.push(...heartbeat.roundTrips)
  rendererGaps.push(...(await collectRendererProbe(launch.page).catch(() => [])))
  launch.mainInspector.close()
  await launch.browser.close().catch(() => undefined)
  launch.appProcess.kill('SIGTERM')
  await waitForExit(launch.appProcess, 10_000)
  if (launch.appProcess.exitCode === null) {
    launch.appProcess.kill('SIGKILL')
    await waitForExit(launch.appProcess, 5_000)
  }
}

async function sampleProcessMemory(launch) {
  const residentBytes = await readProcessTreeResidentBytes(launch.appProcess.pid)
  if (residentBytes === null) return
  launch.processMemory.samples += 1
  launch.processMemory.maximumProcessTreeResidentBytes = Math.max(
    launch.processMemory.maximumProcessTreeResidentBytes,
    residentBytes,
  )
}

async function readProcessTreeResidentBytes(rootPid) {
  if (!Number.isInteger(rootPid) || process.platform !== 'linux') return null
  const pending = [rootPid]
  const visited = new Set()
  let total = 0
  while (pending.length > 0) {
    const pid = pending.pop()
    if (!Number.isInteger(pid) || visited.has(pid)) continue
    visited.add(pid)
    const [status, children] = await Promise.all([
      readFile(`/proc/${pid}/status`, 'utf8').catch(() => ''),
      readFile(`/proc/${pid}/task/${pid}/children`, 'utf8').catch(() => ''),
    ])
    const residentMatch = status.match(/^VmRSS:\s+(\d+)\s+kB$/mu)
    if (residentMatch !== null) total += Number(residentMatch[1]) * 1024
    for (const child of children.trim().split(/\s+/u)) {
      if (child !== '') pending.push(Number(child))
    }
  }
  return total > 0 ? total : null
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
  await page.evaluate(() => {
    const gaps = []
    window.__TRACKING_SOAK_RENDERER_GAPS__ = gaps
    let previous = performance.now()
    const frame = (now) => {
      gaps.push(now - previous)
      previous = now
      window.requestAnimationFrame(frame)
    }
    window.requestAnimationFrame(frame)
  })
}

async function collectRendererProbe(page) {
  return page.evaluate(() => window.__TRACKING_SOAK_RENDERER_GAPS__ ?? [])
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
      requestId += 1
      pending.set(requestId, { resolve, reject })
      socket.send(JSON.stringify({ id: requestId, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }))
    }),
    close: () => socket.close(),
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

async function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null) return
  await Promise.race([new Promise((resolve) => child.once('exit', resolve)), delay(timeoutMs)])
}

function assertProcessAlive(child, phase) {
  if (child.trackingSoakLaunchError instanceof Error) {
    throw new Error(`Electron failed to launch during ${phase}: ${child.trackingSoakLaunchError.message}`)
  }
  if (child.exitCode !== null) {
    throw new Error(`Electron exited during ${phase} with code ${child.exitCode}.`)
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
