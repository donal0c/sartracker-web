import { createHash } from 'node:crypto'

const SHA256 = /^[a-f0-9]{64}$/u
const REQUIRED_RUNTIME_MARKERS = Object.freeze([
  'storage_backup_started',
  'storage_previous_run_interrupted',
  'storage_main_event_loop_summary',
])
const ORACLE_INPUT_SCHEMA_VERSION = 1
const ORACLE_INPUT_REDACTION = 'bounded-marker-and-metric-extract-v1'
const BACKUP_FAULT_ORACLE_SCHEMA_VERSION = 1
const BACKUP_FAULT_ORACLE_REDACTION = 'bounded-backup-fault-facts-v1'
export const BACKUP_FAULT_VARIANTS = Object.freeze([
  'disk-full',
  'permission',
  'corrupt-temp',
  'busy-wal',
  'concurrent-writes',
  'worker-crash',
  'stale-good-mirror',
])

/** Parses the fail-closed packaged kill/restart probe CLI. */
export function parseStorageKillProbeArgs(argv) {
  const args = { extraArgs: [] }
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    const nextValue = () => {
      const value = argv[index + 1]
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`${token} requires a value.`)
      }
      index += 1
      return value
    }
    switch (token) {
      case '--app':
        args.appPath = nextValue()
        break
      case '--fixture':
        args.fixturePath = nextValue()
        break
      case '--evidence':
        args.evidenceDir = nextValue()
        break
      case '--timeout-ms':
        args.timeoutMs = Number(nextValue())
        break
      case '--post-restart-observation-ms':
        args.postRestartObservationMs = Number(nextValue())
        break
      case '--variant':
        args.variant = nextValue()
        if (!['abrupt-recovery', ...BACKUP_FAULT_VARIANTS].includes(args.variant)) {
          throw new Error(`Unknown C18 backup variant: ${args.variant}`)
        }
        break
      case '--enospc-mount':
        args.enospcMount = nextValue()
        break
      case '--':
        args.extraArgs.push(...argv.slice(index + 1))
        index = argv.length
        break
      default:
        throw new Error(`Unknown argument: ${token}`)
    }
  }
  if (!args.appPath) throw new Error('--app <packaged Electron binary> is required.')
  if (!args.fixturePath) throw new Error('--fixture <mission-store.sqlite> is required.')
  const timeoutMs = args.timeoutMs ?? 180_000
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('--timeout-ms must be a positive number.')
  }
  const postRestartObservationMs = args.postRestartObservationMs ?? 35_000
  if (!Number.isFinite(postRestartObservationMs) || postRestartObservationMs < 30_000) {
    throw new Error('--post-restart-observation-ms must be at least 30000.')
  }
  return {
    appPath: args.appPath,
    fixturePath: args.fixturePath,
    evidenceDir: args.evidenceDir ?? 'output/storage-diagnostics-kill-probe',
    timeoutMs,
    postRestartObservationMs,
    extraArgs: args.extraArgs,
    ...(args.variant === undefined ? {} : { variant: args.variant }),
    ...(args.enospcMount === undefined ? {} : { enospcMount: args.enospcMount }),
  }
}

/**
 * Extracts the bounded, redacted values needed by the storage-kill oracle.
 *
 * Runtime logs and support bundles may contain paths or operator data. The
 * receipt therefore carries only the exact lifecycle markers, enum operation
 * fields and numeric event-loop metric that the existing verdict reads. Full
 * source text remains available only in the probe-owned local evidence files.
 */
