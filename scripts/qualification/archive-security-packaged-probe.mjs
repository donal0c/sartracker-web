#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { _electron as electron } from 'playwright'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import { CASE_IDS } from './archive-security-probe.cjs'
import { validateArchiveSecurityReceipt } from './archive-security-receipts.mjs'

const SHA1 = /^[a-f0-9]{40}$/u
const SHA256 = /^[a-f0-9]{64}$/u
const APP_CLOSE_TIMEOUT_MS = 20_000
const REPORT_FILE = 'archive-security-report.json'
const RECEIPT_FILE = 'archive-security-receipt.json'
const SCREENSHOT_FILE = 'archive-security-runtime.png'

/** Parse the exact packaged C21 wrapper invocation. */
export function parseArchiveSecurityPackagedArgs(argv) {
  if (!Array.isArray(argv)) throw new Error('Packaged C21 arguments must be an array.')
  let app
  let evidence
  let expectedHead
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (!['--app', '--evidence', '--expected-head'].includes(argument)) {
      throw new Error(`Packaged C21 received unknown argument: ${String(argument)}.`)
    }
    const value = argv[++index]
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(`Packaged C21 argument ${argument} requires a value.`)
    }
    if (argument === '--app') {
      if (app !== undefined) throw new Error('Packaged C21 received duplicate --app.')
      app = value
    } else if (argument === '--evidence') {
      if (evidence !== undefined) throw new Error('Packaged C21 received duplicate --evidence.')
      evidence = value
    } else {
      if (expectedHead !== undefined) throw new Error('Packaged C21 received duplicate --expected-head.')
      expectedHead = value
    }
  }
  if (!isAbsolute(app) || !isAbsolute(evidence)) {
    throw new Error('Packaged C21 requires absolute --app and --evidence paths.')
  }
  if (!SHA1.test(expectedHead ?? '')) {
    throw new Error('Packaged C21 requires a 40-character lowercase --expected-head SHA-1.')
  }
  return Object.freeze({ appPath: path.resolve(app), evidenceDir: path.resolve(evidence), expectedHead })
}

/** Launch the exact supplied executable and retain a package-bound C21 receipt. */
export async function runPackagedArchiveSecurityProbe(options) {
  validateOptions(options)
  await createFreshEvidenceDirectory(options.evidenceDir)
  const profile = await mkdtemp(path.join(options.evidenceDir, '.profile-'))
  let app = null
  let runtimeIdentity = null
  let report = null
  let validation = null
  let screenshotPath = path.join(options.evidenceDir, SCREENSHOT_FILE)
  let closeError = null
  try {
    app = await electron.launch({
      executablePath: options.appPath,
      args: ['--ignore-gpu-blocklist'],
      env: {
        ...process.env,
        SARTRACKER_ELECTRON_BLOCK_NETWORK: '1',
        SARTRACKER_ELECTRON_USER_DATA_PATH: profile,
      },
      timeout: 30_000,
    })
    runtimeIdentity = await readPackagedRuntimeIdentity(app, options.appPath)
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded', { timeout: 30_000 }).catch(() => undefined)
    await page.screenshot({ path: screenshotPath, fullPage: true })
    report = await app.evaluate(async ({ app: runningApp }, input) => {
      const probe = require(input.controllerProbePath)
      return probe.runArchiveSecurityProbe({
        moduleRoot: runningApp.getAppPath(),
        tier: 'packaged-module',
        sourceSha: input.sourceSha,
      })
    }, { controllerProbePath: controllerProbePath(), sourceSha: options.expectedHead })
    const reportPath = path.join(options.evidenceDir, REPORT_FILE)
    await writeJson(reportPath, report)
    const rawReportSha256 = sha256(await readFile(reportPath))
    const screenshotSha256 = await hashFile(screenshotPath)
    await closeElectronApp(app)
    app = null
    const expected = {
      proofMode: 'packaged-module',
      sourceSha: options.expectedHead,
      corpusId: report.corpus?.id,
      caseIds: CASE_IDS,
      runtime: runtimeIdentity,
    }
    validation = validateArchiveSecurityReceipt(report, expected)
    const receipt = buildReceipt({
      report,
      validation,
      runtimeIdentity,
      expectedHead: options.expectedHead,
      reportPath,
      screenshotPath,
      profile,
      closeError: null,
      rawReportSha256,
      screenshotSha256,
    })
    await writeJson(path.join(options.evidenceDir, RECEIPT_FILE), receipt)
    return receipt
  } catch (error) {
    const failure = buildFailureReceipt({
      error,
      runtimeIdentity,
      expectedHead: options.expectedHead,
      reportPath: path.join(options.evidenceDir, REPORT_FILE),
      screenshotPath,
      profile,
    })
    await writeJson(path.join(options.evidenceDir, RECEIPT_FILE), failure)
    return failure
  } finally {
    if (app !== null) {
      try {
        await closeElectronApp(app)
      } catch (error) {
        closeError = error instanceof Error ? error.message : String(error)
      }
    }
    await rm(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 })
  }
}

