import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'

const require = createRequire(import.meta.url)
const { copyVerifiedAttachment } = require(
  '../../electron/archive-correction-attachment-copy.cjs',
) as {
  readonly copyVerifiedAttachment: (input: Readonly<Record<string, unknown>>) => Promise<{
    readonly sizeBytes: number
    readonly sha256: string
  }>
}

/** Creates a file-handle double whose writes intentionally short-write. */
function createShortWriteFileSystem() {
  const bytes = Buffer.from('short-write proof')
  let targetOffset = 0
  const source = {
    stat: async () => ({ isFile: () => true, nlink: 1, size: bytes.length }),
    read: async (buffer: Buffer, offset: number, length: number) => {
      const count = Math.min(length, bytes.length - offset)
      bytes.copy(buffer, 0, offset, offset + count)
      return { bytesRead: count }
    },
    close: async () => undefined,
  }
  const target = {
    write: async (buffer: Buffer, offset: number, length: number) => {
      const count = Math.max(1, Math.floor(length / 2))
      targetOffset += count
      return { bytesWritten: count }
    },
    sync: async () => undefined,
    close: async () => undefined,
  }
  return {
    bytes,
    target,
    open: async (filePath: string) => filePath === '/source'
      ? source
      : target,
    targetOffset: () => targetOffset,
  }
}

describe('archive correction attachment copy', () => {
  it('loops until every destination byte is written', async () => {
    const fileSystem = createShortWriteFileSystem()
    const result = await copyVerifiedAttachment({
      sourcePath: '/source',
      temporaryPath: '/target',
      expected: {
        sizeBytes: fileSystem.bytes.length,
        sha256: createHash('sha256').update(fileSystem.bytes).digest('hex'),
      },
      fileSystem,
    })

    expect(result.sizeBytes).toBe(fileSystem.bytes.length)
    expect(fileSystem.targetOffset()).toBe(fileSystem.bytes.length)
  })
})
