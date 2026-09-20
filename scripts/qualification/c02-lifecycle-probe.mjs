#!/usr/bin/env node

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { _electron as electron } from 'playwright'

import { C02_LIFECYCLE_VARIANTS } from './c02-lifecycle-receipts.mjs'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const LINUX_ARGS = process.platform === 'linux'
  ? ['--no-sandbox', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-features=Vulkan,DefaultANGLEVulkan,VulkanFromANGLE']
  : []
const PASS_PHRASE = 'C02 pending lifecycle archive passphrase 2026!'

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli(process.argv.slice(2)).catch((error) => {
    console.error(`c02-lifecycle-probe: ${messageOf(error)}`)
    process.exitCode = 1
  })
}

/** Runs one fixed C02 packaged lifecycle variant and retains a raw receipt. */
export async function runC02LifecycleProbe(input) {
  const options = validateInput(input)
  await mkdir(options.evidencePath, { recursive: true, mode: 0o700 })
  const profile = path.join(options.evidencePath, `.profile-c02-${options.variantId}`)
  await rm(profile, { recursive: true, force: true })
  await mkdir(profile, { recursive: true, mode: 0o700 })
  const source = readSourceIdentity(options.expectedHead)
  const report = {
    schemaVersion: 1,
    contractId: 'C02',
    variantId: options.variantId,
    proofMode: options.developmentTestHarness ? 'development-electron-harness' : 'packaged-electron',
    developmentTestHarness: options.developmentTestHarness,
    source,
    app: { executablePath: options.appPath, executableSha256: null, asarSha256: null },
    profile: { path: profile, removed: false },
    runtime: { launches: [] },
    mission: { id: null, snapshots: { before: null, afterRecovery: null }, audit: { before: null, afterRecovery: null } },
    fault: { requested: faultName(options.variantId), observed: false },
    pendingFinalize: null,
    cleanup: { applicationClosed: false, profileRemoved: false },
    failure: null,
    result: 'fail',
  }
  let app = null
  try {
    app = await launchPackaged(options.appPath, profile, options)
    const firstPage = await app.firstWindow()
    await waitForShell(firstPage)
    await attestLaunch(app, 'before', report)
    const mission = await seedMission(firstPage, options.variantId)
    report.mission.id = mission.id
    report.mission.snapshots.before = await readMissionSnapshot(firstPage, mission.id)
    report.mission.audit.before = report.mission.snapshots.before.audit

    if (options.variantId === 'graceful-close') {
      await runGracefulClose(app, report)
      app = null
      app = await relaunch(options.appPath, profile, report, options)
      const recoveryPage = await app.firstWindow()
      report.fault.recoveryState = await readRecoveryState(app)
      report.fault.recoveryNotice = await readRecoveryNotice(recoveryPage)
      report.mission.snapshots.afterRecovery = await readMissionSnapshot(recoveryPage, mission.id)
      report.mission.audit.afterRecovery = report.mission.snapshots.afterRecovery.audit
    } else if (options.variantId === 'reload') {
      const page = await runReload(firstPage, report)
      report.mission.snapshots.afterRecovery = await readMissionSnapshot(page, mission.id)
      report.mission.audit.afterRecovery = report.mission.snapshots.afterRecovery.audit
      await closePackaged(app, report, 'reload close')
      app = null
      app = await relaunch(options.appPath, profile, report, options)
      const recoveryPage = await app.firstWindow()
      report.fault.recoveryState = await readRecoveryState(app)
      report.fault.recoveryNotice = await readRecoveryNotice(recoveryPage)
      report.mission.snapshots.afterRecovery = await readMissionSnapshot(recoveryPage, mission.id)
      report.mission.audit.afterRecovery = report.mission.snapshots.afterRecovery.audit
    } else if (options.variantId === 'renderer-crash') {
      await runRendererCrash(app, report)
      await closePackaged(app, report, 'renderer crash close')
      app = null
      app = await relaunch(options.appPath, profile, report, options)
      const recoveryPage = await app.firstWindow()
      report.fault.recoveryState = await readRecoveryState(app)
      report.fault.recoveryNotice = await readRecoveryNotice(recoveryPage)
      report.mission.snapshots.afterRecovery = await readMissionSnapshot(recoveryPage, mission.id)
      report.mission.audit.afterRecovery = report.mission.snapshots.afterRecovery.audit
    } else if (options.variantId === 'main-sigkill') {
      await runMainSigkill(app, report)
      app = null
      app = await relaunch(options.appPath, profile, report, options)
      const recoveryPage = await app.firstWindow()
      report.fault.recoveryState = await readRecoveryState(app)
      report.fault.recoveryNotice = await readRecoveryNotice(recoveryPage)
      report.mission.snapshots.afterRecovery = await readMissionSnapshot(recoveryPage, mission.id)
      report.mission.audit.afterRecovery = report.mission.snapshots.afterRecovery.audit
    } else if (options.variantId === 'pending-finalize') {
      await runPendingFinalize(app, firstPage, mission.id, report, options)
      app = null
    }

    if (app !== null) {
      await closePackaged(app, report, 'terminal close')
      app = null
    }
    report.fault.observed = true
    report.cleanup.applicationClosed = true
    report.result = 'pass'
  } catch (error) {
    report.failure = messageOf(error)
    report.result = 'fail'
    throw error
  } finally {
    if (app !== null) {
      try {
        await closePackaged(app, report, 'failure cleanup')
        report.cleanup.applicationClosed = true
      } catch (error) {
        report.failure ??= `Failure cleanup: ${messageOf(error)}`
      } finally {
        app = null
      }
    }
    if (report.result === 'pass') {
      try {
        await rm(profile, { recursive: true, force: true })
        report.profile.removed = true
        report.cleanup.profileRemoved = true
      } catch (error) {
        report.failure = `Profile cleanup failed: ${messageOf(error)}`
        report.result = 'fail'
      }
    }
    const reportPath = path.join(options.evidencePath, 'c02-lifecycle-report.json')
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })
  }
  if (report.result !== 'pass') throw new Error(report.failure ?? 'C02 lifecycle probe failed.')
  return report
}

