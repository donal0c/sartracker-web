'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { createHash, randomBytes } = require('node:crypto')
const { parentPort, workerData, isMainThread } = require('node:worker_threads')

const Database = require('better-sqlite3')
const {
  DEFAULT_ARCHIVE_FRAME_SIZE,
  canonicalJson,
  writeArchiveContainer,
} = require('./archive-container.cjs')
const {
  generateMissionArchiveKey,
  normalizeRecoveryCode,
  wrapMissionArchiveKey,
  zeroBuffer,
} = require('./archive-crypto.cjs')
const { normalizeArchiveCreateRequest } = require('./archive-envelope.cjs')
const { readArchiveCustodyFileIdentity } = require('./archive-custody-file.cjs')
const {
  createArchiveInventoryDocument,
  digestArchiveInventoryDocument,
} = require('./archive-inventory.cjs')
const { streamArchiveAttachment } = require('./archive-attachments.cjs')
const { createMissionArchiveScratch } = require('./archive-scratch.cjs')

const MAX_ARCHIVE_MANIFEST_BYTES = 4 * 1024 * 1024
const FILE_DIGEST_PROGRESS_BYTES = 8 * 1024 * 1024
const WORKER_FAILURE_CODES = new Set([
  'ARCHIVE_ATTACHMENT_CHANGED',
  'ARCHIVE_ATTACHMENT_INVALID',
  'ARCHIVE_ATTACHMENT_MISSING',
  'ARCHIVE_CANCELLED',
  'ARCHIVE_CREATE_FAILED',
  'ARCHIVE_DISK_FULL',
  'ARCHIVE_GPX_CUSTODY_UNSETTLED',
  'ARCHIVE_PLAINTEXT_CLEANUP_FAILED',
  'ARCHIVE_SCOPE_INVALID',
  'ARCHIVE_SOURCE_CHANGED',
])

/** Throws cancellation at bounded worker checkpoints. */
function assertNotCancelled(cancellationFlag) {
  if (Atomics.load(cancellationFlag, 0) !== 0) {
    const error = new Error('Mission archive creation was cancelled.')
    error.code = 'ARCHIVE_CANCELLED'
    throw error
  }
}

/** Returns the lowercase SHA-256 and exact size of one file without whole-file buffering. */
function digestFile(filePath, cancellationFlag, onProgress) {
  const descriptor = fs.openSync(filePath, fs.constants.O_RDONLY)
  const hash = createHash('sha256')
  const chunk = Buffer.allocUnsafe(64 * 1024)
  let sizeBytes = 0
  let lastProgressBytes = 0
  try {
    while (true) {
      assertNotCancelled(cancellationFlag)
      const bytesRead = fs.readSync(descriptor, chunk, 0, chunk.length, null)
      if (bytesRead === 0) break
      hash.update(chunk.subarray(0, bytesRead))
      sizeBytes += bytesRead
      if (!Number.isSafeInteger(sizeBytes)) {
        throw new Error('Mission archive file is too large for exact byte accounting.')
      }
      if (sizeBytes - lastProgressBytes >= FILE_DIGEST_PROGRESS_BYTES) {
        onProgress?.(sizeBytes)
        lastProgressBytes = sizeBytes
      }
    }
    if (sizeBytes > lastProgressBytes) onProgress?.(sizeBytes)
    return { sizeBytes, sha256: hash.digest('hex') }
  } finally {
    chunk.fill(0)
    fs.closeSync(descriptor)
  }
}

