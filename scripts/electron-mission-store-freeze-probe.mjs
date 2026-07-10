#!/usr/bin/env node

// Packaged-Electron mission-store autosave freeze probe (DON-243).
//
// Copies a deterministic field-scale mission-store fixture into an isolated
// Electron user-data directory, waits for real periodic autosaves, and records
// both main-process IPC latency and the externally observed backup file phases.

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright'

import { sanitizeEvidenceText } from '../build/electron-official-map-offline-smoke-lib.js'
import {
  buildMissionStoreProbeVerdict,
  createBackupTimelineState,
  isTemporaryBackupDatabaseName,
  parseMissionStoreProbeArgs,
  updateBackupTimeline,
} from '../build/electron-mission-store-freeze-probe-lib.js'
import { summarizeResponsiveness } from '../build/electron-map-freeze-probe-lib.js'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const databaseFileName = 'mission-store.sqlite'
const backupFileName = 'mission-store.backup.sqlite'

main().catch((error) => {
  console.error(`mission-store-freeze-probe: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})

/** Runs one isolated packaged-app baseline and writes fail-closed evidence. */
async function main() {
  const options = parseMissionStoreProbeArgs(process.argv.slice(2))
  const evidenceDir = path.resolve(options.evidenceDir)
  const userDataDir = path.join(evidenceDir, 'user-data')
  const databasePath = path.join(userDataDir, databaseFileName)
  const backupPath = path.join(userDataDir, backupFileName)
  await mkdir(userDataDir, { recursive: true })

  const fixture = await stat(options.fixturePath)
  if (!fixture.isFile() || fixture.size <= 0) {
    throw new Error(`Fixture is not a non-empty file: ${options.fixturePath}`)
  }

  console.log(`[mission-store-freeze-probe] copying ${formatBytes(fixture.size)} fixture`)
  const fixtureCopyStartedAtMs = Date.now()
  await copyFile(options.fixturePath, databasePath)
  const fixtureCopyDurationMs = Date.now() - fixtureCopyStartedAtMs
  await copyFixtureManifestIfPresent(options.fixturePath, databasePath)
  await writeJson(path.join(userDataDir, 'settings.json'), createProbeSettings())

  const port = await findFreePort()
  const inspectorPort = await findFreePort()
  const appLogPath = path.join(evidenceDir, 'electron-app.log')
  const logChunks = []
  const appProcess = spawn(
    options.appPath,
    [`--inspect=${inspectorPort}`, `--remote-debugging-port=${port}`, ...options.extraArgs],
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

  let browser
  let mainInspector
  let report
  let mainHeartbeat
  try {
    await waitForCdp(port, appProcess)
    mainInspector = await connectMainInspector(inspectorPort, appProcess)
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
    const context = browser.contexts()[0]
    const page = context.pages()[0] ?? (await context.waitForEvent('page'))
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.getByTestId('app-shell').waitFor({ timeout: 60_000 })
    await installRendererResponsivenessProbe(page)
    await page.screenshot({ path: path.join(evidenceDir, '01-baseline-ready.png'), fullPage: true })

    const observationStartedAtMs = Date.now()
    mainHeartbeat = startExternalMainProcessHeartbeat(mainInspector, options.probeIntervalMs)
    const timeline = await observeBackupCycles({
      userDataDir,
      backupPath,
      databaseBytes: fixture.size,
      expectedCycles: options.expectedCycles,
      timeoutMs: options.timeoutMs,
      appProcess,
    })
    const mainSamples = await mainHeartbeat.stop()
    const rendererGaps = await collectRendererResponsivenessProbe(page)
    await page.screenshot({ path: path.join(evidenceDir, '02-after-autosaves.png'), fullPage: true })

    const mainStats = summarizeResponsiveness(mainSamples.roundTrips, 250)
    const rendererStats = summarizeResponsiveness(rendererGaps, 250)
    const verdict = buildMissionStoreProbeVerdict({
      cycles: timeline.cycles,
      expectedCycles: options.expectedCycles,
      mainStats,
      rendererStats,
      mainHeartbeatErrors: mainSamples.errors,
      freezeThresholdMs: options.freezeThresholdMs,
      expectation: options.expectation,
    })
    report = {
      schemaVersion: 1,
      issue: 'DON-243',
      recordedAt: new Date().toISOString(),
      platform: {
        os: `${os.type()} ${os.release()}`,
        architecture: os.arch(),
        node: process.version,
      },
      app: {
        basename: path.basename(options.appPath),
        sha256: await sha256File(options.appPath),
      },
      fixture: {
        basename: path.basename(options.fixturePath),
        bytes: fixture.size,
        sha256: await sha256File(options.fixturePath),
        copyDurationMs: fixtureCopyDurationMs,
      },
      probe: {
        expectedCycles: options.expectedCycles,
        timeoutMs: options.timeoutMs,
        probeIntervalMs: options.probeIntervalMs,
        observationDurationMs: Date.now() - observationStartedAtMs,
      },
      backupCycles: timeline.cycles,
      incompleteBackupCycle: timeline.activeCycle,
      processMemory: timeline.processMemory,
      mainProcess: mainStats,
      mainProcessHeartbeatErrors: mainSamples.errors,
      renderer: rendererStats,
      verdict,
    }
    await writeJson(path.join(evidenceDir, 'mission-store-freeze-probe-report.json'), report)

    console.log(
      `[mission-store-freeze-probe] cycles=${timeline.cycles.length}/${options.expectedCycles} ` +
        `main-max=${mainStats.maxMs.toFixed(0)}ms renderer-max=${rendererStats.maxMs.toFixed(0)}ms ` +
        `frozen=${verdict.frozen} valid=${verdict.probeValid}`,
    )
    for (const [index, cycle] of timeline.cycles.entries()) {
      console.log(
        `[mission-store-freeze-probe] cycle ${index + 1}: copy=${cycle.copyDurationMs}ms ` +
          `validation=${cycle.validationDurationMs}ms total=${cycle.totalDurationMs}ms`,
      )
    }
    if (!verdict.expectationMet) {
      throw new Error(
        `Probe expectation '${options.expectation}' was not met: ${verdict.invalidReasons.join(' ') || `frozen=${verdict.frozen}`}`,
      )
    }
  } finally {
    if (mainHeartbeat !== undefined) {
      await mainHeartbeat.stop()
    }
    if (mainInspector !== undefined) {
      mainInspector.close()
    }
    if (browser !== undefined) {
      await browser.close().catch(() => undefined)
    }
    appProcess.kill('SIGTERM')
    await waitForExit(appProcess, 5_000)
    await writeFile(
      appLogPath,
      sanitizeEvidenceText(Buffer.concat(logChunks).toString('utf8')),
      'utf8',
    )
    if (report === undefined) {
      console.error(`[mission-store-freeze-probe] incomplete evidence retained at ${evidenceDir}`)
    }
  }
}

/** Observes backup temp-file growth from outside Electron. */
async function observeBackupCycles(input) {
  let timeline = createBackupTimelineState({ databaseBytes: input.databaseBytes })
  const startedAtMs = Date.now()
  const processMemory = { samples: 0, maximumResidentBytes: 0 }

  while (timeline.cycles.length < input.expectedCycles) {
    if (input.appProcess.exitCode !== null) {
      throw new Error(`Electron exited during backup observation with code ${input.appProcess.exitCode}.`)
    }
    if (Date.now() - startedAtMs >= input.timeoutMs) {
      throw new Error(
        `Timed out after ${input.timeoutMs}ms with ${timeline.cycles.length}/${input.expectedCycles} backup cycles.`,
      )
    }

    timeline = updateBackupTimeline(
      timeline,
      await readBackupSnapshot(input.userDataDir, input.backupPath, Date.now() - startedAtMs),
    )
    const residentBytes = await readResidentBytes(input.appProcess.pid)
    if (residentBytes !== null) {
      processMemory.samples += 1
      processMemory.maximumResidentBytes = Math.max(
        processMemory.maximumResidentBytes,
        residentBytes,
      )
    }
    await delay(25)
  }

  return { ...timeline, processMemory }
}

/** Reads one external snapshot of temporary and final rolling backup files. */
async function readBackupSnapshot(userDataDir, backupPath, atMs) {
  const entries = await readdir(userDataDir, { withFileTypes: true })
  const names = entries
    .filter((entry) => entry.isFile() && isTemporaryBackupDatabaseName(entry.name))
    .map((entry) => entry.name)
    .sort()
  const temporaryFiles = []
  for (const name of names) {
    const metadata = await stat(path.join(userDataDir, name)).catch((error) => {
      if (error?.code === 'ENOENT') return null
      throw error
    })
    if (metadata !== null) {
      temporaryFiles.push({ name, size: metadata.size, mtimeMs: metadata.mtimeMs })
    }
  }
  const backup = await stat(backupPath)
    .then((metadata) => ({ exists: true, size: metadata.size, mtimeMs: metadata.mtimeMs }))
    .catch((error) => {
      if (error?.code === 'ENOENT') return { exists: false, size: 0, mtimeMs: 0 }
      throw error
    })
  return { atMs, temporaryFiles, backup }
}

/** Installs the separately reported renderer frame-cadence collector. */
async function installRendererResponsivenessProbe(page) {
  await page.evaluate(() => {
    const probe = { rendererGaps: [] }
    window.__MISSION_STORE_FREEZE_PROBE__ = probe
    let lastFrameAt = performance.now()
    const frame = (now) => {
      probe.rendererGaps.push(now - lastFrameAt)
      lastFrameAt = now
      window.requestAnimationFrame(frame)
    }
    window.requestAnimationFrame(frame)
  })
}

/**
 * Schedules direct Electron-main-isolate heartbeats from this external Node
 * process. The Node inspector bypasses the renderer completely; evaluation can
 * only complete when Electron's main JavaScript isolate is responsive.
 */
function startExternalMainProcessHeartbeat(mainInspector, probeIntervalMs) {
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
      const elapsedMs = performance.now() - startedAt
      await delay(Math.max(0, probeIntervalMs - elapsedMs))
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

/** Connects to Electron's main-process Node inspector using its CDP socket. */
async function connectMainInspector(port, appProcess) {
  const deadline = Date.now() + 60_000
  let webSocketUrl
  while (Date.now() < deadline) {
    if (appProcess.exitCode !== null) {
      throw new Error(`Electron exited before its main inspector opened with code ${appProcess.exitCode}.`)
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`)
      if (response.ok) {
        const targets = await response.json()
        webSocketUrl = targets[0]?.webSocketDebuggerUrl
        if (typeof webSocketUrl === 'string') break
      }
    } catch {
      // Keep polling until Electron exposes the main-process inspector.
    }
    await delay(250)
  }
  if (webSocketUrl === undefined) {
    throw new Error('Timed out waiting for the Electron main-process inspector.')
  }

  const socket = new WebSocket(webSocketUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', () => reject(new Error('Electron main inspector connection failed.')), {
      once: true,
    })
  })
  let requestId = 0
  const pending = new Map()
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data))
    if (typeof message.id !== 'number') return
    const request = pending.get(message.id)
    if (request === undefined) return
    pending.delete(message.id)
    if (message.error !== undefined || message.result?.exceptionDetails !== undefined) {
      request.reject(new Error(`Electron main inspector evaluation failed: ${JSON.stringify(message.error ?? message.result.exceptionDetails)}`))
      return
    }
    request.resolve(message.result)
  })
  socket.addEventListener('close', () => {
    for (const request of pending.values()) {
      request.reject(new Error('Electron main inspector closed with a request pending.'))
    }
    pending.clear()
  })

  return {
    evaluate: (expression) =>
      new Promise((resolve, reject) => {
        requestId += 1
        pending.set(requestId, { resolve, reject })
        socket.send(
          JSON.stringify({
            id: requestId,
            method: 'Runtime.evaluate',
            params: { expression, returnByValue: true },
          }),
        )
      }),
    close: () => socket.close(),
  }
}

