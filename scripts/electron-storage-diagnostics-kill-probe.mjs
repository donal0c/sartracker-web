#!/usr/bin/env node

// Packaged-Electron kill/restart storage diagnostics proof (DON-244).
// Kills the real app only after both the atomic checkpoint and bounded runtime
// log have flushed `validation_started`, then restarts and exports a support bundle.

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import {
  copyFile,
  mkdir,
  readFile,
  stat,
  writeFile,
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { chromium } from 'playwright'

import {
  buildStorageKillProbeVerdict,
  parseStorageKillProbeArgs,
} from '../build/electron-storage-diagnostics-kill-probe-lib.js'
import { createMissionStoreProbeSettings } from '../build/electron-mission-store-freeze-probe-lib.js'
import { sanitizeEvidenceText } from '../build/electron-official-map-offline-smoke-lib.js'

const checkpointFileName = 'storage-diagnostics.json'
const runtimeLogRelativePath = path.join('logs', 'runtime.log')
const supportBundleFileName = 'storage-diagnostics-kill-support-bundle.txt'

main().catch((error) => {
  console.error(`storage-diagnostics-kill-probe: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})

/** Runs the packaged kill/restart/export proof and writes one machine-readable verdict. */
async function main() {
  const options = parseStorageKillProbeArgs(process.argv.slice(2))
  const evidenceDir = path.resolve(options.evidenceDir)
  const userDataDir = path.join(evidenceDir, 'user-data')
  const databasePath = path.join(userDataDir, 'mission-store.sqlite')
  await assertFreshEvidenceDirectory(evidenceDir)
  await mkdir(userDataDir, { recursive: true })

  const fixtureStat = await stat(options.fixturePath)
  if (!fixtureStat.isFile() || fixtureStat.size <= 0) {
    throw new Error(`Fixture is not a non-empty file: ${options.fixturePath}`)
  }
  console.log(`[storage-kill-probe] copying ${(fixtureStat.size / 1024 / 1024 / 1024).toFixed(2)} GiB fixture`)
  await copyFile(options.fixturePath, databasePath)
  await copyFixtureManifestIfPresent(options.fixturePath, databasePath)
  await writeJson(path.join(userDataDir, 'settings.json'), createMissionStoreProbeSettings())

  let firstLaunch
  let secondLaunch
  try {
    firstLaunch = await launchPackagedApp({
      appPath: options.appPath,
      userDataDir,
      extraArgs: options.extraArgs,
    })
    await firstLaunch.page.screenshot({
      path: path.join(evidenceDir, '01-before-kill.png'),
      fullPage: true,
    })

    const beforeKill = await waitForFlushedValidationMarker({
      userDataDir,
      appProcess: firstLaunch.appProcess,
      timeoutMs: options.timeoutMs,
    })
    await writeJson(path.join(evidenceDir, 'checkpoint-before-kill.json'), beforeKill)
    await copyFile(
      path.join(userDataDir, runtimeLogRelativePath),
      path.join(evidenceDir, 'runtime-before-kill.log'),
    )
    console.log('[storage-kill-probe] validation marker flushed; sending SIGKILL')
    firstLaunch.appProcess.kill('SIGKILL')
    await waitForExit(firstLaunch.appProcess, 10_000)
    await firstLaunch.browser.close().catch(() => undefined)
    await writeLaunchLog(path.join(evidenceDir, 'electron-before-kill.log'), firstLaunch.logChunks)
    firstLaunch = undefined

    secondLaunch = await launchPackagedApp({
      appPath: options.appPath,
      userDataDir,
      extraArgs: options.extraArgs,
    })
    const afterRestart = await waitForInterruptedRestartMarker({
      userDataDir,
      appProcess: secondLaunch.appProcess,
      timeoutMs: options.timeoutMs,
    })
    await writeJson(path.join(evidenceDir, 'checkpoint-after-restart.json'), afterRestart)
    console.log(
      `[storage-kill-probe] observing restarted app for ${options.postRestartObservationMs}ms`,
    )
    await waitWhileProcessAlive(
      secondLaunch.appProcess,
      options.postRestartObservationMs,
      'during post-restart observation',
    )
    await secondLaunch.page.screenshot({
      path: path.join(evidenceDir, '02-after-restart.png'),
      fullPage: true,
    })

    const supportBundlePath = await secondLaunch.page.evaluate(
      async ({ fileName }) => {
        const exportBundle = window.sartrackerElectron?.exportSupportBundle
        if (typeof exportBundle !== 'function') {
          throw new Error('Electron support-bundle bridge is unavailable.')
        }
        return exportBundle({
          fileName,
          contents: [
            'SAR Tracker packaged storage diagnostics kill probe',
            'synthetic validation data only',
          ].join('\n'),
        })
      },
      { fileName: supportBundleFileName },
    )
    const supportBundle = await readFile(supportBundlePath, 'utf8')
    const runtimeLog = await readFile(path.join(userDataDir, runtimeLogRelativePath), 'utf8')
    await writeFile(
      path.join(evidenceDir, 'support-bundle-inspected.txt'),
      sanitizeEvidenceText(supportBundle),
      'utf8',
    )
    await writeFile(
      path.join(evidenceDir, 'runtime-after-restart.log'),
      sanitizeEvidenceText(runtimeLog),
      'utf8',
    )
    await writeLaunchLog(
      path.join(evidenceDir, 'electron-after-restart.log'),
      secondLaunch.logChunks,
    )

    const forbiddenValues = [
      'SYNTHETIC FIELD-SCALE VALIDATION MISSION',
      options.fixturePath,
      userDataDir,
      os.homedir(),
    ]
    const verdict = buildStorageKillProbeVerdict({
      beforeKill,
      afterRestart,
      runtimeLog,
      supportBundle,
      forbiddenValues,
    })
    const report = {
      schemaVersion: 1,
      issue: 'DON-244',
      recordedAt: new Date().toISOString(),
      app: {
        basename: path.basename(options.appPath),
        sha256: await sha256File(options.appPath),
      },
      fixture: {
        basename: path.basename(options.fixturePath),
        bytes: fixtureStat.size,
        sha256: await sha256File(options.fixturePath),
      },
      platform: {
        os: `${os.type()} ${os.release()}`,
        architecture: os.arch(),
        node: process.version,
      },
      killedAt: beforeKill.activeOperation,
      recoveredAs: afterRestart.previousInterruptedOperation,
      supportBundleBasename: path.basename(supportBundlePath),
      privacyChecks: forbiddenValues.map((value) => ({
        label: path.basename(value) || 'home',
        absent: !supportBundle.includes(value),
      })),
      verdict,
    }
    await writeJson(path.join(evidenceDir, 'storage-diagnostics-kill-probe-report.json'), report)
    console.log(
      `[storage-kill-probe] passed=${verdict.passed} interrupted=${afterRestart.previousInterruptedOperation?.type}:${afterRestart.previousInterruptedOperation?.stage}`,
    )
    if (!verdict.passed) {
      throw new Error(`Kill/restart probe failed: ${verdict.failures.join(' ')}`)
    }
  } finally {
    await stopLaunch(firstLaunch)
    await stopLaunch(secondLaunch)
  }
}

/** Launches one isolated packaged app and returns its first ready renderer page. */
async function launchPackagedApp(input) {
  const port = await findFreePort()
  const logChunks = []
  const appProcess = spawn(
    input.appPath,
    [`--remote-debugging-port=${port}`, ...input.extraArgs],
    {
      env: {
        ...process.env,
        SARTRACKER_ELECTRON_USER_DATA_PATH: input.userDataDir,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  appProcess.stdout.on('data', (chunk) => logChunks.push(chunk))
  appProcess.stderr.on('data', (chunk) => logChunks.push(chunk))
  try {
    await waitForCdp(port, appProcess)
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
    const context = browser.contexts()[0]
    const page = context.pages()[0] ?? (await context.waitForEvent('page'))
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.getByTestId('app-shell').waitFor({ timeout: 60_000 })
    return { appProcess, browser, page, logChunks }
  } catch (error) {
    appProcess.kill('SIGKILL')
    throw error
  }
}

/** Waits until both durable channels show validation_started. */
async function waitForFlushedValidationMarker(input) {
  const deadline = Date.now() + input.timeoutMs
  while (Date.now() < deadline) {
    assertProcessAlive(input.appProcess, 'before validation marker')
    const checkpoint = await readJsonIfPresent(path.join(input.userDataDir, checkpointFileName))
    const runtimeLog = await readFileIfPresent(path.join(input.userDataDir, runtimeLogRelativePath))
    if (
      checkpoint?.activeOperation?.type === 'backup' &&
      checkpoint.activeOperation.stage === 'validation_started' &&
      runtimeLog.includes('storage_backup_validation_started')
    ) {
      return checkpoint
    }
    await delay(20)
  }
  throw new Error('Timed out waiting for the flushed backup validation_started marker.')
}

/** Waits for startup recovery to convert the active marker into interrupted evidence. */
async function waitForInterruptedRestartMarker(input) {
  const deadline = Date.now() + input.timeoutMs
  while (Date.now() < deadline) {
    assertProcessAlive(input.appProcess, 'after restart')
    const checkpoint = await readJsonIfPresent(path.join(input.userDataDir, checkpointFileName))
    const runtimeLog = await readFileIfPresent(path.join(input.userDataDir, runtimeLogRelativePath))
    if (
      checkpoint?.activeOperation === null &&
      checkpoint?.previousInterruptedOperation?.type === 'backup' &&
      checkpoint.previousInterruptedOperation.stage === 'validation_started' &&
      runtimeLog.includes('storage_previous_run_interrupted')
    ) {
      return checkpoint
    }
    await delay(20)
  }
  throw new Error('Timed out waiting for restart interruption evidence.')
}

async function stopLaunch(launch) {
  if (launch === undefined) return
  await launch.browser?.close().catch(() => undefined)
  if (launch.appProcess.exitCode === null) {
    launch.appProcess.kill('SIGTERM')
    await waitForExit(launch.appProcess, 5_000)
  }
}

async function assertFreshEvidenceDirectory(evidenceDir) {
  const existing = await stat(evidenceDir).catch((error) => {
    if (error?.code === 'ENOENT') return null
    throw error
  })
  if (existing !== null) {
    throw new Error(`Evidence directory already exists; choose a fresh path: ${evidenceDir}`)
  }
}

async function copyFixtureManifestIfPresent(sourcePath, targetPath) {
  await copyFile(`${sourcePath}.manifest.json`, `${targetPath}.manifest.json`).catch((error) => {
    if (error?.code !== 'ENOENT') throw error
  })
}

async function waitForCdp(port, appProcess) {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    assertProcessAlive(appProcess, 'before CDP became available')
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`)
      if (response.ok) return
    } catch {
      // Keep polling while packaged Electron starts.
    }
    await delay(250)
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

function assertProcessAlive(appProcess, context) {
  if (appProcess.exitCode !== null) {
    throw new Error(`Electron exited ${context} with code ${appProcess.exitCode}.`)
  }
}

async function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null) return
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    delay(timeoutMs),
  ])
}

async function waitWhileProcessAlive(appProcess, durationMs, context) {
  const deadline = Date.now() + durationMs
  while (Date.now() < deadline) {
    assertProcessAlive(appProcess, context)
    await delay(Math.min(250, deadline - Date.now()))
  }
}

async function readJsonIfPresent(filePath) {
  const contents = await readFileIfPresent(filePath)
  if (contents === '') return null
  try {
    return JSON.parse(contents)
  } catch {
    return null
  }
}

async function readFileIfPresent(filePath) {
  return readFile(filePath, 'utf8').catch((error) => {
    if (error?.code === 'ENOENT') return ''
    throw error
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

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

async function writeLaunchLog(filePath, chunks) {
  await writeFile(
    filePath,
    sanitizeEvidenceText(Buffer.concat(chunks).toString('utf8')),
    'utf8',
  )
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}
