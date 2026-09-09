'use strict'

const fs = require('node:fs')

const RETRY_DELAY_MS = 10

/** Waits briefly without releasing ownership of a still-open transferred descriptor. */
function waitForRetry() {
  return new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS))
}

/** Returns false only when the process no longer has the candidate descriptor open. */
function descriptorMayRemainOpen(descriptor) {
  if (!Number.isSafeInteger(descriptor) || descriptor < 0) return true
  try {
    fs.fstatSync(descriptor)
    return true
  } catch (error) {
    return error?.code !== 'EBADF'
  }
}

/**
 * Closes one transferred FileHandle without losing retry ownership after a transient failure.
 * Failed ownership release is explicit: callers must retain quarantine, never sweep or
 * report cleanup success. A raw descriptor may have been reused; never close it by number.
 */
async function closeTransferredFileHandle(fileHandle) {
  if (fileHandle === null || typeof fileHandle !== 'object'
    || typeof fileHandle.close !== 'function') return
  const originalDescriptor = fileHandle.fd
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await fileHandle.close()
      return
    } catch (cause) {
      if (!descriptorMayRemainOpen(originalDescriptor)) return
      if (fileHandle.fd !== originalDescriptor || attempt === 2) {
        throw Object.assign(new Error(
          'Archive Review could not confirm descriptor cleanup. Restart the application before reopening Review.',
          { cause },
        ), { code: 'ARCHIVE_REVIEW_DESCRIPTOR_CLEANUP_FAILED' })
      }
      await waitForRetry()
    }
  }
}

module.exports = { closeTransferredFileHandle }
