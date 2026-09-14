#!/usr/bin/env node

import { _electron as electron } from 'playwright'
import { extractFile, listPackage, statFile } from '@electron/asar'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  buildSyntheticViewRequest,
  comparePackagedRuntimeEntries,
  createSyntheticMbtilesPackage,
  expectedOfficialMapSource,
  isCanonicalOfficialRasterTemplate,
  isOfficialRasterSourceReady,
  installOfficialMapStyleSettlementCapture,
  installOfficialMapRenderCapture,
  isSyntheticTargetCamera,
  runBoundedOfficialMapSelection,
  registerPassiveRendererDiagnostics,
  resetOfficialMapsSettings,
  SYNTHETIC_MAP_ID,
  SYNTHETIC_TARGET_TILE,
  waitForRenderedEvidence,
  xyzTileBounds,
} from '../build/electron-official-map-qualification-smoke-lib.js'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const { NO_COVERAGE_TILE_BASE64: noCoverageTileBase64 } = require(
  '../electron/official-map-no-coverage.cjs',
)
const RENDER_EVIDENCE_KEY = '__SARTRACKER_WAR11_RENDER_EVIDENCE__'
const RENDER_EVIDENCE_TIMEOUT_MS = 10_000
const STYLE_SETTLEMENT_KEY = '__SARTRACKER_WAR11_STYLE_SETTLEMENT__'
const STYLE_SETTLEMENT_TIMEOUT_MS = 15_000

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const evidenceRoot = path.resolve(options.evidenceDir)
  await mkdir(evidenceRoot, { recursive: true })
  const evidenceDir = await mkdtemp(path.join(evidenceRoot, 'run-'))
  const userDataDir = path.join(evidenceDir, 'user-data')
  await mkdir(userDataDir, { recursive: true })

  const validPackagePath = path.join(evidenceDir, 'synthetic-valid.mbtiles')
  const missingPackagePath = path.join(evidenceDir, 'synthetic-missing-target.mbtiles')
  const invalidPackagePath = path.join(evidenceDir, 'synthetic-invalid-tile.mbtiles')
  const replacementPackagePath = path.join(evidenceDir, 'synthetic-replacement.mbtiles')
  let validFixture
  let missingFixture
  let invalidFixture
  let replacementFixture
  let app
  let page = null
  try {
    validFixture = createSyntheticMbtilesPackage(validPackagePath, { variant: 'a' })
    missingFixture = createSyntheticMbtilesPackage(missingPackagePath, { missingTile: true })
    invalidFixture = createSyntheticMbtilesPackage(invalidPackagePath, {
      tileBytes: Buffer.from('synthetic-invalid-image-bytes', 'utf8'),
    })
    replacementFixture = createSyntheticMbtilesPackage(replacementPackagePath, { variant: 'b' })

    app = await electron.launch({
      executablePath: options.appPath,
      args: ['--ignore-gpu-blocklist', ...options.extraArgs],
      env: {
        ...process.env,
        SARTRACKER_ELECTRON_BLOCK_NETWORK: '1',
        SARTRACKER_ELECTRON_USER_DATA_PATH: userDataDir,
      },
    })
  } catch (error) {
    await writeFile(path.join(evidenceDir, 'launch-error.raw.log'), rawLaunchError(error), 'utf8')
    await writeJson(path.join(evidenceDir, 'failure.json'), {
      schema: 'sartracker-war11-official-map-qualification-failure-v1',
      phase: app === undefined ? 'prelaunch-or-launch' : 'launch',
      error: error instanceof Error ? error.message : String(error),
      cleanupOwner: 'playwright-launch',
      externalExitObserved: false,
      launchErrorArtifact: 'launch-error.raw.log',
      evidenceRoot,
      evidenceDir,
      userDataDir,
      appPath: options.appPath,
    })
    throw error
  }
  const appProcess = app.process()
  const appExitPromise = waitForProcessExit(appProcess)
  const appStdout = []
  const appStderr = []
  appProcess.stdout?.on('data', (chunk) => appStdout.push(Buffer.from(chunk)))
  appProcess.stderr?.on('data', (chunk) => appStderr.push(Buffer.from(chunk)))
  let summaryPayload = null
  let workflowError = null
  let failureScreenshotError = null
  let failureScreenshotPath = null
  let failureScreenshotAttempted = false
  let diagnosticPhase = 'before-window'
  const rendererDiagnostics = []
  let diagnosticSequence = 0
  let cleanupRendererDiagnostics = null
  let styleSettlement = null
  let styleSettlementDiagnostics = null

  try {
    page = await app.firstWindow()
    cleanupRendererDiagnostics = registerPassiveRendererDiagnostics(
      page,
      () => diagnosticPhase,
      rendererDiagnostics,
      () => ++diagnosticSequence,
    )
    diagnosticPhase = 'window-acquired'
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.getByTestId('app-shell').waitFor({ timeout: 45_000 })
    await page.waitForFunction(() => window.__SARTRACKER_MAP__ !== undefined, null, { timeout: 45_000 })

    const runtime = await app.evaluate(({ app: electronApp }) => ({
      appPath: electronApp.getAppPath(),
      isPackaged: electronApp.isPackaged,
      electron: process.versions.electron,
      node: process.versions.node,
      modules: process.versions.modules,
    }))
    assertPackagedRuntime(runtime)
    const buildIdentity = {
      asarSha256: await sha256File(runtime.appPath),
      sourceInputs: await readSourceInputHashes(),
      packagedRuntimeInputs: await attestPackagedRuntimeInputs(runtime.appPath),
    }
    const blockedNetwork = await page.evaluate(async () => {
      try {
        await fetch('https://example.com/sartracker-war11-network-probe', { cache: 'no-store' })
        return false
      } catch {
        return true
      }
    })
    if (!blockedNetwork) throw new Error('Network block probe unexpectedly reached HTTPS.')

    diagnosticPhase = 'provider-reset'
    const currentSettings = await loadOfficialMapSettings(page)
    const resetSettings = await saveSettings(page, resetOfficialMapsSettings(currentSettings))
    assertProviderReset(resetSettings)
    const registered = await savePackage(page, validPackagePath)
    assertReadyPackage(registered, 'initial synthetic package')
    const initialTile = await fetchSyntheticTile(page)
    if (!Buffer.from(initialTile.bytesBase64, 'base64').equals(validFixture.tileBytes)) {
      throw new Error('Initial synthetic package tile was not served through the production IPC path.')
    }

    diagnosticPhase = 'initial-render'
    const selection = await selectSyntheticMap(page)
    styleSettlement = selection.settlement
    const targetCamera = await jumpToSyntheticTile(page, selection.deadlineAt)
    assertSyntheticTargetCamera(targetCamera, 'initial synthetic target')
    const mapEvidence = await waitForRenderedVariant(page, 'a', 'initial synthetic map render')
    assertRenderedVariant(mapEvidence, 'a', 'initial synthetic map render')
    assertOfficialSource(mapEvidence, 'initial synthetic map render')
    await page.screenshot({ path: path.join(evidenceDir, '01-synthetic-offline-map.png'), fullPage: true })
    await page.locator('[data-testid="map-container"] canvas').screenshot({
      path: path.join(evidenceDir, '01-synthetic-map-canvas.png'),
    })

    const complete = await checkSyntheticView(page)
    assertStatus(complete, 'complete', 'complete current-view check')
    if (complete.totalTiles !== 1 || complete.usableTiles !== 1) {
      throw new Error('Complete current-view check did not verify exactly one synthetic tile.')
    }
    const completeOperatorCheck = await checkCurrentViewFromOperator(page, true)
    assertCoverageResult(completeOperatorCheck, 'complete', 'complete operator Check View')

    diagnosticPhase = 'missing-render'
    const missingRegistered = await savePackage(page, missingPackagePath)
    assertReadyPackage(missingRegistered, 'missing-target package metadata')
    const missingTile = await fetchSyntheticTile(page)
    if (!Buffer.from(missingTile.bytesBase64, 'base64').equals(Buffer.from(noCoverageTileBase64, 'base64'))) {
      throw new Error('Missing target tile did not return the exact repaired no-coverage hatch bytes.')
    }
    const missingMapEvidence = await waitForMapEvidence(
      page,
      (evidence) => isVisibleNoCoverageHatch(evidence),
      'missing target visible no-coverage hatch',
    )
    assertOfficialSource(missingMapEvidence, 'missing target map render')
    const missing = await checkSyntheticView(page)
    assertStatus(missing, 'missing', 'missing-target current-view check')
    if (missing.usableTiles !== 0) throw new Error('Missing target tile was counted as usable.')

    diagnosticPhase = 'invalid-package'
    const invalidRegistered = await savePackage(page, invalidPackagePath)
    assertPackageStatus(invalidRegistered, 'invalid', 'invalid tile package')
    const invalidOperatorCheck = await checkCurrentViewFromOperator(page, false)
    assertCoverageResult(invalidOperatorCheck, 'incomplete', 'invalid package operator Check View')
    await assertVisibleOfficialWarning(page, /missing|unreadable|unavailable|incomplete/u, 'invalid package operator warning')

    diagnosticPhase = 'replacement-render'
    const restored = await savePackage(page, validPackagePath)
    assertReadyPackage(restored, 'restored synthetic package')
    const beforeReplacement = await fetchSyntheticTile(page)
    if (!Buffer.from(beforeReplacement.bytesBase64, 'base64').equals(validFixture.tileBytes)) {
      throw new Error('Restored synthetic package did not serve variant A.')
    }

    await replacePackageAtomically(replacementPackagePath, validPackagePath)
    const staleFetch = await tryFetchSyntheticTile(page)
    if (staleFetch.ok && Buffer.from(staleFetch.value.bytesBase64, 'base64').equals(validFixture.tileBytes)) {
      throw new Error('Same-path replacement served stale variant A content.')
    }
    const withdrawn = await loadOfficialMapSettings(page)
    assertPackageStatus(withdrawn, 'invalid', 'same-path replacement withdrawal')

    const reverified = await savePackage(page, validPackagePath)
    assertReadyPackage(reverified, 'same-path replacement revalidation')
    const afterReplacement = await fetchSyntheticTile(page)
    if (!Buffer.from(afterReplacement.bytesBase64, 'base64').equals(replacementFixture.tileBytes)) {
      throw new Error('Revalidated same-path replacement did not serve variant B.')
    }
    const replacementMapEvidence = await waitForRenderedVariant(page, 'b', 'same-path replacement map render')
    assertOfficialSource(replacementMapEvidence, 'same-path replacement map render')
    const replacementOperatorCheck = await checkCurrentViewFromOperator(page, true)
    assertCoverageResult(replacementOperatorCheck, 'complete', 'replacement operator Check View')
    await page.screenshot({ path: path.join(evidenceDir, '02-synthetic-replacement-map.png'), fullPage: true })
    await page.locator('[data-testid="map-container"] canvas').screenshot({
      path: path.join(evidenceDir, '02-synthetic-replacement-map-canvas.png'),
    })

    diagnosticPhase = 'automatic-removal'
    await rm(validPackagePath, { force: true })
    const automaticRemoval = await waitForAutomaticPackageWithdrawal(page, validPackagePath)
    assertPackageStatus(automaticRemoval.settings, 'invalid', 'automatic removed package withdrawal')
    const withdrawnPackage = automaticRemoval.settings.officialMaps.packages[0]
    if (withdrawnPackage?.attestation !== undefined) {
      throw new Error('Automatic removed package withdrawal retained its old attestation.')
    }
    await page.screenshot({ path: path.join(evidenceDir, '03-automatic-removed-map.png'), fullPage: true })
    await page.locator('[data-testid="map-container"] canvas').screenshot({
      path: path.join(evidenceDir, '03-automatic-removed-map-canvas.png'),
    })

    diagnosticPhase = 'removed-render'
    await savePackage(page, validPackagePath)
    const removed = await loadOfficialMapSettings(page)
    assertPackageStatus(removed, 'missing', 'removed package withdrawal')
    const removedCheck = await checkSyntheticView(page)
    if (removedCheck.status === 'complete' || removedCheck.usableTiles !== 0) {
      throw new Error('Removed package retained current-view readiness.')
    }
    const removedMapEvidence = await waitForMapEvidence(
      page,
      (evidence) => hasLoadedMapGpuEvidence(evidence)
        && !isRenderedVariant(evidence, 'a')
        && !isRenderedVariant(evidence, 'b'),
      'removed package map withdrawal',
    )
    assertOfficialSource(removedMapEvidence, 'removed package map withdrawal')
    await assertVisibleOfficialWarning(page, /missing|unreadable|unavailable/u, 'removed package operator warning')
    const removedOperatorCheck = await checkCurrentViewFromOperator(page, false)
    assertCoverageResult(removedOperatorCheck, 'missing', 'removed package operator Check View')
    await assertVisibleOfficialWarning(page, /missing|unreadable|unavailable/u, 'removed package Check View warning')
    await page.screenshot({ path: path.join(evidenceDir, '03-synthetic-removed-map.png'), fullPage: true })
    await page.locator('[data-testid="map-container"] canvas').screenshot({
      path: path.join(evidenceDir, '03-synthetic-removed-map-canvas.png'),
    })

    summaryPayload = {
      schema: 'sartracker-war11-official-map-qualification-v1',
      runtime,
      buildIdentity,
      blockedNetwork,
      providerIsolation: {
        sourceType: resetSettings.officialMaps.sourceType,
        sourcePath: resetSettings.officialMaps.sourcePath,
        availableSources: resetSettings.officialMaps.availableSources,
        mainMapGenieFallbackEligible: false,
        rendererNetworkProbeBlocked: blockedNetwork,
      },
      package: {
        mapId: SYNTHETIC_MAP_ID,
        targetTile: SYNTHETIC_TARGET_TILE,
        initialTileBytes: Buffer.from(initialTile.bytesBase64, 'base64').length,
        replacementTileBytes: Buffer.from(afterReplacement.bytesBase64, 'base64').length,
        missingTileBytes: Buffer.from(missingTile.bytesBase64, 'base64').length,
        missingTileExactNoCoverage: true,
        validTileCount: validFixture.tileCount,
        missingTileCount: missingFixture.tileCount,
        invalidTileCount: invalidFixture.tileCount,
        replacementTileCount: replacementFixture.tileCount,
        initialStatus: registered.officialMaps.packages[0]?.status,
        missingStatus: missingRegistered.officialMaps.packages[0]?.status,
        invalidStatus: invalidRegistered.officialMaps.packages[0]?.status,
        withdrawnStatus: withdrawn.officialMaps.packages[0]?.status,
        removedStatus: removed.officialMaps.packages[0]?.status,
      },
      styleSettlement,
      styleSettlementDiagnostics,
      initialTargetCamera: targetCamera,
      checks: {
        complete,
        completeOperatorCheck,
        replacementOperatorCheck,
        missing,
        invalidOperatorCheck,
        removed: removedCheck,
        removedOperatorCheck,
        staleReplacementServedOldContent: false,
      },
      rendererDiagnostics: {
        artifact: 'renderer-diagnostics.json',
        preWindowCaptureGuaranteed: false,
        entryCount: rendererDiagnostics.length,
      },
      mapEvidence,
      missingMapEvidence,
      replacementMapEvidence,
      automaticRemoval,
      removedMapEvidence,
      evidenceDir,
    }
  } catch (error) {
    workflowError = error
  } finally {
    diagnosticPhase = workflowError === null ? 'teardown' : 'workflow-failure'
    if (page !== null) {
      try {
        styleSettlementDiagnostics = await withTimeout(
          page.evaluate((key) => {
            const state = window[key]
            if (state === undefined) return null
            return {
              styleDataCount: state.styleDataCount,
              latest: state.latest,
              cleaned: state.cleaned === true,
              listenerActive: state.cleaned !== true,
            }
          }, STYLE_SETTLEMENT_KEY),
          1_000,
          'Style settlement diagnostics read timed out.',
        )
      } catch (error) {
        styleSettlementDiagnostics = {
          readError: error instanceof Error ? error.message : String(error),
        }
      }
    }
    if (workflowError !== null && page !== null) {
      failureScreenshotAttempted = true
      try {
        await withTimeout(
          page.screenshot({ path: path.join(evidenceDir, 'workflow-failure.png'), fullPage: true }),
          5_000,
          'Failure screenshot did not complete within the bounded window.',
        )
        failureScreenshotPath = 'workflow-failure.png'
      } catch (error) {
        failureScreenshotError = error instanceof Error ? error.message : String(error)
      }
    }
    if (cleanupRendererDiagnostics !== null) {
      try {
        const cleanupResult = cleanupRendererDiagnostics()
        if (cleanupResult?.cleaned !== true) throw new Error('Renderer diagnostics cleanup did not confirm listener removal.')
      } catch (error) {
        workflowError ??= error
      }
    }
    let closeError = null
    let exit = null
    const teardownActions = []
    try {
      await withTimeout(app.close(), 15_000, 'Packaged Electron app.close() did not complete.')
    } catch (error) {
      closeError = error
    }
    try {
      exit = await withTimeout(appExitPromise, 15_000, 'Packaged Electron process did not exit after app.close().')
    } catch (error) {
      closeError ??= error
    }
    if (exit === null && appProcess.exitCode === null && appProcess.signalCode === null) {
      teardownActions.push('SIGTERM-owned-electron-child')
      appProcess.kill('SIGTERM')
      try {
        exit = await withTimeout(appExitPromise, 5_000, 'Owned Electron child did not exit after SIGTERM.')
      } catch (error) {
        closeError ??= error
      }
    }
    if (exit === null && appProcess.exitCode === null && appProcess.signalCode === null) {
      teardownActions.push('SIGKILL-owned-electron-child')
      appProcess.kill('SIGKILL')
      try {
        exit = await withTimeout(appExitPromise, 5_000, 'Owned Electron child did not exit after SIGKILL.')
      } catch (error) {
        closeError ??= error
      }
    }
    await writeFile(path.join(evidenceDir, 'electron-app.stdout.log'), Buffer.concat(appStdout))
    await writeFile(path.join(evidenceDir, 'electron-app.stderr.log'), Buffer.concat(appStderr))
    await writeFile(
      path.join(evidenceDir, 'electron-app.raw.log'),
      Buffer.concat([
        Buffer.from('--- stdout ---\n'),
        Buffer.concat(appStdout),
        Buffer.from('\n--- stderr ---\n'),
        Buffer.concat(appStderr),
      ]),
    )
    await writeJson(path.join(evidenceDir, 'renderer-diagnostics.json'), {
      schema: 'sartracker-war11-renderer-diagnostics-v1',
      preWindowCaptureGuaranteed: false,
      entries: rendererDiagnostics,
    })
    await rm(replacementPackagePath, { force: true })
    const cleanExit = closeError === null && exit?.code === 0 && exit.signal === null
    if (workflowError === null && summaryPayload !== null && cleanExit) {
      await writeJson(path.join(evidenceDir, 'summary.json'), {
        ...summaryPayload,
        styleSettlementDiagnostics,
        processExit: {
          exit,
          teardownActions,
          cleanExit,
        },
      })
    } else {
      await writeJson(path.join(evidenceDir, 'failure.json'), {
        schema: 'sartracker-war11-official-map-qualification-failure-v1',
        error: workflowError instanceof Error ? workflowError.message : workflowError === null ? null : String(workflowError),
        closeError: closeError instanceof Error ? closeError.message : closeError === null ? null : String(closeError),
        failureScreenshot: failureScreenshotPath,
        failureScreenshotAttempted,
        failureScreenshotError,
        failureScreenshotLimitation: failureScreenshotAttempted
          ? null
          : page === null
            ? 'No renderer window was acquired; no failure screenshot was attempted.'
            : 'Failure was detected during teardown after the workflow screenshot phase.',
        captureCleanupBoundary: 'If bounded render lifecycle cleanup fails, owned Electron app teardown is the final cleanup boundary.',
        styleSettlementDiagnostics,
        rendererDiagnosticsArtifact: 'renderer-diagnostics.json',
        exit,
        teardownActions,
        cleanExit,
        evidenceDir,
      })
    }
    if (workflowError === null && !cleanExit) {
      workflowError = new Error(
        closeError?.message ?? `Packaged Electron exited abnormally (code=${exit?.code ?? 'unknown'}, signal=${exit?.signal ?? 'unknown'}).`,
      )
    }
  }
  if (workflowError !== null) throw workflowError
}

