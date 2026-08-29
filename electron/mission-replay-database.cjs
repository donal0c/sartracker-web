const Database = require('better-sqlite3')

const REPLAY_MMAP_BYTES = 2_147_483_648

/** Opens a bounded read-only replay connection tuned for cold indexed history scans. */
function openMissionReplayDatabase(databasePath) {
  const database = new Database(databasePath, { readonly: true, fileMustExist: true })
  try {
    database.pragma('query_only = ON')
    database.pragma(`mmap_size = ${REPLAY_MMAP_BYTES}`)
    return database
  } catch (error) {
    database.close()
    throw error
  }
}

module.exports = { openMissionReplayDatabase, REPLAY_MMAP_BYTES }