export function buildStorageKillProbeOracleInput(input) {
  const runtimeLog = String(input?.runtimeLog ?? '')
  const supportBundle = String(input?.supportBundle ?? '')
  const markers = REQUIRED_RUNTIME_MARKERS.filter((marker) => runtimeLog.includes(marker))
  const supportLines = []
  if (supportBundle.includes('[storage-diagnostics]')) supportLines.push('[storage-diagnostics]')
  if (supportBundle.includes('previous interrupted operation: backup started')) {
    supportLines.push('previous interrupted operation: backup started')
  }
  const eventLoopMatch = supportBundle.match(/event loop latest maximum delay ms: ([1-9][0-9]*)/u)
  if (eventLoopMatch !== null) supportLines.push(`event loop latest maximum delay ms: ${eventLoopMatch[1]}`)
  return {
    schemaVersion: ORACLE_INPUT_SCHEMA_VERSION,
    redaction: ORACLE_INPUT_REDACTION,
    beforeKill: {
      activeOperation: projectOperation(input?.beforeKill?.activeOperation),
    },
    afterRestart: {
      activeOperation: input?.afterRestart?.activeOperation === null
        ? null
        : projectOperation(input?.afterRestart?.activeOperation),
      previousInterruptedOperation: projectOperation(input?.afterRestart?.previousInterruptedOperation),
    },
    runtimeLog: {
      markers,
      evidence: markers.join('\n'),
      bytes: Buffer.byteLength(runtimeLog, 'utf8'),
      sha256: sha256Text(runtimeLog),
    },
    supportBundle: {
      requiredLines: supportLines,
      evidence: supportLines.join('\n'),
      eventLoopLatestMaximumDelayMs: eventLoopMatch === null ? null : Number(eventLoopMatch[1]),
      bytes: Buffer.byteLength(supportBundle, 'utf8'),
      sha256: sha256Text(supportBundle),
    },
    privacy: (input?.forbiddenValues ?? [])
      .filter((value) => value !== '')
      .map((value, index) => ({
        label: `forbidden-value-${index + 1}`,
        valueSha256: sha256Text(String(value)),
        matchCount: countOccurrences(supportBundle, String(value)),
      })),
  }
}

/** Produces a machine-readable, fail-closed packaged kill/restart verdict. */
export function buildStorageKillProbeVerdict(input) {
  const failures = []
  const runtimeLog = evidenceText(input?.runtimeLog)
  const supportBundle = evidenceText(input?.supportBundle)
  if (
    input.beforeKill?.activeOperation?.type !== 'backup' ||
    input.beforeKill?.activeOperation?.stage !== 'started'
  ) {
    failures.push('The durable checkpoint was not at backup started before kill.')
  }
  if (
    input.afterRestart?.activeOperation !== null ||
    input.afterRestart?.previousInterruptedOperation?.type !== 'backup' ||
    input.afterRestart?.previousInterruptedOperation?.stage !== 'started'
  ) {
    failures.push('The checkpoint did not expose the interrupted backup start after restart.')
  }
  if (
    !runtimeLog.includes('storage_backup_started') ||
    !runtimeLog.includes('storage_previous_run_interrupted')
  ) {
    failures.push('The runtime log is missing the pre-kill or restart interruption marker.')
  }
  if (!runtimeLog.includes('storage_main_event_loop_summary')) {
    failures.push('The runtime log is missing the packaged main event-loop delay summary.')
  }
  if (
    !supportBundle.includes('[storage-diagnostics]') ||
    !supportBundle.includes(
      'previous interrupted operation: backup started',
    )
  ) {
    failures.push('The support bundle is missing interrupted storage-operation evidence.')
  }
  if (!/event loop latest maximum delay ms: [1-9][0-9]*/u.test(supportBundle)) {
    failures.push('The support bundle is missing a measured event-loop delay summary.')
  }
  if (Array.isArray(input.privacy)) {
    for (const check of input.privacy) {
      if (!Number.isSafeInteger(check?.matchCount) || check.matchCount < 0) {
        failures.push(`Structured privacy observation is malformed: ${String(check?.label)}`)
      } else if (check.matchCount > 0) {
        failures.push(`Structured privacy observation found a forbidden value: ${String(check.label)}`)
      }
    }
  }
  for (const forbiddenValue of input.forbiddenValues ?? []) {
    if (forbiddenValue !== '' && supportBundle.includes(forbiddenValue)) {
      failures.push(`The support bundle contains a forbidden value: ${forbiddenValue}`)
    }
  }
  return { passed: failures.length === 0, failures }
}

/**
 * Projects one backup-fault run into bounded facts consumed by the independent
 * C18 oracle. Paths, operation IDs and arbitrary native error text stay in the
 * probe-owned evidence files and never become receipt predicates.
 */
