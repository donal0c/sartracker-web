'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { createHash, randomUUID } = require('node:crypto')

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const SHA256 = /^[0-9a-f]{64}$/u
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024 * 1024
const COPY_CHUNK_BYTES = 64 * 1024
const LIVE_STORE_RESERVE_BYTES = 1024 * 1024 * 1024

/** Stable archive-review attachment failure without a path-bearing message. */
class ArchiveReviewAttachmentOpenError extends Error {
  /** Creates one typed non-reflective attachment-opening failure. */
  constructor(code, message) {
    super(message)
    this.name = 'ArchiveReviewAttachmentOpenError'
    this.code = code
  }
}

/** Throws the one stable unavailable-attachment failure. */
function rejectAttachment(cause = undefined) {
  const failure = new ArchiveReviewAttachmentOpenError(
    'ARCHIVE_REVIEW_ATTACHMENT_UNAVAILABLE',
    'Archived attachment could not be opened safely.',
  )
  if (cause !== undefined) failure.cause = cause
  throw failure
}

/** Retains descriptor/stage cleanup actions until every one succeeds. */
function createRetryCleanupLease(resources) {
  let pending = [...resources]
  let closePromise = null
  return Object.freeze({
    close() {
      if (pending.length === 0) return Promise.resolve()
      if (closePromise !== null) return closePromise
      const attempt = (async () => {
        const results = await Promise.all(pending.map(async (resource) => {
          try {
            await resource.close()
            return Object.freeze({ resource, error: null })
          } catch (error) {
            return Object.freeze({ resource, error })
          }
        }))
        pending = results.filter((result) => result.error !== null)
          .map((result) => result.resource)
        const failure = results.find((result) => result.error !== null)?.error
        if (failure instanceof ArchiveReviewAttachmentOpenError) throw failure
        if (failure !== undefined) rejectAttachment(failure)
      })()
      closePromise = attempt
      void attempt.finally(() => {
        if (closePromise === attempt) closePromise = null
      }).catch(() => undefined)
      return attempt
    },
  })
}

/** Rejects while giving the owning review source a non-public cleanup capability. */
function rejectAttachmentWithCleanup(resources, cause = undefined) {
  const failure = new ArchiveReviewAttachmentOpenError(
    'ARCHIVE_REVIEW_ATTACHMENT_UNAVAILABLE',
    'Archived attachment could not be opened safely.',
  )
  if (cause !== undefined) failure.cause = cause
  Object.defineProperty(failure, 'cleanupLease', {
    value: createRetryCleanupLease(resources),
  })
  throw failure
}

/** Requires one canonical absolute directory path. */
function normalizeDirectory(value) {
  if (typeof value !== 'string'
    || value.length < 1
    || Buffer.byteLength(value, 'utf8') > 8_192
    || value.includes('\0')
    || !path.isAbsolute(value)
    || path.resolve(value) !== value) rejectAttachment()
  return value
}

/** Pins a real directory and optionally requires its earlier identity. */
function pinDirectory(directory, expected = null) {
  let stat
  let realPath
  try {
    stat = fs.lstatSync(directory)
    realPath = fs.realpathSync(directory)
  } catch (error) {
    rejectAttachment(error)
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()
    || (expected !== null
      && (stat.dev !== expected.dev || stat.ino !== expected.ino
        || realPath !== expected.realPath))) rejectAttachment()
  return Object.freeze({ dev: stat.dev, ino: stat.ino, realPath })
}

/** Writes one complete buffer to a pinned destination handle. */
async function writeAll(handle, buffer, position, signal) {
  let offset = 0
  while (offset < buffer.length) {
    assertNotAborted(signal)
    const written = await handle.write(
      buffer,
      offset,
      buffer.length - offset,
      position + offset,
    )
    if (written.bytesWritten < 1) rejectAttachment()
    offset += written.bytesWritten
  }
}

/** Stops attachment staging promptly when the owning read source closes. */
function assertNotAborted(signal) {
  if (signal?.aborted === true) rejectAttachment()
}

