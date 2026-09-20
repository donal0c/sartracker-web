#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { lstat, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { _electron as electron } from 'playwright'

import { validateIpcContainmentReceipt, IPC_PROBE_DESCRIPTOR, IPC_PROBE_PROOF_MODE } from './ipc-receipts.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const SHA1 = /^[a-f0-9]{40}$/u
const MAX_ERROR_LENGTH = 500
const APP_CLOSE_TIMEOUT_MS = 15_000

/**
 * Parse the exact packaged C23 command-line contract.
 *
 * @param {string[]} argv command-line arguments excluding node and script
 * @returns {object} immutable probe options
 */
export function parseIpcProbeArgs(argv) {
  if (!Array.isArray(argv)) throw new Error('C23 probe arguments must be an array.')
  let appPath
  let evidenceDir
  let expectedHead
  const extraArgs = []
  let passthrough = false
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (passthrough) {
      extraArgs.push(argument)
      continue
    }
    if (argument === '--') {
      passthrough = true
      continue
    }
    if (argument === '--app') {
      if (appPath !== undefined) throw new Error('C23 probe received duplicate --app.')
      appPath = readArgument(argv, ++index, '--app')
      continue
    }
    if (argument === '--evidence') {
      if (evidenceDir !== undefined) throw new Error('C23 probe received duplicate --evidence.')
      evidenceDir = readArgument(argv, ++index, '--evidence')
      continue
    }
    if (argument === '--expected-head') {
      if (expectedHead !== undefined) throw new Error('C23 probe received duplicate --expected-head.')
      expectedHead = readArgument(argv, ++index, '--expected-head')
      continue
    }
    if (argument === '--app-arg') {
      const value = readArgument(argv, ++index, '--app-arg', false)
      if (value.length === 0) throw new Error('C23 probe --app-arg must not be empty.')
      extraArgs.push(value)
      continue
    }
    throw new Error(`C23 probe received unknown argument: ${argument}`)
  }
  if (!isAbsolutePath(appPath)) throw new Error('C23 probe requires an absolute --app path.')
  if (!isAbsolutePath(evidenceDir)) throw new Error('C23 probe requires an absolute --evidence directory.')
  if (typeof expectedHead !== 'string' || !SHA1.test(expectedHead)) throw new Error('C23 probe requires a 40-character lowercase --expected-head SHA-1.')
  return Object.freeze({
    appPath,
    evidenceDir,
    expectedHead,
    extraArgs: Object.freeze([...extraArgs]),
  })
}

/**
 * Launch the exact supplied package and retain a bounded C23 containment report.
 *
 * @param {object} options parsed probe options
 * @returns {Promise<object>} raw report and independently recomputed receipt
 */
