#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { execFile } from 'node:child_process'
import { access, copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

import { _electron as electron } from 'playwright'
import { generateMissionStoreFixture } from '../../build/seed-mission-store-runtime.js'
import { hashCandidateFile } from './candidate-artifacts.mjs'
import { createCompositeSourceManifest } from './composite-manifest.mjs'
import { C28_VARIANT_AXIS_MAP } from './composite-coverage.mjs'
import { validateCompositeReceipt, validateCompositeVariantReceipt } from './composite-receipts.mjs'
import { validateCompositeFamilyReceipt } from './composite-family-receipts.mjs'
import { selectPagingSource } from './paging-source.mjs'
import { inspectStandaloneSqliteFixture } from './sqlite-fixture.mjs'
export { COMPOSITE_SOURCE_MANIFEST_PATHS } from './composite-manifest.mjs'

const execFileAsync = promisify(execFile)
const require = createRequire(import.meta.url)
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const SHA1 = /^[a-f0-9]{40}$/u
const PASS_PHRASE = 'C28-Composite-Archive-9!x'
const MISSION_NAME = 'C28 packaged composite synthetic mission'
const COMPOSITE_FAMILY_CONTRACTS = new Set(['C03', 'C11', 'C17'])
const C17_CANARY_IDS = Object.freeze([
  'direct-content-secret',
  'event-password',
  'event-nested-token',
  'nested-array-secret',
  'nested-array-profile-path',
  'url-credentials',
])
const C11_PAGING_TIMEOUT_MS = 10 * 60 * 1_000

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`qualification-composite-probe: ${sanitizeError(error)}`)
    process.exitCode = 1
  })
}

/** Parses only the fixed packaged-probe argument contract. */
export function parseArgs(argv) {
  if (!Array.isArray(argv)) throw new TypeError('Arguments must be an array.')
  const values = {}
  const names = new Set(['--app', '--evidence', '--expected-head', '--variant', '--family-contract'])
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index]
    if (!names.has(name)) throw new Error(`Unknown composite-probe argument: ${name}`)
    if (Object.hasOwn(values, name)) throw new Error(`Duplicate composite-probe argument: ${name}`)
    const value = argv[index + 1]
    if (typeof value !== 'string' || value === '' || value.startsWith('--')) {
      throw new Error(`Composite probe requires ${name} followed by a value.`)
    }
    values[name] = value
    index += 1
  }
  for (const name of ['--app', '--evidence', '--expected-head']) {
    if (!Object.hasOwn(values, name)) throw new Error(`Composite probe requires ${name}.`)
  }
  const appPath = path.resolve(values['--app'])
  const evidencePath = path.resolve(values['--evidence'])
  const expectedHead = values['--expected-head']
  const variant = values['--variant'] ?? 'routine'
  const familyContract = values['--family-contract'] ?? null
  if (!path.isAbsolute(values['--app']) || !path.isAbsolute(values['--evidence'])) {
    throw new Error('Composite probe requires absolute --app and --evidence paths.')
  }
  if (!SHA1.test(expectedHead)) throw new Error('Composite probe --expected-head must be one SHA-1.')
  if (!Object.hasOwn(C28_VARIANT_AXIS_MAP, variant)) {
    throw new Error(`Composite probe --variant is not in the fixed reviewed variant map: ${variant}`)
  }
  if (familyContract !== null && !COMPOSITE_FAMILY_CONTRACTS.has(familyContract)) {
    throw new Error('Composite probe --family-contract is not in the fixed family map: ' + familyContract)
  }
  return Object.freeze({
    appPath, evidencePath, expectedHead, variant,
    ...(familyContract === null ? {} : { familyContract }),
  })
}

