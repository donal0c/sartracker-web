'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { randomBytes } = require('node:crypto')

const Database = require('better-sqlite3')
const {
  createArchiveReviewSessionManager,
} = require('../../electron/archive-review-sessions.cjs')
const { startArchiveRestore } = require('../../electron/archive-restore-runner.cjs')
const { createElectronMissionStore } = require('../../electron/mission-store.cjs')

const PROTOCOL_VERSION = 2
const STATE_FILE_NAME = 'kill-matrix-state.json'
const REVIEW_DIRECTORY_NAME = 'archive-review'
const ARCHIVE_DIRECTORY_NAME = 'archives'
const PASSPHRASE = 'Four calm words 2026!'
const RECOVERY_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const RECOVERY_CODE = /^(?:[0-9A-HJKMNP-TV-Z]{5}-){7}[0-9A-HJKMNP-TV-Z]{5}$/u
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const CASE_ID = /^(create|verify|restore|cleanup)\.([a-z_]+)$/u
const HOLD_BUFFER = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT))

/** Parses the closed fixture CLI without accepting implicit positional input. */
function parseArgs(argv) {
  const parsed = {
    action: null,
    caseId: null,
    cases: [],
    forgeAssertions: false,
    leaveHiddenArchive: false,
    leaveKnownResidue: false,
    operationId: null,
    root: null,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--forge-assertions') {
      parsed.forgeAssertions = true
      continue
    }
    if (argument === '--leave-known-residue') {
      parsed.leaveKnownResidue = true
      continue
    }
    if (argument === '--leave-hidden-archive') {
      parsed.leaveHiddenArchive = true
      continue
    }
    if (!['--action', '--case', '--cases', '--operation-id', '--root'].includes(argument)) {
      throw new Error('Unsupported kill child argument.')
    }
    const value = argv[index + 1]
    index += 1
    if (typeof value !== 'string' || value.length < 1 || value.includes('\0')) {
      throw new Error('Kill child argument value is invalid.')
    }
    if (argument === '--action') parsed.action = value
    else if (argument === '--case') parsed.caseId = value
    else if (argument === '--cases') parsed.cases = value.split(',')
    else if (argument === '--operation-id') parsed.operationId = value
    else parsed.root = value
  }
  if (!['prepare', 'run', 'reconcile', 'protocol-run', 'protocol-reconcile']
    .includes(parsed.action)) {
    throw new Error('Kill child action is invalid.')
  }
  if (typeof parsed.root !== 'string' || !path.isAbsolute(parsed.root)
    || path.resolve(parsed.root) !== parsed.root) {
    throw new Error('Kill child root is invalid.')
  }
  if (parsed.action !== 'prepare') normalizeCaseId(parsed.caseId)
  if (['run', 'reconcile'].includes(parsed.action) && !UUID_V4.test(parsed.operationId ?? '')) {
    throw new Error('Kill child operation identity is invalid.')
  }
  return Object.freeze(parsed)
}

/** Returns the two closed components of one frozen matrix case identity. */
function normalizeCaseId(caseId) {
  const match = CASE_ID.exec(caseId ?? '')
  if (match === null) throw new Error('Kill child case identity is invalid.')
  return Object.freeze({ caseId, lifecycle: match[1], phase: match[2] })
}

/** Writes one bounded NDJSON record synchronously before the parent can signal. */
function writeProtocol(message) {
  const bytes = Buffer.from(`${JSON.stringify(message)}\n`, 'utf8')
  if (bytes.length > 64 * 1024) throw new Error('Kill child protocol record is too large.')
  fs.writeSync(1, bytes)
}

/** Freezes the fixture process at the reached callback until external SIGKILL. */
function holdForExternalKill() {
  while (true) Atomics.wait(HOLD_BUFFER, 0, 0, 60_000)
}