/** Saves one package through the renderer bridge and production settings IPC. */
async function savePackage(page, packagePath) {
  return page.evaluate(async ({ mapId, nextPackagePath }) => {
    const bridge = window.sartrackerElectron
    if (bridge === undefined) throw new Error('Electron bridge is not available.')
    const current = await bridge.loadAppSettings()
    const reset = {
      ...current,
      officialMaps: {
        ...current.officialMaps,
        sourceType: 'none',
        sourcePath: '',
        status: 'not_configured',
        availableSources: [],
        serviceCount: 0,
        username: '',
        message: 'Official maps are not configured.',
        packages: [],
      },
    }
    return bridge.saveAppSettings({
      ...reset,
      officialMaps: {
        ...reset.officialMaps,
        packages: [{ sourceType: 'mbtiles', mapId, packagePath: nextPackagePath }],
      },
    })
  }, { mapId: SYNTHETIC_MAP_ID, nextPackagePath: packagePath })
}

/** Saves a complete settings revision through the production renderer bridge. */
async function saveSettings(page, settings) {
  return page.evaluate(async (nextSettings) => {
    const bridge = window.sartrackerElectron
    if (bridge === undefined) throw new Error('Electron bridge is not available.')
    return bridge.saveAppSettings(nextSettings)
  }, settings)
}