/** Runs the command-line producer with exact absolute path and fixed variant binding. */
async function runCli(argv) {
  const options = parseArgs(argv)
  const report = await runC02LifecycleProbe(options)
  console.log(JSON.stringify({ result: report.result, contractId: report.contractId, variantId: report.variantId }))
}

/** Parses the deliberately narrow packaged producer command line. */
function parseArgs(argv) {
  let appPath = null
  let evidencePath = null
  let expectedHead = null
  let variantId = null
  let developmentTestHarness = false
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--app') appPath = argv[++index]
    else if (argument === '--evidence') evidencePath = argv[++index]
    else if (argument === '--expected-head') expectedHead = argv[++index]
    else if (argument === '--variant') variantId = argv[++index]
    else if (argument === '--development-test-harness') developmentTestHarness = true
    else if (argument === '--help') {
      console.log('Usage: node scripts/qualification/c02-lifecycle-probe.mjs --app <executable> --evidence <absolute-directory> --expected-head <commit> --variant <fixed-variant> [--development-test-harness]')
      return process.exit(0)
    } else throw new Error(`Unknown C02 lifecycle argument: ${argument}`)
  }
  return validateInput({ appPath, evidencePath, expectedHead, variantId, developmentTestHarness })
}

/** Validates fixed producer inputs before any process is launched. */
function validateInput(input) {
  for (const key of ['appPath', 'evidencePath', 'expectedHead', 'variantId']) {
    assert.equal(typeof input?.[key], 'string', `C02 ${key} is required.`)
    assert.ok(input[key].trim() !== '', `C02 ${key} is empty.`)
  }
  assert.ok(path.isAbsolute(input.appPath), 'C02 app path must be absolute.')
  assert.ok(path.isAbsolute(input.evidencePath), 'C02 evidence path must be absolute.')
  assert.ok(/^[a-f0-9]{40}$/u.test(input.expectedHead), 'C02 expected head must be a full commit SHA.')
  assert.ok(C02_LIFECYCLE_VARIANTS.includes(input.variantId), 'C02 variant is not in the fixed inventory.')
  return {
    ...input,
    developmentTestHarness: input.developmentTestHarness === true,
    appPath: path.resolve(input.appPath),
    evidencePath: path.resolve(input.evidencePath),
  }
}

