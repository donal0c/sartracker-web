const fs = require('node:fs')
const { createHash } = require('node:crypto')
const {
  access,
  chmod,
  lstat,
  mkdir,
  open,
  readdir,
  statfs,
} = require('node:fs/promises')
const path = require('node:path')
const { Readable, Transform } = require('node:stream')
const { pipeline } = require('node:stream/promises')
const zlib = require('node:zlib')

const Database = require('better-sqlite3')
const {
  readArchiveAttachmentReferenceLedger,
} = require('./archive-attachments.cjs')
const {
  migrateMissionStoreForArchiveReview,
} = require('./mission-store.cjs')

const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50
const ZIP64_END_LOCATOR_SIGNATURE = 0x07064b50
const COMPRESSION_STORE = 0
const COMPRESSION_DEFLATE = 8
const GENERAL_PURPOSE_ENCRYPTED = 0x0001
const GENERAL_PURPOSE_DATA_DESCRIPTOR = 0x0008
const GENERAL_PURPOSE_UTF8 = 0x0800
const ZIP64_UINT16_SENTINEL = 0xffff
const ZIP64_UINT32_SENTINEL = 0xffffffff
const SUPPORTED_LEGACY_CONTAINER_VERSION = 1
const CURRENT_SUPPORTED_SCHEMA_VERSION = 13
const ZIP_EOCD_FIXED_BYTES = 22
const ZIP_MAX_COMMENT_BYTES = 0xffff
const ZIP_LOCAL_HEADER_BYTES = 30
const ZIP_CENTRAL_HEADER_BYTES = 46
const READ_CHUNK_BYTES = 64 * 1024
const PROGRESS_EMIT_BYTES = 1024 * 1024
const MAX_ENTRY_COUNT = 10_000
const MAX_ENTRY_NAME_BYTES = 1_024
const MAX_CENTRAL_DIRECTORY_BYTES = 32 * 1024 * 1024
const MAX_METADATA_ENTRY_BYTES = 1024 * 1024
const MAX_TOTAL_UNCOMPRESSED_BYTES = 8 * 1024 * 1024 * 1024
const RESTORE_HEADROOM_NUMERATOR = 6
const RESTORE_HEADROOM_DENOMINATOR = 5
const REQUIRED_ENTRY_NAMES = Object.freeze([
  'manifest.json',
  'mission.json',
  'mission-store.sqlite',
])
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true })
const CRC_TABLE = buildCrcTable()

/** Stable, non-path-bearing failure for a rejected legacy archive. */
class LegacyArchiveRestoreError extends Error {
  /**
   * @param {string} code Stable archive-review error code.
   * @param {string} message Operator-safe failure detail.
   * @param {unknown} [cause] Original internal failure.
   */
  constructor(code, message, cause) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'LegacyArchiveRestoreError'
    this.code = code
  }
}

/** Builds the lookup table for incremental PKZIP CRC-32 checks. */
function buildCrcTable() {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[index] = value >>> 0
  }
  return table
}

/** Advances an in-progress PKZIP CRC-32 value without retaining the input chunk. */
function updateCrc32(current, chunk) {
  let crc = current
  for (let index = 0; index < chunk.length; index += 1) {
    crc = CRC_TABLE[(crc ^ chunk[index]) & 0xff] ^ (crc >>> 8)
  }
  return crc >>> 0
}

/** Throws a stable legacy-archive error. */
function rejectArchive(code, message, cause) {
  throw new LegacyArchiveRestoreError(code, message, cause)
}

/** Returns true when a filesystem failure, or one of its wrapped causes, is ENOSPC. */
function isDiskFullError(error, visited = new Set()) {
  if (error === null || typeof error !== 'object' || visited.has(error)) return false
  visited.add(error)
  if (error.code === 'ENOSPC') return true
  if (isDiskFullError(error.cause, visited)) return true
  if (!Array.isArray(error.errors)) return false
  return error.errors.some((nestedError) => isDiskFullError(nestedError, visited))
}

/** Reads available bytes from the filesystem that owns the claimed scratch directory. */
async function getDefaultAvailableDiskBytes(sessionDirectory) {
  const capacity = await statfs(sessionDirectory, { bigint: true })
  return capacity.bavail * capacity.bsize
}

/** Fails before the first plaintext output when declared expansion lacks 20% headroom. */
async function assertRestoreCapacity(entries, sessionDirectory, getAvailableDiskBytes) {
  const declaredBytes = entries.reduce(
    (total, entry) => total + entry.uncompressedSize,
    0,
  )
  const requiredBytes = BigInt(Math.ceil(
    (declaredBytes * RESTORE_HEADROOM_NUMERATOR) / RESTORE_HEADROOM_DENOMINATOR,
  ))
  let availableBytes
  try {
    availableBytes = await getAvailableDiskBytes(sessionDirectory)
  } catch (error) {
    rejectArchive(
      'LEGACY_ARCHIVE_DISK_PREFLIGHT_FAILED',
      'Legacy archive restore could not confirm free disk space safely.',
      error,
    )
  }
  if ((typeof availableBytes !== 'number' && typeof availableBytes !== 'bigint')
    || (typeof availableBytes === 'number'
      && (!Number.isSafeInteger(availableBytes) || availableBytes < 0))
    || (typeof availableBytes === 'bigint' && availableBytes < 0n)) {
    rejectArchive(
      'LEGACY_ARCHIVE_DISK_PREFLIGHT_FAILED',
      'Legacy archive restore could not confirm free disk space safely.',
    )
  }
  if (BigInt(availableBytes) < requiredBytes) {
    rejectArchive(
      'LEGACY_ARCHIVE_DISK_FULL',
      'Legacy archive restore requires more free disk space.',
    )
  }
}

/** Validates the three fixed caller inputs without exposing either path in errors. */
function validateRestoreInput(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    rejectArchive('LEGACY_ARCHIVE_INVALID_REQUEST', 'Legacy archive restore request is invalid.')
  }
  if (typeof input.archivePath !== 'string' || !path.isAbsolute(input.archivePath)) {
    rejectArchive('LEGACY_ARCHIVE_INVALID_REQUEST', 'Legacy archive custody path must be absolute.')
  }
  if (typeof input.sessionDirectory !== 'string' || !path.isAbsolute(input.sessionDirectory)) {
    rejectArchive('LEGACY_ARCHIVE_INVALID_REQUEST', 'Legacy review session path must be absolute.')
  }
  if (typeof input.expectedMissionId !== 'string'
    || input.expectedMissionId.length < 1
    || input.expectedMissionId.length > 256) {
    rejectArchive('LEGACY_ARCHIVE_INVALID_REQUEST', 'Legacy archive mission identity is invalid.')
  }
  if (input.onProgress !== undefined && typeof input.onProgress !== 'function') {
    rejectArchive('LEGACY_ARCHIVE_INVALID_REQUEST', 'Legacy archive progress observer is invalid.')
  }
  if (input.cancellationFlag !== undefined
    && (!(input.cancellationFlag instanceof Int32Array)
      || input.cancellationFlag.length !== 1
      || !(input.cancellationFlag.buffer instanceof SharedArrayBuffer))) {
    rejectArchive('LEGACY_ARCHIVE_INVALID_REQUEST', 'Legacy archive cancellation state is invalid.')
  }
  const archivePath = path.resolve(input.archivePath)
  const sessionDirectory = path.resolve(input.sessionDirectory)
  const filesystemRoot = path.parse(sessionDirectory).root
  if (sessionDirectory === filesystemRoot
    || sessionDirectory === path.dirname(sessionDirectory)
    || sessionDirectory === archivePath) {
    rejectArchive('LEGACY_ARCHIVE_INVALID_REQUEST', 'Legacy review session path is unsafe.')
  }
  return {
    archivePath,
    cancellationFlag: input.cancellationFlag,
    expectedMissionId: input.expectedMissionId,
    onProgress: input.onProgress,
    sessionDirectory,
  }
}

