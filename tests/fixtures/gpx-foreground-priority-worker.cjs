'use strict'

const { parentPort } = require('node:worker_threads')
const priority = require('../../electron/foreground-write-priority.cjs')
const wait = priority.waitForForegroundWrites

/** Announces the actual production arbitration boundary without replacing its behavior. */
priority.waitForForegroundWrites = async (...args) => {
  parentPort.postMessage({ type: 'progress', completed: 0, total: 1 })
  return wait(...args)
}

require('../../electron/gpx-evidence-import-worker.cjs')