/** Launches the exact supplied executable with a profile owned by this attempt. */
async function launchPackaged(appPath, profile, options) {
  const env = {
    ...process.env,
    SARTRACKER_ELECTRON_USER_DATA_PATH: profile,
    SARTRACKER_ELECTRON_BLOCK_NETWORK: '1',
  }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_RENDERER_URL
  const args = options.developmentTestHarness
    ? [path.join(projectRoot, 'electron', 'main.cjs'), ...LINUX_ARGS]
    : LINUX_ARGS
  return electron.launch({ executablePath: appPath, args, env, timeout: 60_000 })
}

/** Reopens the same owned profile and records its distinct process identity. */
async function relaunch(appPath, profile, report, options) {
  const app = await launchPackaged(appPath, profile, options)
  await waitForShell(await app.firstWindow())
  await attestLaunch(app, `recovery-${report.runtime.launches.length}`, report)
  return app
}

/** Records runtime and package identities from the running Electron process. */
async function attestLaunch(app, label, report) {
  const runtime = await app.evaluate(({ app: runningApp }) => ({
    pid: process.pid,
    executablePath: process.execPath,
    appPath: runningApp.getAppPath(),
    userDataPath: runningApp.getPath('userData'),
  }))
  const executableSha256 = await hashFile(runtime.executablePath)
  const asarSha256 = runtime.appPath.endsWith('.asar') ? await hashFile(runtime.appPath) : null
  report.app.executableSha256 ??= executableSha256
  report.app.asarSha256 ??= asarSha256
  report.runtime.launches.push({ label, pid: runtime.pid, executableSha256, asarSha256, userDataPath: runtime.userDataPath })
}

/** Creates one mission and exercises pause/resume through the public preload bridge. */
async function seedMission(page, variantId) {
  const mission = await page.evaluate(async (variant) => {
    const store = window.sartrackerElectron?.missionStore
    if (store === undefined) throw new Error('C02 mission-store preload bridge is unavailable.')
    const created = await store.createMission({ name: `C02 ${variant} lifecycle` })
    await store.pauseMission(created.id)
    await store.resumeMission(created.id)
    return store.getMission(created.id)
  }, variantId)
  if (mission?.status !== 'active') throw new Error('C02 synthetic mission did not remain active after pause/resume.')
  if (variantId === 'pending-finalize') {
    await page.evaluate(async (missionId) => {
      const store = window.sartrackerElectron?.missionStore
      for (let index = 0; index < 256; index += 1) {
        await store.upsertMarker({
          id: `c02-pending-marker-${String(index).padStart(3, '0')}`,
          mission_id: missionId,
          type: 'clue',
          name: `C02 pending marker ${index}`,
          description: 'Synthetic pending-finalize custody workload',
          lat: 52 + index / 100_000,
          lon: -9 - index / 100_000,
          irish_grid_e: 480_000 + index,
          irish_grid_n: 580_000 + index,
          display_order: index,
          updated_by: 'C02 lifecycle producer',
        })
      }
    }, mission.id)
  }
  return mission
}

/** Reads the authoritative mission and audit rows through the public bridge. */
async function readMissionSnapshot(page, missionId) {
  return page.evaluate(async (id) => {
    const store = window.sartrackerElectron?.missionStore
    if (store === undefined) throw new Error('C02 mission-store preload bridge is unavailable.')
    const [mission, audit] = await Promise.all([
      store.getMission(id),
      store.listAuditEvents(id, { includeTelemetry: true, limit: 5_000 }),
    ])
    return { id: mission.id, status: mission.status, mission, audit }
  }, missionId)
}

/** Exercises the real guarded window close and later profile reopen. */
async function runGracefulClose(app, report) {
  const processHandle = app.process()
  await closePackaged(app, report, 'graceful window close')
  report.fault.process = {
    pid: processHandle?.pid ?? null,
    exitCode: processHandle?.exitCode ?? 0,
    signal: processHandle?.signalCode ?? null,
  }
}

