import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')
const { runOutingFixSummaryInWorker } = require('../../electron/outing-fix-summary-runner.cjs') as {
  readonly runOutingFixSummaryInWorker: (input: {
    readonly databasePath: string
    readonly query: { readonly missionId: string }
    readonly signal?: AbortSignal
    readonly workerPath?: string
  }) => Promise<{
    readonly outings: readonly { readonly outing_id: string; readonly accepted_fix_count: number }[]
    readonly unassigned_accepted_fix_count: number
    readonly total_accepted_fix_count: number
    readonly workerThreadId: number
  }>
}

let directory: string | undefined

afterEach(async () => {
  if (directory !== undefined) await rm(directory, { recursive: true, force: true })
  directory = undefined
})

describe('outing fix-summary worker', () => {
  it('returns only scalar counts from a read-only worker', async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'sartracker-outing-summary-'))
    const databasePath = path.join(directory, 'mission-store.sqlite')
    const database = new Database(databasePath)
    database.exec(`
      CREATE TABLE outings (id TEXT PRIMARY KEY, mission_id TEXT, started_at TEXT, ended_at TEXT);
      CREATE TABLE positions (id TEXT PRIMARY KEY, mission_id TEXT, timestamp TEXT);
      INSERT INTO outings VALUES ('outing-a', 'mission-1', '2026-08-20T09:00:00.000Z', NULL);
      INSERT INTO positions VALUES ('position-a', 'mission-1', '2026-08-20T10:00:00.000Z');
    `)
    database.close()

    await expect(runOutingFixSummaryInWorker({
      databasePath,
      query: { missionId: 'mission-1' },
    })).resolves.toMatchObject({
      outings: [{ outing_id: 'outing-a', accepted_fix_count: 1 }],
      unassigned_accepted_fix_count: 0,
      total_accepted_fix_count: 1,
      workerThreadId: expect.any(Number),
    })
  })

  it('cancels obsolete work without returning partial completeness', async () => {
    const controller = new AbortController()
    const query = runOutingFixSummaryInWorker({
      databasePath: '/unused.sqlite',
      query: { missionId: 'mission-1' },
      signal: controller.signal,
      workerPath: path.resolve('tests/fixtures/slow-mission-review-read-query-worker.cjs'),
    })
    controller.abort()
    await expect(query).rejects.toMatchObject({ name: 'AbortError' })
  })
})
