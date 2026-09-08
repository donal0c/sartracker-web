const Database = require('better-sqlite3')

const REPLAY_MMAP_BYTES = 2_147_483_648

/** Opens read-only Replay; archived snapshots use SQLite's bounded page cache instead of mmap. */
function openMissionReplayDatabase(databasePath, options = {}) {
  const database = new Database(databasePath, { readonly: true, fileMustExist: true })
  try {
    database.pragma('query_only = ON')
    // Worker threads share process RSS. Mapping an entire large archive breaches
    // its lifecycle memory budget even when the returned Replay page is tiny.
    // Preserve the existing cold-read policy for the live mission store.
    database.pragma(`mmap_size = ${options.archiveReview === true ? 0 : REPLAY_MMAP_BYTES}`)
    return database
  } catch (error) {
    database.close()
    throw error
  }
}

module.exports = { openMissionReplayDatabase, REPLAY_MMAP_BYTES }
