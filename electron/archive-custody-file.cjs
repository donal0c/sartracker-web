'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')

const READ_CHUNK_BYTES = 1024 * 1024
const IDENTITY_KEYS = Object.freeze([
  'changedTimeNanoseconds',
  'device',
  'inode',
  'linkCount',
  'modifiedTimeNanoseconds',
  'sizeBytes',
])

/** Signals an unsafe, changed, or unavailable archive custody file. */
class ArchiveCustodyFileError extends Error {
  /** Creates one stable custody-file failure without reflecting local paths. */
  constructor(code, message) {
    super(message)
    this.name = 'ArchiveCustodyFileError'
    this.code = code
  }
}

/** Requires one canonical relative path inside the configured custody root. */
function normalizeRelativePath(value) {
  if (typeof value !== 'string' || value.length < 1
    || Buffer.byteLength(value, 'utf8') > 4_096
    || /[\u0000-\u001f\u007f]/u.test(value)
    || path.isAbsolute(value) || value.includes('\\')
    || value.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new ArchiveCustodyFileError(
      'ARCHIVE_CUSTODY_INVALID_PATH',
      'Archive custody path must remain inside the configured archive directory.',
    )
  }
  return value
}

/** Requires one canonical absolute archive directory. */
function normalizeArchiveDirectory(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || path.resolve(value) !== value
    || Buffer.byteLength(value, 'utf8') > 8_192 || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new ArchiveCustodyFileError(
      'ARCHIVE_CUSTODY_INVALID_PATH',
      'Archive custody directory must be one canonical absolute path.',
    )
  }
  return value
}

/** Projects a bigint stat into the closed identity retained by a verifier proof. */
function projectFileIdentity(stat) {
  const sizeBytes = Number(stat.size)
  const linkCount = Number(stat.nlink)
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 1
    || !Number.isSafeInteger(linkCount) || linkCount !== 1) {
    throw new ArchiveCustodyFileError(
      'ARCHIVE_CUSTODY_NOT_REGULAR',
      'Archive custody requires one positive-size regular file with no hard links.',
    )
  }
  return Object.freeze({
    changedTimeNanoseconds: stat.ctimeNs.toString(),
    device: stat.dev.toString(),
    inode: stat.ino.toString(),
    linkCount,
    modifiedTimeNanoseconds: stat.mtimeNs.toString(),
    sizeBytes,
  })
}

/** Validates a closed identity received from a worker proof. */
function normalizeCustodyFileIdentity(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ArchiveCustodyFileError(
      'ARCHIVE_CUSTODY_IDENTITY_INVALID',
      'Archive custody file identity is invalid.',
    )
  }
  const actual = Object.keys(value).sort()
  if (actual.length !== IDENTITY_KEYS.length
    || actual.some((key, index) => key !== IDENTITY_KEYS[index])) {
    throw new ArchiveCustodyFileError(
      'ARCHIVE_CUSTODY_IDENTITY_INVALID',
      'Archive custody file identity has missing or unsupported fields.',
    )
  }
  for (const key of [
    'changedTimeNanoseconds',
    'device',
    'inode',
    'modifiedTimeNanoseconds',
  ]) {
    if (typeof value[key] !== 'string' || !/^\d+$/u.test(value[key])) {
      throw new ArchiveCustodyFileError(
        'ARCHIVE_CUSTODY_IDENTITY_INVALID',
        'Archive custody file identity contains an invalid filesystem counter.',
      )
    }
  }
  if (!Number.isSafeInteger(value.sizeBytes) || value.sizeBytes < 1
    || value.linkCount !== 1) {
    throw new ArchiveCustodyFileError(
      'ARCHIVE_CUSTODY_IDENTITY_INVALID',
      'Archive custody file identity contains an invalid size or link count.',
    )
  }
  return Object.freeze({
    changedTimeNanoseconds: value.changedTimeNanoseconds,
    device: value.device,
    inode: value.inode,
    linkCount: 1,
    modifiedTimeNanoseconds: value.modifiedTimeNanoseconds,
    sizeBytes: value.sizeBytes,
  })
}

/** Returns whether two closed filesystem identities denote one unchanged file. */
function sameFileIdentity(left, right) {
  return IDENTITY_KEYS.every((key) => left[key] === right[key])
}

