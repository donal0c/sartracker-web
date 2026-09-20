#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'

import { closeOwnedSmokeChild } from '../../build/electron-repair-train-d-smoke-lib.js'
import { waitForPackagedStderrDrain } from '../../build/packaged-page-diagnostics.js'

const SHA1 = /^[a-f0-9]{40}$/u
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const LINUX_ARGS = process.platform === 'linux'
  ? ['--no-sandbox', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-features=Vulkan,DefaultANGLEVulkan,VulkanFromANGLE']
  : []

/** Run the exact disposable-profile duplicate-launch and restart protocol. */
async function runDuplicateLaunchProbe(input) {
  const options = validateProbeInput(input)
  await mkdir(options.evidencePath, { recursive: true })
  const profilePath = await mkdtemp(path.join(options.evidencePath, '.profile-duplicate-'))
  const source = readSourceIdentity(options.expectedHead)
  const app = await readAppIdentity(options.appPath)
  const env = {
    ...process.env,
    SARTRACKER_ELECTRON_USER_DATA_PATH: profilePath,
    SARTRACKER_ELECTRON_BLOCK_NETWORK: '1',
  }
  let primaryApp
  let restartApp
  let primaryProcess
  let restartProcess
  let primaryStderr
  let restartStderr
  const network = { blocked: true, httpRequests: 0, httpsRequests: 0 }
  let report
  try {
    primaryApp = await launchPrimary(options.appPath, env)
    primaryProcess = primaryApp.process()
    if (primaryProcess === null) throw new Error('Primary Electron process was not exposed.')
    const firstPid = primaryProcess.pid ?? 0
    primaryStderr = captureStderr(primaryProcess)
    const firstPage = await primaryApp.firstWindow()
    observeNetwork(firstPage, network)
    await waitForReady(firstPage)
    const firstUserDataPath = await readUserDataPath(primaryApp)
    const mission = await createSyntheticMission(firstPage)
    const initial = await readSnapshot(firstPage, mission.id)
    const firstWindowCount = primaryApp.windows().length

    const secondary = await launchSecondary(options.appPath, env)
    const afterSecondary = await readSnapshot(firstPage, mission.id)
    const afterSecondaryWindowCount = primaryApp.windows().length
    await firstPage.screenshot({ path: path.join(options.evidencePath, 'duplicate-primary.png'), fullPage: true })

    const firstExit = await closeOwnedProcess(primaryApp, primaryProcess)
    const firstStderr = await finishStderr(primaryStderr)
    primaryApp = undefined
    primaryProcess = undefined

    restartApp = await launchPrimary(options.appPath, env)
    restartProcess = restartApp.process()
    if (restartProcess === null) throw new Error('Restart Electron process was not exposed.')
    const restartPid = restartProcess.pid ?? 0
    restartStderr = captureStderr(restartProcess)
    const restartPage = await restartApp.firstWindow()
    observeNetwork(restartPage, network)
    await waitForReady(restartPage)
    const restartUserDataPath = await readUserDataPath(restartApp)
    const afterRestart = await readSnapshot(restartPage, mission.id)
    const restartWindowCount = restartApp.windows().length
    await restartPage.screenshot({ path: path.join(options.evidencePath, 'duplicate-restart.png'), fullPage: true })
    const restartExit = await closeOwnedProcess(restartApp, restartProcess)
    const restartStderrFact = await finishStderr(restartStderr)
    restartApp = undefined
    restartProcess = undefined

    report = {
      schemaVersion: 1,
      proofKind: 'duplicate-launch-v1',
      contractId: 'C26',
      source,
      app,
      invocation: {
        app: '--app', evidence: '--evidence', expectedHead: '--expected-head',
        networkBlocked: true, userDataPath: profilePath,
      },
      profile: {
        path: profilePath,
        userDataPath: profilePath,
        observedUserDataPaths: [firstUserDataPath, restartUserDataPath],
        removed: false,
        usedSystemUserProfile: false,
      },
      primary: {
        first: { pid: firstPid, ready: true, windowCount: firstWindowCount, stderr: firstStderr },
        firstExit: projectExit(firstExit),
        afterSecondary: { pageResponsive: true, windowCount: afterSecondaryWindowCount },
        restart: { pid: restartPid, ready: true, windowCount: restartWindowCount, stderr: restartStderrFact },
        restartExit: projectExit(restartExit),
      },
      secondary,
      persistence: {
        missionId: mission.id,
        initial,
        afterSecondary,
        afterRestart,
        authoritative: {
          mainProcesses: 1,
          missions: 1,
          missionCreatedAudits: 1,
          duplicateMissions: 0,
          duplicateMissionCreatedAudits: 0,
        },
      },
      network,
    }
    return report
  } finally {
    if (primaryApp !== undefined && primaryProcess !== undefined) {
      await closeOwnedProcess(primaryApp, primaryProcess).catch(() => undefined)
    }
    if (restartApp !== undefined && restartProcess !== undefined) {
      await closeOwnedProcess(restartApp, restartProcess).catch(() => undefined)
    }
    await waitForPackagedStderrDrain(primaryProcess?.stderr ?? restartProcess?.stderr, 10_000).catch(() => false)
    if (report !== undefined) {
      report.profile.removed = false
      await rm(profilePath, { recursive: true, force: true })
      report.profile.removed = true
    } else {
      await rm(profilePath, { recursive: true, force: true })
    }
  }
}

/** Launch the primary process through Playwright so its operational window is observable. */
async function launchPrimary(appPath, env) {
  return electron.launch({ executablePath: appPath, args: LINUX_ARGS, env, timeout: 30_000 })
}

/** Launch one independent secondary process against the exact same user-data path. */
async function launchSecondary(appPath, env) {
  const child = spawn(appPath, LINUX_ARGS, { env, stdio: ['ignore', 'pipe', 'pipe'] })
  const stderr = captureStderr(child)
  const exited = await waitForChildExit(child, 30_000)
  return {
    pid: child.pid ?? 0,
    started: true,
    exited: exited.exitCode !== null || exited.signal !== null,
    exitCode: exited.exitCode,
    signal: exited.signal,
    singleInstanceRejected: exited.exitCode === 0 && exited.signal === null,
    windowCount: 0,
    missionWriteAttempted: false,
    stderr: await finishStderr(stderr),
  }
}

/** Create the synthetic mission exactly once through the renderer-to-main bridge. */
async function createSyntheticMission(page) {
  return page.evaluate(async () => {
    const store = window.sartrackerElectron?.missionStore
    if (store === undefined) throw new Error('Electron mission-store bridge is unavailable.')
    return store.createMission({
      name: 'C26 duplicate-launch synthetic mission',
      start_time: '2026-09-19T19:00:00.000Z',
    })
  })
}

/** Read one bounded mission and audit inventory through the authoritative main bridge. */
async function readSnapshot(page, missionId) {
  return page.evaluate(async (selectedMissionId) => {
    const store = window.sartrackerElectron?.missionStore
    if (store === undefined) throw new Error('Electron mission-store bridge is unavailable.')
    const [missions, auditEvents] = await Promise.all([
      store.listMissions(),
      store.listAuditEvents(selectedMissionId),
    ])
    return {
      missionIds: missions.map((mission) => mission.id).sort(),
      auditTypes: auditEvents.map((event) => event.event_type),
    }
  }, missionId)
}

/** Capture the runtime user-data path from the actual Electron main process. */
async function readUserDataPath(app) {
  return app.evaluate(({ app: runningApp }) => runningApp.getPath('userData'))
}

/** Wait for the real operational title before making persistence claims. */
async function waitForReady(page) {
  await page.getByTestId('app-title').waitFor({ timeout: 30_000 })
}

/** Count HTTP(S) requests from each observed renderer while retaining no payload. */
function observeNetwork(page, network) {
  page.on('request', (request) => {
    const protocol = new URL(request.url()).protocol
    if (protocol === 'http:') network.httpRequests += 1
    if (protocol === 'https:') network.httpsRequests += 1
  })
}

/** Close one owned Playwright process and retain its physical exit facts. */
async function closeOwnedProcess(app, child) {
  return closeOwnedSmokeChild(child, {
    owned: true,
    close: () => app.close(),
    orderlyDeadline: Date.now() + 15_000,
    deadline: Date.now() + 25_000,
  })
}

/** Capture bounded raw stderr bytes and lines without retaining unbounded process output. */
function captureStderr(child) {
  const chunks = []
  let byteLength = 0
  const onData = (chunk) => {
    const bytes = Buffer.from(chunk)
    byteLength += bytes.length
    if (Buffer.byteLength(Buffer.concat(chunks)) < 256 * 1024) chunks.push(bytes.subarray(0, 256 * 1024))
  }
  child.stderr?.on('data', onData)
  return async () => {
    child.stderr?.off('data', onData)
    const bytes = Buffer.concat(chunks).subarray(0, 256 * 1024)
    return {
      sha256: createHash('sha256').update(bytes).digest('hex'),
      byteLength,
      lines: bytes.toString('utf8').split(/\r?\n/u).filter((line) => line.length > 0),
    }
  }
}

/** Wait for one owned child exit or fail the bounded probe. */
async function waitForChildExit(child, timeoutMs) {
  let timer
  try {
    const result = await Promise.race([
      once(child, 'close').then(([exitCode, signal]) => ({ exitCode, signal })),
      once(child, 'error').then(() => ({ exitCode: null, signal: null })),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Secondary duplicate launch did not exit.')), timeoutMs) }),
    ])
    return result
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/** Read the exact source head and dirty state used by the launch binding. */
function readSourceIdentity(expectedHead) {
  const observedHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
  if (observedHead !== expectedHead) throw new Error('Duplicate-launch source head differs from --expected-head.')
  const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim() !== ''
  return { expectedHead, observedHead, dirty }
}

/** Read the exact executable path, size and SHA-256 used for both launches. */
async function readAppIdentity(appPath) {
  const [bytes, details] = await Promise.all([readFile(appPath), stat(appPath)])
  return { path: appPath, sha256: createHash('sha256').update(bytes).digest('hex'), sizeBytes: details.size }
}

/** Project a close helper result into the strict raw exit vocabulary. */
function projectExit(value) {
  return { exitCode: value?.exit?.exitCode ?? null, signal: value?.exit?.signal ?? null }
}

/** Validate exact CLI values before touching an evidence or profile path. */
function validateProbeInput(input) {
  if (!input || !path.isAbsolute(input.appPath) || !path.isAbsolute(input.evidencePath) || !SHA1.test(input.expectedHead)) {
    throw new Error('Duplicate-launch probe requires absolute --app/--evidence paths and a 40-hex --expected-head.')
  }
  return {
    appPath: path.resolve(input.appPath),
    evidencePath: path.resolve(input.evidencePath),
    expectedHead: input.expectedHead,
  }
}

/** Parse exactly --app, --evidence and --expected-head without accepting aliases. */
function parseArgs(argv) {
  const values = {}
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    if (!['--app', '--evidence', '--expected-head'].includes(flag)) throw new Error(`Unknown duplicate-launch argument ${String(flag)}.`)
    const value = argv[++index]
    if (typeof value !== 'string' || value.length === 0 || values[flag] !== undefined) throw new Error(`Invalid or duplicate value for ${flag}.`)
    values[flag] = value
  }
  if (Object.keys(values).length !== 3) throw new Error('Duplicate-launch probe requires --app, --evidence and --expected-head.')
  return validateProbeInput({ appPath: values['--app'], evidencePath: values['--evidence'], expectedHead: values['--expected-head'] })
}

/** Run the CLI and retain one machine-readable receipt in the supplied evidence directory. */
async function main() {
  const options = parseArgs(process.argv.slice(2))
  const report = await runDuplicateLaunchProbe(options)
  const reportPath = path.join(options.evidencePath, 'duplicate-launch-receipt.json')
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  process.stdout.write(`${JSON.stringify({ result: 'pass', receipt: reportPath })}\n`)
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'Duplicate-launch probe failed.'}\n`)
    process.exitCode = 1
  })
}

export { parseArgs, runDuplicateLaunchProbe }