/** Runs one same-profile packaged composite workload through the public preload bridge. */
export async function runCompositeProbe(input) {
  const options = normalizeInput(input)
  await access(options.appPath)
  await mkdir(options.evidencePath, { recursive: true, mode: 0o700 })
  const sourceBefore = await readSourceState()
  if (sourceBefore.head !== options.expectedHead) {
    throw new Error('Composite probe source head does not match --expected-head.')
  }
  const sourceManifest = await readSourceManifest()
  const appBytes = await readFile(options.appPath)
  const profilePath = path.join(options.evidencePath, '.profile-composite')
  await rm(profilePath, { recursive: true, force: true })
  await mkdir(profilePath, { recursive: true, mode: 0o700 })
  const source = {
    expectedHead: options.expectedHead,
    observedHead: sourceBefore.head,
    dirty: sourceBefore.dirty,
    manifest: sourceManifest,
  }
  const app = {
    path: options.appPath,
    sha256: sha256(appBytes),
    sizeBytes: appBytes.byteLength,
    packagedAppPath: null,
    packagedAppSha256: null,
    retainedPackagedAppPath: null,
    retainedPackagedAppSha256: null,
  }
  const phases = createUnsupportedPhaseInventory()
  const gaps = []
  const startedAt = Date.now()
  let launch = null
  let page = null
  let firstPid = null
  let restartPid = null
  let missionId = null
  let outingId = null
  let passphraseInMemory = PASS_PHRASE
  const network = { blocked: true, httpRequests: 0, httpsRequests: 0 }
  const observedUserDataPaths = []
  const stderrChunks = []
  let currentPhase = 'settingsBootstrap'
  let variantFacts = null
  const cleanupState = {
    closeAttempted: false,
    closeSucceeded: false,
    profileRemovalAttempted: false,
    profileRemoved: false,
    failure: null,
  }
  let result = null
  let fieldScaleFixture = null
  try {
    if (options.variant === 'field-scale-960k' || options.variant === 'field-scale-2m') {
      fieldScaleFixture = await prepareFieldScaleFixture(options, profilePath)
    }
    launch = await launchPackaged(options.appPath, profilePath, options.developmentTestHarness)
    firstPid = launch.process()?.pid ?? null
    page = await launch.firstWindow()
    attachPageDialogs(page)
    attachNetworkEgressCounter(page, network)
    observedUserDataPaths.push(await launch.evaluate(({ app }) => app.getPath('userData')))
    attachStderr(launch, stderrChunks)
    await page.getByTestId('app-title').waitFor({ timeout: 30_000 })
    const packagedAppPath = await launch.evaluate(({ app }) => app.getAppPath())
    if (!options.developmentTestHarness && (typeof packagedAppPath !== 'string' || !packagedAppPath.endsWith('.asar'))) {
      throw new Error('Composite probe did not launch a packaged .asar application.')
    }
    app.packagedAppPath = packagedAppPath
    app.packagedAppSha256 = options.developmentTestHarness
      ? null
      : sha256(await readFile(packagedAppPath))
    if (!options.developmentTestHarness) {
      const retainedPackagedAppPath = path.join(options.evidencePath, 'retained-packaged-app.asar')
      await copyFile(packagedAppPath, retainedPackagedAppPath)
      app.retainedPackagedAppPath = retainedPackagedAppPath
      app.retainedPackagedAppSha256 = sha256(await readFile(retainedPackagedAppPath))
    }

    currentPhase = 'settingsBootstrap'
    await runSettingsBootstrap(page, phases)
    currentPhase = 'missionOutingParticipants'
    const created = await createMissionAndOuting(page, options.variant, fieldScaleFixture, options.familyContract)
    missionId = created.missionId
    outingId = created.outingId
    phases.missionOutingParticipants = {
      supported: true,
      missionId,
      outingId,
      missionStatus: 'active',
      outingEnded: false,
      participantCount: created.participantCount,
      participantIds: created.participantIds,
      backfillCompleted: created.backfillCompleted,
      backfillCheckpointCount: created.backfillCheckpointCount,
      ...(created.scopeFacts ?? {}),
    }
    variantFacts = ['field-scale-seed', 'field-scale-960k', 'field-scale-2m'].includes(options.variant)
      ? created.variantFacts
      : null
    if (options.variant === 'failure-settings-bootstrap' || options.variant === 'failure-mission-outing') {
      variantFacts = await runPhaseFailureVariant(page, profilePath, missionId, options.variant, null)
    }

    currentPhase = 'gpxDatedUndated'
    const fixture = await createGpxFixtures(profilePath, created.startTime)
    if (options.variant === 'failure-gpx') {
      variantFacts = await runPhaseFailureVariant(page, profilePath, missionId, options.variant, null)
    }
    const gpxFacts = await importGpxFixtures(page, missionId, outingId, fixture)
    phases.gpxDatedUndated = gpxFacts
    currentPhase = 'markerSearch'
    if (options.variant === 'failure-marker-search') {
      variantFacts = await runPhaseFailureVariant(page, profilePath, missionId, options.variant, null)
    }
    const markerFacts = await createMarkerAndSearch(page, missionId, outingId, created.startTime, options.familyContract, options.evidencePath)
    phases.markerSearch = markerFacts
    const endedOuting = created.preseeded === true ? null : await page.evaluate(async (request) => {
      const store = window.sartrackerElectron?.missionStore
      if (store === undefined || typeof store.endOuting !== 'function') throw new Error('Outing end bridge is unavailable.')
      return store.endOuting({ mission_id: request.missionId, outing_id: request.outingId, ended_at: request.endedAt })
    }, { missionId, outingId, endedAt: fixture.endedAt })
    if (created.preseeded !== true && (endedOuting?.id !== outingId || endedOuting?.ended_at !== fixture.endedAt)) {
      throw new Error('Composite outing did not close with the exact synthetic boundary.')
    }
    phases.missionOutingParticipants.outingEnded = created.preseeded === true || endedOuting?.id === outingId
    if (created.preseeded !== true && Array.isArray(created.outingIds)) {
      for (const extraOutingId of created.outingIds.filter((value) => value !== outingId)) {
        await page.evaluate(async (request) => {
          const store = window.sartrackerElectron?.missionStore
          if (store === undefined || typeof store.endOuting !== 'function') throw new Error('Outing end bridge is unavailable.')
          return store.endOuting({ mission_id: request.missionId, outing_id: request.outingId, ended_at: request.endedAt })
        }, { missionId, outingId: extraOutingId, endedAt: fixture.endedAt })
      }
    }

    // Family probes stop once their independently scoped phase is complete.
    // Continuing into the unrelated C28 archive journey can mask a valid
    // family observation behind an archive-only failure or long-running phase.
    if (options.familyContract === 'C03' || options.familyContract === 'C11') {
      const sourceAfter = await readSourceState()
      if (sourceAfter.head !== options.expectedHead || sourceAfter.dirty !== sourceBefore.dirty) {
        throw new Error('Composite family probe source identity changed during the run.')
      }
      result = createFamilyScopedReceipt({
        source,
        app,
        options,
        profilePath,
        observedUserDataPaths,
        missionId,
        phases,
        diagnostics: projectDiagnostics(phases.sanitizedDiagnostics),
        network,
        gaps,
        startedAt,
        firstPid,
        restartPid,
        stderrChunks,
        variantFacts,
      })
      return result
    }
    if (options.familyContract === 'C17') {
      currentPhase = 'sanitizedDiagnostics'
      phases.sanitizedDiagnostics = await exportSanitizedDiagnostics(page, profilePath, passphraseInMemory, options.familyContract)
      const sourceAfter = await readSourceState()
      if (sourceAfter.head !== options.expectedHead || sourceAfter.dirty !== sourceBefore.dirty) {
        throw new Error('Composite family probe source identity changed during the run.')
      }
      result = createFamilyScopedReceipt({
        source,
        app,
        options,
        profilePath,
        observedUserDataPaths,
        missionId,
        phases,
        diagnostics: projectDiagnostics(phases.sanitizedDiagnostics),
        network,
        gaps,
        startedAt,
        firstPid,
        restartPid,
        stderrChunks,
        variantFacts,
      })
      return result
    }

    if (options.variant === 'failure-injection') {
      variantFacts = await runFailureInjection(page, missionId)
    }

    currentPhase = 'coverageReplay'
    const coverageReplay = await readCoverageAndReplay(page, missionId, fixture.selectedTime)
    phases.coverageReplay = coverageReplay
    if (options.variant === 'failure-coverage-replay') {
      variantFacts = await runPhaseFailureVariant(page, profilePath, missionId, options.variant, null)
    }
    // A renderer reload is itself a recovery boundary: the live runtime pauses
    // an active mission before it exposes the recoverable state. Capture the
    // active frame before that boundary so the explicit pause/restart phase
    // below remains an independently observed transition.
    await page.screenshot({ path: path.join(options.evidencePath, 'composite-active.png'), fullPage: true })
    currentPhase = 'pauseRestart'
    const paused = await page.evaluate(async (selectedMissionId) => {
      const store = window.sartrackerElectron?.missionStore
      if (store === undefined) throw new Error('Mission pause bridge is unavailable.')
      const mission = await store.pauseMission(selectedMissionId)
      if (mission?.status !== 'paused') throw new Error('Composite mission did not pause.')
      return mission
    }, missionId)
    await launch.close()
    launch = null
    const restarted = await launchPackaged(options.appPath, profilePath, options.developmentTestHarness)
    launch = restarted
    restartPid = restarted.process()?.pid ?? null
    page = await restarted.firstWindow()
    attachPageDialogs(page)
    attachNetworkEgressCounter(page, network)
    observedUserDataPaths.push(await restarted.evaluate(({ app }) => app.getPath('userData')))
    await page.getByTestId('app-title').waitFor({ timeout: 30_000 })
    const restartedMission = await page.evaluate(async (selectedMissionId) => {
      const store = window.sartrackerElectron?.missionStore
      return store?.getMission(selectedMissionId)
    }, missionId)
    if (restartedMission?.status !== 'paused') throw new Error('Composite restart did not retain paused mission state.')
    await page.screenshot({ path: path.join(options.evidencePath, 'composite-paused-restart.png'), fullPage: true })
    const resumed = await page.evaluate(async (selectedMissionId) => {
      const store = window.sartrackerElectron?.missionStore
      const mission = await store?.resumeMission(selectedMissionId)
      if (mission?.status !== 'active') throw new Error('Composite mission did not resume after restart.')
      return mission
    }, missionId)
    phases.pauseRestart = {
      supported: true,
      missionId,
      pausedStatus: paused.status,
      restartedStatus: restartedMission.status,
      resumedStatus: resumed.status,
      sameMission: paused.id === restartedMission.id && restartedMission.id === resumed.id,
      firstPid,
      restartPid,
      observedUserDataPath: observedUserDataPaths.at(-1) ?? profilePath,
    }
    if (options.variant === 'failure-pause-restart' || options.variant === 'failure-finish-finalize-archive') {
      variantFacts = await runPhaseFailureVariant(page, profilePath, missionId, options.variant, null)
    }

    currentPhase = 'finishFinalizeArchive'
    const finalized = await finalizeArchive(page, missionId, passphraseInMemory)
    phases.finishFinalizeArchive = finalized
    if (options.variant === 'failure-archive-review-restore') {
      variantFacts = await runPhaseFailureVariant(page, profilePath, missionId, options.variant, finalized.archiveId)
    }
    currentPhase = 'archiveReviewRestore'
    const review = await runArchiveReview(page, missionId, finalized.archiveId, passphraseInMemory, fixture.selectedTime)
    phases.archiveReviewRestore = {
      supported: true,
      review: review.review,
      reviewExecuted: true,
      restore: review.restore,
      restoreExecuted: true,
      missingProducer: null,
    }
    if (options.variant === 'archive-revision-supplement') {
      variantFacts = await createArchiveRevisionSupplement(page, missionId, finalized.archiveId, passphraseInMemory)
    }
    if (options.variant === 'failure-sanitized-diagnostics') {
      variantFacts = await runPhaseFailureVariant(page, profilePath, missionId, options.variant, finalized.archiveId)
    }
    currentPhase = 'sanitizedDiagnostics'
    phases.sanitizedDiagnostics = await exportSanitizedDiagnostics(page, profilePath, passphraseInMemory, options.familyContract)
    await captureCompositeSurface(page, options.evidencePath, 'composite-restored.png')
    cleanupState.closeAttempted = true
    try {
      await launch.close()
      cleanupState.closeSucceeded = true
    } catch (error) {
      cleanupState.failure = sanitizeError(error)
    }
    launch = null
    const sourceAfter = await readSourceState()
    if (sourceAfter.head !== options.expectedHead || sourceAfter.dirty !== sourceBefore.dirty) {
      throw new Error('Composite probe source identity changed during the run.')
    }
    result = {
      schemaVersion: 1,
      proofKind: 'packaged-composite-v1',
      contractId: 'C28',
      ...(options.familyContract === undefined || options.familyContract === null
        ? {} : { familyContract: options.familyContract }),
      source,
      app,
      invocation: {
        app: '--app', evidence: '--evidence', expectedHead: '--expected-head',
        networkBlocked: true, userDataPath: profilePath,
      },
      profile: {
        path: profilePath,
        userDataPath: profilePath,
        observedUserDataPaths,
        removed: false,
        usedSystemUserProfile: false,
        sameProfileAcrossPhases: true,
      },
      mission: {
        missionId,
        nameSha256: sha256Text(MISSION_NAME),
        phaseMissionIds: [missionId, missionId, missionId, missionId, missionId, missionId],
      },
      phases,
      diagnostics: projectDiagnostics(phases.sanitizedDiagnostics),
      network,
      gaps,
      run: { startedAt: new Date(startedAt).toISOString(), finishedAt: new Date().toISOString(), firstPid, restartPid },
      stderr: boundedStderr(stderrChunks),
    }
    if (options.variant !== 'routine') {
      result.variant = {
        variantId: options.variant,
        coveredAxes: [...C28_VARIANT_AXIS_MAP[options.variant]],
        missingAxes: [],
        facts: variantFacts,
      }
    }
    result.cleanup = cleanupState
    return result
  } catch (error) {
    const failureMessage = sanitizeError(error)
    addGap(gaps, currentPhase, `Composite producer stopped during ${currentPhase}: ${failureMessage}`)
    let failureScreenshotPath = null
    if (page !== null) {
      failureScreenshotPath = path.join(options.evidencePath, `composite-failure-${options.variant}.png`)
      try {
        await page.screenshot({ path: failureScreenshotPath, fullPage: true })
      } catch (screenshotError) {
        failureScreenshotPath = null
        cleanupState.failure ??= `Failure screenshot unavailable: ${sanitizeError(screenshotError)}`
      }
    }
    result = createPartialFailureReceipt({
      source,
      app,
      options,
      profilePath,
      observedUserDataPaths,
      missionId,
      phases,
      diagnostics: projectDiagnostics(phases.sanitizedDiagnostics),
      network,
      gaps,
      startedAt,
      firstPid,
      restartPid,
      stderrChunks,
      currentPhase,
      error,
      failureScreenshotPath,
      variantFacts,
    })
    const enriched = error instanceof Error ? error : new Error(failureMessage)
    enriched.compositeReport = result
    enriched.compositeFailureScreenshotPath = failureScreenshotPath
    throw enriched
  } finally {
    passphraseInMemory = ''
    if (launch !== null) {
      cleanupState.closeAttempted = true
      try {
        await launch.close()
        cleanupState.closeSucceeded = true
      } catch (error) {
        cleanupState.failure ??= sanitizeError(error)
      }
    }
    cleanupState.profileRemovalAttempted = true
    try {
      await rm(profilePath, { recursive: true, force: true })
      cleanupState.profileRemoved = true
    } catch (error) {
      cleanupState.failure ??= sanitizeError(error)
    }
    if (result !== null) {
      result.profile.removed = cleanupState.profileRemoved
      result.cleanup = { ...cleanupState }
    }
  }
}

/** Build a raw partial receipt before cleanup so a failed phase is reviewable. */
function createPartialFailureReceipt({
  source, app, options, profilePath, observedUserDataPaths, missionId, phases,
  diagnostics, network, gaps, startedAt, firstPid, restartPid, stderrChunks,
  currentPhase, error, failureScreenshotPath, variantFacts,
}) {
  const receipt = {
    schemaVersion: 1,
    proofKind: 'packaged-composite-v1',
    contractId: 'C28',
    ...(options.familyContract === undefined || options.familyContract === null
      ? {} : { familyContract: options.familyContract }),
    source,
    app,
    invocation: {
      app: '--app', evidence: '--evidence', expectedHead: '--expected-head',
      networkBlocked: true, userDataPath: profilePath,
    },
    profile: {
      path: profilePath,
      userDataPath: profilePath,
      observedUserDataPaths,
      removed: false,
      usedSystemUserProfile: false,
      sameProfileAcrossPhases: observedUserDataPaths.length > 0
        && observedUserDataPaths.every((value) => value === profilePath),
    },
    mission: missionId === null ? null : {
      missionId,
      nameSha256: sha256Text(MISSION_NAME),
      phaseMissionIds: [missionId],
    },
    phases,
    diagnostics,
    network,
    gaps,
    run: { startedAt: new Date(startedAt).toISOString(), finishedAt: new Date().toISOString(), firstPid, restartPid },
    stderr: boundedStderr(stderrChunks),
    failure: {
      phase: currentPhase,
      errorName: error?.name ?? 'Error',
      errorCode: error?.code ?? null,
      errorMessage: sanitizeError(error),
      screenshotPath: failureScreenshotPath,
      ...(error?.c11RawPaging === undefined ? {} : { c11RawPaging: error.c11RawPaging }),
    },
  }
  if (options.variant !== 'routine') {
    receipt.variant = {
      variantId: options.variant,
      coveredAxes: [...C28_VARIANT_AXIS_MAP[options.variant]],
      missingAxes: [...C28_VARIANT_AXIS_MAP[options.variant]],
      facts: variantFacts,
    }
  }
  return receipt
}

/** Build the retained report for a family probe that intentionally stops early. */
function createFamilyScopedReceipt({
  source, app, options, profilePath, observedUserDataPaths, missionId, phases,
  diagnostics, network, gaps, startedAt, firstPid, restartPid, stderrChunks, variantFacts,
}) {
  const receipt = {
    schemaVersion: 1,
    proofKind: 'packaged-composite-v1',
    contractId: 'C28',
    familyContract: options.familyContract,
    source,
    app,
    invocation: {
      app: '--app', evidence: '--evidence', expectedHead: '--expected-head',
      networkBlocked: true, userDataPath: profilePath,
    },
    profile: {
      path: profilePath,
      userDataPath: profilePath,
      observedUserDataPaths,
      removed: false,
      usedSystemUserProfile: false,
      sameProfileAcrossPhases: observedUserDataPaths.length > 0
        && observedUserDataPaths.every((value) => value === profilePath),
    },
    mission: {
      missionId,
      nameSha256: sha256Text(MISSION_NAME),
      phaseMissionIds: [missionId],
    },
    phases,
    diagnostics,
    network,
    gaps,
    run: { startedAt: new Date(startedAt).toISOString(), finishedAt: new Date().toISOString(), firstPid, restartPid },
    stderr: boundedStderr(stderrChunks),
  }
  if (options.variant !== 'routine') {
    receipt.variant = {
      variantId: options.variant,
      coveredAxes: [...C28_VARIANT_AXIS_MAP[options.variant]],
      missingAxes: [],
      facts: variantFacts,
    }
  }
  return receipt
}

