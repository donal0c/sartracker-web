import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

describe('real Traccar exact breadcrumb packaged gate [DON-260]', () => {
  const scriptPath = 'scripts/release-smoke/breadcrumb-live-exact-smoke.mjs'

  it('binds an exact artifact and a 48-hour mission without accepting target identity in argv or env', () => {
    const source = readFileSync(scriptPath, 'utf8')
    expect(source).toContain("requiredEnvironment('SMOKE_EXPECTED_APP_SHA256')")
    expect(source).toContain("requiredEnvironment('SMOKE_EXPECTED_VERSION')")
    expect(source).toContain("requiredEnvironment('SMOKE_TARGET_SELECTOR_FILE')")
    expect(source).toContain("getByTestId('mission-offset-input').fill('48'")
    expect(source).toContain('MINIMUM_FIELD_FIX_COUNT = 8_000')
    expect(source).toContain("'FIELD_WORKLOAD_TOO_SMALL'")
    expect(source).not.toContain('SMOKE_TARGET_DEVICE_ID')
    expect(source).not.toContain('--target-device')
    expect(source).toContain('parsePrivateTargetSelector(')
  })

  it('uses a direct GET-only source oracle and reconciles every exact lane and page', () => {
    const source = readFileSync(scriptPath, 'utf8')
    expect(source).toContain("method: 'GET'")
    expect(source).not.toMatch(/method:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/u)
    expect(source).toContain("'/api/positions'")
    expect(source).toContain('listExactBreadcrumbDotPage')
    expect(source).toContain("getSource('tracking-breadcrumb-dots-exact')")
    expect(source).toContain("queryRenderedFeatures(undefined, { layers: ['tracking-breadcrumbs-dots'] })")
    expect(source).toContain("getSource('tracking')")
    expect(source).toContain("featureKind === 'breadcrumb'")
    expect(source).toContain("testId: 'exact-breadcrumb-dots-earlier'")
    expect(source).toContain("testId: 'exact-breadcrumb-dots-later'")
    expect(source).toContain('validateExactPageTraversal(')
    expect(source).toContain('assertExactFixEvidenceChain(')
    expect(source).toContain('assertExactFixSequence(')
    expect(source).toContain("getByTestId('exact-breadcrumb-dot-page-summary')")
    expect(source).toContain('auditRenderedExactGeoJsonFeatures(')
    expect(source).toContain('createExactIdentityTimeEvidence(')
    expect(source).toContain('auditRenderedCoordinateDeviation(')
    expect(source).toContain('renderedAudit: uiPages.renderedAudit')
    expect(source).toContain('renderedCoordinateDeviation: uiPages.renderedCoordinateDeviation')
    expect(source).toContain('mergeRenderedAuditDiagnostics(')
    expect(source).toContain('screenDisplacementX')
    expect(source).toContain('screenDisplacementY')
  })

  it('proves the sole target selection and closes Devices before bounded page navigation', () => {
    const source = readFileSync(scriptPath, 'utf8')
    const setupStart = source.indexOf("const activeToggle = page.getByTestId(")
    const setupEnd = source.indexOf('const targetDeviceName', setupStart)
    const setupSource = source.slice(setupStart, setupEnd)
    const captureStart = source.indexOf('async function captureAllUiExactPages(input)')
    const captureEnd = source.indexOf('/** Creates one allowlisted accumulator', captureStart)
    const captureSource = source.slice(captureStart, captureEnd)

    expect(setupSource).toContain('await assertSoleActiveTarget(')
    expect(setupSource).toContain("click({ timeout: EXACT_UI_ACTION_TIMEOUT_MS })")
    expect(setupSource).not.toContain('force: true')
    expect(captureSource).toContain('await assertSoleActiveTarget(')
    expect(captureSource).toContain('await assertBreadcrumbDotsActive(')
    expect(captureSource).toContain("getByTestId('workspace-close-btn').click({")
    expect(captureSource).toContain("state: 'hidden'")
    expect(captureSource.indexOf("state: 'hidden'")).toBeLessThan(
      captureSource.indexOf('for (let pageIndex = 0;'),
    )
    expect(captureSource).toContain('clickLiveExactPageControl({')
    expect(captureSource).toContain('timeoutMs: EXACT_UI_ACTION_TIMEOUT_MS')
    expect(captureSource).not.toContain('force: true')
  })

  it('retains one mode-0600 allowlisted failure report before deleting private state', () => {
    const source = readFileSync(scriptPath, 'utf8')
    const catchStart = source.indexOf('} catch (error) {')
    const catchEnd = source.indexOf('} finally {', catchStart)
    const catchSource = source.slice(catchStart, catchEnd)

    expect(source).toContain('buildAllowlistedLiveExactFailureReport(')
    expect(catchSource).toContain('await writeFile(summaryPath')
    expect(catchSource).toContain('mode: 0o600')
    expect(catchSource).toContain('reportWritten = true')
    expect(catchSource).not.toContain('error.message')
    expect(source).toContain('firstMismatch')
    expect(source).toContain('lastMismatch')
    expect(source).toContain('mismatchObservationCount')
  })

  it('keeps the Dots screenshot private and writes only allowlisted evidence after cleanup', () => {
    const source = readFileSync(scriptPath, 'utf8')
    expect(source).toContain("getByTestId('breadcrumb-mode-dots')")
    expect(source).toContain('privateDotsScreenshotPath')
    expect(source).toContain("'PRIVATE_SCREENSHOT_DEVICE_NAME_VISIBLE'")
    expect(source).toContain("layers: ['tracking-devices-label']")
    expect(source).toContain('await chmod(privateDotsScreenshotPath, 0o600)')
    expect(source).toContain('if (screenshotWritten && !passReportWritten)')
    expect(source).toContain('buildAllowlistedLiveExactReport(')
    expect(source).toContain('await rm(userDataRoot, { recursive: true, force: true })')
    expect(source).toContain('providerPayload = null')
    expect(source).toContain('rawFixes.splice(0, rawFixes.length)')
    expect(source.indexOf('await rm(userDataRoot, { recursive: true, force: true })'))
      .toBeLessThan(source.indexOf('await writeFile(summaryPath'))
    expect(source).not.toContain('console.log(targetDeviceId')
    expect(source).not.toContain('console.log(providerPayload')
    expect(source).not.toContain('appProcess.stdout.pipe')
    expect(source).not.toContain('appProcess.stderr.pipe')
  })

  it('waits for signal-terminated owned processes before opening or deleting their profile', () => {
    const source = readFileSync(scriptPath, 'utf8')
    const finallyStart = source.indexOf('} finally {')
    const finallySource = source.slice(finallyStart)

    expect(source).toContain('stopOwnedProcess as stopLifecycleOwnedProcess')
    expect(source).toContain('runCleanupStep')
    expect(source).toContain('let launchCleanupPromise = null')
    expect(source).toContain('async function closeOwnedLiveLaunch()')
    expect(source).toContain('runCleanupStep(() => activeBrowser.close()')
    expect(source).toContain('await stopLifecycleOwnedProcess(activeProcess')
    expect(source).toContain("throw new Error('OWNED_PROCESS_CLEANUP_FAILED')")
    expect(finallySource).toContain('cleanupCompleted = true')
    expect(finallySource).toContain('if (cleanupCompleted)')
    expect(finallySource).not.toContain('stopOwnedProcess(appProcess).catch')
    expect(finallySource.indexOf('if (cleanupCompleted)')).toBeLessThan(
      finallySource.indexOf('await rm(userDataRoot'),
    )
  })

  it('fails the CDP launch promptly when the packaged process exits by signal', () => {
    const source = readFileSync(scriptPath, 'utf8')
    const waitStart = source.indexOf('async function waitForCdp')
    const waitSource = source.slice(waitStart)

    expect(waitSource).toContain('signalCode')
    expect(waitSource).toMatch(/exitCode\s*===\s*null[\s\S]*signalCode\s*===\s*null/iu)
  })

  it('records the actual rendered, SQLite, cleanup, and report failure phases', () => {
    const source = readFileSync(scriptPath, 'utf8')

    expect(source).toContain("input.failureProgress.phase = 'renderedMap'")
    expect(source).toContain("failureProgress.phase = 'sqlite'")
    expect(source).toContain("failureProgress.phase = 'report'")
    expect(source).toContain("failureProgress.phase = 'cleanup'")
  })

  it('bounds the independent SQLite lane to the same mission start as provider and exact pages', () => {
    const source = readFileSync(scriptPath, 'utf8')
    const sqliteStart = source.indexOf('function readExactSQLiteRows')
    const sqliteEnd = source.indexOf('function assertEvidenceMatches')
    const sqliteSource = source.slice(sqliteStart, sqliteEnd)

    expect(source).toContain('missionStart: mission.start_time')
    expect(sqliteSource).toMatch(/timestamp\s*>=\s*\?/iu)
    expect(sqliteSource).toContain('input.missionStart')
  })

  it('measures paused target stability only across the mission exact-history window', () => {
    const source = readFileSync(scriptPath, 'utf8')
    const stabilityCallStart = source.indexOf(
      'const stableWindow = await waitForPausedTargetStability',
    )
    const stabilityCallEnd = source.indexOf('const sourceStartedAt', stabilityCallStart)
    const stabilityCall = source.slice(stabilityCallStart, stabilityCallEnd)
    const windowStart = source.indexOf('async function readTargetPositionWindow')
    const windowEnd = source.indexOf('async function fetchProviderPositionsGetOnly')
    const windowSource = source.slice(windowStart, windowEnd)

    expect(stabilityCall).toContain('missionStart: mission.start_time')
    expect(windowSource).toContain('missionStart')
    expect(windowSource).toMatch(/position\.timestamp\s*<\s*missionStart/iu)
  })
})