/** Bounds a path-only desktop-shell handoff by the source-owned abort signal. */
async function openPathWithAbort(openPath, stagePath, signal) {
  assertNotAborted(signal)
  const opening = Promise.resolve(openPath(stagePath))
  if (signal === undefined) return opening
  let abortListener
  const aborted = new Promise((_, reject) => {
    abortListener = () => {
      try { assertNotAborted(signal) } catch (error) { reject(error) }
    }
    signal.addEventListener('abort', abortListener, { once: true })
  })
  try {
    return await Promise.race([opening, aborted])
  } finally {
    signal.removeEventListener('abort', abortListener)
    void opening.catch(() => undefined)
  }
}

/** Requires enough same-filesystem capacity to preserve a fixed live-store reserve. */
function assertStagingCapacity(input, sessionDirectory) {
  let availableBytes
  try {
    if (input.getAvailableDiskBytes !== undefined) {
      availableBytes = input.getAvailableDiskBytes()
    } else {
      const capacity = fs.statfsSync(sessionDirectory, { bigint: true })
      availableBytes = capacity.bavail * capacity.bsize
    }
    const available = typeof availableBytes === 'bigint'
      ? availableBytes
      : BigInt(availableBytes)
    if (available - BigInt(input.expectedSizeBytes) < BigInt(LIVE_STORE_RESERVE_BYTES)) {
      rejectAttachment()
    }
  } catch (error) {
    if (error instanceof ArchiveReviewAttachmentOpenError) throw error
    rejectAttachment(error)
  }
}

/** Atomically quarantines and unlinks only the exact pinned stage inode. */
function removePinnedStage(input) {
  pinDirectory(input.sessionDirectory, input.sessionIdentity)
  pinDirectory(input.launchRoot, input.launchIdentity)
  pinDirectory(input.operationDirectory, input.operationIdentity)
  const stageStat = fs.lstatSync(input.stagePath)
  if (!stageStat.isFile() || stageStat.isSymbolicLink()
    || stageStat.dev !== input.stageIdentity.dev
    || stageStat.ino !== input.stageIdentity.ino) rejectAttachment()
  const quarantinePath = path.join(input.operationDirectory, '.sweep-opened-attachment')
  fs.renameSync(input.stagePath, quarantinePath)
  const quarantineStat = fs.lstatSync(quarantinePath)
  if (!quarantineStat.isFile() || quarantineStat.isSymbolicLink()
    || quarantineStat.dev !== input.stageIdentity.dev
    || quarantineStat.ino !== input.stageIdentity.ino) rejectAttachment()
  fs.unlinkSync(quarantinePath)
  // Directory and viewer-sidecar residue remains inside the explicit open-session
  // residual. The identity-bound whole-session sweep owns all directory removal.
}

/** Retains one successfully launched private stage until the review source closes. */
function createStageLease(input, stageHandle) {
  let closed = false
  let stageRemoved = false
  let descriptorClosed = false
  let closePromise = null
  return Object.freeze({
    opened: true,
    close() {
      if (closed) return Promise.resolve()
      if (closePromise !== null) return closePromise
      const attempt = (async () => {
        let removalFailure = null
        let descriptorFailure = null
        if (!stageRemoved) {
          try {
            removePinnedStage(input)
            stageRemoved = true
          } catch (error) {
            removalFailure = error
            await stageHandle.truncate(0).catch(() => undefined)
            await stageHandle.sync().catch(() => undefined)
          }
        }
        if (!descriptorClosed) {
          try {
            await stageHandle.close()
            descriptorClosed = true
          } catch (error) {
            descriptorFailure = error
          }
        }
        if (descriptorFailure !== null) {
          await stageHandle.truncate(0).catch(() => undefined)
          await stageHandle.sync().catch(() => undefined)
        }
        const failure = removalFailure ?? descriptorFailure
        if (failure instanceof ArchiveReviewAttachmentOpenError) throw failure
        if (failure !== null) rejectAttachment(failure)
        closed = stageRemoved && descriptorClosed
      })()
      closePromise = attempt
      void attempt.catch(() => {
        if (closePromise === attempt) closePromise = null
      })
      return attempt
    },
  })
}

/**
 * Copies a pinned restored attachment into a private verified stage before shell launch.
 * The original restored pathname is never passed to Electron's path-only shell API.
 */
