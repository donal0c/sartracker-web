'use strict'

const fs = require('node:fs/promises')
const { createHash } = require('node:crypto')

const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024
const SHA256 = /^[0-9a-f]{64}$/u

/** Streams one bounded attachment into a temporary file and proves its result. */
async function copyVerifiedAttachment(input) {
  const fileSystem = input.fileSystem ?? fs
  let source
  let target
  try {
    source = await fileSystem.open(
      input.sourcePath,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0),
    )
    const sourceStat = await source.stat()
    if (!sourceStat.isFile() || sourceStat.nlink !== 1
      || sourceStat.size < 1 || sourceStat.size > MAX_ATTACHMENT_BYTES) {
      const error = new Error('Archive correction attachment source is not a pinned regular file.')
      error.code = 'ARCHIVE_REHYDRATE_ATTACHMENT_INVALID'
      throw error
    }
    target = await fileSystem.open(
      input.temporaryPath,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL
        | (fs.constants.O_NOFOLLOW ?? 0),
      0o600,
    )
    const hash = createHash('sha256')
    const chunk = Buffer.allocUnsafe(64 * 1024)
    let sizeBytes = 0
    while (sizeBytes < sourceStat.size) {
      const result = await source.read(
        chunk,
        0,
        Math.min(chunk.length, sourceStat.size - sizeBytes),
        sizeBytes,
      )
      if (result.bytesRead < 1) {
        const error = new Error('Archive correction attachment ended before its pinned size.')
        error.code = 'ARCHIVE_REHYDRATE_ATTACHMENT_INVALID'
        throw error
      }
      hash.update(chunk.subarray(0, result.bytesRead))
      await writeFully(target, chunk, result.bytesRead)
      sizeBytes += result.bytesRead
    }
    const proof = { sizeBytes, sha256: hash.digest('hex') }
    if (proof.sizeBytes !== input.expected.sizeBytes || proof.sha256 !== input.expected.sha256) {
      const error = new Error('Archive correction attachment digest does not match its authenticated archive proof.')
      error.code = 'ARCHIVE_REHYDRATE_ATTACHMENT_INVALID'
      throw error
    }
    await target.sync()
    return Object.freeze(proof)
  } finally {
    await target?.close().catch(() => undefined)
    await source?.close().catch(() => undefined)
  }
}

/** Writes one source chunk completely, handling legal short writes explicitly. */
async function writeFully(target, buffer, length) {
  let offset = 0
  while (offset < length) {
    const result = await target.write(buffer, offset, length - offset)
    if (!Number.isSafeInteger(result.bytesWritten) || result.bytesWritten < 1
      || result.bytesWritten > length - offset) {
      const error = new Error('Archive correction attachment destination write was incomplete.')
      error.code = 'ARCHIVE_REHYDRATE_ATTACHMENT_INVALID'
      throw error
    }
    offset += result.bytesWritten
  }
}

module.exports = { copyVerifiedAttachment }