/** Proves the provider branch was disabled before the synthetic package was registered. */
function assertProviderReset(settings) {
  const officialMaps = settings.officialMaps
  if (
    officialMaps.sourceType !== 'none' ||
    officialMaps.status !== 'not_configured' ||
    officialMaps.sourcePath !== '' ||
    officialMaps.availableSources.length !== 0
  ) {
    throw new Error(`Official map provider reset was not persisted exactly: ${JSON.stringify(officialMaps)}`)
  }
}

/** Requires a packaged asar app so the qualification cannot be mistaken for a source checkout launch. */
function assertPackagedRuntime(runtime) {
  if (!runtime.isPackaged || !runtime.appPath.endsWith('.asar')) {
    throw new Error(`Qualification requires a packaged Electron app with an .asar app path: ${JSON.stringify(runtime)}`)
  }
}

/** Records hashes of the packaged asar and the source inputs used to build it. */
async function readSourceInputHashes() {
  const names = [
    'package.json',
    'package-lock.json',
    'electron-builder.json',
    'electron/main.cjs',
    'electron/preload.cjs',
  ]
  const entries = {}
  for (const name of names) {
    entries[name] = await sha256File(path.join(projectRoot, name))
  }
  return entries
}

/** Hashes one local build input without exposing its contents in qualification evidence. */
async function sha256File(filePath) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filePath)) hash.update(chunk)
  return hash.digest('hex')
}

