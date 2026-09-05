'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { isMainThread, parentPort, workerData } = require('node:worker_threads')

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const SWEEP_DIRECTORY = /^\.sweep-([0-9a-f-]{36})$/u
const PROGRESS_ENTRY_INTERVAL = 128

/** Closed failure used by the review-session plaintext sweep boundary. */
class ArchiveReviewSweepError extends Error {
  /** Creates one stable worker-owned failure. */
  constructor(code, message) {
    super(message)
    this.name = 'ArchiveReviewSweepError'
    this.code = code
  }
}

/** Requires one canonical fixed absolute directory path. */
function normalizeDirectory(value, label) {
  if (typeof value !== 'string'
    || value.length < 1
    || Buffer.byteLength(value, 'utf8') > 8_192
    || value.includes('\0')
    || !path.isAbsolute(value)
    || path.resolve(value) !== value) {
    throw new ArchiveReviewSweepError(
      'ARCHIVE_REVIEW_SWEEP_SCOPE_INVALID',
      `${label} is invalid.`,
    )
  }
  return value
}

/** Requires one exact inode identity projected by the main isolate. */
function normalizeIdentity(value, label, includeRealPath = false) {
  const expectedKeys = includeRealPath ? 'dev,ino,realPath' : 'dev,ino'
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== expectedKeys
    || !Number.isSafeInteger(value.dev) || value.dev < 0
    || !Number.isSafeInteger(value.ino) || value.ino < 1
    || (includeRealPath && normalizeDirectory(value.realPath, `${label} real path`)
      !== value.realPath)) {
    throw new ArchiveReviewSweepError(
      'ARCHIVE_REVIEW_SWEEP_SCOPE_INVALID',
      `${label} is invalid.`,
    )
  }
  return Object.freeze({
    dev: value.dev,
    ino: value.ino,
    ...(includeRealPath ? { realPath: value.realPath } : {}),
  })
}

/** Requires one exact, closed worker ticket. */
function normalizeTicket(input) {
  const keys = [
    'archiveDirectory',
    'archiveDirectoryIdentity',
    'operationId',
    'quarantineDirectory',
    'quarantineIdentity',
    'reviewRoot',
    'rootIdentity',
  ]
  if (input === null || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).sort().join(',') !== keys.join(',')
    || typeof input.operationId !== 'string'
    || !UUID_V4.test(input.operationId)) {
    throw new ArchiveReviewSweepError(
      'ARCHIVE_REVIEW_SWEEP_SCOPE_INVALID',
      'Archive review sweep ticket is invalid.',
    )
  }
  const reviewRoot = normalizeDirectory(input.reviewRoot, 'Archive review root')
  const quarantineDirectory = normalizeDirectory(
    input.quarantineDirectory,
    'Archive review quarantine directory',
  )
  const archiveDirectory = normalizeDirectory(input.archiveDirectory, 'Archive directory')
  const sweepMatch = SWEEP_DIRECTORY.exec(path.basename(quarantineDirectory))
  if (path.dirname(quarantineDirectory) !== reviewRoot
    || sweepMatch === null
    || !UUID_V4.test(sweepMatch[1])) {
    throw new ArchiveReviewSweepError(
      'ARCHIVE_REVIEW_SWEEP_SCOPE_INVALID',
      'Archive review sweep scope is invalid.',
    )
  }
  return Object.freeze({
    operationId: input.operationId,
    reviewRoot,
    rootIdentity: normalizeIdentity(input.rootIdentity, 'Archive review root identity'),
    quarantineDirectory,
    quarantineIdentity: normalizeIdentity(
      input.quarantineIdentity,
      'Archive review quarantine identity',
    ),
    archiveDirectory,
    archiveDirectoryIdentity: normalizeIdentity(
      input.archiveDirectoryIdentity,
      'Archive directory identity',
      true,
    ),
  })
}

/** Throws before further filesystem work after cancellation. */
function assertNotCancelled(cancellationFlag) {
  if (Atomics.load(cancellationFlag, 0) !== 0) {
    throw new ArchiveReviewSweepError(
      'ARCHIVE_CANCELLED',
      'Archive review plaintext sweep was cancelled.',
    )
  }
}

