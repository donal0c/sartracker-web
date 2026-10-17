const fs = require('node:fs/promises')
const path = require('node:path')
const { TEMPORARY_BACKUP_PATTERN } = require('./storage-diagnostics-state.cjs')

const MAX_TEMPORARY_SETS_PER_STARTUP = 64

/**
 * Removes abandoned app-owned copy sets after the primary opened successfully.
 * The backup coordinator must gate new copies on this promise. Temporary copies
 * are not recovery sources; unknown files, links and entire linked sets stay put.
 */
async function cleanupBackupTemporaryFiles(userDataPath) {
  const result = { removedFileCount: 0, removedBytes: 0, preservedSetCount: 0,
    failedFileCount: 0, skippedRoot: false }
  const root = await lstatIfPresent(userDataPath)
  if (root === null) return result
  if (!root.isDirectory() || root.isSymbolicLink()) return { ...result, skippedRoot: true }
  const entries = await fs.readdir(userDataPath).catch(error => {
    if (error?.code === 'ENOENT') return []
    throw error
  })
  const bases = [...new Set(entries.map(name => name.replace(/-(?:wal|shm)$/u, ''))
    .filter(name => TEMPORARY_BACKUP_PATTERN.test(name)))]
  result.preservedSetCount = Math.max(0, bases.length - MAX_TEMPORARY_SETS_PER_STARTUP)
  for (const base of bases.slice(0, MAX_TEMPORARY_SETS_PER_STARTUP)) {
    const members = []
    try {
      for (const suffix of ['', '-wal', '-shm']) {
        const filePath = path.join(userDataPath, `${base}${suffix}`)
        const metadata = await lstatIfPresent(filePath)
        if (metadata !== null) members.push({ filePath, metadata })
      }
    } catch {
      result.failedFileCount += 1
      result.preservedSetCount += 1
      continue
    }
    if (members.some(({ metadata }) => !metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1)) {
      result.preservedSetCount += 1
      continue
    }
    for (const { filePath, metadata } of members) {
      try {
        await fs.unlink(filePath)
        result.removedFileCount += 1
        result.removedBytes += metadata.size
      } catch (error) {
        if (error?.code !== 'ENOENT') result.failedFileCount += 1
      }
    }
  }
  return result
}

/** Never follows a candidate link and tolerates already-absent sidecars. */
async function lstatIfPresent(filePath) {
  try {
    return await fs.lstat(filePath)
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

module.exports = { cleanupBackupTemporaryFiles }
