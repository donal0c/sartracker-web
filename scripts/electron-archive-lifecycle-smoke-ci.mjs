#!/usr/bin/env node

import { execFile, spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import {
  access,
  chmod,
  link,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rm,
  unlink,
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { isDeepStrictEqual, promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

import {
  buildArchiveLifecycleSmokeCiEnvironment,
  buildArchiveLifecycleSmokeCiRunnerArgs,
  validateArchiveLifecycleSmokeEvidence,
} from '../build/electron-archive-lifecycle-smoke-lib.js'

const require = createRequire(import.meta.url)
const { normalizeCleanupFailureDiagnostic } = require('../electron/archive-cleanup-failure.cjs')
const execFileAsync = promisify(execFile)
const scriptFile = fileURLToPath(import.meta.url)
const projectRoot = path.resolve(path.dirname(scriptFile), '..')
const ARCHIVE_LIFECYCLE_CHILD_DEADLINE_MS = 30 * 60_000
const ARCHIVE_LIFECYCLE_CHILD_REAP_DEADLINE_MS = 5_000
const ARCHIVE_LIFECYCLE_GROUP_REAP_POLL_MS = 10
const ARCHIVE_LIFECYCLE_CHILD_START_DEADLINE_MS = 60_000
const ARCHIVE_LIFECYCLE_EVIDENCE_DIR = path.join(
  projectRoot,
  'tmp',
  'breadcrumb-pr6-packaged-archive-smoke',
)
const ARCHIVE_LIFECYCLE_SUCCESS_FILE = 'electron-archive-lifecycle-smoke-report.json'
const ARCHIVE_LIFECYCLE_FAILURE_FILE = 'electron-archive-lifecycle-smoke-failure.json'
const ARCHIVE_LIFECYCLE_OWNER_FILE = '.electron-archive-lifecycle-terminal-owner.json'
const ARCHIVE_LIFECYCLE_RUN_OWNER_PREFIX =
  '.electron-archive-lifecycle-terminal-run-owner-'
const ARCHIVE_LIFECYCLE_CHILD_EVIDENCE_PREFIX =
  '.breadcrumb-pr6-packaged-archive-smoke-child-'
const ARCHIVE_LIFECYCLE_LEASE_PREFIX =
  '.breadcrumb-pr6-packaged-archive-smoke-lease-'
const ARCHIVE_LIFECYCLE_PREPARE_GATE_PREFIX =
  '.breadcrumb-pr6-packaged-archive-smoke-prepare-'
const ARCHIVE_LIFECYCLE_LEASE_OWNER_FILE = 'active-owner.json'
const ARCHIVE_LIFECYCLE_LEASE_CONSUMED_FILE = 'consumed-terminal.json'
const ARCHIVE_LIFECYCLE_ARTIFACT_LIMIT_BYTES = 4 * 1024 * 1024
const ARCHIVE_LIFECYCLE_LEASE_RECORD_LIMIT_BYTES = 8_000
const ARCHIVE_LIFECYCLE_SUPERVISOR_RECEIPT_LIMIT_BYTES = 8_000
const ARCHIVE_LIFECYCLE_CHILD_TIMEOUT = 'archive_lifecycle_child_timeout'
const ARCHIVE_LIFECYCLE_CHILD_UNREPORTED = 'archive_lifecycle_child_unreported_failure'
const ARCHIVE_LIFECYCLE_SUPERVISOR_FAILURES = new Set([
  ARCHIVE_LIFECYCLE_CHILD_TIMEOUT,
  ARCHIVE_LIFECYCLE_CHILD_UNREPORTED,
])
const ARCHIVE_LIFECYCLE_CHILD_FAILURES = new Set([
  'cleanup_failure',
  'evidence_validation_failure',
  'evidence_validation_metadata_failure',
  'external_liveness_gate_failure',
  'lifecycle_failure',
  'workload_timeout',
])
const ARCHIVE_LIFECYCLE_CLEANUP_FAILURES = new Set([
  'cleanup_failure',
  'external_liveness_gate_failure',
  'workload_timeout',
])
const ARCHIVE_LIFECYCLE_DIAGNOSTIC_KEYS = new Set([
  'activeLaunchNumber',
  'activePhase',
  'auditedAtMs',
  'cleanup',
  'create',
  'currentFixContinuity',
  'currentFixMaxGapMs',
  'currentFixTimeout',
  'causeClass',
  'emittedAtMs',
  'endedAtMs',
  'errorKinds',
  'freshSampleCount',
  'gapMs',
  'gapType',
  'intervalStartedAtMs',
  'invalidRendererFrame',
  'kind',
  'latestAcknowledgedSequence',
  'latestEmittedAtMs',
  'latestReceivedSequence',
  'latestRequestAgeMs',
  'latestRequestStartedAtMs',
  'latestSourceAgeMs',
  'mainSampleCount',
  'mainWatchdogMaxGapMs',
  'operationCount',
  'operationOverflowCount',
  'operations',
  'oldestPendingRequestAgeMs',
  'oldestPendingSourceAgeMs',
  'pendingCount',
  'phase',
  'phaseMetrics',
  'phaseSampleCountAtStart',
  'phaseSampleDelta',
  'previousObservedAtMs',
  'rendererFrameMaxGapMs',
  'rendererFrameSampleCount',
  'rendererCdpFailure',
  'rendererCurrentFixMonotonicTail',
  'requestAgeMs',
  'requestStartedAtMs',
  'requestToRendererMaxMs',
  'restore',
  'sampleCount',
  'sourceAgeMs',
  'sourceCadence',
  'startSourceSequence',
  'sourceToRendererMaxMs',
  'startedAtMs',
  'stage',
  'endSourceSequence',
  'verify',
])
const ARCHIVE_LIFECYCLE_FAILURE_MESSAGE_LIMIT = 400
const ARCHIVE_LIFECYCLE_CLEANUP_FAILURE_LIMIT = 9
const ARCHIVE_LIFECYCLE_CLOSED_GATE_REASON_LIMIT = 16
const ARCHIVE_LIFECYCLE_DIAGNOSTIC_ARRAY_LIMIT = 16
const ARCHIVE_LIFECYCLE_DIAGNOSTIC_ENTRY_LIMIT = 96
const ARCHIVE_LIFECYCLE_DIAGNOSTIC_DEPTH_LIMIT = 5
const ARCHIVE_LIFECYCLE_CLEANUP_STEP = /^[a-z][a-z0-9_]{0,47}$/u
const ARCHIVE_LIFECYCLE_PLATFORMS = new Set(['darwin', 'linux'])
const ARCHIVE_LIFECYCLE_ARCHITECTURES = new Set(['arm64', 'x64'])
const ARCHIVE_LIFECYCLE_ABSOLUTE_PATH =
  /(?:^|[^A-Za-z0-9_\\/])(?:[A-Za-z]:[\\/]|[\\/]+)[^\r\n]*/u
const ARCHIVE_LIFECYCLE_RELATIVE_PATH =
  /(?:^|[\s"'`([{])(?:~[\\/]|\.{1,2}[\\/])[^\r\n]*/u
const GIT_SHA = /^[0-9a-f]{40}$/u
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u

/** Binds the exclusive child-staging name to one canonical evidence boundary. */
function archiveLifecycleSupervisorChildEvidenceDirectory(evidenceDir) {
  const boundary = archiveLifecycleSupervisorBoundaryToken(evidenceDir)
  return path.join(
    path.dirname(evidenceDir),
    `${ARCHIVE_LIFECYCLE_CHILD_EVIDENCE_PREFIX}${boundary}`,
  )
}

/** Returns one stable non-secret token for sibling ownership boundaries. */
function archiveLifecycleSupervisorBoundaryToken(evidenceDir) {
  return createHash('sha256').update(evidenceDir, 'utf8').digest('hex').slice(0, 24)
}

/** Returns the durable supervisor lease directory for one canonical evidence boundary. */
function archiveLifecycleSupervisorLeaseDirectory(evidenceDir) {
  return path.join(
    path.dirname(evidenceDir),
    `${ARCHIVE_LIFECYCLE_LEASE_PREFIX}${archiveLifecycleSupervisorBoundaryToken(evidenceDir)}`,
  )
}

/** Returns the short-lived atomic preparation gate for one evidence boundary. */
function archiveLifecycleSupervisorPrepareGateDirectory(evidenceDir) {
  return path.join(
    path.dirname(evidenceDir),
    `${ARCHIVE_LIFECYCLE_PREPARE_GATE_PREFIX}${archiveLifecycleSupervisorBoundaryToken(evidenceDir)}`,
  )
}

/** Pins one private child-staging directory for the lifetime of a supervisor run. */
async function pinArchiveLifecycleChildEvidenceDirectory(childEvidenceDir) {
  const identity = await lstat(childEvidenceDir)
  const realPath = await realpath(childEvidenceDir)
  if (!identity.isDirectory() || identity.isSymbolicLink()
    || (identity.mode & 0o777) !== 0o700 || realPath !== childEvidenceDir) {
    throw new Error('Archive lifecycle child evidence directory is unsafe.')
  }
  return Object.freeze({ dev: identity.dev, ino: identity.ino, realPath })
}

/** Requires private child staging to retain its parent-pinned inode. */
async function assertArchiveLifecycleChildEvidenceDirectory(terminalRun) {
  const observed = await pinArchiveLifecycleChildEvidenceDirectory(terminalRun.childEvidenceDir)
  if (observed.dev !== terminalRun.childEvidenceIdentity.dev
    || observed.ino !== terminalRun.childEvidenceIdentity.ino
    || observed.realPath !== terminalRun.childEvidenceIdentity.realPath) {
    throw new Error('Archive lifecycle child evidence directory changed identity.')
  }
}

/** Refuses pre-lock staging from the older unbound random-directory scheme. */
async function assertNoLegacyArchiveLifecycleChildEvidence(evidenceDir) {
  const parent = path.dirname(evidenceDir)
  const entries = await readdir(parent, { withFileTypes: true })
  const legacy = entries.find((entry) => entry.name.startsWith(
    ARCHIVE_LIFECYCLE_CHILD_EVIDENCE_PREFIX,
  ) && UUID_V4.test(entry.name.slice(ARCHIVE_LIFECYCLE_CHILD_EVIDENCE_PREFIX.length)))
  if (legacy !== undefined) {
    throw new Error('Archive lifecycle child staging from a prior run is unresolved.')
  }
}

/** Pins one exact private directory without following a symbolic-link boundary. */
async function pinArchiveLifecycleSupervisorPrivateDirectory(directory, label) {
  const identity = await lstat(directory)
  const realPath = await realpath(directory)
  if (!identity.isDirectory() || identity.isSymbolicLink()
    || (identity.mode & 0o777) !== 0o700 || realPath !== directory
    || !Number.isSafeInteger(identity.dev) || !Number.isSafeInteger(identity.ino)) {
    throw new Error(`Archive lifecycle ${label} directory is unsafe.`)
  }
  return Object.freeze({ dev: identity.dev, ino: identity.ino, realPath })
}

/** Requires a private directory to retain one parent-pinned identity. */
async function assertArchiveLifecycleSupervisorPrivateDirectory(
  directory,
  expectedIdentity,
  label,
) {
  const observed = await pinArchiveLifecycleSupervisorPrivateDirectory(directory, label)
  if (observed.dev !== expectedIdentity.dev || observed.ino !== expectedIdentity.ino
    || observed.realPath !== expectedIdentity.realPath) {
    throw new Error(`Archive lifecycle ${label} directory changed identity.`)
  }
}

/** Requires the canonical evidence directory to retain its prepared inode. */
async function assertArchiveLifecycleSupervisorEvidenceDirectory(terminalRun) {
  await assertArchiveLifecycleSupervisorPrivateDirectory(
    terminalRun.evidenceDir,
    terminalRun.evidenceIdentity,
    'canonical evidence',
  )
}

/** Requires the independent supervisor lease to remain live and unchanged. */
async function assertArchiveLifecycleSupervisorLeaseDirectory(terminalRun) {
  await assertArchiveLifecycleSupervisorPrivateDirectory(
    terminalRun.leaseDir,
    terminalRun.leaseIdentity,
    'supervisor lease',
  )
}

/** Returns the two immutable records retained inside one supervisor lease. */
function archiveLifecycleSupervisorLeaseRecordPaths(leaseDir) {
  return Object.freeze({
    activePath: path.join(leaseDir, ARCHIVE_LIFECYCLE_LEASE_OWNER_FILE),
    consumedPath: path.join(leaseDir, ARCHIVE_LIFECYCLE_LEASE_CONSUMED_FILE),
  })
}

/** Durably creates one immutable, bounded lease record without replacing a winner. */
async function writeArchiveLifecycleSupervisorLeaseRecord(recordPath, record) {
  const contents = `${JSON.stringify(record, null, 2)}\n`
  if (Buffer.byteLength(contents, 'utf8') < 1
    || Buffer.byteLength(contents, 'utf8') > ARCHIVE_LIFECYCLE_LEASE_RECORD_LIMIT_BYTES) {
    throw new Error('Archive lifecycle supervisor lease record is unbounded.')
  }
  const temporaryPath = path.join(
    path.dirname(recordPath),
    `.${path.basename(recordPath)}.${process.pid}.${randomUUID()}.tmp`,
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
    await link(temporaryPath, recordPath)
    await syncArchiveLifecycleSupervisorDirectory(path.dirname(recordPath))
    await unlink(temporaryPath)
    temporaryPresent = false
    await syncArchiveLifecycleSupervisorDirectory(path.dirname(recordPath))
  } finally {
    await handle?.close().catch(() => undefined)
    if (temporaryPresent) {
      await unlink(temporaryPath).catch((error) => {
        if (error?.code !== 'ENOENT') throw error
      })
      await syncArchiveLifecycleSupervisorDirectory(path.dirname(recordPath))
    }
  }
  return contents
}

/** Reads one immutable mode-0600 lease record through a pinned descriptor. */
async function readArchiveLifecycleSupervisorLeaseRecord(recordPath, required) {
  const identity = await readArchiveLifecycleSupervisorArtifactIdentity(recordPath)
  if (identity === null) {
    if (!required) return null
    throw new Error('Archive lifecycle supervisor lease owner metadata is missing.')
  }
  if (identity.nlink !== 1
    || identity.size > ARCHIVE_LIFECYCLE_LEASE_RECORD_LIMIT_BYTES) {
    throw new Error('Archive lifecycle supervisor lease metadata has unsafe links or size.')
  }
  const contents = await readArchiveLifecycleSupervisorPinnedArtifact(recordPath, identity)
  let record
  try {
    record = JSON.parse(contents)
  } catch {
    throw new Error('Archive lifecycle supervisor lease metadata is invalid JSON.')
  }
  return Object.freeze({ contents, identity, record })
}

/** Builds the immutable active-owner record written before the child can start. */
function createArchiveLifecycleSupervisorActiveLeaseRecord(terminalRun) {
  return Object.freeze({
    schemaVersion: 1,
    recordKind: 'archive-lifecycle-supervisor-active-owner-v1',
    runId: terminalRun.runId,
    ownerPid: process.pid,
    ownerHostname: os.hostname(),
    startedAtMs: terminalRun.startedAtMs,
    expectedHead: terminalRun.expectedHead,
    expectedTree: terminalRun.expectedTree,
    observedHead: terminalRun.observedHead,
    observedTree: terminalRun.observedTree,
    worktreeClean: terminalRun.worktreeClean,
    childEvidenceDev: terminalRun.childEvidenceIdentity.dev,
    childEvidenceIno: terminalRun.childEvidenceIdentity.ino,
    evidenceDev: terminalRun.evidenceIdentity.dev,
    evidenceIno: terminalRun.evidenceIdentity.ino,
    evidenceRealPath: terminalRun.evidenceIdentity.realPath,
  })
}

/** Validates the exact immutable active-owner lease schema. */
function validateArchiveLifecycleSupervisorActiveLeaseRecord(record, evidenceDir) {
  const active = exactArchiveLifecycleSupervisorRecord(record, [
    'schemaVersion',
    'recordKind',
    'runId',
    'ownerPid',
    'ownerHostname',
    'startedAtMs',
    'expectedHead',
    'expectedTree',
    'observedHead',
    'observedTree',
    'worktreeClean',
    'childEvidenceDev',
    'childEvidenceIno',
    'evidenceDev',
    'evidenceIno',
    'evidenceRealPath',
  ], [], 'active lease owner')
  if (active.schemaVersion !== 1
    || active.recordKind !== 'archive-lifecycle-supervisor-active-owner-v1'
    || !UUID_V4.test(active.runId ?? '')
    || !Number.isSafeInteger(active.ownerPid) || active.ownerPid < 1
    || typeof active.ownerHostname !== 'string' || active.ownerHostname.length < 1
    || Buffer.byteLength(active.ownerHostname, 'utf8') > 255
    || /[\u0000-\u001f\u007f]/u.test(active.ownerHostname)
    || !Number.isSafeInteger(active.startedAtMs) || active.startedAtMs < 0
    || !GIT_SHA.test(active.expectedHead ?? '')
    || !GIT_SHA.test(active.expectedTree ?? '')
    || (active.observedHead !== null && !GIT_SHA.test(active.observedHead ?? ''))
    || (active.observedTree !== null && !GIT_SHA.test(active.observedTree ?? ''))
    || (active.observedHead === null) !== (active.observedTree === null)
    || typeof active.worktreeClean !== 'boolean'
    || active.observedHead === null && active.worktreeClean !== false
    || !Number.isSafeInteger(active.childEvidenceDev)
    || !Number.isSafeInteger(active.childEvidenceIno)
    || !Number.isSafeInteger(active.evidenceDev)
    || !Number.isSafeInteger(active.evidenceIno)
    || active.evidenceRealPath !== evidenceDir) {
    throw new Error('Archive lifecycle supervisor active lease owner is invalid.')
  }
  return active
}

/** Validates the immutable terminal-consumption record. */
function validateArchiveLifecycleSupervisorConsumedLeaseRecord(record, active) {
  const consumed = exactArchiveLifecycleSupervisorRecord(record, [
    'schemaVersion',
    'recordKind',
    'runId',
    'expectedHead',
    'consumedAtMs',
    'terminalKind',
    'terminalSha256',
    'terminalDev',
    'terminalIno',
    'terminalSize',
  ], [], 'consumed lease terminal')
  if (consumed.schemaVersion !== 1
    || consumed.recordKind !== 'archive-lifecycle-supervisor-consumed-terminal-v1'
    || consumed.runId !== active.runId
    || consumed.expectedHead !== active.expectedHead
    || !Number.isSafeInteger(consumed.consumedAtMs)
    || consumed.consumedAtMs < active.startedAtMs
    || !['success', 'failure'].includes(consumed.terminalKind)
    || !/^[0-9a-f]{64}$/u.test(consumed.terminalSha256 ?? '')
    || !Number.isSafeInteger(consumed.terminalDev)
    || !Number.isSafeInteger(consumed.terminalIno)
    || !Number.isSafeInteger(consumed.terminalSize) || consumed.terminalSize < 1
    || consumed.terminalSize > ARCHIVE_LIFECYCLE_ARTIFACT_LIMIT_BYTES) {
    throw new Error('Archive lifecycle supervisor consumed lease terminal is invalid.')
  }
  return consumed
}

/** Compares the immutable terminal binding while allowing its first-consumer timestamp to persist. */
function sameArchiveLifecycleSupervisorConsumedTerminalBinding(left, right) {
  return left.schemaVersion === right.schemaVersion
    && left.recordKind === right.recordKind
    && left.runId === right.runId
    && left.expectedHead === right.expectedHead
    && left.terminalKind === right.terminalKind
    && left.terminalSha256 === right.terminalSha256
    && left.terminalDev === right.terminalDev
    && left.terminalIno === right.terminalIno
    && left.terminalSize === right.terminalSize
}

/** Reads and validates the immutable active and optional consumed lease records. */
async function readArchiveLifecycleSupervisorLeaseState(evidenceDir, leaseIdentity) {
  const leaseDir = archiveLifecycleSupervisorLeaseDirectory(evidenceDir)
  await assertArchiveLifecycleSupervisorPrivateDirectory(
    leaseDir,
    leaseIdentity,
    'supervisor lease',
  )
  const paths = archiveLifecycleSupervisorLeaseRecordPaths(leaseDir)
  const activeEntry = await readArchiveLifecycleSupervisorLeaseRecord(paths.activePath, true)
  const active = validateArchiveLifecycleSupervisorActiveLeaseRecord(
    activeEntry.record,
    evidenceDir,
  )
  const consumedEntry = await readArchiveLifecycleSupervisorLeaseRecord(paths.consumedPath, false)
  const consumed = consumedEntry === null
    ? null
    : validateArchiveLifecycleSupervisorConsumedLeaseRecord(consumedEntry.record, active)
  await assertArchiveLifecycleSupervisorPrivateDirectory(
    leaseDir,
    leaseIdentity,
    'supervisor lease',
  )
  return Object.freeze({ active, consumed })
}

/** Requires a live operation to belong to the lease's exact immutable active owner. */
async function assertArchiveLifecycleSupervisorActiveLeaseOwner(terminalRun) {
  const state = await readArchiveLifecycleSupervisorLeaseState(
    terminalRun.evidenceDir,
    terminalRun.leaseIdentity,
  )
  if (!isDeepStrictEqual(
    state.active,
    createArchiveLifecycleSupervisorActiveLeaseRecord(terminalRun),
  )) {
    throw new Error(
      'Archive lifecycle terminal run does not match the immutable active lease owner.',
    )
  }
  return state
}

/** Treats inaccessible or foreign owners as live so lease reclamation fails closed. */
function archiveLifecycleSupervisorProcessIsAlive(pid, hostname) {
  if (hostname !== os.hostname()) return true
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code !== 'ESRCH'
  }
}

/** Reconstructs the exact prior-run boundary retained by immutable lease metadata. */
function archiveLifecycleSupervisorTerminalRunFromLease(
  evidenceDir,
  leaseIdentity,
  active,
) {
  const childEvidenceDir = archiveLifecycleSupervisorChildEvidenceDirectory(evidenceDir)
  return Object.freeze({
    evidenceDir,
    evidenceIdentity: Object.freeze({
      dev: active.evidenceDev,
      ino: active.evidenceIno,
      realPath: active.evidenceRealPath,
    }),
    leaseDir: archiveLifecycleSupervisorLeaseDirectory(evidenceDir),
    leaseIdentity,
    childEvidenceDir,
    childEvidenceIdentity: Object.freeze({
      dev: active.childEvidenceDev,
      ino: active.childEvidenceIno,
      realPath: childEvidenceDir,
    }),
    runId: active.runId,
    expectedHead: active.expectedHead,
    expectedTree: active.expectedTree,
    observedHead: active.observedHead,
    observedTree: active.observedTree,
    worktreeClean: active.worktreeClean,
    startedAtMs: active.startedAtMs,
  })
}

/** Proves a consumed prior terminal before a different source may reclaim its lease. */
async function validateArchiveLifecycleSupervisorConsumedTerminal(
  evidenceDir,
  leaseIdentity,
  state,
) {
  if (state.consumed === null) {
    throw new Error('Archive lifecycle supervisor lease is active and unresolved.')
  }
  const terminalRun = archiveLifecycleSupervisorTerminalRunFromLease(
    evidenceDir,
    leaseIdentity,
    state.active,
  )
  const observedAtMs = observeArchiveLifecycleSupervisorTime(
    Date.now,
    terminalRun.startedAtMs,
  )
  const terminal = await readArchiveLifecycleCanonicalTerminalArtifact(
    terminalRun,
    { observedAtMs, recoverSuccess: true, requireExactActiveOwner: false },
  )
  if (terminal.kind !== state.consumed.terminalKind || terminal.path === null) {
    throw new Error('Archive lifecycle consumed lease does not retain its terminal verdict.')
  }
  const identity = await readArchiveLifecycleSupervisorArtifactIdentity(terminal.path)
  if (identity === null || identity.dev !== state.consumed.terminalDev
    || identity.ino !== state.consumed.terminalIno
    || identity.size !== state.consumed.terminalSize) {
    throw new Error('Archive lifecycle consumed lease terminal identity changed.')
  }
  const contents = await readArchiveLifecycleSupervisorPinnedArtifact(terminal.path, identity)
  const digest = createHash('sha256').update(contents, 'utf8').digest('hex')
  if (digest !== state.consumed.terminalSha256) {
    throw new Error('Archive lifecycle consumed lease terminal contents changed.')
  }
  await assertArchiveLifecycleSupervisorEvidenceDirectory(terminalRun)
}

/** Reclaims only a dead, consumed, different-head lease under the preparation gate. */
async function reconcileArchiveLifecycleSupervisorLease(
  evidenceDir,
  requestedHead,
  dependencies,
) {
  const leaseDir = archiveLifecycleSupervisorLeaseDirectory(evidenceDir)
  const existing = await lstat(leaseDir).catch((error) => {
    if (error?.code === 'ENOENT') return null
    throw error
  })
  if (existing === null) return
  const leaseIdentity = await pinArchiveLifecycleSupervisorPrivateDirectory(
    leaseDir,
    'supervisor lease',
  )
  const state = await readArchiveLifecycleSupervisorLeaseState(evidenceDir, leaseIdentity)
  const isProcessAlive = dependencies.isSupervisorProcessAlive
    ?? archiveLifecycleSupervisorProcessIsAlive
  const ownerAlive = await Promise.resolve().then(
    () => isProcessAlive(state.active.ownerPid, state.active.ownerHostname),
  ).catch(() => true)
  if (typeof ownerAlive !== 'boolean' || ownerAlive) {
    throw new Error('Archive lifecycle supervisor lease belongs to an active owner.')
  }
  if (state.consumed === null) {
    throw new Error('Archive lifecycle supervisor lease is active and unresolved.')
  }
  if (state.active.expectedHead === requestedHead) {
    throw new Error('Archive lifecycle supervisor refuses an unchanged same-head rerun.')
  }
  const childEvidence = await lstat(
    archiveLifecycleSupervisorChildEvidenceDirectory(evidenceDir),
  ).catch((error) => {
    if (error?.code === 'ENOENT') return null
    throw error
  })
  if (childEvidence !== null) {
    throw new Error('Archive lifecycle consumed lease retains unresolved child staging.')
  }
  await validateArchiveLifecycleSupervisorConsumedTerminal(
    evidenceDir,
    leaseIdentity,
    state,
  )
  await assertArchiveLifecycleSupervisorPrivateDirectory(
    leaseDir,
    leaseIdentity,
    'supervisor lease',
  )
  await rm(leaseDir, { recursive: true, force: false })
  await syncArchiveLifecycleSupervisorDirectory(path.dirname(leaseDir))
}

/** Acquires the short-lived preparation gate that serializes lease reclamation. */
async function acquireArchiveLifecycleSupervisorPrepareGate(evidenceDir) {
  const gateDir = archiveLifecycleSupervisorPrepareGateDirectory(evidenceDir)
  try {
    await mkdir(gateDir, { mode: 0o700 })
  } catch (error) {
    if (error?.code === 'EEXIST') {
      throw new Error('Archive lifecycle supervisor preparation is already active or unresolved.')
    }
    throw error
  }
  await chmod(gateDir, 0o700)
  const identity = await pinArchiveLifecycleSupervisorPrivateDirectory(
    gateDir,
    'preparation gate',
  )
  await syncArchiveLifecycleSupervisorDirectory(path.dirname(gateDir))
  return Object.freeze({ gateDir, identity })
}

/** Releases only the exact preparation gate acquired by this invocation. */
async function releaseArchiveLifecycleSupervisorPrepareGate(gate) {
  await assertArchiveLifecycleSupervisorPrivateDirectory(
    gate.gateDir,
    gate.identity,
    'preparation gate',
  )
  await rm(gate.gateDir, { recursive: true, force: false })
  await syncArchiveLifecycleSupervisorDirectory(path.dirname(gate.gateDir))
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === scriptFile) {
  main().catch((error) => {
    console.error(
      `electron-archive-lifecycle-smoke-ci: ${error instanceof Error ? error.message : String(error)}`,
    )
    process.exitCode = 1
  })
}

/** Finds the unpacked executable and runs the exact-head packaged lifecycle proof. */
async function main() {
  const appPath = await findPackagedExecutable()
  const expectedHead = await readExactHead()
  const source = await readExactSourceIdentity(expectedHead)
  const startedAtMs = Date.now()
  const terminalRun = await prepareArchiveLifecycleSupervisorTerminalRun({
    evidenceDir: ARCHIVE_LIFECYCLE_EVIDENCE_DIR,
    protectedPaths: [appPath, projectRoot],
    source,
    startedAtMs,
  })
  const runnerArgs = buildArchiveLifecycleSmokeCiRunnerArgs({
    appPath,
    evidenceDir: terminalRun.childEvidenceDir,
    expectedHead,
    platform: process.platform,
    preparedEvidence: true,
    projectRoot,
  })
  const command = process.platform === 'linux' && !process.env.DISPLAY
    ? 'xvfb-run'
    : process.execPath
  const args = command === 'xvfb-run'
    ? ['-a', process.execPath, ...runnerArgs]
    : runnerArgs
  const environment = buildArchiveLifecycleSmokeCiEnvironment({
    environment: process.env,
    platform: process.platform,
  })
  let exitCode = null
  let childFailure = null
  let childCreated = false
  let childSettled = false
  let failureClassification = ARCHIVE_LIFECYCLE_CHILD_UNREPORTED
  try {
    const child = spawn(command, args, {
      cwd: projectRoot,
      stdio: 'inherit',
      env: environment,
      detached: process.platform !== 'win32',
    })
    childCreated = true
    exitCode = await waitForArchiveLifecycleChildExit(child)
    childSettled = true
  } catch (error) {
    childFailure = error
    childSettled = !childCreated || error?.archiveLifecycleChildSettled === true
    if (error?.archiveLifecycleSupervisorClassification === ARCHIVE_LIFECYCLE_CHILD_TIMEOUT) {
      failureClassification = ARCHIVE_LIFECYCLE_CHILD_TIMEOUT
    }
  }
  const terminal = await ensureArchiveLifecycleSupervisorTerminalArtifact({
    childExitCode: exitCode,
    childSettled,
    evidenceDir: ARCHIVE_LIFECYCLE_EVIDENCE_DIR,
    failureClassification,
    source,
    startedAtMs,
    terminalRun,
  })
  if (terminal.kind !== 'success') {
    await consumeArchiveLifecycleSupervisorTerminalArtifact({ terminal, terminalRun })
    if (childFailure !== null) throw childFailure
    if (exitCode !== 0) {
      throw new Error(`CI packaged archive-lifecycle smoke exited with code ${exitCode}.`)
    }
    throw new Error('CI packaged archive-lifecycle smoke did not publish success evidence.')
  }
  if (childFailure !== null) throw childFailure
  if (exitCode !== 0) {
    throw new Error(`CI packaged archive-lifecycle smoke exited with code ${exitCode}.`)
  }
  await consumeArchiveLifecycleSupervisorTerminalArtifact({ terminal, terminalRun })
}

/** Waits for the outer CI child under a deadline independent of liveness sampling. */
export function waitForArchiveLifecycleChildExit(
  child,
  timeoutMs = ARCHIVE_LIFECYCLE_CHILD_DEADLINE_MS,
  dependencies = {},
) {
  if (child === null || typeof child !== 'object'
    || typeof child.once !== 'function' || typeof child.removeListener !== 'function'
    || typeof child.kill !== 'function') {
    throw new Error('CI packaged archive-lifecycle child is invalid.')
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new Error('CI packaged archive-lifecycle child deadline is invalid.')
  }
  const reapTimeoutMs = dependencies.reapTimeoutMs
    ?? ARCHIVE_LIFECYCLE_CHILD_REAP_DEADLINE_MS
  const platform = dependencies.platform ?? process.platform
  const killProcess = dependencies.killProcess ?? process.kill
  if (!Number.isSafeInteger(reapTimeoutMs) || reapTimeoutMs < 1
    || typeof platform !== 'string' || typeof killProcess !== 'function') {
    throw new Error('CI packaged archive-lifecycle child reap configuration is invalid.')
  }
  return new Promise((resolve, reject) => {
    let deadline = null
    let reapDeadline = null
    let groupPoll = null
    let timeoutError = null
    let settled = false
    let exitObserved = false
    let observedExitCode = 1
    let residualGroupObserved = false
    const cleanup = () => {
      if (deadline !== null) clearTimeout(deadline)
      if (reapDeadline !== null) clearTimeout(reapDeadline)
      if (groupPoll !== null) clearTimeout(groupPoll)
      child.removeListener('error', onError)
      child.removeListener('exit', onExit)
    }
    const settle = (settler, value) => {
      if (settled) return
      settled = true
      cleanup()
      settler(value)
    }
    const residualGroupError = () => new Error(
      observedExitCode === 0
        ? 'CI packaged archive-lifecycle process group remained active after a successful wrapper exit.'
        : 'CI packaged archive-lifecycle process group could not be proven settled after wrapper exit.',
    )
    const processGroupIsEmpty = () => {
      if (!Number.isSafeInteger(child.pid) || child.pid < 1) return false
      try {
        killProcess(-child.pid, 0)
        return false
      } catch (error) {
        return error?.code === 'ESRCH'
      }
    }
    const finishExitedChild = () => {
      if (timeoutError !== null) {
        settle(reject, markArchiveLifecycleChildSettlement(timeoutError, true))
        return
      }
      if (residualGroupObserved && observedExitCode === 0) {
        settle(reject, markArchiveLifecycleChildSettlement(residualGroupError(), true))
        return
      }
      settle(resolve, observedExitCode)
    }
    const pollExitedProcessGroup = () => {
      groupPoll = null
      if (processGroupIsEmpty()) {
        finishExitedChild()
        return
      }
      groupPoll = setTimeout(
        pollExitedProcessGroup,
        ARCHIVE_LIFECYCLE_GROUP_REAP_POLL_MS,
      )
    }
    const onReapDeadline = () => {
      reapDeadline = null
      if (exitObserved && platform !== 'win32' && processGroupIsEmpty()) {
        finishExitedChild()
        return
      }
      releaseArchiveLifecycleChildHandle(child)
      const error = timeoutError ?? residualGroupError()
      settle(reject, markArchiveLifecycleChildSettlement(error, false))
    }
    const beginExitedChildSettlement = () => {
      if (platform === 'win32') {
        finishExitedChild()
        return
      }
      if (!Number.isSafeInteger(child.pid) || child.pid < 1) {
        settle(
          reject,
          markArchiveLifecycleChildSettlement(residualGroupError(), false),
        )
        return
      }
      if (processGroupIsEmpty()) {
        finishExitedChild()
        return
      }
      residualGroupObserved = true
      if (reapDeadline === null) {
        reapDeadline = setTimeout(onReapDeadline, reapTimeoutMs)
      }
      try {
        killProcess(-child.pid, 'SIGKILL')
      } catch {
        // The group remains unsettled until signal-zero proves it absent.
      }
      groupPoll = setTimeout(
        pollExitedProcessGroup,
        ARCHIVE_LIFECYCLE_GROUP_REAP_POLL_MS,
      )
    }
    const onError = (error) => {
      if (timeoutError === null) {
        const spawnFailed = !Number.isSafeInteger(child.pid) || child.pid < 1
        settle(reject, markArchiveLifecycleChildSettlement(error, spawnFailed))
      }
    }
    const onExit = (code) => {
      if (exitObserved) return
      exitObserved = true
      observedExitCode = code ?? 1
      if (deadline !== null) {
        clearTimeout(deadline)
        deadline = null
      }
      beginExitedChildSettlement()
    }
    deadline = setTimeout(() => {
      timeoutError = new Error(
        `CI packaged archive-lifecycle smoke exceeded its ${timeoutMs} ms child deadline.`,
      )
      timeoutError.archiveLifecycleSupervisorClassification = ARCHIVE_LIFECYCLE_CHILD_TIMEOUT
      markArchiveLifecycleChildSettlement(timeoutError, false)
      reapDeadline = setTimeout(onReapDeadline, reapTimeoutMs)
      signalArchiveLifecycleProcessTree(child, { killProcess, platform })
    }, timeoutMs)
    child.once('error', onError)
    child.once('exit', onExit)
    if (child.exitCode !== undefined && child.exitCode !== null) {
      onExit(child.exitCode)
    } else if (child.signalCode !== undefined && child.signalCode !== null) {
      onExit(null)
    }
  })
}

/** Builds one fixed, bounded fallback receipt without projecting the child error. */
export function createArchiveLifecycleSupervisorFailureReceipt(input) {
  const source = input?.source
  if (input === null || typeof input !== 'object' || Array.isArray(input)
    || !ARCHIVE_LIFECYCLE_SUPERVISOR_FAILURES.has(input.failureClassification)
    || source === null || typeof source !== 'object' || Array.isArray(source)
    || !GIT_SHA.test(source.expectedHead ?? '')
    || !GIT_SHA.test(source.expectedTree ?? '')
    || (source.observedHead !== null && !GIT_SHA.test(source.observedHead ?? ''))
    || (source.observedTree !== null && !GIT_SHA.test(source.observedTree ?? ''))
    || (source.observedHead === null) !== (source.observedTree === null)
    || typeof source.worktreeClean !== 'boolean'
    || source.observedHead === null && source.worktreeClean !== false
    || !Number.isSafeInteger(input.startedAtMs) || input.startedAtMs < 0
    || (input.failedAtMs !== undefined
      && (!Number.isSafeInteger(input.failedAtMs)
        || input.failedAtMs < input.startedAtMs
        || Number.isNaN(new Date(input.failedAtMs).getTime())))) {
    throw new Error('Archive-lifecycle supervisor failure receipt input is invalid.')
  }
  const failedAtMs = input.failedAtMs ?? Math.max(Date.now(), input.startedAtMs)
  const message = input.failureClassification === ARCHIVE_LIFECYCLE_CHILD_TIMEOUT
    ? 'Archive-lifecycle child exceeded the bounded supervisor deadline.'
    : 'Archive-lifecycle child did not publish terminal evidence.'
  const receipt = Object.freeze({
    schemaVersion: 1,
    proofKind: 'packaged-electron-archive-lifecycle-failure-v1',
    source: Object.freeze({
      expectedHead: source.expectedHead,
      expectedTree: source.expectedTree,
      headBefore: source.observedHead,
      treeBefore: source.observedTree,
      worktreeCleanBefore: source.worktreeClean,
    }),
    run: Object.freeze({
      startedAt: new Date(input.startedAtMs).toISOString(),
      failedAt: new Date(failedAtMs).toISOString(),
      durationMs: Math.max(0, failedAtMs - input.startedAtMs),
      platform: process.platform,
      architecture: os.arch(),
      nodeVersion: process.version,
      observedLaunchCount: 0,
    }),
    failure: Object.freeze({
      classification: input.failureClassification,
      message,
      archiveLifecycleDiagnostics: null,
    }),
    cleanup: Object.freeze({
      cleanupFailureCount: 1,
      failures: Object.freeze([
        Object.freeze({
          step: 'archive_lifecycle_child_supervisor',
          classification: input.failureClassification,
          message,
          archiveLifecycleDiagnostics: null,
        }),
      ]),
      processCleanupCompleted: false,
      profileCleanupCompleted: false,
    }),
    verdict: Object.freeze({ passed: false }),
  })
  assertArchiveLifecycleSupervisorFailureReceiptSafe(receipt)
  return receipt
}

/** Establishes one leased canonical boundary plus separate private child staging. */
export async function prepareArchiveLifecycleSupervisorTerminalRun(input, dependencies = {}) {
  const source = input?.source
  if (input === null || typeof input !== 'object' || Array.isArray(input)
    || typeof input.evidenceDir !== 'string' || !path.isAbsolute(input.evidenceDir)
    || source === null || typeof source !== 'object' || Array.isArray(source)
    || !GIT_SHA.test(source.expectedHead ?? '')
    || !GIT_SHA.test(source.expectedTree ?? '')
    || (source.observedHead !== null && !GIT_SHA.test(source.observedHead ?? ''))
    || (source.observedTree !== null && !GIT_SHA.test(source.observedTree ?? ''))
    || (source.observedHead === null) !== (source.observedTree === null)
    || typeof source.worktreeClean !== 'boolean'
    || source.observedHead === null && source.worktreeClean !== false
    || !Number.isSafeInteger(input.startedAtMs) || input.startedAtMs < 0
    || Number.isNaN(new Date(input.startedAtMs).getTime())
    || !Array.isArray(input.protectedPaths ?? [])
    || (input.protectedPaths ?? []).some(
      (entry) => typeof entry !== 'string' || !path.isAbsolute(entry),
    )
    || dependencies === null || typeof dependencies !== 'object' || Array.isArray(dependencies)
    || (dependencies.isSupervisorProcessAlive !== undefined
      && typeof dependencies.isSupervisorProcessAlive !== 'function')) {
    throw new Error('Archive-lifecycle supervisor terminal run input is invalid.')
  }
  const evidenceDir = path.resolve(input.evidenceDir)
  if (evidenceDir !== input.evidenceDir) {
    throw new Error('Archive-lifecycle supervisor evidence path is not canonical.')
  }
  await requireArchiveLifecycleSupervisorRecreationBoundary(
    evidenceDir,
    input.protectedPaths ?? [],
  )
  const preparationGate = await acquireArchiveLifecycleSupervisorPrepareGate(evidenceDir)
  const leaseDir = archiveLifecycleSupervisorLeaseDirectory(evidenceDir)
  const childEvidenceDir = archiveLifecycleSupervisorChildEvidenceDirectory(evidenceDir)
  let leaseIdentity = null
  let leaseOwned = false
  let childEvidenceIdentity = null
  try {
    await reconcileArchiveLifecycleSupervisorLease(
      evidenceDir,
      source.expectedHead,
      dependencies,
    )
    await mkdir(leaseDir, { mode: 0o700 })
    leaseOwned = true
    await chmod(leaseDir, 0o700)
    leaseIdentity = await pinArchiveLifecycleSupervisorPrivateDirectory(
      leaseDir,
      'supervisor lease',
    )
    await syncArchiveLifecycleSupervisorDirectory(path.dirname(leaseDir))
    await assertNoLegacyArchiveLifecycleChildEvidence(evidenceDir)
    try {
      await mkdir(childEvidenceDir, { mode: 0o700 })
    } catch (error) {
      if (error?.code === 'EEXIST') {
        throw new Error('Archive lifecycle child staging from a prior or active run is unresolved.')
      }
      throw error
    }
    childEvidenceIdentity = await pinArchiveLifecycleChildEvidenceDirectory(childEvidenceDir)
    await syncArchiveLifecycleSupervisorDirectory(path.dirname(evidenceDir))
    const existing = await lstat(evidenceDir).catch((error) => {
      if (error?.code === 'ENOENT') return null
      throw error
    })
    if (existing !== null && (!existing.isDirectory() || existing.isSymbolicLink())) {
      throw new Error('Archive-lifecycle supervisor evidence boundary is unsafe.')
    }
    await rm(evidenceDir, { recursive: true, force: true })
    await mkdir(evidenceDir, { recursive: true, mode: 0o700 })
    await chmod(evidenceDir, 0o700)
    const evidenceIdentity = await pinArchiveLifecycleSupervisorPrivateDirectory(
      evidenceDir,
      'canonical evidence',
    )
    const terminalRun = Object.freeze({
      evidenceDir,
      evidenceIdentity,
      leaseDir,
      leaseIdentity,
      childEvidenceDir,
      childEvidenceIdentity,
      runId: randomUUID(),
      expectedHead: source.expectedHead,
      expectedTree: source.expectedTree,
      observedHead: source.observedHead,
      observedTree: source.observedTree,
      worktreeClean: source.worktreeClean,
      startedAtMs: input.startedAtMs,
    })
    await writeArchiveLifecycleSupervisorLeaseRecord(
      archiveLifecycleSupervisorLeaseRecordPaths(leaseDir).activePath,
      createArchiveLifecycleSupervisorActiveLeaseRecord(terminalRun),
    )
    await assertArchiveLifecycleSupervisorLeaseDirectory(terminalRun)
    await assertArchiveLifecycleSupervisorEvidenceDirectory(terminalRun)
    return terminalRun
  } catch (error) {
    if (childEvidenceIdentity !== null) {
      await pinArchiveLifecycleChildEvidenceDirectory(childEvidenceDir)
        .then(async (observed) => {
          if (observed.dev !== childEvidenceIdentity.dev
            || observed.ino !== childEvidenceIdentity.ino) return
          await rm(childEvidenceDir, { recursive: true, force: true })
          await syncArchiveLifecycleSupervisorDirectory(path.dirname(childEvidenceDir))
        })
        .catch(() => undefined)
    }
    if (leaseOwned && leaseIdentity !== null) {
      await assertArchiveLifecycleSupervisorPrivateDirectory(
        leaseDir,
        leaseIdentity,
        'supervisor lease',
      ).then(async () => {
        await rm(leaseDir, { recursive: true, force: true })
        await syncArchiveLifecycleSupervisorDirectory(path.dirname(leaseDir))
      }).catch(() => undefined)
    }
    throw error
  } finally {
    await releaseArchiveLifecycleSupervisorPrepareGate(preparationGate)
  }
}

/** Preserves valid staged child proof or publishes one sanitized parent-owned fallback. */
export async function ensureArchiveLifecycleSupervisorTerminalArtifact(input, dependencies = {}) {
  assertArchiveLifecycleSupervisorTerminalRunMatches(input)
  await assertArchiveLifecycleSupervisorActiveLeaseOwner(input.terminalRun)
  await assertArchiveLifecycleSupervisorEvidenceDirectory(input.terminalRun)
  const observedAtMs = observeArchiveLifecycleSupervisorTime(
    dependencies.nowMs ?? Date.now,
    input.terminalRun.startedAtMs,
  )
  const canonical = await readArchiveLifecycleCanonicalTerminalArtifact(
    input.terminalRun,
    { observedAtMs, recoverSuccess: false },
  )
  if (canonical.kind !== null) {
    return finalizeArchiveLifecycleSupervisorTerminalArtifact(input, canonical, observedAtMs)
  }

  const expectedChildKind = input.failureClassification === ARCHIVE_LIFECYCLE_CHILD_TIMEOUT
    || input.childExitCode === null
    ? null
    : input.childExitCode === 0 ? 'success' : 'failure'
  if (expectedChildKind !== null) {
    const staged = await readArchiveLifecycleStagedChildArtifact(
      input.terminalRun,
      { observedAtMs },
    ).catch(() => null)
    if (staged?.kind === expectedChildKind) {
      const terminal = await publishArchiveLifecycleSupervisorCanonicalArtifact({
        contents: staged.contents,
        kind: staged.kind,
        terminalRun: input.terminalRun,
        deferSuccessName: staged.kind === 'success',
      }, { observedAtMs })
      return finalizeArchiveLifecycleSupervisorTerminalArtifact(input, terminal, observedAtMs)
    }
  }

  const refreshedSource = await refreshArchiveLifecycleSupervisorFallbackSource(
    input.terminalRun,
    dependencies.readSourceIdentity ?? readExactSourceIdentity,
  )
  const receipt = createArchiveLifecycleSupervisorFailureReceipt({
    ...input,
    failedAtMs: observedAtMs,
    source: refreshedSource,
  })
  const terminal = await publishArchiveLifecycleSupervisorCanonicalArtifact({
    contents: `${JSON.stringify(receipt, null, 2)}\n`,
    kind: 'failure',
    terminalRun: input.terminalRun,
  }, { observedAtMs })
  return finalizeArchiveLifecycleSupervisorTerminalArtifact(input, terminal, observedAtMs)
}

/** Re-reads one public terminal under the live lease, then durably marks it consumed. */
export async function consumeArchiveLifecycleSupervisorTerminalArtifact(input, dependencies = {}) {
  const terminalRun = input?.terminalRun
  const terminal = input?.terminal
  assertArchiveLifecycleSupervisorTerminalRun(terminalRun)
  if (terminal === null || typeof terminal !== 'object' || Array.isArray(terminal)
    || !['success', 'failure'].includes(terminal.kind)
    || typeof terminal.path !== 'string' || !path.isAbsolute(terminal.path)
    || typeof terminal.published !== 'boolean'
    || dependencies === null || typeof dependencies !== 'object' || Array.isArray(dependencies)
    || (dependencies.nowMs !== undefined && typeof dependencies.nowMs !== 'function')) {
    throw new Error('Archive lifecycle terminal consumption input is invalid.')
  }
  const expectedPath = terminal.kind === 'success'
    ? archiveLifecycleSupervisorTerminalPaths(terminalRun.evidenceDir).successPath
    : archiveLifecycleSupervisorTerminalPaths(terminalRun.evidenceDir).failurePath
  if (terminal.path !== expectedPath) {
    throw new Error('Archive lifecycle terminal consumption path is invalid.')
  }
  const observedAtMs = observeArchiveLifecycleSupervisorTime(
    dependencies.nowMs ?? Date.now,
    terminalRun.startedAtMs,
  )
  await assertArchiveLifecycleSupervisorLeaseDirectory(terminalRun)
  await assertArchiveLifecycleSupervisorEvidenceDirectory(terminalRun)
  const state = await assertArchiveLifecycleSupervisorActiveLeaseOwner(terminalRun)
  const canonical = await readArchiveLifecycleCanonicalTerminalArtifact(
    terminalRun,
    { observedAtMs, recoverSuccess: false },
  )
  if (canonical.kind !== terminal.kind || canonical.path !== terminal.path
    || canonical.pending === true) {
    throw new Error('Archive lifecycle terminal changed before it could be consumed.')
  }
  const identity = await readArchiveLifecycleSupervisorArtifactIdentity(terminal.path)
  if (identity === null || !Number.isSafeInteger(identity.dev)
    || !Number.isSafeInteger(identity.ino)) {
    throw new Error('Archive lifecycle terminal identity is invalid for consumption.')
  }
  const contents = await readArchiveLifecycleSupervisorPinnedArtifact(terminal.path, identity)
  const proposedConsumed = Object.freeze({
    schemaVersion: 1,
    recordKind: 'archive-lifecycle-supervisor-consumed-terminal-v1',
    runId: terminalRun.runId,
    expectedHead: terminalRun.expectedHead,
    consumedAtMs: observedAtMs,
    terminalKind: terminal.kind,
    terminalSha256: createHash('sha256').update(contents, 'utf8').digest('hex'),
    terminalDev: identity.dev,
    terminalIno: identity.ino,
    terminalSize: identity.size,
  })
  const consumedPath = archiveLifecycleSupervisorLeaseRecordPaths(
    terminalRun.leaseDir,
  ).consumedPath
  if (state.consumed !== null
    && !sameArchiveLifecycleSupervisorConsumedTerminalBinding(
      state.consumed,
      proposedConsumed,
    )) {
    throw new Error('Archive lifecycle consumed terminal metadata is contradictory.')
  }
  if (state.consumed === null) {
    await writeArchiveLifecycleSupervisorLeaseRecord(consumedPath, proposedConsumed).catch((error) => {
      if (error?.code !== 'EEXIST') throw error
    })
  }
  const consumedState = await readArchiveLifecycleSupervisorLeaseState(
    terminalRun.evidenceDir,
    terminalRun.leaseIdentity,
  )
  if (!isDeepStrictEqual(consumedState.active, state.active)
    || consumedState.consumed === null
    || !sameArchiveLifecycleSupervisorConsumedTerminalBinding(
      consumedState.consumed,
      proposedConsumed,
    )
    || state.consumed !== null
      && !isDeepStrictEqual(consumedState.consumed, state.consumed)) {
    throw new Error('Archive lifecycle consumed terminal metadata is contradictory.')
  }
  const finalCanonical = await readArchiveLifecycleCanonicalTerminalArtifact(
    terminalRun,
    { observedAtMs, recoverSuccess: false },
  )
  const finalIdentity = await readArchiveLifecycleSupervisorArtifactIdentity(terminal.path)
  if (finalCanonical.kind !== terminal.kind || finalCanonical.path !== terminal.path
    || finalCanonical.pending === true || finalIdentity === null
    || !sameArchiveLifecycleSupervisorArtifactIdentity(finalIdentity, identity)) {
    throw new Error('Archive lifecycle terminal changed while it was consumed.')
  }
  await assertArchiveLifecycleSupervisorLeaseDirectory(terminalRun)
  await assertArchiveLifecycleSupervisorEvidenceDirectory(terminalRun)
  return Object.freeze({ ...finalCanonical, published: terminal.published })
}

/** Correlates a durable verdict with the observed child outcome, then clears reaped staging. */
async function finalizeArchiveLifecycleSupervisorTerminalArtifact(input, terminal, observedAtMs) {
  await assertArchiveLifecycleSupervisorActiveLeaseOwner(input.terminalRun)
  await assertArchiveLifecycleSupervisorEvidenceDirectory(input.terminalRun)
  if (terminal.kind === 'success') {
    await concealArchiveLifecycleSupervisorSuccessName(input.terminalRun)
  }
  const outcomeAllowsSuccess = input.childExitCode === 0
    && input.failureClassification !== ARCHIVE_LIFECYCLE_CHILD_TIMEOUT
  if (terminal.kind === 'success' && !outcomeAllowsSuccess) {
    throw new Error('Archive lifecycle canonical success contradicts the observed child exit outcome.')
  }
  const childSettled = input.childSettled ?? (input.childExitCode !== null)
  if (childSettled) {
    try {
      await removeArchiveLifecycleSettledChildEvidence(input.terminalRun)
    } catch {
      if (terminal.kind === 'success') {
        await concealArchiveLifecycleSupervisorSuccessName(input.terminalRun)
      }
      throw new Error(
        'Archive lifecycle canonical evidence is durable, but private child evidence cleanup is incomplete.',
      )
    }
  }
  // Without parent-held proof that the child exited or never spawned, its random
  // mode-0700 staging path remains isolated for any late write and is never canonical.
  if (terminal.kind !== 'success') return terminal
  const exposed = await readArchiveLifecycleCanonicalTerminalArtifact(
    input.terminalRun,
    { observedAtMs, recoverSuccess: true },
  )
  if (exposed.kind !== 'success' || exposed.pending === true) {
    throw new Error('Archive lifecycle pending success could not be exposed after staging cleanup.')
  }
  await assertArchiveLifecycleSupervisorActiveLeaseOwner(input.terminalRun)
  await assertArchiveLifecycleSupervisorEvidenceDirectory(input.terminalRun)
  return Object.freeze({ ...exposed, published: terminal.published })
}

/** Removes only the public success name while retaining durable owner metadata. */
async function concealArchiveLifecycleSupervisorSuccessName(terminalRun) {
  await assertArchiveLifecycleSupervisorActiveLeaseOwner(terminalRun)
  await assertArchiveLifecycleSupervisorEvidenceDirectory(terminalRun)
  const paths = archiveLifecycleSupervisorTerminalPaths(
    terminalRun.evidenceDir,
    terminalRun.runId,
  )
  const [ownerIdentity, successIdentity] = await Promise.all([
    readArchiveLifecycleSupervisorArtifactIdentity(paths.ownerPath),
    readArchiveLifecycleSupervisorArtifactIdentity(paths.successPath),
  ])
  if (successIdentity === null) return
  if (ownerIdentity === null || ownerIdentity.dev !== successIdentity.dev
    || ownerIdentity.ino !== successIdentity.ino) {
    throw new Error('Archive lifecycle public success does not share terminal ownership.')
  }
  await unlink(paths.successPath)
  await syncArchiveLifecycleSupervisorDirectory(terminalRun.evidenceDir)
  await assertArchiveLifecycleSupervisorActiveLeaseOwner(terminalRun)
  await assertArchiveLifecycleSupervisorEvidenceDirectory(terminalRun)
}

/** Removes settled child-only evidence only after canonical ownership is durable. */
async function removeArchiveLifecycleSettledChildEvidence(terminalRun) {
  await assertArchiveLifecycleSupervisorActiveLeaseOwner(terminalRun)
  await assertArchiveLifecycleSupervisorEvidenceDirectory(terminalRun)
  const identity = await lstat(terminalRun.childEvidenceDir).catch((error) => {
    if (error?.code === 'ENOENT') return null
    throw error
  })
  if (identity !== null && (!identity.isDirectory() || identity.isSymbolicLink()
    || identity.dev !== terminalRun.childEvidenceIdentity.dev
    || identity.ino !== terminalRun.childEvidenceIdentity.ino
    || await realpath(terminalRun.childEvidenceDir)
      !== terminalRun.childEvidenceIdentity.realPath)) {
    throw new Error('Archive lifecycle child evidence cleanup boundary is unsafe.')
  }
  if (identity !== null) {
    await rm(terminalRun.childEvidenceDir, { recursive: true, force: true })
  }
  await syncArchiveLifecycleSupervisorDirectory(path.dirname(terminalRun.childEvidenceDir))
  await assertArchiveLifecycleSupervisorActiveLeaseOwner(terminalRun)
  await assertArchiveLifecycleSupervisorEvidenceDirectory(terminalRun)
}

/** Re-observes source at fallback publication without ever copying expected as observed. */
async function refreshArchiveLifecycleSupervisorFallbackSource(terminalRun, readSourceIdentity) {
  let source
  try {
    if (typeof readSourceIdentity !== 'function') throw new Error('invalid source reader')
    source = await readSourceIdentity(terminalRun.expectedHead)
  } catch {
    source = null
  }
  const observationValid = source !== null
    && typeof source === 'object'
    && source.expectedHead === terminalRun.expectedHead
    && source.expectedTree === terminalRun.expectedTree
    && GIT_SHA.test(source.observedHead ?? '')
    && GIT_SHA.test(source.observedTree ?? '')
    && typeof source.worktreeClean === 'boolean'
  return Object.freeze({
    expectedHead: terminalRun.expectedHead,
    expectedTree: terminalRun.expectedTree,
    observedHead: observationValid ? source.observedHead : null,
    observedTree: observationValid ? source.observedTree : null,
    worktreeClean: observationValid ? source.worktreeClean : false,
  })
}

/** Reads exactly one safe child artifact from the random staging directory. */
async function readArchiveLifecycleStagedChildArtifact(terminalRun, options = {}) {
  await assertArchiveLifecycleSupervisorLeaseDirectory(terminalRun)
  await assertArchiveLifecycleSupervisorEvidenceDirectory(terminalRun)
  await assertArchiveLifecycleChildEvidenceDirectory(terminalRun)
  const paths = archiveLifecycleSupervisorTerminalPaths(terminalRun.childEvidenceDir)
  const [successIdentity, failureIdentity] = await Promise.all([
    readArchiveLifecycleSupervisorArtifactIdentity(paths.successPath),
    readArchiveLifecycleSupervisorArtifactIdentity(paths.failurePath),
  ])
  if (successIdentity !== null && failureIdentity !== null) {
    throw new Error('Archive lifecycle child published contradictory terminal artifacts.')
  }
  if (successIdentity === null && failureIdentity === null) return null
  const kind = successIdentity === null ? 'failure' : 'success'
  const artifactPath = kind === 'success' ? paths.successPath : paths.failurePath
  const artifactIdentity = kind === 'success' ? successIdentity : failureIdentity
  if (artifactIdentity.nlink !== 1) {
    throw new Error('Archive lifecycle child evidence has unexpected filesystem links.')
  }
  const contents = await readArchiveLifecycleSupervisorPinnedArtifact(
    artifactPath,
    artifactIdentity,
  )
  await assertArchiveLifecycleChildEvidenceDirectory(terminalRun)
  const parsedKind = validateArchiveLifecycleSupervisorTerminalContents(
    contents,
    terminalRun,
    { ...options, allowSupervisorFailure: false },
  )
  if (parsedKind !== kind) {
    throw new Error('Archive lifecycle child verdict does not match its artifact filename.')
  }
  return Object.freeze({ contents, kind })
}

/** Claims one shared terminal inode, then recovers its verdict-specific canonical name. */
export async function publishArchiveLifecycleSupervisorCanonicalArtifact(input, dependencies = {}) {
  const terminalRun = input?.terminalRun
  assertArchiveLifecycleSupervisorTerminalRun(terminalRun)
  await assertArchiveLifecycleSupervisorActiveLeaseOwner(terminalRun)
  await assertArchiveLifecycleSupervisorEvidenceDirectory(terminalRun)
  const recoverSuccess = input?.deferSuccessName !== true
  const observedAtMs = dependencies.observedAtMs === undefined
    ? observeArchiveLifecycleSupervisorTime(
        dependencies.nowMs ?? Date.now,
        terminalRun.startedAtMs,
      )
    : observeArchiveLifecycleSupervisorTime(
        () => dependencies.observedAtMs,
        terminalRun.startedAtMs,
      )
  const validated = parseArchiveLifecycleSupervisorTerminalContents(
    input?.contents,
    terminalRun,
    { observedAtMs },
  )
  if (validated.kind !== input.kind) {
    throw new Error('Archive-lifecycle canonical verdict does not match its filename.')
  }
  const existing = await readArchiveLifecycleCanonicalTerminalArtifact(
    terminalRun,
    { observedAtMs, recoverSuccess, allowOwnerClaimSettlement: true },
  )
  if (existing.kind !== null) return existing

  const paths = archiveLifecycleSupervisorTerminalPaths(
    terminalRun.evidenceDir,
    terminalRun.runId,
  )
  const canonicalContents = `${JSON.stringify(validated.evidence, null, 2)}\n`
  if (Buffer.byteLength(canonicalContents, 'utf8') > ARCHIVE_LIFECYCLE_ARTIFACT_LIMIT_BYTES) {
    throw new Error('Archive-lifecycle canonical terminal artifact is unbounded.')
  }
  const temporaryPath = path.join(
    path.dirname(terminalRun.evidenceDir),
    `.${path.basename(terminalRun.evidenceDir)}-${input.kind}.${process.pid}.${randomUUID()}.tmp`,
  )
  let handle = null
  let temporaryPresent = false
  const removeTemporary = async () => {
    if (!temporaryPresent) return
    await unlink(temporaryPath)
    temporaryPresent = false
    await syncArchiveLifecycleSupervisorDirectory(path.dirname(temporaryPath))
  }
  try {
    handle = await open(temporaryPath, 'wx', 0o600)
    temporaryPresent = true
    await handle.chmod(0o600)
    await handle.writeFile(canonicalContents, 'utf8')
    await handle.sync()
    await handle.close()
    handle = null
    try {
      await assertArchiveLifecycleSupervisorActiveLeaseOwner(terminalRun)
      await assertArchiveLifecycleSupervisorEvidenceDirectory(terminalRun)
      await link(temporaryPath, paths.runOwnerPath)
      await syncArchiveLifecycleSupervisorDirectory(terminalRun.evidenceDir)
      await removeTemporary()
      await assertArchiveLifecycleSupervisorActiveLeaseOwner(terminalRun)
      await assertArchiveLifecycleSupervisorEvidenceDirectory(terminalRun)
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      await removeTemporary()
      return readArchiveLifecycleCanonicalTerminalArtifact(
        terminalRun,
        { observedAtMs, recoverSuccess, allowOwnerClaimSettlement: true },
      )
    }
    await removeTemporary()
    const terminal = await readArchiveLifecycleCanonicalTerminalArtifact(
      terminalRun,
      { observedAtMs, recoverSuccess, allowOwnerClaimSettlement: true },
    )
    if (terminal.kind !== input.kind) {
      throw new Error('Archive-lifecycle canonical ownership resolved to the opposite verdict.')
    }
    await syncArchiveLifecycleSupervisorDirectory(terminalRun.evidenceDir)
    await assertArchiveLifecycleSupervisorActiveLeaseOwner(terminalRun)
    await assertArchiveLifecycleSupervisorEvidenceDirectory(terminalRun)
    return Object.freeze({ ...terminal, published: true })
  } finally {
    await handle?.close().catch(() => undefined)
    if (temporaryPresent) {
      await unlink(temporaryPath).catch((error) => {
        if (error?.code !== 'ENOENT') throw error
      })
      await syncArchiveLifecycleSupervisorDirectory(path.dirname(temporaryPath))
    }
  }
}

/** Reads or crash-recovers one canonical name within a single bounded settlement loop. */
async function readArchiveLifecycleCanonicalTerminalArtifact(terminalRun, options = {}) {
  assertArchiveLifecycleSupervisorTerminalRun(terminalRun)
  const paths = archiveLifecycleSupervisorTerminalPaths(terminalRun.evidenceDir, terminalRun.runId)
  let anchor = null
  let observedOwner = false
  let observedVerdict = null
  for (let attempt = 0; attempt <= 20; attempt += 1) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 5))
    if (options.requireExactActiveOwner !== false) {
      await assertArchiveLifecycleSupervisorActiveLeaseOwner(terminalRun)
    } else {
      await assertArchiveLifecycleSupervisorLeaseDirectory(terminalRun)
    }
    await assertArchiveLifecycleSupervisorEvidenceDirectory(terminalRun)
    const identities = await readCanonicalTerminalIdentities(paths)
    const [ownerIdentity, runOwnerIdentity, successIdentity, failureIdentity] = identities
    if (successIdentity !== null && failureIdentity !== null) {
      throw new Error('Archive lifecycle must retain exactly one terminal evidence artifact.')
    }
    if (ownerIdentity === null && runOwnerIdentity === null) {
      if (anchor !== null) {
        throw new Error('Archive lifecycle canonical ownership disappeared during settlement.')
      }
      if (successIdentity !== null || failureIdentity !== null) {
        throw new Error('Archive lifecycle canonical artifact has no terminal ownership inode.')
      }
      return Object.freeze({ kind: null, path: null, published: false })
    }
    if (runOwnerIdentity === null) {
      throw new Error('Archive lifecycle canonical artifact has no invocation ownership inode.')
    }
    anchor ??= runOwnerIdentity
    if (!sameArchiveLifecycleSupervisorArtifactContentIdentity(runOwnerIdentity, anchor)) {
      throw new Error('Archive lifecycle canonical ownership changed during settlement.')
    }
    if (ownerIdentity !== null
      && !sameArchiveLifecycleSupervisorArtifactContentIdentity(ownerIdentity, anchor)) {
      throw new Error('Archive lifecycle canonical artifact belongs to another supervisor invocation ownership inode.')
    }
    if ([successIdentity, failureIdentity].some((identity) => identity !== null
      && !sameArchiveLifecycleSupervisorArtifactContentIdentity(identity, anchor))) {
      throw new Error('Archive lifecycle canonical artifact does not share terminal ownership.')
    }
    if (observedOwner && ownerIdentity === null
      || observedVerdict === 'success' && successIdentity === null
      || observedVerdict === 'failure' && failureIdentity === null) {
      throw new Error('Archive lifecycle canonical publication names disappeared during settlement.')
    }
    observedOwner ||= ownerIdentity !== null
    observedVerdict ??= successIdentity !== null ? 'success' : failureIdentity !== null ? 'failure' : null
    const present = identities.filter((identity) => identity !== null)
    const exactLinks = present.length
    if (present.some((identity) => identity.nlink !== exactLinks)) {
      // Parallel stats may straddle creation of a known owner/verdict name.
      // Never mutate or accept that mixed scan; every re-observation spends
      // the same finite budget and remains anchored to the first inode.
      const legalPrefixMayBeSettling = options.allowOwnerClaimSettlement === true
        && present.every((identity) => identity.nlink >= 1 && identity.nlink <= 3)
      if (legalPrefixMayBeSettling) continue
      throw new Error('Archive lifecycle canonical ownership has unexpected filesystem links.')
    }
    if (ownerIdentity === null) {
      if (options.requireExactActiveOwner !== false) {
        await assertArchiveLifecycleSupervisorActiveLeaseOwner(terminalRun)
        await assertArchiveLifecycleSupervisorEvidenceDirectory(terminalRun)
      }
      try {
        await link(paths.runOwnerPath, paths.ownerPath)
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error
      }
      await syncArchiveLifecycleSupervisorDirectory(terminalRun.evidenceDir)
      continue
    }
    let contents
    try {
      contents = await readArchiveLifecycleSupervisorPinnedArtifact(paths.ownerPath, ownerIdentity)
    } catch (error) {
      if (options.allowOwnerClaimSettlement !== true
        || error?.code !== 'ARCHIVE_LIFECYCLE_OWNER_LINK_SETTLING') throw error
      // Discard bytes read across a link transition. Only a fresh strict read
      // after a complete topology scan may supply accepted terminal evidence.
      continue
    }
    const ownerKind = validateArchiveLifecycleSupervisorTerminalContents(contents, terminalRun, options)
    const artifactPath = ownerKind === 'success' ? paths.successPath : paths.failurePath
    const artifactIdentity = ownerKind === 'success' ? successIdentity : failureIdentity
    const oppositeIdentity = ownerKind === 'success' ? failureIdentity : successIdentity
    if (oppositeIdentity !== null) {
      throw new Error('Archive lifecycle canonical verdict does not match its filename.')
    }
    const pending = artifactIdentity === null && ownerKind === 'success' && options.recoverSuccess === false
    if (artifactIdentity === null && !pending) {
      if (options.requireExactActiveOwner !== false) {
        await assertArchiveLifecycleSupervisorActiveLeaseOwner(terminalRun)
        await assertArchiveLifecycleSupervisorEvidenceDirectory(terminalRun)
      }
      try {
        await link(paths.ownerPath, artifactPath)
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error
      }
      await syncArchiveLifecycleSupervisorDirectory(terminalRun.evidenceDir)
      continue
    }
    // A same-count alias substitution must not hide behind a pinned owner.
    const finalIdentities = await readCanonicalTerminalIdentities(paths)
    const unchanged = identities.every((identity, index) => identity === null
      ? finalIdentities[index] === null
      : finalIdentities[index] !== null
        && sameArchiveLifecycleSupervisorArtifactIdentity(identity, finalIdentities[index]))
    if (!unchanged) {
      // A complete three-name publication cannot grow further. The only
      // permitted change is a pending success gaining its same-inode name.
      // Reject every observed substitution or disappearance immediately, even
      // if another writer could restore the original name before a retry.
      const pendingSuccessMayBePublishing = pending
        && options.allowOwnerClaimSettlement === true
        && finalIdentities[0] !== null && finalIdentities[1] !== null
        && finalIdentities[3] === null
        && finalIdentities.every((identity) => identity === null
          || sameArchiveLifecycleSupervisorArtifactContentIdentity(identity, anchor)
            && (identity.nlink === 2 || identity.nlink === 3))
      if (pendingSuccessMayBePublishing) {
        if (finalIdentities[2] !== null) observedVerdict = 'success'
        continue
      }
      throw new Error('Archive lifecycle canonical publication names changed during its read.')
    }
    if (options.requireExactActiveOwner !== false) {
      await assertArchiveLifecycleSupervisorActiveLeaseOwner(terminalRun)
    } else {
      await assertArchiveLifecycleSupervisorLeaseDirectory(terminalRun)
    }
    await assertArchiveLifecycleSupervisorEvidenceDirectory(terminalRun)
    return Object.freeze({
      kind: ownerKind, path: pending ? paths.ownerPath : artifactPath,
      published: false, ...(pending ? { pending: true } : {}),
    })
  }
  throw new Error('Archive lifecycle canonical ownership did not settle within its bounded budget.')
}

/** Samples all permitted canonical aliases; callers require one coherent anchored topology. */
async function readCanonicalTerminalIdentities(paths) {
  return Promise.all([
    readArchiveLifecycleSupervisorArtifactIdentity(paths.ownerPath),
    readArchiveLifecycleSupervisorArtifactIdentity(paths.runOwnerPath),
    readArchiveLifecycleSupervisorArtifactIdentity(paths.successPath),
    readArchiveLifecycleSupervisorArtifactIdentity(paths.failurePath),
  ])
}

/** Parses only bounded current-source success/failure evidence suitable for publication. */
function parseArchiveLifecycleSupervisorTerminalContents(
  contents,
  terminalRun,
  options = {},
) {
  assertArchiveLifecycleSupervisorTerminalRun(terminalRun)
  const observedAtMs = options.observedAtMs ?? Date.now()
  if (!Number.isSafeInteger(observedAtMs)
    || observedAtMs < 0
    || Number.isNaN(new Date(observedAtMs).getTime())) {
    throw new Error('Archive lifecycle terminal observation time is invalid.')
  }
  if (typeof contents !== 'string'
    || Buffer.byteLength(contents, 'utf8') < 1
    || Buffer.byteLength(contents, 'utf8') > ARCHIVE_LIFECYCLE_ARTIFACT_LIMIT_BYTES) {
    throw new Error('Archive lifecycle terminal contents are invalid or unbounded.')
  }
  let evidence
  try {
    evidence = JSON.parse(contents)
  } catch {
    throw new Error('Archive lifecycle terminal evidence is not valid JSON.')
  }
  if (evidence === null || typeof evidence !== 'object' || Array.isArray(evidence)) {
    throw new Error('Archive lifecycle terminal evidence root is invalid.')
  }
  if (evidence.verdict?.passed === true) {
    if (evidence.schemaVersion !== 2
      || evidence.proofKind !== 'packaged-electron-archive-lifecycle-v2'
      || evidence.source?.expectedHead !== terminalRun.expectedHead
      || evidence.source?.headBefore !== terminalRun.expectedHead
      || evidence.source?.treeBefore !== terminalRun.expectedTree
      || evidence.source.headAfter !== terminalRun.expectedHead
      || evidence.source.treeAfter !== terminalRun.expectedTree
      || evidence.source.worktreeCleanBefore !== true
      || evidence.source.worktreeCleanAfter !== true) {
      throw new Error('Archive lifecycle success evidence source or schema is invalid.')
    }
    const validation = validateArchiveLifecycleSmokeEvidence(evidence)
    if (validation.passed !== true) {
      throw new Error(
        `Archive lifecycle success evidence failed its full gate: ${validation.failureReasons.join(' ')}`,
      )
    }
    validateArchiveLifecycleChildTerminalRun(
      evidence.run,
      terminalRun,
      observedAtMs,
      'finishedAt',
    )
    return Object.freeze({ evidence, kind: 'success' })
  }
  if (evidence.verdict?.passed === false) {
    validateArchiveLifecycleSupervisorFailureEvidence(
      evidence,
      terminalRun,
      options,
      observedAtMs,
    )
    return Object.freeze({ evidence, kind: 'failure' })
  }
  throw new Error('Archive lifecycle terminal evidence verdict is invalid.')
}

/** Returns the validated verdict while keeping parsing private to canonical publication. */
function validateArchiveLifecycleSupervisorTerminalContents(contents, terminalRun, options = {}) {
  return parseArchiveLifecycleSupervisorTerminalContents(contents, terminalRun, options).kind
}

/** Applies the closed child/fallback failure-receipt unions before canonical publication. */
function validateArchiveLifecycleSupervisorFailureEvidence(
  evidence,
  terminalRun,
  options,
  observedAtMs,
) {
  exactArchiveLifecycleSupervisorRecord(evidence, [
    'schemaVersion',
    'proofKind',
    'source',
    'run',
    'failure',
    'cleanup',
    'verdict',
  ], [], 'failure evidence')
  if (evidence.schemaVersion !== 1
    || evidence.proofKind !== 'packaged-electron-archive-lifecycle-failure-v1') {
    throw new Error('Archive lifecycle failure evidence schema is invalid.')
  }
  const failure = exactArchiveLifecycleSupervisorRecord(evidence.failure, [
    'classification',
    'message',
    'archiveLifecycleDiagnostics',
  ], ['closedGateFailures', 'cleanupDiagnostic'], 'failure detail')
  const supervisorOwned = ARCHIVE_LIFECYCLE_SUPERVISOR_FAILURES.has(failure.classification)
  if (supervisorOwned && Buffer.byteLength(JSON.stringify(evidence), 'utf8')
      >= ARCHIVE_LIFECYCLE_SUPERVISOR_RECEIPT_LIMIT_BYTES) {
    throw new Error('Archive lifecycle supervisor failure evidence is unbounded.')
  }
  if (supervisorOwned && options.allowSupervisorFailure === false) {
    throw new Error('Archive lifecycle child cannot publish supervisor-owned failure evidence.')
  }
  if (supervisorOwned) {
    validateArchiveLifecycleSupervisorOwnedFailure(evidence, terminalRun)
  } else {
    validateArchiveLifecycleChildFailure(evidence, terminalRun)
  }
  validateArchiveLifecycleFailureRun(evidence.run, observedAtMs)
  if (!supervisorOwned) {
    validateArchiveLifecycleChildTerminalRun(
      evidence.run,
      terminalRun,
      observedAtMs,
      'failedAt',
    )
  }
  validateArchiveLifecycleFailureDetails(failure, supervisorOwned)
  validateArchiveLifecycleFailureCleanup(evidence.cleanup, supervisorOwned, failure)
  const verdict = exactArchiveLifecycleSupervisorRecord(
    evidence.verdict,
    ['passed'],
    [],
    'failure verdict',
  )
  if (verdict.passed !== false) {
    throw new Error('Archive lifecycle failure evidence verdict is invalid.')
  }
}

/** Validates the fixed parent fallback source and fail-closed cleanup claims. */
function validateArchiveLifecycleSupervisorOwnedFailure(evidence, terminalRun) {
  const source = exactArchiveLifecycleSupervisorRecord(evidence.source, [
    'expectedHead',
    'expectedTree',
    'headBefore',
    'treeBefore',
    'worktreeCleanBefore',
  ], [], 'supervisor failure source')
  if (source.expectedHead !== terminalRun.expectedHead
    || source.expectedTree !== terminalRun.expectedTree
    || typeof source.worktreeCleanBefore !== 'boolean') {
    throw new Error('Archive lifecycle supervisor failure is not bound to observed source.')
  }
  if ((source.headBefore !== null && !GIT_SHA.test(source.headBefore))
    || (source.treeBefore !== null && !GIT_SHA.test(source.treeBefore))
    || (source.headBefore === null) !== (source.treeBefore === null)
    || source.headBefore === null && source.worktreeCleanBefore !== false) {
    throw new Error('Archive lifecycle supervisor failure source is invalid.')
  }
  if (evidence.run?.startedAt !== new Date(terminalRun.startedAtMs).toISOString()
    || evidence.run?.observedLaunchCount !== 0) {
    throw new Error('Archive lifecycle supervisor failure run is invalid.')
  }
}

/** Requires a staged child receipt to describe the exact clean candidate source. */
function validateArchiveLifecycleChildFailure(evidence, terminalRun) {
  const source = exactArchiveLifecycleSupervisorRecord(evidence.source, [
    'expectedHead',
    'headBefore',
    'treeBefore',
    'worktreeCleanBefore',
  ], [], 'child failure source')
  if (!ARCHIVE_LIFECYCLE_CHILD_FAILURES.has(evidence.failure.classification)
    || source.expectedHead !== terminalRun.expectedHead
    || source.headBefore !== terminalRun.expectedHead
    || source.treeBefore !== terminalRun.expectedTree
    || source.worktreeCleanBefore !== true) {
    throw new Error('Archive lifecycle child failure is not bound to the exact clean source.')
  }
}

/** Validates bounded primitive run provenance in a failure receipt. */
function validateArchiveLifecycleFailureRun(value, observedAtMs) {
  const run = exactArchiveLifecycleSupervisorRecord(value, [
    'startedAt',
    'failedAt',
    'durationMs',
    'platform',
    'architecture',
    'nodeVersion',
    'observedLaunchCount',
  ], [], 'failure run')
  const startedAtMs = Date.parse(run.startedAt)
  const failedAtMs = Date.parse(run.failedAt)
  if (!archiveLifecycleSupervisorTimestampIsValid(run.startedAt)
    || !archiveLifecycleSupervisorTimestampIsValid(run.failedAt)
    || new Date(startedAtMs).toISOString() !== run.startedAt
    || new Date(failedAtMs).toISOString() !== run.failedAt
    || failedAtMs < startedAtMs
    || startedAtMs > observedAtMs
    || failedAtMs > observedAtMs
    || !Number.isSafeInteger(run.durationMs) || run.durationMs < 0
    || run.durationMs > 24 * 60 * 60_000
    || run.durationMs !== failedAtMs - startedAtMs
    || !ARCHIVE_LIFECYCLE_PLATFORMS.has(run.platform)
    || run.platform !== process.platform
    || !ARCHIVE_LIFECYCLE_ARCHITECTURES.has(run.architecture)
    || run.architecture !== os.arch()
    || !/^v\d+\.\d+\.\d+$/u.test(run.nodeVersion)
    || run.nodeVersion !== process.version
    || !Number.isSafeInteger(run.observedLaunchCount)
    || run.observedLaunchCount < 0 || run.observedLaunchCount > 2) {
    throw new Error('Archive lifecycle failure run is invalid or unbounded.')
  }
}

/** Binds staged child evidence to this invocation's bounded start and exact host runtime. */
function validateArchiveLifecycleChildTerminalRun(
  run,
  terminalRun,
  observedAtMs,
  finishedAtField,
) {
  const startedAtMs = Date.parse(run?.startedAt)
  const finishedAtMs = Date.parse(run?.[finishedAtField])
  const startDelayMs = startedAtMs - terminalRun.startedAtMs
  if (!Number.isSafeInteger(startedAtMs)
    || !Number.isSafeInteger(finishedAtMs)
    || !Number.isSafeInteger(startDelayMs)
    || startDelayMs < 0
    || startDelayMs > ARCHIVE_LIFECYCLE_CHILD_START_DEADLINE_MS
    || startedAtMs > observedAtMs
    || finishedAtMs > observedAtMs
    || run?.platform !== process.platform
    || run?.architecture !== os.arch()
    || run?.nodeVersion !== process.version) {
    throw new Error('Archive lifecycle child evidence is not bound to this supervisor run.')
  }
}

/** Validates the primary failure and its two optional fixed diagnostic shapes. */
function validateArchiveLifecycleFailureDetails(failure, supervisorOwned) {
  if (!archiveLifecycleSupervisorSafeString(
    failure.message,
    ARCHIVE_LIFECYCLE_FAILURE_MESSAGE_LIMIT,
  ) || failure.message.length < 1) {
    throw new Error('Archive lifecycle failure message is unsafe or unbounded.')
  }
  validateArchiveLifecycleDiagnostics(failure.archiveLifecycleDiagnostics)
  if (supervisorOwned) {
    const expectedMessage = failure.classification === ARCHIVE_LIFECYCLE_CHILD_TIMEOUT
      ? 'Archive-lifecycle child exceeded the bounded supervisor deadline.'
      : 'Archive-lifecycle child did not publish terminal evidence.'
    if (failure.archiveLifecycleDiagnostics !== null
      || Object.hasOwn(failure, 'closedGateFailures')
      || Object.hasOwn(failure, 'cleanupDiagnostic')
      || failure.message !== expectedMessage) {
      throw new Error('Archive lifecycle supervisor failure diagnostics are invalid.')
    }
    return
  }
  const hasClosedGateFailures = Object.hasOwn(failure, 'closedGateFailures')
  if (hasClosedGateFailures) {
    validateArchiveLifecycleClosedGateFailures(failure.closedGateFailures)
    const metadataReadable = failure.closedGateFailures.metadataReadable !== false
    const expectedClassification = metadataReadable
      ? 'evidence_validation_failure'
      : 'evidence_validation_metadata_failure'
    if (failure.classification !== expectedClassification) {
      throw new Error('Archive lifecycle closed-gate failure classification is invalid.')
    }
  } else if (failure.classification === 'evidence_validation_failure'
    || failure.classification === 'evidence_validation_metadata_failure') {
    throw new Error('Archive lifecycle closed-gate failure details are missing.')
  }
  const hasCleanupDiagnostic = Object.hasOwn(failure, 'cleanupDiagnostic')
  if (hasCleanupDiagnostic) {
    validateArchiveLifecycleCleanupDiagnostic(failure.cleanupDiagnostic)
  }
  if (failure.classification === 'external_liveness_gate_failure'
    && (hasClosedGateFailures || failure.archiveLifecycleDiagnostics === null)) {
    throw new Error('Archive lifecycle liveness failure diagnostics are missing.')
  }
  if (failure.classification === 'lifecycle_failure'
    && (hasClosedGateFailures || hasCleanupDiagnostic
      || failure.archiveLifecycleDiagnostics !== null)) {
    throw new Error('Archive lifecycle generic failure diagnostics are contradictory.')
  }
  if (failure.classification === 'cleanup_failure'
    && (hasClosedGateFailures || !hasCleanupDiagnostic
      || failure.archiveLifecycleDiagnostics !== null)) {
    throw new Error('Archive lifecycle cleanup failure diagnostic is missing.')
  }
  if (failure.classification === 'workload_timeout' && hasClosedGateFailures) {
    throw new Error('Archive lifecycle workload failure details are contradictory.')
  }
}

/** Validates exact cleanup claims and every bounded cleanup failure detail. */
function validateArchiveLifecycleFailureCleanup(value, supervisorOwned, primaryFailure) {
  const cleanup = exactArchiveLifecycleSupervisorRecord(value, [
    'cleanupFailureCount',
    'failures',
    'processCleanupCompleted',
    'profileCleanupCompleted',
  ], [], 'failure cleanup')
  if (!Number.isSafeInteger(cleanup.cleanupFailureCount)
    || cleanup.cleanupFailureCount < 0
    || cleanup.cleanupFailureCount > ARCHIVE_LIFECYCLE_CLEANUP_FAILURE_LIMIT
    || !Array.isArray(cleanup.failures)
    || cleanup.failures.length !== cleanup.cleanupFailureCount
    || typeof cleanup.processCleanupCompleted !== 'boolean'
    || typeof cleanup.profileCleanupCompleted !== 'boolean'
    || cleanup.profileCleanupCompleted && !cleanup.processCleanupCompleted
    || cleanup.cleanupFailureCount === 0
      && (!cleanup.processCleanupCompleted || !cleanup.profileCleanupCompleted)) {
    throw new Error('Archive lifecycle failure cleanup is invalid or contradictory.')
  }
  const seenSteps = new Set()
  for (const [index, detailValue] of cleanup.failures.entries()) {
    const detail = exactArchiveLifecycleSupervisorRecord(detailValue, [
      'step',
      'classification',
      'message',
      'archiveLifecycleDiagnostics',
    ], [], 'cleanup failure detail')
    const validClassification = supervisorOwned
      ? ARCHIVE_LIFECYCLE_SUPERVISOR_FAILURES.has(detail.classification)
      : ARCHIVE_LIFECYCLE_CLEANUP_FAILURES.has(detail.classification)
    if (!ARCHIVE_LIFECYCLE_CLEANUP_STEP.test(detail.step ?? '')
      || !validClassification
      || !archiveLifecycleSupervisorSafeString(
        detail.message,
        ARCHIVE_LIFECYCLE_FAILURE_MESSAGE_LIMIT,
      ) || detail.message.length < 1) {
      throw new Error('Archive lifecycle cleanup failure detail is unsafe or invalid.')
    }
    if (seenSteps.has(detail.step)
      || detail.step.startsWith('cleanup_detail_unreadable_')
        && detail.step !== `cleanup_detail_unreadable_${index}`) {
      throw new Error('Archive lifecycle cleanup failure steps are contradictory.')
    }
    seenSteps.add(detail.step)
    validateArchiveLifecycleDiagnostics(detail.archiveLifecycleDiagnostics)
    if (detail.classification === 'external_liveness_gate_failure'
      && detail.archiveLifecycleDiagnostics === null) {
      throw new Error('Archive lifecycle cleanup liveness diagnostics are missing.')
    }
    if (detail.classification === 'cleanup_failure'
      && detail.archiveLifecycleDiagnostics !== null) {
      throw new Error('Archive lifecycle cleanup failure diagnostics are contradictory.')
    }
  }
  if (supervisorOwned && (cleanup.cleanupFailureCount !== 1
    || cleanup.processCleanupCompleted !== false
    || cleanup.profileCleanupCompleted !== false
    || cleanup.failures[0].step !== 'archive_lifecycle_child_supervisor'
    || cleanup.failures[0].classification !== primaryFailure.classification
    || cleanup.failures[0].message !== primaryFailure.message
    || cleanup.failures[0].archiveLifecycleDiagnostics !== null)) {
    throw new Error('Archive lifecycle supervisor cleanup claims are invalid.')
  }
}

/** Validates final-validator failure metadata without admitting arbitrary fields. */
function validateArchiveLifecycleClosedGateFailures(value) {
  const closed = exactArchiveLifecycleSupervisorRecord(
    value,
    ['failureCount', 'reasons'],
    ['metadataReadable'],
    'closed-gate failure details',
  )
  const metadataUnreadable = closed.metadataReadable === false
  if (Object.hasOwn(closed, 'metadataReadable') && !metadataUnreadable) {
    throw new Error('Archive lifecycle closed-gate readability is invalid.')
  }
  const unreadableSentinel =
    'Archive-lifecycle closed-gate failure details were unreadable.'
  if ((!metadataUnreadable && (!Number.isSafeInteger(closed.failureCount)
      || closed.failureCount < 1))
    || (metadataUnreadable && closed.failureCount !== null
      && (!Number.isSafeInteger(closed.failureCount) || closed.failureCount < 1))
    || !Array.isArray(closed.reasons)
    || closed.reasons.length < 1
    || closed.reasons.length > ARCHIVE_LIFECYCLE_CLOSED_GATE_REASON_LIMIT
    || Number.isSafeInteger(closed.failureCount)
      && closed.reasons.length !== Math.min(
        closed.failureCount,
        ARCHIVE_LIFECYCLE_CLOSED_GATE_REASON_LIMIT,
      )
    || closed.failureCount === null
      && (closed.reasons.length !== 1 || closed.reasons[0] !== unreadableSentinel)
    || metadataUnreadable && !closed.reasons.includes(unreadableSentinel)
    || closed.reasons.some((reason) => !archiveLifecycleSupervisorSafeString(
      reason,
      ARCHIVE_LIFECYCLE_FAILURE_MESSAGE_LIMIT,
    ) || reason.length < 1)) {
    throw new Error('Archive lifecycle closed-gate failure details are unsafe or invalid.')
  }
}

/** Accepts only the normalized cleanup diagnostic contract shared with Electron. */
function validateArchiveLifecycleCleanupDiagnostic(value) {
  const diagnostic = exactArchiveLifecycleSupervisorRecord(value, [
    'substage',
    'causeClass',
    'tableName',
    'cursor',
    'workerExit',
  ], [], 'cleanup diagnostic')
  if (diagnostic.cursor !== null) {
    exactArchiveLifecycleSupervisorRecord(diagnostic.cursor, [
      'tableIndex',
      'tableCount',
      'tableBatch',
      'deletedRows',
      'totalDeletedRows',
    ], [], 'cleanup diagnostic cursor')
  }
  exactArchiveLifecycleSupervisorRecord(diagnostic.workerExit, [
    'observed',
    'event',
    'code',
  ], [], 'cleanup diagnostic worker exit')
  if (!isDeepStrictEqual(normalizeCleanupFailureDiagnostic(diagnostic), diagnostic)) {
    throw new Error('Archive lifecycle cleanup diagnostic is not normalized.')
  }
}

/** Traverses only the child's bounded allow-listed diagnostic value language. */
function validateArchiveLifecycleDiagnostics(value) {
  if (value === null) return
  const budget = { count: 0 }
  validateArchiveLifecycleDiagnosticValue(value, budget, 0)
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Archive lifecycle diagnostics root is invalid.')
  }
}

