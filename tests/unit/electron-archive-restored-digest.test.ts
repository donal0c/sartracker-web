import { createRequire } from 'node:module'
import { mkdtempSync, writeFileSync, statSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { digestRestoredDatabase } = require('../../electron/archive-restore.cjs') as {
  digestRestoredDatabase: (file: string, identity: { dev: number; ino: number; sizeBytes: number },
    cancellationFlag: Int32Array) => string
}

it('honours cancellation before hashing a restored database and preserves its bytes', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'archive-digest-'))
  try {
    const file = path.join(root, 'mission.sqlite')
    const bytes = Buffer.alloc(3 * 1024 * 1024, 42)
    writeFileSync(file, bytes)
    const stat = statSync(file)
    const identity = { dev: stat.dev, ino: stat.ino, sizeBytes: stat.size }
    const flag = new Int32Array(new SharedArrayBuffer(4))
    expect(digestRestoredDatabase(file, identity, flag)).toBe(createHash('sha256').update(bytes).digest('hex'))
    Atomics.store(flag, 0, 1)
    expect(() => digestRestoredDatabase(file, identity, flag)).toThrow(/cancelled/)
    expect(statSync(file).size).toBe(bytes.length)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
