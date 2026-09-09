'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { isMainThread, parentPort, workerData } = require('node:worker_threads')

const VERIFICATION_DIRECTORY_NAME = '.verification'

/** Closed failure used by the app-owned plaintext sweep boundary. */
class ArchivePlaintextSweepError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'ArchivePlaintextSweepError'
    this.code = code
  }
}

/** Requires the exact resolved absolute archive directory accepted by the runner. */
function normalizeArchiveDirectory(value) {
  if (typeof value !== 'string'
    || value.length < 1
    || value.length > 4_096
    || value.includes('\0')
    || !path.isAbsolute(value)
    || path.resolve(value) !== value) {
    throw new ArchivePlaintextSweepError(
      'ARCHIVE_PLAINTEXT_SWEEP_SCOPE_INVALID',
      'Archive plaintext sweep archive directory is invalid.',
    )
  }
  return value
}

/** Throws before any additional filesystem operation after cancellation. */
function assertNotCancelled(cancellationFlag) {
  if (Atomics.load(cancellationFlag, 0) !== 0) {
    throw new ArchivePlaintextSweepError(
      'ARCHIVE_CANCELLED',
      'Archive plaintext sweep was cancelled.',
    )
  }
}

/** Opens one directory without following a final-component symlink. */
function openOwnedDirectory(directoryPath) {
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
      || opened.ino !== named.ino) {
      fs.closeSync(descriptor)
      throw new ArchivePlaintextSweepError(
        'ARCHIVE_PLAINTEXT_SWEEP_SCOPE_INVALID',
        'Archive plaintext sweep directory is unsafe.',
      )
    }
    return { descriptor, identity: Object.freeze({ dev: opened.dev, ino: opened.ino }) }
  } catch (error) {
    if (error instanceof ArchivePlaintextSweepError) throw error
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor) } catch {}
    }
    throw new ArchivePlaintextSweepError(
      'ARCHIVE_PLAINTEXT_SWEEP_SCOPE_INVALID',
      'Archive plaintext sweep directory is unsafe.',
    )
  }
}

/** Confirms a still-named directory is the exact inode opened before traversal. */
function assertNamedDirectoryIdentity(directoryPath, identity) {
  let observed
  try {
    observed = fs.lstatSync(directoryPath)
  } catch {
    throw new ArchivePlaintextSweepError(
      'ARCHIVE_PLAINTEXT_SWEEP_SCOPE_CHANGED',
      'Archive plaintext sweep directory changed during cleanup.',
    )
  }
  if (!observed.isDirectory()
    || observed.isSymbolicLink()
    || observed.dev !== identity.dev
    || observed.ino !== identity.ino) {
    throw new ArchivePlaintextSweepError(
      'ARCHIVE_PLAINTEXT_SWEEP_SCOPE_CHANGED',
      'Archive plaintext sweep directory changed during cleanup.',
    )
  }
}

/** Removes one nested tree using lstat so symbolic links are unlinked, never traversed. */
function removeDirectoryContents(directoryPath, cancellationFlag, reportRemoval) {
  assertNotCancelled(cancellationFlag)
  let names
  try {
    names = fs.readdirSync(directoryPath).sort()
  } catch {
    throw new ArchivePlaintextSweepError(
      'ARCHIVE_PLAINTEXT_SWEEP_FAILED',
      'Archive plaintext sweep failed safely.',
    )
  }
  for (const name of names) {
    assertNotCancelled(cancellationFlag)
    const entryPath = path.join(directoryPath, name)
    let entry
    try {
      entry = fs.lstatSync(entryPath)
    } catch (error) {
      if (error?.code === 'ENOENT') continue
      throw new ArchivePlaintextSweepError(
        'ARCHIVE_PLAINTEXT_SWEEP_FAILED',
        'Archive plaintext sweep failed safely.',
      )
    }
    try {
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        const opened = openOwnedDirectory(entryPath)
        try {
          removeDirectoryContents(entryPath, cancellationFlag, reportRemoval)
          assertNotCancelled(cancellationFlag)
          assertNamedDirectoryIdentity(entryPath, opened.identity)
          fs.rmdirSync(entryPath)
        } finally {
          fs.closeSync(opened.descriptor)
        }
      } else {
        fs.unlinkSync(entryPath)
      }
    } catch (error) {
      if (error instanceof ArchivePlaintextSweepError) throw error
      throw new ArchivePlaintextSweepError(
        'ARCHIVE_PLAINTEXT_SWEEP_FAILED',
        'Archive plaintext sweep failed safely.',
      )
    }
    reportRemoval()
  }
}