/** Exercises the real renderer reload fence and waits for the page to recover. */
async function runReload(page, report) {
  const previousUrl = await page.url()
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 })
  await waitForShell(page)
  report.fault.pageRecovered = page.url() === previousUrl
  report.fault.process = { pid: null, exitCode: null, signal: null }
  report.fault.observed = report.fault.pageRecovered
  return page
}

/** Uses Electron's actual forcefullyCrashRenderer seam and retains render-process-gone details. */
async function runRendererCrash(app, report) {
  const support = await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]
    if (typeof window?.webContents?.forcefullyCrashRenderer !== 'function') return { supported: false }
    window.webContents.once('render-process-gone', (_event, details) => {
      globalThis.__C02_RENDERER_GONE__ = {
        reason: details?.reason ?? null,
        exitCode: details?.exitCode ?? null,
        wasmTerminationStatus: details?.terminationStatus ?? null,
      }
    })
    window.webContents.forcefullyCrashRenderer()
    return { supported: true }
  })
  if (!support.supported) throw new Error('C02 renderer crash seam is unavailable in this Electron runtime.')
  const details = await waitForMainValue(app, () => globalThis.__C02_RENDERER_GONE__)
  report.fault.renderer = details
  report.fault.observed = ['crashed', 'killed', 'oom', 'abnormal-exit'].includes(details.reason)
  if (!report.fault.observed) throw new Error('C02 render-process-gone did not report a genuine crash reason.')
}

/** Kills only the owned packaged Electron process and retains the kernel signal result. */
async function runMainSigkill(app, report) {
  const processHandle = app.process()
  if (processHandle === null) throw new Error('C02 packaged process handle is unavailable.')
  const exited = new Promise((resolve) => processHandle.once('exit', (code, signal) => resolve({ code, signal })))
  if (!processHandle.kill('SIGKILL')) throw new Error('C02 packaged process rejected SIGKILL.')
  const result = await exited
  report.fault.process = { pid: processHandle.pid ?? null, exitCode: result.code, signal: result.signal }
  report.fault.observed = result.signal === 'SIGKILL'
  if (!report.fault.observed) throw new Error(`C02 packaged SIGKILL observed ${JSON.stringify(result)}.`)
}