/** Opens and pins one directory without following its final component. */
function openPinnedDirectory(directoryPath, expectedIdentity, failureCode) {
  const flags = fs.constants.O_RDONLY
    | (fs.constants.O_DIRECTORY ?? 0)
    | (fs.constants.O_NOFOLLOW ?? 0)
  let descriptor
  try {
    descriptor = fs.openSync(directoryPath, flags)
    const opened = fs.fstatSync(descriptor)
    const named = fs.lstatSync(directoryPath)
    if (!opened.isDirectory()
      || !named.isDirectory()
      || named.isSymbolicLink()
      || opened.dev !== named.dev
      || opened.ino !== named.ino
      || opened.dev !== expectedIdentity.dev
      || opened.ino !== expectedIdentity.ino) {
      throw new ArchiveReviewSweepError(
        failureCode,
        'Archive review plaintext sweep directory identity changed.',
      )
    }
    return Object.freeze({ descriptor, identity: expectedIdentity })
  } catch (error) {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor) } catch {}
    }
    if (error instanceof ArchiveReviewSweepError) throw error
    throw new ArchiveReviewSweepError(
      failureCode,
      'Archive review plaintext sweep directory is unavailable or unsafe.',
    )
  }
}

/** Requires one still-named path to retain its pinned inode and type. */
function assertPinnedPath(targetPath, expectedIdentity, expectedType) {
  let observed
  try {
    observed = fs.lstatSync(targetPath)
  } catch {
    throw new ArchiveReviewSweepError(
      'ARCHIVE_REVIEW_SWEEP_SCOPE_CHANGED',
      'Archive review plaintext sweep scope changed during cleanup.',
    )
  }
  const typeMatches = expectedType === 'directory'
    ? observed.isDirectory() && !observed.isSymbolicLink()
    : expectedType === 'file'
      ? observed.isFile()
      : observed.isSymbolicLink()
  if (!typeMatches
    || observed.dev !== expectedIdentity.dev
    || observed.ino !== expectedIdentity.ino) {
    throw new ArchiveReviewSweepError(
      'ARCHIVE_REVIEW_SWEEP_SCOPE_CHANGED',
      'Archive review plaintext sweep scope changed during cleanup.',
    )
  }
  return observed
}

/** Rejects lexical or real custody containment in either direction. */
function assertCustodySeparation(ticket) {
  let realReviewRoot
  let realArchiveDirectory
  try {
    realReviewRoot = fs.realpathSync(ticket.reviewRoot)
    realArchiveDirectory = fs.realpathSync(ticket.archiveDirectory)
  } catch {
    throw new ArchiveReviewSweepError(
      'ARCHIVE_REVIEW_SWEEP_SCOPE_CHANGED',
      'Archive review and ciphertext custody paths are unavailable.',
    )
  }
  if (realArchiveDirectory !== ticket.archiveDirectoryIdentity.realPath
    || realReviewRoot === realArchiveDirectory
    || realReviewRoot.startsWith(`${realArchiveDirectory}${path.sep}`)
    || realArchiveDirectory.startsWith(`${realReviewRoot}${path.sep}`)) {
    throw new ArchiveReviewSweepError(
      'ARCHIVE_REVIEW_SWEEP_SCOPE_CHANGED',
      'Archive review plaintext and ciphertext custody paths are unsafe.',
    )
  }
}

/** Rechecks every destructive boundary immediately before one mutation. */
function assertDestructiveBoundary(ticket) {
  assertCustodySeparation(ticket)
  assertPinnedPath(ticket.reviewRoot, ticket.rootIdentity, 'directory')
  assertPinnedPath(
    ticket.archiveDirectory,
    ticket.archiveDirectoryIdentity,
    'directory',
  )
  assertPinnedPath(
    ticket.quarantineDirectory,
    ticket.quarantineIdentity,
    'directory',
  )
}