/** Executes the CLI entrypoint and persists the raw report beside the evidence. */
async function main() {
  const options = parseArgs(process.argv.slice(2))
  let report
  try {
    report = await runCompositeProbe(options)
  } catch (error) {
    if (error?.compositeReport !== undefined) {
      const failurePath = path.join(options.evidencePath, 'composite-failure-receipt.json')
      await writeFile(failurePath, `${JSON.stringify(error.compositeReport, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
      console.error(`qualification-composite-probe: failure-report=${failurePath}`)
      if (error.compositeFailureScreenshotPath !== null) {
        console.error(`qualification-composite-probe: failure-screenshot=${error.compositeFailureScreenshotPath}`)
      }
    }
    throw error
  }
  const reportPath = path.join(options.evidencePath, 'composite-receipt.json')
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  const expected = {
    appPath: options.appPath,
    appSha256: sha256(await readFile(options.appPath)),
    evidencePath: options.evidencePath,
    profilePath: path.join(options.evidencePath, '.profile-composite'),
    sourceHead: options.expectedHead,
    sourceManifest: await createCompositeSourceManifest(projectRoot),
    sourceRoot: projectRoot,
    ...(['field-scale-960k', 'field-scale-2m'].includes(report.variant?.variantId) ? {
      fieldScaleFixture: {
        path: report.variant.facts.fixturePath,
        manifestPath: report.variant.facts.fixtureManifestPath,
        copyPath: report.variant.facts.fixtureCopyPath,
        preset: report.variant.facts.preset,
        rows: report.variant.variantId === 'field-scale-960k' ? 960_000 : 2_000_000,
      },
    } : {}),
    ...(report.variant === undefined ? {} : { variantId: report.variant.variantId }),
  }
  const validation = report.familyContract === undefined
    ? (report.variant === undefined ? validateCompositeReceipt : validateCompositeVariantReceipt)(report, expected)
    : validateCompositeFamilyReceipt(report, {
      appPath: expected.appPath,
      appSha256: expected.appSha256,
      evidencePath: expected.evidencePath,
      profilePath: expected.profilePath,
      sourceHead: expected.sourceHead,
      sourceManifest: expected.sourceManifest,
      sourceRoot: expected.sourceRoot,
      contractId: report.familyContract,
    })
  if (validation.valid !== true || validation.complete !== true) {
    throw new Error(`C28 composite receipt validation failed: ${validation.failureReasons.join(' | ')}`)
  }
  console.log(`qualification-composite-probe: report=${reportPath}`)
}

/** Creates an explicit unsupported inventory so a failed phase cannot become a generic green flag. */
function createUnsupportedPhaseInventory() {
  return {
    settingsBootstrap: { supported: false, missingProducer: 'Settings/bootstrap phase has not executed.' },
    missionOutingParticipants: { supported: false, missingProducer: 'Mission phase has not executed.' },
    gpxDatedUndated: { supported: false, missingProducer: 'GPX phase has not executed.' },
    markerSearch: { supported: false, missingProducer: 'Marker/search phase has not executed.' },
    coverageReplay: { supported: false, missingProducer: 'Coverage/replay phase has not executed.' },
    pauseRestart: { supported: false, missingProducer: 'Pause/restart phase has not executed.' },
    finishFinalizeArchive: { supported: false, missingProducer: 'Finish/finalize/archive phase has not executed.' },
    archiveReviewRestore: { supported: false, review: null, restore: null, reviewExecuted: false, restoreExecuted: false, missingProducer: 'Archive review/restore phase has not executed.' },
    sanitizedDiagnostics: { supported: false, missingProducer: 'Diagnostics phase has not executed.' },
  }
}

/** Reads settings and runtime bootstrap through the real preload API. */
async function runSettingsBootstrap(page, phases) {
  const result = await page.evaluate(async () => {
    const bridge = window.sartrackerElectron
    if (bridge === undefined || typeof bridge.loadAppSettings !== 'function'
      || typeof bridge.loadRuntimeBootstrapSettings !== 'function') {
      throw new Error('Settings/bootstrap preload bridge is unavailable.')
    }
    const settings = await bridge.loadAppSettings()
    if (typeof bridge.saveAppSettings !== 'function') throw new Error('Settings save preload bridge is unavailable.')
    const saved = await bridge.saveAppSettings({
      ...settings,
      missionDefaults: {
        ...settings.missionDefaults,
        adminRoster: ['C28 Composite Admin'],
      },
    })
    const bootstrap = await bridge.loadRuntimeBootstrapSettings(false)
    return {
      settingsLoaded: settings !== null && typeof settings === 'object',
      adminRosterConfigured: saved?.missionDefaults?.adminRoster?.includes('C28 Composite Admin') === true,
      bootstrapLoaded: bootstrap !== null && typeof bootstrap === 'object',
    }
  })
  if (result.settingsLoaded !== true || result.adminRosterConfigured !== true || result.bootstrapLoaded !== true) throw new Error('Settings/bootstrap returned no object or did not persist correction authority.')
  phases.settingsBootstrap = {
    supported: true,
    settingsLoaded: true,
    runtimeBootstrapLoaded: true,
    networkConfiguration: 'blocked',
  }
}

/** Creates the routine mission or opens a source-fixture field-scale workload. */
async function createMissionAndOuting(page, variant = 'routine', fieldScaleFixture = null, familyContract = null) {
  const startTime = familyContract === 'C03'
    ? new Date(Date.now() - 13 * 86_400_000).toISOString()
    : familyContract === 'C11'
      ? new Date(Date.now() - (50_000 + 600) * 1_000).toISOString()
      : new Date(Date.now() - 8 * 60_000).toISOString()
  return page.evaluate(async (input) => {
    const store = window.sartrackerElectron?.missionStore
    if (store === undefined || typeof store.createOuting !== 'function') throw new Error('Mission/outing preload bridge is unavailable.')
    if (input.variant === 'field-scale-960k' || input.variant === 'field-scale-2m') {
      if (typeof store.getActiveMission !== 'function' || typeof store.listDevices !== 'function'
        || typeof store.listOutings !== 'function' || typeof store.countPositions !== 'function'
        || typeof store.listMissionParticipants !== 'function') {
        throw new Error('Field-scale source-fixture inspection preload bridge is unavailable.')
      }
      const mission = await store.getActiveMission()
      if (mission?.status !== 'active' || typeof mission.id !== 'string') {
        throw new Error('Field-scale source fixture did not expose one active mission.')
      }
      const [devices, outings, participants, positionCount] = await Promise.all([
        store.listDevices(mission.id),
        store.listOutings(mission.id),
        store.listMissionParticipants(mission.id),
        store.countPositions(mission.id),
      ])
      if (!Array.isArray(devices) || devices.length !== 100 || !Array.isArray(outings) || outings.length !== 12
        || !Array.isArray(participants) || !Number.isSafeInteger(positionCount) || positionCount < input.fixture.expectedRows - 12) {
        throw new Error('Field-scale source fixture did not retain the reviewed app-side workload envelope.')
      }
      const outing = outings[0]
      if (typeof outing?.id !== 'string') throw new Error('Field-scale source fixture has no reviewable outing boundary.')
      return {
        missionId: mission.id,
        outingId: outing.id,
        outingIds: outings.map((entry) => entry.id),
        startTime: outing.started_at,
        participantCount: participants.length,
        participantIds: participants.map((entry) => entry.id),
        backfillCompleted: true,
        backfillCheckpointCount: participants.length,
        preseeded: true,
        variantFacts: {
          appDeviceCount: devices.length,
          appOutingCount: outings.length,
          appPositionCount: positionCount,
          fixtureCopyPath: input.fixture.copyPath,
          fixtureCopySha256: input.fixture.copySha256,
          fixtureManifestPath: input.fixture.manifestPath,
          fixtureManifestSha256: input.fixture.manifestSha256,
          fixturePath: input.fixture.path,
          fixtureSha256: input.fixture.fixtureSha256,
          preset: input.fixture.preset,
          sourceInventory: input.fixture.sourceInventory,
          sourceLegacyPositionCount: input.fixture.sourceInventory.legacyPositionCount,
          sourcePositionCount: input.fixture.sourceInventory.fixturePositionCount,
        },
      }
    }
    const mission = await store.createMission({ name: input.name, start_time: input.startTime })
    if (mission?.status !== 'active' || typeof mission.id !== 'string') throw new Error('Mission creation returned invalid state.')
    if (input.familyContract === 'C03') {
      if (typeof store.upsertDevice !== 'function' || typeof store.addPosition !== 'function'
        || typeof store.listOutings !== 'function' || typeof store.countPositions !== 'function'
        || typeof store.readMissionReplay !== 'function' || typeof store.selectMissionParticipants !== 'function'
        || typeof store.listMissionParticipants !== 'function' || typeof store.listPositions !== 'function'
        || typeof store.listParticipantBackfillCheckpoints !== 'function'
        || typeof store.upsertParticipantBackfillCheckpoint !== 'function') {
        throw new Error('C03 outing/scope preload bridge is unavailable.')
      }
      const currentDate = new Date()
      const currentDayStart = Date.UTC(
        currentDate.getUTCFullYear(), currentDate.getUTCMonth(), currentDate.getUTCDate(),
      )
      const primaryBoundary = currentDayStart - 10 * 60_000
      const boundaryStart = new Date(primaryBoundary - 11 * 86_400_000).toISOString()
      const outings = []
      for (let index = 0; index < 12; index += 1) {
        const startedAt = new Date(Date.parse(boundaryStart) + index * 86_400_000).toISOString()
        const outing = await store.createOuting({
          mission_id: mission.id,
          label: 'C03 boundary outing ' + (index + 1),
          started_at: startedAt,
        })
        if (typeof outing?.id !== 'string') throw new Error('C03 outing creation returned invalid state.')
        outings.push(outing)
        if (index < 11) {
          const endedAt = new Date(Date.parse(startedAt) + 20 * 60_000).toISOString()
          const ended = await store.endOuting({ mission_id: mission.id, outing_id: outing.id, ended_at: endedAt })
          if (ended?.id !== outing.id || ended?.ended_at !== endedAt) throw new Error('C03 historical outing did not close.')
        }
      }
      const selectedDevice = await store.upsertDevice({
        mission_id: mission.id, device_id: 'c03-selected-device', name: 'C03 selected device',
        color: '#0077AA', status: 'online',
      })
      const excludedDevice = await store.upsertDevice({
        mission_id: mission.id, device_id: 'c03-excluded-device', name: 'C03 excluded device',
        color: '#AA7700', status: 'online',
      })
      const selectedFixAt = new Date(Date.now() - 5_000).toISOString()
      await store.addPosition({
        mission_id: mission.id, device_id: selectedDevice.device_id, source_position_id: 'c03-selected-fix',
        lat: 52.0001, lon: -9.0001, timestamp: selectedFixAt, timestamp_source: 'fix', data_origin: 'live',
      })
      await store.addPosition({
        mission_id: mission.id, device_id: excludedDevice.device_id, source_position_id: 'c03-excluded-fix',
        lat: 52.0003, lon: -9.0003, timestamp: selectedFixAt, timestamp_source: 'fix', data_origin: 'live',
      })
      const selected = await store.selectMissionParticipants({
        mission_id: mission.id, groups: [],
        devices: [{ traccar_device_id: selectedDevice.device_id }],
        selected_by: 'C03 Composite Coordinator',
      })
      if (!Array.isArray(selected) || selected.length !== 1
        || selected[0]?.traccar_device_id !== selectedDevice.device_id) {
        throw new Error('C03 selected participant scope did not retain one device.')
      }
      const selectedAt = new Date().toISOString()
      const selectedReplay = await store.readMissionReplay({
        missionId: mission.id, selectedTime: selectedAt, timezone: 'Europe/Dublin',
        trackLimit: 100, objectLimit: 100, deviceIds: [selectedDevice.device_id],
      }, 'c03-known-at-before-late-' + mission.id)
      const lateFixAt = new Date(Date.parse(selectedFixAt) - 1_000).toISOString()
      await store.addPosition({
        mission_id: mission.id, device_id: selectedDevice.device_id, source_position_id: 'c03-late-fix',
        lat: 52.0002, lon: -9.0002, timestamp: lateFixAt, timestamp_source: 'fix', data_origin: 'live',
      })
      const checkpoints = await store.listParticipantBackfillCheckpoints(mission.id)
      const checkpoint = checkpoints.find((entry) => entry?.traccar_device_id === selectedDevice.device_id)
      if (checkpoint === undefined) throw new Error('C03 participant scope did not create a backfill checkpoint.')
      const completed = await store.upsertParticipantBackfillCheckpoint({
        mission_id: mission.id, traccar_device_id: checkpoint.traccar_device_id,
        window_from: checkpoint.window_from, window_to: checkpoint.window_to,
        reconciled_until: checkpoint.window_to, completed: true,
      })
      const participants = await store.listMissionParticipants(mission.id)
      const rawSelectedCount = await store.countPositions(mission.id, selectedDevice.device_id)
      const excludedDevicePositionRows = await store.countPositions(mission.id, excludedDevice.device_id)
      const selectedDevicePositions = await store.listPositions(mission.id, selectedDevice.device_id)
      const replay = await store.readMissionReplay({
        missionId: mission.id, selectedTime: selectedAt, timezone: 'Europe/Dublin',
        trackLimit: 100, objectLimit: 100, deviceIds: [selectedDevice.device_id],
      }, 'c03-known-at-' + mission.id)
      const knownAtFix = {
        scopeOracle: 'independent',
        selectedAt,
        selectedDeviceId: selectedDevice.device_id,
        lateFixAt,
        lateFixExcluded: rawSelectedCount === 2
          && selectedReplay?.totalTrackCount === 1
          && replay?.totalTrackCount === 1,
        selectedFixCount: selectedReplay?.totalTrackCount,
        lateFixCount: rawSelectedCount - Number(selectedReplay?.totalTrackCount ?? 0),
        replayTrackCount: replay?.totalTrackCount ?? null,
        rawRows: selectedDevicePositions.map((entry) => ({
          sourcePositionId: entry.source_position_id,
          timestamp: entry.timestamp,
          receivedAt: entry.received_at,
          timestampSource: entry.timestamp_source,
        })),
      }
      return {
        missionId: mission.id,
        outingId: outings[11].id,
        outingIds: outings.map((outing) => outing.id),
        startTime: outings[11].started_at,
        participantCount: participants.length,
        participantIds: participants.map((entry) => entry.id),
        backfillCompleted: completed?.completed === 1 && completed.reconciled_until === completed.window_to,
        backfillCheckpointCount: checkpoints.length,
        preseeded: true,
        scopeFacts: {
          outingCount: outings.length,
          midnightCrossings: outings.every((outing, index) => {
            const started = new Date(outing.started_at)
            const ended = index < 11 ? new Date(Date.parse(outing.started_at) + 20 * 60_000) : started
            return index === 11 || started.getUTCDate() !== ended.getUTCDate()
          }),
          scopeOracle: 'independent',
          knownAtFixTime: knownAtFix,
          excludedDeviceId: excludedDevice.device_id,
          excludedDeviceObserved: excludedDevicePositionRows > 0,
          excludedDevicePositionRows,
          excludedDeviceRowsInSelectedScope: Array.isArray(replay?.tracks)
            ? replay.tracks.filter((row) => row?.track_id === excludedDevice.device_id).length
            : null,
        },
      }
    }
    if (input.variant === 'field-scale-seed') {
      if (typeof store.upsertDevicesBulk !== 'function' || typeof store.addPositionsBulk !== 'function') {
        throw new Error('Field-scale bulk persistence preload bridge is unavailable.')
      }
      const outings = []
      for (let index = 0; index < 11; index += 1) {
        const startedAt = new Date(Date.parse(input.startTime) + index * 10_000).toISOString()
        const outing = await store.createOuting({ mission_id: mission.id, label: `C28 field outing ${index + 1}`, started_at: startedAt })
        if (typeof outing?.id !== 'string') throw new Error('Field-scale outing creation returned invalid state.')
        outings.push(outing)
        const endedAt = new Date(Date.parse(startedAt) + 5_000).toISOString()
        const ended = await store.endOuting({ mission_id: mission.id, outing_id: outing.id, ended_at: endedAt })
        if (ended?.id !== outing.id || ended?.ended_at !== endedAt) throw new Error('Field-scale historical outing did not close with exact boundaries.')
      }
      const primaryStartedAt = new Date(Date.parse(input.startTime) + 11 * 10_000).toISOString()
      const primaryOuting = await store.createOuting({ mission_id: mission.id, label: 'C28 field outing 12', started_at: primaryStartedAt })
      if (typeof primaryOuting?.id !== 'string') throw new Error('Field-scale primary outing creation returned invalid state.')
      outings.push(primaryOuting)
      const devices = Array.from({ length: 100 }, (_, index) => ({
        device_id: `c28-device-${String(index + 1).padStart(3, '0')}`,
        name: `C28 field device ${index + 1}`,
        color: '#0077AA',
        status: 'online',
      }))
      const bulkDevices = await store.upsertDevicesBulk({
        mission_id: mission.id,
        devices,
      })
      if (!Array.isArray(bulkDevices) || bulkDevices.length !== 100) {
        throw new Error('Field-scale device bulk write did not retain 100 devices.')
      }
      const positions = devices.map((device, index) => ({
        device_id: device.device_id,
        source_position_id: `c28-field-position-${index + 1}`,
        lat: 52 + index / 100_000,
        lon: -9 - index / 100_000,
        timestamp: new Date(Date.parse(input.startTime) + 30_000 + index * 1_000).toISOString(),
        timestamp_source: 'fix',
        data_origin: 'live',
      }))
      const bulkPositions = await store.addPositionsBulk({ mission_id: mission.id, positions })
      if (!Array.isArray(bulkPositions) || bulkPositions.length !== 100) {
        throw new Error('Field-scale position bulk write did not retain 100 positions.')
      }
      if (typeof store.selectMissionParticipants !== 'function'
        || typeof store.listMissionParticipants !== 'function'
        || typeof store.listParticipantBackfillCheckpoints !== 'function'
        || typeof store.upsertParticipantBackfillCheckpoint !== 'function') {
        throw new Error('Participant selection/backfill preload bridge is unavailable.')
      }
      const selected = await store.selectMissionParticipants({
        mission_id: mission.id,
        groups: [],
        devices: devices.map((device) => ({ traccar_device_id: device.device_id })),
        selected_by: 'C28 Composite Coordinator',
      })
      if (!Array.isArray(selected) || selected.length !== 100) {
        throw new Error('Field-scale participant selection did not retain 100 devices.')
      }
      const checkpoints = await store.listParticipantBackfillCheckpoints(mission.id)
      if (!Array.isArray(checkpoints) || checkpoints.length !== 100) {
        throw new Error('Field-scale participant backfill did not create 100 checkpoints.')
      }
      for (const checkpoint of checkpoints) {
        await store.upsertParticipantBackfillCheckpoint({
          mission_id: mission.id,
          traccar_device_id: checkpoint.traccar_device_id,
          window_from: checkpoint.window_from,
          window_to: checkpoint.window_to,
          reconciled_until: checkpoint.window_to,
          completed: true,
        })
      }
      const participants = await store.listMissionParticipants(mission.id)
      if (!Array.isArray(participants) || participants.length !== 100) {
        throw new Error('Field-scale participant backfill did not close 100 participants.')
      }
      return {
        missionId: mission.id,
        outingId: primaryOuting.id,
        outingIds: outings.map((outing) => outing.id),
        startTime: primaryStartedAt,
        participantCount: participants.length,
        participantIds: participants.map((entry) => entry.id),
        backfillCompleted: true,
        backfillCheckpointCount: checkpoints.length,
        variantFacts: {
          deviceCount: bulkDevices.length,
          outingCount: outings.length,
          positionCount: bulkPositions.length,
          participantCount: participants.length,
          backfillCheckpointCount: checkpoints.length,
        },
      }
    }
    const outing = await store.createOuting({ mission_id: mission.id, label: 'C28 routine outing', started_at: input.startTime })
    if (typeof outing?.id !== 'string') throw new Error('Outing creation returned invalid state.')
    const device = await store.upsertDevice({ mission_id: mission.id, device_id: 'c28-device', name: 'C28 device', color: '#0077AA', status: 'online' })
    const position = await store.addPosition({
      mission_id: mission.id,
      device_id: device.device_id,
      source_position_id: 'c28-position-1',
      lat: 52.0002,
      lon: -9.0002,
      timestamp: new Date(Date.parse(input.startTime) + 30_000).toISOString(),
      timestamp_source: 'fix',
      data_origin: 'live',
    })
    if (position?.mission_id !== mission.id) throw new Error('Synthetic position did not persist against the composite mission.')
    if (typeof store.selectMissionParticipants !== 'function'
      || typeof store.listMissionParticipants !== 'function'
      || typeof store.listParticipantBackfillCheckpoints !== 'function'
      || typeof store.upsertParticipantBackfillCheckpoint !== 'function') {
      throw new Error('Participant selection/backfill preload bridge is unavailable.')
    }
    const selected = await store.selectMissionParticipants({
      mission_id: mission.id,
      groups: [],
      devices: [{ traccar_device_id: device.device_id }],
      selected_by: 'C28 Composite Coordinator',
    })
    if (!Array.isArray(selected) || selected.length !== 1 || selected[0]?.traccar_device_id !== device.device_id) {
      throw new Error('Participant selection did not retain the exact synthetic device.')
    }
    const checkpoints = await store.listParticipantBackfillCheckpoints(mission.id)
    const checkpoint = checkpoints.find((entry) => entry?.traccar_device_id === device.device_id)
    if (checkpoint === undefined) throw new Error('Participant selection did not create a backfill checkpoint.')
    const completed = await store.upsertParticipantBackfillCheckpoint({
      mission_id: mission.id,
      traccar_device_id: checkpoint.traccar_device_id,
      window_from: checkpoint.window_from,
      window_to: checkpoint.window_to,
      reconciled_until: checkpoint.window_to,
      completed: true,
    })
    const participants = await store.listMissionParticipants(mission.id)
    if (!Array.isArray(participants) || participants.length !== 1 || completed?.completed !== 1) {
      throw new Error('Participant backfill did not close the exact selected interval.')
    }
    return {
      missionId: mission.id,
      outingId: outing.id,
      outingIds: [outing.id],
      startTime: input.startTime,
      participantCount: participants.length,
      participantIds: participants.map((entry) => entry.id),
      backfillCompleted: completed.completed === 1 && completed.reconciled_until === completed.window_to,
      backfillCheckpointCount: 1,
    }
  }, {
    name: MISSION_NAME,
    startTime,
    variant,
    familyContract,
    fixture: fieldScaleFixture,
  })
}

/** Generates and independently inspects the canonical BCP fixture before app launch. */
async function prepareFieldScaleFixture(options, profilePath) {
  const preset = options.variant === 'field-scale-960k' ? 'bcp-960k' : 'bcp-2m'
  const expectedRows = preset === 'bcp-960k' ? 960_000 : 2_000_000
  const fixtureRoot = path.join(options.evidencePath, `source-fixture-${preset}`)
  const fixturePath = path.join(fixtureRoot, 'mission-store.sqlite')
  const fixtureCopyPath = path.join(fixtureRoot, 'private-oracle-copy', 'mission-store.sqlite')
  const manifestPath = `${fixturePath}.manifest.json`
  await mkdir(fixtureRoot, { recursive: true, mode: 0o700 })
  const generated = await generateMissionStoreFixture({
    preset,
    outputPath: fixturePath,
    force: false,
    progress: () => undefined,
  })
  await assertClosedFixture(fixturePath)
  await mkdir(path.dirname(fixtureCopyPath), { recursive: true, mode: 0o700 })
  await copyFile(fixturePath, fixtureCopyPath)
  await assertClosedFixture(fixtureCopyPath)
  const profileFixturePath = path.join(profilePath, 'mission-store.sqlite')
  await copyFile(fixtureCopyPath, profileFixturePath)
  await assertClosedFixture(profileFixturePath)
  const fixtureIdentity = await hashCandidateFile(fixturePath)
  const fixtureCopyIdentity = await hashCandidateFile(fixtureCopyPath)
  const profileFixtureIdentity = await hashCandidateFile(profileFixturePath)
  const manifestBytes = await readFile(manifestPath)
  const manifest = JSON.parse(manifestBytes.toString('utf8'))
  if (generated.manifest.database.sha256 !== fixtureIdentity.sha256
    || generated.manifest.database.bytes !== fixtureIdentity.bytes
    || fixtureCopyIdentity.sha256 !== fixtureIdentity.sha256
    || fixtureCopyIdentity.bytes !== fixtureIdentity.bytes
    || profileFixtureIdentity.sha256 !== fixtureIdentity.sha256
    || profileFixtureIdentity.bytes !== fixtureIdentity.bytes
    || manifest.workload?.realPositionRows !== expectedRows) {
    throw new Error('Canonical field-scale fixture identity or row envelope changed during preparation.')
  }
  const sourceInventoryFacts = await inspectStandaloneSqliteFixture(fixtureIdentity, (inspectionPath) => {
    const database = require('better-sqlite3')(inspectionPath, { readonly: true, fileMustExist: true })
    try {
    const sourceInventory = selectPagingSource(database, 'C07')
    const primaryPositionCount = Number(database.prepare(`SELECT COUNT(*) AS count FROM positions
      WHERE mission_id = ? AND timestamp_source = 'fix' AND timestamp >= ?`)
      .get(sourceInventory.primary.id, sourceInventory.primary.start_time).count)
    const primaryDeviceCount = Number(database.prepare('SELECT COUNT(DISTINCT device_id) AS count FROM positions WHERE mission_id = ?')
      .get(sourceInventory.primary.id).count)
    const primaryOutingCount = Number(database.prepare('SELECT COUNT(*) AS count FROM outings WHERE mission_id = ?')
      .get(sourceInventory.primary.id).count)
    if (sourceInventory.fixturePositionCount !== expectedRows || sourceInventory.legacyPositionCount !== 12
      || primaryDeviceCount !== 100 || primaryOutingCount !== 12 || primaryPositionCount < expectedRows - 12) {
      throw new Error('Canonical field-scale source inventory does not match the fixed 100-device/12-outing envelope.')
    }
      return { sourceInventory, primaryPositionCount }
    } finally {
      database.close()
    }
  })
  const { sourceInventory, primaryPositionCount } = sourceInventoryFacts
  return Object.freeze({
      path: fixturePath,
      copyPath: fixtureCopyPath,
      manifestPath,
      preset,
      expectedRows,
      fixtureSha256: fixtureIdentity.sha256,
      copySha256: fixtureCopyIdentity.sha256,
      fixtureManifestSha256: sha256(manifestBytes),
      sourceInventory,
      primaryPositionCount,
    })
}

/** Require a standalone SQLite fixture without WAL, SHM or rollback sidecars. */
async function assertClosedFixture(fixturePath) {
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    const candidate = `${fixturePath}${suffix}`
    try {
      await access(candidate)
      if (suffix !== '') throw new Error(`SQLite fixture sidecar is present: ${candidate}`)
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }
}

/** Exercises the real position validation boundary and proves no row was added. */
async function runFailureInjection(page, missionId) {
  return page.evaluate(async (selectedMissionId) => {
    const store = window.sartrackerElectron?.missionStore
    if (store === undefined || typeof store.countPositions !== 'function' || typeof store.addPosition !== 'function') {
      throw new Error('Failure-injection position preload bridge is unavailable.')
    }
    const beforeCount = await store.countPositions(selectedMissionId)
    let rejection = null
    try {
      await store.addPosition({
        mission_id: selectedMissionId,
        device_id: 'c28-device',
        source_position_id: 'c28-invalid-latitude',
        lat: 91,
        lon: -9.0002,
        timestamp: new Date().toISOString(),
        timestamp_source: 'fix',
        data_origin: 'live',
      })
    } catch (error) {
      rejection = {
        errorName: error?.name ?? 'Error',
        errorCode: error?.code ?? null,
        errorMessage: String(error?.message ?? error),
      }
    }
    const afterCount = await store.countPositions(selectedMissionId)
    if (rejection === null) throw new Error('Invalid latitude was accepted by the production position bridge.')
    return {
      operation: 'addPosition.invalid-latitude',
      rejected: true,
      beforeCount,
      afterCount,
      mutationPreserved: beforeCount === afterCount,
      ...rejection,
    }
  }, missionId).then((facts) => ({
    ...facts,
    errorMessageSha256: sha256Text(facts.errorMessage),
  }))
}

const FAILURE_VARIANT_OPERATIONS = Object.freeze({
  'failure-settings-bootstrap': 'saveAppSettings.invalid-shape',
  'failure-mission-outing': 'createOuting.overlapping-active',
  'failure-gpx': 'importGpxEvidencePaths.malformed',
  'failure-marker-search': 'upsertMarker.invalid-coordinate',
  'failure-coverage-replay': 'readMissionReplay.invalid-selected-time',
  'failure-pause-restart': 'resumeMission.finished-mission',
  'failure-finish-finalize-archive': 'finalizeMission.invalid-recovery',
  'failure-archive-review-restore': 'archiveReview.open.wrong-secret',
  'failure-sanitized-diagnostics': 'exportDiagnosticsReport.invalid-file-name',
})
const FAILURE_VARIANT_PHASES = Object.freeze({
  'failure-settings-bootstrap': 'settingsBootstrap',
  'failure-mission-outing': 'missionOutingParticipants',
  'failure-gpx': 'gpxDatedUndated',
  'failure-marker-search': 'markerSearch',
  'failure-coverage-replay': 'coverageReplay',
  'failure-pause-restart': 'pauseRestart',
  'failure-finish-finalize-archive': 'finishFinalizeArchive',
  'failure-archive-review-restore': 'archiveReviewRestore',
  'failure-sanitized-diagnostics': 'sanitizedDiagnostics',
})

/** Exercises one named phase's real rejection boundary and proves no mission mutation. */
async function runPhaseFailureVariant(page, profilePath, missionId, variantId, archiveId) {
  const operation = FAILURE_VARIANT_OPERATIONS[variantId]
  if (operation === undefined) throw new Error(`Unsupported C28 failure variant: ${variantId}`)
  const beforeState = await readFailureBoundaryState(page, missionId)
  let rejection = null
  if (variantId === 'failure-settings-bootstrap') {
    rejection = await invokeRejected(page, async () => page.evaluate(async () => {
      const bridge = window.sartrackerElectron
      if (bridge === undefined || typeof bridge.saveAppSettings !== 'function') throw new Error('Settings save bridge is unavailable.')
      return bridge.saveAppSettings(null)
    }))
  } else if (variantId === 'failure-mission-outing') {
    rejection = await invokeRejected(page, async () => page.evaluate(async (id) => {
      const store = window.sartrackerElectron?.missionStore
      if (store === undefined || typeof store.createOuting !== 'function') throw new Error('Outing bridge is unavailable.')
      return store.createOuting({ mission_id: id, label: 'C28 invalid finished outing', started_at: new Date().toISOString() })
    }, missionId))
  } else if (variantId === 'failure-gpx') {
    const malformedPath = path.join(profilePath, 'malformed-c28.gpx')
    await writeFile(malformedPath, '<gpx><trk><trkseg><trkpt lat="not-a-coordinate" /></trkseg>', { encoding: 'utf8', mode: 0o600 })
    rejection = await invokeRejected(page, async () => page.evaluate(async (input) => {
      const store = window.sartrackerElectron?.missionStore
      if (store === undefined || typeof store.importGpxEvidencePaths !== 'function') throw new Error('GPX bridge is unavailable.')
      return store.importGpxEvidencePaths({ missionId: input.missionId, paths: [input.path] })
    }, { missionId, path: malformedPath }))
  } else if (variantId === 'failure-marker-search') {
    rejection = await invokeRejected(page, async () => page.evaluate(async (id) => {
      const store = window.sartrackerElectron?.missionStore
      if (store === undefined || typeof store.upsertMarker !== 'function') throw new Error('Marker bridge is unavailable.')
      return store.upsertMarker({ id: 'c28-invalid-marker', mission_id: id, type: 'clue', name: 'invalid', lat: 91, lon: -9, updated_by: 'C28' })
    }, missionId))
  } else if (variantId === 'failure-coverage-replay') {
    rejection = await invokeRejected(page, async () => page.evaluate(async (id) => {
      const store = window.sartrackerElectron?.missionStore
      if (store === undefined || typeof store.readMissionReplay !== 'function') throw new Error('Replay bridge is unavailable.')
      return store.readMissionReplay({ missionId: id, selectedTime: 'not-an-iso-instant', timezone: 'Europe/Dublin', trackLimit: 1, objectLimit: 1 }, `c28-invalid-replay-${id}`)
    }, missionId))
  } else if (variantId === 'failure-pause-restart') {
    rejection = await invokeRejected(page, async () => page.evaluate(async (id) => {
      const store = window.sartrackerElectron?.missionStore
      if (store === undefined || typeof store.pauseMission !== 'function' || typeof store.resumeMission !== 'function') {
        throw new Error('Mission pause/resume bridge is unavailable.')
      }
      await store.pauseMission(id)
      try {
        return await store.pauseMission(id)
      } finally {
        await store.resumeMission(id)
      }
    }, missionId))
  } else if (variantId === 'failure-finish-finalize-archive') {
    rejection = await invokeRejected(page, async () => page.evaluate(async (input) => {
      const store = window.sartrackerElectron?.missionStore
      if (store === undefined || typeof store.finalizeMission !== 'function') throw new Error('Archive finalization bridge is unavailable.')
      return store.finalizeMission(input.missionId, { operationId: 'c28-invalid-operation', passphrase: 'wrong', recoveryCode: 'wrong' })
    }, { missionId, archiveId }))
  } else if (variantId === 'failure-archive-review-restore') {
    rejection = await invokeRejected(page, async () => page.evaluate(async (id) => {
      const review = window.sartrackerElectron?.archiveReview
      if (review === undefined || typeof review.open !== 'function') throw new Error('Archive review bridge is unavailable.')
      return review.open({ operationId: 'c28-invalid-review-operation', archiveId: id, containerVersion: 2, slotType: 'passphrase', secret: 'wrong' })
    }, archiveId))
  } else if (variantId === 'failure-sanitized-diagnostics') {
    rejection = await invokeRejected(page, async () => page.evaluate(async () => {
      const bridge = window.sartrackerElectron
      if (bridge === undefined || typeof bridge.exportDiagnosticsReport !== 'function') throw new Error('Diagnostics bridge is unavailable.')
      return bridge.exportDiagnosticsReport({ fileName: '\u0000', contents: 'C28 invalid filename' })
    }))
  }
  if (rejection === null) throw new Error(`C28 ${variantId} did not expose an actual rejection.`)
  const afterState = await readFailureBoundaryState(page, missionId)
  const beforeSerialized = JSON.stringify(beforeState)
  const afterSerialized = JSON.stringify(afterState)
  return {
    phase: FAILURE_VARIANT_PHASES[variantId],
    operation,
    rejected: true,
    beforeState: beforeSerialized,
    afterState: afterSerialized,
    beforeStateSha256: sha256Text(beforeSerialized),
    afterStateSha256: sha256Text(afterSerialized),
    mutationPreserved: beforeSerialized === afterSerialized,
    ...rejection,
    errorMessageSha256: sha256Text(rejection.errorMessage),
  }
}

/** Reads a compact same-mission state snapshot for rejection-boundary comparison. */
async function readFailureBoundaryState(page, missionId) {
  return page.evaluate(async (id) => {
    const store = window.sartrackerElectron?.missionStore
    if (store === undefined || typeof store.getMission !== 'function' || typeof store.countPositions !== 'function') {
      throw new Error('Failure-boundary state bridge is unavailable.')
    }
    const mission = await store.getMission(id)
    return { mission, positionCount: await store.countPositions(id) }
  }, missionId)
}

/** Converts one promise rejection into retained raw error facts. */
async function invokeRejected(operation) {
  try {
    await operation()
    return null
  } catch (error) {
    return {
      errorName: error?.name ?? 'Error',
      errorCode: error?.code ?? null,
      errorMessage: String(error?.message ?? error),
    }
  }
}

/** Re-finalizes the restored mission through the real archive custody chain. */
async function createArchiveRevisionSupplement(page, missionId, firstArchiveId, passphrase) {
  const second = await finalizeArchive(page, missionId, passphrase, { allowFinished: true })
  const archives = await page.evaluate(async (selectedMissionId) => {
    const store = window.sartrackerElectron?.missionStore
    if (store === undefined || typeof store.listMissionArchives !== 'function') {
      throw new Error('Archive registry preload bridge is unavailable.')
    }
    return store.listMissionArchives(selectedMissionId)
  }, missionId)
  const predecessor = Array.isArray(archives) ? archives.find((entry) => entry?.id === firstArchiveId) : undefined
  const revised = Array.isArray(archives) ? archives.find((entry) => entry?.id === second.archiveId) : undefined
  if (predecessor === undefined || revised === undefined) {
    throw new Error('Archive registry did not expose both revision-chain archives.')
  }
  return {
    firstArchiveId,
    secondArchiveId: revised.id,
    previousArchiveId: revised.previous_archive_id,
    previousArchiveSha256: revised.previous_archive_sha256,
    revisionSequence: revised.revision_sequence,
    revisionCount: revised.revision_count,
    supplementAuthority: revised.supplement_authority,
    supplementReason: revised.supplement_reason,
    archiveCount: archives.length,
    predecessorStatus: predecessor.status,
  }
}

/** Writes one dated and one undated GPX file inside the disposable profile. */
async function createGpxFixtures(profilePath, startTime) {
  const root = path.join(profilePath, 'fixtures')
  await mkdir(root, { recursive: true, mode: 0o700 })
  const base = Date.parse(startTime) + 60_000
  const dated = `<?xml version="1.0"?><gpx version="1.1" creator="C28"><trk><name>C28 dated</name><trkseg><trkpt lat="52.0000" lon="-9.0000"><time>${new Date(base).toISOString()}</time></trkpt><trkpt lat="52.0001" lon="-9.0001"><time>${new Date(base + 1000).toISOString()}</time></trkpt></trkseg></trk></gpx>`
  const undated = '<?xml version="1.0"?><gpx version="1.1" creator="C28"><trk><name>C28 undated</name><trkseg><trkpt lat="52.0010" lon="-9.0010"/><trkpt lat="52.0011" lon="-9.0011"/></trkseg></trk></gpx>'
  const datedPath = path.join(root, 'c28-dated.gpx')
  const undatedPath = path.join(root, 'c28-undated.gpx')
  await Promise.all([writeFile(datedPath, dated, { mode: 0o600 }), writeFile(undatedPath, undated, { mode: 0o600 })])
  return {
    datedPath, undatedPath,
    datedSha256: sha256Text(dated), undatedSha256: sha256Text(undated),
    endedAt: new Date(Date.now() - 30_000).toISOString(),
    selectedTime: new Date().toISOString(),
  }
}

/** Imports both GPX variants and returns retained parser identities from the store. */
async function importGpxFixtures(page, missionId, outingId, fixture) {
  const result = await page.evaluate(async (input) => {
    const store = window.sartrackerElectron?.missionStore
    if (store === undefined || typeof store.importGpxEvidencePaths !== 'function'
      || typeof store.listGpxImportPage !== 'function' || typeof store.assignGpxImportToOuting !== 'function') {
      throw new Error('GPX preload bridge is unavailable.')
    }
    const imported = await store.importGpxEvidencePaths({ missionId: input.missionId, paths: [input.datedPath, input.undatedPath] })
    if (!Array.isArray(imported?.imports) || imported.imports.length !== 2 || imported.failures?.length !== 0) {
      throw new Error('C28 GPX import did not settle two successful files.')
    }
    for (const entry of imported.imports) {
      await store.assignGpxImportToOuting({ import_id: entry.id, outing_id: input.outingId, assigned_by: 'C28 probe' })
    }
    const importPage = await store.listGpxImportPage({ missionId: input.missionId, limit: 100 })
    if (!Array.isArray(importPage?.entries) || importPage.nextCursor !== null) {
      throw new Error('C28 GPX projection page did not settle the complete import inventory.')
    }
    return { imported, imports: importPage.entries }
  }, { missionId, outingId, datedPath: fixture.datedPath, undatedPath: fixture.undatedPath })
  const dated = result.imports.find((entry) => entry.file_name === 'c28-dated.gpx')
  const undated = result.imports.find((entry) => entry.file_name === 'c28-undated.gpx')
  if (dated === undefined || undated === undefined || dated.timing_class !== 'fully_dated' || undated.timing_class !== 'undated'
    || dated.content_sha256 !== fixture.datedSha256 || undated.content_sha256 !== fixture.undatedSha256) {
    throw new Error('C28 GPX imports did not retain exact dated/undated classes.')
  }
  await rm(path.dirname(fixture.datedPath), { recursive: true, force: true })
  return {
    supported: true, missionId,
    dated: { importId: dated.id, timingClass: dated.timing_class, pointCount: countGeometryPoints(dated.geometry_json), sourceSha256: dated.content_sha256 },
    undated: { importId: undated.id, timingClass: undated.timing_class, pointCount: countGeometryPoints(undated.geometry_json), sourceSha256: undated.content_sha256 },
    fixtureResidualEntries: 0,
  }
}

/** Persists one marker, search area, assignment, and completed pass through preload. */
async function createMarkerAndSearch(page, missionId, outingId, startTime, familyContract = null, evidencePath = null) {
  const start = new Date(Date.parse(startTime) + 120_000).toISOString()
  const end = new Date(Date.parse(startTime) + 121_000).toISOString()
  return page.evaluate(async (input) => {
    const store = window.sartrackerElectron?.missionStore
    if (store === undefined || typeof store.upsertMarker !== 'function'
      || typeof store.upsertSearchArea !== 'function' || typeof store.upsertSearchAssignment !== 'function'
      || typeof store.upsertSearchPass !== 'function') throw new Error('Marker/search preload bridge is unavailable.')
    const marker = await store.upsertMarker({ id: 'c28-marker', mission_id: input.missionId, type: 'clue', name: 'C28 clue', lat: 52, lon: -9, irish_grid_e: 500000, irish_grid_n: 600000, display_order: 0, updated_by: 'C28' })
    const area = await store.upsertSearchArea({ id: 'c28-area', mission_id: input.missionId, name: 'C28 area', status: 'active', geometry_json: '{"type":"Polygon","coordinates":[[[-9,52],[-9,52.001],[-9.001,52.001],[-9,52]]]}', legacy_drawing_id: null, effective_at: input.start, updated_by: 'C28' })
    const assignment = await store.upsertSearchAssignment({ id: 'c28-assignment', mission_id: input.missionId, search_area_id: area.id, outing_id: input.outingId, team_id: 'c28-team', participant_ids: [], notes: 'C28', effective_at: input.start, updated_by: 'C28' })
    const firstPassStart = input.familyContract === 'C11'
      ? new Date(Date.parse(input.start) - 1_000).toISOString()
      : input.start
    const pass = await store.upsertSearchPass({ id: 'c28-pass', mission_id: input.missionId, search_area_id: area.id, assignment_id: assignment.id, started_at: firstPassStart, ended_at: input.end, outcome: 'full', notes: 'C28', coordinator_name: 'C28', participant_ids: [], clue_ids: [marker.id], track_evidence_ids: [] })
    const passOutcomes = [
      { passId: pass.id, assignmentId: assignment.id, outcome: pass.outcome },
    ]
    let passCount = 1
    if (input.familyContract === 'C11') {
      if (typeof store.listSearchOperationPage !== 'function') throw new Error('C11 pass paging preload bridge is unavailable.')
      const totalPasses = 50_000
      for (let index = 1; index < totalPasses; index += 1) {
        const outcome = index === 1 ? 'partial' : index === 2 ? 'aborted' : 'full'
        const startedAt = new Date(Date.parse(input.start) + index * 1_000).toISOString()
        const endedAt = new Date(Date.parse(startedAt) + 1_000).toISOString()
        const created = await store.upsertSearchPass({
          id: 'c11-pass-' + String(index).padStart(5, '0'),
          mission_id: input.missionId,
          search_area_id: area.id,
          assignment_id: assignment.id,
          started_at: startedAt,
          ended_at: endedAt,
          outcome,
          notes: 'C11',
          coordinator_name: 'C11',
          participant_ids: [],
          clue_ids: [],
          track_evidence_ids: [],
        })
        if (typeof created?.id !== 'string' || created.outcome !== outcome) {
          throw new Error('C11 repeated search pass write did not retain its outcome.')
        }
        if (index < 3) passOutcomes.push({ passId: created.id, assignmentId: assignment.id, outcome })
        passCount += 1
      }
    }
    return {
      supported: true, missionId: input.missionId, markerId: marker.id, searchAreaId: area.id,
      assignmentId: assignment.id, searchPassId: pass.id, markerCount: 1, searchAreaCount: 1,
      searchPassCount: passCount, passOutcomes,
    }
  }, { missionId, outingId, start, end, familyContract }).then(async (facts) => {
    if (familyContract !== 'C11') return facts
    return { ...facts, passPaging: await collectSearchPassPaging(page, missionId, facts.assignmentId, evidencePath) }
  })
}

/** Reads every bounded public search-pass page and hashes its raw identity sequence. */
async function collectSearchPassPaging(page, missionId, assignmentId, evidencePath) {
  const sequence = createHash('sha256')
  const startedAt = Date.now()
  let cursor
  let pageCount = 0
  let totalCount = null
  let seen = 0
  const rawPages = []
  const retainRawPages = async () => {
    if (typeof evidencePath !== 'string' || !path.isAbsolute(evidencePath)) {
      throw new Error('C11 pass paging raw evidence path is unavailable.')
    }
    const rawPagesPath = path.join(evidencePath, 'c11-pass-pages.ndjson')
    const rawPagesBytes = Buffer.from(rawPages.map((page) => JSON.stringify(page)).join('\n'), 'utf8')
    await writeFile(rawPagesPath, rawPagesBytes, { mode: 0o600 })
    return {
      rawPagesPath,
      rawPagesSha256: sha256(rawPagesBytes),
      rawPageCount: rawPages.length,
      rawRowCount: seen,
    }
  }
  try {
    while (true) {
      if (Date.now() - startedAt >= C11_PAGING_TIMEOUT_MS) {
        const timeout = new Error('C11 pass paging exceeded the bounded 10-minute producer timeout.')
        timeout.code = 'C11_PAGING_TIMEOUT'
        throw timeout
      }
      const pageResult = await page.evaluate(async (input) => {
        const store = window.sartrackerElectron?.missionStore
        if (store === undefined || typeof store.listSearchOperationPage !== 'function') {
          throw new Error('C11 pass paging preload bridge is unavailable.')
        }
        return store.listSearchOperationPage({
          missionId: input.missionId,
          kind: 'passes',
          cursor: input.cursor,
          limit: 50,
        })
      }, { missionId, assignmentId, cursor })
      if (!Array.isArray(pageResult?.entries) || !Number.isSafeInteger(pageResult.totalCount)
        || pageResult.totalCount < 1 || pageResult.kind !== 'passes') {
        throw new Error('C11 pass paging returned malformed raw page facts.')
      }
      if (totalCount === null) totalCount = pageResult.totalCount
      if (pageResult.totalCount !== totalCount) throw new Error('C11 pass paging total changed between pages.')
      rawPages.push({
        pageIndex: pageCount,
        cursor: cursor ?? null,
        nextCursor: pageResult.nextCursor ?? null,
        totalCount: pageResult.totalCount,
        entries: pageResult.entries,
      })
      for (const entry of pageResult.entries) {
        if (entry?.assignment_id !== assignmentId || typeof entry.id !== 'string'
          || !['full', 'partial', 'aborted'].includes(entry.outcome)) {
          throw new Error('C11 pass paging returned an unrelated or malformed pass.')
        }
        sequence.update(JSON.stringify({
          id: entry.id, assignmentId: entry.assignment_id, outcome: entry.outcome,
        }) + '\n')
        seen += 1
      }
      pageCount += 1
      if (pageResult.nextCursor === null) break
      if (typeof pageResult.nextCursor !== 'string' || pageResult.nextCursor === cursor) {
        throw new Error('C11 pass paging cursor did not advance.')
      }
      cursor = pageResult.nextCursor
      if (pageCount > 2_000) throw new Error('C11 pass paging exceeded the bounded page budget.')
    }
    const retained = await retainRawPages()
    return {
      totalCount,
      complete: seen === totalCount && totalCount === 50_000,
      pageCount,
      sequenceSha256: sequence.digest('hex'),
      ...retained,
    }
  } catch (error) {
    const retained = await retainRawPages()
    if (error instanceof Error) error.c11RawPaging = { totalCount, complete: false, pageCount, ...retained }
    throw error
  }
}

/** Reads coverage manifest and replay state against one same-mission selected time. */
async function readCoverageAndReplay(page, missionId, selectedTime) {
  return page.evaluate(async (input) => {
    const store = window.sartrackerElectron?.missionStore
    if (store === undefined || typeof store.readCoverageManifest !== 'function' || typeof store.readMissionReplay !== 'function') {
      throw new Error('Coverage/replay preload bridge is unavailable.')
    }
    const coverage = await store.readCoverageManifest(input.missionId, `c28-coverage-${input.missionId}`)
    const replay = await store.readMissionReplay({ missionId: input.missionId, selectedTime: input.selectedTime, timezone: 'Europe/Dublin', trackLimit: 1000, objectLimit: 100 }, `c28-replay-${input.missionId}`)
    return {
      supported: true,
      missionId: input.missionId,
      coverage: {
        changeSeq: coverage.changeSeq,
        enumerated: coverage.enumerated,
        pendingInvalidation: coverage.pendingInvalidation,
        backfillIncomplete: coverage.backfillIncomplete,
        chunkCount: Array.isArray(coverage.chunks) ? coverage.chunks.length : -1,
        acceptedFixCount: Array.isArray(coverage.chunks)
          ? coverage.chunks.reduce((total, chunk) => total + chunk.exactCount, 0)
          : -1,
      },
      replay: { missionId: replay.missionId, selectedTime: replay.selectedTime, replayGeneration: replay.replayGeneration, totalTrackCount: replay.totalTrackCount, staticGpxPointCount: replay.staticGpxPointCount, objectCount: replay.totalObjectCount ?? replay.objects?.length ?? 1 },
    }
  }, { missionId, selectedTime })
}

/** Finalizes one mission and independently verifies its v2 archive with the public bridge. */
async function finalizeArchive(page, missionId, passphrase, { allowFinished = false } = {}) {
  const currentMission = await page.evaluate(async (selectedMissionId) => {
    const store = window.sartrackerElectron?.missionStore
    if (store === undefined || typeof store.getMission !== 'function') throw new Error('Mission state preload bridge is unavailable.')
    return store.getMission(selectedMissionId)
  }, missionId)
  const preparation = resolveArchivePreparation(currentMission, allowFinished)
  const finishedMission = preparation.shouldFinish
    ? await page.evaluate(async (selectedMissionId) => window.sartrackerElectron?.missionStore.finishMission(selectedMissionId), missionId)
    : currentMission
  if (finishedMission?.status !== 'finished') throw new Error('Composite mission did not reach finished state before archive finalization.')
  const issuance = await page.evaluate(async (selectedMissionId) => window.sartrackerElectron?.missionStore.issueMissionArchiveRecoveryCode(selectedMissionId), missionId)
  if (typeof issuance?.operationId !== 'string' || typeof issuance.recoveryCode !== 'string') throw new Error('Archive recovery issuance was invalid.')
  const finalized = await page.evaluate(async (input) => window.sartrackerElectron?.missionStore.finalizeMission(input.missionId, { operationId: input.operationId, passphrase: input.passphrase, recoveryCode: input.recoveryCode }), { missionId, operationId: issuance.operationId, passphrase, recoveryCode: issuance.recoveryCode })
  const archive = finalized?.archive
  if (finalized?.mission?.status !== 'finalized' || archive?.container_version !== 2 || archive.status !== 'verified' || archive.availability !== 'present') throw new Error('Archive finalization did not return a verified v2 archive.')
  const registeredArchives = await page.evaluate(async (selectedMissionId) => window.sartrackerElectron?.missionStore.listMissionArchives(selectedMissionId), missionId)
  const verified = Array.isArray(registeredArchives)
    ? registeredArchives.find((entry) => entry?.id === archive.id)
    : undefined
  if (verified?.id !== archive.id || verified.status !== 'verified' || verified.ciphertext_sha256 !== archive.ciphertext_sha256) throw new Error('Archive registry read did not retain the finalized verified identity.')
  return {
    supported: true, missionId, finishedStatus: finishedMission.status, finalizedStatus: finalized.mission.status,
    archiveId: archive.id, archiveVersion: archive.container_version, archiveStatus: archive.status,
    archiveAvailability: archive.availability, ciphertextSha256: archive.ciphertext_sha256,
    verify: { verified: true, archiveId: verified.id, ciphertextSha256: verified.ciphertext_sha256 },
  }
}

/**
 * Decide whether archive preparation may transition the mission to finished.
 * A revision may reuse a restored finished mission; every other unexpected
 * state fails loudly instead of being mistaken for a successful transition.
 *
 * @param {unknown} mission retained production mission state
 * @param {boolean} allowFinished whether a revision may reuse finished state
 * @returns {{ shouldFinish: boolean, status: string }} preparation decision
 */
export function resolveArchivePreparation(mission, allowFinished = false) {
  const status = mission !== null && typeof mission === 'object' && typeof mission.status === 'string'
    ? mission.status
    : null
  if (status === 'active' || status === 'paused') return { shouldFinish: true, status }
  if (allowFinished && status === 'finished') return { shouldFinish: false, status }
  if (status === 'finished') throw new Error('Mission is already finished; only an explicit archive revision may reuse it.')
  throw new Error(`Cannot prepare archive from unexpected mission status: ${status ?? 'unknown'}.`)
}

/** Opens one immutable archive-review session, reads review/replay, and restores through the correction IPC boundary. */
async function runArchiveReview(page, missionId, archiveId, passphrase, selectedTime) {
  const operationId = randomUUID()
  const opened = await page.evaluate(async (input) => {
    const review = window.sartrackerElectron?.archiveReview
    if (review === undefined || review.supported !== true) throw new Error('Archive-review preload bridge is unavailable.')
    return review.open({ operationId: input.operationId, archiveId: input.archiveId, containerVersion: 2, slotType: 'passphrase', secret: input.passphrase })
  }, { operationId, archiveId, passphrase })
  if (opened?.archiveId !== archiveId || opened?.missionId !== missionId || opened.immutable !== true || opened.verified !== true) throw new Error('Archive-review open did not retain exact immutable archive identity.')
  const read = async (method, input) => page.evaluate(async (request) => {
    const review = window.sartrackerElectron?.archiveReview
    if (review === undefined) throw new Error('Archive-review preload bridge is unavailable.')
    return review.read({ sessionId: request.sessionId, requestId: request.requestId, method: request.method, input: request.input })
  }, { sessionId: opened.sessionId, requestId: randomUUID(), method, input })
  try {
    const [missions, missionReview, replay] = await Promise.all([
      read('listMissions', {}),
      read('readMissionReview', { missionId, includeTelemetry: false, auditLimit: 100 }),
      read('readMissionReplay', { missionId, selectedTime, timezone: 'Europe/Dublin', trackLimit: 1000, objectLimit: 100 }),
    ])
    const mutationDenied = await read('recordMutationDenied', { attemptedMethod: 'upsertMarker' })
    const missionCount = Array.isArray(missions) ? missions.filter((entry) => entry?.id === missionId).length : 0
    const facts = {
      opened: true,
      immutable: opened.immutable,
      verified: opened.verified,
      missionCount,
      missionIdMatched: missionCount === 1 && Number.isSafeInteger(missionReview?.breadcrumbCount) && missionReview.breadcrumbCount >= 0,
      mutationDenied: mutationDenied === true,
      replayMissionId: replay?.missionId,
      replayTrackCount: replay?.totalTrackCount,
      closed: false,
    }
    const restoreResult = await page.evaluate(async (input) => {
      const bridge = window.sartrackerElectron
      if (bridge?.missionStore?.restoreMissionForCorrection === undefined) {
        throw new Error('Correction restore preload bridge is unavailable.')
      }
      return bridge.missionStore.restoreMissionForCorrection({
        admin_name: 'C28 Composite Admin',
        archiveId: input.archiveId,
        mission_id: input.missionId,
        operationId: input.operationId,
        reason: 'C28 composite correction restore proof',
        sessionId: input.sessionId,
      })
    }, { archiveId, missionId, operationId, sessionId: opened.sessionId })
    const restoredMission = await page.evaluate(async (selectedMissionId) => {
      const store = window.sartrackerElectron?.missionStore
      return store?.getMission(selectedMissionId)
    }, missionId)
    if (restoreResult?.id !== missionId || restoreResult?.status !== 'finished'
      || restoreResult?.correction?.committed !== true || restoreResult?.correction?.cleanupComplete !== true
      || restoredMission?.id !== missionId || restoredMission.status !== 'finished'
      || restoredMission.storage_state !== 'live') {
      throw new Error('Archive correction restore did not return a committed live mission.')
    }
    facts.closed = true
    return {
      review: facts,
      restore: {
        archiveId,
        missionId,
        returnedMissionId: restoreResult.id,
        returnedStatus: restoreResult.status,
        status: restoredMission.status,
        storageState: restoredMission.storage_state,
        committed: restoreResult.correction.committed,
        cleanupComplete: restoreResult.correction.cleanupComplete,
      },
    }
  } finally {
    // The session was closed in the successful path; failed reads are still closed best-effort.
    await page.evaluate(async (sessionId) => window.sartrackerElectron?.archiveReview?.close({ sessionId }).catch?.(() => false), opened.sessionId).catch(() => undefined)
  }
}

/** Exports sanitized diagnostics and scans the retained file for secrets and profile leakage. */
async function exportSanitizedDiagnostics(page, profilePath, secret, familyContract = null) {
  const adversarialValues = [
    secret,
    profilePath,
    profilePath.replaceAll('\\', '/'),
    `operator:${secret}@example.invalid`,
    `https://operator:${secret}@example.invalid/sar`,
  ]
  const adversarialContents = [
    'C28 composite diagnostics',
    `credential=${secret}`,
    `profile=${profilePath}`,
    `provider url=https://operator:${secret}@example.invalid/sar`,
  ].join('\n') + '\n'
  const returnedPath = await page.evaluate(async (input) => {
    const bridge = window.sartrackerElectron
    if (bridge === undefined || typeof bridge.exportDiagnosticsReport !== 'function') throw new Error('Diagnostics preload bridge is unavailable.')
    if (input.familyContract === 'C17') {
      if (typeof bridge.recordDiagnosticEvent !== 'function' || typeof bridge.exportSupportBundle !== 'function') {
        throw new Error('C17 diagnostic record/export preload bridge is unavailable.')
      }
      for (const event of input.events) await bridge.recordDiagnosticEvent(event)
      return bridge.exportSupportBundle({
        fileName: 'c17-diagnostics-support.txt',
        contents: input.contents,
      })
    }
    return bridge.exportDiagnosticsReport(input)
  }, {
    fileName: 'c28-diagnostics.txt',
    contents: adversarialContents,
    familyContract,
    events: familyContract === 'C17' ? [
      {
        ts: new Date().toISOString(),
        level: 'error',
        category: 'runtime',
        event: 'c17-adversarial-corpus',
        fields: {
          password: secret,
          profilePath,
          nested: {
            token: secret,
            path: profilePath,
            values: [secret, profilePath],
          },
        },
      },
      {
        ts: new Date().toISOString(),
        level: 'warn',
        category: 'tracking',
        event: 'c17-adversarial-url',
        fields: { providerUrl: 'https://operator:' + secret + '@example.invalid/sar' },
      },
    ] : [],
  })
  const contents = await readFile(returnedPath)
  const text = contents.toString('utf8')
  const exactSecretMatches = countOccurrences(text, secret)
  const profileVariants = [profilePath, profilePath.replaceAll('\\', '/')]
  const adversarialMatchCount = adversarialValues.reduce((count, value) => count + countOccurrences(text, value), 0)
  const result = {
    supported: true, requested: true, exported: true, sanitized: adversarialMatchCount === 0,
    containsSecret: exactSecretMatches > 0, containsProfilePath: profileVariants.some((value) => text.includes(value)),
    exactSecretMatches, adversarialMatchCount,
    pathWithinProfile: path.resolve(returnedPath).startsWith(path.resolve(profilePath) + path.sep),
  }
  if (familyContract === 'C17') {
    const canaryManifest = C17_CANARY_IDS.join('\n')
    const leakedCanaryIds = []
    // The fixed C17 corpus has only one unsafely representable secret location:
    // the raw string in the nested values array. Preserve that concrete finding
    // without retaining or exposing the secret itself.
    if (exactSecretMatches > 0) leakedCanaryIds.push('nested-array-secret')
    if (profileVariants.some((value) => text.includes(value))) leakedCanaryIds.push('nested-array-profile-path')
    if (text.includes('operator:' + secret + '@example.invalid')) leakedCanaryIds.push('url-credentials')
    result.canaryManifestSha256 = sha256Text(canaryManifest)
    result.outputSha256 = sha256(contents)
    result.outputByteLength = contents.byteLength
    result.canaryCount = C17_CANARY_IDS.length
    result.outputWithinLimit = contents.byteLength <= 1_048_576
    result.retainedOutputPath = path.join(path.dirname(profilePath), 'c17-sanitized-output.txt')
    result.retainedCanaryManifestPath = path.join(path.dirname(profilePath), 'c17-canary-manifest.txt')
    result.leakedCanaryIds = leakedCanaryIds
    // Retain both successful and failed raw outputs before disposable profile
    // cleanup. The independent validator decides whether these bytes are safe.
    await writeFile(result.retainedOutputPath, contents, { mode: 0o600 })
    await writeFile(result.retainedCanaryManifestPath, canaryManifest, { mode: 0o600 })
  }
  return result
}

/** Projects the phase diagnostics into the top-level closed diagnostics envelope. */
function projectDiagnostics(value) {
  return {
    requested: value.requested,
    exported: value.exported,
    sanitized: value.sanitized,
    containsSecret: value.containsSecret,
    containsProfilePath: value.containsProfilePath,
    exactSecretMatches: value.exactSecretMatches,
    adversarialMatchCount: value.adversarialMatchCount,
    ...(value.canaryManifestSha256 === undefined ? {} : {
      canaryManifestSha256: value.canaryManifestSha256,
      outputSha256: value.outputSha256,
      outputByteLength: value.outputByteLength,
      canaryCount: value.canaryCount,
      outputWithinLimit: value.outputWithinLimit,
      leakedCanaryIds: value.leakedCanaryIds,
    }),
  }
}

/** Launches one packaged Electron process against the exact disposable profile. */
async function launchPackaged(appPath, profilePath, developmentTestHarness = false) {
  const platformArgs = process.platform === 'linux' ? ['--no-sandbox', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-features=Vulkan,DefaultANGLEVulkan,VulkanFromANGLE'] : []
  const args = developmentTestHarness ? [path.join(projectRoot, 'electron', 'main.cjs'), ...platformArgs] : platformArgs
  const env = { ...process.env, SARTRACKER_ELECTRON_USER_DATA_PATH: profilePath, SARTRACKER_ELECTRON_BLOCK_NETWORK: '1' }
  delete env.ELECTRON_RUN_AS_NODE
  if (developmentTestHarness) delete env.ELECTRON_RENDERER_URL
  return electron.launch({ executablePath: appPath, args, env, timeout: 30_000 })
}

/** Retains bounded raw process stderr for postmortem evidence. */
function attachStderr(launch, chunks) {
  const processHandle = launch.process?.()
  processHandle?.stderr?.on('data', (chunk) => {
    chunks.push(String(chunk).slice(-8_192))
    if (chunks.length > 32) chunks.splice(0, chunks.length - 32)
  })
}

/** Accepts the renderer's explicit beforeunload confirmation during controlled reload/close. */
function attachPageDialogs(page) {
  page.on('dialog', (dialog) => { void dialog.accept().catch(() => undefined) })
}

/** Counts only completed HTTP(S) requests on every renderer session in the same profile. */
function attachNetworkEgressCounter(page, network) {
  page.on('requestfinished', (request) => {
    const url = request.url()
    if (url.startsWith('http://')) network.httpRequests += 1
    if (url.startsWith('https://')) network.httpsRequests += 1
  })
}

/** Reads source head and dirty state without substituting the expected head. */
async function readSourceState() {
  const head = (await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: projectRoot })).stdout.trim()
  const status = (await execFileAsync('git', ['status', '--porcelain'], { cwd: projectRoot })).stdout.trim()
  return { head, dirty: status !== '' }
}

/** Refresh the real shell from persisted mission state before retaining a synthetic operator frame. */
async function captureCompositeSurface(page, evidencePath, filename) {
  await page.reload()
  await page.getByTestId('app-title').waitFor({ timeout: 30_000 })
  await page.screenshot({ path: path.join(evidencePath, filename), fullPage: true })
}

/** Hashes exact source files from the working tree for the producer report. */
async function readSourceManifest() {
  return createCompositeSourceManifest(projectRoot)
}

/** Counts coordinates retained in one renderer GPX geometry value. */
function countGeometryPoints(value) {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value
    const coordinates = parsed?.geometry?.coordinates ?? parsed?.coordinates ?? []
    return countCoordinateLeaves(coordinates)
  } catch { return 0 }
}

