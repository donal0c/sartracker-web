const fs = require('node:fs/promises')

const SQLITE_HEADER_BYTES = 100
const SQLITE_SIGNATURE = Buffer.from('SQLite format 3\0', 'binary')

/**
 * Performs a fixed-cost structural sanity check on a completed SQLite snapshot.
 *
 * This intentionally reads only the 100-byte database header plus O(1) file metadata.
 * It is not an integrity check and must never be expanded into a page or table scan on
 * the recurring autosave path.
 */
async function validateSqliteSnapshotSanity(filePath, label) {
  const fileHandle = await fs.open(filePath, 'r')
  try {
    const header = Buffer.alloc(SQLITE_HEADER_BYTES)
    const { bytesRead } = await fileHandle.read(
      header,
      0,
      SQLITE_HEADER_BYTES,
      0,
    )
    if (bytesRead !== SQLITE_HEADER_BYTES) {
      throw new Error(`${label} SQLite snapshot is shorter than its 100-byte header.`)
    }
    const fileStats = await fileHandle.stat()
    validateSqliteHeader(header, fileStats.size, label)
  } finally {
    await fileHandle.close()
  }
}

/** Validates constant-size SQLite header facts against constant-time file metadata. */
function validateSqliteHeader(header, fileSize, label) {
  if (!header.subarray(0, SQLITE_SIGNATURE.length).equals(SQLITE_SIGNATURE)) {
    throw new Error(`${label} SQLite header signature is invalid.`)
  }

  const encodedPageSize = header.readUInt16BE(16)
  const pageSize = encodedPageSize === 1 ? 65_536 : encodedPageSize
  if (!isValidPageSize(pageSize)) {
    throw new Error(`${label} SQLite header page size is invalid.`)
  }

  const writeVersion = header.readUInt8(18)
  const readVersion = header.readUInt8(19)
  if (![1, 2].includes(writeVersion) || ![1, 2].includes(readVersion)) {
    throw new Error(`${label} SQLite header journal format is invalid.`)
  }

  const pageCount = header.readUInt32BE(28)
  const expectedFileSize = pageCount * pageSize
  if (pageCount === 0 || !Number.isSafeInteger(expectedFileSize) || expectedFileSize !== fileSize) {
    throw new Error(`${label} SQLite header page count does not match file size.`)
  }
}

/** Returns whether a decoded SQLite page size is supported by the file format. */
function isValidPageSize(pageSize) {
  return (
    pageSize >= 512 &&
    pageSize <= 65_536 &&
    Number.isInteger(Math.log2(pageSize))
  )
}

module.exports = {
  SQLITE_HEADER_BYTES,
  validateSqliteSnapshotSanity,
}