/** Stops promptly when the owning restore worker has been cancelled. */
function assertRestoreActive(request) {
  if (request.cancellationFlag === undefined
    || Atomics.load(request.cancellationFlag, 0) === 0) return
  rejectArchive('ARCHIVE_CANCELLED', 'Legacy archive review restore was cancelled.')
}

/** Emits one closed, path-free progress record from the restore worker. */
function emitRestoreProgress(request, progress) {
  assertRestoreActive(request)
  request.onProgress?.(Object.freeze(progress))
}

/** Coalesces large streamed-file progress without leaving a 60-second silent interval. */
function createByteProgressReporter(request, phase, detail, total = null) {
  let completed = 0
  let emitted = 0
  return Object.freeze({
    advance(byteCount) {
      assertRestoreActive(request)
      completed += byteCount
      if (completed - emitted < PROGRESS_EMIT_BYTES) return
      emitted = completed
      emitRestoreProgress(request, {
        phase,
        unit: 'bytes',
        completed,
        total,
        detail,
      })
    },
    flush(nextDetail = detail) {
      if (completed === emitted && emitted !== 0) return
      emitted = completed
      emitRestoreProgress(request, {
        phase,
        unit: 'bytes',
        completed,
        total,
        detail: nextDetail,
      })
    },
  })
}

/**
 * Creates or claims an empty, non-symlink review directory and applies mode 0700.
 * The boolean records whether cleanup may safely remove the directory itself.
 */
async function prepareSessionDirectory(sessionDirectory) {
  try {
    await mkdir(sessionDirectory, { mode: 0o700 })
    await chmod(sessionDirectory, 0o700)
    return { created: true }
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error
  }

  const sessionStat = await lstat(sessionDirectory)
  if (!sessionStat.isDirectory() || sessionStat.isSymbolicLink()) {
    rejectArchive(
      'LEGACY_ARCHIVE_INVALID_SESSION',
      'Legacy review session must be a real directory.',
    )
  }
  if ((await readdir(sessionDirectory)).length !== 0) {
    rejectArchive(
      'LEGACY_ARCHIVE_INVALID_SESSION',
      'Legacy review session directory must be empty.',
    )
  }
  await chmod(sessionDirectory, 0o700)
  return { created: false }
}

/** Reads an exact bounded range from the already-open archive descriptor. */
async function readExactly(fileHandle, position, length, label) {
  if (!Number.isSafeInteger(position) || position < 0
    || !Number.isSafeInteger(length) || length < 0) {
    rejectArchive('LEGACY_ARCHIVE_INVALID', `Legacy ZIP ${label} bounds are invalid.`)
  }
  const buffer = Buffer.alloc(length)
  let readOffset = 0
  while (readOffset < length) {
    const result = await fileHandle.read(buffer, readOffset, length - readOffset, position + readOffset)
    if (result.bytesRead === 0) {
      rejectArchive('LEGACY_ARCHIVE_TRUNCATED', `Legacy ZIP ${label} is truncated.`)
    }
    readOffset += result.bytesRead
  }
  return buffer
}

/** Locates the unique EOCD record whose declared comment ends at the physical EOF. */
async function readEndOfCentralDirectory(fileHandle, archiveSize) {
  if (!Number.isSafeInteger(archiveSize) || archiveSize < ZIP_EOCD_FIXED_BYTES) {
    rejectArchive('LEGACY_ARCHIVE_TRUNCATED', 'Legacy ZIP is truncated before its end record.')
  }
  const tailLength = Math.min(archiveSize, ZIP_EOCD_FIXED_BYTES + ZIP_MAX_COMMENT_BYTES)
  const tailOffset = archiveSize - tailLength
  const tail = await readExactly(fileHandle, tailOffset, tailLength, 'end record')
  let eocdOffset = -1
  for (let offset = tail.length - ZIP_EOCD_FIXED_BYTES; offset >= 0; offset -= 1) {
    if (tail.readUInt32LE(offset) !== END_OF_CENTRAL_DIRECTORY_SIGNATURE) continue
    const commentLength = tail.readUInt16LE(offset + 20)
    if (tailOffset + offset + ZIP_EOCD_FIXED_BYTES + commentLength === archiveSize) {
      eocdOffset = tailOffset + offset
      break
    }
  }
  if (eocdOffset < 0) {
    rejectArchive(
      'LEGACY_ARCHIVE_INVALID_EOF',
      'Legacy ZIP has no exact end record or contains trailing bytes.',
    )
  }
  const relativeOffset = eocdOffset - tailOffset
  const record = tail.subarray(relativeOffset, relativeOffset + ZIP_EOCD_FIXED_BYTES)
  const commentLength = record.readUInt16LE(20)
  if (commentLength !== 0) {
    rejectArchive(
      'LEGACY_ARCHIVE_UNSUPPORTED',
      'Legacy ZIP archive comments are unsupported.',
    )
  }
  if (eocdOffset >= 20) {
    const possibleZip64Locator = await readExactly(
      fileHandle,
      eocdOffset - 20,
      4,
      'ZIP64 locator probe',
    )
    if (possibleZip64Locator.readUInt32LE(0) === ZIP64_END_LOCATOR_SIGNATURE) {
      rejectArchive('LEGACY_ARCHIVE_UNSUPPORTED_ZIP64', 'ZIP64 legacy archives are unsupported.')
    }
  }

  const diskNumber = record.readUInt16LE(4)
  const centralDirectoryDisk = record.readUInt16LE(6)
  const diskEntryCount = record.readUInt16LE(8)
  const entryCount = record.readUInt16LE(10)
  const centralDirectorySize = record.readUInt32LE(12)
  const centralDirectoryOffset = record.readUInt32LE(16)
  if (diskNumber !== 0 || centralDirectoryDisk !== 0 || diskEntryCount !== entryCount) {
    rejectArchive(
      'LEGACY_ARCHIVE_UNSUPPORTED_MULTIDISK',
      'Multi-disk legacy ZIP archives are unsupported.',
    )
  }
  if (entryCount === ZIP64_UINT16_SENTINEL
    || centralDirectorySize === ZIP64_UINT32_SENTINEL
    || centralDirectoryOffset === ZIP64_UINT32_SENTINEL) {
    rejectArchive('LEGACY_ARCHIVE_UNSUPPORTED_ZIP64', 'ZIP64 legacy archives are unsupported.')
  }
  if (entryCount < REQUIRED_ENTRY_NAMES.length || entryCount > MAX_ENTRY_COUNT) {
    rejectArchive('LEGACY_ARCHIVE_LIMIT_EXCEEDED', 'Legacy ZIP entry count is outside safe limits.')
  }
  if (centralDirectorySize > MAX_CENTRAL_DIRECTORY_BYTES) {
    rejectArchive(
      'LEGACY_ARCHIVE_LIMIT_EXCEEDED',
      'Legacy ZIP central directory exceeds its safe limit.',
    )
  }
  if (centralDirectoryOffset + centralDirectorySize !== eocdOffset) {
    rejectArchive(
      'LEGACY_ARCHIVE_INVALID_CENTRAL_DIRECTORY',
      'Legacy ZIP central directory does not end at the exact end record.',
    )
  }
  return {
    centralDirectoryOffset,
    centralDirectorySize,
    entryCount,
    eocdOffset,
  }
}

