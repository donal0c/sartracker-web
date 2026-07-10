const path = require('node:path')
const { Worker } = require('node:worker_threads')

const DEFAULT_WORKER_PATH = path.join(__dirname, 'sqlite-backup-worker.cjs')

/** Runs one SQLite online backup entirely outside the Electron main isolate. */
function runSqliteBackupInWorker(input) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(input.workerPath ?? DEFAULT_WORKER_PATH, {
      workerData: {
        sourcePath: input.sourcePath,
        targetPath: input.targetPath,
      },
    })
    let settled = false

    worker.once('message', (message) => {
      if (settled) return
      settled = true
      if (message?.type === 'complete' && Number.isInteger(message.workerThreadId)) {
        resolve({ workerThreadId: message.workerThreadId })
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
}