/** Validates the custody root and every relative ancestor without following links. */
function resolveCustodyPath(archiveDirectoryInput, archiveRelativePathInput) {
  const archiveDirectory = normalizeArchiveDirectory(archiveDirectoryInput)
  const archiveRelativePath = normalizeRelativePath(archiveRelativePathInput)
  let root
  try {
    root = fs.lstatSync(archiveDirectory, { bigint: true })
  } catch {
    throw new ArchiveCustodyFileError(
      'ARCHIVE_CUSTODY_UNAVAILABLE',
      'Archive custody directory is unavailable.',
    )
  }
  if (!root.isDirectory() || root.isSymbolicLink()) {
    throw new ArchiveCustodyFileError(
      'ARCHIVE_CUSTODY_INVALID_PATH',
      'Archive custody directory is not a safe directory.',
    )
  }
  const segments = archiveRelativePath.split('/')
  let parent = archiveDirectory
  for (const segment of segments.slice(0, -1)) {
    parent = path.join(parent, segment)
    let parentStat
    try {
      parentStat = fs.lstatSync(parent, { bigint: true })
    } catch {
      throw new ArchiveCustodyFileError(
        'ARCHIVE_CUSTODY_UNAVAILABLE',
        'Archive custody ancestor is unavailable.',
      )
    }
    if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) {
      throw new ArchiveCustodyFileError(
        'ARCHIVE_CUSTODY_INVALID_PATH',
        'Archive custody ancestor is not a safe directory.',
      )
    }
  }
  return {
    archiveDirectory,
    archiveRelativePath,
    archivePath: path.join(archiveDirectory, ...segments),
  }
}

/** Opens and pins a regular single-link custody file without following its final component. */
function openPinnedCustodyFile(input) {
  const resolved = resolveCustodyPath(input.archiveDirectory, input.archiveRelativePath)
  let pathStat
  try {
    pathStat = fs.lstatSync(resolved.archivePath, { bigint: true })
  } catch (error) {
    throw new ArchiveCustodyFileError(
      error?.code === 'ENOENT' ? 'ARCHIVE_CUSTODY_MISSING' : 'ARCHIVE_CUSTODY_UNAVAILABLE',
      'Archive custody file is unavailable.',
    )
  }
  if (!pathStat.isFile() || pathStat.isSymbolicLink() || pathStat.nlink !== 1n) {
    throw new ArchiveCustodyFileError(
      'ARCHIVE_CUSTODY_NOT_REGULAR',
      'Archive custody path is not one regular single-link file.',
    )
  }
  let descriptor
  try {
    descriptor = fs.openSync(
      resolved.archivePath,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0),
    )
    const openedStat = fs.fstatSync(descriptor, { bigint: true })
    const pathIdentity = projectFileIdentity(pathStat)
    const openedIdentity = projectFileIdentity(openedStat)
    if (!openedStat.isFile() || !sameFileIdentity(pathIdentity, openedIdentity)) {
      throw new ArchiveCustodyFileError(
        'ARCHIVE_CUSTODY_IDENTITY_CHANGED',
        'Archive custody file changed while it was opened.',
      )
    }
    return Object.freeze({
      ...resolved,
      descriptor,
      fileIdentity: openedIdentity,
      sizeBytes: openedIdentity.sizeBytes,
    })
  } catch (error) {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor) } catch {}
    }
    if (error instanceof ArchiveCustodyFileError) throw error
    throw new ArchiveCustodyFileError(
      'ARCHIVE_CUSTODY_UNAVAILABLE',
      'Archive custody file could not be opened safely.',
    )
  }
}

/** Requires an opened descriptor and its final path to retain their pinned identity. */
function assertPinnedCustodyFileUnchanged(pinned) {
  let openedStat
  let pathStat
  let openedIdentity
  let pathIdentity
  try {
    openedStat = fs.fstatSync(pinned.descriptor, { bigint: true })
    pathStat = fs.lstatSync(pinned.archivePath, { bigint: true })
    openedIdentity = projectFileIdentity(openedStat)
    pathIdentity = projectFileIdentity(pathStat)
  } catch {
    throw new ArchiveCustodyFileError(
      'ARCHIVE_CUSTODY_IDENTITY_CHANGED',
      'Archive custody file became unavailable during its identity check.',
    )
  }
  if (!openedStat.isFile() || !pathStat.isFile() || pathStat.isSymbolicLink()
    || !sameFileIdentity(pinned.fileIdentity, openedIdentity)
    || !sameFileIdentity(pinned.fileIdentity, pathIdentity)) {
    throw new ArchiveCustodyFileError(
      'ARCHIVE_CUSTODY_IDENTITY_CHANGED',
      'Archive custody file changed during its identity check.',
    )
  }
}