/** Decodes a ZIP entry name as strict UTF-8. */
function decodeEntryName(nameBytes) {
  try {
    return UTF8_DECODER.decode(nameBytes)
  } catch (error) {
    rejectArchive(
      'LEGACY_ARCHIVE_INVALID_ENTRY_PATH',
      'Legacy ZIP entry name is not valid UTF-8.',
      error,
    )
  }
}

/** Restricts output paths to the three fixed files and one-level attachments. */
function validateEntryName(name, nameBytes) {
  if (nameBytes.length < 1 || nameBytes.length > MAX_ENTRY_NAME_BYTES
    || Buffer.byteLength(name, 'utf8') !== nameBytes.length
    || name !== name.normalize('NFC')
    || name.includes('\\')
    || name.includes('\0')
    || /[\u0000-\u001f\u007f]/u.test(name)
    || path.posix.isAbsolute(name)
    || path.posix.normalize(name) !== name
    || /^[A-Za-z]:/u.test(name)) {
    rejectArchive(
      'LEGACY_ARCHIVE_INVALID_ENTRY_PATH',
      'Legacy ZIP entry path is not canonical.',
    )
  }
  const isRequired = REQUIRED_ENTRY_NAMES.includes(name)
  const isAttachment = name.startsWith('attachments/')
    && name.length > 'attachments/'.length
    && !name.slice('attachments/'.length).includes('/')
  if (!isRequired && !isAttachment) {
    rejectArchive(
      'LEGACY_ARCHIVE_INVALID_ENTRY_PATH',
      'Legacy ZIP entry path is outside the fixed review payload.',
    )
  }
  return isAttachment
}

/** Rejects encrypted, descriptor-based and otherwise unsupported ZIP flags. */
function validateFlags(flags) {
  if ((flags & GENERAL_PURPOSE_ENCRYPTED) !== 0) {
    rejectArchive(
      'LEGACY_ARCHIVE_UNSUPPORTED_ENCRYPTION',
      'Encrypted ZIP entries are unsupported in a legacy plaintext archive.',
    )
  }
  if ((flags & GENERAL_PURPOSE_DATA_DESCRIPTOR) !== 0) {
    rejectArchive(
      'LEGACY_ARCHIVE_UNSUPPORTED_DESCRIPTOR',
      'ZIP data-descriptor entries are unsupported.',
    )
  }
  if ((flags & ~GENERAL_PURPOSE_UTF8) !== 0) {
    rejectArchive('LEGACY_ARCHIVE_UNSUPPORTED_FLAGS', 'Legacy ZIP entry flags are unsupported.')
  }
}

/** Rejects directory, symlink and other non-regular central-directory entries. */
function validateExternalAttributes(versionMadeBy, externalAttributes) {
  if ((externalAttributes & 0x10) !== 0) {
    rejectArchive('LEGACY_ARCHIVE_UNSUPPORTED_FILE_TYPE', 'ZIP directory entries are unsupported.')
  }
  const creatorPlatform = versionMadeBy >>> 8
  if (creatorPlatform !== 3) return
  const unixMode = externalAttributes >>> 16
  const unixFileType = unixMode & 0o170000
  if (unixFileType !== 0 && unixFileType !== 0o100000) {
    const kind = unixFileType === 0o120000 ? 'symlink' : 'non-regular file type'
    rejectArchive(
      'LEGACY_ARCHIVE_UNSUPPORTED_FILE_TYPE',
      `ZIP ${kind} entries are unsupported.`,
    )
  }
}

/** Validates declared per-entry size envelopes before any payload extraction. */
function validateEntrySize(name, compressedSize, uncompressedSize) {
  if (compressedSize === ZIP64_UINT32_SENTINEL || uncompressedSize === ZIP64_UINT32_SENTINEL) {
    rejectArchive('LEGACY_ARCHIVE_UNSUPPORTED_ZIP64', 'ZIP64 legacy archives are unsupported.')
  }
  if ((name === 'manifest.json' || name === 'mission.json')
    && uncompressedSize > MAX_METADATA_ENTRY_BYTES) {
    rejectArchive(
      'LEGACY_ARCHIVE_LIMIT_EXCEEDED',
      'Legacy ZIP metadata entry exceeds its safe limit.',
    )
  }
}

/** Parses and bounds every central-directory declaration without reading entry payloads. */
async function readCentralDirectory(fileHandle, endRecord) {
  const entries = []
  const collisionKeys = new Set()
  let cursor = endRecord.centralDirectoryOffset
  let totalUncompressedBytes = 0
  for (let index = 0; index < endRecord.entryCount; index += 1) {
    const header = await readExactly(fileHandle, cursor, ZIP_CENTRAL_HEADER_BYTES, 'central header')
    if (header.readUInt32LE(0) !== CENTRAL_DIRECTORY_SIGNATURE) {
      rejectArchive(
        'LEGACY_ARCHIVE_INVALID_CENTRAL_DIRECTORY',
        'Legacy ZIP central-directory signature is invalid.',
      )
    }
    const versionMadeBy = header.readUInt16LE(4)
    const versionNeeded = header.readUInt16LE(6)
    const flags = header.readUInt16LE(8)
    const compressionMethod = header.readUInt16LE(10)
    const modifiedTime = header.readUInt16LE(12)
    const modifiedDate = header.readUInt16LE(14)
    const crc32 = header.readUInt32LE(16)
    const compressedSize = header.readUInt32LE(20)
    const uncompressedSize = header.readUInt32LE(24)
    const nameLength = header.readUInt16LE(28)
    const extraLength = header.readUInt16LE(30)
    const commentLength = header.readUInt16LE(32)
    const diskNumberStart = header.readUInt16LE(34)
    const internalAttributes = header.readUInt16LE(36)
    const externalAttributes = header.readUInt32LE(38)
    const localHeaderOffset = header.readUInt32LE(42)
    if (versionNeeded > 20) {
      rejectArchive(
        'LEGACY_ARCHIVE_UNSUPPORTED_VERSION',
        'Legacy ZIP needs an unsupported ZIP feature version.',
      )
    }
    validateFlags(flags)
    if (compressionMethod !== COMPRESSION_STORE && compressionMethod !== COMPRESSION_DEFLATE) {
      rejectArchive(
        'LEGACY_ARCHIVE_UNSUPPORTED_COMPRESSION',
        `Legacy ZIP uses unsupported compression method ${compressionMethod}.`,
      )
    }
    if (nameLength < 1 || nameLength > MAX_ENTRY_NAME_BYTES) {
      rejectArchive(
        'LEGACY_ARCHIVE_LIMIT_EXCEEDED',
        'Legacy ZIP entry name exceeds its safe limit.',
      )
    }
    if (extraLength !== 0 || commentLength !== 0 || diskNumberStart !== 0
      || internalAttributes !== 0) {
      rejectArchive(
        'LEGACY_ARCHIVE_UNSUPPORTED',
        'Legacy ZIP central-directory extensions are unsupported.',
      )
    }
    if (localHeaderOffset === ZIP64_UINT32_SENTINEL) {
      rejectArchive('LEGACY_ARCHIVE_UNSUPPORTED_ZIP64', 'ZIP64 legacy archives are unsupported.')
    }
    validateExternalAttributes(versionMadeBy, externalAttributes)
    validateEntrySize('', compressedSize, uncompressedSize)

    const variableLength = nameLength + extraLength + commentLength
    if (cursor + ZIP_CENTRAL_HEADER_BYTES + variableLength
      > endRecord.centralDirectoryOffset + endRecord.centralDirectorySize) {
      rejectArchive(
        'LEGACY_ARCHIVE_TRUNCATED',
        'Legacy ZIP central-directory entry is truncated.',
      )
    }
    const nameBytes = await readExactly(
      fileHandle,
      cursor + ZIP_CENTRAL_HEADER_BYTES,
      nameLength,
      'central entry name',
    )
    const name = decodeEntryName(nameBytes)
    const isAttachment = validateEntryName(name, nameBytes)
    validateEntrySize(name, compressedSize, uncompressedSize)
    const collisionKey = name.normalize('NFC').toLowerCase()
    if (collisionKeys.has(collisionKey)) {
      rejectArchive(
        'LEGACY_ARCHIVE_DUPLICATE_ENTRY',
        'Legacy ZIP contains duplicate or filesystem-colliding entry names.',
      )
    }
    collisionKeys.add(collisionKey)
    totalUncompressedBytes += uncompressedSize
    if (!Number.isSafeInteger(totalUncompressedBytes)
      || totalUncompressedBytes > MAX_TOTAL_UNCOMPRESSED_BYTES) {
      rejectArchive(
        'LEGACY_ARCHIVE_LIMIT_EXCEEDED',
        'Legacy ZIP total restored size exceeds its safe limit.',
      )
    }
    entries.push({
      centralIndex: index,
      compressedSize,
      compressionMethod,
      crc32,
      flags,
      isAttachment,
      localHeaderOffset,
      modifiedDate,
      modifiedTime,
      name,
      nameBytes,
      uncompressedSize,
      versionNeeded,
    })
    cursor += ZIP_CENTRAL_HEADER_BYTES + variableLength
  }
  if (cursor !== endRecord.eocdOffset) {
    rejectArchive(
      'LEGACY_ARCHIVE_INVALID_CENTRAL_DIRECTORY',
      'Legacy ZIP central-directory size does not match its entries.',
    )
  }
  for (let index = 0; index < REQUIRED_ENTRY_NAMES.length; index += 1) {
    if (entries[index]?.name !== REQUIRED_ENTRY_NAMES[index]) {
      rejectArchive(
        'LEGACY_ARCHIVE_INVALID_ENTRY_ORDER',
        'Legacy ZIP fixed repository entries are not in their required order.',
      )
    }
  }
  for (const requiredName of REQUIRED_ENTRY_NAMES) {
    if (!collisionKeys.has(requiredName)) {
      rejectArchive(
        'LEGACY_ARCHIVE_MISSING_ENTRY',
        `Legacy ZIP is missing required entry ${requiredName}.`,
      )
    }
  }
  return entries
}

