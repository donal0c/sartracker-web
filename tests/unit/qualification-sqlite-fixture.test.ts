// @vitest-environment node
import { mkdtemp, rm, writeFile, readFile, access } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { copyStandaloneSqliteFixture, inspectStandaloneSqliteFixture, assertStandaloneSqliteFixture } from '../../scripts/qualification/sqlite-fixture.mjs'
import { hashCandidateFile } from '../../scripts/qualification/candidate-artifacts.mjs'

describe('standalone SQLite fixture custody', () => {
  it('isolates SQLite read-only WAL side effects from retained evidence and cleans failed inspections', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'sqlite-read-custody-'))
    const Database = createRequire(import.meta.url)('better-sqlite3')
    let inspectedPath = ''
    try {
      const source = path.join(directory, 'source.sqlite')
      const writer = new Database(source)
      writer.pragma('journal_mode=WAL')
      writer.exec('CREATE TABLE evidence(value TEXT); INSERT INTO evidence VALUES (\'original\')')
      writer.close()
      const identity = await hashCandidateFile(source)
      await expect(inspectStandaloneSqliteFixture(identity, async (privatePath: string) => {
        inspectedPath = privatePath
        const reader = new Database(privatePath, { readonly: true, fileMustExist: true })
        try {
          expect(reader.prepare('SELECT value FROM evidence').get().value).toBe('original')
          await access(privatePath + '-shm')
          await assertStandaloneSqliteFixture(source)
          throw new Error('retained failed inspection')
        } finally { reader.close() }
      })).rejects.toThrow('retained failed inspection')
      expect(await hashCandidateFile(source)).toEqual(identity)
      await assertStandaloneSqliteFixture(source)
      await expect(access(path.dirname(inspectedPath))).rejects.toMatchObject({ code: 'ENOENT' })
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
  it('copies exact bound bytes and rejects every unbound SQLite sidecar', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'sqlite-custody-'))
    try {
      const source = path.join(directory, 'source.sqlite')
      await writeFile(source, 'bound database bytes')
      const identity = await hashCandidateFile(source)
      const target = path.join(directory, 'copy.sqlite')
      await copyStandaloneSqliteFixture(identity, target)
      expect(await readFile(target, 'utf8')).toBe('bound database bytes')
      await expect(copyStandaloneSqliteFixture(identity, target)).rejects.toThrow()
      for (const suffix of ['-wal', '-shm', '-journal']) {
        await writeFile(source + suffix, '')
        await expect(copyStandaloneSqliteFixture(identity, target + suffix)).rejects.toThrow(/sidecar/)
        await rm(source + suffix)
      }
      await writeFile(source, 'changed database bytes')
      await expect(copyStandaloneSqliteFixture(identity, target + '-changed')).rejects.toThrow(/identity/)
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
})