export async function runIpcContainmentProbe(options) {
  validateOptions(options)
  const evidenceDir = path.resolve(options.evidenceDir)
  await assertFreshEvidenceDirectory(evidenceDir)
  const source = readSourceIdentity(options.expectedHead)
  const executableSha256 = await hashFile(options.appPath)
  const profile = await mkdtemp(path.join(evidenceDir, '.profile-'))
  const report = {
    schema: IPC_PROBE_DESCRIPTOR.schema,
    contractId: 'C23',
    proofMode: IPC_PROBE_PROOF_MODE,
    source,
    app: {
      suppliedPath: options.appPath,
      executableSha256,
      isPackaged: false,
      appPath: null,
    },
    runtime: null,
    probes: {
      invalidSender: { attempted: false, blocked: false, error: null },
      invalidPayload: { attempted: false, blocked: false, error: null },
      capability: { safeReadAvailable: false, safeReadCompleted: false, unknownCapabilityAbsent: false },
    },
    custody: {
      operationalDataUsed: false,
      rawPayloadRetained: false,
      networkContactAttempted: false,
    },
    cleanup: { appClosed: false, profileRemoved: false },
  }
  let app
  let closeError = null
  try {
    app = await electron.launch({
      executablePath: options.appPath,
      args: options.extraArgs,
      env: {
        ...process.env,
        SARTRACKER_ELECTRON_USER_DATA_PATH: profile,
        SARTRACKER_ELECTRON_BLOCK_NETWORK: '1',
      },
      timeout: 30_000,
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded', { timeout: 30_000 }).catch(() => undefined)
    const packageIdentity = await app.evaluate(({ app: runningApp }) => ({
      isPackaged: runningApp.isPackaged,
      appPath: runningApp.getAppPath(),
    }))
    report.app.isPackaged = packageIdentity.isPackaged
    report.app.appPath = packageIdentity.appPath
    report.runtime = await observeRuntime(app, page)
    report.probes.capability = await exerciseCapabilities(page)
    report.probes.invalidPayload = await exerciseInvalidPayload(page)
    report.probes.invalidSender = await exerciseInvalidSender(app)
  } catch (error) {
    report.failure = sanitizeError(error)
  } finally {
    if (app) {
      try {
        await closeOwnedApp(app)
        report.cleanup.appClosed = true
      } catch (error) {
        closeError = sanitizeError(error)
        report.failure = report.failure ?? closeError
      }
    }
    try {
      await rm(profile, { recursive: true, force: true })
      report.cleanup.profileRemoved = true
    } catch (error) {
      closeError = closeError ?? sanitizeError(error)
      report.failure = report.failure ?? closeError
    }
  }
  if (closeError !== null) report.cleanup.error = closeError
  const expected = {
    proofMode: IPC_PROBE_PROOF_MODE,
    source: { expectedHead: options.expectedHead },
    app: { suppliedPath: options.appPath, executableSha256: report.app.executableSha256 },
  }
  const validation = validateIpcContainmentReceipt(report, expected)
  report.result = validation.status
  report.recomputedPredicates = validation.recomputedPredicates
  report.failureReasons = validation.failureReasons
  await writeFile(path.join(evidenceDir, 'receipt.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  return Object.freeze({ report: Object.freeze(report), validation })
}

/** Validate parsed options before creating any profile or process. */
function validateOptions(options) {
  if (!options || !isAbsolutePath(options.appPath) || !isAbsolutePath(options.evidenceDir)
      || typeof options.expectedHead !== 'string' || !SHA1.test(options.expectedHead)
      || !Array.isArray(options.extraArgs)) {
    throw new Error('C23 probe options are invalid.')
  }
}

/** Return source HEAD and worktree identity without claiming package proof. */
function readSourceIdentity(expectedHead) {
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
  const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim() !== ''
  return { head, expectedHead, dirty }
}

/** Observe hardened webPreferences from Electron main and direct Node absence in the renderer. */
async function observeRuntime(app, page) {
  const webPreferences = await app.evaluate(({ webContents }) => {
    const contents = webContents.getAllWebContents().find((candidate) => candidate.getType() === 'window')
    const preferences = contents?.getLastWebPreferences?.() ?? {}
    return {
      contextIsolation: preferences.contextIsolation === true,
      nodeIntegration: preferences.nodeIntegration === true,
      sandbox: preferences.sandbox === true,
    }
  })
  const renderer = await page.evaluate(() => ({
    protocol: location.protocol,
    bridgeAvailable: typeof window.sartrackerElectron === 'object' && window.sartrackerElectron !== null,
    directNodeGlobalsAbsent: typeof globalThis.process === 'undefined'
      && typeof globalThis.require === 'undefined'
      && typeof globalThis.module === 'undefined',
    rawIpcCapabilityAbsent: typeof globalThis.require === 'undefined'
      && typeof globalThis.process === 'undefined'
      && typeof globalThis.__electron_ipc__ === 'undefined',
  }))
  return { webPreferences, renderer }
}

/** Exercise one read-only bridge capability without retaining its contents. */
async function exerciseCapabilities(page) {
  return page.evaluate(async () => {
    const bridge = window.sartrackerElectron
    if (typeof bridge?.readTrackingCache !== 'function') {
      return { safeReadAvailable: false, safeReadCompleted: false, unknownCapabilityAbsent: typeof bridge?.rawIpc === 'undefined' }
    }
    try {
      const value = await bridge.readTrackingCache()
      void value
      return {
        safeReadAvailable: true,
        safeReadCompleted: true,
        unknownCapabilityAbsent: typeof bridge.rawIpc === 'undefined' && typeof bridge.invokeRaw === 'undefined',
      }
    } catch {
      return {
        safeReadAvailable: true,
        safeReadCompleted: false,
        unknownCapabilityAbsent: typeof bridge.rawIpc === 'undefined' && typeof bridge.invokeRaw === 'undefined',
      }
    }
  })
}

/** Exercise a known invalid payload that is rejected before any file write. */
async function exerciseInvalidPayload(page) {
  return page.evaluate(async () => {
    try {
      await window.sartrackerElectron?.writeTrackingCache(null)
      return { attempted: true, blocked: false, error: null }
    } catch (error) {
      return { attempted: true, blocked: true, error: error instanceof Error ? error.message : String(error) }
    }
  })
}

/** Exercise the main sender guard from an owned data-URL renderer. */
async function exerciseInvalidSender(app) {
  return app.evaluate(async ({ BrowserWindow, app: runningApp }) => {
    const child = new BrowserWindow({
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        preload: require('node:path').join(runningApp.getAppPath(), 'electron', 'preload.cjs'),
      },
    })
    try {
      await child.loadURL('data:text/html,<html><body>C23</body></html>')
      return await child.webContents.executeJavaScript(`(async () => {
        try {
          await window.sartrackerElectron.readTrackingCache()
          return { attempted: true, blocked: false, error: null }
        } catch (error) {
          return { attempted: true, blocked: true, error: error instanceof Error ? error.message : String(error) }
        }
      })()`)
    } finally {
      child.destroy()
    }
  })
}

/** Close only the Electron process owned by this probe within a bounded window. */
async function closeOwnedApp(app) {
  const processHandle = app.process()
  let timer
  try {
    await Promise.race([
      app.close(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Owned Electron app did not close within the bounded timeout.')), APP_CLOSE_TIMEOUT_MS)
      }),
    ])
  } catch (error) {
    if (processHandle && !processHandle.killed) processHandle.kill('SIGTERM')
    throw error
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/** Reject an evidence path that already contains retained files or is a symlink. */
async function assertFreshEvidenceDirectory(directory) {
  try {
    const entry = await lstat(directory)
    if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error('C23 evidence directory must be a real directory.')
    if ((await readdir(directory)).length > 0) throw new Error('C23 evidence directory must be empty.')
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
    await mkdir(directory, { recursive: true, mode: 0o700 })
  }
}

/** Hash the exact supplied package executable without interpreting its bytes. */
async function hashFile(filePath) {
  const entry = await lstat(filePath)
  if (!entry.isFile() || entry.isSymbolicLink()) throw new Error('C23 --app must be a regular executable file.')
  const digest = createHash('sha256')
  for await (const chunk of createReadStream(filePath)) digest.update(chunk)
  return digest.digest('hex')
}

/** Read one required argument value. */
function readArgument(argv, index, name, rejectSwitch = true) {
  const value = argv[index]
  if (typeof value !== 'string' || value.length === 0 || (rejectSwitch && value.startsWith('--'))) throw new Error(`${name} requires a value.`)
  return value
}

/** Return whether a path is absolute on POSIX or Windows. */
function isAbsolutePath(value) {
  return typeof value === 'string' && /^(?:\/|[A-Za-z]:[\\/])/u.test(value)
}

/** Sanitize one probe error into bounded non-operational text. */
function sanitizeError(error) {
  return String(error instanceof Error ? error.message : error).replace(/\s+/gu, ' ').slice(0, MAX_ERROR_LENGTH)
}

/** Run the CLI only when this module is the direct script entry point. */
async function main() {
  const options = parseIpcProbeArgs(process.argv.slice(2))
  const outcome = await runIpcContainmentProbe(options)
  console.log(JSON.stringify({ result: outcome.validation.status, receipt: path.join(options.evidenceDir, 'receipt.json') }))
  if (!outcome.validation.valid) process.exitCode = 1
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`C23 IPC containment probe: ${sanitizeError(error)}`)
    process.exitCode = 1
  })
}