/** Removes one pinned tree without following links or accepting hard-linked files. */
function removePinnedTree(ticket, directoryPath, directoryIdentity, topLevel, context) {
  assertNotCancelled(context.cancellationFlag)
  assertDestructiveBoundary(ticket)
  const opened = openPinnedDirectory(
    directoryPath,
    directoryIdentity,
    'ARCHIVE_REVIEW_SWEEP_SCOPE_CHANGED',
  )
  try {
    let names
    try {
      names = fs.readdirSync(directoryPath).sort()
    } catch {
      throw new ArchiveReviewSweepError(
        'ARCHIVE_REVIEW_SWEEP_FAILED',
        'Archive review plaintext sweep failed safely.',
      )
    }
    for (const name of names) {
      assertNotCancelled(context.cancellationFlag)
      if (topLevel && /\.(?:sararch|zip)$/iu.test(name)) {
        throw new ArchiveReviewSweepError(
          'ARCHIVE_REVIEW_SWEEP_CIPHERTEXT_BOUNDARY',
          'Archive review plaintext sweep refused a ciphertext-shaped top-level entry.',
        )
      }
      assertDestructiveBoundary(ticket)
      assertPinnedPath(directoryPath, directoryIdentity, 'directory')
      const entryPath = path.join(directoryPath, name)
      let entry
      try {
        entry = fs.lstatSync(entryPath)
      } catch {
        throw new ArchiveReviewSweepError(
          'ARCHIVE_REVIEW_SWEEP_SCOPE_CHANGED',
          'Archive review plaintext sweep entry changed during cleanup.',
        )
      }
      const entryIdentity = Object.freeze({ dev: entry.dev, ino: entry.ino })
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        removePinnedTree(ticket, entryPath, entryIdentity, false, context)
      } else {
        const expectedType = entry.isFile()
          ? 'file'
          : entry.isSymbolicLink() ? 'symlink' : null
        if (expectedType === null || (expectedType === 'file' && entry.nlink !== 1)) {
          throw new ArchiveReviewSweepError(
            'ARCHIVE_REVIEW_SWEEP_ENTRY_UNSAFE',
            'Archive review plaintext sweep found an unsafe entry.',
          )
        }
        assertNotCancelled(context.cancellationFlag)
        assertDestructiveBoundary(ticket)
        assertPinnedPath(directoryPath, directoryIdentity, 'directory')
        const current = assertPinnedPath(entryPath, entryIdentity, expectedType)
        if (current.isFile() && current.nlink !== 1) {
          throw new ArchiveReviewSweepError(
            'ARCHIVE_REVIEW_SWEEP_ENTRY_UNSAFE',
            'Archive review plaintext sweep found a hard-linked file.',
          )
        }
        try {
          fs.unlinkSync(entryPath)
        } catch {
          throw new ArchiveReviewSweepError(
            'ARCHIVE_REVIEW_SWEEP_FAILED',
            'Archive review plaintext sweep failed safely.',
          )
        }
        context.reportRemoval()
      }
    }
    assertNotCancelled(context.cancellationFlag)
    assertDestructiveBoundary(ticket)
    assertPinnedPath(directoryPath, directoryIdentity, 'directory')
    try {
      fs.rmdirSync(directoryPath)
    } catch {
      throw new ArchiveReviewSweepError(
        'ARCHIVE_REVIEW_SWEEP_FAILED',
        'Archive review plaintext sweep failed safely.',
      )
    }
    context.reportRemoval()
  } finally {
    fs.closeSync(opened.descriptor)
  }
}

