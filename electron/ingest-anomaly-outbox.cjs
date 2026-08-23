const fs = require('node:fs/promises')
const path = require('node:path')
const { createHash, randomUUID } = require('node:crypto')

const INGEST_ANOMALY_OUTBOX_MAX_ENVELOPE_BYTES_HYPOTHESIS = 16 * 1024
const INGEST_ANOMALY_OUTBOX_MAX_PENDING_FILES_HYPOTHESIS = 4_096
const INGEST_ANOMALY_OUTBOX_MAX_PENDING_BYTES_HYPOTHESIS = 64 * 1024 * 1024
const INGEST_ANOMALY_OUTBOX_REPLAY_BATCH_HYPOTHESIS = 8
const DEGRADED_HEALTH_MARKER_NAME = 'degraded-health.json.marker'
const FAILURE_PRIORITY = [
  'outbox_health_marker_corrupt',
  'renderer_pending_capacity_exhausted',
  'outbox_invalid_envelope',
  'late_evidence_after_finalization',
  'outbox_storage_unavailable',
  'outbox_capacity_exhausted',
  'outbox_corrupt_record',
  'outbox_removal_failed',
  'ledger_projection_failed',
]

/**
 * Creates a file-per-envelope durable outbox. Atomic rename and directory fsync
 * make the acknowledgement boundary explicit without retaining raw payloads.
 */