export function buildStorageBackupFaultOracleInput(input) {
  const variant = BACKUP_FAULT_VARIANTS.includes(input?.variant) ? input.variant : null
  return {
    schemaVersion: BACKUP_FAULT_ORACLE_SCHEMA_VERSION,
    redaction: BACKUP_FAULT_ORACLE_REDACTION,
    variant,
    outcome: normalizeFaultOutcome(input?.outcome),
    error: projectFaultError(input?.error),
    sourceBefore: projectFileFact(input?.sourceBefore),
    sourceAfter: projectFileFact(input?.sourceAfter),
    mirrorBefore: projectMirrorFact(input?.mirrorBefore),
    mirrorAfter: projectMirrorFact(input?.mirrorAfter),
    temporaryFilesAfter: projectTemporaryFiles(input?.temporaryFilesAfter),
    permission: projectPermissionFacts(input?.permission),
    snapshot: projectBooleanFacts(input?.snapshot, ['temporaryCorrupted', 'sanityRejected']),
    busyWal: projectBooleanFacts(input?.busyWal, ['writeTransactionHeld', 'backupCompleted', 'released']),
    concurrentWrites: projectConcurrentWriteFacts(input?.concurrentWrites),
    worker: projectBooleanFacts(input?.worker, ['attempted', 'crashed', 'targetAbsent']),
    staleMirror: input?.staleMirror === true,
    diskFull: projectDiskFullFacts(input?.diskFull),
    precondition: projectPrecondition(input?.precondition),
  }
}

/** Validates one fixed C18 backup-fault variant without trusting producer verdict fields. */
export function buildStorageBackupFaultVerdict(input) {
  const failures = []
  const variant = input?.variant
  if (input?.schemaVersion !== BACKUP_FAULT_ORACLE_SCHEMA_VERSION
      || input?.redaction !== BACKUP_FAULT_ORACLE_REDACTION
      || !BACKUP_FAULT_VARIANTS.includes(variant)) {
    failures.push('Backup fault oracle schema or fixed variant identity is invalid.')
  }
  if (variant === 'disk-full') {
    const unavailable = input?.outcome === 'unavailable'
      && input.precondition?.kind === 'bounded-enospc'
      && input.precondition.observed === false
      && typeof input.precondition.reason === 'string'
      && input.precondition.reason.length > 0
    const ready = input?.precondition?.kind === 'bounded-enospc'
      && input.precondition.status === 'READY'
      && input.precondition.observed === true
      && input.precondition.deviceDistinct === true
      && input.precondition.totalBytes <= 64 * 1024 * 1024
      && input.precondition.availableBytes >= 0
    const concrete = ready && input?.outcome === 'failed'
      && input.error?.code === 'ENOSPC'
      && input.diskFull?.fillerAttempted === true
      && input.diskFull.observedEnospc === true
      && input.diskFull.backupErrorObserved === true
      && hasUnchangedValidMirror(input)
      && Array.isArray(input.temporaryFilesAfter)
      && input.temporaryFilesAfter.length === 0
    if (concrete) return result([], 'PASS', false)
    if (!unavailable && !ready) failures.push('Disk-full requires a reviewed bounded writable volume distinct from the evidence filesystem.')
    if (!concrete && ready) failures.push('Disk-full volume was ready but no actual ENOSPC backup rejection was observed.')
    return result(failures, unavailable ? 'UNAVAILABLE' : 'INVALID_EVIDENCE', unavailable)
  }

  if (variant === 'busy-wal' || variant === 'concurrent-writes') {
    if (!isValidMirror(input?.mirrorAfter)) failures.push('The resulting mirror is not independently integrity-valid.')
  } else if (!hasUnchangedValidMirror(input)) {
    failures.push('The prior good mirror was not independently shown unchanged and integrity-valid.')
  }
  if (!Array.isArray(input?.temporaryFilesAfter) || input.temporaryFilesAfter.length !== 0) {
    failures.push('Temporary backup files remain after the fault run.')
  }

  switch (variant) {
    case 'permission':
      if (input.outcome !== 'failed') {
        failures.push('Permission variant did not fail the backup operation.')
      }
      const denial = input.permission?.denial
      const independentlyDenied = denial?.independentWriteAttempted === true
        && ['EACCES', 'EPERM'].includes(denial.observedCode)
        && denial.target === 'store-directory'
        && denial.modeBefore === 0o700
        && denial.modeDenied === 0o500
        && denial.modeRestored === 0o700
      const backupFailureTiedToDenial = ['EACCES', 'EPERM'].includes(input.error?.code)
        || (independentlyDenied
          && input.error?.name === 'SqliteError'
          && input.error?.messageClass === 'sqlite-cannot-open-database')
      if (!backupFailureTiedToDenial) {
        failures.push('Permission variant lacks an independent same-directory denial tied to the observed backup failure.')
      }
      if (!input.permission?.attempted || !input.permission.observed || !input.permission.restored
          || !independentlyDenied) {
        failures.push('Permission fault setup, observation, or restoration is incomplete.')
      }
      break
    case 'corrupt-temp':
      if (input.outcome !== 'failed' || input.snapshot?.temporaryCorrupted !== true
          || input.snapshot?.sanityRejected !== true) {
        failures.push('Corrupt-temp variant did not show production sanity rejection of the mutated temporary snapshot.')
      }
      break
    case 'busy-wal':
      if (input.outcome !== 'completed' || input.busyWal?.writeTransactionHeld !== true
          || input.busyWal?.backupCompleted !== true || input.busyWal?.released !== true) {
        failures.push('Busy-WAL variant did not retain the held-write, backup-complete, and release observations.')
      }
      break
    case 'concurrent-writes':
      if (input.outcome !== 'completed' || input.concurrentWrites?.attemptedCount !== 2
          || input.concurrentWrites?.completedCount !== 2 || input.concurrentWrites?.serialized !== true
          || input.concurrentWrites?.mutationKind !== 'add-mission-participant'
          || input.concurrentWrites?.acceptedMutationCount !== 2
          || input.concurrentWrites?.durableRowCount !== 2
          || input.concurrentWrites?.auditEventCount < 2
          || input.concurrentWrites?.postMutationBackupCompleted !== true
          || input.concurrentWrites?.retryCompleted !== true
          || !differentFileIdentity(input.sourceBefore, input.sourceAfter)) {
        failures.push('Concurrent-writes variant did not prove two accepted domain mutations, durable audit rows, and post-mutation backup/retry custody.')
      }
      break
    case 'worker-crash':
      if (input.outcome !== 'failed' || input.worker?.attempted !== true
          || input.worker?.crashed !== true || input.worker?.targetAbsent !== true) {
        failures.push('Worker-crash variant did not retain an actual crashed worker and absent temporary target.')
      }
      break
    case 'stale-good-mirror':
      if (input.outcome !== 'failed' || input.staleMirror !== true
          || !differentFileIdentity(input.sourceBefore, input.sourceAfter)) {
        failures.push('Stale-mirror variant did not show a changed source after preserving the valid prior mirror.')
      }
      break
    default:
      failures.push('Backup fault variant is unavailable to the fixed C18 oracle.')
  }
  return result(failures, failures.length === 0 ? 'PASS' : 'INVALID_EVIDENCE', false)
}

