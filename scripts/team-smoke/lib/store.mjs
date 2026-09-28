/**
 * Read-only views of a profile's mission store, so checks verify what was
 * persisted rather than only what the UI shows.
 */

import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

import Database from 'better-sqlite3'

export const STORE_FILE = 'mission-store.sqlite'

/**
 * Runs `fn` against a read-only connection to the profile's mission store.
 *
 * @template T
 * @param {string} profile
 * @param {(db: import('better-sqlite3').Database) => T} fn
 * @returns {T}
 */
export function withStore(profile, fn) {
  const db = new Database(path.join(profile, STORE_FILE), { readonly: true, fileMustExist: true })
  try {
    return fn(db)
  } finally {
    db.close()
  }
}

/**
 * Returns the stored fixes of the newest mission with the given name.
 *
 * @param {string} profile
 * @param {string} missionName
 * @returns {{sourcePositionId: number, lat: number, lon: number, time: number}[]}
 */
export function missionFixes(profile, missionName) {
  return withStore(profile, (db) => {
    const mission = db.prepare('SELECT id FROM missions WHERE name = ? ORDER BY rowid DESC LIMIT 1').get(missionName)
    if (mission === undefined) throw new Error(`Mission "${missionName}" is not in the store.`)
    return db.prepare('SELECT source_position_id, lat, lon, timestamp FROM positions WHERE mission_id = ?')
      .all(mission.id)
      .map((row) => ({
        sourcePositionId: Number(row.source_position_id),
        lat: Number(row.lat),
        lon: Number(row.lon),
        time: typeof row.timestamp === 'number' ? row.timestamp : Date.parse(row.timestamp),
      }))
  })
}

/**
 * Snapshot of the core mission truth that must survive an upgrade. Columns are
 * limited to those present in every supported schema.
 *
 * @param {string} profile
 * @returns {Record<string, string>}
 */
export function coreSnapshot(profile) {
  return withStore(profile, (db) => {
    const digest = (sql) => createHash('sha256').update(JSON.stringify(db.prepare(sql).raw().all())).digest('hex')
    return {
      // Status is compared separately: reopening an active mission after a
      // restart deliberately pauses it until the operator chooses Resume.
      missions: digest('SELECT id, name, start_time, finish_time FROM missions ORDER BY id'),
      markers: digest("SELECT id, mission_id, type, name, printf('%.9f', lat), printf('%.9f', lon) FROM markers ORDER BY id"),
      drawings: digest('SELECT id, mission_id, type, name, geometry_json FROM drawings ORDER BY id'),
      positions: digest(
        "SELECT mission_id, device_id, source_position_id, printf('%.9f', lat), printf('%.9f', lon), timestamp "
          + 'FROM positions ORDER BY mission_id, device_id, timestamp, source_position_id',
      ),
      counts: JSON.stringify(db.prepare(
        'SELECT (SELECT count(*) FROM missions), (SELECT count(*) FROM markers), (SELECT count(*) FROM positions)',
      ).raw().get()),
    }
  })
}

/**
 * Mission id → status, for reporting lifecycle transitions across a restart.
 *
 * @param {string} profile
 * @returns {Record<string, string>}
 */
export function missionStatuses(profile) {
  return withStore(profile, (db) => Object.fromEntries(
    db.prepare('SELECT id, status FROM missions ORDER BY id').raw().all(),
  ))
}

/**
 * SHA-256 of the mission store files that hold data: the database, a
 * non-empty WAL and the backup mirror. The `-shm` index and an empty WAL are
 * excluded because SQLite may create, rewrite or remove them on open without
 * changing stored data.
 *
 * @param {string} profile
 * @returns {Promise<Record<string, string>>}
 */
export async function storeFileHashes(profile) {
  const hashes = {}
  for (const entry of await readdir(profile, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.startsWith('mission-store') || entry.name.endsWith('-shm')) continue
    const bytes = await readFile(path.join(profile, entry.name))
    if (entry.name.endsWith('-wal') && bytes.length === 0) continue
    hashes[entry.name] = createHash('sha256').update(bytes).digest('hex')
  }
  return hashes
}