function createIngestAnomalyOutbox(options) {
  const failuresByScope = new Map()
  const recoveryKeysByScope = new Map()
  let failureStateInitialized = false
  let operationTail = Promise.resolve()
  let replayRetryTimer = null
  let disposed = false
  const platform = options.platform ?? process.platform
  const maxPendingFiles = options.maxPendingFiles ??
    INGEST_ANOMALY_OUTBOX_MAX_PENDING_FILES_HYPOTHESIS
  const maxPendingBytes = options.maxPendingBytes ??
    INGEST_ANOMALY_OUTBOX_MAX_PENDING_BYTES_HYPOTHESIS
  const replayBatchSize = options.replayBatchSize ??
    INGEST_ANOMALY_OUTBOX_REPLAY_BATCH_HYPOTHESIS
  const retryDelayMs = options.retryDelayMs ?? 1_000
  const addFailure = (scope, reason) =>
    addFailureToMap(failuresByScope, scope, reason)

  /** Serializes filesystem mutation and replay so concurrent deliveries cannot race. */
  function enqueue(operation) {
    const result = operationTail.then(operation)
    operationTail = result.catch(() => undefined)
    return result
  }

  /** Initializes and replays durable records; later calls retry in the same process. */
  function initialize() {
    if (disposed) return Promise.resolve()
    return enqueue(initializeAndReplay)
  }

  /** Stops background replay before the owning mission store closes. */
  function dispose() {
    disposed = true
    if (replayRetryTimer !== null) {
      clearTimeout(replayRetryTimer)
      replayRetryTimer = null
    }
  }

  /** Writes, projects, and only then removes one canonical envelope. */
  function deliver(envelope) {
    return enqueue(async () => {
      await fs.mkdir(options.directoryPath, { recursive: true })
      await initializeDirectoryAndFailureState()
      let serialized
      try {
        serialized = serializeEnvelope(envelope)
      } catch (error) {
        await persistFailure(envelope?.missionId, 'outbox_invalid_envelope')
        throw error
      }
      if (options.faultInjection?.failStage === true) {
        await persistFailure(
          envelope.missionId,
          'outbox_storage_unavailable',
          createDeliveryRecoveryKey(envelope.deliveryId),
        )
        throw new Error('Durable outbox write failed: storage is unavailable.')
      }
      const filePath = path.join(
        options.directoryPath,
        `${createSafeEnvelopeBasename(envelope.missionId, envelope.deliveryId)}.json`,
      )
      if (!(await fileExists(filePath))) {
        const capacity = await readPendingCapacity()
        if (
          capacity.fileCount >= maxPendingFiles ||
          capacity.totalBytes + serialized.byteLength > maxPendingBytes
        ) {
          await persistFailure(envelope.missionId, 'outbox_capacity_exhausted')
          throw new Error('Durable outbox capacity is exhausted; evidence was not acknowledged.')
        }
        try {
          await writeAtomic(filePath, serialized.text, platform)
        } catch (error) {
          await persistFailure(
            envelope.missionId,
            'outbox_storage_unavailable',
            createDeliveryRecoveryKey(envelope.deliveryId),
          )
          throw new Error(
            `Durable outbox write failed: ${error instanceof Error ? error.message : String(error)}`,
          )
        }
      }
      await clearMatchedStorageFailure(envelope.missionId, envelope.deliveryId)
      await replayPending()
      await clearRecoveredFailures(envelope.missionId)
      return { persisted: true }
    })
  }

  /** Reports only bounded state and failure class, never anomaly content. */
  function health(missionId) {
    return enqueue(async () => {
      await initializeDirectoryAndFailureState()
      await replayPending()
      const names = await fs.readdir(options.directoryPath)
      const pendingCount = names.filter((name) =>
        name.endsWith('.json') && fileBelongsToMission(name, missionId),
      ).length
      const corruptCount = names.filter((name) =>
        name.endsWith('.corrupt') && fileBelongsToMission(name, missionId),
      ).length
      return {
        pendingCount,
        corruptCount,
        lastFailure: selectFailure(missionId, corruptCount),
      }
    })
  }

  /** Persists the honest completeness block when volatile evidence cannot be retained. */
  function markEvidenceLoss(missionId, reason) {
    return enqueue(async () => {
      await initializeDirectoryAndFailureState()
      if (reason !== 'renderer_pending_capacity_exhausted') {
        throw new Error('Ingest evidence-loss reason is invalid.')
      }
      validateMissionScope(missionId)
      await persistFailure(missionId, reason)
    })
  }

  /**
   * Holds the durable-delivery queue while one completeness operation runs.
   * Earlier deliveries drain first; later deliveries observe finalized state.
   */
  function runWithHealthyEvidenceFence(missionId, operationName, operation) {
    return enqueue(async () => {
      validateMissionScope(missionId)
      await initializeDirectoryAndFailureState()
      await replayPending()
      const names = await fs.readdir(options.directoryPath)
      const pendingCount = names.filter((name) =>
        name.endsWith('.json') && fileBelongsToMission(name, missionId),
      ).length
      const corruptCount = names.filter((name) =>
        name.endsWith('.corrupt') && fileBelongsToMission(name, missionId),
      ).length
      if (pendingCount > 0 || corruptCount > 0 || selectFailure(missionId, corruptCount) !== null) {
        throw new Error(
          `Degraded evidence health blocks ${operationName}; resolve durable ingest evidence before continuing.`,
        )
      }
      return operation()
    })
  }

  /** Replays committed files in deterministic order and quarantines corruption. */
  async function initializeAndReplay() {
    await initializeDirectoryAndFailureState()
    await replayPending()
  }

  /** Replays every currently staged envelope until projection becomes unavailable. */
  async function replayPending() {
    const names = (await fs.readdir(options.directoryPath))
      .filter((name) => name.endsWith('.json'))
      .sort()
      .slice(0, replayBatchSize)
    let projectedCount = 0
    for (const name of names) {
      const filePath = path.join(options.directoryPath, name)
      let envelope
      try {
        envelope = parseEnvelope(await fs.readFile(filePath, 'utf8'))
      } catch {
        await fs.rename(filePath, `${filePath}.corrupt`)
        await syncDirectory(options.directoryPath, platform)
        await persistFailureForFile(name, 'outbox_corrupt_record')
        continue
      }
      try {
        await options.projectEnvelope(envelope)
      } catch (error) {
        await persistFailure(
          envelope.missionId,
          error?.code === 'LATE_EVIDENCE_AFTER_FINALIZATION'
            ? 'late_evidence_after_finalization'
            : 'ledger_projection_failed',
        )
        continue
      }
      if (options.faultInjection?.failRemovalAfterProjection === true) {
        await persistFailure(envelope.missionId, 'outbox_removal_failed')
        throw new Error('Injected outbox removal after projection failure.')
      }
      await fs.unlink(filePath)
      await syncDirectory(options.directoryPath, platform)
      projectedCount += 1
      await clearRecoveredFailures(envelope.missionId)
      await yieldToMainEventLoop()
    }
    const remainingPendingCount = (await fs.readdir(options.directoryPath))
      .filter((name) => name.endsWith('.json')).length
    scheduleReplayRetry(remainingPendingCount, projectedCount)
  }

  /** Retries bounded replay in background, draining quickly only after progress. */
  function scheduleReplayRetry(pendingCount, projectedCount) {
    if (disposed || pendingCount === 0 || replayRetryTimer !== null) return
    const delayMs = projectedCount > 0 ? 0 : retryDelayMs
    replayRetryTimer = setTimeout(() => {
      replayRetryTimer = null
      void initialize().catch(() => undefined)
    }, delayMs)
    replayRetryTimer.unref?.()
  }

  /** Creates the directory and reloads a durable degraded marker after restart. */
  async function initializeDirectoryAndFailureState() {
    await fs.mkdir(options.directoryPath, { recursive: true })
    if (failureStateInitialized) return
    const names = await fs.readdir(options.directoryPath)
    const markerNames = names.filter((name) =>
      name === DEGRADED_HEALTH_MARKER_NAME ||
      /^degraded-health-(?:global|[a-f0-9]{16})\.json\.marker$/u.test(name),
    )
    for (const markerName of markerNames) {
      const scope = markerScopeFromName(markerName)
      try {
        const marker = JSON.parse(
          await fs.readFile(path.join(options.directoryPath, markerName), 'utf8'),
        )
        const reasons = Array.isArray(marker?.reasons)
          ? marker.reasons.filter(isFailureReason)
          : isFailureReason(marker?.reason)
            ? [marker.reason]
            : []
        if (reasons.length === 0) {
          addFailure(scope, 'outbox_health_marker_corrupt')
        } else {
          failuresByScope.set(scope, new Set(reasons))
          const recoveryKeys = marker?.recoveryKeys
          if (recoveryKeys !== null && typeof recoveryKeys === 'object') {
            recoveryKeysByScope.set(scope, new Map(
              Object.entries(recoveryKeys).filter(
                ([reason, key]) => isFailureReason(reason) &&
                  typeof key === 'string' && /^[a-f0-9]{64}$/u.test(key),
              ),
            ))
          }
        }
      } catch {
        addFailure(scope, 'outbox_health_marker_corrupt')
      }
    }
    failureStateInitialized = true
  }

  /** Persists only a bounded failure class; anomaly content never enters the marker. */
  async function persistFailure(missionId, reason, recoveryKey) {
    const scope = failureScope(missionId)
    if (
      failuresByScope.get(scope)?.has(reason) === true &&
      (recoveryKey === undefined || recoveryKeysByScope.get(scope)?.get(reason) === recoveryKey)
    ) return
    addFailure(scope, reason)
    if (recoveryKey !== undefined) {
      const recoveryKeys = recoveryKeysByScope.get(scope) ?? new Map()
      recoveryKeys.set(reason, recoveryKey)
      recoveryKeysByScope.set(scope, recoveryKeys)
    }
    try {
      await fs.mkdir(options.directoryPath, { recursive: true })
      await persistFailureScope(scope)
    } catch {
      // No writable local storage is the explicit impossibility boundary. The
      // in-process state remains critical and no evidence is acknowledged.
    }
  }

  /** Clears only failure classes whose underlying durable state is now healthy. */
  async function clearRecoveredFailures(missionId) {
    const names = await fs.readdir(options.directoryPath)
    const hasPending = names.some((name) =>
      name.endsWith('.json') && fileBelongsToMission(name, missionId),
    )
    const hasCorrupt = names.some((name) =>
      name.endsWith('.corrupt') && fileBelongsToMission(name, missionId),
    )
    if (hasPending || hasCorrupt) return
    const capacity = await readPendingCapacity()
    const recoverable = [
      'ledger_projection_failed',
      'outbox_removal_failed',
      ...(capacity.fileCount < maxPendingFiles && capacity.totalBytes < maxPendingBytes
        ? ['outbox_capacity_exhausted']
        : []),
    ]
    await removeFailures(failureScope(missionId), recoverable)
  }

  /** Clears storage degradation only when the exact failed delivery is staged. */
  async function clearMatchedStorageFailure(missionId, deliveryId) {
    const scope = failureScope(missionId)
    const expected = recoveryKeysByScope.get(scope)?.get('outbox_storage_unavailable')
    if (expected !== createDeliveryRecoveryKey(deliveryId)) return
    await removeFailures(scope, ['outbox_storage_unavailable'])
  }

  /** Returns bounded aggregate pending capacity without reading evidence content. */
  async function readPendingCapacity() {
    const names = (await fs.readdir(options.directoryPath))
      .filter((name) => name.endsWith('.json') || name.endsWith('.corrupt'))
    let totalBytes = 0
    for (const name of names) {
      totalBytes += (await fs.stat(path.join(options.directoryPath, name))).size
    }
    return { fileCount: names.length, totalBytes }
  }

  /** Persists one scope's bounded set of failure classes. */
  async function persistFailureScope(scope) {
    const reasons = [...(failuresByScope.get(scope) ?? [])].sort()
    const recoveryKeys = Object.fromEntries(recoveryKeysByScope.get(scope) ?? [])
    const markerPath = path.join(options.directoryPath, markerNameForScope(scope))
    if (reasons.length === 0) {
      await fs.rm(markerPath, { force: true })
      await syncDirectory(options.directoryPath, platform)
      return
    }
    await writeAtomic(markerPath, JSON.stringify({ reasons, recoveryKeys }), platform)
  }

  /** Removes selected recoverable reasons without erasing sticky evidence loss. */
  async function removeFailures(scope, reasons) {
    const current = failuresByScope.get(scope)
    if (current === undefined) return
    for (const reason of reasons) {
      current.delete(reason)
      recoveryKeysByScope.get(scope)?.delete(reason)
    }
    if (current.size === 0) {
      failuresByScope.delete(scope)
      recoveryKeysByScope.delete(scope)
    }
    await persistFailureScope(scope)
  }

  /** Records corruption against the filename's durable mission hash. */
  async function persistFailureForFile(fileName, reason) {
    const match = /^([a-f0-9]{16})-[a-f0-9]{64}\.json$/u.exec(fileName)
    if (match === null) {
      await persistFailure(undefined, reason)
      return
    }
    const scope = match[1]
    addFailure(scope, reason)
    try {
      await persistFailureScope(scope)
    } catch {
      // In-memory health remains fail-closed when the marker itself cannot write.
    }
  }

  /** Chooses the most severe visible failure for one mission without leaking content. */
  function selectFailure(missionId, corruptCount) {
    const reasons = new Set([
      ...(failuresByScope.get('global') ?? []),
      ...(missionId === undefined
        ? [...failuresByScope.values()].flatMap((entries) => [...entries])
        : [...(failuresByScope.get(failureScope(missionId)) ?? [])]),
    ])
    if (corruptCount > 0) reasons.add('outbox_corrupt_record')
    return FAILURE_PRIORITY.find((reason) => reasons.has(reason)) ?? null
  }

  return {
    deliver,
    dispose,
    health,
    initialize,
    markEvidenceLoss,
    runWithHealthyEvidenceFence,
  }
}

