const path = require('node:path')
const { Worker } = require('./mission-worker.cjs')

const DEFAULT_WORKER_PATH = path.join(__dirname, 'sqlite-backup-worker.cjs')

/** Runs one SQLite online backup entirely outside the Electron main isolate. */
function runSqliteBackupInWorker(input) {
  return runBackupWorker(input.workerPath, {
    mode: 'backup',
    sourcePath: input.sourcePath,
    targetPath: input.targetPath,
  })
}

/**
 * Runs `PRAGMA quick_check` on a finished SQLite copy outside the Electron main
 * isolate. Rejects with code BACKUP_INTEGRITY_FAILED, naming the first problems,
 * when the copy's b-tree structure is damaged [M-44].
 */
function runSqliteQuickCheckInWorker(input) {
  return runBackupWorker(input.workerPath, {
    mode: 'quick_check',
    targetPath: input.targetPath,
  })
}

/** Starts the backup worker in one mode and settles on its single reply. */
function runBackupWorker(workerPath, workerData) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerPath ?? DEFAULT_WORKER_PATH, { workerData })
    let settled = false

    worker.once('message', (message) => {
      if (settled) return
      settled = true
      if (message?.type === 'complete' && Number.isInteger(message.workerThreadId)) {
        resolve({ workerThreadId: message.workerThreadId })
        return
      }
      if (message?.type === 'integrity_failed') {
        reject(createIntegrityError(message.problems))
        return
      }
      const error = new Error(
        `SQLite backup worker failed: ${safeWorkerErrorMessage(message?.message)}`,
      )
      error.name = safeWorkerErrorName(message?.name)
      reject(error)
    })
    worker.once('error', (error) => {
      if (settled) return
      settled = true
      reject(new Error(`SQLite backup worker failed: ${safeWorkerErrorMessage(error.message)}`))
    })
    worker.once('exit', (exitCode) => {
      if (settled) return
      settled = true
      reject(new Error(`SQLite backup worker failed: exited with code ${exitCode}.`))
    })
  })
}

/** Builds the operator-readable refusal for a copy that failed quick_check. */
function createIntegrityError(problems) {
  const detail = (Array.isArray(problems) ? problems : [])
    .map((problem) => safeWorkerErrorMessage(problem))
    .join('; ')
    .slice(0, 500) || 'unknown damage'
  const error = new Error(
    `Mission backup refused: the copy of the mission store failed its integrity check, so the last good backup was kept. The mission store may be damaged; keep the app open and tell your technical lead. (${detail})`,
  )
  error.name = 'BackupIntegrityError'
  error.code = 'BACKUP_INTEGRITY_FAILED'
  return error
}

/** Bounds arbitrary native error text before it reaches operator-visible autosave state. */
function safeWorkerErrorMessage(input) {
  const value = String(input ?? 'unknown error').replace(/[\r\n]+/gu, ' ').trim()
  return value.slice(0, 500) || 'unknown error'
}

/** Preserves only a conventional JavaScript error category. */
function safeWorkerErrorName(input) {
  const value = String(input ?? '')
  return /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/u.test(value) ? value : 'Error'
}

module.exports = {
  runSqliteBackupInWorker,
  runSqliteQuickCheckInWorker,
}
