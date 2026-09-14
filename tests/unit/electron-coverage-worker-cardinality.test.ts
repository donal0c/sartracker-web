import { createRequire } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Worker } from 'node:worker_threads'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')

describe('production coverage worker snapshot bounds before transport [DON-254]', () => {
  it.each(['enumerate', 'manifest', 'invalidation-analysis', 'snapshot'])('checks %s within the worker without a parent result validator', async control => {
    const kind = control === 'snapshot' ? 'enumerate' : control
    const directory = await mkdtemp(path.join(tmpdir(), 'coverage-worker-limit-'))
    const databasePath = path.join(directory, 'metadata.sqlite')
    const db = new Database(databasePath)
    db.pragma('journal_mode = WAL')
    db.exec(`
      CREATE TABLE outings (id TEXT, mission_id TEXT, started_at TEXT);
      CREATE TABLE devices (mission_id TEXT, device_id TEXT);
      CREATE TABLE mission_participants (mission_id TEXT, kind TEXT, removed_at TEXT, traccar_device_id TEXT, mission_team_id TEXT);
      CREATE TABLE mission_group_membership_events (mission_id TEXT, mission_team_id TEXT, traccar_device_id TEXT, change TEXT, observed_at TEXT, sequence INTEGER);
      CREATE TABLE coverage_invalidations (id TEXT, mission_id TEXT, drained_at TEXT);
      INSERT INTO outings VALUES ('outing', 'mission', '2026-08-24T08:00:00.000Z');
      INSERT INTO devices VALUES ('mission', 'device');
      INSERT INTO coverage_invalidations VALUES ('invalidation', 'mission', NULL);
    `)
    db.close()
    try {
      const message = await new Promise<Record<string, unknown>>((resolve, reject) => {
        const worker = new Worker(path.resolve('tests/fixtures/coverage-query-cardinality-worker.cjs'), {
          workerData: { databasePath, control, query: { kind, missionId: 'mission', invalidationId: 'invalidation' } },
        })
        let reply: Record<string, unknown> | undefined
        worker.on('message', value => { reply = value })
        worker.once('error', reject)
        worker.once('exit', code => code === 0 && reply !== undefined ? resolve(reply) : reject(new Error(`Worker exit ${code}`)))
      })
      expect(message.type).toBe(control === 'snapshot' ? 'complete' : 'error')
      if (control !== 'snapshot') expect(message.message).toMatch(/(item|key) list is invalid/)
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
})