/** Hashes one bounded in-memory package entry. */
function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

/** Compares the packaged runtime trees and built renderer outputs with current source/build files. */
async function attestPackagedRuntimeInputs(archivePath) {
  const expectedPaths = [
    ...await filesUnder(path.join(projectRoot, 'electron'), 'electron'),
    ...await filesUnder(path.join(projectRoot, 'shared'), 'shared'),
    ...await filesUnder(path.join(projectRoot, 'dist'), 'dist'),
  ].sort()
  const expected = {}
  for (const relativePath of expectedPaths) {
    expected[relativePath] = sha256Bytes(await readFile(path.join(projectRoot, relativePath)))
  }

  const actual = {}
  for (const entry of listPackage(archivePath)) {
    const relativePath = entry.replace(/^\/+/, '')
    if (!isRelevantPackagedRuntimeEntry(relativePath)) continue
    const stat = statFile(archivePath, relativePath, false)
    if (stat.files) continue
    if (stat.link) throw new Error(`Packaged runtime entry unexpectedly links: ${relativePath}`)
    actual[relativePath] = sha256Bytes(extractFile(archivePath, relativePath))
  }
  const comparison = comparePackagedRuntimeEntries(expected, actual)
  return {
    ...comparison,
    sourceHashes: expected,
    packagedHashes: actual,
  }
}

