import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

describe('fourteen-day packaged exact-dot soak script [DON-260]', () => {
  const source = readFileSync('scripts/electron-tracking-soak.mjs', 'utf8')

  it('shares one recorded mission-scoped fixture clock with mock and independent oracle', () => {
    expect(source).toContain('createTrackingSoakFixtureClock(')
    expect(source).toContain('baseTimeMs: fixtureClock.baseTimeMs')
    expect(source).toContain('intervalMs: fixtureClock.intervalMs')
    expect(source).toContain('const missionModelEvidence = await startSyntheticMission(')
    expect(source).toContain('fixtureClock.missionOffsetHours,')
    expect(source).toContain('options.profile.deviceCount,')
    expect(source).toContain('fixtureClock,')
  })

  it('keeps mock and mission paused until latest-page parity survives each restart', () => {
    const checkpointStart = source.indexOf('for (const checkpoint of options.profile.restartCheckpoints)')
    const finalStart = source.lastIndexOf('await waitForCheckpoint({', source.indexOf('expectedPositions: options.profile.expectedPositionRows'))
    const checkpointSource = source.slice(checkpointStart, finalStart)

    expect(source).toContain('pauseCheckpoints: exactSoakPauseCheckpoints')
    expect(checkpointSource).toContain('ensureMissionPaused(')
    expect(checkpointSource).toContain('auditLatestExactDotPage(')
    expect(checkpointSource).toContain('assertLatestExactDotParity(')
    expect(checkpointSource.indexOf('assertLatestExactDotParity(')).toBeLessThan(
      checkpointSource.indexOf('await mockServer.resume()'),
    )
  })

  it('streams all exact source pages Earlier and Later against only the formula oracle', () => {
    expect(source).toContain('auditFinalExactDotTraversal(')
    expect(source).toContain('createIndependentExactSoakOracle(')
    expect(source).toContain('createExactSoakPageEvidenceAccumulator(')
    expect(source).toContain("'exact-breadcrumb-dots-earlier'")
    expect(source).toContain("'exact-breadcrumb-dots-later'")
    expect(source).toContain('baselineBreadcrumbPointCount')
    expect(source).not.toContain('inspectDatabase(databasePath, missionId, exact')
    const traversalSource = source.slice(
      source.indexOf('async function auditFinalExactDotTraversal(input)'),
      source.indexOf('/** Builds the frozen 393-observation exact proof'),
    )
    expect(traversalSource).not.toContain('queryExactDotPage(')
    expect(traversalSource).not.toContain('normalizeExactSoakStoredPage(')
    expect(traversalSource).toContain('createExactSoakPageEvidenceAccumulator(')
    expect(traversalSource).toContain('accumulator.addPageEvidence(')
    expect(traversalSource).toContain('earlierDisabledAtOldest')
    expect(traversalSource).toContain('laterDisabledAtLatest')
    expect(traversalSource).toContain('earlierDisabledAtOldest = await')
    expect(traversalSource).not.toContain(
      'laterTraversalDurationMs = performance.now()',
    )
    expect(traversalSource).toContain(
      'outwardTraversalDurationMs += timing.pageActionDurationMs',
    )
    expect(traversalSource).toContain(
      'laterTraversalDurationMs += timing.pageActionDurationMs',
    )
    expect(traversalSource).not.toContain(
      'outwardTraversalDurationMs = performance.now()',
    )
  })

  it('records page/query/publication latency while sampling RSS at 250ms', () => {
    expect(source).toContain('exactDotQueryDurationMs')
    expect(source).toContain('exactDotPublicationDurationMs')
    expect(source).toContain('exactDotPageDurationMs')
    expect(source).toContain('startExactAuditMemorySampler(')
    expect(source).toContain('PROCESS_MEMORY_SAMPLE_INTERVAL_MS')
    expect(source).toContain('exactDotProof')
  })

  it('enforces 393 UI observations, six direct latest audits, and frozen traversal bounds', () => {
    expect(source).toContain('EXACT_PAGE_ACTION_TIMEOUT_MS = 5_000')
    expect(source).toContain('Promise.race([')
    expect(source).toContain('cancelExactBreadcrumbDotQuery')
    expect(source).toContain('outwardTraversalDurationMs > 60_000')
    expect(source).toContain('laterTraversalDurationMs > 120_000')
    expect(source).toContain('p95Ms > 2_000')
    expect(source).toContain('directIpcLatestAudits')
    expect(source).toContain('directIpcQueryCount')
    expect(source).toContain('expectedDirectIpcQueryCount = 6')
    expect(source).toContain('explicitPageObservationCount')
    expect(source).toContain('finalizeExactDotProof(')
  })

  it('settles exact proof before requiring two restored-Line total observations', () => {
    const exactProofIndex = source.indexOf(
      'exactDotProof = finalizeExactDotProof({',
    )
    const lineAuditIndex = source.indexOf(
      'finalLineTotalAudit = await auditFinalLineTotalParity({',
    )
    const finalCloseIndex = source.indexOf(
      'await closeLaunch(activeLaunch, mainRoundTrips, rendererGaps)',
      lineAuditIndex,
    )

    expect(exactProofIndex).toBeGreaterThan(-1)
    expect(lineAuditIndex).toBeGreaterThan(exactProofIndex)
    expect(finalCloseIndex).toBeGreaterThan(lineAuditIndex)
    expect(source).toContain("getByTestId('breadcrumb-mode-line')")
    expect(source).toContain('missionStore.countPositions(missionId)')
    expect(source).toContain('stableObservationCount: 2')
    expect(source).toContain('finalLineTotalAudit,')
  })

  it('polls transient exact publication mismatch and preserves bounded terminal evidence', () => {
    const publicationSource = source.slice(
      source.indexOf('async function waitForExactSoakSourcePage('),
      source.indexOf('/** Reads only the bounded exact and baseline MapLibre sources'),
    )
    expect(publicationSource).toContain('createExactSoakMismatchObservation(')
    expect(publicationSource).toContain('firstMismatch')
    expect(publicationSource).toContain('lastMismatch')
    expect(publicationSource).toContain('mismatchObservationCount')
    expect(source).toContain('exactDotPublicationFailure')
    expect(source).toContain('createTrackingSoakFailureReport')
    expect(source).toContain('electron-tracking-soak-failure-report.json')
    expect(source).toContain('createTrackingSoakFailureReport({')
    expect(source).toContain('await writeJson(failureReportPath, failureReport)')
    expect(publicationSource).not.toContain(
      "error instanceof Error ? error.name : 'UnknownError'",
    )
    expect(source).toContain(
      'timeoutMs: Math.min(input.timeoutMs, EXACT_PAGE_ACTION_TIMEOUT_MS)',
    )
  })

  it('fingerprints exact source rows inside the renderer and separates first publication from proof confirmation', () => {
    const readStart = source.indexOf('async function readExactSoakMapSources(page)')
    const readEnd = source.indexOf('/** Normalizes production IPC rows', readStart)
    const readSource = source.slice(readStart, readEnd)
    const waitSource = source.slice(
      source.indexOf('async function waitForExactSoakSourcePage(input)'),
      source.indexOf('/** Creates one static-message error', readStart),
    )

    expect(source).toContain('readCompactExactSoakMapEvidenceInRenderer')
    expect(readSource).toContain(
      'page.evaluate(readCompactExactSoakMapEvidenceInRenderer)',
    )
    expect(readSource).not.toContain('return { exact, baseline')
    expect(waitSource).toContain('firstFormulaExactSampledAtEpochMs')
    expect(waitSource).toContain('stableVerificationDurationMs')
    expect(waitSource).not.toContain('rows,')

    const latestAuditSource = source.slice(
      source.indexOf('async function auditLatestExactDotPage(input)'),
      source.indexOf('/** Requires the identical exact latest page'),
    )
    expect(latestAuditSource.indexOf('waitForExactSoakSourcePage({')).toBeLessThan(
      latestAuditSource.indexOf('queryExactDotPage('),
    )
  })

  it('prepares independent formula evidence before every measured exact-page action', () => {
    const waitSource = source.slice(
      source.indexOf('async function waitForExactSoakSourcePage(input)'),
      source.indexOf('/** Creates one static-message error',
        source.indexOf('async function waitForExactSoakSourcePage(input)')),
    )
    const latestAuditSource = source.slice(
      source.indexOf('async function auditLatestExactDotPage(input)'),
      source.indexOf('/** Requires the identical exact latest page'),
    )
    const traversalSource = source.slice(
      source.indexOf('async function auditFinalExactDotTraversal(input)'),
      source.indexOf('/** Builds the frozen 393-observation exact proof'),
    )

    expect(waitSource).toContain('input.expectedPageEvidence')
    expect(waitSource).toContain('input.expectedTotalFixCount')
    expect(waitSource).not.toContain('input.oracle.createPage(')
    expect(waitSource).not.toContain('auditIndependentExactSoakPage(')

    const latestPreparation = latestAuditSource.indexOf(
      'prepareExpectedExactSoakSourcePage(oracle, 0)',
    )
    const latestMeasuredAction = latestAuditSource.indexOf(
      'const initialPage = await openExactDotWorkspace(',
    )
    expect(latestPreparation).toBeGreaterThan(-1)
    expect(latestPreparation).toBeLessThan(latestMeasuredAction)

    const initialPreparation = traversalSource.indexOf(
      'prepareExpectedExactSoakSourcePage(oracle, 0)',
    )
    const initialMeasuredAction = traversalSource.indexOf(
      'const initialPage = await openExactDotWorkspace(',
    )
    expect(initialPreparation).toBeGreaterThan(-1)
    expect(initialPreparation).toBeLessThan(initialMeasuredAction)

    const earlierPreparation = traversalSource.indexOf(
      'prepareExpectedExactSoakSourcePage(',
      initialMeasuredAction,
    )
    const earlierMeasuredAction = traversalSource.indexOf(
      "'exact-breadcrumb-dots-earlier'",
    )
    expect(earlierPreparation).toBeGreaterThan(initialMeasuredAction)
    expect(earlierPreparation).toBeLessThan(earlierMeasuredAction)

    const laterPreparation = traversalSource.indexOf(
      'prepareExpectedExactSoakSourcePage(',
      earlierMeasuredAction,
    )
    const laterMeasuredAction = traversalSource.indexOf(
      "'exact-breadcrumb-dots-later'",
    )
    expect(laterPreparation).toBeGreaterThan(earlierMeasuredAction)
    expect(laterPreparation).toBeLessThan(laterMeasuredAction)
  })

  it('closes the Devices inspector before actionable exact-page navigation and always restores Line', () => {
    const openStart = source.indexOf(
      'async function openExactDotWorkspace(launch, observeAfterDotsClick)',
    )
    const closeStart = source.indexOf('async function closeExactDotWorkspace(launch)')
    const restoreStart = source.indexOf('async function restoreFinalBreadcrumbLineMode(launch)')
    const openSource = source.slice(openStart, closeStart)
    const closeSource = source.slice(
      closeStart,
      source.indexOf('/**\n * Requires the restored Line summary', closeStart),
    )
    const traversalSource = source.slice(
      source.indexOf('async function auditFinalExactDotTraversal(input)'),
      source.indexOf('/** Builds the frozen 393-observation exact proof'),
    )
    const restoreSource = source.slice(
      restoreStart,
      source.indexOf('/** Reads one bounded operator summary'),
    )

    expect(openSource.indexOf("getByTestId('breadcrumb-mode-dots')")).toBeGreaterThan(-1)
    expect(openSource.indexOf('sar-segment-option-active')).toBeGreaterThan(
      openSource.indexOf("getByTestId('breadcrumb-mode-dots')"),
    )
    expect(openSource.indexOf("getByTestId('workspace-close-btn')")).toBeGreaterThan(
      openSource.indexOf('sar-segment-option-active'),
    )
    expect(openSource.indexOf("state: 'hidden'")).toBeGreaterThan(
      openSource.indexOf("getByTestId('workspace-close-btn')"),
    )
    expect(closeSource).toContain('await restoreFinalBreadcrumbLineMode(launch)')

    expect(source).toContain(
      "from '../build/electron-tracking-soak-exact-action-lib.js'",
    )
    expect(traversalSource).toMatch(
      /clickExactDotPageControl\(\{\s*page: input\.launch\.page,\s*testId: 'exact-breadcrumb-dots-earlier',\s*pageIndexFromLatest,\s*timeoutMs: EXACT_PAGE_ACTION_TIMEOUT_MS/u,
    )
    expect(traversalSource).toMatch(
      /clickExactDotPageControl\(\{\s*page: input\.launch\.page,\s*testId: 'exact-breadcrumb-dots-later',\s*pageIndexFromLatest,\s*timeoutMs: EXACT_PAGE_ACTION_TIMEOUT_MS/u,
    )
    expect(traversalSource).not.toContain('force: true')

    expect(restoreSource).toContain("getByTestId('open-devices-workspace')")
    expect(restoreSource).toContain("getByTestId('breadcrumb-mode-line')")
    expect(restoreSource).toContain('sar-segment-option-active')
    expect(restoreSource).toContain("getByTestId('workspace-close-btn')")
    expect(restoreSource).toContain("state: 'hidden'")
  })

  it('prevents host sleep and records current tracking/lifecycle state in generic failures', () => {
    const checkpointSource = source.slice(
      source.indexOf('async function waitForCheckpoint(input)'),
      source.indexOf('/** Fails closed when the measured renderer',
        source.indexOf('async function waitForCheckpoint(input)')),
    )
    const exactSourceWait = source.slice(
      source.indexOf('async function waitForExactSoakSourcePage(input)'),
      source.indexOf('/** Creates one static-message error',
        source.indexOf('async function waitForExactSoakSourcePage(input)')),
    )
    const finalLineAudit = source.slice(
      source.indexOf('async function auditFinalLineTotalParity(input)'),
      source.indexOf('/** Selects Line explicitly',
        source.indexOf('async function auditFinalLineTotalParity(input)')),
    )
    expect(source).toContain('startTrackingSoakSleepGuard({')
    expect(source).toContain("platform: process.platform")
    expect(source).toContain('parentPid: process.pid')
    expect(source).toContain('sleepGuard.assertHealthy()')
    expect(source).toContain('currentBatch:')
    expect(source).toContain('targetBatch:')
    expect(source).toContain('launchNumber:')
    expect(source).toContain('rendererLifecycle: activeLaunch?.rendererLifecycle.snapshot()')
    expect(source).toContain('hostSleepGuard: sleepGuard?.snapshot()')
    expect(source).toContain('await sleepGuard.stop()\n    const report = {')
    expect(source).toContain("page.on('close'")
    expect(source).toContain("page.on('crash'")
    expect(source).toContain("browser.on('disconnected'")
    expect(checkpointSource).toContain("input.progress.phase = 'tracking'")
    expect(checkpointSource).toContain(
      'input.progress.targetBatch = input.targetBatch',
    )
    expect(checkpointSource).toContain(
      'input.progress.currentBatch = mockState.completedBatches',
    )
    expect(checkpointSource).toContain('input.sleepGuard.assertHealthy()')
    expect(exactSourceWait).toContain('input.sleepGuard.assertHealthy()')
    expect(finalLineAudit).toContain('input.sleepGuard.assertHealthy()')
  })

  it('shares unconditional bounded cleanup even when page-based probes fail', () => {
    const closeSource = source.slice(
      source.indexOf('async function closeLaunch('),
      source.indexOf('/** Captures any trusted input', source.indexOf('async function closeLaunch(')),
    )
    expect(closeSource).toContain('launch.closePromise ??=')
    expect(closeSource).toContain('runCleanupStep(')
    expect(closeSource).toContain('collectOperatorClickAuditTail')
    expect(closeSource).toContain('collectLaunchResponsiveness')
    expect(closeSource).toContain('launch.mainInspector.close()')
    expect(closeSource).toContain('launch.browser.close()')
    expect(closeSource).toContain('stopOwnedProcess(launch.appProcess')
    expect(closeSource).not.toContain("launch.appProcess.kill('SIGTERM')")
    expect(source).toContain('signalCode !== null')
    const launchFailureSource = source.slice(
      source.indexOf('async function launchPackagedApp('),
      source.indexOf('async function startSyntheticMission('),
    )
    expect(launchFailureSource).toContain('stopOwnedProcess(appProcess')
  })

  it('claims every harness-owned click from sequence zero without cursor adoption', () => {
    const functionSource = (start: string, end: string) => source.slice(
      source.indexOf(start),
      source.indexOf(end, source.indexOf(start)),
    )
    const startMission = functionSource(
      'async function startSyntheticMission(',
      '/** Exercises a real, non-forced operator interaction',
    )
    const recovery = functionSource(
      'async function resumeRecoveredMission(',
      'async function readActiveMissionId(',
    )
    const pause = functionSource(
      'async function ensureMissionPaused(',
      '/** Resumes the packaged mission',
    )
    const resume = functionSource(
      'async function ensureMissionActive(',
      '/** Reads the active mission',
    )
    const open = functionSource(
      'async function openExactDotWorkspace(',
      '/** Restores bounded Line mode',
    )
    const restore = functionSource(
      'async function restoreFinalBreadcrumbLineMode(',
      '/** Reads one bounded operator summary',
    )
    const traversal = functionSource(
      'async function auditFinalExactDotTraversal(',
      '/** Builds the frozen 393-observation exact proof',
    )

    expect(source).toContain(
      "from '../build/electron-tracking-soak-operator-audit-lib.js'",
    )
    expect(source).toContain('initialized: true')
    expect(source).toContain('lastSequence: 0')
    expect(source).not.toContain(
      'input.auditState.lastSequence = auditAtStart.lastSequence',
    )
    for (const ownedClickSource of [
      startMission,
      recovery,
      pause,
      resume,
      open,
      restore,
    ]) {
      expect(ownedClickSource).toContain('performLaunchOwnedHarnessClick(')
    }
    expect(startMission).not.toContain('evaluateAll(')
    expect(startMission).toContain("'participant-device-picker'")
    expect(startMission).toContain('activeList?.children.length === expectedCount')
    expect(startMission).not.toContain("hasText: 'Synthetic Mission Team'")
    expect(traversal.match(/performLaunchOwnedHarnessClick\(/gu)).toHaveLength(2)
    expect(traversal).toContain(
      '() => waitForExactSoakSourcePage({',
    )
    expect(traversal).toContain(
      'pageStartedAtEpochMs = ownedClick.clickStartedAtEpochMs',
    )
    const latestAudit = functionSource(
      'async function auditLatestExactDotPage(',
      '/** Requires the identical exact latest page',
    )
    expect(latestAudit).toContain(
      'const initialPage = await openExactDotWorkspace(',
    )
    expect(latestAudit).toContain(
      'const pageStartedAtEpochMs = initialPage.clickStartedAtEpochMs',
    )
    expect(latestAudit).toContain('source = initialPage.observation')
    expect(traversal).toContain(
      'const initialPage = await openExactDotWorkspace(',
    )
    expect(traversal).toContain(
      'const latestPageStartedAtEpochMs = initialPage.clickStartedAtEpochMs',
    )
    expect(traversal).toContain('source = initialPage.observation')
    expect(open).toContain('observeAfterDotsClick')
    expect(open.indexOf('observeAfterDotsClick,')).toBeLessThan(
      open.indexOf("getByTestId('workspace-close-btn')"),
    )
    expect(source).toContain('acknowledgeOperatorClickAudit(')
  })
})