/** Validates one diagnostic node without trusting unknown keys or unbounded nesting. */
function validateArchiveLifecycleDiagnosticValue(value, budget, depth) {
  budget.count += 1
  if (budget.count > ARCHIVE_LIFECYCLE_DIAGNOSTIC_ENTRY_LIMIT) {
    throw new Error('Archive lifecycle diagnostics exceed their entry bound.')
  }
  if (value === null || typeof value === 'boolean') return
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('Archive lifecycle diagnostics contain a non-finite number.')
    }
    return
  }
  if (typeof value === 'string') {
    if (!archiveLifecycleSupervisorSafeString(
      value,
      ARCHIVE_LIFECYCLE_FAILURE_MESSAGE_LIMIT,
    )) {
      throw new Error('Archive lifecycle diagnostics contain an unsafe string.')
    }
    return
  }
  if (typeof value !== 'object' || depth >= ARCHIVE_LIFECYCLE_DIAGNOSTIC_DEPTH_LIMIT) {
    throw new Error('Archive lifecycle diagnostics contain an invalid value or depth.')
  }
  if (Array.isArray(value)) {
    if (value.length > ARCHIVE_LIFECYCLE_DIAGNOSTIC_ARRAY_LIMIT) {
      throw new Error('Archive lifecycle diagnostic array exceeds its bound.')
    }
    for (const entry of value) {
      validateArchiveLifecycleDiagnosticValue(entry, budget, depth + 1)
    }
    return
  }
  for (const [key, entry] of Object.entries(value)) {
    if (!ARCHIVE_LIFECYCLE_DIAGNOSTIC_KEYS.has(key)) {
      throw new Error('Archive lifecycle diagnostics contain an unknown field.')
    }
    validateArchiveLifecycleDiagnosticValue(entry, budget, depth + 1)
  }
}