/** Emits one exact target-phase record and stops main-isolate progress. */
function emitReachedAndHold(definition, progress) {
  const normalized = normalizeProgress(definition.lifecycle, progress)
  writeProtocol({
    type: 'phase-reached',
    protocolVersion: PROTOCOL_VERSION,
    caseId: definition.caseId,
    lifecycle: definition.lifecycle,
    phase: definition.phase,
    progress: normalized,
  })
  holdForExternalKill()
}

/** Projects real lifecycle progress into the path-free proof protocol. */
function normalizeProgress(lifecycle, progress) {
  if (lifecycle === 'cleanup') {
    return Object.freeze({
      sequence: Math.max(1, Number(progress.tableIndex ?? 0) + 1),
      unit: 'rows',
      completed: Number(progress.totalDeletedRows ?? progress.deletedRows ?? 0),
      total: null,
      detail: 'bounded-delete',
    })
  }
  const detail = ['passphrase', 'recovery'].includes(progress.detail)
    ? 'non-machine-slot'
    : progress.detail
  return Object.freeze({
    sequence: Number(progress.sequence),
    unit: progress.unit,
    completed: Number(progress.completed),
    total: progress.total === null ? null : Number(progress.total),
    detail: typeof detail === 'string' && detail.length > 0
      ? detail
      : `${lifecycle}-checkpoint`,
  })
}

/** Creates or validates the one permission-restricted harness root. */
function ensureOwnedRoot(root) {
  fs.mkdirSync(root, { recursive: true, mode: 0o700 })
  const stat = fs.lstatSync(root)
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error('Kill child root is unsafe.')
  }
  fs.chmodSync(root, 0o700)
}

/** Creates one mission with deterministic operator payload and finishes it. */
async function seedFinishedMission(store, name, index, positionCount) {
  const startMs = Date.parse('2026-08-28T00:00:00.000Z') + index * 30 * 60_000
  const mission = await store.createMission({
    name,
    start_time: new Date(startMs).toISOString(),
  })
  const deviceId = `kill-device-${index}`
  await store.upsertDevice({
    mission_id: mission.id,
    device_id: deviceId,
    name: `Kill Device ${index}`,
    color: '#336699',
    status: 'offline',
  })
  for (let positionIndex = 0; positionIndex < positionCount; positionIndex += 1) {
    await store.addPosition({
      mission_id: mission.id,
      device_id: deviceId,
      lat: 52.1 + positionIndex / 100_000,
      lon: -9.1 - positionIndex / 100_000,
      timestamp: new Date(startMs + (positionIndex + 1) * 30_000).toISOString(),
      timestamp_source: 'fix',
    })
  }
  await store.finishMission(mission.id)
  return mission.id
}