/** Proves central/local agreement, contiguity and ordering before extraction. */
async function reconcileLocalHeaders(fileHandle, entries, centralDirectoryOffset) {
  let expectedOffset = 0
  for (const entry of entries) {
    if (entry.localHeaderOffset !== expectedOffset) {
      rejectArchive(
        'LEGACY_ARCHIVE_INVALID_LOCAL_ORDER',
        'Legacy ZIP central and local entry order or offsets do not agree.',
      )
    }
    const header = await readExactly(
      fileHandle,
      entry.localHeaderOffset,
      ZIP_LOCAL_HEADER_BYTES,
      'local header',
    )
    if (header.readUInt32LE(0) !== LOCAL_FILE_HEADER_SIGNATURE) {
      rejectArchive('LEGACY_ARCHIVE_INVALID_LOCAL_HEADER', 'Legacy ZIP local header is invalid.')
    }
    const localVersionNeeded = header.readUInt16LE(4)
    const localFlags = header.readUInt16LE(6)
    const localCompressionMethod = header.readUInt16LE(8)
    const localModifiedTime = header.readUInt16LE(10)
    const localModifiedDate = header.readUInt16LE(12)
    const localCrc32 = header.readUInt32LE(14)
    const localCompressedSize = header.readUInt32LE(18)
    const localUncompressedSize = header.readUInt32LE(22)
    const localNameLength = header.readUInt16LE(26)
    const localExtraLength = header.readUInt16LE(28)
    if (localExtraLength !== 0) {
      rejectArchive(
        'LEGACY_ARCHIVE_UNSUPPORTED',
        'Legacy ZIP local-header extensions are unsupported.',
      )
    }
    if (localVersionNeeded !== entry.versionNeeded
      || localFlags !== entry.flags
      || localCompressionMethod !== entry.compressionMethod
      || localModifiedTime !== entry.modifiedTime
      || localModifiedDate !== entry.modifiedDate
      || localCrc32 !== entry.crc32
      || localCompressedSize !== entry.compressedSize
      || localUncompressedSize !== entry.uncompressedSize
      || localNameLength !== entry.nameBytes.length) {
      rejectArchive(
        'LEGACY_ARCHIVE_HEADER_MISMATCH',
        'Legacy ZIP central and local headers do not agree.',
      )
    }
    const localName = await readExactly(
      fileHandle,
      entry.localHeaderOffset + ZIP_LOCAL_HEADER_BYTES,
      localNameLength,
      'local entry name',
    )
    if (!localName.equals(entry.nameBytes)) {
      rejectArchive(
        'LEGACY_ARCHIVE_HEADER_MISMATCH',
        'Legacy ZIP central and local entry names do not agree.',
      )
    }
    const dataOffset = entry.localHeaderOffset
      + ZIP_LOCAL_HEADER_BYTES
      + localNameLength
      + localExtraLength
    const dataEnd = dataOffset + entry.compressedSize
    if (!Number.isSafeInteger(dataEnd) || dataEnd > centralDirectoryOffset) {
      rejectArchive('LEGACY_ARCHIVE_TRUNCATED', 'Legacy ZIP entry payload is truncated.')
    }
    entry.dataOffset = dataOffset
    expectedOffset = dataEnd
  }
  if (expectedOffset !== centralDirectoryOffset) {
    rejectArchive(
      'LEGACY_ARCHIVE_INVALID_LOCAL_ORDER',
      'Legacy ZIP contains a gap or splice before its central directory.',
    )
  }
}

/** Streams one exact compressed range from the pinned descriptor in bounded chunks. */
async function* readArchiveRange(fileHandle, start, length, request) {
  let offset = 0
  while (offset < length) {
    assertRestoreActive(request)
    const chunkLength = Math.min(READ_CHUNK_BYTES, length - offset)
    const chunk = Buffer.allocUnsafe(chunkLength)
    const result = await fileHandle.read(chunk, 0, chunkLength, start + offset)
    if (result.bytesRead !== chunkLength) {
      rejectArchive('LEGACY_ARCHIVE_TRUNCATED', 'Legacy ZIP entry payload is truncated.')
    }
    offset += result.bytesRead
    yield chunk
  }
}

/** Creates a transform that enforces declared output size and computes CRC incrementally. */
function createIntegrityTransform(entry, request, onChunk) {
  const state = { crc: 0xffffffff, size: 0, sha256: createHash('sha256') }
  const transform = new Transform({
    transform(chunk, _encoding, callback) {
      try {
        assertRestoreActive(request)
      } catch (error) {
        callback(error)
        return
      }
      state.size += chunk.length
      if (state.size > entry.uncompressedSize) {
        callback(new LegacyArchiveRestoreError(
          'LEGACY_ARCHIVE_LIMIT_EXCEEDED',
          'Legacy ZIP entry expanded beyond its declared size.',
        ))
        return
      }
      state.crc = updateCrc32(state.crc, chunk)
      state.sha256.update(chunk)
      onChunk?.(chunk.length)
      callback(null, chunk)
    },
  })
  return { state, transform }
}