/** Returns an exact parsed JSON object or rejects extra/missing fields. */
function exactArchiveLifecycleSupervisorRecord(value, required, optional, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Archive lifecycle ${label} is invalid.`)
  }
  const keys = Object.keys(value)
  const allowed = new Set([...required, ...optional])
  if (required.some((key) => !Object.hasOwn(value, key))
    || keys.some((key) => !allowed.has(key))) {
    throw new Error(`Archive lifecycle ${label} fields are invalid.`)
  }
  return value
}

/** Checks one bounded string against path and custody-shaped private material. */
function archiveLifecycleSupervisorSafeString(value, limit) {
  return typeof value === 'string'
    && value.length <= limit
    && !ARCHIVE_LIFECYCLE_ABSOLUTE_PATH.test(value)
    && !ARCHIVE_LIFECYCLE_RELATIVE_PATH.test(value)
    && !/(?:[0-9A-HJKMNP-TV-Z]{5}-){7}[0-9A-HJKMNP-TV-Z]{5}/u.test(value)
}

/** Accepts only finite ISO timestamp strings. */
function archiveLifecycleSupervisorTimestampIsValid(value) {
  return typeof value === 'string'
    && value.length <= 40
    && !Number.isNaN(Date.parse(value))
}

/** Captures one finite parent observation at or after this supervisor invocation began. */
function observeArchiveLifecycleSupervisorTime(nowMs, startedAtMs) {
  if (typeof nowMs !== 'function') {
    throw new Error('Archive lifecycle supervisor observation clock is invalid.')
  }
  const observedAtMs = nowMs()
  if (!Number.isSafeInteger(observedAtMs)
    || observedAtMs < startedAtMs
    || Number.isNaN(new Date(observedAtMs).getTime())) {
    throw new Error('Archive lifecycle supervisor observation time is invalid.')
  }
  return observedAtMs
}

/** Reads one expected evidence inode and rejects unsafe mode, type, or size. */
async function readArchiveLifecycleSupervisorArtifactIdentity(candidatePath) {
  try {
    const identity = await lstat(candidatePath)
    if (!identity.isFile() || identity.isSymbolicLink()
      || identity.size < 1 || identity.size > ARCHIVE_LIFECYCLE_ARTIFACT_LIMIT_BYTES
      || (identity.mode & 0o777) !== 0o600) {
      throw new Error('Archive-lifecycle terminal evidence identity is unsafe or unbounded.')
    }
    return identity
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

/** Returns whether two terminal-file observations retain one exact inode topology. */
function sameArchiveLifecycleSupervisorArtifactIdentity(left, right) {
  return sameArchiveLifecycleSupervisorArtifactContentIdentity(left, right)
    && left.nlink === right.nlink
}

/** Pins immutable terminal contents while separately checking publication links. */
function sameArchiveLifecycleSupervisorArtifactContentIdentity(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mode === right.mode
}

/** Classifies only one owner-to-verdict link addition; callers still reject the read. */
function terminalArtifactReadChanged(message, expected, observations) {
  const error = new Error(message)
  if (expected.nlink === 2 && observations.every((identity) => identity !== null
    && sameArchiveLifecycleSupervisorArtifactContentIdentity(identity, expected)
    && (identity.nlink === 2 || identity.nlink === 3))
    && observations.some((identity) => identity.nlink === 3)) {
    error.code = 'ARCHIVE_LIFECYCLE_OWNER_LINK_SETTLING'
  }
  return error
}

/** Reads a terminal file through a descriptor pinned to its validated path identity. */
async function readArchiveLifecycleSupervisorPinnedArtifact(candidatePath, expectedIdentity) {
  const handle = await open(
    candidatePath,
    fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0),
  )
  try {
    const openedIdentity = await handle.stat()
    if (!sameArchiveLifecycleSupervisorArtifactIdentity(openedIdentity, expectedIdentity)) {
      throw terminalArtifactReadChanged(
        'Archive-lifecycle terminal evidence changed before it could be read.',
        expectedIdentity, [openedIdentity],
      )
    }
    const contents = await handle.readFile('utf8')
    const [afterReadIdentity, namedIdentity] = await Promise.all([
      handle.stat(),
      readArchiveLifecycleSupervisorArtifactIdentity(candidatePath),
    ])
    if (namedIdentity === null
      || !sameArchiveLifecycleSupervisorArtifactIdentity(afterReadIdentity, expectedIdentity)
      || !sameArchiveLifecycleSupervisorArtifactIdentity(namedIdentity, expectedIdentity)) {
      throw terminalArtifactReadChanged(
        'Archive-lifecycle terminal evidence changed while it was read.',
        expectedIdentity, [afterReadIdentity, namedIdentity],
      )
    }
    return contents
  } finally {
    await handle.close()
  }
}

/** Requires the caller-held terminal run and receipt source to be identical. */
function assertArchiveLifecycleSupervisorTerminalRunMatches(input) {
  const source = input?.source
  assertArchiveLifecycleSupervisorTerminalRun(input?.terminalRun)
  if (input?.evidenceDir !== input.terminalRun.evidenceDir
    || !ARCHIVE_LIFECYCLE_SUPERVISOR_FAILURES.has(input?.failureClassification)
    || (input?.childExitCode !== null
      && (!Number.isSafeInteger(input?.childExitCode)
        || input.childExitCode < 0 || input.childExitCode > 255))
    || (input?.childSettled !== undefined && typeof input.childSettled !== 'boolean')
    || (input?.childExitCode !== null && input?.childSettled === false)
    || source?.expectedHead !== input.terminalRun.expectedHead
    || source?.expectedTree !== input.terminalRun.expectedTree
    || source?.observedHead !== input.terminalRun.observedHead
    || source?.observedTree !== input.terminalRun.observedTree
    || source?.worktreeClean !== input.terminalRun.worktreeClean
    || input?.startedAtMs !== input.terminalRun.startedAtMs) {
    throw new Error('Archive-lifecycle terminal run does not match the exact source.')
  }
}

/** Validates one immutable parent-held terminal run. */
function assertArchiveLifecycleSupervisorTerminalRun(terminalRun) {
  if (terminalRun === null || typeof terminalRun !== 'object' || Array.isArray(terminalRun)
    || typeof terminalRun.evidenceDir !== 'string'
    || !path.isAbsolute(terminalRun.evidenceDir)
    || terminalRun.evidenceIdentity === null
    || typeof terminalRun.evidenceIdentity !== 'object'
    || Array.isArray(terminalRun.evidenceIdentity)
    || !Number.isSafeInteger(terminalRun.evidenceIdentity.dev)
    || !Number.isSafeInteger(terminalRun.evidenceIdentity.ino)
    || terminalRun.evidenceIdentity.realPath !== terminalRun.evidenceDir
    || typeof terminalRun.leaseDir !== 'string'
    || !path.isAbsolute(terminalRun.leaseDir)
    || terminalRun.leaseDir
      !== archiveLifecycleSupervisorLeaseDirectory(terminalRun.evidenceDir)
    || terminalRun.leaseIdentity === null
    || typeof terminalRun.leaseIdentity !== 'object'
    || Array.isArray(terminalRun.leaseIdentity)
    || !Number.isSafeInteger(terminalRun.leaseIdentity.dev)
    || !Number.isSafeInteger(terminalRun.leaseIdentity.ino)
    || terminalRun.leaseIdentity.realPath !== terminalRun.leaseDir
    || typeof terminalRun.childEvidenceDir !== 'string'
    || !path.isAbsolute(terminalRun.childEvidenceDir)
    || path.resolve(terminalRun.evidenceDir) !== terminalRun.evidenceDir
    || path.resolve(terminalRun.childEvidenceDir) !== terminalRun.childEvidenceDir
    || terminalRun.childEvidenceDir === terminalRun.evidenceDir
    || path.dirname(terminalRun.childEvidenceDir) !== path.dirname(terminalRun.evidenceDir)
    || terminalRun.childEvidenceDir
      !== archiveLifecycleSupervisorChildEvidenceDirectory(terminalRun.evidenceDir)
    || terminalRun.childEvidenceIdentity === null
    || typeof terminalRun.childEvidenceIdentity !== 'object'
    || Array.isArray(terminalRun.childEvidenceIdentity)
    || !Number.isSafeInteger(terminalRun.childEvidenceIdentity.dev)
    || !Number.isSafeInteger(terminalRun.childEvidenceIdentity.ino)
    || terminalRun.childEvidenceIdentity.realPath !== terminalRun.childEvidenceDir
    || !UUID_V4.test(terminalRun.runId ?? '')
    || !GIT_SHA.test(terminalRun.expectedHead ?? '')
    || !GIT_SHA.test(terminalRun.expectedTree ?? '')
    || (terminalRun.observedHead !== null && !GIT_SHA.test(terminalRun.observedHead ?? ''))
    || (terminalRun.observedTree !== null && !GIT_SHA.test(terminalRun.observedTree ?? ''))
    || (terminalRun.observedHead === null) !== (terminalRun.observedTree === null)
    || typeof terminalRun.worktreeClean !== 'boolean'
    || terminalRun.observedHead === null && terminalRun.worktreeClean !== false
    || !Number.isSafeInteger(terminalRun.startedAtMs) || terminalRun.startedAtMs < 0
    || Number.isNaN(new Date(terminalRun.startedAtMs).getTime())) {
    throw new Error('Archive-lifecycle supervisor terminal run is invalid.')
  }
}

/** Rejects broad or protected canonical evidence recreation boundaries. */
async function requireArchiveLifecycleSupervisorRecreationBoundary(
  evidenceDir,
  protectedPaths,
) {
  const root = path.parse(evidenceDir).root
  const containsProtectedPath = protectedPaths.some((protectedPath) => {
    const relative = path.relative(evidenceDir, path.resolve(protectedPath))
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
  })
  if (evidenceDir === root || evidenceDir === os.homedir()
    || evidenceDir === projectRoot || evidenceDir === path.resolve(os.tmpdir())
    || containsProtectedPath) {
    throw new Error('Archive-lifecycle supervisor evidence directory is too broad.')
  }
  const parent = path.dirname(evidenceDir)
  await mkdir(parent, { recursive: true, mode: 0o700 })
  await assertArchiveLifecycleSupervisorDirectorySafe(parent, false)
}

/** Requires one canonical real directory with no symlink boundary. */
async function assertArchiveLifecycleSupervisorDirectorySafe(directory, ownerOnly = true) {
  const identity = await lstat(directory)
  if (!identity.isDirectory() || identity.isSymbolicLink()
    || ownerOnly && (identity.mode & 0o777) !== 0o700
    || await realpath(directory) !== directory) {
    throw new Error('Archive-lifecycle supervisor evidence directory is unsafe.')
  }
}

/** Flushes fresh-run and terminal-link directory mutations. */
async function syncArchiveLifecycleSupervisorDirectory(directory) {
  const handle = await open(directory, fsConstants.O_RDONLY)
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

/** Returns parent-owned canonical or child-only staging artifact paths. */
function archiveLifecycleSupervisorTerminalPaths(evidenceDir, runId = null) {
  return Object.freeze({
    ownerPath: path.join(evidenceDir, ARCHIVE_LIFECYCLE_OWNER_FILE),
    runOwnerPath: runId === null
      ? null
      : path.join(evidenceDir, `${ARCHIVE_LIFECYCLE_RUN_OWNER_PREFIX}${runId}.json`),
    successPath: path.join(evidenceDir, ARCHIVE_LIFECYCLE_SUCCESS_FILE),
    failurePath: path.join(evidenceDir, ARCHIVE_LIFECYCLE_FAILURE_FILE),
  })
}

/** Rejects unexpected private or path-bearing data in the fixed fallback receipt. */
function assertArchiveLifecycleSupervisorFailureReceiptSafe(receipt) {
  if (receipt === null || typeof receipt !== 'object' || Array.isArray(receipt)
    || receipt.schemaVersion !== 1
    || receipt.proofKind !== 'packaged-electron-archive-lifecycle-failure-v1'
    || receipt.verdict?.passed !== false
    || receipt.cleanup?.processCleanupCompleted !== false
    || receipt.cleanup?.profileCleanupCompleted !== false) {
    throw new Error('Archive-lifecycle supervisor failure receipt schema is invalid.')
  }
  const serialized = JSON.stringify(receipt)
  if (serialized.length >= ARCHIVE_LIFECYCLE_SUPERVISOR_RECEIPT_LIMIT_BYTES
    || /(?:^|[\s"'])\/(?:[A-Za-z0-9_.-]+[\/A-Za-z0-9_.-]*)/u.test(serialized)
    || /"(?:stack|passphrase|recoveryCode|missionId|deviceId|profilePath|evidenceDir)"/u
      .test(serialized)) {
    throw new Error('Archive-lifecycle supervisor failure receipt is unsafe or unbounded.')
  }
}

/** Records whether no late direct-child write remains possible after a wait failure. */
function markArchiveLifecycleChildSettlement(error, childSettled) {
  if (error === null || typeof error !== 'object') return error
  try {
    Object.defineProperty(error, 'archiveLifecycleChildSettled', {
      configurable: true,
      value: childSettled,
      writable: true,
    })
  } catch {
    // A non-extensible foreign error remains conservatively unsettled.
  }
  return error
}

/** Releases an unreaped child handle only after owned exit observation expires. */
function releaseArchiveLifecycleChildHandle(child) {
  if (typeof child.unref !== 'function') return
  try {
    child.unref()
  } catch {
    // The reap-deadline rejection must remain bounded even if unref itself fails.
  }
}

/** Sends one hard stop to the owned POSIX group, with a direct-child fallback. */
function signalArchiveLifecycleProcessTree(child, dependencies) {
  let processGroupSignaled = false
  if (dependencies.platform !== 'win32'
    && Number.isSafeInteger(child.pid) && child.pid > 0) {
    try {
      processGroupSignaled = dependencies.killProcess(-child.pid, 'SIGKILL') !== false
    } catch {
      processGroupSignaled = false
    }
  }
  if (processGroupSignaled) return
  try {
    child.kill('SIGKILL')
  } catch {
    // The bounded reap deadline still settles ownership if direct signaling throws.
  }
}

/** Reads the exact checked-out commit and rejects CI identity drift. */
async function readExactHead() {
  const result = await execFileAsync('git', ['rev-parse', 'HEAD'], {
    cwd: projectRoot,
    encoding: 'utf8',
  })
  const head = result.stdout.trim()
  if (!/^[0-9a-f]{40}$/u.test(head)) {
    throw new Error('The packaged archive-lifecycle checkout head is invalid.')
  }
  const workflowHead = process.env.EXPECTED_SOURCE_SHA
  if (workflowHead !== undefined && workflowHead !== '' && workflowHead !== head) {
    throw new Error('The packaged archive-lifecycle checkout does not match EXPECTED_SOURCE_SHA.')
  }
  return head
}

/** Captures expected identity plus one coherent observed HEAD/status snapshot. */
export async function readExactSourceIdentity(expectedHead, dependencies = {}) {
  if (!GIT_SHA.test(expectedHead ?? '')) {
    throw new Error('The packaged archive-lifecycle expected head is invalid.')
  }
  const execute = dependencies.execFile ?? execFileAsync
  if (typeof execute !== 'function') {
    throw new Error('The packaged archive-lifecycle source reader is invalid.')
  }
  const treeResult = await execute('git', ['rev-parse', `${expectedHead}^{tree}`], {
    cwd: projectRoot,
    encoding: 'utf8',
  })
  const expectedTree = treeResult.stdout.trim()
  if (!GIT_SHA.test(expectedTree)) {
    throw new Error('The packaged archive-lifecycle checkout tree is invalid.')
  }

  let observedHead = null
  let observedTree = null
  let worktreeClean = false
  try {
    const statusResult = await execute('git', [
      'status',
      '--porcelain=v2',
      '--branch',
      '--untracked-files=all',
    ], {
      cwd: projectRoot,
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024,
    })
    const status = statusResult.stdout.trim()
    const branchOid = /^# branch\.oid ([0-9a-f]{40})$/mu.exec(status)?.[1] ?? null
    if (branchOid !== null) {
      const observedTreeResult = await execute('git', [
        'rev-parse',
        `${branchOid}^{tree}`,
      ], {
        cwd: projectRoot,
        encoding: 'utf8',
      })
      const candidateTree = observedTreeResult.stdout.trim()
      if (GIT_SHA.test(candidateTree)) {
        observedHead = branchOid
        observedTree = candidateTree
        worktreeClean = status.split(/\r?\n/u).every(
          (line) => line === '' || line.startsWith('# '),
        )
      }
    }
  } catch {
    observedHead = null
    observedTree = null
    worktreeClean = false
  }
  return Object.freeze({
    expectedHead,
    expectedTree,
    observedHead,
    observedTree,
    worktreeClean,
  })
}

/** Locates the just-built unpacked Electron executable for this runner. */
async function findPackagedExecutable() {
  const architecture = os.arch() === 'arm64' ? 'arm64' : 'x64'
  const candidates = process.platform === 'darwin'
    ? [
        path.join(
          projectRoot,
          'tmp',
          'electron-dist',
          `mac-${architecture}`,
          'SAR Tracker Electron Validation.app',
          'Contents',
          'MacOS',
          'SAR Tracker Electron Validation',
        ),
      ]
    : process.platform === 'linux'
      ? [path.join(projectRoot, 'tmp', 'electron-dist', 'linux-unpacked', 'sartracker-web')]
      : []
  for (const candidate of candidates) {
    if (await access(candidate).then(() => true).catch(() => false)) return candidate
  }
  throw new Error(
    `Could not find the packaged ${process.platform}/${architecture} Electron executable. Run the Electron pack step first.`,
  )
}
