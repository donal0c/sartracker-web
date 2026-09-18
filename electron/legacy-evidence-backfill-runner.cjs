const fs = require('node:fs')
const path = require('node:path')
const { Worker } = require('./mission-worker.cjs')
const {
  validateLegacyEvidenceBackfillCheckpoint,
} = require('./legacy-evidence-backfill-checkpoint.cjs')

const DEFAULT_WORKER_PATH = path.join(__dirname, 'legacy-evidence-backfill-worker.cjs')

/** Starts one restartable legacy-evidence reconstruction worker outside Electron main. */
function startLegacyEvidenceBackfillWorker(input) {
  const workerOptions = {
    workerData: {
      databasePath: input.databasePath,
      eventPending: input.eventPending === true,
      objectPending: input.objectPending === true,
      gpxPending: input.gpxPending === true,
    },
  }
  const worker = input.createWorker?.(workerOptions)
    ?? new Worker(input.workerPath ?? DEFAULT_WORKER_PATH, workerOptions)
  let completedMessage = null
  let workerFailure = null
  let exitObserved = false
  let stopRequested = false
  let settled = false
  let resolveWorkerExit
  const workerExited = new Promise((resolve) => { resolveWorkerExit = resolve })
  const completion = new Promise((resolve, reject) => {
    worker.on('message', (message) => {
      if (settled) return
      if (message?.type === 'complete'
        && Number.isInteger(message.workerThreadId)) {
        try {
          const walSidecarBytes = readWalSidecarBytes(input.databasePath)
          const validationError = validateLegacyEvidenceBackfillCheckpoint(
            message.checkpoint,
            walSidecarBytes,
          )
          if (validationError === null) {
            completedMessage = {
              workerThreadId: message.workerThreadId,
              checkpoint: { ...message.checkpoint, walSidecarBytes },
            }
          } else {
            workerFailure = new Error(
              `Legacy evidence reconstruction worker reported an invalid checkpoint receipt: ${safeMessage(validationError)}`,
            )
          }
        } catch (error) {
          workerFailure = new Error(
            `Legacy evidence reconstruction worker could not validate its checkpoint receipt: ${safeMessage(error?.message ?? error)}`,
          )
        }
        return
      }
      if (message?.type === 'error') {
        workerFailure = new Error(
          `Legacy evidence reconstruction worker failed: ${safeMessage(message.message)}`,
        )
      }
    })
    worker.once('error', (error) => {
      workerFailure = new Error(
        `Legacy evidence reconstruction worker failed: ${safeMessage(error.message)}`,
      )
    })
    worker.once('exit', (exitCode) => {
      exitObserved = true
      resolveWorkerExit()
      if (settled) return
      settled = true
      if (stopRequested) {
        resolve({ stopped: true })
      } else if (workerFailure !== null) {
        reject(workerFailure)
      } else if (exitCode === 0 && completedMessage !== null) {
        resolve(completedMessage)
      } else if (exitCode === 0) {
        reject(new Error(
          'Legacy evidence reconstruction worker exited without a valid completion message.',
        ))
      } else {
        reject(new Error(`Legacy evidence reconstruction worker exited with code ${exitCode}.`))
      }
    })
  })
  return {
    completion,
    terminate: async () => {
      if (exitObserved) return
      stopRequested = true
      await worker.terminate()
      await workerExited
    },
  }
}

/** Bounds arbitrary worker text before it reaches the runtime log. */
function safeMessage(value) {
  return String(value ?? 'unknown error').replace(/[\r\n]+/gu, ' ').trim().slice(0, 500)
}

/** Reads the SQLite WAL sidecar without exposing the database path in errors. */
function readWalSidecarBytes(databasePath) {
  try {
    const stats = fs.statSync(`${databasePath}-wal`)
    if (!stats.isFile() || !Number.isSafeInteger(stats.size) || stats.size < 0) {
      throw new Error('WAL sidecar is not a regular file.')
    }
    return stats.size
  } catch (error) {
    if (error?.code === 'ENOENT') return 0
    throw new Error('WAL sidecar could not be observed.')
  }
}

module.exports = { startLegacyEvidenceBackfillWorker }
