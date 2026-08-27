const path = require('node:path')
const { Worker } = require('node:worker_threads')

const DEFAULT_WORKER_PATH = path.join(__dirname, 'gpx-evidence-import-worker.cjs')

/** Imports GPX source bytes and bulk points without Electron main-isolate transformation. */
function runGpxEvidenceImportInWorker(input) {
  validateInput(input)
  const startedAt = performance.now()
  return new Promise((resolve, reject) => {
    const worker = new Worker(input.workerPath ?? DEFAULT_WORKER_PATH, {
      workerData: { databasePath: input.databasePath, missionId: input.missionId, paths: input.paths },
    })
    const dispatchDurationMs = performance.now() - startedAt
    let completed = null
    let settled = false
    const rejectOnce = (error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      reject(error)
    }
    const timeout = setTimeout(() => {
      void worker.terminate()
      rejectOnce(new Error('GPX evidence import worker timed out.'))
    }, 120_000)
    worker.on('message', (message) => {
      if (message?.type === 'progress') {
        input.onProgress?.({ completed: message.completed, total: message.total })
      } else if (message?.type === 'complete' && Array.isArray(message.imports) && message.imports.length <= input.paths.length) {
        completed = message.imports
      } else if (message?.type === 'error') {
        void worker.terminate()
        rejectOnce(new Error(`GPX evidence import failed: ${String(message.message).slice(0, 500)}`))
      }
    })
    worker.once('error', rejectOnce)
    worker.once('exit', (code) => {
      clearTimeout(timeout)
      if (settled) return
      if (code === 0 && completed !== null) {
        settled = true
        resolve({ imports: completed, dispatchDurationMs })
      } else {
        rejectOnce(new Error(`GPX evidence import worker exited with code ${code}.`))
      }
    })
  })
}

function validateInput(input) {
  if (typeof input?.missionId !== 'string' || input.missionId.length < 1 || input.missionId.length > 200) throw new Error('GPX import mission ID is invalid.')
  if (!Array.isArray(input.paths) || input.paths.length < 1 || input.paths.length > 100 || input.paths.some((entry) => typeof entry !== 'string' || entry.length > 4096)) throw new Error('GPX import paths are invalid.')
}

module.exports = { runGpxEvidenceImportInWorker }