/** Builds the shared real lifecycle fixture once; later cases always restart it. */
async function prepareActualFixture(input) {
  ensureOwnedRoot(input.root)
  const selected = input.cases.map(normalizeCaseId)
  const state = {
    protocolVersion: PROTOCOL_VERSION,
    passphrase: PASSPHRASE,
    cases: {},
  }
  const recoveryCodes = new Set()
  let createMissionCount = 0
  for (const [index, definition] of selected.entries()) {
    const profileRelativePath = path.posix.join(
      'cases',
      `${String(index + 1).padStart(2, '0')}-${definition.caseId.replace('.', '-')}`,
    )
    const profilePath = path.join(input.root, ...profileRelativePath.split('/'))
    fs.mkdirSync(profilePath, { recursive: true, mode: 0o700 })
    const store = createElectronMissionStore({
      userDataPath: profilePath,
      ...(definition.lifecycle === 'verify'
        ? { startArchiveVerifyWorker: failedPreparationVerifyOperation }
        : {}),
    })
    let record
    try {
      const missionId = await seedFinishedMission(
        store,
        `Kill matrix ${definition.caseId}`,
        index + 1,
        definition.lifecycle === 'create' ? 3 : 12,
      )
      record = {
        profileRelativePath,
        missionId,
        archiveId: null,
        recoveryCode: createUniqueRecoveryCode(recoveryCodes),
      }
      if (definition.lifecycle === 'create') {
        createMissionCount += 1
      } else if (definition.lifecycle === 'verify') {
        await store.finalizeMission(
          missionId,
          { passphrase: PASSPHRASE, recoveryCode: record.recoveryCode },
          {
            operationId: `61000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
            onProgress: () => undefined,
          },
        ).then(
          () => { throw new Error('Preparation verification failure was not enforced.') },
          (error) => {
            if (!String(error?.code ?? '').startsWith('ARCHIVE_VERIFY_')) throw error
          },
        )
        const archives = await store.listMissionArchives(missionId)
        const sealed = archives.find((entry) => entry.status === 'sealed')
        if (sealed === undefined) throw new Error('Preparation did not retain a sealed archive.')
        record.archiveId = sealed.id
      } else {
        const finalized = await store.finalizeMission(
          missionId,
          { passphrase: PASSPHRASE, recoveryCode: record.recoveryCode },
          {
            operationId: `62000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
            onProgress: () => undefined,
          },
        )
        record.archiveId = finalized.archive.id
      }
    } finally {
      await store.prepareClose()
      store.close()
    }
    state.cases[definition.caseId] = record
  }
  writeState(input.root, state)
  writeProtocol({
    type: 'prepared',
    protocolVersion: PROTOCOL_VERSION,
    createMissionCount,
    verifiedFixture: selected.some((entry) => entry.lifecycle !== 'create'),
  })
}

/** Returns one physical-exit-compatible verify failure after archive sealing. */
function failedPreparationVerifyOperation() {
  const error = new Error('Preparation retained a sealed unverified archive.')
  error.code = 'ARCHIVE_VERIFY_FAILED'
  const operation = Promise.reject(error)
  Object.defineProperties(operation, {
    workerExited: { value: Promise.resolve() },
    cancel: { value: () => undefined },
  })
  return operation
}

/** Generates one archive-specific recovery code without modulo bias or reuse. */
function createUniqueRecoveryCode(existing) {
  while (true) {
    const symbols = []
    while (symbols.length < 40) {
      for (const byte of randomBytes(64)) {
        if (byte >= 224) continue
        symbols.push(RECOVERY_ALPHABET[byte % RECOVERY_ALPHABET.length])
        if (symbols.length === 40) break
      }
    }
    const code = Array.from({ length: 8 }, (_, index) =>
      symbols.slice(index * 5, index * 5 + 5).join('')).join('-')
    if (!existing.has(code)) {
      existing.add(code)
      return code
    }
  }
}

/** Executes one actual lifecycle until its declared public progress phase. */
async function runActualCase(input) {
  ensureOwnedRoot(input.root)
  const definition = normalizeCaseId(input.caseId)
  const state = readState(input.root)
  const record = requireCaseState(state, definition.caseId, definition.lifecycle)
  const profilePath = resolveCaseProfile(input.root, record.profileRelativePath)
  const store = createElectronMissionStore({
    userDataPath: profilePath,
    archiveCleanupBatchLimits: { positions: 1, default: 1 },
  })
  const hit = (progress) => {
    if (progress?.phase === definition.phase) emitReachedAndHold(definition, progress)
  }
  if (definition.lifecycle === 'create') {
    await store.finalizeMission(
      record.missionId,
      { passphrase: PASSPHRASE, recoveryCode: record.recoveryCode },
      { operationId: input.operationId, onProgress: (progress) => {
        if (progress.kind === 'create') hit(progress)
      } },
    )
  } else if (definition.lifecycle === 'verify') {
    await store.verifyMissionArchive({
      archiveId: record.archiveId,
      passphrase: PASSPHRASE,
      recoveryCode: record.recoveryCode,
    }, {
      operationId: input.operationId,
      onProgress: (progress) => {
        if (progress.kind === 'verify') hit(progress)
      },
    })
  } else if (definition.lifecycle === 'restore') {
    const ticket = store.issueMissionArchiveReviewTicket(record.archiveId)
    await startArchiveRestore({
      request: restoreRequestFromTicket({
        ticket,
        archiveDirectory: path.join(profilePath, ARCHIVE_DIRECTORY_NAME),
        reviewRoot: path.join(profilePath, REVIEW_DIRECTORY_NAME),
        operationId: input.operationId,
        sessionId: sessionIdForOperation(input.operationId),
      }),
      secret: record.recoveryCode,
      onProgress: hit,
    })
  } else {
    await store.startMissionCleanup({
      missionId: record.missionId,
      archiveId: record.archiveId,
      slotType: 'recovery',
      secret: record.recoveryCode,
    }, {
      operationId: input.operationId,
      reviewActivity: false,
      onProgress: (progress) => {
        if (progress.kind === 'cleanup') hit({ ...progress, phase: 'cleanup' })
      },
    })
  }
  throw new Error('Lifecycle completed without reaching its kill phase.')
}