function result(failures, status, unavailable) {
  return {
    passed: failures.length === 0 && status === 'PASS',
    status,
    unavailable: status === 'UNAVAILABLE' || unavailable === true,
    failures,
  }
}

function hasUnchangedValidMirror(input) {
  const before = input?.mirrorBefore
  const after = input?.mirrorAfter
  return isFileFact(before) && isFileFact(after)
    && before.sha256 === after.sha256 && before.bytes === after.bytes
    && before.integrity === 'ok' && after.integrity === 'ok'
}

function isValidMirror(value) {
  return isFileFact(value) && value.integrity === 'ok'
}

function differentFileIdentity(before, after) {
  return isFileFact(before) && isFileFact(after)
    && (before.sha256 !== after.sha256 || before.bytes !== after.bytes)
}

function projectFaultError(value) {
  if (value === null || typeof value !== 'object') return { name: null, code: null, messageClass: null }
  return {
    name: typeof value.name === 'string' && /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/u.test(value.name) ? value.name : null,
    code: typeof value.code === 'string' && /^[A-Z][A-Z0-9_.-]{0,79}$/u.test(value.code) ? value.code : null,
    messageClass: /unable to open database file/iu.test(String(value.message ?? ''))
      ? 'sqlite-cannot-open-database'
      : null,
  }
}

function projectFileFact(value) {
  if (value === null || typeof value !== 'object') return null
  const bytes = Number(value.bytes)
  return {
    sha256: SHA256.test(String(value.sha256)) ? String(value.sha256) : null,
    bytes: Number.isSafeInteger(bytes) && bytes >= 0 ? bytes : null,
  }
}

function projectMirrorFact(value) {
  const fact = projectFileFact(value)
  return fact === null ? null : {
    ...fact,
    integrity: value.integrity === 'ok' ? 'ok' : value.integrity === 'failed' ? 'failed' : null,
  }
}

function projectTemporaryFiles(value) {
  if (!Array.isArray(value)) return null
  return value.filter((entry) => typeof entry === 'string' && /^[A-Za-z0-9._-]{1,180}$/u.test(entry))
}

function projectBooleanFacts(value, keys) {
  if (value === null || typeof value !== 'object') return null
  return Object.fromEntries(keys.map((key) => [key, value[key] === true]))
}

