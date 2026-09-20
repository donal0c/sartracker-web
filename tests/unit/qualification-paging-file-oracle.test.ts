// @vitest-environment node
import { createRequire } from 'node:module'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { hashCandidateFile } from '../../scripts/qualification/candidate-artifacts.mjs'
import { validatePagingFiles } from '../../scripts/qualification/paging-file-oracle.mjs'

const Database = createRequire(import.meta.url)('better-sqlite3') as typeof import('better-sqlite3')

describe('paging field-envelope admission', () => {
  it('rejects a small actual SQLite workload despite forged passing producer metadata', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'paging-source-'))
    try {
      const filename = path.join(directory, 'source.sqlite')
      const db = new Database(filename)
      db.exec(`CREATE TABLE missions(id TEXT, start_time TEXT);
        CREATE TABLE outings(id TEXT, mission_id TEXT);
        CREATE TABLE positions(id TEXT, mission_id TEXT, device_id TEXT, timestamp_source TEXT, timestamp TEXT);
        INSERT INTO missions VALUES ('m', '2026-09-19T00:00:00.000Z');
        INSERT INTO outings VALUES ('o', 'm');
        INSERT INTO positions VALUES ('p', 'm', 'd', 'fix', '2026-09-19T01:00:00.000Z');`)
      db.close()
      const rowsPath = path.join(directory, 'pages.ndjson')
      await writeFile(rowsPath, '{}\n')
      const fixture = await hashCandidateFile(filename)
      const report = { schemaVersion: 1, contractId: 'C07', fixture, missionId: 'm',
        rows: await hashCandidateFile(rowsPath), expectedCount: 960000, devices: 100, outings: 12, passed: true }
      await expect(validatePagingFiles({ report, rowsPath, fixture, contractId: 'C07', variantId: 'paging-960k' })).rejects.toThrow(/field envelope/i)
      await expect(validatePagingFiles({ report, rowsPath, fixture, contractId: 'C07', variantId: 'paging-2m-1gib' })).rejects.toThrow(/field size/i)
      await writeFile(filename + '-wal', 'unbound committed rows')
      await expect(validatePagingFiles({ report, rowsPath, fixture, contractId: 'C07', variantId: 'paging-960k' })).rejects.toThrow(/sidecar/i)
      await rm(filename + '-wal')
      await writeFile(rowsPath, 'changed\n')
      await expect(validatePagingFiles({ report, rowsPath, fixture, contractId: 'C07', variantId: 'paging-960k' })).rejects.toThrow(/raw rows changed/i)
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
})