/** Reopens the real store and reports only that its lifecycle recovery operation completed. */
async function reconcileActualCase(input) {
  ensureOwnedRoot(input.root)
  const definition = normalizeCaseId(input.caseId)
  const state = readState(input.root)
  const record = requireCaseState(state, definition.caseId, definition.lifecycle)
  const profilePath = resolveCaseProfile(input.root, record.profileRelativePath)
  const databasePath = path.join(profilePath, 'mission-store.sqlite')
  const store = createElectronMissionStore({
    userDataPath: profilePath,
    archiveCleanupBatchLimits: { positions: 1, default: 1 },
  })
  let reviewManager = null
  try {
    if (definition.lifecycle === 'create') {
      await waitForArchiveCustodyRecovery(databasePath)
    } else if (definition.lifecycle === 'verify') {
      await store.getMissionCleanupEligibility(
        { missionId: record.missionId, archiveId: record.archiveId },
        { reviewActivity: false },
      )
    } else {
      await store.getMissionCleanupEligibility(
        { missionId: record.missionId, archiveId: record.archiveId },
        { reviewActivity: false },
      )
    }

    if (definition.lifecycle === 'restore') {
      reviewManager = createReviewManager(store, profilePath)
      await reviewManager.sweepStartup()
    }

    if (definition.lifecycle === 'cleanup') {
      const interrupted = await store.listInterruptedMissionCleanups()
      const owned = interrupted.some((entry) => entry.missionId === record.missionId
        && entry.archiveId === record.archiveId)
      if (!owned) throw new Error('Cleanup restart cursor is missing.')
      await store.resumeMissionCleanup({
        missionId: record.missionId,
        archiveId: record.archiveId,
      }, {
        operationId: input.operationId,
        reviewActivity: false,
        onProgress: () => undefined,
      })
    }

    if (definition.lifecycle === 'verify') {
      const before = await store.listMissionArchives(record.missionId)
      const current = before.find((entry) => entry.id === record.archiveId)
      if (current?.status === 'sealed') {
        await store.verifyMissionArchive({
          archiveId: record.archiveId,
          passphrase: PASSPHRASE,
          recoveryCode: record.recoveryCode,
        }, {
          operationId: retryOperationId(input.operationId),
          onProgress: () => undefined,
        })
      } else if (current?.status !== 'verified') {
        throw new Error('Archive verification restart did not retain a sealed archive.')
      }
    }
    if (input.leaveKnownResidue) {
      const residueRoot = path.join(profilePath, ARCHIVE_DIRECTORY_NAME, '.verification')
      fs.mkdirSync(residueRoot, { recursive: true, mode: 0o700 })
      fs.writeFileSync(path.join(residueRoot, 'forged-known-secret'), record.recoveryCode, {
        mode: 0o600,
        flag: 'wx',
      })
    }
    if (input.leaveHiddenArchive) {
      fs.writeFileSync(
        path.join(profilePath, ARCHIVE_DIRECTORY_NAME, '.forged-orphan.sararch'),
        'forged orphan archive bytes',
        { mode: 0o600, flag: 'wx' },
      )
    }
    writeProtocol({
      type: 'reconciled',
      protocolVersion: PROTOCOL_VERSION,
      caseId: definition.caseId,
      lifecycle: definition.lifecycle,
      phase: definition.phase,
      operation: {
        action: {
          create: 'startup_custody_reconciliation',
          verify: 'verification_reconciliation',
          restore: 'startup_plaintext_sweep',
          cleanup: 'cleanup_resume',
        }[definition.lifecycle],
        outcome: 'completed',
      },
    })
  } finally {
    await reviewManager?.prepareClose().catch(() => undefined)
    await store.prepareClose()
    store.close()
  }
}