/** Maps a validated archive name to its fixed session output path. */
function outputPathForEntry(sessionDirectory, entryName) {
  if (entryName.startsWith('attachments/')) {
    return path.join(sessionDirectory, 'attachments', entryName.slice('attachments/'.length))
  }
  return path.join(sessionDirectory, entryName)
}

/** Pins one real directory without following a leaf symlink. */
function pinOutputDirectory(directory) {
  const observed = fs.lstatSync(directory)
  const realPath = fs.realpathSync(directory)
  if (!observed.isDirectory() || observed.isSymbolicLink()) {
    rejectArchive(
      'LEGACY_ARCHIVE_SESSION_REBOUND',
      'Legacy archive review scratch changed identity.',
    )
  }
  return Object.freeze({ dev: observed.dev, ino: observed.ino, realPath })
}

/** Requires one directory path to retain its pinned identity. */
function assertOutputDirectory(directory, identity) {
  let observed
  let realPath
  try {
    observed = fs.lstatSync(directory)
    realPath = fs.realpathSync(directory)
  } catch (error) {
    rejectArchive(
      'LEGACY_ARCHIVE_SESSION_REBOUND',
      'Legacy archive review scratch changed identity.',
      error,
    )
  }
  if (!observed.isDirectory() || observed.isSymbolicLink()
    || observed.dev !== identity.dev || observed.ino !== identity.ino
    || realPath !== identity.realPath) {
    rejectArchive(
      'LEGACY_ARCHIVE_SESSION_REBOUND',
      'Legacy archive review scratch changed identity.',
    )
  }
}

/** Creates the session-long output ownership registry used for failure zeroing. */
function createOutputOwnership(sessionDirectory) {
  return {
    sessionDirectory,
    sessionIdentity: pinOutputDirectory(sessionDirectory),
    attachmentDirectory: null,
    attachmentDirectoryIdentity: null,
    complete: false,
    outputs: [],
  }
}

/** Pins the fixed attachment directory before any attachment file is opened. */
async function prepareAttachmentDirectory(ownership) {
  assertOutputDirectory(ownership.sessionDirectory, ownership.sessionIdentity)
  const attachmentDirectory = path.join(ownership.sessionDirectory, 'attachments')
  await mkdir(attachmentDirectory, { mode: 0o700 })
  await chmod(attachmentDirectory, 0o700)
  assertOutputDirectory(ownership.sessionDirectory, ownership.sessionIdentity)
  ownership.attachmentDirectory = attachmentDirectory
  ownership.attachmentDirectoryIdentity = pinOutputDirectory(attachmentDirectory)
}

/** Requires one output descriptor and its fixed path to still name the same inode. */
async function assertOwnedOutput(output, ownership) {
  assertOutputDirectory(ownership.sessionDirectory, ownership.sessionIdentity)
  assertOutputDirectory(output.directoryPath, output.directoryIdentity)
  let descriptorStat
  let pathStat
  try {
    descriptorStat = await output.fileHandle.stat()
    pathStat = await lstat(output.path)
  } catch (error) {
    rejectArchive(
      'LEGACY_ARCHIVE_SESSION_REBOUND',
      'Legacy archive review output changed identity.',
      error,
    )
  }
  if (!descriptorStat.isFile() || !pathStat.isFile() || pathStat.isSymbolicLink()
    || descriptorStat.dev !== pathStat.dev || descriptorStat.ino !== pathStat.ino) {
    rejectArchive(
      'LEGACY_ARCHIVE_SESSION_REBOUND',
      'Legacy archive review output changed identity.',
    )
  }
}

/** Opens one fixed output and retains its descriptor until the whole restore settles. */
async function openOwnedOutput(ownership, entry) {
  assertOutputDirectory(ownership.sessionDirectory, ownership.sessionIdentity)
  const outputPath = outputPathForEntry(ownership.sessionDirectory, entry.name)
  const directoryPath = path.dirname(outputPath)
  let directoryIdentity
  if (directoryPath === ownership.sessionDirectory) {
    directoryIdentity = ownership.sessionIdentity
  } else if (directoryPath === ownership.attachmentDirectory
    && ownership.attachmentDirectoryIdentity !== null) {
    directoryIdentity = ownership.attachmentDirectoryIdentity
  } else {
    rejectArchive(
      'LEGACY_ARCHIVE_INVALID_ENTRY_PATH',
      'Legacy ZIP entry path is outside the fixed review payload.',
    )
  }
  assertOutputDirectory(directoryPath, directoryIdentity)
  const fileHandle = await open(
    outputPath,
    fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_EXCL
      | (fs.constants.O_NOFOLLOW ?? 0),
    0o600,
  )
  const output = {
    directoryIdentity,
    directoryPath,
    entryName: entry.name,
    fileHandle,
    path: outputPath,
  }
  ownership.outputs.push(output)
  await assertOwnedOutput(output, ownership)
  return output
}

/** Rechecks every retained output before or after a path-based consumer. */
async function assertAllOutputsOwned(ownership) {
  assertOutputDirectory(ownership.sessionDirectory, ownership.sessionIdentity)
  for (const output of ownership.outputs) await assertOwnedOutput(output, ownership)
}

/** Zeroes every opened plaintext inode on failure, even after its path was displaced. */
async function settleOutputOwnership(ownership) {
  if (ownership === null) return
  if (!ownership.complete) {
    for (const output of ownership.outputs) {
      try { await output.fileHandle.truncate(0) } catch {}
      try { await output.fileHandle.sync() } catch {}
      try {
        const descriptorStat = await output.fileHandle.stat()
        const pathStat = await lstat(output.path)
        if (descriptorStat.isFile() && pathStat.isFile() && !pathStat.isSymbolicLink()
          && descriptorStat.dev === pathStat.dev && descriptorStat.ino === pathStat.ino) {
          fs.unlinkSync(output.path)
        }
      } catch {}
    }
  }
  for (const output of ownership.outputs) {
    try { await output.fileHandle.close() } catch {}
  }
  if (!ownership.complete && ownership.attachmentDirectoryIdentity !== null) {
    try {
      const observed = fs.lstatSync(ownership.attachmentDirectory)
      const realPath = fs.realpathSync(ownership.attachmentDirectory)
      if (observed.isDirectory() && !observed.isSymbolicLink()
        && observed.dev === ownership.attachmentDirectoryIdentity.dev
        && observed.ino === ownership.attachmentDirectoryIdentity.ino
        && realPath === ownership.attachmentDirectoryIdentity.realPath
        && fs.readdirSync(ownership.attachmentDirectory).length === 0) {
        fs.rmdirSync(ownership.attachmentDirectory)
      }
    } catch {}
  }
}

/** Returns the exact restored database identity retained by the restore worker. */
async function getOwnedDatabaseIdentity(ownership) {
  const output = ownership.outputs.find((entry) => entry.entryName === 'mission-store.sqlite')
  if (output === undefined) {
    rejectArchive(
      'LEGACY_ARCHIVE_SESSION_REBOUND',
      'Legacy archive restored database identity is unavailable.',
    )
  }
  await assertOwnedOutput(output, ownership)
  const observed = await output.fileHandle.stat()
  if (!observed.isFile() || !Number.isSafeInteger(observed.dev)
    || !Number.isSafeInteger(observed.ino) || !Number.isSafeInteger(observed.size)
    || observed.dev < 0 || observed.ino < 1 || observed.size < 1) {
    rejectArchive(
      'LEGACY_ARCHIVE_SESSION_REBOUND',
      'Legacy archive restored database identity is invalid.',
    )
  }
  return Object.freeze({ dev: observed.dev, ino: observed.ino, sizeBytes: observed.size })
}

