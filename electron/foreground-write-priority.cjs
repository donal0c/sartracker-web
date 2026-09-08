'use strict'

const { setTimeout: delay } = require('node:timers/promises')

/** Gives admitted foreground transactions priority before taking another background page. */
async function waitForForegroundWrites(buffer, signal) {
  if (!(buffer instanceof SharedArrayBuffer) || buffer.byteLength !== Int32Array.BYTES_PER_ELEMENT) {
    throw new Error('Foreground writer counter is invalid.')
  }
  const pending = new Int32Array(buffer)
  while (Atomics.load(pending, 0) > 0 && !signal?.aborted) {
    // No SQLite transaction spans this wait. Cancellation is handled by the
    // coordinator on return, without needing the foreground queue to drain.
    await delay(5)
  }
}

module.exports = { waitForForegroundWrites }