/** Hashes one in-memory metadata entry. */
function digestBuffer(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

/** Streams one file using the container's async-iterable boundary. */
async function* streamFile(filePath, cancellationFlag) {
  const stream = fs.createReadStream(filePath, { highWaterMark: 64 * 1024 })
  try {
    for await (const chunk of stream) {
      assertNotCancelled(cancellationFlag)
      yield chunk
    }
  } finally {
    stream.destroy()
  }
}

/** Requires enough free space for scratch and ciphertext before plaintext creation. */
function assertDiskPreflight(request) {
  const sourceBytes = fs.statSync(request.databasePath).size
  const requiredBytes = Math.max(64 * 1024 * 1024, sourceBytes * 2 + 32 * 1024 * 1024)
  const capacity = fs.statfsSync(request.archiveDirectory)
  const availableBytes = Number(BigInt(capacity.bavail) * BigInt(capacity.bsize))
  if (!Number.isSafeInteger(availableBytes) || availableBytes < requiredBytes) {
    const error = new Error('Mission archive storage has insufficient free space.')
    error.code = 'ARCHIVE_DISK_FULL'
    throw error
  }
}

/** Fsyncs one completed file and its containing directory. */
function syncCompletedFile(filePath) {
  const fileDescriptor = fs.openSync(filePath, fs.constants.O_RDONLY)
  try {
    fs.fsyncSync(fileDescriptor)
  } finally {
    fs.closeSync(fileDescriptor)
  }
  const directoryDescriptor = fs.openSync(path.dirname(filePath), fs.constants.O_RDONLY)
  try {
    fs.fsyncSync(directoryDescriptor)
  } finally {
    fs.closeSync(directoryDescriptor)
  }
}

/** Creates the worker-owned staging directory without accepting a reused operation path. */
function createOperationDirectory(request) {
  fs.mkdirSync(request.archiveDirectory, { recursive: true, mode: 0o700 })
  const archiveStat = fs.lstatSync(request.archiveDirectory)
  if (!archiveStat.isDirectory() || archiveStat.isSymbolicLink()) {
    const error = new Error('Mission archive custody directory is unsafe.')
    error.code = 'ARCHIVE_SCOPE_INVALID'
    throw error
  }
  const stagingRoot = path.join(request.archiveDirectory, '.staging')
  fs.mkdirSync(stagingRoot, { recursive: true, mode: 0o700 })
  const operationDirectory = path.join(stagingRoot, request.operationId)
  fs.mkdirSync(operationDirectory, { recursive: false, mode: 0o700 })
  fs.chmodSync(operationDirectory, 0o700)
  return operationDirectory
}

/** Removes only the exact worker-created operation directory. */
function removeOperationDirectory(operationDirectory) {
  if (operationDirectory === null) return
  try {
    const stat = fs.lstatSync(operationDirectory)
    if (stat.isSymbolicLink()) {
      fs.unlinkSync(operationDirectory)
      return
    }
    if (stat.isDirectory()) fs.rmSync(operationDirectory, { recursive: true, force: true })
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
}

/** Projects internal attachment descriptors into encrypted manifest metadata. */
function projectAttachmentManifest(descriptors) {
  return descriptors.map((descriptor) => ({
    attachment_id: descriptor.attachmentId,
    custody_class: descriptor.custodyClass,
    entry_name: descriptor.entryName,
    references: descriptor.references.map((reference) => ({
      reference_id: reference.referenceId,
      reference_kind: reference.referenceKind,
    })),
    sha256: descriptor.sha256,
    size_bytes: descriptor.sizeBytes,
    source_relative_path: descriptor.sourceRelativePath,
  }))
}

/** Creates one complete encrypted archive in worker-owned staging. */
async function createMissionArchiveFile(input) {
  const { request, passphraseBytes, recoveryCodeBytes, cancellationFlag, onProgress } = input
  let operationDirectory = null
  let missionArchiveKey
  let missionBytes
  let inventoryBytes
  let manifestBytes
  let headerDigest
  let noncePrefix
  let success = false
  let progressSequence = 0
  const emit = (phase, unit, completed, total, detail) => {
    progressSequence += 1
    onProgress?.({
      type: 'progress',
      operationId: request.operationId,
      sequence: progressSequence,
      phase,
      unit,
      completed,
      total,
      detail,
    })
  }
  try {
    assertNotCancelled(cancellationFlag)
    operationDirectory = createOperationDirectory(request)
    assertDiskPreflight(request)
    emit('preflight', 'phases', 1, 1, 'storage')

    const plaintextDirectory = path.join(operationDirectory, 'plaintext')
    const scratchDatabasePath = path.join(plaintextDirectory, 'mission-store.sqlite')
    emit('snapshot', 'phases', 1, 1, 'pinned-source')
    const scratch = createMissionArchiveScratch({
      sourceDatabasePath: request.databasePath,
      scratchDatabasePath,
      missionId: request.missionId,
      archiveId: request.archiveId,
      operationId: request.operationId,
      archiveKind: request.archiveKind,
      requestEventRowid: request.requestEventRowid,
      protectedFinalizationEpoch: request.protectedFinalizationEpoch,
      fenceRequestedAt: request.fenceRequestedAt,
      requestEventId: request.requestEventId,
      previousArchiveId: request.previousArchiveId ?? null,
      schemaVersion: request.schemaVersion,
      inventoryVersion: request.inventoryVersion,
      finalizationProjection: request.finalizationProjection ?? null,
      isCancelled: () => Atomics.load(cancellationFlag, 0) !== 0,
      onProgress: (progress) => emit(
        progress.phase,
        progress.unit,
        progress.completed,
        progress.total,
        progress.detail,
      ),
    })
    assertNotCancelled(cancellationFlag)

    const scratchDb = new Database(scratchDatabasePath, { readonly: true, fileMustExist: true })
    let mission
    try {
      mission = scratchDb.prepare('SELECT * FROM missions WHERE id = ?').get(request.missionId)
    } finally {
      scratchDb.close()
    }
    missionBytes = Buffer.from(canonicalJson(mission), 'utf8')
    const inventoryDocument = createArchiveInventoryDocument({
      schemaVersion: request.schemaVersion,
    })
    inventoryBytes = Buffer.from(canonicalJson(inventoryDocument), 'utf8')
    const inventorySha256 = digestArchiveInventoryDocument(inventoryDocument)
    emit('digest', 'bytes', 0, null, 'scratch-database')
    const sqliteProof = digestFile(
      scratchDatabasePath,
      cancellationFlag,
      (completed) => emit('digest', 'bytes', completed, null, 'scratch-database'),
    )
    const entryProofs = [
      { name: 'mission.json', size_bytes: missionBytes.length, sha256: digestBuffer(missionBytes) },
      { name: 'inventory.json', size_bytes: inventoryBytes.length, sha256: digestBuffer(inventoryBytes) },
      { name: 'mission-store.sqlite', size_bytes: sqliteProof.sizeBytes, sha256: sqliteProof.sha256 },
      ...scratch.attachments.map((descriptor) => ({
        name: descriptor.entryName,
        size_bytes: descriptor.sizeBytes,
        sha256: descriptor.sha256,
      })),
    ]
    const manifest = {
      archive_id: request.archiveId,
      archive_kind: request.archiveKind,
      attachments: projectAttachmentManifest(scratch.attachments),
      creation_operation_id: request.operationId,
      created_at: request.createdAt,
      entries: entryProofs,
      request_event_rowid: request.requestEventRowid,
      gpx_content: scratch.sourceGpxContentProof,
      inventory_sha256: inventorySha256,
      inventory_version: request.inventoryVersion,
      manifest_version: 1,
      mission_id: request.missionId,
      previous_archive_sha256: request.previousArchiveSha256,
      protected_finalization_epoch: request.protectedFinalizationEpoch,
      replay_semantic_proof: scratch.sourceReplaySemanticProof,
      request_event_id: request.requestEventId,
      schema_ledger: scratch.schemaLedger,
      schema_version: request.schemaVersion,
      tables: scratch.tableProofs.map((proof) => ({
        content_sha256: proof.contentSha256,
        decision: proof.decision,
        row_count: proof.rowCount,
        table_name: proof.tableName,
      })),
    }
    manifestBytes = Buffer.from(canonicalJson(manifest), 'utf8')
    if (manifestBytes.length > MAX_ARCHIVE_MANIFEST_BYTES) {
      const error = new Error('Mission archive manifest exceeds its safe bound.')
      error.code = 'ARCHIVE_CREATE_FAILED'
      throw error
    }
    const manifestSha256 = digestBuffer(manifestBytes)

    noncePrefix = randomBytes(4)
    const header = {
      cipher: 'aes-256-gcm',
      container_version: 2,
      created_at: request.createdAt,
      creation_operation_id: request.operationId,
      request_event_rowid: request.requestEventRowid,
      frame_size: DEFAULT_ARCHIVE_FRAME_SIZE,
      framing: 'sararch2-framed-v1',
      inventory_version: request.inventoryVersion,
      key_slot_count: 2,
      mission_id: request.missionId,
      nonce_prefix: noncePrefix.toString('base64'),
      previous_archive_sha256: request.previousArchiveSha256,
      protected_finalization_epoch: request.protectedFinalizationEpoch,
      request_event_id: request.requestEventId,
      schema_version: request.schemaVersion,
    }
    headerDigest = createHash('sha256').update(canonicalJson(header), 'utf8').digest()
    missionArchiveKey = generateMissionArchiveKey()
    const kdfStartedAt = performance.now()
    const passphraseSlot = await wrapMissionArchiveKey({
      missionArchiveKey,
      slotType: 'passphrase',
      slotId: 'passphrase-v1',
      secret: passphraseBytes,
      headerDigest,
    })
    assertNotCancelled(cancellationFlag)
    const recoveryCode = normalizeRecoveryCode(recoveryCodeBytes.toString('utf8'))
    const recoverySlot = await wrapMissionArchiveKey({
      missionArchiveKey,
      slotType: 'recovery',
      slotId: 'recovery-v1',
      secret: recoveryCode,
      headerDigest,
    })
    const kdfDurationMs = performance.now() - kdfStartedAt
    headerDigest.fill(0)
    noncePrefix.fill(0)
    assertNotCancelled(cancellationFlag)

    const temporaryRelativePath = `.staging/${request.operationId}/${request.archiveId}.sararch.tmp`
    const temporaryPath = path.join(request.archiveDirectory, temporaryRelativePath)
    const entries = [
      { name: 'manifest.json', size: manifestBytes.length, source: manifestBytes },
      { name: 'mission.json', size: missionBytes.length, source: missionBytes },
      { name: 'inventory.json', size: inventoryBytes.length, source: inventoryBytes },
      {
        name: 'mission-store.sqlite',
        size: sqliteProof.sizeBytes,
        source: streamFile(scratchDatabasePath, cancellationFlag),
      },
      ...scratch.attachments.map((descriptor) => ({
        name: descriptor.entryName,
        size: descriptor.sizeBytes,
        source: streamArchiveAttachment(descriptor),
      })),
    ]
    const writable = fs.createWriteStream(temporaryPath, { flags: 'wx', mode: 0o600 })
    emit('encrypt', 'bytes', 0, null, 'container')
    const written = await writeArchiveContainer({
      writable,
      header,
      keySlots: [passphraseSlot, recoverySlot],
      missionArchiveKey,
      entries,
      onProgress: ({ processedBytes }) => emit(
        'encrypt', 'bytes', processedBytes, null, 'container',
      ),
    })
    emit('encrypt', 'bytes', written.sizeBytes, null, 'container')
    syncCompletedFile(temporaryPath)
    emit('sync', 'files', 1, 1, 'ciphertext')

    fs.rmSync(plaintextDirectory, { recursive: true, force: true })
    if (fs.existsSync(plaintextDirectory)) {
      const error = new Error('Mission archive plaintext cleanup did not complete.')
      error.code = 'ARCHIVE_PLAINTEXT_CLEANUP_FAILED'
      throw error
    }
    emit('plaintext_cleanup', 'files', 1, 1, 'scratch')
    syncCompletedFile(temporaryPath)
    const temporaryFileIdentity = readArchiveCustodyFileIdentity({
      archiveDirectory: request.archiveDirectory,
      archiveRelativePath: temporaryRelativePath,
    })
    if (temporaryFileIdentity.sizeBytes !== written.sizeBytes) {
      const error = new Error('Mission archive staging identity has the wrong size.')
      error.code = 'ARCHIVE_SOURCE_CHANGED'
      throw error
    }
    success = true
    emit('complete', 'phases', 1, 1, 'staged')
    return {
      type: 'complete',
      operationId: request.operationId,
      archiveId: request.archiveId,
      missionId: request.missionId,
      requestEventRowid: request.requestEventRowid,
      requestEventId: request.requestEventId,
      protectedFinalizationEpoch: request.protectedFinalizationEpoch,
      archiveKind: request.archiveKind,
      containerVersion: 2,
      schemaVersion: request.schemaVersion,
      inventoryVersion: request.inventoryVersion,
      temporaryRelativePath,
      finalRelativePath: `${request.archiveId}.sararch`,
      ciphertextSha256: written.ciphertextSha256,
      sizeBytes: written.sizeBytes,
      temporaryFileIdentity,
      frameCount: Number(written.frameCount),
      headerSha256: written.headerDigest,
      plaintextSweepConfirmed: true,
      slots: [
        { slotType: 'passphrase', slotId: passphraseSlot.slotId },
        { slotType: 'recovery', slotId: recoverySlot.slotId },
      ],
      manifestSummary: {
        entryCount: entries.length,
        tableCount: scratch.tableProofs.length,
        inventorySha256,
        manifestSha256,
      },
      kdfDurationMs,
    }
  } catch (error) {
    if (error?.code === 'ENOSPC' || error?.code === 'SQLITE_FULL') {
      error.code = 'ARCHIVE_DISK_FULL'
    }
    throw error
  } finally {
    zeroBuffer(passphraseBytes)
    zeroBuffer(recoveryCodeBytes)
    if (missionArchiveKey !== undefined) zeroBuffer(missionArchiveKey)
    if (missionBytes !== undefined) zeroBuffer(missionBytes)
    if (inventoryBytes !== undefined) zeroBuffer(inventoryBytes)
    if (manifestBytes !== undefined) zeroBuffer(manifestBytes)
    if (headerDigest !== undefined) zeroBuffer(headerDigest)
    if (noncePrefix !== undefined) zeroBuffer(noncePrefix)
    if (!success) removeOperationDirectory(operationDirectory)
  }
}

/** Waits for the one transferred credential message and maps cancellation to the shared flag. */
function waitForCredentials(port, request, cancellationFlag) {
  return new Promise((resolve, reject) => {
    const onMessage = (message) => {
      if (message?.type === 'cancel' && message.operationId === request.operationId) {
        Atomics.store(cancellationFlag, 0, 1)
        return
      }
      if (
        message?.type !== 'credentials'
        || message.operationId !== request.operationId
        || !(message.passphraseBytes instanceof ArrayBuffer)
        || !(message.recoveryCodeBytes instanceof ArrayBuffer)
        || message.passphraseBytes.byteLength < 14
        || message.passphraseBytes.byteLength > 1_024
        || message.recoveryCodeBytes.byteLength < 40
        || message.recoveryCodeBytes.byteLength > 64
      ) {
        port.off('message', onMessage)
        reject(new Error('Mission archive worker received invalid credentials.'))
        return
      }
      port.off('message', onMessage)
      resolve({
        passphraseBytes: Buffer.from(message.passphraseBytes),
        recoveryCodeBytes: Buffer.from(message.recoveryCodeBytes),
      })
    }
    port.on('message', onMessage)
  })
}

/** Runs the worker-thread entrypoint with closed messages and no raw failure reflection. */
async function runWorker() {
  const cancellationFlag = new Int32Array(workerData.cancellationBuffer)
  let credentials
  try {
    credentials = await waitForCredentials(parentPort, workerData.request, cancellationFlag)
    const request = normalizeArchiveCreateRequest({
      ...workerData.request,
      passphrase: credentials.passphraseBytes.toString('utf8'),
      recoveryCode: credentials.recoveryCodeBytes.toString('utf8'),
    })
    const result = await createMissionArchiveFile({
      request,
      ...credentials,
      cancellationFlag,
      onProgress: (message) => parentPort.postMessage(message),
    })
    parentPort.postMessage(result)
  } catch (error) {
    const code = WORKER_FAILURE_CODES.has(error?.code) ? error.code : 'ARCHIVE_CREATE_FAILED'
    parentPort.postMessage({
      type: 'error',
      operationId: workerData.request?.operationId,
      code,
      message: 'Mission archive creation failed safely.',
    })
  } finally {
    if (credentials !== undefined) {
      zeroBuffer(credentials.passphraseBytes)
      zeroBuffer(credentials.recoveryCodeBytes)
    }
    parentPort.close()
  }
}

if (!isMainThread) void runWorker()

module.exports = { createMissionArchiveFile }
