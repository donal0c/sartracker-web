#!/usr/bin/env node

import { execFile, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import {
  chmod,
  link,
  lstat,
  mkdir,
  open,
  opendir,
  readFile,
  realpath,
  rename,
  rm,
  unlink,
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

import {
  validateBreadcrumbPr6QualificationEvidence,
} from '../build/breadcrumb-pr6-qualification-lib.js'

const execFileAsync = promisify(execFile)
const scriptFile = fileURLToPath(import.meta.url)
const projectRoot = path.resolve(path.dirname(scriptFile), '..')
const qualificationScript = path.join(projectRoot, 'scripts/breadcrumb-pr6-qualification.mjs')
const QUALIFICATION_CHILD_DEADLINE_MS = 12 * 60 * 60_000
const QUALIFICATION_CHILD_REAP_DEADLINE_MS = 5_000
const FAILURE_RECEIPT_SCHEMA = 'sartracker-breadcrumb-pr6-qualification-failure-v2'
const FAILURE_RECEIPT_SUFFIX = '.failure.json'
const TERMINAL_OWNER_SUFFIX = '.terminal-owner.json'
const QUALIFICATION_CHILD_EVIDENCE_PREFIX = '.breadcrumb-pr6-qualification-child-'
const QUALIFICATION_CHILD_OWNER_FILE = '.breadcrumb-pr6-qualification-staging-owner.json'
const QUALIFICATION_PRIVATE_EVIDENCE_PREFIXES = Object.freeze([
  QUALIFICATION_CHILD_EVIDENCE_PREFIX,
  '.breadcrumb-pr6-terminal-',
  '.breadcrumb-pr6-neutralizer-',
  '.breadcrumb-pr6-tombstone-',
  '.breadcrumb-pr6-artifact-',
])
const QUALIFICATION_TERMINAL_ARTIFACT_LIMIT_BYTES = 4 * 1024 * 1024
const QUALIFICATION_STAGING_SEAL_ATTEMPTS = 8
const QUALIFICATION_RUN_ID =
  /^q-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const QUALIFICATION_CHILD_DIRECTORY =
  /^\.breadcrumb-pr6-qualification-child-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const QUALIFICATION_CHILD_RUN_ID_ENV = 'SARTRACKER_PR6_QUALIFICATION_RUN_ID'
const QUALIFICATION_CHILD_STARTED_AT_ENV = 'SARTRACKER_PR6_QUALIFICATION_STARTED_AT'
const QUALIFICATION_LOCAL_PROCESS_INSTANCE = `local:${randomUUID()}`
const QUALIFICATION_PROCESS_INSTANCE = /^(?:local:[0-9a-f-]{36}|linux:[0-9a-f-]{36}:[0-9]{1,32})$/u
const QUALIFICATION_RUNTIME_FIELDS = Object.freeze([
  'hostname',
  'platform',
  'release',
  'architecture',
  'cpuCount',
  'totalMemoryBytes',
  'nodeVersion',
])
const QUALIFICATION_DIAGNOSTIC_PHASES = new Set([
  'migration', 'create', 'verify', 'restore', 'cleanup',
])
const QUALIFICATION_FAILURE_PHASES = new Set([
  'preflight', 'migration', 'create', 'verify', 'restore', 'cleanup', 'restart',
  'residue', 'source', 'teardown',
])
const QUALIFICATION_FAILURE_TOP_LEVEL_CODES = new Set([
  'PREFLIGHT_FAILED',
  'MIGRATION_FAILED',
  'ARCHIVE_CREATION_FAILED',
  'ARCHIVE_VERIFICATION_FAILED',
  'ARCHIVE_IDENTITY_FAILED',
  'ARCHIVE_REVIEW_FAILED',
  'DURABLE_INGEST_FAILED',
  'CLEANUP_GATE_FAILED',
  'RESTART_GATE_FAILED',
  'RESIDUE_SCAN_FAILED',
  'SOURCE_INTEGRITY_FAILED',
  'LIVENESS_GATE_FAILED',
  'RESOURCE_GATE_FAILED',
  'EVIDENCE_VALIDATION_FAILED',
  'TEARDOWN_FAILED',
  'UNCLASSIFIED_INTERNAL_FAILURE',
])
const QUALIFICATION_FAILURE_CAUSES_BY_TOP_LEVEL = new Map([
  ['PREFLIGHT_FAILED', new Set(['PREFLIGHT_INTERNAL_FAILURE'])],
  ['MIGRATION_FAILED', new Set(['MIGRATION_UNSETTLED', 'MIGRATION_INTERNAL_FAILURE'])],
  ['ARCHIVE_CREATION_FAILED', new Set(['ARCHIVE_CREATE_INTERNAL_FAILURE'])],
  ['ARCHIVE_VERIFICATION_FAILED', new Set([
    'ARCHIVE_CANCELLED',
    'ARCHIVE_VERIFY_ARCHIVE_CHANGED',
    'ARCHIVE_VERIFY_ARCHIVE_UNAVAILABLE',
    'ARCHIVE_VERIFY_ATTACHMENT_MISMATCH',
    'ARCHIVE_VERIFY_AUTHENTICATION_FAILED',
    'ARCHIVE_VERIFY_CIPHERTEXT_MISMATCH',
    'ARCHIVE_VERIFY_DISK_FULL',
    'ARCHIVE_VERIFY_ENTRY_MISMATCH',
    'ARCHIVE_VERIFY_FAILED',
    'ARCHIVE_VERIFY_FORMAT_INVALID',
    'ARCHIVE_VERIFY_GPX_MISMATCH',
    'ARCHIVE_VERIFY_IDENTITY_MISMATCH',
    'ARCHIVE_VERIFY_INTERNAL_FAILURE',
    'ARCHIVE_VERIFY_INVENTORY_MISMATCH',
    'ARCHIVE_VERIFY_LIVE_STORE_UNAVAILABLE',
    'ARCHIVE_VERIFY_MANIFEST_INVALID',
    'ARCHIVE_VERIFY_PLAINTEXT_CLEANUP_FAILED',
    'ARCHIVE_VERIFY_REPLAY_MISMATCH',
    'ARCHIVE_VERIFY_SCHEMA_MISMATCH',
    'ARCHIVE_VERIFY_SCOPE_MISMATCH',
    'ARCHIVE_VERIFY_SLOT_MISMATCH',
    'ARCHIVE_VERIFY_SQLITE_INVALID',
    'ARCHIVE_VERIFY_TABLE_MISMATCH',
    'ARCHIVE_VERIFY_UNSUPPORTED_FORMAT',
    'ARCHIVE_VERIFY_WRONG_KEY',
  ])],
  ['ARCHIVE_IDENTITY_FAILED', new Set(['ARCHIVE_IDENTITY_MISMATCH'])],
  ['ARCHIVE_REVIEW_FAILED', new Set([
    'ARCHIVE_REPLAY_COMPARISON_FAILED',
    'ARCHIVE_RESTORE_INTERNAL_FAILURE',
  ])],
  ['DURABLE_INGEST_FAILED', new Set([
    'SQLITE_BUSY',
    'DURABLE_WORKER_EXIT',
    'DURABLE_SETTLEMENT_TIMEOUT',
    'DURABLE_INGEST_INCOMPLETE',
  ])],
  ['CLEANUP_GATE_FAILED', new Set([
    'ARCHIVE_CLEANUP_FAILED',
    'ARCHIVE_CLEANUP_AUDIT_FAILED',
    'ARCHIVE_CLEANUP_CANCELLED',
    'ARCHIVE_CLEANUP_CUSTODY_MISMATCH',
    'ARCHIVE_CLEANUP_INPUT_INVALID',
    'ARCHIVE_CLEANUP_JOURNAL_MISMATCH',
    'ARCHIVE_CLEANUP_SIMULATED_KILL',
    'SQLITE_BUSY',
    'CLEANUP_NO_PROGRESS_TIMEOUT',
    'CLEANUP_INCOMPLETE',
    'CLEANUP_INTERNAL_FAILURE',
  ])],
  ['RESTART_GATE_FAILED', new Set(['RESTART_INTERNAL_FAILURE'])],
  ['RESIDUE_SCAN_FAILED', new Set(['RESIDUE_SCAN_FAILED', 'RESIDUE_INTERNAL_FAILURE'])],
  ['SOURCE_INTEGRITY_FAILED', new Set([
    'SOURCE_FIXTURE_CHANGED',
    'SOURCE_INTERNAL_FAILURE',
  ])],
  ['LIVENESS_GATE_FAILED', new Set(['LIVENESS_GATE_FAILED', 'MAIN_LIVENESS_GATE'])],
  ['RESOURCE_GATE_FAILED', new Set(['RSS_GATE_FAILED'])],
  ['EVIDENCE_VALIDATION_FAILED', new Set(['EVIDENCE_INVALID'])],
  ['TEARDOWN_FAILED', new Set([
    'TEARDOWN_INTERNAL_FAILURE',
    'QUALIFICATION_CHILD_UNREPORTED_FAILURE',
  ])],
  ['UNCLASSIFIED_INTERNAL_FAILURE', new Set(['UNCLASSIFIED_INTERNAL_FAILURE'])],
])
const QUALIFICATION_CLEANUP_SUBSTAGES = new Set([
  'input_validation', 'inventory_reconcile', 'journal_initialize', 'select_page',
  'delete_page', 'journal_update', 'completion', 'custody_commit', 'record_failure',
  'worker_open', 'worker_execute', 'worker_close', 'worker_protocol', 'worker_exit',
])
const QUALIFICATION_CLEANUP_CAUSE_CLASSES = new Set([
  'cancelled', 'custody_mismatch', 'input_invalid', 'journal_mismatch', 'sqlite_busy',
  'simulated_kill', 'worker_error', 'worker_exit', 'protocol_invalid', 'internal_failure',
])
const QUALIFICATION_DIAGNOSTIC_PROGRESS_KINDS = new Set([
  'create', 'verify', 'restore', 'cleanup',
])
const QUALIFICATION_DIAGNOSTIC_PROGRESS_UNITS = new Set([
  'bytes', 'rows', 'files', 'phases',
])
const QUALIFICATION_DURABLE_FAILURE_CODES = new Set([
  'SQLITE_BUSY',
  'DURABLE_WORKER_FAILURE',
  'DURABLE_WORKER_EXIT',
  'DURABLE_SETTLEMENT_TIMEOUT',
  'DURABLE_INGEST_INCOMPLETE',
])
const GIT_SHA = /^[0-9a-f]{40}$/u
const SAFE_TOKEN = /^[A-Za-z][A-Za-z0-9:_-]{0,127}$/u
const QUALIFICATION_ABSOLUTE_PATH =
  /(?:^|[^A-Za-z0-9_\\/])(?:[A-Za-z]:[\\/]|[\\/]+)[^\r\n]*/u
const QUALIFICATION_RELATIVE_PATH = /(?:^|[\s"'`([{])(?:~[\\/]|\.{1,2}[\\/])[^\r\n]*/u

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === scriptFile) {
  main().catch(() => {
    process.stderr.write('Breadcrumb PR6 qualification supervisor failed safely.\n')
    process.exitCode = 1
  })
}

/** Runs the qualifier in an owned process group under one finite outer deadline. */
async function main() {
  const rawArguments = process.argv.slice(2)
  const { parseBreadcrumbPr6QualificationArgs } = await import(
    '../build/breadcrumb-pr6-qualification-lib.js'
  )
  const options = parseBreadcrumbPr6QualificationArgs(rawArguments)
  const expectedRepositoryTree = await readRepositoryTree(options.expectedRepositoryHead)
  const terminalRun = await prepareQualificationSupervisorTerminalRun({
    evidencePath: options.evidencePath,
    expectedRepositoryHead: options.expectedRepositoryHead,
    expectedRepositoryTree,
  })
  const childArguments = replaceQualificationEvidenceArgument(
    rawArguments,
    terminalRun.childEvidencePath,
  )
  const child = spawn(process.execPath, [qualificationScript, ...childArguments], {
    cwd: projectRoot,
    stdio: 'inherit',
    env: buildQualificationChildEnvironment(process.env, terminalRun),
    detached: process.platform !== 'win32',
  })

  let exitCode = null
  let failure = null
  try {
    exitCode = await waitForBreadcrumbPr6QualificationChildExit(child)
    if (exitCode !== 0) {
      failure = new Error('Breadcrumb PR6 qualification child exited unsuccessfully.')
    }
  } catch (error) {
    failure = error
  }

  const terminal = await ensureQualificationSupervisorTerminalArtifact({
    childExitCode: exitCode,
    evidencePath: options.evidencePath,
    expectedRepositoryHead: options.expectedRepositoryHead,
    expectedRepositoryTree,
    terminalRun,
  })
  if (failure === null && exitCode === 0 && terminal.kind === 'success') {
    return
  }
  if (failure === null) {
    failure = new Error('Breadcrumb PR6 qualification child did not publish one success artifact.')
  }
  throw failure
}

/** Replaces only the already-validated child evidence argument with private staging. */
function replaceQualificationEvidenceArgument(rawArguments, childEvidencePath) {
  const evidenceIndex = rawArguments.indexOf('--evidence')
  if (evidenceIndex < 0 || evidenceIndex + 1 >= rawArguments.length
    || rawArguments.lastIndexOf('--evidence') !== evidenceIndex
    || typeof childEvidencePath !== 'string' || !path.isAbsolute(childEvidencePath)) {
    throw new Error('Qualification supervisor child evidence arguments are invalid.')
  }
  const childArguments = [...rawArguments]
  childArguments[evidenceIndex + 1] = childEvidencePath
  return Object.freeze(childArguments)
}

/** Gives the child one parent-minted run binding without trusting inherited values. */
function buildQualificationChildEnvironment(environment, terminalRun) {
  assertQualificationSupervisorTerminalRun(terminalRun)
  if (environment === null || typeof environment !== 'object' || Array.isArray(environment)) {
    throw new Error('Qualification supervisor child environment is invalid.')
  }
  return Object.freeze({
    ...environment,
    [QUALIFICATION_CHILD_RUN_ID_ENV]: terminalRun.runId,
    [QUALIFICATION_CHILD_STARTED_AT_ENV]: terminalRun.startedAt,
  })
}

/** Snapshots the local runtime identity that every child terminal must repeat exactly. */
function readQualificationSupervisorRuntime() {
  return Object.freeze({
    hostname: os.hostname(),
    platform: process.platform,
    release: os.release(),
    architecture: os.arch(),
    cpuCount: os.cpus().length,
    totalMemoryBytes: os.totalmem(),
    nodeVersion: process.version,
  })
}

/** Records enough non-secret ownership to distinguish live staging from a crashed parent. */
async function writeQualificationSupervisorChildOwnerMarker(childDirectory, boundary) {
  const markerPath = path.join(childDirectory, QUALIFICATION_CHILD_OWNER_FILE)
  const marker = Object.freeze({
    schema: 'sartracker-breadcrumb-pr6-qualification-staging-owner-v1',
    ownerPid: process.pid,
    ownerHostname: boundary.runtime.hostname,
    ownerProcessInstance: boundary.ownerProcessInstance,
    runId: boundary.runId,
    startedAt: boundary.startedAt,
  })
  const handle = await open(markerPath, 'wx', 0o600)
  try {
    await handle.chmod(0o600)
    await handle.writeFile(`${JSON.stringify(marker)}\n`, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  await syncQualificationSupervisorDirectory(childDirectory)
}

/** Reads only the exact marker contract written before a qualification child starts. */
async function readQualificationSupervisorChildOwnerMarker(childDirectory, observedAtMs) {
  const markerPath = path.join(childDirectory, QUALIFICATION_CHILD_OWNER_FILE)
  const identity = await readQualificationSupervisorArtifactIdentity(markerPath)
    .catch(() => null)
  if (identity === null || identity.nlink !== 1n) return null
  let marker
  try {
    marker = JSON.parse(await readQualificationSupervisorPinnedArtifact(markerPath, identity))
  } catch {
    return null
  }
  if (marker === null || typeof marker !== 'object' || Array.isArray(marker)) return null
  try {
    exactQualificationSupervisorRecord(marker, [
      'schema', 'ownerPid', 'ownerHostname', 'ownerProcessInstance', 'runId', 'startedAt',
    ], [], 'staging owner')
  } catch {
    return null
  }
  if (marker.schema !== 'sartracker-breadcrumb-pr6-qualification-staging-owner-v1'
    || !Number.isSafeInteger(marker.ownerPid) || marker.ownerPid < 1
    || typeof marker.ownerHostname !== 'string'
    || marker.ownerHostname.length < 1
    || Buffer.byteLength(marker.ownerHostname, 'utf8') > 255
    || !QUALIFICATION_PROCESS_INSTANCE.test(marker.ownerProcessInstance ?? '')
    || !QUALIFICATION_RUN_ID.test(marker.runId ?? '')
    || !qualificationSupervisorTimestampIsValid(marker.startedAt)
    || Date.parse(marker.startedAt) > observedAtMs) return null
  return Object.freeze(marker)
}

/** Checks a same-host PID without treating an inaccessible live process as dead. */
function qualificationSupervisorProcessIsAlive(pid, hostname) {
  if (!Number.isSafeInteger(pid) || pid < 1 || hostname !== os.hostname()) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

/** Reads the boot-scoped process start identity needed to defeat PID reuse. */
async function readQualificationSupervisorProcessInstance(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return null
  if (process.platform !== 'linux') {
    return pid === process.pid ? QUALIFICATION_LOCAL_PROCESS_INSTANCE : null
  }
  try {
    const [bootIdValue, statValue] = await Promise.all([
      readFile('/proc/sys/kernel/random/boot_id', 'utf8'),
      readFile(`/proc/${pid}/stat`, 'utf8'),
    ])
    const bootId = bootIdValue.trim().toLowerCase()
    const commandEnd = statValue.lastIndexOf(')')
    const fieldsAfterCommand = commandEnd < 0
      ? []
      : statValue.slice(commandEnd + 1).trim().split(/\s+/u)
    const startTicks = fieldsAfterCommand[19]
    const instance = `linux:${bootId}:${startTicks ?? ''}`
    return QUALIFICATION_PROCESS_INSTANCE.test(instance) ? instance : null
  } catch {
    return null
  }
}

/** Seals private staging whose owning supervisor can no longer complete its terminal. */
async function reconcileQualificationSupervisorStaleChildStaging(
  boundary,
  isProcessAlive,
  readProcessInstance,
  observedAtMs,
  completedSuccessRunId,
) {
  const evidenceParent = path.dirname(boundary.evidencePath)
  const activeRunIds = new Set()
  let hasUnresolvedChildStaging = false
  const entries = await opendir(evidenceParent)
  for await (const entry of entries) {
    if (!QUALIFICATION_CHILD_DIRECTORY.test(entry.name)) continue
    if (!entry.isDirectory()) {
      hasUnresolvedChildStaging = true
      continue
    }
    const childDirectory = path.join(evidenceParent, entry.name)
    const marker = await readQualificationSupervisorChildOwnerMarker(
      childDirectory,
      observedAtMs,
    )
    const markerAgeMs = marker === null ? Number.POSITIVE_INFINITY
      : observedAtMs - Date.parse(marker.startedAt)
    const recentSameHostMarker = marker !== null
      && marker.ownerHostname === boundary.runtime.hostname
      && markerAgeMs >= 0
      && markerAgeMs <= QUALIFICATION_CHILD_DEADLINE_MS + QUALIFICATION_CHILD_REAP_DEADLINE_MS
    const ownerPidAlive = recentSameHostMarker
      && isProcessAlive(marker.ownerPid, marker.ownerHostname) === true
    const observedProcessInstance = recentSameHostMarker
      ? await Promise.resolve().then(
          () => readProcessInstance(marker.ownerPid),
        ).catch(() => null)
      : null
    if (ownerPidAlive && observedProcessInstance === null) {
      throw new Error('Qualification supervisor live process instance is temporarily unavailable.')
    }
    const sameHostOwnerAlive = ownerPidAlive
      && observedProcessInstance === marker.ownerProcessInstance
    const otherHostCouldStillBeActive = marker !== null
      && marker.ownerHostname !== boundary.runtime.hostname
      && markerAgeMs <= QUALIFICATION_CHILD_DEADLINE_MS + QUALIFICATION_CHILD_REAP_DEADLINE_MS
    if (sameHostOwnerAlive || otherHostCouldStillBeActive) {
      if (marker !== null) activeRunIds.add(marker.runId)
      continue
    }
    const staleRun = Object.freeze({
      ...boundary,
      childEvidencePath: path.join(childDirectory, path.basename(boundary.evidencePath)),
    })
    if (marker?.runId === completedSuccessRunId) {
      await removeQualificationSupervisorChildStaging(staleRun, observedAtMs)
      continue
    }
    await sealQualificationSupervisorChildStaging(staleRun, observedAtMs)
  }
  return Object.freeze({ activeRunIds, hasUnresolvedChildStaging })
}

/** Waits for the qualification child, then hard-stops and boundedly reaps its tree. */
export function waitForBreadcrumbPr6QualificationChildExit(
  child,
  timeoutMs = QUALIFICATION_CHILD_DEADLINE_MS,
  dependencies = {},
) {
  if (child === null || typeof child !== 'object'
    || typeof child.once !== 'function' || typeof child.removeListener !== 'function'
    || typeof child.kill !== 'function') {
    throw new Error('Breadcrumb PR6 qualification child is invalid.')
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new Error('Breadcrumb PR6 qualification child deadline is invalid.')
  }
  const reapTimeoutMs = dependencies.reapTimeoutMs
    ?? QUALIFICATION_CHILD_REAP_DEADLINE_MS
  const platform = dependencies.platform ?? process.platform
  const killProcess = dependencies.killProcess ?? process.kill
  if (!Number.isSafeInteger(reapTimeoutMs) || reapTimeoutMs < 1
    || typeof platform !== 'string' || typeof killProcess !== 'function') {
    throw new Error('Breadcrumb PR6 qualification child reap configuration is invalid.')
  }
  if (child.exitCode !== undefined && child.exitCode !== null) {
    return Promise.resolve(child.exitCode)
  }
  if (child.signalCode !== undefined && child.signalCode !== null) {
    return Promise.resolve(1)
  }

  return new Promise((resolve, reject) => {
    let deadline = null
    let reapDeadline = null
    let timeoutError = null
    let settled = false
    const cleanup = () => {
      if (deadline !== null) clearTimeout(deadline)
      if (reapDeadline !== null) clearTimeout(reapDeadline)
      child.removeListener('error', onError)
      child.removeListener('exit', onExit)
    }
    const settle = (settler, value) => {
      if (settled) return
      settled = true
      cleanup()
      settler(value)
    }
    const onError = () => {
      if (timeoutError !== null) return
      const error = new Error('Breadcrumb PR6 qualification child could not start.')
      error.childCannotReport = true
      settle(reject, error)
    }
    const onExit = (code) => {
      if (timeoutError === null) {
        settle(resolve, code ?? 1)
        return
      }
      timeoutError.childCannotReport = true
      settle(reject, timeoutError)
    }
    deadline = setTimeout(() => {
      timeoutError = new Error(
        `Breadcrumb PR6 qualification child exceeded its ${timeoutMs} ms workload deadline.`,
      )
      timeoutError.childCannotReport = signalQualificationProcessTree(child, {
        killProcess,
        platform,
      })
      reapDeadline = setTimeout(() => {
        releaseQualificationChildHandle(child)
        settle(reject, timeoutError)
      }, reapTimeoutMs)
    }, timeoutMs)
    child.once('error', onError)
    child.once('exit', onExit)
  })
}

/** Builds the fixed, path-free receipt used only when the child cannot report. */
export function createQualificationSupervisorFailureReceipt(input) {
  const observation = qualificationSupervisorObservation(input?.observedAtMs)
  if (input === null || typeof input !== 'object' || Array.isArray(input)
    || !GIT_SHA.test(input.expectedRepositoryHead ?? '')
    || !GIT_SHA.test(input.expectedRepositoryTree ?? '')
    || (input.observedRepositoryHead !== null
      && !GIT_SHA.test(input.observedRepositoryHead ?? ''))
    || (input.observedRepositoryTree !== null
      && !GIT_SHA.test(input.observedRepositoryTree ?? ''))
    || (input.observedRepositoryHead === null) !== (input.observedRepositoryTree === null)
    || !QUALIFICATION_RUN_ID.test(input.runId ?? '')
    || !qualificationSupervisorTimestampIsValid(input.startedAt)
    || Date.parse(input.startedAt) > observation.observedAtMs
    || !qualificationSupervisorRuntimeIsValid(input.runtime)) {
    throw new Error('Qualification supervisor failure receipt source identity is invalid.')
  }
  const failure = Object.freeze({
    topLevelCode: 'TEARDOWN_FAILED',
    causeCode: 'QUALIFICATION_CHILD_UNREPORTED_FAILURE',
  })
  return Object.freeze({
    schema: FAILURE_RECEIPT_SCHEMA,
    run: Object.freeze({
      runId: input.runId,
      startedAt: input.startedAt,
      recordedAt: observation.observedAt,
      runtime: freezeQualificationSupervisorRuntime(input.runtime),
    }),
    source: Object.freeze({
      expectedRepositoryHead: input.expectedRepositoryHead,
      observedRepositoryHead: input.observedRepositoryHead,
      expectedRepositoryTree: input.expectedRepositoryTree,
      observedRepositoryTree: input.observedRepositoryTree,
    }),
    failure,
    diagnostics: Object.freeze({
      lastPhase: 'teardown',
      lastGate: 'teardown:qualification-child',
      teardownStatus: 'incomplete',
      primaryFailure: Object.freeze({
        stage: 'teardown',
        gate: 'teardown:qualification-child',
        ...failure,
      }),
      secondaryFailures: Object.freeze([]),
    }),
    cleanup: Object.freeze({ profileCleanupCompleted: false }),
  })
}

/** Releases an unreaped child handle only after owned exit observation expires. */
function releaseQualificationChildHandle(child) {
  if (typeof child.unref !== 'function') return
  try {
    child.unref()
  } catch {
    // The reap-deadline rejection must remain bounded even if unref fails.
  }
}

/** Sends one hard stop to the POSIX group, with a direct-child fallback. */
function signalQualificationProcessTree(child, dependencies) {
  let processGroupSignaled = false
  if (dependencies.platform !== 'win32'
    && Number.isSafeInteger(child.pid) && child.pid > 0) {
    try {
      processGroupSignaled = dependencies.killProcess(-child.pid, 'SIGKILL') !== false
    } catch {
      processGroupSignaled = false
    }
  }
  if (processGroupSignaled) return true
  try {
    return child.kill('SIGKILL') !== false
  } catch {
    return false
  }
}

/** Reads one commit's immutable tree identity. */
async function readRepositoryTree(repositoryHead) {
  const result = await execFileAsync('git', ['rev-parse', `${repositoryHead}^{tree}`], {
    cwd: projectRoot,
    encoding: 'utf8',
  })
  const tree = result.stdout.trim()
  if (!GIT_SHA.test(tree)) {
    throw new Error('Qualification supervisor expected repository tree is invalid.')
  }
  return tree
}

/** Reads the current source identity without turning read failure into private evidence. */
async function readObservedRepositoryIdentity() {
  try {
    const { stdout } = await execFileAsync('git', [
      'status', '--porcelain=v2', '--branch', '--untracked-files=all',
    ], { cwd: projectRoot, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 })
    const status = stdout.trim()
    const head = /^# branch\.oid ([0-9a-f]{40})$/mu.exec(status)?.[1] ?? null
    if (head === null) return null
    const { stdout: treeOutput } = await execFileAsync(
      'git',
      ['rev-parse', `${head}^{tree}`],
      { cwd: projectRoot, encoding: 'utf8' },
    )
    const tree = treeOutput.trim()
    if (!GIT_SHA.test(tree)) return null
    return Object.freeze({
      head,
      tree,
      clean: status.split(/\r?\n/u).every((line) => line === '' || line.startsWith('# ')),
    })
  } catch {
    return null
  }
}

/** Establishes fresh canonical names and a random mode-0700 child-only staging directory. */
export async function prepareQualificationSupervisorTerminalRun(input, dependencies = {}) {
  assertQualificationSupervisorSourceBoundary(input)
  if (dependencies === null || typeof dependencies !== 'object' || Array.isArray(dependencies)
    || (dependencies.isSupervisorProcessAlive !== undefined
      && typeof dependencies.isSupervisorProcessAlive !== 'function')
    || (dependencies.readSupervisorProcessInstance !== undefined
      && typeof dependencies.readSupervisorProcessInstance !== 'function')) {
    throw new Error('Qualification supervisor preparation dependencies are invalid.')
  }
  const evidenceParent = path.dirname(input.evidencePath)
  await mkdir(evidenceParent, { recursive: true, mode: 0o700 })
  await assertQualificationSupervisorDirectorySafe(evidenceParent)

  const observation = qualificationSupervisorObservation()
  const startedAt = observation.observedAt
  const processInstanceReader = dependencies.readSupervisorProcessInstance
    ?? readQualificationSupervisorProcessInstance
  const ownerProcessInstance = await processInstanceReader(process.pid)
  if (!QUALIFICATION_PROCESS_INSTANCE.test(ownerProcessInstance ?? '')) {
    throw new Error('Qualification supervisor process instance is unavailable.')
  }
  const boundary = Object.freeze({
    evidencePath: input.evidencePath,
    expectedRepositoryHead: input.expectedRepositoryHead,
    expectedRepositoryTree: input.expectedRepositoryTree,
    runId: `q-${randomUUID()}`,
    startedAt,
    runtime: readQualificationSupervisorRuntime(),
    ownerProcessInstance,
  })
  const recoverableOwner = await readQualificationSupervisorRecoverableOwner(
    boundary,
    observation.observedAtMs,
  )
  const reconciliation = await reconcileQualificationSupervisorStaleChildStaging(
    boundary,
    dependencies.isSupervisorProcessAlive ?? qualificationSupervisorProcessIsAlive,
    processInstanceReader,
    observation.observedAtMs,
    recoverableOwner?.kind === 'success' ? recoverableOwner.runId : null,
  )
  if (reconciliation.hasUnresolvedChildStaging) {
    throw new Error('Qualification child staging boundary is unresolved.')
  }
  const existing = await readQualificationSupervisorCanonicalTerminalArtifact(
    boundary,
    observation.observedAtMs,
    {
      recoverSuccess: recoverableOwner?.kind === 'success'
        && !reconciliation.activeRunIds.has(recoverableOwner.runId),
    },
  )
  if (existing.kind !== null) {
    throw new Error('Qualification supervisor terminal evidence already exists.')
  }

  const childEvidenceDirectory = path.join(
    evidenceParent,
    `${QUALIFICATION_CHILD_EVIDENCE_PREFIX}${randomUUID()}`,
  )
  await mkdir(childEvidenceDirectory, { mode: 0o700 })
  await chmod(childEvidenceDirectory, 0o700)
  await assertQualificationSupervisorDirectorySafe(childEvidenceDirectory, new Set([0o700]))
  await writeQualificationSupervisorChildOwnerMarker(childEvidenceDirectory, boundary)
  await syncQualificationSupervisorDirectory(evidenceParent)
  return Object.freeze({
    ...boundary,
    childEvidencePath: path.join(childEvidenceDirectory, path.basename(input.evidencePath)),
  })
}

/** Promotes only the artifact matching a reaped exit, otherwise owns a fixed fallback. */
export async function ensureQualificationSupervisorTerminalArtifact(input, dependencies = {}) {
  const observation = qualificationSupervisorObservation()
  assertQualificationSupervisorTerminalRunMatches(input, observation.observedAtMs)
  let canonical = await readQualificationSupervisorCanonicalTerminalArtifact(
    input.terminalRun,
    observation.observedAtMs,
    { recoverSuccess: false },
  )
  if (canonical.kind !== null) {
    return finalizeQualificationSupervisorTerminalArtifact(
      input,
      canonical,
      observation.observedAtMs,
    )
  }

  const expectedChildKind = input.childExitCode === null
    ? null
    : input.childExitCode === 0 ? 'success' : 'failure'
  let observedSource = null
  let sourceObserved = false
  if (expectedChildKind !== null) {
    const staged = await readQualificationSupervisorStagedChildArtifact(
      input.terminalRun,
      observation.observedAtMs,
    ).catch(() => null)
    observedSource = await readQualificationSupervisorObservedSource(dependencies)
    sourceObserved = true
    const exactCleanSource = observedSource?.head === input.expectedRepositoryHead
      && observedSource?.tree === input.expectedRepositoryTree
      && observedSource?.clean === true
    if (staged?.kind === expectedChildKind && exactCleanSource) {
      const terminal = await publishQualificationSupervisorCanonicalArtifact({
        contents: staged.contents,
        kind: staged.kind,
        terminalRun: input.terminalRun,
        observedAtMs: observation.observedAtMs,
        deferSuccessName: staged.kind === 'success',
      })
      return finalizeQualificationSupervisorTerminalArtifact(
        input,
        terminal,
        observation.observedAtMs,
      )
    }
  }

  if (!sourceObserved) {
    observedSource = await readQualificationSupervisorObservedSource(dependencies)
  }
  const observedSourceValid = observedSource !== null
    && typeof observedSource === 'object'
    && GIT_SHA.test(observedSource.head ?? '')
    && GIT_SHA.test(observedSource.tree ?? '')
  const receipt = createQualificationSupervisorFailureReceipt({
    expectedRepositoryHead: input.expectedRepositoryHead,
    expectedRepositoryTree: input.expectedRepositoryTree,
    observedRepositoryHead: observedSourceValid ? observedSource.head : null,
    observedRepositoryTree: observedSourceValid ? observedSource.tree : null,
    runId: input.terminalRun.runId,
    startedAt: input.terminalRun.startedAt,
    runtime: input.terminalRun.runtime,
    observedAtMs: observation.observedAtMs,
  })
  canonical = await publishQualificationSupervisorCanonicalArtifact({
    contents: `${JSON.stringify(receipt, null, 2)}\n`,
    kind: 'failure',
    terminalRun: input.terminalRun,
    observedAtMs: observation.observedAtMs,
  })
  return finalizeQualificationSupervisorTerminalArtifact(
    input,
    canonical,
    observation.observedAtMs,
  )
}

/** Exposes success only after child staging cleanup; failure remains immediately terminal. */
async function finalizeQualificationSupervisorTerminalArtifact(input, terminal, observedAtMs) {
  if (terminal.kind === 'success') {
    await concealQualificationSupervisorSuccessName(input.terminalRun)
  }
  assertQualificationSupervisorTerminalOutcome(terminal.kind, input.childExitCode)
  try {
    await finalizeQualificationSupervisorChildStaging(
      input.terminalRun,
      input.childExitCode,
      observedAtMs,
    )
  } catch {
    if (terminal.kind === 'success') {
      await concealQualificationSupervisorSuccessName(input.terminalRun)
    }
    throw new Error(
      'Qualification terminal ownership is durable, but private child staging cleanup is incomplete.',
    )
  }
  if (terminal.kind !== 'success') return terminal
  const exposed = await readQualificationSupervisorCanonicalTerminalArtifact(
    input.terminalRun,
    observedAtMs,
    { recoverSuccess: true },
  )
  if (exposed.kind !== 'success') {
    throw new Error('Qualification pending success could not be promoted after staging cleanup.')
  }
  return Object.freeze({ ...exposed, published: terminal.published })
}

/** Removes only the redundant public success link while retaining its durable owner inode. */
async function concealQualificationSupervisorSuccessName(terminalRun) {
  const paths = qualificationSupervisorTerminalPaths(terminalRun.evidencePath)
  const [ownerIdentity, successIdentity] = await Promise.all([
    readQualificationSupervisorArtifactIdentity(paths.ownerPath),
    readQualificationSupervisorArtifactIdentity(paths.successPath),
  ])
  if (successIdentity === null) return
  if (ownerIdentity === null || ownerIdentity.dev !== successIdentity.dev
    || ownerIdentity.ino !== successIdentity.ino) {
    throw new Error('Qualification public success does not share terminal ownership.')
  }
  await unlink(paths.successPath)
  await syncQualificationSupervisorDirectory(path.dirname(paths.successPath))
}

/** Clears reaped staging or terminally neutralizes one unreaped child's private names. */
async function finalizeQualificationSupervisorChildStaging(
  terminalRun,
  childExitCode,
  observedAtMs,
) {
  if (childExitCode === null) {
    await sealQualificationSupervisorChildStaging(terminalRun, observedAtMs)
    return
  }
  await removeQualificationSupervisorChildStaging(terminalRun, observedAtMs)
}

/** Allows success only when the supervisor authoritatively reaped exit code zero. */
export function assertQualificationSupervisorTerminalOutcome(kind, childExitCode) {
  if (!['success', 'failure'].includes(kind)
    || (childExitCode !== null
      && (!Number.isSafeInteger(childExitCode) || childExitCode < 0 || childExitCode > 255))) {
    throw new Error('Qualification supervisor terminal outcome is invalid.')
  }
  if (kind === 'success' && childExitCode !== 0) {
    throw new Error('Qualification success requires one reaped zero child outcome.')
  }
}

/** Re-observes source without ever manufacturing observed identity from expected input. */
async function readQualificationSupervisorObservedSource(dependencies) {
  const reader = dependencies.readObservedRepositoryIdentity ?? readObservedRepositoryIdentity
  try {
    if (typeof reader !== 'function') {
      throw new Error('Qualification supervisor source reader is invalid.')
    }
    const source = await reader()
    if (source === null || typeof source !== 'object' || Array.isArray(source)
      || !GIT_SHA.test(source.head ?? '') || !GIT_SHA.test(source.tree ?? '')
      || (source.clean !== undefined && typeof source.clean !== 'boolean')) {
      return null
    }
    return Object.freeze({
      head: source.head,
      tree: source.tree,
      clean: source.clean === true,
    })
  } catch {
    return null
  }
}

/** Claims one shared terminal inode, then recovers exactly one verdict-specific name. */
export async function publishQualificationSupervisorCanonicalArtifact(input) {
  const observation = qualificationSupervisorObservation(input?.observedAtMs)
  const recoverSuccess = input?.deferSuccessName !== true
  const validated = parseQualificationSupervisorTerminalContents(
    input?.contents,
    input?.terminalRun,
    { observedAtMs: observation.observedAtMs },
  )
  if (validated.kind !== input?.kind) {
    throw new Error('Qualification supervisor verdict does not match its canonical filename.')
  }
  const canonicalContents = `${JSON.stringify(validated.evidence, null, 2)}\n`
  if (Buffer.byteLength(canonicalContents, 'utf8') > QUALIFICATION_TERMINAL_ARTIFACT_LIMIT_BYTES) {
    throw new Error('Qualification supervisor terminal evidence is unbounded.')
  }
  const existing = await readQualificationSupervisorCanonicalTerminalArtifact(
    input.terminalRun,
    observation.observedAtMs,
    { recoverSuccess },
  )
  if (existing.kind !== null) {
    await assertQualificationSupervisorCanonicalContents(existing, canonicalContents)
    return existing
  }

  const paths = qualificationSupervisorTerminalPaths(input.terminalRun.evidencePath)
  const parent = path.dirname(input.terminalRun.evidencePath)
  const stagingParent = path.dirname(input.terminalRun.childEvidencePath)
  await assertQualificationSupervisorDirectorySafe(stagingParent, new Set([0o700]))
  const temporaryPath = path.join(
    stagingParent,
    `.breadcrumb-pr6-terminal-${process.pid}-${randomUUID()}.tmp`,
  )
  let handle = null
  let temporaryPresent = false
  try {
    handle = await open(temporaryPath, 'wx', 0o600)
    temporaryPresent = true
    await handle.chmod(0o600)
    await handle.writeFile(canonicalContents, 'utf8')
    await handle.sync()
    await handle.close()
    handle = null
    try {
      await link(temporaryPath, paths.ownerPath)
      await syncQualificationSupervisorDirectory(parent)
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      const concurrent = await readQualificationSupervisorCanonicalTerminalArtifact(
        input.terminalRun,
        observation.observedAtMs,
        { recoverSuccess },
      )
      await assertQualificationSupervisorCanonicalContents(concurrent, canonicalContents)
      return concurrent
    }
    await unlink(temporaryPath)
    temporaryPresent = false
    await syncQualificationSupervisorDirectory(stagingParent)
    const terminal = await readQualificationSupervisorCanonicalTerminalArtifact(
      input.terminalRun,
      observation.observedAtMs,
      { recoverSuccess },
    )
    if (terminal.kind !== input.kind) {
      throw new Error('Qualification supervisor ownership resolved to the opposite verdict.')
    }
    return Object.freeze({ ...terminal, published: true })
  } finally {
    await handle?.close().catch(() => undefined)
    if (temporaryPresent) {
      await unlink(temporaryPath).catch((error) => {
        if (!['ENOENT', 'ENOTDIR'].includes(error?.code)) throw error
      })
      await syncQualificationSupervisorDirectory(stagingParent)
    }
  }
}

/** Requires an owner-race winner to contain this exact run's canonical bytes. */
async function assertQualificationSupervisorCanonicalContents(terminal, expectedContents) {
  if (terminal?.kind === null || typeof terminal?.path !== 'string') {
    throw new Error('Qualification supervisor concurrent terminal owner is invalid.')
  }
  const identity = await readQualificationSupervisorArtifactIdentity(terminal.path)
  if (identity === null) {
    throw new Error('Qualification supervisor concurrent terminal owner disappeared.')
  }
  const contents = await readQualificationSupervisorPinnedArtifact(terminal.path, identity)
  if (contents !== expectedContents) {
    throw new Error('Qualification supervisor concurrent terminal belongs to another run.')
  }
}

/** Reads one validated staged child artifact from the random private directory. */
async function readQualificationSupervisorStagedChildArtifact(terminalRun, observedAtMs) {
  assertQualificationSupervisorTerminalRun(terminalRun, observedAtMs)
  const childDirectory = path.dirname(terminalRun.childEvidencePath)
  await assertQualificationSupervisorDirectorySafe(childDirectory, new Set([0o700]))
  const paths = qualificationSupervisorTerminalPaths(terminalRun.childEvidencePath)
  const [successIdentity, failureIdentity] = await Promise.all([
    readQualificationSupervisorArtifactIdentity(paths.successPath),
    readQualificationSupervisorArtifactIdentity(paths.failurePath),
  ])
  if (successIdentity !== null && failureIdentity !== null) {
    throw new Error('Qualification child published contradictory terminal artifacts.')
  }
  if (successIdentity === null && failureIdentity === null) return null
  const kind = successIdentity === null ? 'failure' : 'success'
  const artifactPath = kind === 'success' ? paths.successPath : paths.failurePath
  const identity = kind === 'success' ? successIdentity : failureIdentity
  if (identity.nlink !== 1n) {
    throw new Error('Qualification child terminal evidence has unexpected filesystem links.')
  }
  const contents = await readQualificationSupervisorPinnedArtifact(artifactPath, identity)
  const validated = parseQualificationSupervisorTerminalContents(contents, terminalRun, {
    allowSupervisorFailure: false,
    observedAtMs,
  })
  if (validated.kind !== kind) {
    throw new Error('Qualification child verdict does not match its staged filename.')
  }
  return Object.freeze({ contents, kind })
}

/** Reads or crash-recovers the canonical verdict name from its sole owner inode. */
async function readQualificationSupervisorCanonicalTerminalArtifact(
  boundary,
  observedAtMs,
  options = {},
) {
  assertQualificationSupervisorBoundary(boundary, observedAtMs)
  const parent = path.dirname(boundary.evidencePath)
  await assertQualificationSupervisorDirectorySafe(parent)
  const paths = qualificationSupervisorTerminalPaths(boundary.evidencePath)
  const [ownerIdentity, successIdentity, failureIdentity] = await Promise.all([
    readQualificationSupervisorArtifactIdentity(paths.ownerPath),
    readQualificationSupervisorArtifactIdentity(paths.successPath),
    readQualificationSupervisorArtifactIdentity(paths.failurePath),
  ])
  if (successIdentity !== null && failureIdentity !== null) {
    throw new Error('Qualification supervisor must retain exactly one terminal artifact.')
  }
  if (ownerIdentity === null) {
    if (successIdentity !== null || failureIdentity !== null) {
      throw new Error('Qualification canonical evidence has no terminal ownership inode.')
    }
    return Object.freeze({ kind: null, path: null, published: false })
  }
  const initialVerdictLinkCount = BigInt(
    Number(successIdentity !== null) + Number(failureIdentity !== null),
  )
  if (ownerIdentity.nlink !== 1n + initialVerdictLinkCount) {
    throw new Error('Qualification canonical owner has unexpected filesystem links.')
  }

  const contents = await readQualificationSupervisorPinnedArtifact(paths.ownerPath, ownerIdentity)
  const recoverableKind = parseQualificationSupervisorRecoverableOwner(
    contents,
    boundary,
    observedAtMs,
  ).kind
  let recoveredSuccessIdentity = successIdentity
  let recoveredFailureIdentity = failureIdentity
  if (recoveredSuccessIdentity === null && recoveredFailureIdentity === null
    && (recoverableKind === 'failure' || options.recoverSuccess !== false)) {
    const recoveryPath = recoverableKind === 'success' ? paths.successPath : paths.failurePath
    try {
      await link(paths.ownerPath, recoveryPath)
      await syncQualificationSupervisorDirectory(parent)
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
    }
    const recoveredIdentities = await Promise.all([
      readQualificationSupervisorArtifactIdentity(paths.successPath),
      readQualificationSupervisorArtifactIdentity(paths.failurePath),
    ])
    recoveredSuccessIdentity = recoveredIdentities[0]
    recoveredFailureIdentity = recoveredIdentities[1]
  }
  if (recoveredSuccessIdentity !== null && recoveredFailureIdentity !== null) {
    throw new Error('Qualification supervisor must retain exactly one terminal artifact.')
  }
  const recoveredOwnerIdentity = await readQualificationSupervisorArtifactIdentity(paths.ownerPath)
  const recoveredVerdictLinkCount = BigInt(
    Number(recoveredSuccessIdentity !== null) + Number(recoveredFailureIdentity !== null),
  )
  if (recoveredOwnerIdentity === null
    || recoveredOwnerIdentity.dev !== ownerIdentity.dev
    || recoveredOwnerIdentity.ino !== ownerIdentity.ino
    || recoveredOwnerIdentity.nlink !== 1n + recoveredVerdictLinkCount) {
    throw new Error('Qualification canonical owner links changed during recovery.')
  }
  const ownerKind = parseQualificationSupervisorTerminalContents(contents, boundary, {
    observedAtMs,
  }).kind
  const artifactPath = ownerKind === 'success' ? paths.successPath : paths.failurePath
  const recoveredIdentity = ownerKind === 'success'
    ? recoveredSuccessIdentity
    : recoveredFailureIdentity
  const oppositeIdentity = ownerKind === 'success'
    ? recoveredFailureIdentity
    : recoveredSuccessIdentity
  if (ownerKind === 'success' && recoveredIdentity === null
    && oppositeIdentity === null && options.recoverSuccess === false) {
    return Object.freeze({
      kind: 'success',
      path: paths.ownerPath,
      published: false,
      pending: true,
    })
  }
  if (oppositeIdentity !== null || recoveredIdentity === null
    || recoveredIdentity.dev !== recoveredOwnerIdentity.dev
    || recoveredIdentity.ino !== recoveredOwnerIdentity.ino
    || recoveredIdentity.nlink !== recoveredOwnerIdentity.nlink) {
    throw new Error('Qualification canonical evidence does not share terminal ownership.')
  }
  return Object.freeze({ kind: ownerKind, path: artifactPath, published: false })
}

/** Reads a durable owner under its embedded prior-run boundary without accepting it. */
async function readQualificationSupervisorRecoverableOwner(boundary, observedAtMs) {
  const ownerPath = qualificationSupervisorTerminalPaths(boundary.evidencePath).ownerPath
  const ownerIdentity = await readQualificationSupervisorArtifactIdentity(ownerPath)
  if (ownerIdentity === null) return null
  const contents = await readQualificationSupervisorPinnedArtifact(ownerPath, ownerIdentity)
  const parsed = parseQualificationSupervisorRecoverableOwner(
    contents,
    boundary,
    observedAtMs,
  )
  return Object.freeze({ kind: parsed.kind, runId: parsed.evidence.run.runId })
}

/** Fully validates an older run owner before restoring its verdict-specific name. */
function parseQualificationSupervisorRecoverableOwner(contents, boundary, observedAtMs) {
  let evidence
  try {
    evidence = JSON.parse(contents)
  } catch {
    throw new Error('Qualification supervisor terminal owner is not valid JSON.')
  }
  if (evidence === null || typeof evidence !== 'object' || Array.isArray(evidence)) {
    throw new Error('Qualification supervisor terminal owner root is invalid.')
  }
  let embeddedBoundary
  if (evidence.schema === 'sartracker-breadcrumb-pr6-qualification-v2') {
    embeddedBoundary = {
      ...boundary,
      expectedRepositoryHead: evidence.source?.repositoryHead,
      expectedRepositoryTree: evidence.source?.repositoryTree,
      runId: evidence.run?.runId,
      startedAt: evidence.run?.startedAt,
      runtime: evidence.machine,
    }
  } else if (evidence.schema === FAILURE_RECEIPT_SCHEMA) {
    embeddedBoundary = {
      ...boundary,
      expectedRepositoryHead: evidence.source?.expectedRepositoryHead,
      expectedRepositoryTree: evidence.source?.expectedRepositoryTree,
      runId: evidence.run?.runId,
      startedAt: evidence.run?.startedAt,
      runtime: evidence.run?.runtime,
    }
  } else {
    throw new Error('Qualification supervisor terminal owner schema is unsupported.')
  }
  return parseQualificationSupervisorTerminalContents(contents, embeddedBoundary, {
    observedAtMs,
  })
}

/** Converts an unreaped child's output names into immutable sanitized tombstones. */
async function sealQualificationSupervisorChildStaging(terminalRun, observedAtMs) {
  assertQualificationSupervisorTerminalRun(terminalRun, observedAtMs)
  const childDirectory = path.dirname(terminalRun.childEvidencePath)
  const identity = await lstat(childDirectory).catch((error) => {
    if (error?.code === 'ENOENT') return null
    throw error
  })
  if (identity === null) return
  const mode = identity.mode & 0o777
  if (!identity.isDirectory() || identity.isSymbolicLink() || ![0o700, 0o500].includes(mode)
    || await realpath(childDirectory) !== childDirectory) {
    throw new Error('Qualification child staging boundary is unsafe.')
  }
  if (mode === 0o500) {
    try {
      await assertQualificationSupervisorStagingFullyNeutralized(childDirectory)
      return
    } catch {
      await chmod(childDirectory, 0o700)
    }
  }
  let lastFailure = null
  for (let attempt = 0; attempt < QUALIFICATION_STAGING_SEAL_ATTEMPTS; attempt += 1) {
    let tombstoneDirectory = null
    try {
      await chmod(childDirectory, 0o700)
      tombstoneDirectory = path.join(
        childDirectory,
        `.breadcrumb-pr6-neutralizer-${randomUUID()}`,
      )
      await mkdir(tombstoneDirectory, { mode: 0o700 })
      await assertQualificationSupervisorDirectorySafe(tombstoneDirectory, new Set([0o700]))
      const entries = await opendir(childDirectory)
      for await (const entry of entries) {
        if (entry.name === path.basename(tombstoneDirectory)) continue
        if (Buffer.byteLength(entry.name, 'utf8') > 255) {
          throw new Error('Qualification child staging contains an unsafe entry.')
        }
        if (entry.isDirectory()) {
          await rm(path.join(childDirectory, entry.name), { recursive: true, force: false })
        }
        await replaceQualificationSupervisorStagingTombstone(
          path.join(childDirectory, entry.name),
          tombstoneDirectory,
        )
      }
      const paths = qualificationSupervisorTerminalPaths(terminalRun.childEvidencePath)
      await replaceQualificationSupervisorStagingTombstone(
        paths.successPath,
        tombstoneDirectory,
      )
      await replaceQualificationSupervisorStagingTombstone(
        paths.failurePath,
        tombstoneDirectory,
      )
      await rm(tombstoneDirectory, { recursive: true, force: false })
      tombstoneDirectory = null
      await syncQualificationSupervisorDirectory(childDirectory)
      await chmod(childDirectory, 0o500)
      await syncQualificationSupervisorDirectory(path.dirname(childDirectory))
      await assertQualificationSupervisorStagingFullyNeutralized(childDirectory)
      return
    } catch (error) {
      lastFailure = error
      if (tombstoneDirectory !== null) {
        await chmod(childDirectory, 0o700).catch(() => undefined)
        await rm(tombstoneDirectory, { recursive: true, force: true }).catch(() => undefined)
      }
    }
  }
  await chmod(childDirectory, 0o500).catch(() => undefined)
  throw new AggregateError(
    lastFailure === null ? [] : [lastFailure],
    'Qualification child staging could not be fully neutralized.',
  )
}

/** Removes only the random child staging directory after an authoritative reaped exit. */
async function removeQualificationSupervisorChildStaging(terminalRun, observedAtMs) {
  assertQualificationSupervisorTerminalRun(terminalRun, observedAtMs)
  const childDirectory = path.dirname(terminalRun.childEvidencePath)
  const identity = await lstat(childDirectory).catch((error) => {
    if (error?.code === 'ENOENT') return null
    throw error
  })
  if (identity === null) return
  if (!identity.isDirectory() || identity.isSymbolicLink()
    || ![0o700, 0o500].includes(identity.mode & 0o777)
    || await realpath(childDirectory) !== childDirectory) {
    throw new Error('Qualification child staging cleanup boundary is unsafe.')
  }
  await chmod(childDirectory, 0o700)
  await rm(childDirectory, { recursive: true, force: false })
  await syncQualificationSupervisorDirectory(path.dirname(childDirectory))
}

/** Atomically replaces one staged verdict name with a fixed mode-0600 tombstone. */
async function replaceQualificationSupervisorStagingTombstone(
  artifactPath,
  temporaryDirectory,
) {
  const contents = '{"schema":"sartracker-breadcrumb-pr6-staging-tombstone-v1"}\n'
  const temporaryPath = path.join(
    temporaryDirectory,
    `.breadcrumb-pr6-tombstone-${process.pid}-${randomUUID()}.tmp`,
  )
  let handle = null
  let temporaryPresent = false
  try {
    handle = await open(temporaryPath, 'wx', 0o600)
    temporaryPresent = true
    await handle.chmod(0o600)
    await handle.writeFile(contents, 'utf8')
    await handle.sync()
    await handle.close()
    handle = null
    await rename(temporaryPath, artifactPath)
    temporaryPresent = false
    await assertQualificationSupervisorStagingTombstone(artifactPath)
  } finally {
    await handle?.close().catch(() => undefined)
    if (temporaryPresent) {
      await unlink(temporaryPath).catch((error) => {
        if (error?.code !== 'ENOENT') throw error
      })
    }
  }
}

/** Requires the exact fixed tombstone used to block every late child verdict link. */
async function assertQualificationSupervisorStagingTombstone(artifactPath) {
  const identity = await readQualificationSupervisorArtifactIdentity(artifactPath)
  if (identity === null) {
    throw new Error('Qualification child staging tombstone is missing.')
  }
  const contents = await readQualificationSupervisorPinnedArtifact(artifactPath, identity)
  if (contents !== '{"schema":"sartracker-breadcrumb-pr6-staging-tombstone-v1"}\n') {
    throw new Error('Qualification child staging tombstone is invalid.')
  }
}

/** Requires every sealed child entry, including abandoned temps, to be one tombstone. */
async function assertQualificationSupervisorStagingFullyNeutralized(childDirectory) {
  let entryCount = 0
  const entries = await opendir(childDirectory)
  for await (const entry of entries) {
    entryCount += 1
    if (entry.isDirectory() || Buffer.byteLength(entry.name, 'utf8') > 255) {
      throw new Error('Qualification child staging neutralization is incomplete.')
    }
    await assertQualificationSupervisorStagingTombstone(path.join(childDirectory, entry.name))
  }
  if (entryCount < 2) {
    throw new Error('Qualification child staging neutralization is incomplete.')
  }
}

/** Parses and validates only current-source child proof or the closed fallback receipt. */
function parseQualificationSupervisorTerminalContents(contents, boundary, options = {}) {
  const observation = qualificationSupervisorObservation(options.observedAtMs)
  assertQualificationSupervisorBoundary(boundary, observation.observedAtMs)
  if (typeof contents !== 'string' || Buffer.byteLength(contents, 'utf8') < 1
    || Buffer.byteLength(contents, 'utf8') > QUALIFICATION_TERMINAL_ARTIFACT_LIMIT_BYTES) {
    throw new Error('Qualification supervisor terminal evidence is invalid or unbounded.')
  }
  let evidence
  try {
    evidence = JSON.parse(contents)
  } catch {
    throw new Error('Qualification supervisor terminal evidence is not valid JSON.')
  }
  if (evidence === null || typeof evidence !== 'object' || Array.isArray(evidence)) {
    throw new Error('Qualification supervisor terminal evidence root is invalid.')
  }
  if (evidence.schema === 'sartracker-breadcrumb-pr6-qualification-v2') {
    const source = evidence.source
    const completedAtMs = Date.parse(evidence.run?.completedAt)
    if (evidence.run?.runId !== boundary.runId
      || evidence.run?.startedAt !== boundary.startedAt
      || !Number.isFinite(completedAtMs)
      || completedAtMs < Date.parse(boundary.startedAt)
      || completedAtMs > observation.observedAtMs
      || !qualificationSupervisorRuntimeMatches(evidence.machine, boundary.runtime)
      || source?.repositoryHead !== boundary.expectedRepositoryHead
      || source?.repositoryHeadAfterRun !== boundary.expectedRepositoryHead
      || source?.repositoryTree !== boundary.expectedRepositoryTree
      || source?.repositoryTreeAfterRun !== boundary.expectedRepositoryTree
      || source?.repositoryDirtyBefore !== false
      || source?.repositoryDirtyAfter !== false) {
      throw new Error('Qualification success evidence is not bound to the exact clean source.')
    }
    const validation = validateBreadcrumbPr6QualificationEvidence(
      evidence,
      boundary.expectedRepositoryHead,
    )
    if (validation.passed !== true
      || validation.repositoryHead !== boundary.expectedRepositoryHead
      || validation.repositoryTree !== boundary.expectedRepositoryTree) {
      throw new Error('Qualification success evidence failed its full gate.')
    }
    return Object.freeze({ evidence, kind: 'success' })
  }
  if (evidence.schema === FAILURE_RECEIPT_SCHEMA) {
    validateQualificationSupervisorFailureReceipt(evidence, boundary, {
      ...options,
      observedAtMs: observation.observedAtMs,
    })
    return Object.freeze({ evidence, kind: 'failure' })
  }
  throw new Error('Qualification supervisor terminal evidence schema is unsupported.')
}

/** Applies a closed source-bound contract to both child and supervisor failure receipts. */
function validateQualificationSupervisorFailureReceipt(receipt, boundary, options) {
  assertQualificationSupervisorFailureReceiptSafe(receipt)
  exactQualificationSupervisorRecord(receipt, [
    'schema', 'run', 'source', 'failure', 'diagnostics', 'cleanup',
  ], [], 'failure receipt')
  const run = exactQualificationSupervisorRecord(
    receipt.run,
    ['runId', 'startedAt', 'recordedAt', 'runtime'],
    [],
    'failure run',
  )
  const source = exactQualificationSupervisorRecord(receipt.source, [
    'expectedRepositoryHead',
    'observedRepositoryHead',
    'expectedRepositoryTree',
    'observedRepositoryTree',
  ], [], 'failure source')
  const failure = exactQualificationSupervisorRecord(
    receipt.failure,
    ['topLevelCode', 'causeCode'],
    [],
    'failure summary',
  )
  const cleanup = exactQualificationSupervisorRecord(
    receipt.cleanup,
    ['profileCleanupCompleted'],
    [],
    'failure cleanup',
  )
  const recordedAtMs = Date.parse(run.recordedAt)
  if (run.runId !== boundary.runId
    || run.startedAt !== boundary.startedAt
    || !qualificationSupervisorTimestampIsValid(run.recordedAt)
    || recordedAtMs < Date.parse(boundary.startedAt)
    || recordedAtMs > options.observedAtMs
    || !qualificationSupervisorRuntimeMatches(run.runtime, boundary.runtime)
    || source.expectedRepositoryHead !== boundary.expectedRepositoryHead
    || source.expectedRepositoryTree !== boundary.expectedRepositoryTree
    || !qualificationSupervisorFailurePairIsValid(
      failure.topLevelCode,
      failure.causeCode,
    )
    || typeof cleanup.profileCleanupCompleted !== 'boolean') {
    throw new Error('Qualification failure receipt identity or summary is invalid.')
  }

  const supervisorOwned = failure.topLevelCode === 'TEARDOWN_FAILED'
    && failure.causeCode === 'QUALIFICATION_CHILD_UNREPORTED_FAILURE'
  if (supervisorOwned) {
    if (options.allowSupervisorFailure === false) {
      throw new Error('Qualification child cannot publish supervisor-owned failure evidence.')
    }
    const observedPairValid = (source.observedRepositoryHead === null
      && source.observedRepositoryTree === null)
      || (GIT_SHA.test(source.observedRepositoryHead ?? '')
        && GIT_SHA.test(source.observedRepositoryTree ?? ''))
    const diagnostics = exactQualificationSupervisorRecord(receipt.diagnostics, [
      'lastPhase', 'lastGate', 'teardownStatus', 'primaryFailure', 'secondaryFailures',
    ], [], 'supervisor failure diagnostics')
    if (!observedPairValid || cleanup.profileCleanupCompleted !== false
      || diagnostics.lastPhase !== 'teardown'
      || diagnostics.lastGate !== 'teardown:qualification-child'
      || diagnostics.teardownStatus !== 'incomplete'
      || !Array.isArray(diagnostics.secondaryFailures)
      || diagnostics.secondaryFailures.length !== 0
      || JSON.stringify(diagnostics.primaryFailure) !== JSON.stringify({
        stage: 'teardown',
        gate: 'teardown:qualification-child',
        topLevelCode: 'TEARDOWN_FAILED',
        causeCode: 'QUALIFICATION_CHILD_UNREPORTED_FAILURE',
      })) {
      throw new Error('Qualification supervisor fallback receipt is invalid.')
    }
    return
  }

  if (source.observedRepositoryHead !== boundary.expectedRepositoryHead
    || source.observedRepositoryTree !== boundary.expectedRepositoryTree) {
    throw new Error('Qualification child failure is not bound to the exact source.')
  }
  validateQualificationSupervisorChildDiagnostics(receipt.diagnostics, failure)
}

/** Applies the child ledger's full closed shape before retaining diagnostic claims. */
function validateQualificationSupervisorChildDiagnostics(diagnostics, failure) {
  const value = exactQualificationSupervisorRecord(diagnostics, [
    'lastPhase', 'lastGate', 'lastOperationalGate', 'teardownStatus', 'primaryFailure',
    'secondaryFailures', 'archiveProgress', 'durableWorker', 'contentionProbe',
    'cleanupCursor', 'archiveIdentity', 'rss',
  ], ['cleanupFailure'], 'child failure diagnostics')
  if (!QUALIFICATION_FAILURE_PHASES.has(value.lastPhase)
    || !SAFE_TOKEN.test(value.lastGate ?? '')
    || !SAFE_TOKEN.test(value.lastOperationalGate ?? '')
    || !['not_started', 'complete', 'incomplete'].includes(value.teardownStatus)) {
    throw new Error('Qualification child failure diagnostic boundary is invalid.')
  }
  validateQualificationSupervisorPrimaryFailure(value.primaryFailure, failure)
  validateQualificationSupervisorSecondaryFailures(value.secondaryFailures)
  validateQualificationSupervisorArchiveProgress(value.archiveProgress)
  validateQualificationSupervisorDurableWorker(value.durableWorker)
  validateQualificationSupervisorContentionProbe(value.contentionProbe)
  validateQualificationSupervisorCleanupCursor(value.cleanupCursor)
  validateQualificationSupervisorArchiveIdentity(value.archiveIdentity)
  validateQualificationSupervisorRss(value.rss)
  if (Object.hasOwn(value, 'cleanupFailure')) {
    validateQualificationSupervisorCleanupFailure(value.cleanupFailure)
  }
}

/** Validates the optional first failure and its summary correlation. */
function validateQualificationSupervisorPrimaryFailure(primaryFailure, failure) {
  if (primaryFailure === null) {
    throw new Error('Qualification child primary failure is missing.')
  }
  const value = exactQualificationSupervisorRecord(primaryFailure, [
    'stage', 'gate', 'topLevelCode', 'causeCode',
  ], [], 'primary failure')
  if (!QUALIFICATION_FAILURE_PHASES.has(value.stage) || !SAFE_TOKEN.test(value.gate ?? '')
    || !qualificationSupervisorFailurePairIsValid(value.topLevelCode, value.causeCode)
    || value.topLevelCode !== failure.topLevelCode || value.causeCode !== failure.causeCode) {
    throw new Error('Qualification child primary failure is invalid.')
  }
}

/** Validates the bounded list of teardown failures. */
function validateQualificationSupervisorSecondaryFailures(secondaryFailures) {
  if (!Array.isArray(secondaryFailures) || secondaryFailures.length > 8) {
    throw new Error('Qualification child secondary failures are invalid.')
  }
  for (const entry of secondaryFailures) {
    const value = exactQualificationSupervisorRecord(entry, [
      'boundary', 'topLevelCode', 'causeCode',
    ], [], 'secondary failure')
    if (!SAFE_TOKEN.test(value.boundary ?? '')
      || !qualificationSupervisorFailurePairIsValid(
        value.topLevelCode,
        value.causeCode,
      )) {
      throw new Error('Qualification child secondary failure is invalid.')
    }
  }
}

/** Validates the latest bounded archive progress tuple. */
function validateQualificationSupervisorArchiveProgress(progress) {
  if (progress === null) return
  const value = exactQualificationSupervisorRecord(progress, [
    'kind', 'phase', 'unit', 'completed', 'total',
  ], [], 'archive progress')
  if (!QUALIFICATION_DIAGNOSTIC_PROGRESS_KINDS.has(value.kind)
    || !SAFE_TOKEN.test(value.phase ?? '')
    || !QUALIFICATION_DIAGNOSTIC_PROGRESS_UNITS.has(value.unit)
    || !qualificationSupervisorNonnegativeInteger(value.completed)
    || (value.total !== null && !qualificationSupervisorNonnegativeInteger(value.total))
    || value.total !== null && value.completed > value.total) {
    throw new Error('Qualification child archive progress is invalid.')
  }
}

/** Validates bounded durable-worker counters and its fixed failure vocabulary. */
function validateQualificationSupervisorDurableWorker(worker) {
  const value = exactQualificationSupervisorRecord(worker, [
    'queuedWrites', 'acknowledgedWrites', 'rejectedWrites', 'pendingWrites', 'busyRetries',
    'maxDurableLatencyMs', 'failureCode', 'exitCode', 'terminationRequested',
  ], [], 'durable worker')
  for (const field of [
    'queuedWrites', 'acknowledgedWrites', 'rejectedWrites', 'pendingWrites', 'busyRetries',
  ]) {
    if (!qualificationSupervisorNonnegativeInteger(value[field])) {
      throw new Error('Qualification child durable-worker counter is invalid.')
    }
  }
  if (!Number.isFinite(value.maxDurableLatencyMs) || value.maxDurableLatencyMs < 0
    || value.failureCode !== null && !QUALIFICATION_DURABLE_FAILURE_CODES.has(value.failureCode)
    || value.exitCode !== null && !qualificationSupervisorNonnegativeInteger(value.exitCode)
    || typeof value.terminationRequested !== 'boolean') {
    throw new Error('Qualification child durable-worker state is invalid.')
  }
}

/** Validates only the five known phase liveness summaries. */
function validateQualificationSupervisorContentionProbe(contentionProbe) {
  if (contentionProbe === null || typeof contentionProbe !== 'object'
    || Array.isArray(contentionProbe)
    || Object.keys(contentionProbe).some((phase) => !QUALIFICATION_DIAGNOSTIC_PHASES.has(phase))) {
    throw new Error('Qualification child contention diagnostic is invalid.')
  }
  for (const phase of Object.keys(contentionProbe)) {
    const value = exactQualificationSupervisorRecord(contentionProbe[phase], [
      'coordinatorHeartbeatMaxGapMs', 'syntheticPublicationMaxCadenceMs',
    ], [], 'contention phase')
    if (!Number.isFinite(value.coordinatorHeartbeatMaxGapMs)
      || value.coordinatorHeartbeatMaxGapMs < 0
      || !Number.isFinite(value.syntheticPublicationMaxCadenceMs)
      || value.syntheticPublicationMaxCadenceMs < 0) {
      throw new Error('Qualification child contention measurement is invalid.')
    }
  }
}

/** Validates a cleanup cursor shared by progress and failure diagnostics. */
function validateQualificationSupervisorCleanupCursor(cursor) {
  if (cursor === null) return
  const value = exactQualificationSupervisorRecord(cursor, [
    'tableName', 'tableIndex', 'tableCount', 'tableBatch', 'deletedRows', 'totalDeletedRows',
  ], [], 'cleanup cursor')
  if (!SAFE_TOKEN.test(value.tableName ?? '')) {
    throw new Error('Qualification child cleanup table is invalid.')
  }
  validateQualificationSupervisorNumericCleanupCursor(value)
}

/** Validates the common numeric cleanup-cursor contract. */
function validateQualificationSupervisorNumericCleanupCursor(cursor) {
  for (const field of [
    'tableIndex', 'tableCount', 'tableBatch', 'deletedRows', 'totalDeletedRows',
  ]) {
    if (!qualificationSupervisorNonnegativeInteger(cursor[field])) {
      throw new Error('Qualification child cleanup cursor is invalid.')
    }
  }
  if (cursor.tableIndex > cursor.tableCount || cursor.deletedRows > cursor.totalDeletedRows) {
    throw new Error('Qualification child cleanup cursor is inconsistent.')
  }
}

/** Validates the fixed normalized cleanup-failure projection. */
function validateQualificationSupervisorCleanupFailure(cleanupFailure) {
  const value = exactQualificationSupervisorRecord(cleanupFailure, [
    'substage', 'causeClass', 'tableName', 'cursor', 'workerExit',
  ], [], 'cleanup failure')
  if (!QUALIFICATION_CLEANUP_SUBSTAGES.has(value.substage)
    || !QUALIFICATION_CLEANUP_CAUSE_CLASSES.has(value.causeClass)
    || value.tableName !== null && !SAFE_TOKEN.test(value.tableName ?? '')) {
    throw new Error('Qualification child cleanup failure is invalid.')
  }
  if (value.cursor !== null) {
    const cursor = exactQualificationSupervisorRecord(value.cursor, [
      'tableIndex', 'tableCount', 'tableBatch', 'deletedRows', 'totalDeletedRows',
    ], [], 'cleanup failure cursor')
    validateQualificationSupervisorNumericCleanupCursor(cursor)
  }
  const workerExit = exactQualificationSupervisorRecord(value.workerExit, [
    'observed', 'event', 'code',
  ], [], 'cleanup worker exit')
  if (typeof workerExit.observed !== 'boolean'
    || !['none', 'message', 'error', 'exit'].includes(workerExit.event)
    || workerExit.code !== null && !qualificationSupervisorNonnegativeInteger(workerExit.code)) {
    throw new Error('Qualification child cleanup worker exit is invalid.')
  }
}

/** Validates the optional archive byte identity. */
function validateQualificationSupervisorArchiveIdentity(archiveIdentity) {
  if (archiveIdentity === null) return
  const value = exactQualificationSupervisorRecord(archiveIdentity, [
    'sha256', 'sizeBytes', 'registryStatus',
  ], [], 'archive identity')
  if (!/^[0-9a-f]{64}$/u.test(value.sha256 ?? '')
    || !qualificationSupervisorNonnegativeInteger(value.sizeBytes)
    || !SAFE_TOKEN.test(value.registryStatus ?? '')) {
    throw new Error('Qualification child archive identity is invalid.')
  }
}

/** Validates the optional bounded RSS sampler summary. */
function validateQualificationSupervisorRss(rss) {
  if (rss === null) return
  const value = exactQualificationSupervisorRecord(rss, [
    'peakProcessRssBytes', 'linuxVmHwmBytes', 'sampleCount',
  ], [], 'RSS evidence')
  if (!qualificationSupervisorNonnegativeInteger(value.peakProcessRssBytes)
    || !qualificationSupervisorNonnegativeInteger(value.linuxVmHwmBytes)
    || !qualificationSupervisorNonnegativeInteger(value.sampleCount)) {
    throw new Error('Qualification child RSS evidence is invalid.')
  }
}

/** Returns whether one diagnostic counter is a bounded non-negative integer. */
function qualificationSupervisorNonnegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0
}

/** Requires one exact top-level/cause pair produced by the child classifier. */
function qualificationSupervisorFailurePairIsValid(topLevelCode, causeCode) {
  return QUALIFICATION_FAILURE_TOP_LEVEL_CODES.has(topLevelCode)
    && QUALIFICATION_FAILURE_CAUSES_BY_TOP_LEVEL.get(topLevelCode)?.has(causeCode) === true
}

/** Reads one bounded mode-0600 regular artifact identity without following links. */
async function readQualificationSupervisorArtifactIdentity(candidatePath) {
  try {
    const identity = await lstat(candidatePath, { bigint: true })
    if (!identity.isFile() || identity.isSymbolicLink()
      || identity.size < 1n
      || identity.size > BigInt(QUALIFICATION_TERMINAL_ARTIFACT_LIMIT_BYTES)
      || (identity.mode & 0o777n) !== 0o600n) {
      throw new Error('Qualification supervisor artifact identity is unsafe or unbounded.')
    }
    return identity
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

/** Reads through a pinned descriptor and rejects every path/descriptor identity race. */
async function readQualificationSupervisorPinnedArtifact(candidatePath, expectedIdentity) {
  const handle = await open(
    candidatePath,
    fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0),
  )
  try {
    const before = await handle.stat({ bigint: true })
    if (!before.isFile() || before.isSymbolicLink()
      || before.dev !== expectedIdentity.dev || before.ino !== expectedIdentity.ino
      || before.size !== expectedIdentity.size || before.nlink !== expectedIdentity.nlink
      || (before.mode & 0o777n) !== 0o600n) {
      throw new Error('Qualification supervisor artifact changed before reading.')
    }
    const contents = await handle.readFile('utf8')
    const after = await handle.stat({ bigint: true })
    if (after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size
      || after.nlink !== before.nlink || (after.mode & 0o777n) !== 0o600n) {
      throw new Error('Qualification supervisor artifact changed while reading.')
    }
    return contents
  } finally {
    await handle.close()
  }
}

/** Requires one canonical output whose derived terminal names fit one path component. */
function assertQualificationSupervisorSourceBoundary(boundary) {
  const basename = path.basename(boundary?.evidencePath ?? '')
  const normalizedBasename = basename.toLowerCase()
  const basenameBytes = Buffer.byteLength(basename, 'utf8')
  if (boundary === null || typeof boundary !== 'object' || Array.isArray(boundary)
    || typeof boundary.evidencePath !== 'string'
    || !path.isAbsolute(boundary.evidencePath)
    || path.resolve(boundary.evidencePath) !== boundary.evidencePath
    || basenameBytes < 1
    || normalizedBasename === QUALIFICATION_CHILD_OWNER_FILE
    || normalizedBasename.endsWith(FAILURE_RECEIPT_SUFFIX)
    || normalizedBasename.startsWith('.')
      && normalizedBasename.endsWith(TERMINAL_OWNER_SUFFIX)
    || QUALIFICATION_PRIVATE_EVIDENCE_PREFIXES.some(
      (prefix) => normalizedBasename.startsWith(prefix),
    )
    || basenameBytes + Buffer.byteLength(FAILURE_RECEIPT_SUFFIX, 'utf8') > 255
    || basenameBytes + Buffer.byteLength(TERMINAL_OWNER_SUFFIX, 'utf8') + 1 > 255
    || /[\u0000-\u001f\u007f]/u.test(boundary.evidencePath)
    || !GIT_SHA.test(boundary.expectedRepositoryHead ?? '')
    || !GIT_SHA.test(boundary.expectedRepositoryTree ?? '')) {
    throw new Error('Qualification supervisor terminal boundary is invalid.')
  }
}

/** Requires the source boundary plus the unique parent-created run and runtime binding. */
function assertQualificationSupervisorBoundary(boundary, observedAtMs) {
  assertQualificationSupervisorSourceBoundary(boundary)
  const observation = qualificationSupervisorObservation(observedAtMs)
  if (!QUALIFICATION_RUN_ID.test(boundary.runId ?? '')
    || !qualificationSupervisorTimestampIsValid(boundary.startedAt)
    || Date.parse(boundary.startedAt) > observation.observedAtMs
    || !qualificationSupervisorRuntimeIsValid(boundary.runtime)) {
    throw new Error('Qualification supervisor run boundary is invalid.')
  }
}

/** Requires a random sibling child directory held only by this supervisor invocation. */
function assertQualificationSupervisorTerminalRun(terminalRun, observedAtMs) {
  assertQualificationSupervisorBoundary(terminalRun, observedAtMs)
  const childDirectory = path.dirname(terminalRun?.childEvidencePath ?? '')
  if (typeof terminalRun?.childEvidencePath !== 'string'
    || !path.isAbsolute(terminalRun.childEvidencePath)
    || path.resolve(terminalRun.childEvidencePath) !== terminalRun.childEvidencePath
    || path.dirname(childDirectory) !== path.dirname(terminalRun.evidencePath)
    || !QUALIFICATION_CHILD_DIRECTORY.test(path.basename(childDirectory))
    || path.basename(terminalRun.childEvidencePath) !== path.basename(terminalRun.evidencePath)) {
    throw new Error('Qualification supervisor terminal run is invalid.')
  }
}

/** Requires the caller's exit and source claims to match its immutable terminal run. */
function assertQualificationSupervisorTerminalRunMatches(input, observedAtMs) {
  assertQualificationSupervisorTerminalRun(input?.terminalRun, observedAtMs)
  if (input?.evidencePath !== input.terminalRun.evidencePath
    || input?.expectedRepositoryHead !== input.terminalRun.expectedRepositoryHead
    || input?.expectedRepositoryTree !== input.terminalRun.expectedRepositoryTree
    || (input?.childExitCode !== null
      && (!Number.isSafeInteger(input?.childExitCode)
        || input.childExitCode < 0 || input.childExitCode > 255))) {
    throw new Error('Qualification supervisor terminal run does not match the exact source.')
  }
}

/** Requires a canonical real directory and, when requested, one exact permission mode. */
async function assertQualificationSupervisorDirectorySafe(directory, acceptedModes = null) {
  const identity = await lstat(directory)
  if (!identity.isDirectory() || identity.isSymbolicLink()
    || acceptedModes !== null && !acceptedModes.has(identity.mode & 0o777)
    || await realpath(directory) !== directory) {
    throw new Error('Qualification supervisor directory is unsafe.')
  }
}

/** Returns the owner, success, and sibling failure names for one terminal boundary. */
function qualificationSupervisorTerminalPaths(evidencePath) {
  return Object.freeze({
    ownerPath: path.join(
      path.dirname(evidencePath),
      `.${path.basename(evidencePath)}${TERMINAL_OWNER_SUFFIX}`,
    ),
    successPath: evidencePath,
    failurePath: `${evidencePath}${FAILURE_RECEIPT_SUFFIX}`,
  })
}

/** Flushes owner, canonical-name, staging, and cleanup directory mutations. */
async function syncQualificationSupervisorDirectory(directory) {
  const handle = await open(directory, fsConstants.O_RDONLY)
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

/** Requires an exact record with no missing or surplus fields. */
function exactQualificationSupervisorRecord(value, required, optional, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Qualification supervisor ${label} is invalid.`)
  }
  const allowed = new Set([...required, ...optional])
  const keys = Object.keys(value)
  if (required.some((key) => !Object.hasOwn(value, key))
    || keys.some((key) => !allowed.has(key))) {
    throw new Error(`Qualification supervisor ${label} fields are invalid.`)
  }
  return value
}

/** Accepts only bounded canonical UTC timestamps. */
function qualificationSupervisorTimestampIsValid(value) {
  if (typeof value !== 'string' || value.length > 40) return false
  try {
    return new Date(value).toISOString() === value
  } catch {
    return false
  }
}

/** Captures or validates one immutable parent wall-clock observation. */
function qualificationSupervisorObservation(observedAtMs = Date.now()) {
  if (!Number.isSafeInteger(observedAtMs) || observedAtMs < 0) {
    throw new Error('Qualification supervisor observation time is invalid.')
  }
  let observedAt
  try {
    observedAt = new Date(observedAtMs).toISOString()
  } catch {
    throw new Error('Qualification supervisor observation time is invalid.')
  }
  return Object.freeze({ observedAtMs, observedAt })
}

/** Requires one exact, bounded runtime snapshot suitable for cross-process comparison. */
function qualificationSupervisorRuntimeIsValid(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  try {
    exactQualificationSupervisorRecord(
      value,
      QUALIFICATION_RUNTIME_FIELDS,
      [],
      'runtime identity',
    )
  } catch {
    return false
  }
  return typeof value.hostname === 'string'
    && value.hostname.length > 0
    && Buffer.byteLength(value.hostname, 'utf8') <= 255
    && typeof value.platform === 'string'
    && value.platform.length > 0
    && Buffer.byteLength(value.platform, 'utf8') <= 32
    && typeof value.release === 'string'
    && value.release.length > 0
    && Buffer.byteLength(value.release, 'utf8') <= 255
    && typeof value.architecture === 'string'
    && value.architecture.length > 0
    && Buffer.byteLength(value.architecture, 'utf8') <= 64
    && Number.isSafeInteger(value.cpuCount)
    && value.cpuCount > 0
    && Number.isSafeInteger(value.totalMemoryBytes)
    && value.totalMemoryBytes > 0
    && typeof value.nodeVersion === 'string'
    && value.nodeVersion.length > 0
    && Buffer.byteLength(value.nodeVersion, 'utf8') <= 64
}

/** Freezes a validated runtime copy so callers cannot alter a terminal binding in flight. */
function freezeQualificationSupervisorRuntime(value) {
  if (!qualificationSupervisorRuntimeIsValid(value)) {
    throw new Error('Qualification supervisor runtime identity is invalid.')
  }
  return Object.freeze(Object.fromEntries(
    QUALIFICATION_RUNTIME_FIELDS.map((field) => [field, value[field]]),
  ))
}

/** Requires byte-for-byte equality across the fixed runtime record. */
function qualificationSupervisorRuntimeMatches(actual, expected) {
  return qualificationSupervisorRuntimeIsValid(actual)
    && qualificationSupervisorRuntimeIsValid(expected)
    && QUALIFICATION_RUNTIME_FIELDS.every((field) => actual[field] === expected[field])
}

/** Rejects private keys, absolute paths, or an unexpected fallback schema. */
function assertQualificationSupervisorFailureReceiptSafe(receipt) {
  if (receipt === null || typeof receipt !== 'object' || Array.isArray(receipt)
    || receipt.schema !== FAILURE_RECEIPT_SCHEMA) {
    throw new Error('Qualification supervisor failure receipt schema is invalid.')
  }
  const forbiddenKeys = new Set([
    'message', 'stack', 'passphrase', 'recoveryCode', 'fixturePath', 'evidencePath',
    'profileRoot', 'missionId', 'deviceId', 'privatePath', 'databasePath', 'snapshotPath',
    'sourcePath', 'targetPath',
  ])
  const visit = (value) => {
    if (value === null || typeof value !== 'object') {
      if (typeof value === 'string'
        && (QUALIFICATION_ABSOLUTE_PATH.test(value)
          || QUALIFICATION_RELATIVE_PATH.test(value))) {
        throw new Error('Qualification supervisor failure receipt contains an absolute path.')
      }
      return
    }
    if (Array.isArray(value)) {
      value.forEach(visit)
      return
    }
    for (const [key, child] of Object.entries(value)) {
      if (forbiddenKeys.has(key)) {
        throw new Error('Qualification supervisor failure receipt contains private fields.')
      }
      visit(child)
    }
  }
  visit(receipt)
}
