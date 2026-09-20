import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { canonicalJson } from './control-plane.mjs'
import { copyStandaloneSqliteFixture } from './sqlite-fixture.mjs'
import { hashCandidateFile } from './candidate-artifacts.mjs'

const require = createRequire(import.meta.url)
// Independently declared schema-v13 evidence inventory, not producer-supplied selectors.
export const ARCHIVE_EVIDENCE_TABLES = Object.freeze([
  'devices', 'drawings', 'gpx_evidence_points', 'gpx_evidence_rejections', 'gpx_import_aliases',
  'gpx_import_batches', 'gpx_import_failures', 'gpx_import_revisions', 'gpx_track_imports', 'helicopters',
  'ingest_anomalies', 'layer_catalog_entries', 'legacy_event_provenance_quarantine',
  'legacy_event_provenance_quarantine_missions', 'legacy_gpx_backfill_quarantine', 'markers', 'metadata',
  'mission_events', 'mission_group_membership_events', 'mission_object_versions', 'mission_participants',
  'mission_teams', 'missions', 'outings', 'position_revisions', 'positions', 'search_areas',
  'search_assignments', 'search_pass_evidence_links', 'search_passes',
])
const LIFECYCLE_EVENTS = new Set(['mission_finalize_requested', 'mission_finalized', 'mission_archive_requested',
  'mission_archive_sealed_v2', 'mission_archive_verified_v2', 'mission_archive_succeeded', 'mission_archived', 'mission_archive_available',
  'mission_archive_review_opened', 'mission_archive_review_closed', 'mission_archive_review_mutation_denied', 'mission_unlocked'])