/** Streams, decompresses and authenticates one entry to a newly-created 0600 file. */
async function extractEntry(fileHandle, entry, ownership, request, onChunk) {
  const output = await openOwnedOutput(ownership, entry)
  const source = Readable.from(readArchiveRange(
    fileHandle,
    entry.dataOffset,
    entry.compressedSize,
    request,
  ))
  const { state, transform } = createIntegrityTransform(entry, request, onChunk)
  const outputStream = fs.createWriteStream(output.path, {
    autoClose: false,
    fd: output.fileHandle.fd,
    flags: 'w',
    mode: 0o600,
  })
  let inflater = null
  try {
    if (entry.compressionMethod === COMPRESSION_DEFLATE) {
      inflater = zlib.createInflateRaw()
      await pipeline(source, inflater, transform, outputStream)
    } else {
      await pipeline(source, transform, outputStream)
    }
  } catch (error) {
    if (error instanceof LegacyArchiveRestoreError) throw error
    if (isDiskFullError(error)) {
      rejectArchive(
        'LEGACY_ARCHIVE_DISK_FULL',
        'Legacy archive restore requires more free disk space.',
        error,
      )
    }
    rejectArchive(
      'LEGACY_ARCHIVE_CORRUPT_ENTRY',
      'Legacy ZIP entry failed decompression or CRC verification.',
      error,
    )
  }
  if (inflater !== null && inflater.bytesWritten !== entry.compressedSize) {
    rejectArchive(
      'LEGACY_ARCHIVE_CORRUPT_ENTRY',
      'Legacy ZIP compressed entry contains an unconsumed splice.',
    )
  }
  const finalCrc = (state.crc ^ 0xffffffff) >>> 0
  if (state.size !== entry.uncompressedSize || finalCrc !== entry.crc32) {
    rejectArchive(
      'LEGACY_ARCHIVE_CORRUPT_ENTRY',
      'Legacy ZIP entry failed size or CRC-32 verification.',
    )
  }
  await output.fileHandle.chmod(0o600)
  await output.fileHandle.sync()
  await assertOwnedOutput(output, ownership)
  return Object.freeze({
    sizeBytes: state.size,
    sha256: state.sha256.digest('hex'),
  })
}

/** Parses a bounded JSON metadata file already restored inside the session. */
async function readBoundedJson(output, entry, ownership) {
  if (entry.uncompressedSize > MAX_METADATA_ENTRY_BYTES) {
    rejectArchive('LEGACY_ARCHIVE_LIMIT_EXCEEDED', 'Legacy ZIP metadata exceeds its safe limit.')
  }
  await assertOwnedOutput(output, ownership)
  const bytes = await readExactly(
    output.fileHandle,
    0,
    entry.uncompressedSize,
    'restored metadata',
  )
  let value
  try {
    value = JSON.parse(bytes.toString('utf8'))
  } catch (error) {
    rejectArchive('LEGACY_ARCHIVE_INVALID_METADATA', 'Legacy ZIP metadata JSON is invalid.', error)
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    rejectArchive('LEGACY_ARCHIVE_INVALID_METADATA', 'Legacy ZIP metadata JSON is invalid.')
  }
  return value
}

/** Validates the exact legacy manifest and mission identity before the large database restore. */
function validateMetadata(manifest, mission, expectedMissionId) {
  if (manifest.archive_version !== SUPPORTED_LEGACY_CONTAINER_VERSION) {
    rejectArchive(
      'LEGACY_ARCHIVE_UNSUPPORTED_VERSION',
      'Legacy archive has an unsupported container version.',
    )
  }
  if (!Number.isSafeInteger(manifest.schema_version) || manifest.schema_version < 1) {
    rejectArchive('LEGACY_ARCHIVE_INVALID_METADATA', 'Legacy archive schema version is invalid.')
  }
  if (manifest.schema_version > CURRENT_SUPPORTED_SCHEMA_VERSION) {
    rejectArchive(
      'LEGACY_ARCHIVE_UNSUPPORTED_SCHEMA',
      'Legacy archive uses a newer unsupported schema version.',
    )
  }
  if (manifest.snapshot_format !== 'sqlite') {
    rejectArchive(
      'LEGACY_ARCHIVE_UNSUPPORTED',
      'Legacy archive snapshot format is unsupported.',
    )
  }
  if (manifest.mission_id !== expectedMissionId
    || mission.id !== expectedMissionId) {
    rejectArchive(
      'LEGACY_ARCHIVE_MISSION_MISMATCH',
      'Legacy archive mission or schema does not match its custody record.',
    )
  }
  if (!Number.isSafeInteger(mission.schema_version)
    || mission.schema_version < 1
    || mission.schema_version > manifest.schema_version) {
    rejectArchive(
      'LEGACY_ARCHIVE_INVALID_METADATA',
      'Legacy archive mission row schema does not match its database schema history.',
    )
  }
  if (mission.status !== 'finished' && mission.status !== 'finalized') {
    rejectArchive(
      'LEGACY_ARCHIVE_INVALID_METADATA',
      'Legacy archive mission status must be finished or finalized.',
    )
  }
  if (typeof manifest.created_at !== 'string'
    || !Number.isFinite(Date.parse(manifest.created_at))) {
    rejectArchive('LEGACY_ARCHIVE_INVALID_METADATA', 'Legacy archive creation time is invalid.')
  }
  return Object.freeze({
    databaseSchemaVersion: manifest.schema_version,
    missionSchemaVersion: mission.schema_version,
    missionStatus: mission.status,
  })
}

/** Opens the restored snapshot read-only and cross-checks schema and mission identity. */
function validateRestoredDatabase(databasePath, expectedMissionId, expectedSchemas) {
  let database
  try {
    database = new Database(databasePath, { fileMustExist: true, readonly: true })
    database.pragma('query_only = ON')
    const integrityRows = database.pragma('integrity_check')
    if (!Array.isArray(integrityRows)
      || integrityRows.length !== 1
      || integrityRows[0]?.integrity_check !== 'ok') {
      rejectArchive(
        'LEGACY_ARCHIVE_INVALID_DATABASE',
        'Legacy archive SQLite integrity verification failed.',
      )
    }
    const schemaRow = database.prepare(
      "SELECT value FROM metadata WHERE key = 'schema_version'",
    ).get()
    if (typeof schemaRow?.value !== 'string'
      || !/^[1-9][0-9]*$/u.test(schemaRow.value)
      || !Number.isSafeInteger(Number(schemaRow.value))
      || Number(schemaRow.value) > CURRENT_SUPPORTED_SCHEMA_VERSION) {
      rejectArchive(
        'LEGACY_ARCHIVE_UNSUPPORTED_SCHEMA',
        'Legacy archive SQLite schema metadata is unsupported.',
      )
    }
    const databaseSchemaVersion = Number(schemaRow?.value)
    const missionRow = database.prepare(
      'SELECT id, schema_version, status FROM missions WHERE id = ?',
    ).get(expectedMissionId)
    if (databaseSchemaVersion !== expectedSchemas.databaseSchemaVersion
      || missionRow?.id !== expectedMissionId
      || Number(missionRow?.schema_version) !== expectedSchemas.missionSchemaVersion
      || missionRow?.status !== expectedSchemas.missionStatus) {
      rejectArchive(
        'LEGACY_ARCHIVE_MISSION_MISMATCH',
        'Legacy archive SQLite mission, status, or schema does not match its manifest.',
      )
    }
  } catch (error) {
    if (error instanceof LegacyArchiveRestoreError) throw error
    rejectArchive(
      'LEGACY_ARCHIVE_INVALID_DATABASE',
      'Legacy archive SQLite snapshot is invalid or corrupt.',
      error,
    )
  } finally {
    database?.close()
  }
}