/** Validate the wrapper receipt from independently retained files. */
export async function validateRetainedPackagedArchiveSecurityReceipt(receipt, evidenceDir) {
  const failures = []
  if (!isRecord(receipt) || receipt.schema !== 'c21-packaged-archive-security-v1') {
    failures.push('Packaged C21 wrapper receipt schema is invalid.')
    return Object.freeze({ valid: false, passed: false, failureReasons: Object.freeze(failures) })
  }
  if (receipt.contractId !== 'C21' || receipt.proofMode !== 'packaged-module'
      || receipt.reportPath !== REPORT_FILE || receipt.screenshotPath !== SCREENSHOT_FILE
      || receipt.profileDisposable !== true || receipt.releaseEligible !== false
      || !SHA1.test(receipt.sourceSha ?? '') || !SHA256.test(receipt.rawReportSha256 ?? '')
      || !SHA256.test(receipt.screenshotSha256 ?? '')) {
    failures.push('Packaged C21 wrapper identity or cleanup binding is invalid.')
  }
  const reportPath = path.join(evidenceDir, REPORT_FILE)
  try {
    const reportBytes = await readFile(reportPath)
    if (sha256(reportBytes) !== receipt.rawReportSha256) failures.push('Retained C21 report digest differs from its wrapper receipt.')
    const report = JSON.parse(reportBytes.toString('utf8'))
    const validation = validateArchiveSecurityReceipt(report, {
      proofMode: 'packaged-module',
      sourceSha: receipt.sourceSha,
      corpusId: report.corpus?.id,
      caseIds: CASE_IDS,
      runtime: receipt.runtime,
    })
    failures.push(...validation.failureReasons)
    if (validation.passed !== true) failures.push('Retained C21 report did not pass independent receipt validation.')
    const screenshotBytes = await readFile(path.join(evidenceDir, SCREENSHOT_FILE))
    if (sha256(screenshotBytes) !== receipt.screenshotSha256) failures.push('Retained C21 screenshot digest differs from its wrapper receipt.')
  } catch (error) {
    failures.push(`Retained C21 evidence could not be re-read: ${error instanceof Error ? error.message : 'unknown error'}.`)
  }
  return Object.freeze({
    ...receipt,
    valid: failures.length === 0,
    passed: failures.length === 0,
    status: failures.length === 0 ? 'PASS_WITH_GAPS' : 'INVALID_EVIDENCE',
    releaseEligible: false,
    failureReasons: Object.freeze([...new Set(failures)]),
  })
}

/** Build a closed package receipt from raw report and independently measured runtime identity. */
function buildReceipt({ report, validation, runtimeIdentity, expectedHead, reportPath, screenshotPath, profile, closeError, rawReportSha256, screenshotSha256 }) {
  return Object.freeze({
    schema: 'c21-packaged-archive-security-v1',
    contractId: 'C21',
    proofMode: 'packaged-module',
    sourceSha: expectedHead,
    runtime: runtimeIdentity,
    reportPath: path.basename(reportPath),
    screenshotPath: path.basename(screenshotPath),
    rawReportSha256,
    screenshotSha256,
    validation,
    profileDisposable: profile.startsWith(path.dirname(reportPath)),
    closeError: closeError ?? null,
    status: validation?.valid === true ? 'PASS_WITH_GAPS' : 'INVALID_EVIDENCE',
    valid: validation?.valid === true,
    passed: validation?.passed === true,
    releaseEligible: false,
  })
}

