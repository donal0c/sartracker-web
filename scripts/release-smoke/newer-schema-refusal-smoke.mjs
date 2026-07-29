import { execFile as execFileCallback, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import net from 'node:net'
import path from 'node:path'
import { promisify } from 'node:util'

import {
  countDescendantElectronRenderers,
  fileSnapshotsMatch,
} from '../../build/release-smoke-lib.js'

const execFile = promisify(execFileCallback)
const appPath = requiredEnvironment('SMOKE_APP')
const evidenceDir = requiredEnvironment('SMOKE_EVIDENCE')
const userDataDir = requiredEnvironment('SMOKE_USER_DATA')
const expectedAppSha256 = requiredEnvironment('SMOKE_EXPECTED_APP_SHA256')

await mkdir(evidenceDir, { recursive: true })
await assertFileSha256(appPath, expectedAppSha256)
const filesBefore = await snapshotMissionStoreFiles(userDataDir)
const port = await findFreePort()
const expectedMessage =
  'Cannot open mission store created by newer mission store schema 6; this build supports schema 5.'
const dialogOperatorTitle = 'SAR Tracker could not start'
// Electron's Linux GTK implementation presents showErrorBox windows with the
// native WM title "Error"; the app-owned operator title is asserted by unit
// tests at the showErrorBox call boundary.
const dialogWindowName = '^Error$'
const appProcess = spawn(
  appPath,
  [
    `--remote-debugging-port=${port}`,
    '--no-sandbox',
    '--ignore-gpu-blocklist',
    '--ozone-platform=x11',
    '--password-store=basic',
  ],
  {
    env: {
      ...process.env,
      SARTRACKER_ELECTRON_BLOCK_NETWORK: '1',
      SARTRACKER_ELECTRON_USER_DATA_PATH: userDataDir,
    },
    stdio: 'ignore',
  },
)
const rendererMonitor = startRendererProcessMonitor(appProcess.pid)

let dialogWindowId = null
let processExit = null
let rendererCdpSnapshot = { available: false, pageCount: null }
try {
  dialogWindowId = await waitForDialogWindow(
    appProcess,
    dialogWindowName,
    20_000,
  )
  rendererCdpSnapshot = await inspectRendererPages(port)
  await execFile(
    'xdotool',
    ['key', '--window', dialogWindowId, 'Return'],
    { env: process.env },
  )
  processExit = await waitForProcessExit(appProcess, 10_000)
} finally {
  if (appProcess.exitCode === null) {
    appProcess.kill('SIGTERM')
    await waitForProcessExit(appProcess, 2_000).catch(() => undefined)
  }
  if (appProcess.exitCode === null) {
    appProcess.kill('SIGKILL')
    await waitForProcessExit(appProcess, 2_000).catch(() => undefined)
  }
}
const rendererProcessEvidence = await rendererMonitor.stop()

const filesAfter = await snapshotMissionStoreFiles(userDataDir)
const filesUnchanged = fileSnapshotsMatch(filesBefore, filesAfter)
const crashEntries = await readJsonArray(path.join(userDataDir, 'crashes', 'crash-log.json'))
const runtimeLog = await readFile(path.join(userDataDir, 'logs', 'runtime.log'), 'utf8')
const expectedMessagePresent = crashEntries.some(
  (entry) =>
    entry?.kind === 'startupFailure' &&
    typeof entry?.summary === 'string' &&
    entry.summary.includes(expectedMessage),
)
const runtimeStartupFailureRecorded = runtimeLog
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line))
  .some((entry) => entry.event === 'startup_failure')
