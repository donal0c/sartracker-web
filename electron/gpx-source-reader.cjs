const fs = require('node:fs/promises')

const MAX_GPX_SOURCE_BYTES = 8 * 1024 * 1024

/** Reads exact GPX bytes into one fixed ceiling buffer and rejects the first excess byte. */
async function readBoundedGpxSource(sourcePath) {
  const handle = await fs.open(sourcePath, 'r')
  try {
    const stat = await handle.stat()
    if (!stat.isFile()) throw new Error('GPX source path is not a file.')
    if (stat.size > MAX_GPX_SOURCE_BYTES) throw createSizeError()
    const buffer = Buffer.allocUnsafe(MAX_GPX_SOURCE_BYTES + 1)
    let total = 0
    while (total <= MAX_GPX_SOURCE_BYTES) {
      const { bytesRead } = await handle.read(
        buffer,
        total,
        Math.min(64 * 1024, (MAX_GPX_SOURCE_BYTES + 1) - total),
        null,
      )
      if (bytesRead === 0) return buffer.subarray(0, total)
      total += bytesRead
    }
    throw createSizeError()
  } finally {
    await handle.close()
  }
}

/** Returns the stable operator-facing engineering-bound failure. */
function createSizeError() {
  return new Error('GPX source exceeds the 8 MiB evidence import safety limit. Split the source into smaller GPX files and import each file separately.')
}

module.exports = { MAX_GPX_SOURCE_BYTES, readBoundedGpxSource }