/** Validates and serializes the allow-listed envelope shape. */
function serializeEnvelope(envelope) {
  validateEnvelope(envelope)
  const text = JSON.stringify(envelope)
  const byteLength = Buffer.byteLength(text, 'utf8')
  if (byteLength > INGEST_ANOMALY_OUTBOX_MAX_ENVELOPE_BYTES_HYPOTHESIS) {
    throw new Error('Canonical rejection envelope exceeds the bounded evidence hypothesis.')
  }
  return { text, byteLength }
}

/** Parses one staged canonical envelope without accepting arbitrary shapes. */
function parseEnvelope(contents) {
  const envelope = JSON.parse(contents)
  validateEnvelope(envelope)
  return envelope
}

/** Checks the narrow renderer-to-main rejection contract. */
function validateEnvelope(envelope) {
  if (envelope === null || typeof envelope !== 'object' || Array.isArray(envelope)) {
    throw new Error('Rejected-position envelope is invalid.')
  }
  for (const key of ['deliveryId', 'missionId', 'anomalyKey', 'reasonClass', 'receivedAt']) {
    if (typeof envelope[key] !== 'string' || envelope[key].trim() === '') {
      throw new Error(`Rejected-position envelope ${key} is invalid.`)
    }
  }
  if (!/^[A-Za-z0-9._:-]{1,160}$/u.test(envelope.deliveryId)) {
    throw new Error('Rejected-position delivery identity is invalid.')
  }
  if (
    envelope.canonicalEvidence === null ||
    typeof envelope.canonicalEvidence !== 'object' ||
    Array.isArray(envelope.canonicalEvidence)
  ) {
    throw new Error('Rejected-position canonical evidence is invalid.')
  }
}