/** Creates the real startup-sweep manager around mission-store registry APIs. */
function createReviewManager(store, profilePath) {
  return createArchiveReviewSessionManager({
    reviewRoot: path.join(profilePath, REVIEW_DIRECTORY_NAME),
    archiveDirectory: path.join(profilePath, ARCHIVE_DIRECTORY_NAME),
    registry: {
      issueReviewTicket: (archiveId) => store.issueMissionArchiveReviewTicket(archiveId),
      recordReviewOpened: (entry) => store.recordMissionArchiveReviewOpened(entry),
      recordReviewClosed: (entry) => store.recordMissionArchiveReviewClosed(entry),
      recordReviewMutationDenied: (entry) =>
        store.recordMissionArchiveReviewMutationDenied(entry),
    },
  })
}

/** Projects one verified registry ticket into the exact restore worker request. */
function restoreRequestFromTicket(input) {
  return Object.freeze({
    operationId: input.operationId,
    sessionId: input.sessionId,
    archiveId: input.ticket.archiveId,
    archiveKind: input.ticket.archiveKind,
    archiveDirectory: input.archiveDirectory,
    archiveRelativePath: input.ticket.archiveRelativePath,
    reviewRoot: input.reviewRoot,
    missionId: input.ticket.missionId,
    requestEventRowid: input.ticket.requestEventRowid,
    requestEventId: input.ticket.requestEventId,
    creationOperationId: input.ticket.creationOperationId,
    protectedFinalizationEpoch: input.ticket.protectedFinalizationEpoch,
    createdAt: input.ticket.createdAt,
    previousArchiveSha256: input.ticket.previousArchiveSha256,
    containerVersion: input.ticket.containerVersion,
    schemaVersion: input.ticket.schemaVersion,
    inventoryVersion: input.ticket.inventoryVersion,
    ciphertextSha256: input.ticket.ciphertextSha256,
    sizeBytes: input.ticket.sizeBytes,
    frameCount: input.ticket.frameCount,
    headerSha256: input.ticket.headerSha256,
    manifestSha256: input.ticket.manifestSha256,
    entryCount: input.ticket.entryCount,
    tableCount: input.ticket.tableCount,
    slotType: 'recovery',
  })
}

/** Derives a distinct RFC-4122 v4 review session identity from the operation ID. */
function sessionIdForOperation(operationId) {
  return `71000000-0000-4000-8000-${operationId.slice(-12)}`
}

/** Derives a fresh post-restart verification operation identity. */
function retryOperationId(operationId) {
  return `72000000-0000-4000-8000-${operationId.slice(-12)}`
}

/** Polls the durable journal until the newly opened store has settled recovery. */
async function waitForArchiveCustodyRecovery(databasePath) {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    const active = readMetadata(databasePath, 'archive_custody_active_operation')
    if (active === null) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error('Archive custody did not reconcile after restart.')
}

/** Reads one durable metadata value without holding the mission-store connection. */
function readMetadata(databasePath, key) {
  const db = new Database(databasePath, { readonly: true, fileMustExist: true })
  try {
    return db.prepare('SELECT value FROM metadata WHERE key = ?').get(key)?.value ?? null
  } finally {
    db.close()
  }
}

