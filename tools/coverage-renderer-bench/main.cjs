const { app, BrowserWindow, ipcMain } = require('electron')
const { randomUUID } = require('node:crypto')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { Worker } = require('node:worker_threads')

const args = parseBenchArguments(process.argv.slice(1))
const pendingWorkerRequests = new Map()
const mainGapSamples = []
let rendererRssPeakBytes = 0
let mainWindow = null
let queryWorker = null
let shuttingDown = false
let lastMainProbeAt = performance.now()

const probe = setInterval(() => {
  const now = performance.now()
  mainGapSamples.push(Math.max(0, now - lastMainProbeAt - 50))
  rendererRssPeakBytes = Math.max(rendererRssPeakBytes, readCurrentRendererRssBytes())
  lastMainProbeAt = now
}, 50)
probe.unref()

app.whenReady().then(createWindow).catch(failLoudly)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
app.on('before-quit', () => {
  shuttingDown = true
})
app.on('will-quit', () => clearInterval(probe))

/** Creates the packaged benchmark renderer and its isolated query worker. */
async function createWindow() {
  queryWorker = new Worker(path.join(__dirname, 'query-worker.mjs'))
  queryWorker.on('message', handleWorkerMessage)
  queryWorker.on('error', failLoudly)
  queryWorker.on('exit', (code) => {
    if (code !== 0 && !shuttingDown) failLoudly(new Error(`Coverage query worker exited ${code}.`))
  })

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    show: true,
    backgroundColor: '#0b1720',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  })
  mainWindow.webContents.on('console-message', (event) => {
    console.log(`coverage-bench:renderer: ${String(event.message ?? '')}`)
  })
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    failLoudly(new Error(`Coverage renderer process exited: ${details.reason}.`))
  })
  await registerIpc()
  await mainWindow.loadFile(path.join(__dirname, 'dist-renderer', 'index.html'))
}