/** Compare closed single-mission snapshots with bounded memory and no production digest implementation. */
export async function compareArchiveDatabaseSnapshots({ beforePath, afterPath, missionId, phase = 'archive-restore' }) {
  if (!['archive-restore', 'source-to-finished'].includes(phase)) throw new Error('Unknown archive custody phase.')
  const Database = require('better-sqlite3')
  const directory = await mkdtemp(path.join(os.tmpdir(), 'sartracker-archive-oracle-'))
  let before
  let after
  try {
    const source = await copyStandaloneSqliteFixture(await hashCandidateFile(beforePath), path.join(directory, 'before.sqlite'))
    const restored = await copyStandaloneSqliteFixture(await hashCandidateFile(afterPath), path.join(directory, 'after.sqlite'))
    before = new Database(source.path, { readonly: true, fileMustExist: true })
    after = new Database(restored.path, { readonly: true, fileMustExist: true })
    for (const db of [before, after]) {
      const missions = db.prepare('SELECT id,status FROM missions').all()
      const status = phase === 'source-to-finished' && db === before ? 'active' : 'finished'
      if (missions.length !== 1 || missions[0].id !== missionId || missions[0].status !== status
          || db.prepare("SELECT value FROM metadata WHERE key='schema_version'").get()?.value !== '13') throw new Error('Archive field oracle requires one finished current-schema mission.')
    }
    const tables = []
    const extraEvents = []
    const finishEvents = []
    for (const name of ARCHIVE_EVIDENCE_TABLES) {
      const columns = before.prepare(`PRAGMA table_info("${name}")`).all()
      const afterColumns = after.prepare(`PRAGMA table_info("${name}")`).all()
      if (columns.length === 0 || canonicalJson(columns) !== canonicalJson(afterColumns)) throw new Error(`Archive ${name} schema differs.`)
      const keys = columns.filter(column => column.pk > 0).sort((a, b) => a.pk - b.pk).map(column => column.name)
      if (keys.length === 0 || keys.some(key => !/^[a-z_][a-z0-9_]*$/u.test(key))) throw new Error(`Archive ${name} has no reviewed primary-key order.`)
      const where = name === 'metadata' ? " WHERE key='schema_version'" : ''
      const sql = `SELECT * FROM "${name}"${where} ORDER BY ${keys.map(key => `"${key}"`).join(',')}`
      const left = before.prepare(sql).iterate()
      const right = after.prepare(sql).iterate()
      const leftHash = createHash('sha256'); const rightHash = createHash('sha256')
      let leftRows = 0; let rightRows = 0
      try {
        let a = left.next(); let b = right.next()
        while (!a.done || !b.done) {
          if (name === 'mission_events' && !b.done && (a.done || String(b.value.id) < String(a.value.id))) {
            const event = b.value
            const allowed = phase === 'source-to-finished'
              ? ['mission_paused','mission_finished'].includes(event.event_type) && !finishEvents.some(row => row.event_type === event.event_type)
              : LIFECYCLE_EVENTS.has(event.event_type) && extraEvents.length < 64
            if (!allowed || event.mission_id !== missionId) throw new Error('Archive restore added an unreviewed lifecycle event.')
            if (phase === 'source-to-finished') {
              const status = event.event_type === 'mission_paused' ? 'paused' : 'finished'
              if (!Number.isFinite(Date.parse(event.timestamp)) || event.recorded_at !== event.timestamp
                  || event.recording_completeness !== 'complete' || canonicalJson(JSON.parse(event.details_json)) !== canonicalJson({status})) throw new Error('Archive finish lifecycle audit differs.')
              finishEvents.push(event)
            }
            extraEvents.push({ id: event.id, eventType: event.event_type, sha256: createHash('sha256').update(rowBytes(event)).digest('hex') })
            rightRows++; b = right.next(); continue
          }
          if (!a.done && !b.done && name === 'missions' && phase === 'source-to-finished') {
            const finish = finishEvents.find(row => row.event_type === 'mission_finished')
            const pause = finishEvents.find(row => row.event_type === 'mission_paused')
            const pauseSeconds = pause ? Math.floor((Date.parse(finish?.timestamp) - Date.parse(pause.timestamp)) / 1000) : 0
            if (a.value.status !== 'active' || a.value.finish_time !== null || a.value.pause_time !== null
                || b.value.status !== 'finished' || !Number.isFinite(Date.parse(b.value.finish_time))
                || Date.parse(b.value.finish_time) < Date.parse(a.value.start_time) || finish?.timestamp !== b.value.finish_time
                || !Number.isSafeInteger(pauseSeconds) || pauseSeconds < 0
                || !Number.isSafeInteger(a.value.paused_seconds) || a.value.paused_seconds < 0
                || pause && Date.parse(pause.timestamp) < Date.parse(a.value.start_time)
                || b.value.paused_seconds !== a.value.paused_seconds + pauseSeconds) throw new Error('Archive source mission finish transition differs.')
            b.value = { ...b.value, status: a.value.status, finish_time: a.value.finish_time, paused_seconds: a.value.paused_seconds }
          }
          if (a.done || b.done || rowBytes(a.value) !== rowBytes(b.value)) throw new Error(`Archive ${name} lost or changed a source row.`)
          const bytes = rowBytes(a.value)
          leftHash.update(bytes); rightHash.update(bytes)
          leftRows++; rightRows++; a = left.next(); b = right.next()
        }
      } finally { left.return(); right.return() }
      tables.push({ name, sourceRows: leftRows, restoredRows: rightRows, sourceSha256: leftHash.digest('hex'), restoredSourceSha256: rightHash.digest('hex') })
    }
    if (phase === 'source-to-finished' && !finishEvents.some(row => row.event_type === 'mission_finished')) throw new Error('Archive source finish audit is missing.')
    return { missionId, tables, extraEvents }
  } finally { if (after) after.close(); if (before) before.close(); await rm(directory, { recursive: true, force: true }) }
}

/** Canonicalize one bounded SQLite row with explicit binary-value encoding and record framing. */
function rowBytes(row) {
  const normalized = Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Buffer.isBuffer(value) ? { sqliteBlobBase64: value.toString('base64') } : value]))
  const result = canonicalJson(normalized) + '\n'
  if (Buffer.byteLength(result) > 8 * 1024 * 1024) throw new Error('Archive oracle row exceeds its bounded memory envelope.')
  return result
}
