// @vitest-environment node
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  finalizeQuitFindings, readFinalizeQuitState,
} from '../../scripts/team-smoke/lib/finalize-quit.mjs'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')

const MISSION = 'Quit Finalize Smoke'

type State = Parameters<typeof finalizeQuitFindings>[0]

const clean: State = {
  status: 'finished',
  fencePresent: false,
  archiveFailedEvents: [],
  custodyRecoveryFailure: null,
  archives: [],
  backupIntegrity: 'ok',
  backupTemporaryFiles: [],
  stagingFiles: [],
}

describe('quit-during-finalize findings [DON-332]', () => {
  it('accepts an interrupted finalize that left the mission finished and retryable', () => {
    expect(finalizeQuitFindings(clean, 'after-quit')).toEqual([])
    // An unfinished archive may stay staged until the next start recovers it.
    expect(finalizeQuitFindings({ ...clean, fencePresent: true, stagingFiles: ['op/a.sararch.tmp'] }, 'after-quit'))
      .toEqual([])
  })

  it('accepts a finalize that completed while shutdown drained it', () => {
    expect(finalizeQuitFindings({
      ...clean, status: 'finalized', archives: [{ status: 'verified', fileExists: true }],
    }, 'after-quit')).toEqual([])
  })

  it('reports a false archive-failure audit, custody recovery and a damaged or missing mirror', () => {
    const findings = finalizeQuitFindings({
      ...clean,
      archiveFailedEvents: [{ error: 'Mission store is shutting down; a new backup cannot start.' }],
      custodyRecoveryFailure: 'ARCHIVE_CUSTODY_RECOVERY_REQUIRED',
      backupIntegrity: 'missing',
    }, 'after-quit')
    expect(findings).toEqual([
      expect.stringContaining('mission_archive_failed'),
      expect.stringContaining('ARCHIVE_CUSTODY_RECOVERY_REQUIRED'),
      expect.stringContaining('backup mirror is missing'),
    ])
    expect(findings[0]).toContain('Mission store is shutting down')
  })

  it('reports a mission in an unexpected status and a finalized mission without its archive file', () => {
    expect(finalizeQuitFindings({ ...clean, status: 'active' }, 'after-quit'))
      .toEqual([expect.stringContaining('status "active"')])
    expect(finalizeQuitFindings({
      ...clean, status: 'finalized', archives: [{ status: 'sealed', fileExists: false }],
    }, 'after-quit')).toEqual([expect.stringContaining('archive file is missing')])
  })

  it('reports a backup temporary file left by a graceful quit', () => {
    expect(finalizeQuitFindings({ ...clean, backupTemporaryFiles: ['mission-store.backup.sqlite.tmp-1'] }, 'after-quit'))
      .toEqual([expect.stringContaining('mission-store.backup.sqlite.tmp-1')])
  })

  it('requires the retry to finalize cleanly with nothing left staged or fenced', () => {
    const finalized: State = { ...clean, status: 'finalized', archives: [{ status: 'verified', fileExists: true }] }
    expect(finalizeQuitFindings(finalized, 'after-retry')).toEqual([])
    expect(finalizeQuitFindings({ ...clean }, 'after-retry'))
      .toEqual([expect.stringContaining('not finalized after the retry')])
    expect(finalizeQuitFindings({ ...finalized, fencePresent: true, stagingFiles: ['op/a.sararch.tmp'] }, 'after-retry'))
      .toEqual([
        expect.stringContaining('finalization fence'),
        expect.stringContaining('op/a.sararch.tmp'),
      ])
  })
})

