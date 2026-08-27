import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')
const { runCoverageQueryInWorker } = require(
  '../../electron/coverage-query-runner.cjs',
) as {
  readonly runCoverageQueryInWorker: (input: {
    readonly databasePath: string
    readonly query: Readonly<Record<string, unknown>>
    readonly signal?: AbortSignal
    readonly workerPath?: string
    readonly timeoutMs?: number
    readonly resultLimits?: Readonly<Record<string, number>>
  }) => Promise<Record<string, unknown>> & { readonly workerExited?: Promise<void> }
}

let directory: string | undefined

afterEach(async () => {
  if (directory !== undefined) await rm(directory, { recursive: true, force: true })
  directory = undefined
})

describe('coverage query worker', () => {
  it('rejects duplicate claim keys before creating or cloning worker data', async () => {
    const key = { device_id: 'device-1', period_kind: 'unassigned', period_id: '' }

    await expect(Promise.resolve().then(() => runCoverageQueryInWorker({
      databasePath: '/unused.sqlite',
      query: { kind: 'claim', missionId: 'mission-1', selectedKeys: [key, key] },
    }))).rejects.toThrow(/duplicate.*coverage.*key/i)
  })

  it('rejects chunk-stale only when the requested logical chunk revision moved', async () => {
    const databasePath = await createCoverageDatabase()
    const key = { device_id: 'device-1', period_kind: 'unassigned', period_id: '' }

    await expect(runCoverageQueryInWorker({
      databasePath,
      query: { kind: 'chunk-page', missionId: 'mission-1', key, expectedContentRev: 1 },
    })).resolves.toMatchObject({ contentRev: 1 })
    await expect(runCoverageQueryInWorker({
      databasePath,
      query: { kind: 'chunk-summary', missionId: 'mission-1', key, expectedContentRev: 1 },
    })).resolves.toMatchObject({
      contentRev: 1,
      fix_count: 1,
      fix_digest: expect.stringMatching(/^[a-f0-9]{64}$/u),
    })

    const database = new Database(databasePath)
    database.prepare(`UPDATE coverage_chunks SET content_rev = 3
      WHERE mission_id = ? AND device_id = ? AND period_kind = 'outing'`)
      .run('mission-1', 'device-1')
    database.close()
    await expect(runCoverageQueryInWorker({
      databasePath,
      query: { kind: 'chunk-page', missionId: 'mission-1', key, expectedContentRev: 1 },
    })).resolves.toMatchObject({ contentRev: 1 })

    const movedDatabase = new Database(databasePath)
    movedDatabase.prepare(`UPDATE coverage_chunks SET content_rev = 2
      WHERE mission_id = ? AND device_id = ? AND period_kind = 'unassigned'`)
      .run('mission-1', 'device-1')
    movedDatabase.close()
    await expect(runCoverageQueryInWorker({
      databasePath,
      query: { kind: 'chunk-page', missionId: 'mission-1', key, expectedContentRev: 1 },
    })).rejects.toMatchObject({ code: 'chunk-stale' })
  })

  it('aborts and physically terminates obsolete work', async () => {
    const controller = new AbortController()
    const query = runCoverageQueryInWorker({
      databasePath: '/unused.sqlite',
      query: { kind: 'manifest', missionId: 'mission-1' },
      signal: controller.signal,
      workerPath: path.resolve('tests/fixtures/slow-mission-review-read-query-worker.cjs'),
    })
    controller.abort()

    await expect(query).rejects.toMatchObject({ name: 'AbortError' })
    await expect(query.workerExited).resolves.toBeUndefined()
  })

  it('times out and terminates a stuck worker', async () => {
    const query = runCoverageQueryInWorker({
      databasePath: '/unused.sqlite',
      query: { kind: 'manifest', missionId: 'mission-1' },
      workerPath: path.resolve('tests/fixtures/slow-mission-review-read-query-worker.cjs'),
      timeoutMs: 10,
    })

    await expect(query).rejects.toThrow(/coverage query worker timed out/iu)
    await expect(query.workerExited).resolves.toBeUndefined()
  })

  it('rejects an invalidation result whose identity does not match the request', async () => {
    await expect(runCoverageQueryInWorker({
      databasePath: '/unused.sqlite',
      query: { kind: 'invalidation-analysis', invalidationId: 'invalidation-1' },
      workerPath: path.resolve(
        'tests/fixtures/invalid-coverage-invalidation-result-worker.cjs',
      ),
    })).rejects.toThrow(/coverage invalidation result.*identity/iu)
  })

  it('rejects an invalidation result that omits its bounded key list', async () => {
    await expect(runCoverageQueryInWorker({
      databasePath: '/unused.sqlite',
      query: { kind: 'invalidation-analysis', invalidationId: 'missing-keys' },
      workerPath: path.resolve(
        'tests/fixtures/invalid-coverage-invalidation-result-worker.cjs',
      ),
    })).rejects.toThrow(/coverage invalidation result key list/iu)
  })

  it('rejects omitted and request-divergent results for every coverage query kind', async () => {
    const workerPath = path.resolve(
      'tests/fixtures/invalid-coverage-query-result-worker.cjs',
    )
    const key = { device_id: 'device-1', period_kind: 'unassigned', period_id: '' }

    await expect(runCoverageQueryInWorker({
      databasePath: '/unused.sqlite',
      query: { kind: 'enumerate', missionId: 'mission-1' },
      workerPath,
    })).rejects.toThrow(/coverage enumeration result/iu)
    await expect(runCoverageQueryInWorker({
      databasePath: '/unused.sqlite',
      query: { kind: 'manifest', missionId: 'mission-1' },
      workerPath,
    })).rejects.toThrow(/coverage manifest result/iu)
    await expect(runCoverageQueryInWorker({
      databasePath: '/unused.sqlite',
      query: { kind: 'claim', missionId: 'mission-1', selectedKeys: [key] },
      workerPath,
    })).rejects.toThrow(/coverage claim result/iu)
    await expect(runCoverageQueryInWorker({
      databasePath: '/unused.sqlite',
      query: { kind: 'chunk-page', missionId: 'mission-1', key, expectedContentRev: 7 },
      workerPath,
    })).rejects.toThrow(/coverage chunk page result/iu)
    await expect(runCoverageQueryInWorker({
      databasePath: '/unused.sqlite',
      query: { kind: 'chunk-summary', missionId: 'mission-1', key, expectedContentRev: 7 },
      workerPath,
    })).rejects.toThrow(/coverage chunk summary result/iu)
  })

  it('applies request-derived cardinality limits in the first worker normalizer', async () => {
    await expect(runCoverageQueryInWorker({
      databasePath: '/unused.sqlite',
      query: { kind: 'manifest', missionId: 'mission-1' },
      workerPath: path.resolve(
        'tests/fixtures/oversized-coverage-query-result-worker.cjs',
      ),
      resultLimits: { maxOutings: 0, maxChunks: 0 },
    })).rejects.toThrow(/coverage manifest result.*item list/iu)
  })
})

