#!/usr/bin/env node

// Controlled packaged-Electron memory attribution against an APFS clone of a
// completed tracking soak database. This is a proof harness only: every phase
// disables tracking and autosave, then triggers exactly one named workload.

import { execFile, spawn } from 'node:child_process'
import { constants as fsConstants, createReadStream } from 'node:fs'
import {
  copyFile,
  mkdir,
  readFile,
  stat,
  writeFile,
} from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright'

import {
  parseDarwinProcessTreeResidentMemory,
} from '../build/electron-tracking-soak-lib.js'
import {
  summarizeMemoryPhase,
} from '../build/electron-tracking-memory-attribution-lib.js'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SAMPLE_INTERVAL_MS = 250
const BASELINE_MS = 10_000
const SETTLE_MS = 15_000

main().catch((error) => {
  console.error(
    `electron-tracking-memory-attribution: ${error instanceof Error ? error.message : String(error)}`,
  )
  process.exitCode = 1
})

/** Runs four isolated workload phases against clones of one completed database. */
async function main() {
  const options = parseArgs(process.argv.slice(2))
  await mkdir(options.evidenceDir)
  const sourceDatabasePath = path.join(options.sourceUserDataDir, 'mission-store.sqlite')
  const source = inspectSourceDatabase(sourceDatabasePath)
  const phases = []
  for (const definition of [
    {
      name: 'idle',
      action: async () => {
        await delay(20_000)
        return { durationMs: 20_000 }
      },
    },
    {
      name: 'canonical-query',
      action: runCanonicalQuery,
    },
    {
      name: 'single-backup',
      action: runSingleBackup,
    },
    {
      name: 'incremental-bursts',
      action: runIncrementalBursts,
    },
  ]) {
    console.log(`[memory-attribution] starting ${definition.name}`)
    const phase = await runIsolatedPhase({
      ...options,
      ...definition,
      missionId: source.missionId,
    })
    phases.push(phase)
    await writeJson(
      path.join(options.evidenceDir, `${definition.name}.json`),
      phase,
    )
    console.log(
      `[memory-attribution] ${definition.name} peak=${phase.summary.maximumResidentBytes} ` +
        `main=${phase.summary.peakByProcessKind.main ?? 0} ` +
        `mainHeap=${phase.summary.maximumMainHeapUsedBytes}`,
    )
  }
  const report = {
    schemaVersion: 1,
    recordedAt: new Date().toISOString(),
    app: {
      executablePath: options.appPath,
      executableSha256: await sha256File(options.appPath),
      appAsarSha256: await sha256File(options.appAsarPath),
    },
    source: {
      userDataDir: options.sourceUserDataDir,
      databasePath: sourceDatabasePath,
      databaseBytes: (await stat(sourceDatabasePath)).size,
      ...source,
    },
    controls: {
      trackingEnabled: false,
      autosaveEnabled: false,
      baselineMs: BASELINE_MS,
      settleMs: SETTLE_MS,
      sampleIntervalMs: SAMPLE_INTERVAL_MS,
      isolation: 'fresh cloned database and fresh packaged process per phase',
    },
    phases,
  }
  await writeJson(
    path.join(options.evidenceDir, 'electron-tracking-memory-attribution-report.json'),
    report,
  )
}

