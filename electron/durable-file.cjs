const fs = require('node:fs/promises')
const path = require('node:path')
const { randomUUID } = require('node:crypto')

/**
 * Atomically replaces one file and durably orders both its contents and name.
 */
async function writeFileDurably(filePath, contents, options = {}) {
  const fileSystem = options.fileSystem ?? fs
  const platform = options.platform ?? process.platform
  const createTemporarySuffix = options.createTemporarySuffix ?? randomUUID
  const temporaryPath = `${filePath}.${createTemporarySuffix()}.tmp`
  let handle
  try {
    try {
      handle = await fileSystem.open(temporaryPath, 'wx', 0o600)
      await handle.writeFile(contents, 'utf8')
      await handle.sync()
    } finally {
      await handle?.close()
    }
    await fileSystem.rename(temporaryPath, filePath)
    await syncDirectoryDurably(path.dirname(filePath), { fileSystem, platform })
  } catch (error) {
    await fileSystem.rm(temporaryPath, { force: true }).catch(() => undefined)
    throw error
  }
}

/**
 * Removes one file and durably records the directory entry change.
 */
async function removeFileDurably(filePath, options = {}) {
  const fileSystem = options.fileSystem ?? fs
  const platform = options.platform ?? process.platform
  await fileSystem.rm(filePath, { force: true })
  await syncDirectoryDurably(path.dirname(filePath), { fileSystem, platform })
}

/**
 * Flushes directory metadata on platforms that support directory handles.
 */
async function syncDirectoryDurably(directoryPath, options = {}) {
  const fileSystem = options.fileSystem ?? fs
  const platform = options.platform ?? process.platform
  if (platform === 'win32') return
  let handle
  try {
    handle = await fileSystem.open(directoryPath, 'r')
    await handle.sync()
  } finally {
    await handle?.close()
  }
}

module.exports = {
  removeFileDurably,
  syncDirectoryDurably,
  writeFileDurably,
}
