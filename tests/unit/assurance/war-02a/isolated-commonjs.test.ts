// @vitest-environment node
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadIsolatedCommonJs } from './isolated-commonjs'

describe('WAR-02A test-only module isolation', () => {
  it('inserts replacement metacharacters literally', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'war02a-literal-'))
    try {
      const file = path.join(root, 'fixture.cjs')
      await writeFile(file, 'module.exports = "anchor"')
      const value = "$$ $& $` $'"
      expect(loadIsolatedCommonJs(file, {}, { from: '"anchor"', to: JSON.stringify(value) })).toBe(value)
    } finally { await rm(root, { recursive: true, force: true }) }
  })
  it('keeps dependencies local, leaves cached original unchanged and rejects ambiguous mutations', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'war02a-loader-'))
    const file = path.join(root, 'fixture.cjs')
    const require = createRequire(import.meta.url)
    try {
      await writeFile(file, "module.exports = { value: require('node:path').sep }")
      const original = require(file) as { value: string }
      const isolated = loadIsolatedCommonJs<{ value: string }>(file, { 'node:path': { sep: 'isolated' } })
      expect(isolated.value).toBe('isolated')
      expect(require(file)).toBe(original)
      expect(original.value).toBe(path.sep)
      expect(() => loadIsolatedCommonJs(file, {}, { from: 'missing', to: 'wrong' })).toThrow(/exactly one/)
      expect(() => loadIsolatedCommonJs(file, {}, { from: 'e', to: 'wrong' })).toThrow(/exactly one/)
    } finally {
      delete require.cache[file]
      await rm(root, { recursive: true, force: true })
    }
  })
})
