const path = require('node:path')
const { Worker } = require('node:worker_threads')
const { randomUUID } = require('node:crypto')

const DEFAULT_WORKER_PATH = path.join(__dirname, 'gpx-evidence-import-worker.cjs')

/** Imports GPX source bytes and bulk points without Electron main-isolate transformation. */
function runGpxEvidenceImportInWorker(input) {
  validateInput(input)
  if (input.signal?.aborted === true) return Promise.reject(createAbortError())
  const startedAt = performance.now()
  let resolveWorkerExit
  const workerExited = new Promise((resolve) => { resolveWorkerExit = resolve })
  const result = new Promise((resolve, reject) => {
    const worker = input.createWorker?.() ?? new Worker(input.workerPath ?? DEFAULT_WORKER_PATH, {
      workerData: {
        databasePath: input.databasePath,
        missionId: input.missionId,
        paths: input.paths,
        batchId: input.batchId ?? randomUUID(),
      },
    })
    const dispatchDurationMs = performance.now() - startedAt
    let completed = null
    let settled = false
    const cleanup = () => {
      clearTimeout(timeout)
      input.signal?.removeEventListener('abort', handleAbort)
    }
    const rejectOnce = (error) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }
    const terminateAndReject = (error) => {
      rejectOnce(error)
      void Promise.resolve(worker.terminate()).catch(() => undefined)
    }
    const handleAbort = () => terminateAndReject(createAbortError())
    const timeout = setTimeout(() => {
      terminateAndReject(new Error('GPX evidence import worker timed out.'))
    }, 120_000)
    input.signal?.addEventListener('abort', handleAbort, { once: true })
    worker.on('message', (message) => {
      if (message?.type === 'progress') {
        input.onProgress?.({ completed: message.completed, total: message.total })
      } else if (message?.type === 'complete' && Array.isArray(message.imports)
        && message.imports.length <= input.paths.length && Array.isArray(message.failures)
        && message.failures.length <= input.paths.length) {
        completed = { imports: message.imports, failures: message.failures }
      } else if (message?.type === 'error') {
        terminateAndReject(new Error(`GPX evidence import failed: ${String(message.message).slice(0, 500)}`))
      }
    })
    worker.once('error', rejectOnce)
    worker.once('exit', (code) => {
      resolveWorkerExit()
      cleanup()
      if (settled) return
      if (code === 0 && completed !== null) {
        settled = true
        resolve({ ...completed, dispatchDurationMs })
      } else {
        rejectOnce(new Error(`GPX evidence import worker exited with code ${code}.`))
      }
    })
  })
  Object.defineProperty(result, 'workerExited', { value: workerExited })
  return result
}

function validateInput(input) {
  if (typeof input?.missionId !== 'string' || input.missionId.length < 1 || input.missionId.length > 200) throw new Error('GPX import mission ID is invalid.')
  if (!Array.isArray(input.paths) || input.paths.length < 1 || input.paths.length > 100 || input.paths.some((entry) => typeof entry !== 'string' || entry.length > 4096)) throw new Error('GPX import paths are invalid.')
}

function createAbortError() {
  const error = new Error('GPX evidence import worker was cancelled.')
  error.name = 'AbortError'
  return error
}

module.exports = { runGpxEvidenceImportInWorker }