/** Registers the narrow benchmark-only bridge. */
async function registerIpc() {
  ipcMain.handle('coverage-bench:get-config', async () => ({
    candidate: args.candidate,
    fixturePreset: args.fixturePreset,
    repetition: args.repetition,
    thermalState: args.thermalState,
    killProbe: args.killProbe,
    killProofValid: await validateKillProof(args.killProofPath),
    exactDotsContractPassed: await validateDotsProof(args.dotsProofPath),
    pollCycleMs: 5_000,
    benchmarkStartedAtMs: args.benchmarkStartedAtMs,
  }))
  ipcMain.handle('coverage-bench:start', async () => {
    queryWorker.postMessage({
      type: 'start',
      candidate: args.candidate,
      databasePath: args.fixturePath,
      cacheDirectory: path.join(args.runDirectory, 'tile-cache'),
    })
    return true
  })
  ipcMain.handle('coverage-bench:append-late-batch', async () => requestWorker({ type: 'append' }))
  ipcMain.handle('coverage-bench:prime-invalidation', async () => requestWorker({ type: 'prime-invalidation' }))
  ipcMain.handle('coverage-bench:attest-pane', async (_event, bounds) => requestWorker({ type: 'attest-pane', bounds }))
  ipcMain.handle('coverage-bench:read-tile', async (_event, request) => {
    const result = await requestWorker({ type: 'tile', ...request })
    return result === null ? null : Buffer.from(result)
  })
  ipcMain.handle('coverage-bench:read-main-samples', () => [...mainGapSamples])
  ipcMain.handle('coverage-bench:read-memory', () => readRendererMemory())
  ipcMain.handle('coverage-bench:kill-at-first-useful', async (_event, progress) => {
    if (!args.killProbe) return false
    if (!Number.isSafeInteger(progress?.deliveredFixes) || progress.deliveredFixes <= 0) {
      throw new Error('Kill probe requires positive delivered coverage.')
    }
    await fsp.mkdir(path.dirname(args.killCheckpointPath), { recursive: true })
    fs.writeFileSync(args.killCheckpointPath, `${JSON.stringify({
      appSha: args.appSha,
      candidate: args.candidate,
      fixturePreset: args.fixturePreset,
      deliveredFixes: progress.deliveredFixes,
      killedAt: new Date().toISOString(),
    }, null, 2)}\n`)
    process.kill(process.pid, 'SIGKILL')
  })
  ipcMain.handle('coverage-bench:finish', async (_event, rendererResult) => {
    const fixtureManifest = JSON.parse(await fsp.readFile(args.fixtureManifestPath, 'utf8'))
    const gpu = await readGpuDescription()
    const result = {
      schemaVersion: 1,
      appSha: args.appSha,
      candidate: args.candidate,
      fixture: {
        preset: fixtureManifest.preset,
        digest: fixtureManifest.database.sha256,
        generatorVersion: fixtureManifest.generatorVersion,
        positionCount: fixtureManifest.workload.realPositionRows,
      },
      machine: {
        hostname: os.hostname(),
        platform: process.platform,
        arch: process.arch,
        kernel: os.release(),
        cpu: os.cpus()[0]?.model ?? 'unknown cpu',
        gpu,
        sessionType: String(process.env.XDG_SESSION_TYPE || 'unknown').toLowerCase(),
        display: String(process.env.DISPLAY || 'unset'),
      },
      run: {
        repetition: args.repetition,
        thermalState: args.thermalState,
        startedAt: rendererResult.startedAt,
        completedAt: new Date().toISOString(),
        flags: process.argv.filter((value) => value.startsWith('--ozone-platform=')),
      },
      ...rendererResult.measurements,
    }
    await fsp.mkdir(path.dirname(args.outputPath), { recursive: true })
    await fsp.writeFile(args.outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
    setTimeout(() => app.exit(0), 100)
    return true
  })
  ipcMain.handle('coverage-bench:fail', async (_event, message) => {
    console.error(`coverage-bench:renderer failed: ${String(message)}`)
    setTimeout(() => app.exit(1), 100)
    return true
  })
}

/** Forwards streamed worker events and resolves request/reply messages. */
function handleWorkerMessage(message) {
  if (message?.requestId && pendingWorkerRequests.has(message.requestId)) {
    const pending = pendingWorkerRequests.get(message.requestId)
    pendingWorkerRequests.delete(message.requestId)
    if (message.error) pending.reject(new Error(message.error))
    else pending.resolve(message.result ?? null)
    return
  }
  mainWindow?.webContents.send('coverage-bench:worker-event', message)
}

/** Sends one correlated command to the worker. */
function requestWorker(message) {
  const requestId = randomUUID()
  return new Promise((resolve, reject) => {
    pendingWorkerRequests.set(requestId, { resolve, reject })
    queryWorker.postMessage({ ...message, requestId })
  })
}

/** Returns current renderer working-set evidence in bytes. */
function readRendererMemory() {
  const rendererRssBytes = readCurrentRendererRssBytes()
  rendererRssPeakBytes = Math.max(rendererRssPeakBytes, rendererRssBytes)
  return { rendererRssBytes, rendererRssPeakBytes }
}

/** Reads only the benchmark renderer PID, excluding GPU, utility, and worker memory. */
function readCurrentRendererRssBytes() {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return 0
  const rendererPid = mainWindow.webContents.getOSProcessId()
  if (!Number.isSafeInteger(rendererPid) || rendererPid <= 0) return 0
  const metric = app.getAppMetrics().find((candidate) => candidate.pid === rendererPid)
  return (metric?.memory?.workingSetSize ?? 0) * 1024
}

/** Reads a bounded GPU description without leaking unrelated environment state. */
async function readGpuDescription() {
  const info = await app.getGPUInfo('complete').catch(() => ({}))
  return String(
    info?.auxAttributes?.glRenderer ||
    info?.gpuDevice?.[0]?.deviceString ||
    info?.gpuDevice?.[0]?.vendorString ||
    'unreported GPU',
  )
}

/** Confirms that this fresh renderer follows a real prior mid-load kill. */
async function validateKillProof(proofPath) {
  if (!proofPath) return false
  const proof = JSON.parse(await fsp.readFile(proofPath, 'utf8'))
  return proof.appSha === args.appSha &&
    proof.candidate === args.candidate &&
    proof.fixturePreset === args.fixturePreset &&
    Number.isSafeInteger(proof.deliveredFixes) && proof.deliveredFixes > 0
}

/** Confirms the unchanged source-exact Dots contract passed at this app SHA. */
async function validateDotsProof(proofPath) {
  if (!proofPath) return false
  const proof = JSON.parse(await fsp.readFile(proofPath, 'utf8'))
  return proof.appSha === args.appSha && proof.passed === true
}

/** Parses only benchmark-owned arguments and ignores Electron/Chromium flags. */
function parseBenchArguments(argv) {
  const values = {}
  for (const token of argv) {
    if (!token.startsWith('--bench-')) continue
    const separator = token.indexOf('=')
    const key = separator === -1 ? token.slice(8) : token.slice(8, separator)
    values[key] = separator === -1 ? true : token.slice(separator + 1)
  }
  for (const required of ['candidate', 'fixture', 'fixture-preset', 'fixture-manifest', 'app-sha', 'output', 'run-directory']) {
    if (!values[required]) throw new Error(`--bench-${required}=... is required.`)
  }
  if (!['A', 'B', 'C'].includes(values.candidate)) throw new Error('Benchmark candidate must be A, B, or C.')
  const repetition = Number(values.repetition ?? 1)
  if (!Number.isSafeInteger(repetition) || repetition < 1 || repetition > 3) {
    throw new Error('Benchmark repetition must be 1, 2, or 3.')
  }
  return {
    candidate: values.candidate,
    fixturePath: path.resolve(values.fixture),
    fixturePreset: values['fixture-preset'],
    fixtureManifestPath: path.resolve(values['fixture-manifest']),
    appSha: values['app-sha'],
    outputPath: path.resolve(values.output),
    runDirectory: path.resolve(values['run-directory']),
    repetition,
    thermalState: values['thermal-state'] ?? (repetition === 1 ? 'cold' : 'warm'),
    killProbe: values['kill-probe'] === true,
    killCheckpointPath: path.resolve(values['kill-checkpoint'] ?? path.join(values['run-directory'], 'kill-proof.json')),
    killProofPath: values['kill-proof'] ? path.resolve(values['kill-proof']) : null,
    dotsProofPath: values['dots-proof'] ? path.resolve(values['dots-proof']) : null,
    benchmarkStartedAtMs: Number.isFinite(Number(values['spawned-at']))
      ? Number(values['spawned-at'])
      : Date.now() - process.uptime() * 1_000,
  }
}

/** Fails the run loudly and leaves a non-zero process status for the orchestrator. */
function failLoudly(error) {
  console.error(error)
  process.exitCode = 1
  app.quit()
}
