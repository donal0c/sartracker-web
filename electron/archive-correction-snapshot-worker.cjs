'use strict'

const { isMainThread, parentPort, workerData } = require('node:worker_threads')
const fs = require('node:fs/promises')
const path = require('node:path')
const { createHash, randomUUID } = require('node:crypto')

if (isMainThread || parentPort === null) {
  throw new Error('Archive correction snapshot worker must run outside the Electron main isolate.')
}

const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024
const SHA256 = /^[0-9a-f]{64}$/u
const cancellationFlag = new Int32Array(workerData.cancellationBuffer)

/** Throws the stable cancellation error at every bounded copy checkpoint. */
function throwIfCancelled() {
  if (Atomics.load(cancellationFlag, 0) !== 0) {
    const error = new Error('Archive correction snapshot was cancelled.')
    error.code = 'ARCHIVE_CANCELLED'
    throw error
  }
}

/** Returns one stable invalid-request error without reflecting filesystem paths. */
function invalidRequestError() {
  const error = new Error('Archive correction snapshot request is invalid.')
  error.code = 'ARCHIVE_REVIEW_RESTORE_SUBSTITUTED'
  return error
}

/** Validates one archive-authenticated attachment mapping before any staging bytes are created. */
function isValidMapping(mapping) {
  return mapping !== null && typeof mapping === 'object' && !Array.isArray(mapping)
    && typeof mapping.entryName === 'string'
    && mapping.entryName.startsWith('attachments/')
    && mapping.entryName.split('/').length === 2
    && path.posix.dirname(mapping.entryName) === 'attachments'
    && typeof mapping.sourceRelativePath === 'string'
    && mapping.sourceRelativePath.length > 0
    && path.basename(mapping.sourceRelativePath) === mapping.sourceRelativePath
    && !['.', '..'].includes(mapping.sourceRelativePath)
    && Number.isSafeInteger(mapping.sizeBytes)
    && mapping.sizeBytes >= 1
    && mapping.sizeBytes <= MAX_ATTACHMENT_BYTES
    && SHA256.test(mapping.sha256 ?? '')
    && Array.isArray(mapping.references)
}

/** Validates one pinned regular file identity and expected size. */
function assertRegularFile(stat, expected) {
  if (!stat.isFile() || stat.nlink !== 1 || stat.size < 1
    || (expected?.sizeBytes !== undefined && stat.size !== expected.sizeBytes)) {
    throw invalidRequestError()
  }
  if (expected?.dev !== undefined && stat.dev !== expected.dev) throw invalidRequestError()
  if (expected?.ino !== undefined && stat.ino !== expected.ino) throw invalidRequestError()
}

/** Streams one descriptor, returning its pinned identity and SHA-256 digest. */
async function digestHandle(handle, expected = undefined) {
  const stat = await handle.stat()
  assertRegularFile(stat, expected)
  const hash = createHash('sha256')
  const chunk = Buffer.allocUnsafe(1024 * 1024)
  let offset = 0
  while (offset < stat.size) {
    throwIfCancelled()
    const result = await handle.read(chunk, 0, Math.min(chunk.length, stat.size - offset), offset)
    if (result.bytesRead < 1) throw invalidRequestError()
    hash.update(chunk.subarray(0, result.bytesRead))
    offset += result.bytesRead
  }
  return Object.freeze({
    dev: stat.dev,
    ino: stat.ino,
    sizeBytes: stat.size,
    sha256: hash.digest('hex'),
  })
}

/** Flushes a directory on Linux so a completed snapshot survives a process loss. */
async function syncDirectory(directory) {
  if (process.platform !== 'linux') return
  const handle = await fs.open(directory, fs.constants.O_RDONLY | (fs.constants.O_DIRECTORY ?? 0))
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

/** Copies the authenticated mission database into a temporary file and atomically publishes it. */
async function copyDatabase() {
  const source = await fs.open(
    workerData.sourcePath,
    fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0),
  )
  let temporaryPath
  let target
  try {
    const initial = await digestHandle(source, workerData.sourceIdentity)
    if (initial.sha256 !== workerData.expectedSha256) throw invalidRequestError()
    temporaryPath = `${workerData.snapshotPath}.tmp-${randomUUID()}`
    target = await fs.open(
      temporaryPath,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL
        | (fs.constants.O_NOFOLLOW ?? 0),
      0o600,
    )
    const chunk = Buffer.allocUnsafe(1024 * 1024)
    let offset = 0
    while (offset < initial.sizeBytes) {
      throwIfCancelled()
      const result = await source.read(chunk, 0, Math.min(chunk.length, initial.sizeBytes - offset), offset)
      if (result.bytesRead < 1) throw invalidRequestError()
      await target.write(chunk, 0, result.bytesRead)
      offset += result.bytesRead
    }
    await target.sync()
    await target.close()
    target = undefined
    await source.close()
    await fs.rename(temporaryPath, workerData.snapshotPath)
    temporaryPath = undefined
    await syncDirectory(workerData.stagingDirectory)

    const copied = await fs.open(
      workerData.snapshotPath,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0),
    )
    let copiedProof
    try {
      copiedProof = await digestHandle(copied)
    } finally {
      await copied.close()
    }
    if (copiedProof.sha256 !== workerData.expectedSha256
      || copiedProof.sizeBytes !== workerData.sourceIdentity.sizeBytes) throw invalidRequestError()

    const sourceAfter = await fs.open(
      workerData.sourcePath,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0),
    )
    let sourceProof
    try {
      sourceProof = await digestHandle(sourceAfter, workerData.sourceIdentity)
    } finally {
      await sourceAfter.close()
    }
    if (sourceProof.sha256 !== workerData.expectedSha256) throw invalidRequestError()
    return Object.freeze({
      databaseIdentity: Object.freeze({
        dev: copiedProof.dev,
        ino: copiedProof.ino,
        sizeBytes: copiedProof.sizeBytes,
      }),
      databaseSha256: copiedProof.sha256,
    })
  } finally {
    await target?.close().catch(() => undefined)
    await source.close().catch(() => undefined)
    if (temporaryPath !== undefined) await fs.rm(temporaryPath, { force: true }).catch(() => undefined)
  }
}