/** Produces the exact legacy creator filename for one restored DB reference. */
function legacyAttachmentEntryName(record, basenameCounts) {
  const basename = record.sourceRelativePath
  if (basenameCounts.get(basename) === 1) return `attachments/${basename}`
  const pathIdentity = createHash('sha256')
    .update(record.sourcePath, 'utf8')
    .digest('hex')
    .slice(0, 12)
  return `attachments/${pathIdentity}-${basename}`
}

/**
 * Requires an exact one-to-one mapping between archived attachment files and
 * every retained marker/version/event path in the migrated scratch database.
 */
function buildLegacyAttachmentMappings(databasePath, missionId, attachmentEntries) {
  let database
  try {
    database = new Database(databasePath, { fileMustExist: true, readonly: true })
    database.pragma('query_only = ON')
    const ledger = readArchiveAttachmentReferenceLedger({
      db: database,
      databasePath,
      missionId,
      restored: true,
    })
    if (ledger.length !== attachmentEntries.length) {
      rejectArchive(
        'LEGACY_ARCHIVE_INVALID_ATTACHMENT_MAPPING',
        'Legacy archive attachments do not match retained mission evidence.',
      )
    }
    const basenameCounts = new Map()
    for (const record of ledger) {
      basenameCounts.set(
        record.sourceRelativePath,
        (basenameCounts.get(record.sourceRelativePath) ?? 0) + 1,
      )
    }
    const recordsByEntryName = new Map()
    for (const record of ledger) {
      const entryName = legacyAttachmentEntryName(record, basenameCounts)
      if (recordsByEntryName.has(entryName)) {
        rejectArchive(
          'LEGACY_ARCHIVE_INVALID_ATTACHMENT_MAPPING',
          'Legacy archive attachment identity is ambiguous.',
        )
      }
      recordsByEntryName.set(entryName, record)
    }
    const mappings = attachmentEntries.map((entry) => {
      const record = recordsByEntryName.get(entry.name)
      if (record === undefined) {
        rejectArchive(
          'LEGACY_ARCHIVE_INVALID_ATTACHMENT_MAPPING',
          'Legacy archive attachment has no exact retained evidence mapping.',
        )
      }
      recordsByEntryName.delete(entry.name)
      const references = Object.freeze(record.references.map((reference) => Object.freeze({
        referenceKind: reference.referenceKind,
        referenceId: reference.referenceId,
      })))
      return Object.freeze({
        entryName: entry.name,
        sourceRelativePath: record.sourceRelativePath,
        references,
      })
    })
    if (recordsByEntryName.size !== 0) {
      rejectArchive(
        'LEGACY_ARCHIVE_INVALID_ATTACHMENT_MAPPING',
        'Legacy archive omits a retained mission attachment.',
      )
    }
    return Object.freeze(mappings)
  } catch (error) {
    if (error instanceof LegacyArchiveRestoreError) throw error
    rejectArchive(
      'LEGACY_ARCHIVE_INVALID_ATTACHMENT_MAPPING',
      'Legacy archive attachment evidence is invalid.',
      error,
    )
  } finally {
    database?.close()
  }
}

/** Ensures the source descriptor still identifies the same unchanged-sized custody file. */
async function assertSourceIdentityUnchanged(fileHandle, archivePath, initialStat) {
  const finalStat = await fileHandle.stat()
  let finalPathStat
  try {
    finalPathStat = await lstat(archivePath)
  } catch (error) {
    rejectArchive(
      'LEGACY_ARCHIVE_SOURCE_CHANGED',
      'Legacy archive custody path changed during restore.',
      error,
    )
  }
  if (!finalPathStat.isFile() || finalPathStat.isSymbolicLink()
    || finalPathStat.dev !== initialStat.dev
    || finalPathStat.ino !== initialStat.ino
    || finalPathStat.size !== initialStat.size
    || finalPathStat.mtimeMs !== initialStat.mtimeMs
    || finalPathStat.ctimeMs !== initialStat.ctimeMs
    || finalStat.dev !== initialStat.dev
    || finalStat.ino !== initialStat.ino
    || finalStat.size !== initialStat.size
    || finalStat.mtimeMs !== initialStat.mtimeMs
    || finalStat.ctimeMs !== initialStat.ctimeMs) {
    rejectArchive(
      'LEGACY_ARCHIVE_SOURCE_CHANGED',
      'Legacy archive custody bytes changed during restore.',
    )
  }
}

/**
 * Restores one repository-owned legacy v1 plaintext ZIP into a dedicated review session.
 * The archive is parsed from a pinned read-only descriptor and entry payloads are streamed;
 * the full archive is never loaded into an application Buffer. Source bytes are never written.
 *
 * @param {{ archivePath: string, sessionDirectory: string, expectedMissionId: string }} input
 * @param {{ getAvailableDiskBytes?: (sessionDirectory: string) => Promise<number | bigint> }} [dependencies]
 * @returns {Promise<{
 *   archiveKind: 'legacy_unencrypted',
 *   containerVersion: 1,
 *   encrypted: false,
 *   immutable: true,
 *   missionId: string,
 *   databaseFileName: 'mission-store.sqlite',
 *   schemaVersion: number,
 *   entryCount: number,
 *   attachmentCount: number,
 *   attachmentMappings: readonly object[],
 * }>}
 */