/** Starts finalization through preload, waits for a real archive progress boundary, kills main and settles after restart. */
async function runPendingFinalize(app, page, missionId, report, options) {
  const custody = await page.evaluate(async (id) => {
    const store = window.sartrackerElectron?.missionStore
    await store.finishMission(id)
    return store.issueMissionArchiveRecoveryCode(id)
  }, missionId)
  await page.evaluate(async ({ id, issued }) => {
    const bridge = window.sartrackerElectron
    const state = { operationId: issued.operationId, phase: null, events: [], settled: false, error: null }
    const unsubscribe = bridge.onMissionArchiveProgress((progress) => {
      if (progress?.operationId !== issued.operationId) return
      state.phase = progress.phase ?? null
      state.events.push({ kind: progress.kind ?? null, phase: progress.phase ?? null, completed: progress.completed ?? null, total: progress.total ?? null })
    })
    try {
      const completion = bridge.missionStore.finalizeMission(id, {
        operationId: issued.operationId,
        recoveryCode: issued.recoveryCode,
        passphrase: 'C02 pending lifecycle archive passphrase 2026!',
      })
      Promise.resolve(completion)
        .then(() => { state.settled = true; unsubscribe() })
        .catch((error) => { state.error = String(error?.message ?? error); state.settled = true; unsubscribe() })
    } catch (error) {
      state.error = String(error?.message ?? error)
      state.settled = true
      unsubscribe()
    }
    window.__C02_PENDING_FINALIZE__ = state
  }, { id: missionId, issued: custody })
  const boundary = await waitForPageValue(page, () => window.__C02_PENDING_FINALIZE__, (value) => value?.phase !== null || value?.settled === true)
  if (boundary.settled) {
    report.pendingFinalize = {
      ...boundary,
      boundaryObserved: false,
      recoveryAttempted: false,
      settled: true,
      finalMission: null,
      audit: null,
    }
    throw new Error(`C02 finalize settled before an archive phase boundary: ${boundary.error ?? 'unknown finalization result'}`)
  }
  report.pendingFinalize = { ...boundary, boundaryObserved: true, recoveryAttempted: false, settled: false, finalMission: null, audit: null }
  const processHandle = app.process()
  if (processHandle === null) throw new Error('C02 pending-finalize process handle is unavailable.')
  const exited = new Promise((resolve) => processHandle.once('exit', (code, signal) => resolve({ code, signal })))
  if (!processHandle.kill('SIGKILL')) throw new Error('C02 pending-finalize process rejected SIGKILL.')
  const result = await exited
  report.fault.process = { pid: processHandle.pid ?? null, exitCode: result.code, signal: result.signal }
  report.fault.observed = result.signal === 'SIGKILL'
  if (!report.fault.observed) throw new Error(`C02 pending-finalize SIGKILL observed ${JSON.stringify(result)}.`)

  app = null
  const recoveryApp = await relaunch(report.app.executablePath, report.profile.path, report, options)
  const recoveryPage = await recoveryApp.firstWindow()
  report.fault.recoveryState = await readRecoveryState(recoveryApp)
  report.fault.recoveryNotice = await readRecoveryNotice(recoveryPage)
  report.pendingFinalize.recoveryAttempted = true
  report.fault.evidenceHealthWarning = await readEvidenceHealthWarning(recoveryPage)
  report.pendingFinalize.evidenceHealthBeforeRetry = await recoveryPage.evaluate(async (id) => {
    const store = window.sartrackerElectron?.missionStore
    if (store === undefined || typeof store.getIngestEvidenceHealth !== 'function') {
      throw new Error('C02 evidence-health preload bridge is unavailable.')
    }
    return store.getIngestEvidenceHealth(id)
  }, missionId)
  report.pendingFinalize.evidenceLossMarker = await retainEvidenceLossMarker(
    report.profile.path,
    options.evidencePath,
  )
  let recovered = await readMissionSnapshot(recoveryPage, missionId)
  if (recovered.mission.status !== 'finalized') {
    try {
      const retry = await recoveryPage.evaluate(async (id) => {
        const store = window.sartrackerElectron?.missionStore
        const issued = await store.issueMissionArchiveRecoveryCode(id)
        return store.finalizeMission(id, { operationId: issued.operationId, recoveryCode: issued.recoveryCode, passphrase: 'C02 pending lifecycle archive passphrase 2026!' })
      }, missionId)
      report.pendingFinalize.retry = { missionStatus: retry?.mission?.status ?? null, archiveStatus: retry?.archive?.status ?? null, error: null }
    } catch (error) {
      report.pendingFinalize.retry = { missionStatus: null, archiveStatus: null, error: messageOf(error) }
    }
    recovered = await readMissionSnapshot(recoveryPage, missionId)
  }
  report.pendingFinalize.settled = recovered.mission.status === 'finalized'
  report.pendingFinalize.finalMission = { id: recovered.mission.id, status: recovered.mission.status }
  report.pendingFinalize.audit = recovered.audit
  report.mission.snapshots.afterRecovery = recovered
  report.mission.audit.afterRecovery = recovered.audit
  report.fault.observed = report.fault.observed && (
    report.pendingFinalize.settled || report.pendingFinalize.retry?.error?.includes('ARCHIVE_EVIDENCE_HEALTH_BLOCKED') === true
  )
  if (!report.pendingFinalize.settled) {
    if (report.pendingFinalize.retry?.error?.includes('ARCHIVE_EVIDENCE_HEALTH_BLOCKED') !== true) {
      throw new Error(`C02 pending-finalize recovery did not settle a finalized mission: ${report.pendingFinalize.retry?.error ?? 'unknown recovery result'}`)
    }
    report.pendingFinalize.blocked = true
    if (report.fault.evidenceHealthWarning !== true) {
      throw new Error('C02 pending-finalize evidence-health warning was not rendered after recovery.')
    }
    await closePackaged(recoveryApp, report, 'pending-finalize blocked recovery close')
    return
  }
  await closePackaged(recoveryApp, report, 'pending-finalize recovery close')
}

/** Reads the production crash recovery IPC state from a live renderer. */
async function readRecoveryState(app) {
  const page = await app.firstWindow()
  return page.evaluate(() => window.sartrackerElectron?.readCrashRecoveryState())
}

