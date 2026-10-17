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

  it('completes while another connection keeps writing, from one consistent snapshot [DON-313] [DON-240]', async () => {
    tempDirectory = await mkdtemp(path.join(tmpdir(), 'sartracker-backup-live-writes-'))
    const sourcePath = path.join(tempDirectory, 'source.sqlite')
    const targetPath = path.join(tempDirectory, 'target.sqlite')
    const source = new Database(sourcePath)
    source.pragma('journal_mode = WAL')
    source.exec('CREATE TABLE evidence (id INTEGER PRIMARY KEY, value TEXT NOT NULL)')
    // ~24 MB: about 6,000 pages, i.e. dozens of default 100-page backup steps.
    const insert = source.prepare('INSERT INTO evidence (value) VALUES (?)')
    source.transaction(() => {
      for (let index = 0; index < 6_000; index += 1) insert.run('x'.repeat(3_900))
    })()
    const rowsBeforeBackup = source.prepare('SELECT count(*) FROM evidence').pluck().get() as number

    // Live tracking commits every poll; a stepped online backup restarts on each foreign write.
    let writes = 0
    const writer = setInterval(() => {
      insert.run('live')
      writes += 1
    }, 5)
    let deadline: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        runSqliteBackupInWorker({ sourcePath, targetPath }),
        new Promise((_, reject) => {
          deadline = setTimeout(() => reject(new Error('Backup did not finish under live writes within 15 s.')), 15_000)
        }),
      ])
    } finally {
      clearInterval(writer)
      clearTimeout(deadline)
    }
    const rowsAfterBackup = source.prepare('SELECT count(*) FROM evidence').pluck().get() as number

    expect(writes).toBeGreaterThan(0)
    const target = new Database(targetPath, { readonly: true, fileMustExist: true })
    expect(target.pragma('integrity_check', { simple: true })).toBe('ok')
    const copied = target.prepare('SELECT count(*) FROM evidence').pluck().get() as number
    expect(copied).toBeGreaterThanOrEqual(rowsBeforeBackup)
    expect(copied).toBeLessThanOrEqual(rowsAfterBackup)
    target.close()
    source.close()
  }, 30_000)

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
