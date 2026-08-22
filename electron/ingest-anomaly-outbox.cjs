const fs = require('node:fs/promises')
const path = require('node:path')
const { createHash, randomUUID } = require('node:crypto')

const INGEST_ANOMALY_OUTBOX_MAX_ENVELOPE_BYTES_HYPOTHESIS = 16 * 1024
const INGEST_ANOMALY_OUTBOX_REPLAY_BATCH_HYPOTHESIS = 256
const DEGRADED_HEALTH_MARKER_NAME = 'degraded-health.json.marker'

/**
 * Creates a file-per-envelope durable outbox. Atomic rename and directory fsync
 * make the acknowledgement boundary explicit without retaining raw payloads.
 */
function createIngestAnomalyOutbox(options) {
  let lastFailure = null
  let operationTail = Promise.resolve()
  const platform = options.platform ?? process.platform

  /** Serializes filesystem mutation and replay so concurrent deliveries cannot race. */
  function enqueue(operation) {
    const result = operationTail.then(operation)
    operationTail = result.catch(() => undefined)
    return result
  }

  /** Initializes and replays durable records; later calls retry in the same process. */
  function initialize() {
    return enqueue(initializeAndReplay)
  }

  /** Writes, projects, and only then removes one canonical envelope. */
  function deliver(envelope) {
    return enqueue(async () => {
      await fs.mkdir(options.directoryPath, { recursive: true })
      let serialized
      try {
        serialized = serializeEnvelope(envelope)
      } catch (error) {
        await persistFailure('outbox_invalid_envelope')
        throw error
      }
      if (options.faultInjection?.failStage === true) {
        await persistFailure('outbox_storage_unavailable')
        throw new Error('Durable outbox write failed: storage is unavailable.')
      }
      const filePath = path.join(
        options.directoryPath,
        `${createSafeEnvelopeBasename(envelope.missionId, envelope.deliveryId)}.json`,
      )
      if (!(await fileExists(filePath))) {
        try {
          await writeAtomic(filePath, serialized.text, platform)
        } catch (error) {
          await persistFailure('outbox_storage_unavailable')
          throw new Error(
            `Durable outbox write failed: ${error instanceof Error ? error.message : String(error)}`,
          )
        }
      }
      await replayPending()
      if (lastFailure === 'outbox_storage_unavailable') {
        const names = await fs.readdir(options.directoryPath)
        if (
          !names.some((name) => name.endsWith('.json')) &&
          !names.some((name) => name.endsWith('.corrupt'))
        ) {
          await clearFailure()
        }
      }
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
        lastFailure:
          corruptCount > 0 && lastFailure === null
            ? 'outbox_corrupt_record'
            : lastFailure,
      }
    })
  }

  /** Persists the honest completeness block when volatile evidence cannot be retained. */
  function markEvidenceLoss(reason) {
    return enqueue(async () => {
      if (reason !== 'renderer_pending_capacity_exhausted') {
        throw new Error('Ingest evidence-loss reason is invalid.')
      }
      await persistFailure(reason)
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
      .slice(0, INGEST_ANOMALY_OUTBOX_REPLAY_BATCH_HYPOTHESIS)
    for (const name of names) {
      const filePath = path.join(options.directoryPath, name)
      let envelope
      try {
        envelope = parseEnvelope(await fs.readFile(filePath, 'utf8'))
      } catch {
        await fs.rename(filePath, `${filePath}.corrupt`)
        await syncDirectory(options.directoryPath, platform)
        continue
      }
      try {
        await options.projectEnvelope(envelope)
      } catch {
        await persistFailure('ledger_projection_failed')
        continue
      }
      if (options.faultInjection?.failRemovalAfterProjection === true) {
        await persistFailure('outbox_removal_failed')
        throw new Error('Injected outbox removal after projection failure.')
      }
      await fs.unlink(filePath)
      await syncDirectory(options.directoryPath, platform)
    }
    const remainingNames = await fs.readdir(options.directoryPath)
    const hasPending = remainingNames.some((name) => name.endsWith('.json'))
    const hasCorrupt = remainingNames.some((name) => name.endsWith('.corrupt'))
    if (!hasPending && !hasCorrupt && isRecoverableFailure(lastFailure)) {
      await clearFailure()
    }
  }

  /** Creates the directory and reloads a durable degraded marker after restart. */
  async function initializeDirectoryAndFailureState() {
    await fs.mkdir(options.directoryPath, { recursive: true })
    if (lastFailure !== null) return
    try {
      const marker = JSON.parse(
        await fs.readFile(path.join(options.directoryPath, DEGRADED_HEALTH_MARKER_NAME), 'utf8'),
      )
      if (typeof marker?.reason === 'string' && marker.reason !== '') {
        lastFailure = marker.reason
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') lastFailure = 'outbox_health_marker_corrupt'
    }
  }

  /** Persists only a bounded failure class; anomaly content never enters the marker. */
  async function persistFailure(reason) {
    if (lastFailure === reason) return
    lastFailure = reason
    try {
      await fs.mkdir(options.directoryPath, { recursive: true })
      await writeAtomic(
        path.join(options.directoryPath, DEGRADED_HEALTH_MARKER_NAME),
        JSON.stringify({ reason }),
        platform,
      )
    } catch {
      // No writable local storage is the explicit impossibility boundary. The
      // in-process state remains critical and no evidence is acknowledged.
    }
  }

  /** Clears recoverable degraded state only after every staged record projects. */
  async function clearFailure() {
    lastFailure = null
    await fs.rm(path.join(options.directoryPath, DEGRADED_HEALTH_MARKER_NAME), {
      force: true,
    })
    await syncDirectory(options.directoryPath, platform)
  }

  return { deliver, health, initialize, markEvidenceLoss }
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

/** Returns whether successful replay can honestly clear this failure class. */
function isRecoverableFailure(reason) {
  return reason === 'ledger_projection_failed' || reason === 'outbox_removal_failed'
}

module.exports = {
  createIngestAnomalyOutbox,
}