/** Opens the real diagnostics workspace and records whether the recovery notice is rendered. */
async function readRecoveryNotice(page) {
  try {
    await page.getByTestId('open-diagnostics-workspace').click({ timeout: 15_000 })
    await page.getByTestId('diagnostics-workspace').waitFor({ state: 'visible', timeout: 15_000 })
    return await page.getByTestId('diagnostics-crash-recovery-notice').isVisible().catch(() => false)
  } catch {
    return false
  }
}

/** Reads the operator-visible evidence-health warning after a recovered fault. */
async function readEvidenceHealthWarning(page) {
  try {
    const warning = page.getByTestId('ingest-evidence-health-warning')
    await warning.waitFor({ state: 'visible', timeout: 15_000 })
    return await warning.isVisible()
  } catch {
    return false
  }
}

/** Copies the exact durable renderer-loss marker into the attempt evidence lease. */
async function retainEvidenceLossMarker(profilePath, evidencePath) {
  const markerDirectory = path.join(profilePath, 'ingest-anomaly-outbox')
  const markerName = (await readdir(markerDirectory)).find((name) => name.endsWith('.marker'))
  if (markerName === undefined) throw new Error('C02 renderer-loss marker was not retained by the profile.')
  const markerBytes = await readFile(path.join(markerDirectory, markerName))
  const markerPath = path.join(evidencePath, 'renderer-loss-marker.json')
  await writeFile(markerPath, markerBytes, { mode: 0o600, flag: 'wx' })
  return {
    path: markerPath,
    bytes: markerBytes.byteLength,
    sha256: sha256(markerBytes),
  }
}

/** Closes a packaged app and retains the observed process termination. */
async function closePackaged(app, report, label) {
  const processHandle = app.process()
  await app.close()
  if (processHandle !== null) {
    report.runtime.closes ??= []
    report.runtime.closes.push({ label, pid: processHandle.pid ?? null, exitCode: processHandle.exitCode, signal: processHandle.signalCode })
  }
}

/** Waits for the real operator shell without using a test-only renderer harness. */
async function waitForShell(page) {
  await page.getByTestId('app-shell').waitFor({ state: 'visible', timeout: 60_000 })
}

/** Waits for a bounded main-process value without replacing the runtime with a mock. */
async function waitForMainValue(app, expression, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = await app.evaluate(expression)
    if (value !== null && value !== undefined) return value
    await delay(25)
  }
  throw new Error('Timed out waiting for packaged main-process lifecycle evidence.')
}

/** Waits for a bounded renderer-side lifecycle fact. */
async function waitForPageValue(page, expression, predicate, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = await page.evaluate(expression)
    if (predicate(value)) return value
    await delay(25)
  }
  throw new Error('Timed out waiting for packaged renderer lifecycle evidence.')
}

/** Reads the checkout identity without deriving proof from an unbound report field. */
function readSourceIdentity(expectedHead) {
  const head = gitOutput(['rev-parse', 'HEAD'])
  const status = gitOutput(['status', '--porcelain'])
  if (head !== expectedHead) throw new Error(`C02 source head ${head} differs from expected ${expectedHead}.`)
  return { head, dirty: status.trim() !== '', statusSha256: sha256(status) }
}

/** Hashes one file without changing it. */
async function hashFile(filePath) {
  const bytes = await readFile(filePath)
  return sha256(bytes)
}

/** Runs one bounded git identity command. */
function gitOutput(args) {
  return execFileSync('git', args, { cwd: projectRoot, encoding: 'utf8' }).trim()
}

/** Delays one bounded polling interval. */
function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

/** Returns an error message without exposing arbitrary objects. */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

/** Hashes an in-memory value for source custody. */
function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

/** Returns the fixed fault request name for one C02 variant. */
function faultName(variantId) {
  return {
    'graceful-close': 'graceful-window-close',
    reload: 'renderer-reload',
    'renderer-crash': 'renderer-forceful-crash',
    'main-sigkill': 'main-process-sigkill',
    'pending-finalize': 'main-process-sigkill-at-finalize-phase',
  }[variantId]
}
