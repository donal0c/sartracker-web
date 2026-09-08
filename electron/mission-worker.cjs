'use strict'

const { Worker: NodeWorker } = require('node:worker_threads')

const MISSION_WORKER_RESOURCE_LIMITS = Object.freeze({
  maxOldGenerationSizeMb: 128,
  maxYoungGenerationSizeMb: 16,
  stackSizeMb: 4,
})

/** Bounds JavaScript heap amplification in mission workers, including untrusted archive readers. */
class Worker extends NodeWorker {
  /** Applies the same heap boundary at every application worker creation site. */
  constructor(filename, options = {}) {
    super(filename, { ...options, resourceLimits: MISSION_WORKER_RESOURCE_LIMITS })
  }
}

// Buffers and SQLite native allocations are outside V8's heap limit. Callers must
// also retain bounded stream pages, result limits and worker admission controls.
module.exports = { Worker, MISSION_WORKER_RESOURCE_LIMITS }