/** Returns the runtime entries whose bytes must be bound to the current source/build tree. */
function isRelevantPackagedRuntimeEntry(relativePath) {
  return relativePath.startsWith('electron/')
    || relativePath.startsWith('shared/')
    || relativePath.startsWith('dist/')
}

/** Recursively lists regular source files under one runtime tree with ASAR-relative names. */
async function filesUnder(directory, prefix, include = () => true) {
  const output = []
  async function walk(currentDirectory, currentPrefix) {
    const entries = await readdir(currentDirectory, { withFileTypes: true })
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const sourcePath = path.join(currentDirectory, entry.name)
      const relativePath = `${currentPrefix}/${entry.name}`
      if (entry.isDirectory()) {
        await walk(sourcePath, relativePath)
      } else if (entry.isFile() && include(relativePath)) {
        output.push(relativePath)
      } else if (!entry.isFile()) {
        throw new Error(`Runtime source tree contains unsupported entry: ${relativePath}`)
      }
    }
  }
  await walk(directory, prefix)
  return output
}

/** Preserves raw Playwright launch diagnostics without claiming an external child was observed. */
function rawLaunchError(error) {
  const message = error instanceof Error ? error.message : String(error)
  const stack = error instanceof Error && typeof error.stack === 'string' ? error.stack : String(error)
  const callLog = String(error)
  return `--- message ---\n${message}\n--- stack ---\n${stack}\n--- call log ---\n${callLog}\n`
}

/** Reads the persisted app settings after an external package mutation. */
async function loadOfficialMapSettings(page) {
  return page.evaluate(async () => {
    const bridge = window.sartrackerElectron
    if (bridge === undefined) throw new Error('Electron bridge is not available.')
    return bridge.loadAppSettings()
  })
}

/** Fetches one local tile via the production renderer-to-main IPC bridge. */
async function fetchSyntheticTile(page) {
  return page.evaluate(async (tile) => {
    const bridge = window.sartrackerElectron
    if (bridge?.fetchOfficialMapTile === undefined) throw new Error('Official map tile bridge is unavailable.')
    return bridge.fetchOfficialMapTile(
      `sartracker-official-map://tile/${tile.mapId}/${tile.z}/${tile.x}/${tile.y}.png`,
    )
  }, { ...SYNTHETIC_TARGET_TILE, mapId: SYNTHETIC_MAP_ID })
}