/** Writes through a temporary file, fsyncs it, renames, then fsyncs the directory. */
async function writeAtomic(filePath, contents, platform) {
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`
  let handle
  try {
    handle = await fs.open(temporaryPath, 'wx', 0o600)
    await handle.writeFile(contents, 'utf8')
    await handle.sync()
  } finally {
    await handle?.close()
  }
  await fs.rename(temporaryPath, filePath)
  await syncDirectory(path.dirname(filePath), platform)
}

/** Flushes directory metadata on platforms that support directory handles. */
async function syncDirectory(directoryPath, platform) {
  if (platform === 'win32') return
  let handle
  try {
    handle = await fs.open(directoryPath, 'r')
    await handle.sync()
  } finally {
    await handle?.close()
  }
}

/** Maps an arbitrary delivery identity to a portable opaque filename. */
function createSafeEnvelopeBasename(missionId, deliveryId) {
  return `${createMissionFilePrefix(missionId)}-${createHash('sha256')
    .update(deliveryId, 'utf8')
    .digest('hex')}`
}

/** Creates an opaque key proving the same failed delivery was later staged. */
function createDeliveryRecoveryKey(deliveryId) {
  return createHash('sha256').update(deliveryId, 'utf8').digest('hex')
}

/** Creates a non-reversible mission scope retained even if envelope JSON corrupts. */
function createMissionFilePrefix(missionId) {
  return createHash('sha256').update(missionId, 'utf8').digest('hex').slice(0, 16)
}

/** Scopes new outbox files while treating legacy opaque names conservatively. */
function fileBelongsToMission(fileName, missionId) {
  if (missionId === undefined) return true
  const scopedPattern = /^[a-f0-9]{16}-[a-f0-9]{64}\.json(?:\.corrupt)?$/u
  return !scopedPattern.test(fileName) || fileName.startsWith(`${createMissionFilePrefix(missionId)}-`)
}

/** Returns the opaque marker scope for a mission, or the conservative global scope. */
function failureScope(missionId) {
  return typeof missionId === 'string' && missionId.trim() !== ''
    ? createMissionFilePrefix(missionId)
    : 'global'
}

/** Rejects evidence-loss requests that cannot be attributed to a mission. */
function validateMissionScope(missionId) {
  if (typeof missionId !== 'string' || missionId.trim() === '') {
    throw new Error('Ingest evidence loss requires a mission identity.')
  }
}

/** Maps a bounded opaque scope to its durable marker filename. */
function markerNameForScope(scope) {
  return scope === 'global'
    ? DEGRADED_HEALTH_MARKER_NAME
    : `degraded-health-${scope}.json.marker`
}

/** Recovers marker scope from current and legacy filenames. */
function markerScopeFromName(fileName) {
  if (fileName === DEGRADED_HEALTH_MARKER_NAME) return 'global'
  return fileName.slice('degraded-health-'.length, -'.json.marker'.length)
}

/** Adds one bounded failure class to in-memory health. */
function addFailureToMap(failuresByScope, scope, reason) {
  const reasons = failuresByScope.get(scope) ?? new Set()
  reasons.add(reason)
  failuresByScope.set(scope, reasons)
}

/** Accepts only bounded failure class tokens from a durable marker. */
function isFailureReason(value) {
  return typeof value === 'string' && /^[a-z][a-z0-9_]{0,79}$/u.test(value)
}

/** Gives Electron's main event loop a turn between synchronous projections. */
function yieldToMainEventLoop() {
  return new Promise((resolve) => setImmediate(resolve))
}

/** Returns whether a staged filename already exists without exposing its content. */
async function fileExists(filePath) {
  try {
    await fs.access(filePath)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

module.exports = {
  createIngestAnomalyOutbox,
}
