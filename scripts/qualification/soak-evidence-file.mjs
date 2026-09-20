import { constants as fsConstants } from 'node:fs'
import { lstat, open } from 'node:fs/promises'

const ABSOLUTE_PATH = /^(?:\/|[A-Za-z]:[\\/])/u
const BOUNDED_READ_CHUNK_BYTES = 64 * 1024

/** Maximum retained JSON evidence size before parsing or hashing. */
export const MAX_SOAK_REPORT_BYTES = 8 * 1024 * 1024

/** Maximum retained screenshot size before hashing or copying. */
export const MAX_SOAK_CAPTURE_BYTES = 25 * 1024 * 1024

/** Compare the inode selected by path preflight with the opened descriptor. */
function sameFileIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino
}

/** Compare the opened file's identity, size and mutation timestamps. */
function sameFileSnapshot(left, right) {
  return sameFileIdentity(left, right) &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
}

/**
 * Read a regular file through one open descriptor without allowing an
 * unbounded or changing file to become retained evidence.
 *
 * The initial lstat rejects symlinks before opening. The descriptor stat then
 * binds the size check to the opened file, and each chunk is checked against
 * the same limit and original identity/size so a producer cannot swap, grow,
 * truncate, or rewrite the file after either preflight.
 */
export async function readBoundedSoakFile(filename, maximumBytes, label = 'soak evidence') {
  if (!ABSOLUTE_PATH.test(filename) || !Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
    throw new Error(`${label} requires an absolute path and a positive byte limit.`)
  }
  const initial = await lstat(filename)
  if (!initial.isFile() || initial.size > maximumBytes) {
    throw new Error(`${label} is not a regular file within the ${maximumBytes}-byte limit.`)
  }
  let handle = null
  let buffer = null
  try {
    const noFollow = fsConstants.O_NOFOLLOW ?? 0
    handle = await open(filename, fsConstants.O_RDONLY | noFollow)
    const opened = await handle.stat()
    if (!opened.isFile() || !sameFileIdentity(initial, opened) || opened.size > maximumBytes) {
      throw new Error(`${label} changed before the bounded read.`)
    }
    const openedSize = opened.size
    const chunks = []
    let total = 0
    buffer = Buffer.allocUnsafe(Math.min(BOUNDED_READ_CHUNK_BYTES, maximumBytes + 1))
    while (true) {
      const beforeChunk = await handle.stat()
      if (!beforeChunk.isFile() || !sameFileSnapshot(beforeChunk, opened) || beforeChunk.size > maximumBytes) {
        throw new Error(`${label} changed while being read.`)
      }
      if (total >= maximumBytes) {
        const probe = await handle.read(buffer, 0, 1, total)
        if (probe.bytesRead > 0) throw new Error(`${label} grew beyond the ${maximumBytes}-byte limit while being read.`)
        break
      }
      const remaining = maximumBytes - total
      const result = await handle.read(buffer, 0, Math.min(buffer.length, remaining + 1), total)
      if (result.bytesRead === 0) break
      if (result.bytesRead > remaining) {
        throw new Error(`${label} grew beyond the ${maximumBytes}-byte limit while being read.`)
      }
      chunks.push(Buffer.from(buffer.subarray(0, result.bytesRead)))
      total += result.bytesRead
      const afterChunk = await handle.stat()
      if (!afterChunk.isFile() || !sameFileSnapshot(afterChunk, opened) || afterChunk.size > maximumBytes) {
        throw new Error(`${label} changed while being read.`)
      }
    }
    const completed = await handle.stat()
    if (!completed.isFile() || !sameFileSnapshot(completed, opened) || completed.size !== openedSize || completed.size !== total) {
      throw new Error(`${label} changed while being read.`)
    }
    return Buffer.concat(chunks, total)
  } finally {
    buffer?.fill(0)
    if (handle) {
      try { await handle.close() } catch { /* preserve the read outcome */ }
    }
  }
}