const unhandledRejectionAbsent = !runtimeLog.includes('"event":"unhandled_rejection"')
const result = {
  result:
    dialogWindowId !== null &&
    processExit?.code === 1 &&
    rendererProcessEvidence.scanError === null &&
    rendererProcessEvidence.scanCount > 0 &&
    rendererProcessEvidence.maximum === 0 &&
    (rendererCdpSnapshot.pageCount === null ||
      rendererCdpSnapshot.pageCount === 0) &&
    expectedMessagePresent &&
    runtimeStartupFailureRecorded &&
    unhandledRejectionAbsent &&
    filesUnchanged
      ? 'pass'
      : 'fail',
  appSha256: expectedAppSha256,
  dialogOperatorTitle,
  dialogWindowName,
  dialogWindowId,
  processExitCode: processExit?.code ?? appProcess.exitCode,
  processExitSignal: processExit?.signal ?? appProcess.signalCode,
  rendererCdpAvailableAtDialog: rendererCdpSnapshot.available,
  rendererPageCountAtDialog: rendererCdpSnapshot.pageCount,
  rendererProcessScanCount: rendererProcessEvidence.scanCount,
  rendererProcessMaximum: rendererProcessEvidence.maximum,
  rendererProcessScanError: rendererProcessEvidence.scanError,
  expectedMessagePresent,
  runtimeStartupFailureRecorded,
  unhandledRejectionAbsent,
  filesUnchanged,
  filesBefore,
  filesAfter,
}
await writeFile(
  path.join(evidenceDir, 'summary.json'),
  `${JSON.stringify(result, null, 2)}\n`,
  'utf8',
)
if (result.result !== 'pass') {
  throw new Error(`Newer-schema refusal gate failed: ${JSON.stringify(result)}`)
}

/**
 * Reads one mandatory smoke environment variable.
 */
function requiredEnvironment(name) {
  const value = process.env[name]
  if (value === undefined || value.trim() === '') {
    throw new Error(`${name} is required.`)
  }
  return value
}

/**
 * Verifies that the executable under smoke is exactly the expected artifact.
 */
async function assertFileSha256(filePath, expectedSha256) {
  const actual = createHash('sha256').update(await readFile(filePath)).digest('hex')
  if (actual !== expectedSha256.toLowerCase()) {
    throw new Error(
      `Smoke executable SHA-256 is ${actual}; expected ${expectedSha256}.`,
    )
  }
}

/**
 * Captures the full mission-store database, backup, and SQLite sidecar set.
 */
async function snapshotMissionStoreFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const names = entries
    .filter((entry) => entry.isFile() && entry.name.startsWith('mission-store'))
    .map((entry) => entry.name)
    .sort()
  const snapshot = {}
  for (const name of names) {
    const bytes = await readFile(path.join(directory, name))
    snapshot[name] = {
      bytes: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    }
  }
  if (!Object.hasOwn(snapshot, 'mission-store.sqlite')) {
    throw new Error('Newer-schema refusal profile has no mission-store.sqlite.')
  }
  return snapshot
}

/**
 * Reads one JSON array, failing closed on malformed startup-fault evidence.
 */
async function readJsonArray(filePath) {
  const parsed = JSON.parse(await readFile(filePath, 'utf8'))
  if (!Array.isArray(parsed)) {
    throw new Error(`Expected a JSON array in ${path.basename(filePath)}.`)
  }
  return parsed
}

/**
 * Finds the native fail-closed startup dialog without depending on a renderer.
 */