async function createCoverageDatabase(): Promise<string> {
  directory = await mkdtemp(path.join(tmpdir(), 'sartracker-coverage-worker-'))
  const databasePath = path.join(directory, 'mission-store.sqlite')
  const database = new Database(databasePath)
  database.exec(`
    CREATE TABLE outings (id TEXT PRIMARY KEY, mission_id TEXT, started_at TEXT, ended_at TEXT);
    CREATE TABLE positions (
      id TEXT PRIMARY KEY, mission_id TEXT, device_id TEXT, source_position_id TEXT,
      timestamp TEXT, lat REAL, lon REAL, timestamp_source TEXT DEFAULT 'fix'
    );
    CREATE INDEX idx_positions_mission_device_timestamp
      ON positions(mission_id, device_id, timestamp);
    CREATE TABLE coverage_chunks (
      mission_id TEXT, device_id TEXT, period_kind TEXT, period_id TEXT,
      content_rev INTEGER, built_rev INTEGER,
      PRIMARY KEY (mission_id, device_id, period_kind, period_id)
    );
    INSERT INTO outings VALUES
      ('outing-1', 'mission-1', '2026-08-24T10:00:00.000Z', '2026-08-24T11:00:00.000Z');
    INSERT INTO positions (
      id, mission_id, device_id, source_position_id, timestamp, lat, lon
    ) VALUES
      ('position-1', 'mission-1', 'device-1', 'source-1', '2026-08-24T12:00:00.000Z', 52, -9.7);
    INSERT INTO coverage_chunks VALUES
      ('mission-1', 'device-1', 'unassigned', '', 1, 1),
      ('mission-1', 'device-1', 'outing', 'outing-1', 1, 1);
  `)
  database.close()
  return databasePath
}
