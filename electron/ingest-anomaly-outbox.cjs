const fs = require('node:fs/promises')
const path = require('node:path')
const { randomUUID } = require('node:crypto')

const INGEST_ANOMALY_OUTBOX_MAX_PENDING_BYTES_HYPOTHESIS = 4 * 1024 * 1024
const INGEST_ANOMALY_OUTBOX_MAX_ENVELOPE_BYTES_HYPOTHESIS = 16 * 1024

/**
 * Creates a file-per-envelope durable outbox. Atomic rename and directory fsync
 * make the acknowledgement boundary explicit without retaining raw payloads.
 */
function createIngestAnomalyOutbox(options) {
  let initializePromise = null
  let lastFailure = null

  /** Initializes and replays durable records exactly once per process. */
  function initialize() {
    if (initializePromise === null) {
      initializePromise = initializeAndReplay().catch((error) => {
        initializePromise = null
        throw error
      })
    }
    return initializePromise
  }

  /** Writes, projects, and only then removes one canonical envelope. */
  async function deliver(envelope) {
    await initialize()
    const serialized = serializeEnvelope(envelope)
    if (options.faultInjection?.failStage === true) {
      lastFailure = 'outbox_storage_unavailable'
      throw new Error('Durable outbox write failed: storage is unavailable.')
    }
    await assertPendingCapacity(serialized.byteLength)
    const filePath = path.join(options.directoryPath, `${envelope.deliveryId}.json`)
    await writeAtomic(filePath, serialized.text)
    try {
      await options.projectEnvelope(envelope)
    } catch {
      lastFailure = 'ledger_projection_failed'
      throw new Error('Durable anomaly ledger projection failed; the outbox record remains pending.')
    }
    if (options.faultInjection?.failRemovalAfterProjection === true) {
      lastFailure = 'outbox_removal_failed'
      throw new Error('Injected outbox removal after projection failure.')
    }
    await fs.unlink(filePath)
    await syncDirectory(options.directoryPath)
    lastFailure = null
    return { persisted: true }
  }

  /** Reports only bounded state and failure class, never anomaly content. */
  async function health() {
    await fs.mkdir(options.directoryPath, { recursive: true })
    const names = await fs.readdir(options.directoryPath)
    const pendingCount = names.filter((name) => name.endsWith('.json')).length
    const corruptCount = names.filter((name) => name.endsWith('.corrupt')).length
    return {
      pendingCount,
      corruptCount,
      lastFailure:
        corruptCount > 0 && lastFailure === null
          ? 'outbox_corrupt_record'
          : lastFailure,
    }
  }

  /** Replays committed files in deterministic order and quarantines corruption. */
  async function initializeAndReplay() {
    await fs.mkdir(options.directoryPath, { recursive: true })
    const names = (await fs.readdir(options.directoryPath))
      .filter((name) => name.endsWith('.json'))
      .sort()
    for (const name of names) {
      const filePath = path.join(options.directoryPath, name)
      let envelope
      try {
        envelope = parseEnvelope(await fs.readFile(filePath, 'utf8'))
      } catch {
        await fs.rename(filePath, `${filePath}.corrupt`)
        await syncDirectory(options.directoryPath)
        lastFailure = 'outbox_corrupt_record'
        continue
      }
      try {
        await options.projectEnvelope(envelope)
      } catch {
        lastFailure = 'ledger_projection_failed'
        throw new Error('Durable anomaly ledger replay failed; pending evidence was retained.')
      }
      await fs.unlink(filePath)
      await syncDirectory(options.directoryPath)
    }
  }

  /** Enforces the named pending-byte hypothesis without an in-memory overflow. */
  async function assertPendingCapacity(nextBytes) {
    const entries = await fs.readdir(options.directoryPath, { withFileTypes: true })
    let pendingBytes = 0
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) {
        continue
      }
      pendingBytes += (await fs.stat(path.join(options.directoryPath, entry.name))).size
    }
    if (
      pendingBytes + nextBytes >
      INGEST_ANOMALY_OUTBOX_MAX_PENDING_BYTES_HYPOTHESIS
    ) {
      lastFailure = 'outbox_capacity_exhausted'
      throw new Error('Durable anomaly outbox capacity is exhausted; evidence was not acknowledged.')
    }
  }

  return { deliver, health, initialize }
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
async function writeAtomic(filePath, contents) {
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
  await syncDirectory(path.dirname(filePath))
}

/** Flushes directory metadata on platforms that support directory handles. */
async function syncDirectory(directoryPath) {
  let handle
  try {
    handle = await fs.open(directoryPath, 'r')
    await handle.sync()
  } finally {
    await handle?.close()
  }
}

module.exports = {
  createIngestAnomalyOutbox,
  INGEST_ANOMALY_OUTBOX_MAX_PENDING_BYTES_HYPOTHESIS,
}