/** Captures a failed or successful tile request without hiding stale-content evidence. */
async function tryFetchSyntheticTile(page) {
  return page.evaluate(async (tile) => {
    try {
      const bridge = window.sartrackerElectron
      if (bridge?.fetchOfficialMapTile === undefined) throw new Error('Official map tile bridge is unavailable.')
      return { ok: true, value: await bridge.fetchOfficialMapTile(
        `sartracker-official-map://tile/${tile.mapId}/${tile.z}/${tile.x}/${tile.y}.png`,
      ) }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }, { ...SYNTHETIC_TARGET_TILE, mapId: SYNTHETIC_MAP_ID })
}

/** Calls the production native current-view checker for one inset synthetic tile footprint. */
async function checkSyntheticView(page) {
  return page.evaluate(async (request) => {
    const bridge = window.sartrackerElectron
    if (bridge?.checkOfficialMapView === undefined) throw new Error('Official map view checker is unavailable.')
    return bridge.checkOfficialMapView(request)
  }, buildSyntheticViewRequest())
}

/** Selects the synthetic official map through the operator-facing Maps menu. */
async function selectSyntheticMap(page) {
  const settlementDeadline = Date.now() + STYLE_SETTLEMENT_TIMEOUT_MS
  const mapButton = page.getByTestId(`basemap-btn-${SYNTHETIC_MAP_ID}`)
  const settlement = await runBoundedOfficialMapSelection({
    deadlineAt: settlementDeadline,
    openMenu: (timeout) => page.getByTestId('basemap-menu-toggle').click({ timeout }),
    waitForMapButton: (timeout) => mapButton.waitFor({ timeout }),
    installObserver: (timeout, deadlineAt) => withTimeout(
      page.evaluate(installOfficialMapStyleSettlementCapture, {
        key: STYLE_SETTLEMENT_KEY,
        sourceId: SYNTHETIC_MAP_ID,
        deadlineAt,
      }),
      timeout,
      'Synthetic map style settlement setup timed out.',
    ),
    clickMap: (timeout) => mapButton.click({ timeout }),
    waitForSettlement: (deadlineAt) => waitForStyleSettlement(page, deadlineAt),
    cleanupObserver: () => cleanupStyleSettlementObserver(page),
  })
  return { settlement, deadlineAt: settlementDeadline }
}

/** Moves MapLibre to the target synthetic tile at the renderer's z+1 raster mapping. */
async function jumpToSyntheticTile(page, deadlineAt) {
  const bounds = xyzTileBounds(SYNTHETIC_TARGET_TILE.z, SYNTHETIC_TARGET_TILE.x, SYNTHETIC_TARGET_TILE.y)
  return withTimeout(
    page.evaluate(({ bounds: tileBounds }) => {
      const map = window.__SARTRACKER_MAP__
      if (map === undefined) throw new Error('MapLibre instance is unavailable.')
      map.jumpTo({
        center: [(tileBounds.west + tileBounds.east) / 2, (tileBounds.south + tileBounds.north) / 2],
        zoom: 11,
      })
      const center = map.getCenter()
      return { center: [center.lng, center.lat], zoom: map.getZoom() }
    }, { bounds }),
    remainingDeadlineMs(deadlineAt, 'Synthetic target camera setup'),
    'Synthetic target camera setup timed out.',
  )
}

/** Waits for the source-specific styledata restoration callback with bounded cleanup. */
async function waitForStyleSettlement(page, deadline) {
  let latest = null
  let bodyError = null
  try {
    while (Date.now() < deadline) {
      const remaining = deadline - Date.now()
      latest = await withTimeout(
        page.evaluate((key) => window[key]?.latest ?? null, STYLE_SETTLEMENT_KEY),
        remaining,
        'Synthetic map style settlement read timed out.',
      )
      if (Date.now() < deadline && latest !== null) return latest
      await new Promise((resolve) => setTimeout(resolve, Math.min(50, Math.max(1, deadline - Date.now()))))
    }
    bodyError = new Error(`Synthetic map style settlement did not complete: ${JSON.stringify(latest)}`)
  } catch (error) {
    bodyError = error
  }
  let cleanupError = null
  try {
    await cleanupStyleSettlementObserver(page)
  } catch (error) {
    cleanupError = error
  }
  if (bodyError !== null && cleanupError !== null) {
    throw new Error(`${bodyError.message}; ${cleanupError.message}`)
  }
  if (bodyError !== null) throw bodyError
  if (cleanupError !== null) throw cleanupError
  throw new Error('Synthetic map style settlement did not complete.')
}

/** Cleans the style settlement observer with an independent bounded failure path. */
async function cleanupStyleSettlementObserver(page) {
  const cleanup = await withTimeout(
    page.evaluate((key) => {
      const state = window[key]
      if (state === undefined) return { cleaned: true, observed: false }
      state.cleanup?.()
      return { cleaned: state.cleaned === true, observed: true }
    }, STYLE_SETTLEMENT_KEY),
    1_000,
    'Synthetic map style settlement cleanup timed out.',
  )
  if (cleanup.cleaned !== true) throw new Error('Synthetic map style settlement cleanup did not confirm listener removal.')
  return cleanup
}

/** Confirms the renderer moved to the exact synthetic target before evidence polling. */
function assertSyntheticTargetCamera(camera, label) {
  const bounds = xyzTileBounds(SYNTHETIC_TARGET_TILE.z, SYNTHETIC_TARGET_TILE.x, SYNTHETIC_TARGET_TILE.y)
  const expectedCenter = [(bounds.west + bounds.east) / 2, (bounds.south + bounds.north) / 2]
  if (!isSyntheticTargetCamera(camera)) {
    throw new Error(`${label} camera did not match the synthetic tile target: ${JSON.stringify({ camera, expectedCenter, zoom: 11 })}`)
  }
}

/** Installs a bounded MapLibre render callback that captures source, viewport, and GPU evidence in-frame. */
async function startMapRenderCapture(page, deadline) {
  await page.evaluate(installOfficialMapRenderCapture, {
    key: RENDER_EVIDENCE_KEY,
    sourceId: SYNTHETIC_MAP_ID,
    deadlineAt: deadline,
  })
}

/** Reads the latest frame captured by the MapLibre render callback without sampling outside a frame. */
async function readMapEvidence(page) {
  return page.evaluate((key) => window[key]?.latest ?? null, RENDER_EVIDENCE_KEY)
}

/** Removes the bounded render callback and its timer, returning the last frame for diagnostics. */
async function stopMapRenderCapture(page) {
  return page.evaluate((key) => {
    const state = window[key]
    const latest = state?.latest ?? null
    if (state === undefined) return { cleaned: false, latest }
    state.cleanup?.()
    return { cleaned: state.cleaned === true, latest }
  }, RENDER_EVIDENCE_KEY)
}

/** Waits until a rendered canvas observation satisfies a bounded predicate under one absolute deadline. */
async function waitForMapEvidence(page, predicate, label) {
  return waitForRenderedEvidence({
    startCapture: (deadline) => startMapRenderCapture(page, deadline),
    readEvidence: () => readMapEvidence(page),
    predicate,
    stopCapture: () => stopMapRenderCapture(page),
    timeoutMs: RENDER_EVIDENCE_TIMEOUT_MS,
    label,
  })
}

/** Waits for the proxy monitor to withdraw a removed package before any explicit save or tile check. */
async function waitForAutomaticPackageWithdrawal(page, packagePath) {
  const result = await waitForRenderedEvidence({
    startCapture: (deadline) => startMapRenderCapture(page, deadline),
    readEvidence: async () => {
      const settings = await loadOfficialMapSettings(page)
      const mapEvidence = await readMapEvidence(page)
      const warning = await readVisibleMapWarning(page)
      const fieldReady = await readFieldReadinessState(page)
      return { settings, mapEvidence, warning, fieldReady }
    },
    predicate: ({ settings, mapEvidence, warning, fieldReady }) => {
      const mapPackage = settings.officialMaps.packages.find((candidate) => candidate.packagePath === packagePath)
      return mapPackage?.status === 'invalid'
        && mapPackage.attestation === undefined
        && hasLoadedMapGpuEvidence(mapEvidence)
        && !isRenderedVariant(mapEvidence, 'a')
        && !isRenderedVariant(mapEvidence, 'b')
        && fieldReady === false
        && /missing|unreadable|unavailable/u.test(warning ?? '')
    },
    stopCapture: () => stopMapRenderCapture(page),
    timeoutMs: RENDER_EVIDENCE_TIMEOUT_MS,
    label: 'Automatic removed package withdrawal',
  })
  assertOfficialSource(result.mapEvidence, 'automatic removed package withdrawal')
  return result
}

/** Reads the visible map warning without initiating a settings or tile mutation. */
async function readVisibleMapWarning(page) {
  return page.evaluate(() => {
    const warning = document.querySelector('[data-testid="map-offline-warning"]')
    if (!(warning instanceof HTMLElement) || warning.offsetParent === null) return null
    return warning.innerText
  })
}

/** Reads the live Maps field-readiness label without initiating a settings or tile mutation. */
async function readFieldReadinessState(page) {
  const checklist = page.getByTestId('field-readiness-checklist')
  if (!(await checklist.isVisible())) return null
  return /\bField ready\b/u.test(await checklist.innerText())
}

/** Waits for a concrete synthetic palette to be visible in the GPU canvas. */
async function waitForRenderedVariant(page, variant, label) {
  return waitForMapEvidence(page, (evidence) => isRenderedVariant(evidence, variant), label)
}

/** Checks that at least one sampled GPU pixel retains a synthetic tile palette. */
function isRenderedVariant(evidence, variant) {
  const palettes = {
    a: [[0x2c, 0x3e, 0x67], [0x72, 0xd2, 0xb6]],
    b: [[0x24, 0x4f, 0x45], [0xf0, 0xc9, 0x4d]],
  }
  return hasLoadedMapGpuEvidence(evidence)
    && palettes[variant].some((palette) =>
      evidence.sampledPixels.some((pixel) => pixel.length >= 3 && Math.max(
        Math.abs(pixel[0] - palette[0]),
        Math.abs(pixel[1] - palette[1]),
        Math.abs(pixel[2] - palette[2]),
      ) <= 48))
}

/** Checks that the repaired deterministic no-coverage raster is visible in the GPU canvas. */
function isVisibleNoCoverageHatch(evidence) {
  return hasLoadedMapGpuEvidence(evidence)
    && evidence.hatchPixels.length > 0
    && evidence.backgroundPixels.length > 0
}

/** Requires the exact official source id and app-owned tile template in the live MapLibre style. */
function assertOfficialSource(evidence, label) {
  const expected = expectedOfficialMapSource()
  if (!hasOfficialSource(evidence)) {
    throw new Error(`${label} did not select ${expected.id} with the expected app-owned raster template: ${JSON.stringify(evidence)}`)
  }
}

/** Runs the operator-facing Maps > Check View action and returns its visible result text. */
async function checkCurrentViewFromOperator(page, expectedFieldReady) {
  const menuToggle = page.getByTestId('basemap-menu-toggle')
  if (await menuToggle.getAttribute('aria-expanded') !== 'true') await menuToggle.click()
  const coverage = page.getByTestId('basemap-offline-coverage')
  await coverage.waitFor({ state: 'visible', timeout: 15_000 })
  await coverage.getByTestId('check-offline-map-coverage').click()
  await coverage.getByText(/Current view tiles verified|Official offline coverage incomplete|Coverage check unavailable/u).waitFor({
    timeout: 15_000,
  })
  await assertFieldReadiness(page, expectedFieldReady, 'operator Check View')
  return { text: await coverage.innerText() }
}

/** Requires the live Maps field-readiness panel to reflect the operator coverage result. */
async function assertFieldReadiness(page, expectedReady, label) {
  const checklist = page.getByTestId('field-readiness-checklist')
  await checklist.waitFor({ state: 'visible', timeout: 15_000 })
  const text = await checklist.innerText()
  const isReady = /\bField ready\b/u.test(text)
  if (isReady !== expectedReady) {
    throw new Error(`${label} field-readiness state was ${isReady ? 'ready' : 'not ready'}, expected ${expectedReady ? 'ready' : 'not ready'}: ${text}`)
  }
}

/** Asserts the operator-facing result distinguishes complete from incomplete coverage. */
function assertCoverageResult(result, expected, label) {
  const pattern = expected === 'complete'
    ? /Current view tiles verified/u
    : /Official offline coverage incomplete/u
  if (!pattern.test(result.text)) {
    throw new Error(`${label} did not show ${expected} coverage: ${result.text}`)
  }
}

/** Requires a visible operator warning whenever official map readiness is withdrawn. */
async function assertVisibleOfficialWarning(page, pattern, label) {
  const warning = page.getByTestId('map-offline-warning')
  await warning.waitFor({ state: 'visible', timeout: 15_000 })
  const text = await warning.innerText()
  if (!pattern.test(text)) throw new Error(`${label} was not visible or actionable: ${text}`)
}

/** Confirms a loaded MapLibre canvas exposed a usable GPU pixel sample. */
function hasLoadedMapGpuEvidence(evidence) {
  return evidence !== null
    && typeof evidence === 'object'
    && evidence.capturedAtRender === true
    && evidence.canvasWidth > 0
    && evidence.canvasHeight > 0
    && evidence.renderer !== ''
    && evidence.viewport !== null
    && isOfficialRasterSourceReady(evidence)
    && evidence.sampledPixels.length > 0
}

/** Checks the exact official source identity before accepting GPU evidence. */
function hasOfficialSource(evidence) {
  const expected = expectedOfficialMapSource()
  return evidence.selectedSourceId === expected.id
    && evidence.selectedSource?.type === 'raster'
    && Array.isArray(evidence.selectedSource.tiles)
    && evidence.selectedSource.tiles.length === 1
    && isCanonicalOfficialRasterTemplate(evidence.selectedSource.tiles[0], expected.id)
}

/** Asserts that the packaged map rendered the expected synthetic tile variant. */
function assertRenderedVariant(evidence, variant, label) {
  if (!isRenderedVariant(evidence, variant)) {
    throw new Error(`${label} did not produce loaded GPU evidence for variant ${variant}: ${JSON.stringify(evidence)}`)
  }
}

/** Replaces a package path atomically on POSIX and safely falls back on platforms that reject overwrite rename. */
async function replacePackageAtomically(sourcePath, targetPath) {
  try {
    await rename(sourcePath, targetPath)
  } catch (error) {
    if (error?.code !== 'EEXIST' && error?.code !== 'EPERM') throw error
    await rm(targetPath, { force: true })
    await rename(sourcePath, targetPath)
  }
}

/** Asserts that settings validation completed with a usable package attestation. */
function assertReadyPackage(settings, label) {
  assertPackageStatus(settings, 'ready', label)
  const mapPackage = settings.officialMaps.packages[0]
  if (mapPackage?.attestation?.decoderPolicy !== 'native-raster-256-or-512-opaque-v1') {
    throw new Error(`${label} did not receive the native decoder attestation.`)
  }
}

/** Asserts one operator-safe official package status. */
function assertPackageStatus(settings, expected, label) {
  const actual = settings.officialMaps.packages[0]?.status
  if (actual !== expected) throw new Error(`${label} status was ${actual ?? 'missing'}, expected ${expected}.`)
}

/** Asserts the native current-view qualification state. */
function assertStatus(result, expected, label) {
  if (result.status !== expected) throw new Error(`${label} status was ${result.status}, expected ${expected}.`)
}

/** Captures the packaged Electron child exit independently from Playwright close. */
function waitForProcessExit(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve({ code: child.exitCode, signal: child.signalCode })
      return
    }
    child.once('exit', (code, signal) => resolve({ code, signal }))
  })
}