async function openVerifiedRestoredAttachment(input) {
  const sessionDirectory = normalizeDirectory(input?.sessionDirectory)
  const restoredPath = typeof input?.restoredPath === 'string'
    ? input.restoredPath
    : rejectAttachment()
  const displayName = typeof input?.displayName === 'string'
    ? input.displayName
    : rejectAttachment()
  if (path.dirname(restoredPath) !== path.join(sessionDirectory, 'attachments')
    || path.basename(displayName) !== displayName
    || displayName !== displayName.normalize('NFC')
    || Buffer.byteLength(displayName, 'utf8') < 1
    || Buffer.byteLength(displayName, 'utf8') > 255
    || /[\u0000-\u001f\u007f]/u.test(displayName)
    || !Number.isSafeInteger(input?.expectedSizeBytes)
    || input.expectedSizeBytes < 1
    || input.expectedSizeBytes > MAX_ATTACHMENT_BYTES
    || typeof input?.expectedSha256 !== 'string'
    || !SHA256.test(input.expectedSha256)
    || typeof input?.openPath !== 'function'
    || (input.signal !== undefined
      && (typeof input.signal !== 'object'
        || typeof input.signal.addEventListener !== 'function'
        || typeof input.signal.removeEventListener !== 'function'
        || typeof input.signal.aborted !== 'boolean'))
    || (input.beforeCopy !== undefined && typeof input.beforeCopy !== 'function')
    || (input.getAvailableDiskBytes !== undefined
      && typeof input.getAvailableDiskBytes !== 'function')
    || (input.randomUUID !== undefined && typeof input.randomUUID !== 'function')) {
    rejectAttachment()
  }
  const openFile = input.openFile ?? fs.promises.open.bind(fs.promises)
  if (typeof openFile !== 'function') rejectAttachment()
  const sessionIdentity = pinDirectory(sessionDirectory)
  const attachmentsDirectory = path.join(sessionDirectory, 'attachments')
  const attachmentsIdentity = pinDirectory(attachmentsDirectory)
  let sourceHandle = null
  let stageHandle = null
  let operationDirectory = null
  let stagePath = null
  let stageIdentity = null
  let launchRoot = null
  let launchIdentity = null
  let operationIdentity = null
  let stageRemoved = false
  let successfulStageLease = null
  try {
    assertNotAborted(input.signal)
    sourceHandle = await openFile(
      restoredPath,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
    )
    const [sourceStat, restoredRealPath] = await Promise.all([
      sourceHandle.stat(),
      fs.promises.realpath(restoredPath),
    ])
    const pathStat = fs.lstatSync(restoredPath)
    if (!sourceStat.isFile() || sourceStat.nlink !== 1
      || sourceStat.size !== input.expectedSizeBytes
      || pathStat.dev !== sourceStat.dev || pathStat.ino !== sourceStat.ino
      || path.dirname(restoredRealPath) !== attachmentsIdentity.realPath) rejectAttachment()
    if (input.beforeCopy !== undefined) await input.beforeCopy()

    assertNotAborted(input.signal)
    assertStagingCapacity(input, sessionDirectory)
    pinDirectory(sessionDirectory, sessionIdentity)
    launchRoot = path.join(sessionDirectory, '.attachment-launch')
    try {
      fs.mkdirSync(launchRoot, { mode: 0o700 })
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
    }
    pinDirectory(sessionDirectory, sessionIdentity)
    launchIdentity = pinDirectory(launchRoot)
    fs.chmodSync(launchRoot, 0o700)
    const operationId = (input.randomUUID ?? randomUUID)()
    if (!UUID_V4.test(operationId)) rejectAttachment()
    operationDirectory = path.join(launchRoot, operationId)
    fs.mkdirSync(operationDirectory, { mode: 0o700 })
    pinDirectory(sessionDirectory, sessionIdentity)
    pinDirectory(launchRoot, launchIdentity)
    operationIdentity = pinDirectory(operationDirectory)
    stagePath = path.join(operationDirectory, displayName)
    stageHandle = await openFile(
      stagePath,
      fs.constants.O_RDWR
        | fs.constants.O_CREAT
        | fs.constants.O_EXCL
        | fs.constants.O_NOFOLLOW,
      0o600,
    )
    const [openedStageStat, stagePathStat] = await Promise.all([
      stageHandle.stat(),
      fs.promises.lstat(stagePath),
    ])
    pinDirectory(sessionDirectory, sessionIdentity)
    pinDirectory(launchRoot, launchIdentity)
    pinDirectory(operationDirectory, operationIdentity)
    if (!openedStageStat.isFile() || openedStageStat.nlink !== 1
      || openedStageStat.dev !== stagePathStat.dev
      || openedStageStat.ino !== stagePathStat.ino) rejectAttachment()
    stageIdentity = Object.freeze({ dev: openedStageStat.dev, ino: openedStageStat.ino })

    const hash = createHash('sha256')
    let position = 0
    while (position < input.expectedSizeBytes) {
      assertNotAborted(input.signal)
      const chunk = Buffer.allocUnsafe(Math.min(
        COPY_CHUNK_BYTES,
        input.expectedSizeBytes - position,
      ))
      const read = await sourceHandle.read(chunk, 0, chunk.length, position)
      if (read.bytesRead !== chunk.length) rejectAttachment()
      hash.update(chunk)
      await writeAll(stageHandle, chunk, position, input.signal)
      position += chunk.length
    }
    assertNotAborted(input.signal)
    const trailing = Buffer.allocUnsafe(1)
    if ((await sourceHandle.read(trailing, 0, 1, position)).bytesRead !== 0
      || hash.digest('hex') !== input.expectedSha256) rejectAttachment()
    await stageHandle.sync()
    await stageHandle.chmod(0o400)

    pinDirectory(sessionDirectory, sessionIdentity)
    pinDirectory(launchRoot, launchIdentity)
    pinDirectory(operationDirectory, operationIdentity)
    const stageStat = fs.lstatSync(stagePath)
    if (!stageStat.isFile() || stageStat.isSymbolicLink()
      || stageStat.nlink !== 1 || stageStat.size !== input.expectedSizeBytes) rejectAttachment()
    const errorMessage = await openPathWithAbort(input.openPath, stagePath, input.signal)
    if (errorMessage !== '') rejectAttachment()
    pinDirectory(sessionDirectory, sessionIdentity)
    pinDirectory(launchRoot, launchIdentity)
    pinDirectory(operationDirectory, operationIdentity)
    const postHandoffStat = fs.lstatSync(stagePath)
    if (!postHandoffStat.isFile() || postHandoffStat.isSymbolicLink()
      || postHandoffStat.dev !== stageIdentity.dev
      || postHandoffStat.ino !== stageIdentity.ino) rejectAttachment()
    successfulStageLease = createStageLease({
      sessionDirectory,
      sessionIdentity,
      launchRoot,
      launchIdentity,
      operationDirectory,
      operationIdentity,
      stagePath,
      stageIdentity,
    }, stageHandle)
    stageHandle = null
    return successfulStageLease
  } catch (error) {
    if (error instanceof ArchiveReviewAttachmentOpenError) throw error
    rejectAttachment(error)
  } finally {
    const retryCleanupResources = []
    if (stageHandle !== null) {
      if (!stageRemoved) {
        await stageHandle.truncate(0).catch(() => undefined)
        await stageHandle.sync().catch(() => undefined)
        if (stageIdentity !== null && launchRoot !== null && launchIdentity !== null
          && operationDirectory !== null && operationIdentity !== null && stagePath !== null) {
          try {
            removePinnedStage({
              sessionDirectory,
              sessionIdentity,
              launchRoot,
              launchIdentity,
              operationDirectory,
              operationIdentity,
              stagePath,
              stageIdentity,
            })
            stageRemoved = true
          } catch {
            // The descriptor has already been zeroed; never delete through a rebound path.
          }
        }
      }
      try {
        await stageHandle.close()
      } catch {
        retryCleanupResources.push(stageHandle)
      }
    }
    if (sourceHandle !== null) {
      try {
        await sourceHandle.close()
      } catch {
        retryCleanupResources.push(sourceHandle)
      }
    }
    if (retryCleanupResources.length > 0) {
      if (successfulStageLease !== null) retryCleanupResources.push(successfulStageLease)
      rejectAttachmentWithCleanup(retryCleanupResources)
    }
  }
}

module.exports = {
  ArchiveReviewAttachmentOpenError,
  openVerifiedRestoredAttachment,
}