async function waitForDialogWindow(appProcess, windowName, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (appProcess.exitCode !== null) {
      throw new Error(
        `Electron exited before the startup-refusal dialog appeared: ${appProcess.exitCode}.`,
      )
    }
    try {
      const { stdout } = await execFile(
        'xdotool',
        ['search', '--onlyvisible', '--name', windowName],
        { env: process.env },
      )
      const windowIds = stdout.trim().split(/\s+/u)
      for (const windowId of windowIds) {
        if (
          /^\d+$/u.test(windowId) &&
          (await isSarTrackerErrorDialog(windowId))
        ) {
          return windowId
        }
      }
    } catch {
      // The dialog is created asynchronously; retry until the bounded deadline.
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(
    `Timed out waiting for the ${dialogOperatorTitle} startup-refusal dialog.`,
  )
}

/**
 * Rejects unrelated desktop error windows by checking the packaged app class
 * and the minimum native-dialog dimensions.
 */
async function isSarTrackerErrorDialog(windowId) {
  try {
    const [{ stdout: windowClass }, { stdout: geometry }] = await Promise.all([
      execFile('xprop', ['-id', windowId, 'WM_CLASS'], {
        env: process.env,
      }),
      execFile('xdotool', ['getwindowgeometry', '--shell', windowId], {
        env: process.env,
      }),
    ])
    const width = Number(/^WIDTH=(\d+)$/mu.exec(geometry)?.[1])
    const height = Number(/^HEIGHT=(\d+)$/mu.exec(geometry)?.[1])
    return (
      /"sartracker-web",\s*"Sartracker-web"/u.test(windowClass) &&
      width >= 300 &&
      height >= 100
    )
  } catch {
    return false
  }
}

/**
 * Counts renderer pages exposed by CDP; a safe startup refusal creates none.
 */
async function inspectRendererPages(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
      signal: AbortSignal.timeout(2_000),
    })
    if (!response.ok) {
      return { available: false, pageCount: null }
    }
    const targets = await response.json()
    if (!Array.isArray(targets)) {
      return { available: false, pageCount: null }
    }
    return {
      available: true,
      pageCount: targets.filter((target) => target?.type === 'page').length,
    }
  } catch {
    return { available: false, pageCount: null }
  }
}

/**
 * Samples the complete Linux descendant tree throughout startup so a renderer
 * cannot be hidden by an unavailable CDP endpoint.
 */
function startRendererProcessMonitor(rootPid) {
  let stopped = false
  let maximum = 0
  let scanCount = 0
  let scanError = null
  const completion = (async () => {
    while (!stopped) {
      try {
        const processes = await readLinuxProcessTable()
        maximum = Math.max(
          maximum,
          countDescendantElectronRenderers(processes, rootPid),
        )
        scanCount += 1
      } catch (error) {
        scanError = error instanceof Error ? error.message : String(error)
        stopped = true
      }
      if (!stopped) {
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
    }
  })()

  return {
    async stop() {
      stopped = true
      await completion
      return { maximum, scanCount, scanError }
    },
  }
}

/**
 * Reads the live Linux process table without depending on pgrep or shell
 * parsing. Per-process races are ignored; failure to read /proc itself fails
 * the release gate through the monitor evidence.
 */
async function readLinuxProcessTable() {
  const procEntries = await readdir('/proc', { withFileTypes: true })
  const processes = await Promise.all(
    procEntries
      .filter((entry) => entry.isDirectory() && /^\d+$/u.test(entry.name))
      .map(async (entry) => {
        const pid = Number(entry.name)
        try {
          const [stat, commandLine] = await Promise.all([
            readFile(path.join('/proc', entry.name, 'stat'), 'utf8'),
            readFile(path.join('/proc', entry.name, 'cmdline'), 'utf8'),
          ])
          const commandEnd = stat.lastIndexOf(') ')
          if (commandEnd === -1) {
            return null
          }
          const fields = stat.slice(commandEnd + 2).trim().split(/\s+/u)
          const parentPid = Number(fields[1])
          if (!Number.isInteger(parentPid)) {
            return null
          }
          return {
            pid,
            parentPid,
            command: commandLine.replaceAll('\u0000', ' ').trim(),
          }
        } catch {
          return null
        }
      }),
  )
  return processes.filter((process) => process !== null)
}

/**
 * Waits for one process exit without leaving an unbounded listener behind.
 */
async function waitForProcessExit(appProcess, timeoutMs) {
  if (appProcess.exitCode !== null || appProcess.signalCode !== null) {
    return { code: appProcess.exitCode, signal: appProcess.signalCode }
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      appProcess.removeListener('exit', onExit)
      reject(new Error(`Electron did not exit within ${timeoutMs} ms.`))
    }, timeoutMs)
    const onExit = (code, signal) => {
      clearTimeout(timer)
      resolve({ code, signal })
    }
    appProcess.once('exit', onExit)
  })
}

/**
 * Allocates an isolated local CDP port.
 */
async function findFreePort() {
  const server = net.createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  await new Promise((resolve) => server.close(resolve))
  if (typeof address !== 'object' || address === null) {
    throw new Error('Could not allocate a CDP port.')
  }
  return address.port
}
