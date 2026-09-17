import { createRequire } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3') as new (filename: string) => {
  close(): void
  exec(sql: string): void
  pragma(sql: string, options?: { readonly simple?: boolean }): unknown
  prepare(sql: string): { run(...params: readonly unknown[]): unknown; get(...params: readonly unknown[]): unknown }
}
const { checkpointLegacyEvidenceWal } = require(
  '../../electron/legacy-evidence-backfill-checkpoint.cjs',
) as {
  checkpointLegacyEvidenceWal(database: {
    pragma(sql: string): unknown
  }): Promise<Readonly<{ busy: number; log: number; checkpointed: number }>>
}

describe('legacy evidence backfill WAL checkpoint [DON-254]', () => {
  it('uses FULL synchronous mode before requiring a fully checkpointed WAL', async () => {
    const database = {
      pragma: vi.fn((sql: string) => {
        if (sql === 'busy_timeout') {
          return 5000
        }
        if (sql === 'wal_checkpoint(PASSIVE)') {
          return [{ busy: 0, log: 0, checkpointed: 0 }]
        }
        return undefined
      }),
    }

    await expect(checkpointLegacyEvidenceWal(database)).resolves.toEqual({ busy: 0, log: 0, checkpointed: 0 })
    expect(database.pragma.mock.calls).toEqual([
      ['busy_timeout', { simple: true }],
      ['busy_timeout = 0'],
      ['synchronous = FULL'],
      ['wal_checkpoint(PASSIVE)'],
      ['busy_timeout = 5000'],
    ])
  })

  it('retries a transient concurrent writer before completing the checkpoint', async () => {
    let attempts = 0
    const database = {
      pragma: vi.fn((sql: string) => {
        if (sql === 'busy_timeout') return 5000
        if (sql === 'wal_checkpoint(PASSIVE)') {
          attempts += 1
          return [{ busy: 0, log: attempts === 1 ? 12 : 12, checkpointed: attempts === 1 ? 10 : 12 }]
        }
        return undefined
      }),
    }

    await expect(checkpointLegacyEvidenceWal(database)).resolves.toEqual({ busy: 0, log: 12, checkpointed: 12 })
    expect(attempts).toBe(2)
  })

  it('retries the SQLite busy-lock status that has no checkpoint counters', async () => {
    let attempts = 0
    const database = {
      pragma: vi.fn((sql: string) => {
        if (sql === 'busy_timeout') return 5000
        if (sql === 'wal_checkpoint(PASSIVE)') {
          attempts += 1
          return attempts === 1
            ? [{ busy: 1, log: -1, checkpointed: -1 }]
            : [{ busy: 0, log: 12, checkpointed: 12 }]
        }
        return undefined
      }),
    }

    await expect(checkpointLegacyEvidenceWal(database)).resolves.toEqual({ busy: 0, log: 12, checkpointed: 12 })
    expect(attempts).toBe(2)
  })

  it('fails closed when SQLite cannot fully checkpoint the WAL', async () => {
    const database = {
      pragma: vi.fn((sql: string) => {
        if (sql === 'busy_timeout') return 5000
        if (sql === 'wal_checkpoint(PASSIVE)') return [{ busy: 1, log: 12, checkpointed: 0 }]
        return undefined
      }),
    }

    await expect(checkpointLegacyEvidenceWal(database)).rejects.toThrow(/checkpoint.*busy|incomplete/iu)
  })

  it('fails fast instead of waiting behind a live reader checkpoint boundary', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'sartracker-checkpoint-contention-'))
    const databasePath = path.join(directory, 'mission-store.sqlite')
    const writer = new Database(databasePath)
    const reader = new Database(databasePath)
    try {
      writer.pragma('journal_mode = WAL')
      writer.pragma('synchronous = FULL')
      writer.exec('CREATE TABLE evidence (id INTEGER PRIMARY KEY, value TEXT NOT NULL)')
      reader.pragma('journal_mode = WAL')
      writer.prepare('INSERT INTO evidence (value) VALUES (?)').run('before-reader')
      reader.exec('BEGIN')
      reader.prepare('SELECT * FROM evidence').get()
      for (let index = 0; index < 1000; index += 1) {
        writer.prepare('INSERT INTO evidence (value) VALUES (?)').run(`row-${index}`)
      }

      const started = performance.now()
      await expect(checkpointLegacyEvidenceWal(writer)).rejects.toThrow(/checkpoint.*busy|incomplete/iu)
      expect(performance.now() - started).toBeLessThan(200)
    } finally {
      reader.exec('ROLLBACK')
      reader.close()
      writer.close()
      await rm(directory, { recursive: true, force: true })
    }
  })
})
