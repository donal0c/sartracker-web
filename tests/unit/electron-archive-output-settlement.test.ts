import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const fs = require('node:fs') as typeof import('node:fs')
const { settleExtractedOutputs } = require('../../electron/archive-verify.cjs') as {
  settleExtractedOutputs: (input: unknown, preserve: boolean) => void
}
afterEach(() => vi.restoreAllMocks())

it.each(['ftruncateSync', 'fsyncSync'] as const)('refuses plaintext sweep proof when %s fails but closes every descriptor', (method) => {
  const directory = fs.mkdtempSync(path.join(tmpdir(), 'archive-settlement-'))
  const descriptors = ['one', 'two'].map((name) => {
    const file = path.join(directory, name)
    fs.writeFileSync(file, 'private evidence')
    return fs.openSync(file, 'r+')
  })
  const ownership = { settled: false, outputs: descriptors.map((descriptor) => ({ descriptor })) }
  const fault = vi.spyOn(fs, method).mockImplementationOnce(() => { throw new Error('injected storage failure') })
  try {
    expect(() => settleExtractedOutputs({ outputOwnership: ownership }, false))
      .toThrow(/plaintext cleanup/iu)
    for (const descriptor of descriptors) expect(() => fs.fstatSync(descriptor)).toThrow()
  } finally {
    fault.mockRestore()
    for (const descriptor of descriptors) { try { fs.closeSync(descriptor) } catch { /* Already closed. */ } }
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