/**
 * Sweeps only the app-owned fixed verification tree and durably records its removal.
 */
function sweepArchivePlaintext(input) {
  const archiveDirectory = normalizeArchiveDirectory(input?.archiveDirectory)
  if (!(input?.cancellationFlag instanceof Int32Array)
    || input.cancellationFlag.length !== 1
    || typeof input?.onProgress !== 'function') {
    throw new ArchivePlaintextSweepError(
      'ARCHIVE_PLAINTEXT_SWEEP_INPUT_INVALID',
      'Archive plaintext sweep input is invalid.',
    )
  }
  const cancellationFlag = input.cancellationFlag
  assertNotCancelled(cancellationFlag)
  const archive = openOwnedDirectory(archiveDirectory)
  const verificationRoot = path.join(archiveDirectory, VERIFICATION_DIRECTORY_NAME)
  let root
  let removedEntryCount = 0
  try {
    let rootStat
    try {
      rootStat = fs.lstatSync(verificationRoot)
    } catch (error) {
      if (error?.code === 'ENOENT') {
        return Object.freeze({ status: 'clean', removedEntryCount: 0 })
      }
      throw new ArchivePlaintextSweepError(
        'ARCHIVE_PLAINTEXT_SWEEP_FAILED',
        'Archive plaintext sweep failed safely.',
      )
    }
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
      throw new ArchivePlaintextSweepError(
        'ARCHIVE_PLAINTEXT_SWEEP_ROOT_UNSAFE',
        'Archive plaintext sweep failed safely.',
      )
    }
    root = openOwnedDirectory(verificationRoot)
    fs.fchmodSync(root.descriptor, 0o700)

    const reportRemoval = () => {
      removedEntryCount += 1
      input.onProgress(removedEntryCount)
    }
    removeDirectoryContents(verificationRoot, cancellationFlag, reportRemoval)
    assertNotCancelled(cancellationFlag)
    assertNamedDirectoryIdentity(verificationRoot, root.identity)
    fs.rmdirSync(verificationRoot)
    reportRemoval()
    fs.fsyncSync(archive.descriptor)
    return Object.freeze({ status: 'clean', removedEntryCount })
  } finally {
    if (root !== undefined) fs.closeSync(root.descriptor)
    fs.closeSync(archive.descriptor)
  }
}

/** Maps internal errors to a small non-reflective worker vocabulary. */
function mapFailureCode(error) {
  if (error?.code === 'ARCHIVE_CANCELLED') return 'ARCHIVE_CANCELLED'
  if (error?.code === 'ARCHIVE_PLAINTEXT_SWEEP_ROOT_UNSAFE') {
    return 'ARCHIVE_PLAINTEXT_SWEEP_ROOT_UNSAFE'
  }
  if (error?.code === 'ARCHIVE_PLAINTEXT_SWEEP_SCOPE_INVALID'
    || error?.code === 'ARCHIVE_PLAINTEXT_SWEEP_SCOPE_CHANGED') {
    return 'ARCHIVE_PLAINTEXT_SWEEP_SCOPE_INVALID'
  }
  return 'ARCHIVE_PLAINTEXT_SWEEP_FAILED'
}

/** Runs the worker with only closed progress, result and failure envelopes. */
function runArchivePlaintextSweepWorker() {
  let cancellationFlag
  try {
    if (!(workerData?.cancellationBuffer instanceof SharedArrayBuffer)
      || workerData.cancellationBuffer.byteLength !== Int32Array.BYTES_PER_ELEMENT) {
      throw new ArchivePlaintextSweepError(
        'ARCHIVE_PLAINTEXT_SWEEP_INPUT_INVALID',
        'Archive plaintext sweep input is invalid.',
      )
    }
    cancellationFlag = new Int32Array(workerData.cancellationBuffer)
    parentPort.on('message', (message) => {
      if (message?.type === 'cancel') Atomics.store(cancellationFlag, 0, 1)
    })
    let sequence = 0
    const result = sweepArchivePlaintext({
      archiveDirectory: workerData.archiveDirectory,
      cancellationFlag,
      onProgress: (removedEntryCount) => {
        sequence += 1
        parentPort.postMessage({
          type: 'progress',
          sequence,
          removedEntryCount,
        })
      },
    })
    parentPort.postMessage({ type: 'complete', ...result })
  } catch (error) {
    parentPort.postMessage({ type: 'error', code: mapFailureCode(error) })
  } finally {
    parentPort.close()
  }
}

if (!isMainThread) runArchivePlaintextSweepWorker()

module.exports = {
  ArchivePlaintextSweepError,
  mapFailureCode,
  sweepArchivePlaintext,
}
