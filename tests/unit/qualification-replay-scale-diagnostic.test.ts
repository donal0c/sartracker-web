import { createRequire } from 'node:module'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'

const launch = vi.hoisted(() => vi.fn())
vi.mock('playwright', () => ({ _electron: { launch } }))
import { runReplayScaleProbe } from '../../scripts/qualification/replay-scale-probe.mjs'

const Database = createRequire(import.meta.url)('better-sqlite3')

describe('replay diagnostic failure custody', () => {
  it.each([false, true])('retains only the failed guard after stream drain, including close failure=%s', async closeFails => {
    const root = await mkdtemp(path.join(tmpdir(), 'replay-diagnostic-'))
    const fixturePath = path.join(root, 'fixture.sqlite')
    const evidencePath = path.join(root, 'evidence')
    const appPath = path.join(root, 'app')
    const db = new Database(fixturePath)
    db.exec(`CREATE TABLE missions(id TEXT,start_time TEXT);
      CREATE TABLE positions(id TEXT,mission_id TEXT,timestamp_source TEXT,timestamp TEXT,received_at TEXT,timestamp_provenance_recorded_at TEXT);
      CREATE TABLE devices(mission_id TEXT);
      CREATE TABLE gpx_evidence_points(id TEXT);
      INSERT INTO missions VALUES('synthetic','2026-01-01T00:00:00Z');
      INSERT INTO positions VALUES('synthetic-fix','synthetic','fix','2026-01-01T01:00:00Z','2026-01-01T01:00:00Z',NULL);`)
    db.close()
    await writeFile(appPath, 'synthetic executable')
    const stderr = new PassThrough()
    const guard = { guard: 'generation', expected: 1, observed: 2 }
    const failure = 'Mission replay evidence changed while paging. Re-seek the selected time.'
    launch.mockResolvedValue({
      process: () => ({ stderr }),
      evaluate: async () => ({ executable: appPath, app: appPath, profile: path.join(evidencePath, '.profile-replay-scale') }),
      firstWindow: async () => ({
        getByTestId: () => ({ waitFor: async () => undefined }),
        evaluate: async () => { throw new Error(failure) },
      }),
      close: async () => {
        setTimeout(() => {
          stderr.write('private unrelated stderr\n')
          stderr.end(`sartracker-replay-paging-guard=${JSON.stringify(guard)}\n`)
        }, 0)
        if (closeFails) throw new Error('synthetic close failure')
      },
    })
    try {
      await expect(runReplayScaleProbe({ appPath, evidencePath, fixturePath, variantId: 'replay-960k', developmentTestHarness: true })).rejects.toThrow(closeFails ? 'synthetic close failure' : failure)
      const report = JSON.parse(await readFile(path.join(evidencePath, 'replay-scale-report.json'), 'utf8'))
      expect(report.failure).toBe(failure)
      expect(report.pagingDiagnostic).toEqual(guard)
      expect(report.cleanup.profileRemoved).toBe(true)
      expect(JSON.stringify(report)).not.toContain('private unrelated stderr')
      expect(launch.mock.lastCall?.[0].env.SARTRACKER_REPLAY_PAGING_DIAGNOSTICS).toBe('1')
      expect(stderr.listenerCount('data')).toBe(0)
    } finally { stderr.destroy(); await rm(root, { recursive: true, force: true }); launch.mockReset() }
  })
})
