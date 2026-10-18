/**
 * Quit-during-finalize assessment [DON-332].
 *
 * An operator who quits while a mission is being finalized must find it either
 * finalized (shutdown let the archive finish) or still finished and retryable,
 * with no false `mission_archive_failed` audit, no archive-custody recovery
 * flag, an intact backup mirror and no backup temporary files. A partly
 * written archive may stay staged until the next start; after the retry,
 * nothing may remain staged or fenced. State is read from the profile on disk
 * while the app is stopped.
 */

import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'

import Database from 'better-sqlite3'

import { withStore } from './store.mjs'

const BACKUP_FILE = 'mission-store.backup.sqlite'
const ARCHIVE_DIRECTORY = 'archives'
const STAGING_DIRECTORY = '.staging'

/**
 * @typedef {Object} FinalizeQuitState
 * @property {string} status mission status
 * @property {boolean} fencePresent a finalization fence row exists for the mission
 * @property {{error: string}[]} archiveFailedEvents the mission's `mission_archive_failed` audits
 * @property {string | null} custodyRecoveryFailure the store's archive-custody recovery flag
 * @property {{status: string, fileExists: boolean}[]} archives the mission's archive rows
 * @property {string} backupIntegrity `ok`, `missing`, or the integrity/open failure
 * @property {string[]} backupTemporaryFiles backup copy temporaries in the profile
 * @property {string[]} stagingFiles files under `archives/.staging`, relative to it
 */

/**
 * Reads the finalize outcome of the newest mission named `missionName`.
 *
 * @param {string} profile
 * @param {string} missionName
 * @returns {FinalizeQuitState}
 */
export function readFinalizeQuitState(profile, missionName) {
  const archiveRoot = path.join(profile, ARCHIVE_DIRECTORY)
  const store = withStore(profile, (db) => {
    const mission = db.prepare('SELECT id, status FROM missions WHERE name = ? ORDER BY rowid DESC LIMIT 1')
      .get(missionName)
    if (mission === undefined) throw new Error(`Mission "${missionName}" is not in the store.`)
    return {
      status: mission.status,
      fencePresent: db.prepare('SELECT 1 FROM mission_finalization_fences WHERE mission_id = ?').get(mission.id) !== undefined,
      archiveFailedEvents: db.prepare(`SELECT details_json FROM mission_events
        WHERE mission_id = ? AND event_type = 'mission_archive_failed' ORDER BY rowid`).all(mission.id)
        .map((row) => ({ error: failureText(row.details_json) })),
      custodyRecoveryFailure: db.prepare("SELECT value FROM metadata WHERE key = 'archive_custody_recovery_failure'")
        .get()?.value ?? null,
      archives: db.prepare('SELECT relative_path, status FROM mission_archives WHERE mission_id = ? ORDER BY rowid')
        .all(mission.id)
        .map((row) => ({ status: row.status, fileExists: existsSync(path.join(archiveRoot, row.relative_path)) })),
    }
  })
  return {
    ...store,
    backupIntegrity: backupIntegrity(path.join(profile, BACKUP_FILE)),
    backupTemporaryFiles: readdirSync(profile).filter((name) => name.startsWith(`${BACKUP_FILE}.tmp-`)).sort(),
    stagingFiles: filesUnder(path.join(archiveRoot, STAGING_DIRECTORY)),
  }
}

/**
 * Lists what is wrong with a finalize outcome. `after-quit` is the state the
 * graceful quit left; `after-retry` is the state once the operator relaunched
 * and finalized again (or found it already finalized).
 *
 * @param {FinalizeQuitState} state
 * @param {'after-quit' | 'after-retry'} phase
 * @returns {string[]}
 */
export function finalizeQuitFindings(state, phase) {
  const findings = []
  if (phase === 'after-retry' && state.status !== 'finalized') {
    findings.push(`the mission is "${state.status}", not finalized after the retry`)
  } else if (state.status !== 'finished' && state.status !== 'finalized') {
    findings.push(`the mission is in status "${state.status}"; a quit during finalize must leave it finished or finalized`)
  }
  if (state.status === 'finalized' && !state.archives.some((archive) => archive.fileExists)) {
    findings.push('the mission is finalized but its archive file is missing')
  }
  if (state.archiveFailedEvents.length > 0) {
    findings.push(`${state.archiveFailedEvents.length} mission_archive_failed audit(s) recorded for an operator quit: `
      + state.archiveFailedEvents.map((event) => `"${event.error}"`).join(', '))
  }
  if (state.custodyRecoveryFailure !== null) {
    findings.push(`the store requires archive custody recovery (${state.custodyRecoveryFailure})`)
  }
  if (state.backupIntegrity === 'missing') findings.push('the backup mirror is missing')
  else if (state.backupIntegrity !== 'ok') findings.push(`the backup mirror failed its integrity check: ${state.backupIntegrity}`)
  if (state.backupTemporaryFiles.length > 0) {
    findings.push(`backup temporary files were left behind: ${state.backupTemporaryFiles.join(', ')}`)
  }
  if (phase === 'after-retry') {
    if (state.fencePresent) findings.push('a finalization fence remains after the retry finalized the mission')
    if (state.stagingFiles.length > 0) {
      findings.push(`archive staging files remain after the retry: ${state.stagingFiles.join(', ')}`)
    }
  }
  return findings
}

/** The failure text an archive-failed audit carries (direct archives use `error`, custody `error_code`). */
function failureText(detailsJson) {
  const details = JSON.parse(detailsJson ?? '{}')
  return String(details.error ?? details.error_code ?? 'no error recorded')
}

/** Runs SQLite's integrity check on the mirror without modifying it. */
function backupIntegrity(file) {
  if (!existsSync(file)) return 'missing'
  let db
  try {
    db = new Database(file, { readonly: true, fileMustExist: true })
    return String(db.pragma('integrity_check', { simple: true }))
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  } finally {
    db?.close()
  }
}

/** Lists regular files under `root`, relative to it; none when it is absent. */
function filesUnder(root) {
  if (!existsSync(root)) return []
  return readdirSync(root, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(root, path.join(entry.parentPath ?? entry.path, entry.name)))
    .sort()
}