/** Copies and authenticates every archived attachment referenced by the session database. */
async function copyAttachments() {
  const mappings = workerData.attachmentMappings
  if (!Array.isArray(mappings) || mappings.some((mapping) => !isValidMapping(mapping))) {
    throw invalidRequestError()
  }
  const names = new Set()
  for (const mapping of mappings) {
    const stagedName = path.basename(mapping.entryName)
    if (names.has(stagedName)) throw invalidRequestError()
    names.add(stagedName)
  }
  const stagedDirectory = workerData.attachmentDirectory
  if (mappings.length === 0) return
  await fs.mkdir(stagedDirectory, { recursive: false, mode: 0o700 })
  const sourceDirectory = path.join(path.dirname(workerData.sourcePath), 'attachments')
  const sourceDirectoryStat = await fs.lstat(sourceDirectory)
  if (!sourceDirectoryStat.isDirectory() || sourceDirectoryStat.isSymbolicLink()) {
    throw invalidRequestError()
  }
  for (const mapping of mappings) {
    throwIfCancelled()
    const sourcePath = path.join(sourceDirectory, mapping.entryName.slice('attachments/'.length))
    if (path.dirname(sourcePath) !== sourceDirectory) throw invalidRequestError()
    const targetPath = path.join(stagedDirectory, path.basename(mapping.entryName))
    if (path.dirname(targetPath) !== stagedDirectory) throw invalidRequestError()
    const source = await fs.open(sourcePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0))
    let target
    let temporaryPath
    try {
      const proof = await digestHandle(source, { sizeBytes: mapping.sizeBytes })
      if (proof.sha256 !== mapping.sha256) throw invalidRequestError()
      temporaryPath = `${targetPath}.tmp-${randomUUID()}`
      target = await fs.open(
        temporaryPath,
        fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL
          | (fs.constants.O_NOFOLLOW ?? 0),
        0o600,
      )
      const chunk = Buffer.allocUnsafe(64 * 1024)
      let offset = 0
      while (offset < proof.sizeBytes) {
        throwIfCancelled()
        const result = await source.read(chunk, 0, Math.min(chunk.length, proof.sizeBytes - offset), offset)
        if (result.bytesRead < 1) throw invalidRequestError()
        await target.write(chunk, 0, result.bytesRead)
        offset += result.bytesRead
      }
      await target.sync()
      await target.close()
      target = undefined
      await fs.rename(temporaryPath, targetPath)
      temporaryPath = undefined
      await syncDirectory(stagedDirectory)
    } finally {
      await target?.close().catch(() => undefined)
      await source.close().catch(() => undefined)
      if (temporaryPath !== undefined) await fs.rm(temporaryPath, { force: true }).catch(() => undefined)
    }
  }
}

/** Runs the snapshot operation and reports one closed result to the manager. */
async function run() {
  if (!path.isAbsolute(workerData.sourcePath)
    || !path.isAbsolute(workerData.snapshotPath)
    || !path.isAbsolute(workerData.stagingDirectory)
    || !path.isAbsolute(workerData.attachmentDirectory)
    || workerData.snapshotPath !== path.join(workerData.stagingDirectory, 'mission-store.sqlite')
    || workerData.attachmentDirectory !== path.join(workerData.stagingDirectory, 'attachments')
    || !SHA256.test(workerData.expectedSha256 ?? '')
    || workerData.sourceIdentity === null
    || !Number.isSafeInteger(workerData.sourceIdentity.dev)
    || !Number.isSafeInteger(workerData.sourceIdentity.ino)
    || !Number.isSafeInteger(workerData.sourceIdentity.sizeBytes)
    || workerData.sourceIdentity.sizeBytes < 1) throw invalidRequestError()
  await fs.mkdir(workerData.stagingDirectory, { recursive: false, mode: 0o700 })
  const database = await copyDatabase()
  await copyAttachments()
  throwIfCancelled()
  parentPort.postMessage({
    type: 'complete',
    snapshotPath: workerData.snapshotPath,
    attachmentDirectory: workerData.attachmentDirectory,
    attachmentMappings: workerData.attachmentMappings,
    databaseIdentity: database.databaseIdentity,
    databaseSha256: database.databaseSha256,
  })
}

run().catch((error) => {
  parentPort.postMessage({
    type: 'error',
    code: typeof error?.code === 'string' ? error.code : 'ARCHIVE_REVIEW_RESTORE_SUBSTITUTED',
  })
})