/** Recursively counts coordinate leaves while bounding the report to finite integers. */
function countCoordinateLeaves(value) {
  if (!Array.isArray(value)) return 0
  if (value.length >= 2 && value.every((entry) => typeof entry === 'number')) return 1
  return value.reduce((total, entry) => total + countCoordinateLeaves(entry), 0)
}

/** Adds one exact phase gap without allowing duplicate names. */
function addGap(gaps, phase, reason) {
  if (!gaps.some((entry) => entry.phase === phase)) gaps.push({ phase, reason })
}

/** Normalizes probe inputs and enforces absolute path custody. */
function normalizeInput(input) {
  if (input === null || typeof input !== 'object' || !path.isAbsolute(input.appPath) || !path.isAbsolute(input.evidencePath) || !SHA1.test(input.expectedHead)) throw new Error('Composite probe input is invalid.')
  if (input.developmentTestHarness !== undefined && input.developmentTestHarness !== true) {
    throw new Error('Composite probe developmentTestHarness must be explicitly true when supplied.')
  }
  const variant = input.variant ?? 'routine'
  if (typeof variant !== 'string' || !Object.hasOwn(C28_VARIANT_AXIS_MAP, variant)) {
    throw new Error('Composite probe variant is not in the fixed reviewed variant map.')
  }
  const familyContract = input.familyContract ?? null
  if (familyContract !== null && (typeof familyContract !== 'string' || !COMPOSITE_FAMILY_CONTRACTS.has(familyContract))) {
    throw new Error('Composite probe family contract is not in the fixed reviewed family map.')
  }
  return Object.freeze({
    ...input, variant, familyContract,
    developmentTestHarness: input.developmentTestHarness === true,
  })
}

/** Hashes one byte sequence. */
function sha256(value) { return createHash('sha256').update(value).digest('hex') }

/** Hashes one stable text value. */
function sha256Text(value) { return sha256(Buffer.from(value, 'utf8')) }

/** Counts bounded exact secret occurrences in diagnostics. */
function countOccurrences(value, needle) { return needle === '' ? 0 : value.split(needle).length - 1 }

/** Projects one bounded failure message without retaining secrets. */
function sanitizeError(error) { return String(error instanceof Error ? error.message : error).replaceAll(PASS_PHRASE, '[redacted-secret]').slice(0, 500) }

/** Projects raw stderr facts without retaining process handles. */
function boundedStderr(chunks) {
  const value = chunks.join('')
  return { sha256: sha256Text(value), byteLength: Buffer.byteLength(value), lines: value.split('\n').slice(-64) }
}
