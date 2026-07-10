import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')
const { runSqliteBackupInWorker } = require('../../electron/sqlite-backup-runner.cjs') as {
  readonly runSqliteBackupInWorker: (input: {
    readonly sourcePath: string
    readonly targetPath: string
  }) => Promise<{ readonly workerThreadId: number }>
}

describe('SQLite backup worker boundary [DON-240]', () => {
  let tempDirectory: string | undefined

  afterEach(async () => {
    if (tempDirectory !== undefined) {
      await rm(tempDirectory, { recursive: true, force: true })
    }
  })

  it('copies a live WAL database on a non-main worker thread', async () => {
    tempDirectory = await mkdtemp(path.join(tmpdir(), 'sartracker-backup-worker-'))
    const sourcePath = path.join(tempDirectory, 'source.sqlite')
    const targetPath = path.join(tempDirectory, 'target.sqlite')
    const source = new Database(sourcePath)
    source.pragma('journal_mode = WAL')
    source.exec('CREATE TABLE evidence (id INTEGER PRIMARY KEY, value TEXT NOT NULL)')
    source.prepare('INSERT INTO evidence (value) VALUES (?)').run('durable-value')

    const result = await runSqliteBackupInWorker({ sourcePath, targetPath })

    expect(result.workerThreadId).toBeGreaterThan(0)
    const target = new Database(targetPath, { readonly: true, fileMustExist: true })
    expect(target.prepare('SELECT value FROM evidence').pluck().get()).toBe('durable-value')
    target.close()
    source.close()
  })

  it('rejects when the worker cannot open the source database', async () => {
    tempDirectory = await mkdtemp(path.join(tmpdir(), 'sartracker-backup-worker-error-'))

    await expect(
      runSqliteBackupInWorker({
        sourcePath: path.join(tempDirectory, 'missing.sqlite'),
        targetPath: path.join(tempDirectory, 'target.sqlite'),
      }),
    ).rejects.toThrow(/SQLite backup worker failed/)
  })
})
