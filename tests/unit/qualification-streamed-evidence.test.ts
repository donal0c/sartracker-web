// @vitest-environment node
import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { expect, it, vi } from 'vitest'

vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>()
  return { ...actual, readFile: async (...args: Parameters<typeof actual.readFile>) => {
    if (String(args[0]).endsWith('large-evidence.bin')) throw new Error('Whole-file reads exceed the evidence memory budget.')
    return actual.readFile(...args)
  } }
})
import { fileIdentity } from '../../scripts/qualification/control-plane.mjs'

it('hashes retained evidence through bounded streaming rather than a whole-file buffer', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'streamed-evidence-'))
  try {
    const bytes = Buffer.alloc(131072, 42)
    const filename = path.join(directory, 'large-evidence.bin')
    await writeFile(filename, bytes)
    expect(await fileIdentity(filename)).toMatchObject({ bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex') })
  } finally { await rm(directory, { recursive: true, force: true }) }
})