function projectPermissionFacts(value) {
  if (value === null || typeof value !== 'object') return null
  const denial = value.denial
  return {
    ...projectBooleanFacts(value, ['attempted', 'observed', 'restored']),
    denial: denial === null || typeof denial !== 'object' ? null : {
      independentWriteAttempted: denial.independentWriteAttempted === true,
      observedCode: ['EACCES', 'EPERM'].includes(denial.observedCode) ? denial.observedCode : null,
      target: denial.target === 'store-directory' ? denial.target : null,
      modeBefore: Number(denial.modeBefore) === 0o700 ? 0o700 : null,
      modeDenied: Number(denial.modeDenied) === 0o500 ? 0o500 : null,
      modeRestored: Number(denial.modeRestored) === 0o700 ? 0o700 : null,
    },
  }
}

function projectCountFacts(value) {
  if (value === null || typeof value !== 'object') return null
  const count = (key) => Number.isSafeInteger(Number(value[key])) && Number(value[key]) >= 0 ? Number(value[key]) : null
  return { attemptedCount: count('attemptedCount'), completedCount: count('completedCount'), serialized: value.serialized === true }
}

function projectConcurrentWriteFacts(value) {
  if (value === null || typeof value !== 'object') return null
  const count = (key) => Number.isSafeInteger(Number(value[key])) && Number(value[key]) >= 0 ? Number(value[key]) : null
  return {
    attemptedCount: count('attemptedCount'),
    completedCount: count('completedCount'),
    serialized: value.serialized === true,
    mutationKind: value.mutationKind === 'add-mission-participant' ? value.mutationKind : null,
    acceptedMutationCount: count('acceptedMutationCount'),
    durableRowCount: count('durableRowCount'),
    auditEventCount: count('auditEventCount'),
    postMutationBackupCompleted: value.postMutationBackupCompleted === true,
    retryCompleted: value.retryCompleted === true,
  }
}

function projectDiskFullFacts(value) {
  if (value === null || typeof value !== 'object') return null
  const count = (key) => Number.isSafeInteger(Number(value[key])) && Number(value[key]) >= 0 ? Number(value[key]) : null
  return {
    fillerAttempted: value.fillerAttempted === true,
    observedEnospc: value.observedEnospc === true,
    backupErrorObserved: value.backupErrorObserved === true,
    filledBytes: count('filledBytes'),
    maxFillBytes: count('maxFillBytes'),
  }
}

function projectPrecondition(value) {
  if (value === null || typeof value !== 'object') return null
  return {
    kind: typeof value.kind === 'string' && /^[a-z0-9-]{1,80}$/u.test(value.kind) ? value.kind : null,
    status: value.status === 'READY' || value.status === 'ENVIRONMENT_BLOCKED' ? value.status : null,
    observed: value.observed === true,
    deviceDistinct: value.deviceDistinct === true,
    totalBytes: Number.isSafeInteger(Number(value.totalBytes)) && Number(value.totalBytes) >= 0 ? Number(value.totalBytes) : null,
    availableBytes: Number.isSafeInteger(Number(value.availableBytes)) && Number(value.availableBytes) >= 0 ? Number(value.availableBytes) : null,
    reason: typeof value.reason === 'string' ? value.reason.slice(0, 300) : null,
  }
}

function normalizeFaultOutcome(value) {
  return ['completed', 'failed', 'unavailable'].includes(value) ? value : null
}

function isFileFact(value) {
  return value !== null && typeof value === 'object'
    && SHA256.test(String(value.sha256)) && Number.isSafeInteger(value.bytes) && value.bytes >= 0
}

/** Project only the enum fields consumed by the kill/restart verdict. */
function projectOperation(operation) {
  if (operation === null || operation === undefined || typeof operation !== 'object') return null
  return {
    type: typeof operation.type === 'string' ? operation.type : null,
    stage: typeof operation.stage === 'string' ? operation.stage : null,
  }
}

/** Read either the legacy full string or the bounded structured evidence text. */
function evidenceText(value) {
  if (value !== null && typeof value === 'object' && typeof value.evidence === 'string') return value.evidence
  return String(value ?? '')
}

/** Hash raw local evidence without retaining its contents in the receipt. */
function sha256Text(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

/** Count exact non-overlapping occurrences without retaining the searched value. */
function countOccurrences(haystack, needle) {
  if (needle === '') return 0
  let count = 0
  let offset = 0
  while (offset < haystack.length) {
    const found = haystack.indexOf(needle, offset)
    if (found < 0) break
    count += 1
    offset = found + needle.length
  }
  return count
}
