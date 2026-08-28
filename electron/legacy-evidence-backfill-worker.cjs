const { parentPort, threadId, workerData } = require('node:worker_threads')

const Database = require('better-sqlite3')
const {
  backfillLegacyMissionObjectVersions,
} = require('./mission-evidence-version-store.cjs')
const {
  backfillLegacyEventProvenance,
} = require('./mission-event-provenance-backfill.cjs')
const { backfillLegacyGpxRevisions } = require('./mission-store.cjs')

const BACKFILL_TURN_DELAY_MS = 4

if (parentPort === null) throw new Error('Legacy evidence backfill worker requires a parent port.')

/** Reconstructs captured legacy evidence outside Electron main using restart-safe turns. */
async function run() {
  let database
  try {
    database = new Database(workerData.databasePath)
    database.pragma('journal_mode = WAL')
    // Each turn is completely reconstructible from immutable legacy rows and
    // advances its cursor in the same transaction. NORMAL avoids making live
    // writers wait for a migration-only fsync; a lost final turn is replayed.
    database.pragma('synchronous = NORMAL')
    database.pragma('foreign_keys = ON')
    let eventPending = workerData.eventPending === true
    let objectPending = workerData.objectPending === true
    let gpxPending = workerData.gpxPending === true
    let nextKind = 'event'
    while (eventPending || objectPending || gpxPending) {
      if (eventPending && (nextKind === 'event' || (!objectPending && !gpxPending))) {
        eventPending = backfillLegacyEventProvenance(database, now()).remaining > 0
        nextKind = 'object'
      } else if (objectPending && (nextKind === 'object' || !gpxPending)) {
        objectPending = backfillLegacyMissionObjectVersions(database, now()).remaining > 0
        nextKind = 'gpx'
      } else if (gpxPending) {
        gpxPending = backfillLegacyGpxRevisions(database, now(), 1).remaining > 0
        nextKind = 'event'
      } else if (eventPending) {
        eventPending = backfillLegacyEventProvenance(database, now()).remaining > 0
        nextKind = 'object'
      }
      await new Promise((resolve) => setTimeout(resolve, BACKFILL_TURN_DELAY_MS))
    }
    database.prepare(`DELETE FROM metadata
      WHERE key = 'legacy_evidence_backfill_failure'`).run()
    parentPort.postMessage({ type: 'complete', workerThreadId: threadId })
  } catch (error) {
    const message = safeMessage(error?.message ?? error)
    try {
      database?.prepare(`INSERT INTO metadata (key, value) VALUES (
        'legacy_evidence_backfill_failure', ?
      ) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(message)
    } catch {
      // The original worker error remains the authoritative fail-closed signal.
    }
    parentPort.postMessage({ type: 'error', message })
  } finally {
    database?.close()
    parentPort.close()
  }
}

/** Returns one bounded log-safe error message. */
function safeMessage(value) {
  return String(value ?? 'unknown error').replace(/[\r\n]+/gu, ' ').trim().slice(0, 500)
}

function now() {
  return new Date().toISOString()
}

void run()