/** Hashes every byte of one pinned file with bounded cancellation/progress checkpoints. */
function digestPinnedCustodyFile(pinned, input = {}) {
  const cancellationFlag = input.cancellationFlag
  if (cancellationFlag !== undefined
    && (!(cancellationFlag instanceof Int32Array) || cancellationFlag.length !== 1)) {
    throw new ArchiveCustodyFileError(
      'ARCHIVE_CUSTODY_INVALID_INPUT',
      'Archive custody cancellation state is invalid.',
    )
  }
  const digest = createHash('sha256')
  const chunk = Buffer.allocUnsafe(READ_CHUNK_BYTES)
  let completed = 0
  try {
    while (completed < pinned.sizeBytes) {
      if (cancellationFlag !== undefined && Atomics.load(cancellationFlag, 0) !== 0) {
        throw new ArchiveCustodyFileError(
          'ARCHIVE_CUSTODY_CANCELLED',
          'Archive custody inspection was cancelled.',
        )
      }
      const length = Math.min(chunk.length, pinned.sizeBytes - completed)
      const bytesRead = fs.readSync(pinned.descriptor, chunk, 0, length, completed)
      if (bytesRead < 1) {
        throw new ArchiveCustodyFileError(
          'ARCHIVE_CUSTODY_IDENTITY_CHANGED',
          'Archive custody file ended during its identity check.',
        )
      }
      digest.update(chunk.subarray(0, bytesRead))
      completed += bytesRead
      input.onChunk?.(completed, pinned.sizeBytes)
    }
    const extra = fs.readSync(pinned.descriptor, chunk, 0, 1, completed)
    if (extra !== 0) {
      throw new ArchiveCustodyFileError(
        'ARCHIVE_CUSTODY_IDENTITY_CHANGED',
        'Archive custody file grew during its identity check.',
      )
    }
    assertPinnedCustodyFileUnchanged(pinned)
    return digest.digest('hex')
  } finally {
    chunk.fill(0)
  }
}

/** Performs one complete pinned full-file custody inspection. */
function inspectArchiveCustodyFile(input) {
  const pinned = openPinnedCustodyFile(input)
  try {
    const ciphertextSha256 = digestPinnedCustodyFile(pinned, input)
    return Object.freeze({
      sizeBytes: pinned.sizeBytes,
      ciphertextSha256,
      fileIdentity: pinned.fileIdentity,
    })
  } finally {
    fs.closeSync(pinned.descriptor)
  }
}

/** Reads one pinned filesystem identity without hashing archive contents. */
function readArchiveCustodyFileIdentity(input) {
  const pinned = openPinnedCustodyFile(input)
  try {
    assertPinnedCustodyFileUnchanged(pinned)
    return pinned.fileIdentity
  } finally {
    fs.closeSync(pinned.descriptor)
  }
}

/** Holds one matching descriptor across a caller-owned transactional commit callback. */
function withPinnedCustodyFileIdentity(input, callback) {
  if (typeof callback !== 'function') {
    throw new ArchiveCustodyFileError(
      'ARCHIVE_CUSTODY_INVALID_INPUT',
      'Archive custody commit callback is invalid.',
    )
  }
  const expected = normalizeCustodyFileIdentity(input.expectedFileIdentity)
  const pinned = openPinnedCustodyFile(input)
  try {
    if (!sameFileIdentity(expected, pinned.fileIdentity)) {
      throw new ArchiveCustodyFileError(
        'ARCHIVE_CUSTODY_IDENTITY_CHANGED',
        'Archive custody file differs from the independently verified identity.',
      )
    }
    const result = callback(() => assertPinnedCustodyFileUnchanged(pinned))
    assertPinnedCustodyFileUnchanged(pinned)
    return result
  } finally {
    fs.closeSync(pinned.descriptor)
  }
}

module.exports = {
  ArchiveCustodyFileError,
  assertPinnedCustodyFileUnchanged,
  digestPinnedCustodyFile,
  inspectArchiveCustodyFile,
  normalizeCustodyFileIdentity,
  openPinnedCustodyFile,
  readArchiveCustodyFileIdentity,
  withPinnedCustodyFileIdentity,
}
