const { parentPort, threadId, workerData } = require('node:worker_threads')

const Database = require('better-sqlite3')
const {
  analyzeCoverageInvalidation,
  enumerateCoverageChunks,
  readCoverageClaimSnapshot,
  readCoverageChunkPage,
  readCoverageManifestSnapshot,
  summarizeCoverageChunkAtRevision,
} = require('./coverage-query.cjs')

if (parentPort === null) throw new Error('Coverage query worker requires a parent port.')

/** Opens one read-only database snapshot and executes one bounded query kind. */
function run() {
  let database
  try {
    database = new Database(workerData.databasePath, {
      readonly: true,
      fileMustExist: true,
    })
    database.pragma('query_only = ON')
    const readSnapshot = database.transaction(() =>
      executeCoverageQuery(database, workerData.query))
    const result = readSnapshot()
    parentPort.postMessage({ type: 'complete', workerThreadId: threadId, result })
  } catch (error) {
    parentPort.postMessage({
      type: 'error',
      name: error instanceof Error ? error.name : 'Error',
      message: error instanceof Error ? error.message : String(error),
      code: typeof error?.code === 'string' ? error.code : null,
    })
  } finally {
    database?.close()
    parentPort.close()
  }
}

/** Dispatches only the named read-only coverage worker operations. */
function executeCoverageQuery(database, query) {
  if (query?.kind === 'enumerate') {
    return enumerateCoverageChunks(database, { missionId: query.missionId })
  }
  if (query?.kind === 'manifest') {
    return readCoverageManifestSnapshot(database, { missionId: query.missionId })
  }
  if (query?.kind === 'claim') {
    return readCoverageClaimSnapshot(database, {
      missionId: query.missionId,
      selectedKeys: query.selectedKeys,
    })
  }
  if (query?.kind === 'chunk-page') {
    return readCoverageChunkPage(database, query)
  }
  if (query?.kind === 'chunk-summary') {
    return summarizeCoverageChunkAtRevision(database, query)
  }
  if (query?.kind === 'invalidation-analysis') {
    return analyzeCoverageInvalidation(database, {
      invalidationId: query.invalidationId,
    })
  }
  throw new Error('Coverage query kind is invalid.')
}

run()