describe('reading quit-during-finalize state from a profile [DON-332]', () => {
  let profile: string | undefined

  afterEach(async () => {
    if (profile !== undefined) await rm(profile, { recursive: true, force: true })
    profile = undefined
  })

  /** Writes the minimal store columns the reader uses. */
  function seedStore(file: string, seed: (db: { exec: (sql: string) => void }) => void): void {
    const db = new Database(file)
    db.exec(`
      CREATE TABLE missions (id TEXT PRIMARY KEY, name TEXT, status TEXT);
      CREATE TABLE mission_events (id TEXT PRIMARY KEY, mission_id TEXT, event_type TEXT, details_json TEXT);
      CREATE TABLE mission_finalization_fences (mission_id TEXT PRIMARY KEY, requested_at TEXT);
      CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE mission_archives (id TEXT PRIMARY KEY, mission_id TEXT, relative_path TEXT, status TEXT);
    `)
    seed(db)
    db.close()
  }

  it('reads status, fence, audits, archives, mirror health and leftover files', async () => {
    profile = await mkdtemp(path.join(tmpdir(), 'sartracker-finalize-quit-'))
    seedStore(path.join(profile, 'mission-store.sqlite'), (db) => db.exec(`
      INSERT INTO missions VALUES ('m1', '${MISSION}', 'finalized'), ('m0', 'Other', 'finished');
      INSERT INTO mission_events VALUES ('e1', 'm1', 'mission_archive_failed', '{"error":"copy failed"}'),
        ('e2', 'm0', 'mission_archive_failed', '{"error":"other mission"}'),
        ('e3', 'm1', 'mission_finished', '{}');
      INSERT INTO mission_finalization_fences VALUES ('m1', '2026-10-18T00:00:00.000Z');
      INSERT INTO metadata VALUES ('archive_custody_recovery_failure', 'ARCHIVE_CUSTODY_RECOVERY_REQUIRED');
      INSERT INTO mission_archives VALUES ('a1', 'm1', 'm1/present.sararch', 'verified'),
        ('a2', 'm1', 'm1/absent.sararch', 'sealed');
    `))
    seedStore(path.join(profile, 'mission-store.backup.sqlite'), () => undefined)
    await writeFile(path.join(profile, 'mission-store.backup.sqlite.tmp-2c2780e7-2ec4-4684-9ab8-658ebca72bd1'), 'x')
    await mkdir(path.join(profile, 'archives', 'm1'), { recursive: true })
    await writeFile(path.join(profile, 'archives', 'm1', 'present.sararch'), 'sealed')
    await mkdir(path.join(profile, 'archives', '.staging', 'op1'), { recursive: true })
    await writeFile(path.join(profile, 'archives', '.staging', 'op1', 'a3.sararch.tmp'), 'partial')

    expect(readFinalizeQuitState(profile, MISSION)).toEqual({
      status: 'finalized',
      fencePresent: true,
      archiveFailedEvents: [{ error: 'copy failed' }],
      custodyRecoveryFailure: 'ARCHIVE_CUSTODY_RECOVERY_REQUIRED',
      archives: [{ status: 'verified', fileExists: true }, { status: 'sealed', fileExists: false }],
      backupIntegrity: 'ok',
      backupTemporaryFiles: ['mission-store.backup.sqlite.tmp-2c2780e7-2ec4-4684-9ab8-658ebca72bd1'],
      stagingFiles: [path.join('op1', 'a3.sararch.tmp')],
    })
  })

  it('reports a missing mirror and no leftovers on a clean profile', async () => {
    profile = await mkdtemp(path.join(tmpdir(), 'sartracker-finalize-quit-clean-'))
    seedStore(path.join(profile, 'mission-store.sqlite'), (db) => db.exec(`
      INSERT INTO missions VALUES ('m1', '${MISSION}', 'finished');
    `))

    expect(readFinalizeQuitState(profile, MISSION)).toEqual({ ...clean, backupIntegrity: 'missing' })
  })

  it('throws a tool error when the mission is not in the store', async () => {
    profile = await mkdtemp(path.join(tmpdir(), 'sartracker-finalize-quit-missing-'))
    seedStore(path.join(profile, 'mission-store.sqlite'), () => undefined)
    expect(() => readFinalizeQuitState(profile!, MISSION)).toThrow(/not in the store/u)
  })
})