async function runIsolatedPhase(input) {
  const phaseRoot = path.join(input.evidenceDir, input.name)
  const userDataDir = path.join(phaseRoot, 'user-data')
  await mkdir(userDataDir, { recursive: true })
  await cloneControlledUserData(input.sourceUserDataDir, userDataDir)
  const launch = await launchPackagedApp(input.appPath, userDataDir)
  const samples = []
  const samplingErrors = []
  let stage = 'baseline'
  let stopped = false
  const sampler = (async () => {
    while (!stopped) {
      const startedAt = Date.now()
      try {
        samples.push(await sampleLaunchMemory(launch, stage))
      } catch (error) {
        samplingErrors.push({
          observedAt: new Date().toISOString(),
          name: error instanceof Error ? error.name : 'UnknownError',
        })
      }
      await delay(Math.max(0, SAMPLE_INTERVAL_MS - (Date.now() - startedAt)))
    }
  })()
  let actionResult
  try {
    await delay(BASELINE_MS)
    stage = input.name
    const startedAt = performance.now()
    actionResult = await input.action(launch.page, input.missionId)
    actionResult = {
      ...actionResult,
      measuredDurationMs: performance.now() - startedAt,
    }
    stage = 'settle'
    await delay(SETTLE_MS)
  } finally {
    stopped = true
    await sampler
    await closeLaunch(launch)
  }
  return {
    name: input.name,
    userDataDir,
    actionResult,
    samplingErrors,
    summary: summarizeMemoryPhase(samples),
    stageSummaries: Object.fromEntries(
      [...new Set(samples.map((sample) => sample.stage))].map((sampleStage) => [
        sampleStage,
        summarizeMemoryPhase(samples.filter((sample) => sample.stage === sampleStage)),
      ]),
    ),
    samples,
  }
}

/** Runs the exact production packaged canonical breadcrumb worker and IPC bridge. */
async function runCanonicalQuery(page, missionId) {
  return page.evaluate(async ({ missionId }) => {
    const result = await window.sartrackerElectron?.missionStore.listBreadcrumbPositions(
      missionId,
      5_000,
    )
    if (result === undefined) {
      throw new Error('Packaged canonical breadcrumb bridge is unavailable.')
    }
    return {
      retainedPositionCount: result.positions.length,
      observedPositionCount: result.deviceTotals.reduce(
        (total, device) => total + device.total,
        0,
      ),
      selectedDeviceCount: result.deviceSelections.length,
      droppedPositionCount: result.droppedPositionCount,
    }
  }, { missionId })
}

/** Runs one production packaged backup with no concurrent autosave or tracking. */
async function runSingleBackup(page) {
  const backupPath = await page.evaluate(async () => {
    const syncBackup = window.sartrackerElectron?.missionStore.syncBackup
    if (typeof syncBackup !== 'function') {
      throw new Error('Packaged backup bridge is unavailable.')
    }
    return syncBackup('memory-attribution')
  })
  return { backupPathBasename: path.basename(backupPath) }
}

/** Runs 30 production-sized 1,440-position IPC writes with no backup overlap. */
async function runIncrementalBursts(page, missionId) {
  return page.evaluate(async ({ missionId }) => {
    const store = window.sartrackerElectron?.missionStore
    if (store === undefined || typeof store.persistTrackingPositionsBulk !== 'function') {
      throw new Error('Packaged tracking bulk persistence bridge is unavailable.')
    }
    const devices = await store.listDevices(missionId)
    const deviceIds = devices.slice(0, 8).map((device) => device.device_id)
    if (deviceIds.length !== 8) {
      throw new Error('Memory attribution requires eight persisted devices.')
    }
    const bursts = 30
    const positionsPerBurst = 1_440
    let insertedPositionCount = 0
    let changedPositionCount = 0
    for (let burst = 0; burst < bursts; burst += 1) {
      const positions = Array.from({ length: positionsPerBurst }, (_, index) => {
        const ordinal = burst * positionsPerBurst + index
        return {
          source_position_id: `memory-attribution-${ordinal}`,
          device_id: deviceIds[index % deviceIds.length],
          lat: 53 + (ordinal % 10_000) / 1_000_000,
          lon: -8 - (ordinal % 10_000) / 1_000_000,
          altitude: 100,
          speed: 1,
          battery: 80,
          accuracy: 5,
          source: 'memory-attribution',
          timestamp: new Date(Date.UTC(2026, 7, 10) + ordinal * 1_000).toISOString(),
          data_origin: 'live',
        }
      })
      const result = await store.persistTrackingPositionsBulk({
        mission_id: missionId,
        positions,
        checkpoints: [],
      })
      insertedPositionCount += result.insertedPositionCount
      changedPositionCount += result.changedPositionCount
    }
    return {
      bursts,
      positionsPerBurst,
      requestedPositionCount: bursts * positionsPerBurst,
      insertedPositionCount,
      changedPositionCount,
    }
  }, { missionId })
}