/** Sweeps one already-quarantined app-owned review session tree. */
function sweepArchiveReviewQuarantine(input) {
  const ticket = normalizeTicket(input?.ticket)
  if (!(input?.cancellationFlag instanceof Int32Array)
    || input.cancellationFlag.length !== 1
    || typeof input.onProgress !== 'function') {
    throw new ArchiveReviewSweepError(
      'ARCHIVE_REVIEW_SWEEP_INPUT_INVALID',
      'Archive review plaintext sweep input is invalid.',
    )
  }
  assertNotCancelled(input.cancellationFlag)
  assertCustodySeparation(ticket)
  const root = openPinnedDirectory(
    ticket.reviewRoot,
    ticket.rootIdentity,
    'ARCHIVE_REVIEW_SWEEP_SCOPE_CHANGED',
  )
  const archive = openPinnedDirectory(
    ticket.archiveDirectory,
    ticket.archiveDirectoryIdentity,
    'ARCHIVE_REVIEW_SWEEP_SCOPE_CHANGED',
  )
  const quarantine = openPinnedDirectory(
    ticket.quarantineDirectory,
    ticket.quarantineIdentity,
    'ARCHIVE_REVIEW_SWEEP_SCOPE_CHANGED',
  )
  let removedEntryCount = 0
  let lastReportedEntryCount = 0
  const context = {
    cancellationFlag: input.cancellationFlag,
    reportRemoval() {
      removedEntryCount += 1
      if (removedEntryCount - lastReportedEntryCount >= PROGRESS_ENTRY_INTERVAL) {
        input.onProgress(removedEntryCount)
        lastReportedEntryCount = removedEntryCount
      }
    },
  }
  try {
    removePinnedTree(
      ticket,
      ticket.quarantineDirectory,
      ticket.quarantineIdentity,
      true,
      context,
    )
    if (removedEntryCount !== lastReportedEntryCount) input.onProgress(removedEntryCount)
    fs.fsyncSync(root.descriptor)
    return Object.freeze({ status: 'clean', removedEntryCount })
  } finally {
    fs.closeSync(quarantine.descriptor)
    fs.closeSync(archive.descriptor)
    fs.closeSync(root.descriptor)
  }
}

/** Maps internal failures to a small non-reflective worker vocabulary. */
function mapFailureCode(error) {
  const codes = new Set([
    'ARCHIVE_CANCELLED',
    'ARCHIVE_REVIEW_SWEEP_CIPHERTEXT_BOUNDARY',
    'ARCHIVE_REVIEW_SWEEP_ENTRY_UNSAFE',
    'ARCHIVE_REVIEW_SWEEP_FAILED',
    'ARCHIVE_REVIEW_SWEEP_INPUT_INVALID',
    'ARCHIVE_REVIEW_SWEEP_SCOPE_CHANGED',
    'ARCHIVE_REVIEW_SWEEP_SCOPE_INVALID',
  ])
  return codes.has(error?.code) ? error.code : 'ARCHIVE_REVIEW_SWEEP_FAILED'
}

/** Runs the worker with only closed progress, result, and failure envelopes. */
function runArchiveReviewSweepWorker() {
  let operationId = null
  try {
    const ticket = normalizeTicket(workerData?.ticket)
    operationId = ticket.operationId
    if (!(workerData?.cancellationBuffer instanceof SharedArrayBuffer)
      || workerData.cancellationBuffer.byteLength !== Int32Array.BYTES_PER_ELEMENT) {
      throw new ArchiveReviewSweepError(
        'ARCHIVE_REVIEW_SWEEP_INPUT_INVALID',
        'Archive review plaintext sweep cancellation input is invalid.',
      )
    }
    const cancellationFlag = new Int32Array(workerData.cancellationBuffer)
    parentPort.on('message', (message) => {
      if (message?.type === 'cancel' && message.operationId === operationId) {
        Atomics.store(cancellationFlag, 0, 1)
      }
    })
    let sequence = 0
    const result = sweepArchiveReviewQuarantine({
      ticket,
      cancellationFlag,
      onProgress: (removedEntryCount) => {
        sequence += 1
        parentPort.postMessage({
          type: 'progress',
          operationId,
          sequence,
          removedEntryCount,
        })
      },
    })
    parentPort.postMessage({ type: 'complete', operationId, ...result })
  } catch (error) {
    parentPort.postMessage({
      type: 'error',
      operationId,
      code: mapFailureCode(error),
    })
  } finally {
    parentPort.close()
  }
}

if (!isMainThread) runArchiveReviewSweepWorker()

module.exports = {
  ArchiveReviewSweepError,
  mapFailureCode,
  normalizeTicket,
  sweepArchiveReviewQuarantine,
}