async function restoreLegacyMissionArchive(input, dependencies = {}) {
  const request = validateRestoreInput(input)
  if (dependencies === null || typeof dependencies !== 'object' || Array.isArray(dependencies)
    || (dependencies.getAvailableDiskBytes !== undefined
      && typeof dependencies.getAvailableDiskBytes !== 'function')) {
    rejectArchive('LEGACY_ARCHIVE_INVALID_REQUEST', 'Legacy archive restore dependencies are invalid.')
  }
  const getAvailableDiskBytes = dependencies.getAvailableDiskBytes
    ?? getDefaultAvailableDiskBytes
  let archiveHandle = null
  let outputOwnership = null
  let databaseFileHandle = null
  let transferDatabaseFileHandle = false
  try {
    await prepareSessionDirectory(request.sessionDirectory)
    outputOwnership = createOutputOwnership(request.sessionDirectory)
    const sourceStat = await lstat(request.archivePath)
    if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) {
      rejectArchive(
        'LEGACY_ARCHIVE_INVALID_SOURCE',
        'Legacy archive custody source must be a regular file.',
      )
    }
    const noFollow = fs.constants.O_NOFOLLOW ?? 0
    archiveHandle = await open(request.archivePath, fs.constants.O_RDONLY | noFollow)
    const initialStat = await archiveHandle.stat()
    if (!initialStat.isFile()
      || initialStat.dev !== sourceStat.dev
      || initialStat.ino !== sourceStat.ino) {
      rejectArchive(
        'LEGACY_ARCHIVE_INVALID_SOURCE',
        'Legacy archive custody source must be a regular file.',
      )
    }
    emitRestoreProgress(request, {
      phase: 'preflight',
      unit: 'files',
      completed: 1,
      total: 5,
      detail: 'archive-pinned',
    })

    const endRecord = await readEndOfCentralDirectory(archiveHandle, initialStat.size)
    const entries = await readCentralDirectory(archiveHandle, endRecord)
    await reconcileLocalHeaders(archiveHandle, entries, endRecord.centralDirectoryOffset)
    await assertRestoreCapacity(entries, request.sessionDirectory, getAvailableDiskBytes)
    await prepareAttachmentDirectory(outputOwnership)

    const entriesByName = new Map(entries.map((entry) => [entry.name, entry]))
    const manifestEntry = entriesByName.get('manifest.json')
    const missionEntry = entriesByName.get('mission.json')
    const databaseEntry = entriesByName.get('mission-store.sqlite')
    await extractEntry(archiveHandle, manifestEntry, outputOwnership, request)
    await extractEntry(archiveHandle, missionEntry, outputOwnership, request)
    const manifestOutput = outputOwnership.outputs.find(
      (output) => output.entryName === manifestEntry.name,
    )
    const missionOutput = outputOwnership.outputs.find(
      (output) => output.entryName === missionEntry.name,
    )
    const manifest = await readBoundedJson(manifestOutput, manifestEntry, outputOwnership)
    const mission = await readBoundedJson(missionOutput, missionEntry, outputOwnership)
    const schemas = validateMetadata(manifest, mission, request.expectedMissionId)
    emitRestoreProgress(request, {
      phase: 'metadata',
      unit: 'files',
      completed: 2,
      total: 5,
      detail: 'metadata-validated',
    })

    const databaseProgress = createByteProgressReporter(
      request,
      'database',
      'database-restoring',
      databaseEntry.uncompressedSize,
    )
    databaseProgress.flush()
    await extractEntry(
      archiveHandle,
      databaseEntry,
      outputOwnership,
      request,
      (byteCount) => databaseProgress.advance(byteCount),
    )
    databaseProgress.flush('database-restored')
    const databasePath = outputPathForEntry(request.sessionDirectory, databaseEntry.name)
    await assertAllOutputsOwned(outputOwnership)
    const validationStepBytes = databaseEntry.uncompressedSize
    const validationStepCount = schemas.databaseSchemaVersion < CURRENT_SUPPORTED_SCHEMA_VERSION
      ? 3
      : 2
    const validationTotalBytes = validationStepBytes * validationStepCount
    emitRestoreProgress(request, {
      phase: 'validate',
      unit: 'bytes',
      completed: 0,
      total: validationTotalBytes,
      detail: 'sqlite-integrity',
    })
    validateRestoredDatabase(
      databasePath,
      request.expectedMissionId,
      schemas,
    )
    let completedValidationBytes = validationStepBytes
    emitRestoreProgress(request, {
      phase: 'validate',
      unit: 'bytes',
      completed: completedValidationBytes,
      total: validationTotalBytes,
      detail: 'sqlite-integrity-complete',
    })
    if (schemas.databaseSchemaVersion < CURRENT_SUPPORTED_SCHEMA_VERSION) {
      try {
        migrateMissionStoreForArchiveReview({
          databasePath,
          archiveDirectory: path.join(request.sessionDirectory, '.migration-archives'),
          cancellationFlag: request.cancellationFlag,
          onProgress: () => undefined,
        })
      } catch (error) {
        if (error?.code === 'ARCHIVE_CANCELLED') throw error
        rejectArchive(
          'LEGACY_ARCHIVE_INVALID_DATABASE',
          'Legacy archive SQLite scratch migration failed safely.',
          error,
        )
      }
      completedValidationBytes += validationStepBytes
      emitRestoreProgress(request, {
        phase: 'validate',
        unit: 'bytes',
        completed: completedValidationBytes,
        total: validationTotalBytes,
        detail: 'sqlite-migration-complete',
      })
    }
    await assertAllOutputsOwned(outputOwnership)
    validateRestoredDatabase(databasePath, request.expectedMissionId, {
      ...schemas,
      databaseSchemaVersion: CURRENT_SUPPORTED_SCHEMA_VERSION,
    })
    completedValidationBytes += validationStepBytes
    emitRestoreProgress(request, {
      phase: 'validate',
      unit: 'bytes',
      completed: completedValidationBytes,
      total: validationTotalBytes,
      detail: 'sqlite-validated',
    })

    const attachments = entries.filter((entry) => entry.isAttachment)
    const attachmentMappings = buildLegacyAttachmentMappings(
      databasePath,
      request.expectedMissionId,
      attachments,
    )
    await assertAllOutputsOwned(outputOwnership)
    const attachmentProgress = createByteProgressReporter(
      request,
      'attachments',
      'attachments-restoring',
    )
    attachmentProgress.flush()
    const attachmentProofs = new Map()
    for (const attachment of attachments) {
      const proof = await extractEntry(
        archiveHandle,
        attachment,
        outputOwnership,
        request,
        (byteCount) => attachmentProgress.advance(byteCount),
      )
      attachmentProofs.set(attachment.name, proof)
    }
    const provedAttachmentMappings = Object.freeze(attachmentMappings.map((mapping) => {
      const proof = attachmentProofs.get(mapping.entryName)
      if (proof === undefined) {
        rejectArchive(
          'LEGACY_ARCHIVE_INVALID_ATTACHMENT_MAPPING',
          'Legacy archive attachment proof is missing.',
        )
      }
      return Object.freeze({ ...mapping, ...proof })
    }))
    attachmentProgress.flush('attachments-restored')
    await assertAllOutputsOwned(outputOwnership)
    await assertSourceIdentityUnchanged(archiveHandle, request.archivePath, initialStat)
    emitRestoreProgress(request, {
      phase: 'ready',
      unit: 'files',
      completed: 5,
      total: 5,
      detail: 'session-ready',
    })
    await assertAllOutputsOwned(outputOwnership)
    const databaseIdentity = await getOwnedDatabaseIdentity(outputOwnership)
    databaseFileHandle = await open(
      databasePath,
      fs.constants.O_RDWR | (fs.constants.O_NOFOLLOW ?? 0),
    )
    const transferredIdentity = await databaseFileHandle.stat()
    if (!transferredIdentity.isFile() || transferredIdentity.nlink !== 1
      || transferredIdentity.dev !== databaseIdentity.dev
      || transferredIdentity.ino !== databaseIdentity.ino
      || transferredIdentity.size !== databaseIdentity.sizeBytes) {
      rejectArchive(
        'LEGACY_ARCHIVE_SESSION_REBOUND',
        'Legacy archive restored database changed before handle transfer.',
      )
    }
    await assertAllOutputsOwned(outputOwnership)
    outputOwnership.complete = true
    transferDatabaseFileHandle = true
    return Object.freeze({
      archiveKind: 'legacy_unencrypted',
      containerVersion: 1,
      encrypted: false,
      immutable: true,
      missionId: request.expectedMissionId,
      databaseFileName: 'mission-store.sqlite',
      databaseIdentity,
      databaseFileHandle,
      schemaVersion: CURRENT_SUPPORTED_SCHEMA_VERSION,
      entryCount: entries.length,
      attachmentCount: attachments.length,
      attachmentMappings: provedAttachmentMappings,
    })
  } catch (error) {
    if (error instanceof LegacyArchiveRestoreError) throw error
    throw new LegacyArchiveRestoreError(
      'LEGACY_ARCHIVE_RESTORE_FAILED',
      'Legacy archive restore failed before a review session could open.',
      error,
    )
  } finally {
    await archiveHandle?.close()
    await settleOutputOwnership(outputOwnership)
    if (databaseFileHandle !== null && !transferDatabaseFileHandle) {
      try { await databaseFileHandle.close() } catch {}
    }
  }
}

module.exports = {
  LegacyArchiveRestoreError,
  restoreLegacyMissionArchive,
}