async function cloneControlledUserData(sourceUserDataDir, targetUserDataDir) {
  const sourceSettings = JSON.parse(
    await readFile(path.join(sourceUserDataDir, 'settings.json'), 'utf8'),
  )
  sourceSettings.missionDefaults.autoSaveEnabled = false
  sourceSettings.dataSource.providerType = 'none'
  sourceSettings.dataSource.autoConnect = false
  sourceSettings.dataSource.baseUrl = ''
  await writeJson(path.join(targetUserDataDir, 'settings.json'), sourceSettings)
  await cloneFile(
    path.join(sourceUserDataDir, 'mission-store.sqlite'),
    path.join(targetUserDataDir, 'mission-store.sqlite'),
  )
  await copyFile(
    path.join(sourceUserDataDir, 'credentials.json'),
    path.join(targetUserDataDir, 'credentials.json'),
  ).catch((error) => {
    if (error?.code !== 'ENOENT') throw error
  })
}

async function cloneFile(sourcePath, targetPath) {
  await copyFile(sourcePath, targetPath, fsConstants.COPYFILE_FICLONE)
}

async function launchPackagedApp(appPath, userDataDir) {
  const remoteDebuggingPort = await findFreePort()
  const inspectorPort = await findFreePort()
  const appProcess = spawn(
    appPath,
    [`--inspect=${inspectorPort}`, `--remote-debugging-port=${remoteDebuggingPort}`],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        SARTRACKER_ELECTRON_USER_DATA_PATH: userDataDir,
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    },
  )
  const stderr = []
  appProcess.stderr.on('data', (chunk) => stderr.push(chunk))
  try {
    await waitForCdp(remoteDebuggingPort, appProcess)
    const mainInspector = await connectInspector(inspectorPort, appProcess)
    const browser = await chromium.connectOverCDP(
      `http://127.0.0.1:${remoteDebuggingPort}`,
    )
    const context = browser.contexts()[0]
    const page = context.pages()[0] ?? await context.waitForEvent('page')
    await page.getByTestId('app-shell').waitFor({ state: 'attached', timeout: 60_000 })
    const rendererSession = await context.newCDPSession(page)
    return {
      appProcess,
      browser,
      page,
      mainInspector,
      rendererSession,
      stderr,
    }
  } catch (error) {
    appProcess.kill('SIGTERM')
    throw new Error(
      `${error instanceof Error ? error.message : String(error)} ${Buffer.concat(stderr).toString('utf8')}`,
    )
  }
}

async function sampleLaunchMemory(launch, stage) {
  const sampledAt = new Date()
  const [processList, mainHeapResult, rendererHeapResult] = await Promise.all([
    readDarwinProcessList(),
    launch.mainInspector.evaluate('process.memoryUsage()'),
    launch.rendererSession.send('Runtime.getHeapUsage'),
  ])
  const resident = parseDarwinProcessTreeResidentMemory(
    processList,
    launch.appProcess.pid,
  )
  if (resident === null) {
    throw new Error('Darwin process-tree resident memory was unavailable.')
  }
  return {
    observedAt: sampledAt.toISOString(),
    stage,
    totalResidentBytes: resident.totalResidentBytes,
    processes: resident.processes,
    mainHeap: mainHeapResult,
    rendererHeap: {
      usedJSHeapSize: rendererHeapResult.usedSize,
      totalJSHeapSize: rendererHeapResult.totalSize,
      embedderHeapUsedSize: rendererHeapResult.embedderHeapUsedSize,
      backingStorageSize: rendererHeapResult.backingStorageSize,
    },
  }
}