/** Collects renderer frame gaps after all backup cycles drain. */
async function collectRendererResponsivenessProbe(page) {
  return page.evaluate(() => window.__MISSION_STORE_FREEZE_PROBE__?.rendererGaps ?? [])
}

/** Creates isolated settings with the shortest supported real autosave interval. */
function createProbeSettings() {
  return {
    missionDefaults: {
      autoRefreshEnabled: false,
      autoRefreshIntervalSeconds: 30,
      autoSaveEnabled: true,
      autoSaveIntervalSeconds: 5,
      primaryMissionRoot: '',
      backupMissionRoot: '',
      coordinatorRoster: [],
      adminRoster: [],
    },
    dataSource: {
      providerType: 'none',
      baseUrl: '',
      authMode: 'basic',
      email: '',
      autoConnect: false,
      trackingCacheEnabled: true,
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
  }
}

async function copyFixtureManifestIfPresent(sourcePath, targetPath) {
  const sourceManifest = `${sourcePath}.manifest.json`
  const targetManifest = `${targetPath}.manifest.json`
  await copyFile(sourceManifest, targetManifest).catch((error) => {
    if (error?.code !== 'ENOENT') throw error
  })
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

async function readResidentBytes(pid) {
  if (!Number.isInteger(pid) || process.platform !== 'linux') return null
  return readFile(`/proc/${pid}/status`, 'utf8')
    .then((contents) => {
      const match = contents.match(/^VmRSS:\s+(\d+)\s+kB$/mu)
      return match === null ? null : Number(match[1]) * 1024
    })
    .catch(() => null)
}

async function waitForCdp(port, appProcess) {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    if (appProcess.exitCode !== null) {
      throw new Error(`Electron exited before CDP became available with code ${appProcess.exitCode}.`)
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`)
      if (response.ok) return
    } catch {
      // Keep polling until the packaged application exposes CDP.
    }
    await delay(500)
  }
  throw new Error('Timed out waiting for the Electron remote-debugging port.')
}

async function findFreePort() {
  const net = await import('node:net')
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') {
        reject(new Error('Could not allocate a TCP port for Electron CDP.'))
        return
      }
      server.close(() => resolve(address.port))
    })
    server.on('error', reject)
  })
}

async function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null) return
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    delay(timeoutMs),
  ])
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function formatBytes(bytes) {
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GiB`
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}
