import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Worker } from 'node:worker_threads'

import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const WORKER_PATH = path.resolve(
  process.cwd(),
  'electron/archive-review-projection-worker.cjs',
)

type TestDatabase = {
  readonly exec: (sql: string) => void
  readonly prepare: (sql: string) => {
    readonly run: (...parameters: readonly unknown[]) => unknown
  }
  readonly close: () => void
}

const Database = require('better-sqlite3') as new (path: string) => TestDatabase
const fixtureRoots = new Set<string>()

afterEach(async () => {
  await Promise.all([...fixtureRoots].map((root) => rm(root, { recursive: true, force: true })))
  fixtureRoots.clear()
})

describe('archive review projection worker output containment [DON-252 / BCP-15]', () => {
  it('rejects a result whose serialized JSON exceeds 8 MiB before posting it to the parent', async () => {
    const fixture = await createDatabaseFixture()
    const database = new Database(fixture.databasePath)
    const escapedPayload = '\u0000'.repeat(1_500_000)
    try {
      database.exec(`CREATE TABLE markers (
        id TEXT PRIMARY KEY,
        mission_id TEXT NOT NULL,
        retired_at TEXT,
        display_order INTEGER NOT NULL,
        name TEXT NOT NULL,
        payload TEXT NOT NULL
      )`)
      database.prepare(`INSERT INTO markers (
        id, mission_id, retired_at, display_order, name, payload
      ) VALUES (?, ?, NULL, 0, ?, ?)`).run(
        'marker-oversized',
        'mission-archive',
        'Oversized marker',
        escapedPayload,
      )
    } finally {
      database.close()
    }
    expect(Buffer.byteLength(JSON.stringify([{ payload: escapedPayload }]), 'utf8'))
      .toBeGreaterThan(8 * 1024 * 1024)

    const terminal = await runProjectionWorker({
      databasePath: fixture.databasePath,
      method: 'listMarkers',
      missionId: 'mission-archive',
    })

    expect(terminal.messages).toHaveLength(1)
    expect(terminal.messages[0]?.type).toBe('error')
    expect(terminal.messages[0]?.method).toBe('listMarkers')
    expect(Object.prototype.hasOwnProperty.call(terminal.messages[0], 'result')).toBe(false)
    expect(terminal.exitCode).toBe(0)
  })

  it('rejects a method-specific row overflow before posting it to the parent', async () => {
    const fixture = await createDatabaseFixture()
    const database = new Database(fixture.databasePath)
    try {
      database.exec(`CREATE TABLE missions (
        id TEXT NOT NULL,
        name TEXT NOT NULL,
        start_time TEXT NOT NULL
      )`)
      const insert = database.prepare(
        'INSERT INTO missions (id, name, start_time) VALUES (?, ?, ?)',
      )
      insert.run('mission-archive', 'First duplicate', '2026-08-30T08:00:00.000Z')
      insert.run('mission-archive', 'Second duplicate', '2026-08-30T09:00:00.000Z')
    } finally {
      database.close()
    }

    const terminal = await runProjectionWorker({
      databasePath: fixture.databasePath,
      method: 'listMissions',
      missionId: 'mission-archive',
    })

    expect(terminal.messages).toHaveLength(1)
    expect(terminal.messages[0]?.type).toBe('error')
    expect(terminal.messages[0]?.method).toBe('listMissions')
    expect(Object.prototype.hasOwnProperty.call(terminal.messages[0], 'result')).toBe(false)
    expect(terminal.exitCode).toBe(0)
  })
})

async function createDatabaseFixture(): Promise<{
  readonly databasePath: string
}> {
  const root = await mkdtemp(path.join(tmpdir(), 'archive-review-projection-worker-'))
  fixtureRoots.add(root)
  return { databasePath: path.join(root, 'mission-store.sqlite') }
}

async function runProjectionWorker(
  workerData: Readonly<Record<string, unknown>>,
): Promise<{
  readonly messages: readonly Readonly<Record<string, unknown>>[]
  readonly exitCode: number
}> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_PATH, { workerData })
    const messages: Readonly<Record<string, unknown>>[] = []
    worker.on('message', (message: Readonly<Record<string, unknown>>) => messages.push(message))
    worker.once('error', reject)
    worker.once('exit', (exitCode) => resolve({ messages, exitCode }))
  })
}
