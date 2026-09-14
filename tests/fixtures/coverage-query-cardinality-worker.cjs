// Runs the production worker with a deliberately oversized query result. The
// receiving test observes the raw worker message, before any parent validator.
const Module = require('node:module')
const originalLoad = Module._load
const { workerData } = require('node:worker_threads')
Module._load = function load(request, parent, isMain) {
  const loaded = originalLoad.call(this, request, parent, isMain)
  if (request !== './coverage-query.cjs' || !parent.filename.endsWith('/electron/coverage-query-worker.cjs')) return loaded
  return {
    ...loaded,
    enumerateCoverageChunks: (database) => {
      if (workerData.control !== 'snapshot') return { chunks: [{}, {}, {}] }
      const Database = originalLoad.call(this, 'better-sqlite3', parent, isMain)
      const writer = new Database(workerData.databasePath)
      try {
        writer.prepare('INSERT INTO outings VALUES (?, ?, ?)').run('later', 'mission', '2026-08-24T09:00:00.000Z')
      } finally { writer.close() }
      if (!database.inTransaction || database.prepare('SELECT COUNT(*) AS n FROM outings').get().n !== 1) {
        throw new Error('Coverage query did not retain the cardinality snapshot.')
      }
      return { chunks: [{}, {}] }
    },
    readCoverageManifestSnapshot: () => ({ chunks: [], outings: [{}, {}] }),
    analyzeCoverageInvalidation: () => ({ affectedKeys: [{}, {}, {}, {}] }),
  }
}
require('../../electron/coverage-query-worker.cjs')