async function closeLaunch(launch) {
  launch.mainInspector.close()
  await launch.rendererSession.detach().catch(() => undefined)
  await launch.browser.close().catch(() => undefined)
  launch.appProcess.kill('SIGTERM')
  await waitForExit(launch.appProcess, 10_000)
  if (launch.appProcess.exitCode === null) {
    launch.appProcess.kill('SIGKILL')
    await waitForExit(launch.appProcess, 5_000)
  }
}

function inspectSourceDatabase(databasePath) {
  const database = new Database(databasePath, { readonly: true, fileMustExist: true })
  try {
    const mission = database
      .prepare('SELECT id, status FROM missions ORDER BY start_time DESC LIMIT 1')
      .get()
    if (mission === undefined) throw new Error('Source database has no mission.')
    return {
      missionId: mission.id,
      missionStatus: mission.status,
      positionRows: Number(
        database.prepare('SELECT COUNT(*) AS count FROM positions').get().count,
      ),
      integrityResult: database.pragma('integrity_check', { simple: true }),
    }
  } finally {
    database.close()
  }
}

function parseArgs(args) {
  const values = new Map()
  for (let index = 0; index < args.length; index += 2) {
    values.set(args[index], args[index + 1])
  }
  const required = (name) => {
    const value = values.get(name)
    if (typeof value !== 'string' || value.trim() === '') {
      throw new Error(`Missing required argument ${name}.`)
    }
    return path.resolve(value)
  }
  const appPath = required('--app')
  return {
    appPath,
    appAsarPath: values.has('--app-asar')
      ? required('--app-asar')
      : path.resolve(appPath, '../../../Resources/app.asar'),
    sourceUserDataDir: required('--source-user-data'),
    evidenceDir: required('--evidence-dir'),
  }
}

async function readDarwinProcessList() {
  return new Promise((resolve, reject) => {
    execFile(
      '/bin/ps',
      ['-axo', 'pid=,ppid=,rss=,command='],
      { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 },
      (error, stdout) => error === null ? resolve(stdout) : reject(error),
    )
  })
}

async function connectInspector(port, appProcess) {
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
      // Poll until the inspector is ready.
    }
    await delay(100)
  }
  if (webSocketUrl === undefined) throw new Error('Main inspector did not start.')
  const socket = new WebSocket(webSocketUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  let requestId = 0
  const pending = new Map()
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data))
    const request = pending.get(message.id)
    if (request === undefined) return
    pending.delete(message.id)
    if (message.error !== undefined || message.result?.exceptionDetails !== undefined) {
      request.reject(new Error('Main inspector evaluation failed.'))
      return
    }
    request.resolve(message.result?.result?.value)
  })
  return {
    evaluate: (expression) => new Promise((resolve, reject) => {
      requestId += 1
      pending.set(requestId, { resolve, reject })
      socket.send(JSON.stringify({
        id: requestId,
        method: 'Runtime.evaluate',
        params: { expression, returnByValue: true },
      }))
    }),
    close: () => socket.close(),
  }
}

async function waitForCdp(port, appProcess) {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    assertProcessAlive(appProcess, 'renderer startup')
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`)
      if (response.ok) return
    } catch {
      // Poll until CDP is ready.
    }
    await delay(100)
  }
  throw new Error('Renderer CDP did not start.')
}

async function findFreePort() {
  const net = await import('node:net')
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') {
        reject(new Error('Could not allocate a probe port.'))
        return
      }
      server.close(() => resolve(address.port))
    })
  })
}

function assertProcessAlive(child, phase) {
  if (child.exitCode !== null) {
    throw new Error(`Packaged app exited during ${phase} with ${child.exitCode}.`)
  }
}

async function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null) return
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    delay(timeoutMs),
  ])
}

async function sha256File(filePath) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filePath)) hash.update(chunk)
  return hash.digest('hex')
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}
