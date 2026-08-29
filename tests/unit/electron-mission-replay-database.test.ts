import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3') as new (path: string) => {
  close(): void
  exec(sql: string): void
}
const { openMissionReplayDatabase } = require('../../electron/mission-replay-database.cjs') as {
  readonly openMissionReplayDatabase: (databasePath: string) => {
    close(): void
    pragma(sql: string, options?: { readonly simple?: boolean }): unknown
  }
}

describe('mission replay database [DON-278]', () => {
  let root: string | null = null

  afterEach(async () => {
    if (root !== null) await rm(root, { recursive: true, force: true })
    root = null
  })

  it('opens a query-only memory-mapped reader for cold indexed replay scans', async () => {
    root = await mkdtemp(path.join(tmpdir(), 'sartracker-replay-db-'))
    const databasePath = path.join(root, 'mission.sqlite')
    const writer = new Database(databasePath)
    writer.exec('CREATE TABLE evidence (id TEXT PRIMARY KEY);')
    writer.close()

    const reader = openMissionReplayDatabase(databasePath)

    expect(reader.pragma('query_only', { simple: true })).toBe(1)
    expect(Number(reader.pragma('mmap_size', { simple: true }))).toBeGreaterThanOrEqual(536_870_912)
    reader.close()
  })
})
