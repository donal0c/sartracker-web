import { createRequire } from 'node:module'

import { describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const { checkpointLegacyEvidenceWal } = require(
  '../../electron/legacy-evidence-backfill-checkpoint.cjs',
) as {
  checkpointLegacyEvidenceWal(database: {
    pragma(sql: string): unknown
  }): Readonly<{ busy: number; log: number; checkpointed: number }>
}

describe('legacy evidence backfill WAL checkpoint [DON-254]', () => {
  it('uses FULL synchronous mode before requiring a fully checkpointed WAL', () => {
    const database = {
      pragma: vi.fn((sql: string) => {
        if (sql === 'wal_checkpoint(TRUNCATE)') {
          return [{ busy: 0, log: 0, checkpointed: 0 }]
        }
        return undefined
      }),
    }

    expect(checkpointLegacyEvidenceWal(database)).toEqual({ busy: 0, log: 0, checkpointed: 0 })
    expect(database.pragma.mock.calls).toEqual([
      ['synchronous = FULL'],
      ['wal_checkpoint(TRUNCATE)'],
    ])
  })

  it('fails closed when SQLite cannot fully checkpoint the WAL', () => {
    const database = {
      pragma: vi.fn((sql: string) => sql === 'wal_checkpoint(TRUNCATE)'
        ? [{ busy: 1, log: 12, checkpointed: 0 }]
        : undefined),
    }

    expect(() => checkpointLegacyEvidenceWal(database)).toThrow(/checkpoint.*busy|incomplete/iu)
  })
})
