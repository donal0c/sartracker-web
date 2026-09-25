const fs = require('node:fs/promises')

/** Confirms an optional storage path is a regular file before opening it. */
async function assertRegularFileOrAbsent(filePath, fileSystem = fs) {
  if (typeof filePath !== 'string' || filePath.trim() === '') {
    throw new Error('Startup storage file path must be a non-empty string.')
  }
  let metadata
  try {
    metadata = await fileSystem.lstat(filePath)
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
  if (!metadata.isFile()) {
    const error = new Error('Startup storage evidence path is not a regular file.')
    error.code = 'ERR_SARTRACKER_NON_REGULAR_FILE'
    throw error
  }
  return true
}

module.exports = { assertRegularFileOrAbsent }
