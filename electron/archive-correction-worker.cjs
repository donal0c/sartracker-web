'use strict'

const { isMainThread, parentPort, threadId, workerData } = require('node:worker_threads')

const Database = require('better-sqlite3')
const { randomUUID } = require('node:crypto')
const { rehydrateMissionFromSnapshot } = require('./archive-rehydrate.cjs')

if (isMainThread || parentPort === null) {
  throw new Error('Archive correction worker must run outside the Electron main isolate.')
}

/** Performs one archive correction restore and its final unlock in one transaction. */
function run() {
  let database
  try {
    const cancellationFlag = new Int32Array(workerData.cancellationBuffer)
    database = new Database(workerData.databasePath)
    database.pragma('journal_mode = WAL')
    database.pragma('synchronous = FULL')
    database.pragma('foreign_keys = ON')
    rehydrateMissionFromSnapshot({
      db: database,
      snapshotPath: workerData.snapshotPath,
      missionId: workerData.missionId,
      archiveId: workerData.archiveId,
      schemaVersion: 13,
      onRestored: () => {
        if (Atomics.load(cancellationFlag, 0) !== 0) {
          const error = new Error('Archive correction restore was cancelled.')
          error.code = 'ARCHIVE_CANCELLED'
          throw error
        }
        const mission = database.prepare('SELECT status FROM missions WHERE id = ?')
          .get(workerData.missionId)
        const cleanup = database.prepare(`SELECT state FROM mission_cleanup_journal
          WHERE mission_id = ?`).get(workerData.missionId)
        const finalizedEpoch = database.prepare(`SELECT rowid FROM mission_events
          WHERE mission_id = ? AND event_type = 'mission_finalized'
          ORDER BY rowid DESC LIMIT 1`).get(workerData.missionId)?.rowid
        if (mission?.status !== 'finalized' || cleanup?.state !== 'completed'
          || Number(finalizedEpoch) !== workerData.finalizedEpoch) {
          const error = new Error('Mission finalization or archive storage changed before correction unlock could commit.')
          error.code = 'ARCHIVE_REHYDRATE_EPOCH_CHANGED'
          throw error
        }
        if (workerData.faultInjection?.afterRehydrateBeforeUnlock === true) {
          const error = new Error('Archive correction restore was interrupted before unlock.')
          error.code = 'ARCHIVE_REHYDRATE_FAILED'
          throw error
        }
        const timestamp = new Date().toISOString()
        database.prepare('UPDATE missions SET status = ? WHERE id = ?')
          .run('finished', workerData.missionId)
        database.prepare(`INSERT INTO mission_events (
          id, mission_id, event_type, timestamp, details_json, recorded_at, recording_completeness
        ) VALUES (?, ?, 'mission_unlocked', ?, ?, ?, 'complete')`).run(
          randomUUID(),
          workerData.missionId,
          timestamp,
          JSON.stringify({
            admin_name: workerData.adminName,
            reason: workerData.reason,
            restored_from_archive_id: workerData.archiveId,
            resulting_status: 'finished',
            storage_state: 'live',
          }),
          timestamp,
        )
        database.prepare(`INSERT INTO mission_replay_generations (mission_id, generation)
          VALUES (?, 1) ON CONFLICT(mission_id) DO UPDATE SET generation = generation + 1`)
          .run(workerData.missionId)
      },
    })
    parentPort.postMessage({
      type: 'complete',
      missionId: workerData.missionId,
      archiveId: workerData.archiveId,
    })
  } catch (error) {
    parentPort.postMessage({
      type: 'error',
      code: typeof error?.code === 'string' ? error.code : 'ARCHIVE_REHYDRATE_FAILED',
    })
  } finally {
    database?.close()
    parentPort.close()
  }
}

parentPort.on('message', (message) => {
  if (message?.type === 'cancel') return
})

void run()

module.exports = { threadId }
