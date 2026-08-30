'use strict'

const fs = require('node:fs')

const RETRY_DELAY_MS = 10

/** Waits briefly without releasing ownership of a still-open transferred descriptor. */
function waitForRetry() {
  return new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS))
}

/** Returns false only when the process no longer has the candidate descriptor open. */
function descriptorMayRemainOpen(fileHandle) {
  if (!Number.isSafeInteger(fileHandle?.fd) || fileHandle.fd < 0) return false
  try {
    fs.fstatSync(fileHandle.fd)
    return true
  } catch (error) {
    return error?.code !== 'EBADF'
  }
}

/**
 * Closes one transferred FileHandle without losing retry ownership after a transient failure.
 * Persistent failures deliberately keep the owning lifecycle unsettled instead of permitting
 * a pathname sweep while plaintext remains reachable through a process descriptor.
 */
async function closeTransferredFileHandle(fileHandle) {
  if (fileHandle === null || typeof fileHandle !== 'object'
    || typeof fileHandle.close !== 'function') return
  while (true) {
    try {
      await fileHandle.close()
      return
    } catch {
      if (!descriptorMayRemainOpen(fileHandle)) return
      await waitForRetry()
    }
  }
}

module.exports = { closeTransferredFileHandle }
