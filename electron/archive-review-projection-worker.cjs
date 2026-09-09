'use strict'

const { parentPort, workerData } = require('node:worker_threads')

const Database = require('better-sqlite3')
const {
  normalizeArchiveReviewProjectionRequest,
  normalizeArchiveReviewProjectionResult,
  readArchiveReviewProjection,
} = require('./archive-review-projection-query.cjs')

if (parentPort === null) {
  throw new Error('Archive review projection worker requires a parent message port.')
}

/** Opens one immutable restored database and returns one bounded projection. */
function run() {
  let database
  let request
  try {
    request = normalizeArchiveReviewProjectionRequest(workerData)
    database = new Database(request.databasePath, { readonly: true, fileMustExist: true })
    database.pragma('query_only = ON')
    const result = normalizeArchiveReviewProjectionResult(
      request,
      readArchiveReviewProjection(database, request),
    )
    parentPort.postMessage({ type: 'complete', method: request.method, result })
  } catch {
    parentPort.postMessage({
      type: 'error',
      method: request?.method ?? 'invalid',
    })
  } finally {
    database?.close()
    parentPort.close()
  }
}

run()