/** Writes the private fixture routing state atomically with mode 0600. */
function writeState(root, state) {
  const statePath = path.join(root, STATE_FILE_NAME)
  const temporaryPath = `${statePath}.tmp`
  fs.writeFileSync(temporaryPath, `${JSON.stringify(state)}\n`, { mode: 0o600, flag: 'wx' })
  fs.renameSync(temporaryPath, statePath)
  fs.chmodSync(statePath, 0o600)
}

/** Reads and minimally validates the private fixture state. */
function readState(root) {
  const state = JSON.parse(fs.readFileSync(path.join(root, STATE_FILE_NAME), 'utf8'))
  if (state?.protocolVersion !== PROTOCOL_VERSION
    || state.passphrase !== PASSPHRASE
    || state.cases === null || typeof state.cases !== 'object'
    || Array.isArray(state.cases)) {
    throw new Error('Kill child state is invalid.')
  }
  return state
}

/** Requires one independently prepared case profile and its non-secret routing identity. */
function requireCaseState(state, caseId, lifecycle) {
  const record = state.cases?.[caseId]
  const requiresArchive = lifecycle !== 'create'
  if (record === null || typeof record !== 'object' || Array.isArray(record)
    || typeof record.profileRelativePath !== 'string'
    || typeof record.missionId !== 'string'
    || (requiresArchive && typeof record.archiveId !== 'string')
    || (!requiresArchive && record.archiveId !== null)
    || !RECOVERY_CODE.test(record.recoveryCode)
    || Object.keys(record).sort().join(',')
      !== 'archiveId,missionId,profileRelativePath,recoveryCode') {
    throw new Error('Kill child case fixture is missing or invalid.')
  }
  return record
}

/** Resolves one state-issued profile path without permitting root escape. */
function resolveCaseProfile(root, relativePath) {
  if (path.isAbsolute(relativePath) || relativePath.includes('\\')
    || relativePath.split('/').some((segment) => !segment || ['.', '..'].includes(segment))) {
    throw new Error('Kill child case profile path is invalid.')
  }
  const resolved = path.join(root, ...relativePath.split('/'))
  if (!resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error('Kill child case profile escaped its root.')
  }
  return resolved
}

/** Implements a fast process-protocol probe without making archive proof claims. */
function runProtocolProbe(input) {
  ensureOwnedRoot(input.root)
  const definition = normalizeCaseId(input.caseId)
  fs.writeFileSync(path.join(input.root, 'protocol-marker'), 'reached\n', {
    mode: 0o600,
  })
  emitReachedAndHold(definition, {
    sequence: 1,
    unit: 'files',
    completed: 1,
    total: 1,
    detail: 'protocol-checkpoint',
  })
}

/** Implements the fast restart half of the process-protocol probe. */
function reconcileProtocolProbe(input) {
  ensureOwnedRoot(input.root)
  const definition = normalizeCaseId(input.caseId)
  if (!fs.existsSync(path.join(input.root, 'protocol-marker'))) {
    throw new Error('Protocol kill marker is missing.')
  }
  writeProtocol({
    type: 'reconciled',
    protocolVersion: PROTOCOL_VERSION,
    caseId: definition.caseId,
    lifecycle: definition.lifecycle,
    phase: definition.phase,
    operation: {
      action: 'protocol_restart',
      outcome: 'completed',
    },
    ...(input.forgeAssertions ? { assertions: { passed: true } } : {}),
  })
}

/** Dispatches the fixture process and reports only a closed generic failure on stderr. */
async function main() {
  const input = parseArgs(process.argv.slice(2))
  if (input.action === 'protocol-run') runProtocolProbe(input)
  else if (input.action === 'protocol-reconcile') reconcileProtocolProbe(input)
  else if (input.action === 'prepare') await prepareActualFixture(input)
  else if (input.action === 'run') await runActualCase(input)
  else await reconcileActualCase(input)
}

void main().catch(() => {
  process.stderr.write('Breadcrumb PR6 kill child failed safely.\n')
  process.exitCode = 1
})