/** Rejects when packaged app teardown exceeds the bounded smoke window. */
async function withTimeout(promise, timeoutMs, message) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/** Returns the remaining milliseconds in one absolute bounded setup lifecycle. */
function remainingDeadlineMs(deadline, label) {
  const remaining = deadline - Date.now()
  if (remaining <= 0) throw new Error(`${label} deadline was exceeded.`)
  return remaining
}

/** Writes an evidence JSON file with stable formatting. */
async function writeJson(filePath, payload) {
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
}

/** Parses the bounded command-line surface for packaged qualification. */
function parseArgs(args) {
  const options = {
    appPath: '',
    evidenceDir: path.join(projectRoot, 'tmp', 'war11-official-map-qualification-smoke'),
    extraArgs: [],
  }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--app') options.appPath = readArgValue(args, ++index, arg)
    else if (arg === '--evidence-dir') options.evidenceDir = readArgValue(args, ++index, arg)
    else if (arg === '--app-arg') options.extraArgs.push(readArgValue(args, ++index, arg, true))
    else throw new Error(`Unknown argument: ${arg}`)
  }
  if (options.appPath === '') throw new Error('Pass --app with the packaged Electron executable path.')
  return options
}

/** Reads one required command-line argument. */
function readArgValue(args, index, name, allowFlagLikeValue = false) {
  const value = args[index]
  if (value === undefined || (!allowFlagLikeValue && value.startsWith('--'))) throw new Error(`${name} requires a value.`)
  return value
}