/** Build an explicit failure receipt without converting a launch failure into a pass. */
function buildFailureReceipt({ error, runtimeIdentity, expectedHead, reportPath, screenshotPath, profile }) {
  return Object.freeze({
    schema: 'c21-packaged-archive-security-v1',
    contractId: 'C21',
    proofMode: 'packaged-module',
    sourceSha: expectedHead,
    runtime: runtimeIdentity,
    reportPath: path.basename(reportPath),
    screenshotPath: path.basename(screenshotPath),
    rawReportSha256: null,
    screenshotSha256: null,
    validation: null,
    profileDisposable: profile.startsWith(path.dirname(reportPath)),
    closeError: null,
    releaseEligible: false,
    status: 'INVALID_EVIDENCE',
    valid: false,
    passed: false,
    failureReasons: Object.freeze([error instanceof Error ? error.message : String(error)]),
  })
}

/** Read and independently hash the actual Electron ASAR and executable identities. */
async function readPackagedRuntimeIdentity(app, suppliedExecutablePath) {
  const observed = await app.evaluate(({ app: runningApp }) => ({
    appPath: runningApp.getAppPath(),
    isPackaged: runningApp.isPackaged,
    executablePath: process.execPath,
  }))
  if (observed.isPackaged !== true || !observed.appPath.endsWith('.asar') || !isAbsolute(observed.appPath)) {
    throw new Error('Packaged C21 requires an Electron ASAR runtime.')
  }
  const identity = {
    tier: 'packaged-module',
    sourceRoot: null,
    appAsarPath: path.resolve(observed.appPath),
    appAsarSha256: await hashFile(observed.appPath),
    executablePath: path.resolve(observed.executablePath),
    executableSha256: await hashFile(observed.executablePath),
  }
  const suppliedSha = await hashFile(suppliedExecutablePath)
  if (identity.executablePath !== path.resolve(suppliedExecutablePath)
      || identity.executableSha256 !== suppliedSha) {
    throw new Error('Packaged C21 executable identity differs from the supplied launch executable.')
  }
  return Object.freeze(identity)
}

/** Close only the Electron process created by this wrapper. */
async function closeElectronApp(app) {
  await Promise.race([
    app.close(),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Packaged C21 app did not close.')), APP_CLOSE_TIMEOUT_MS)),
  ])
}

/** Require a fresh evidence directory to avoid mixing receipts from separate runs. */
async function createFreshEvidenceDirectory(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const entries = await readdir(directory)
  if (entries.length > 0) throw new Error('Packaged C21 evidence directory must be empty.')
}

/** Write one deterministic JSON artifact with a terminal newline. */
async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
}

/** Hash one bounded file. */
async function hashFile(filePath) {
  const bytes = await readFile(filePath)
  return sha256(bytes)
}

/** Hash bytes without retaining them in a receipt. */
function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

/** Validate wrapper options before launching any process. */
function validateOptions(options) {
  if (!isRecord(options) || !isAbsolute(options.appPath) || !isAbsolute(options.evidenceDir)) {
    throw new Error('Packaged C21 options require absolute app and evidence paths.')
  }
  if (!SHA1.test(options.expectedHead ?? '')) throw new Error('Packaged C21 source head is invalid.')
}

/** Return whether a value is an absolute path. */
function isAbsolute(value) {
  return typeof value === 'string' && path.isAbsolute(value) && path.resolve(value) === value
}

/** Return whether a value is a plain record. */
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Resolve the source controller path for the Electron main process. */
function controllerProbePath() {
  try {
    return fileURLToPath(new URL('./archive-security-probe.cjs', import.meta.url))
  } catch {
    return path.resolve(process.cwd(), 'scripts/qualification/archive-security-probe.cjs')
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runPackagedArchiveSecurityProbe(parseArchiveSecurityPackagedArgs(process.argv.slice(2)))
    .then((receipt) => {
      process.stdout.write(`${JSON.stringify(receipt)}\n`)
      if (receipt.valid === false || receipt.status === 'INVALID_EVIDENCE') process.exitCode = 1
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
      process.exitCode = 1
    })
}
