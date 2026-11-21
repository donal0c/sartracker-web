/**
 * Fixed, bounded public errors for coverage RPC failures [DON-338].
 *
 * Raw failures can carry tile-cache file paths and worker text. Only one of
 * these messages crosses IPC; the detail stays in the main-process log. The
 * renderer still classifies by message tokens (coverage-diagnostics.ts), so
 * the categories are checked in the renderer's order and each public message
 * keeps exactly the token that produced the raw classification.
 */

const PUBLIC = Object.freeze({
  cancelled: 'coverage-cancelled: Coverage request was cancelled.',
  aborted: 'Coverage request was cancelled.',
  chunkStale: 'chunk-stale: coverage chunk revision changed',
  revisionMoved: 'coverage-revision-moved: Coverage history changed while it was read.',
  timeout: 'Coverage request timed out.',
  worker: 'Coverage history worker failed.',
  unavailable: 'Coverage history is unavailable.',
  notOwned: 'Coverage tile catalog stage is not owned by this renderer.',
  notCurrent: 'Coverage tile catalog is no longer current.',
  invalid: 'Coverage request is invalid.',
  failed: 'Coverage request failed.',
})

const PUBLIC_COVERAGE_ERROR_MESSAGES = Object.freeze(Object.values(PUBLIC))

/**
 * Converts any coverage RPC failure into one allow-listed public error.
 * Cancellation keeps its AbortError name, and the coverage-cancelled prefix
 * only when the raw error had it, so renderer cancellation is unchanged.
 * @param {unknown} error
 * @returns {Error & { code?: string }}
 */
function toPublicCoverageError(error) {
  const name = error instanceof Error ? error.name : ''
  const message = error instanceof Error && typeof error.message === 'string' ? error.message : ''
  const code = typeof error?.code === 'string' ? error.code : ''
  const lower = message.toLowerCase()

  if (message.includes('coverage-cancelled:')) return publicError(PUBLIC.cancelled, { name: 'AbortError' })
  if (name === 'AbortError') return publicError(PUBLIC.aborted, { name: 'AbortError' })
  if (code === 'chunk-stale' || lower.includes('chunk-stale')) {
    return publicError(PUBLIC.chunkStale, { code: 'chunk-stale' })
  }
  if (code === 'coverage-revision-moved' || lower.includes('coverage-revision-moved:')) {
    return publicError(PUBLIC.revisionMoved, { code: 'coverage-revision-moved' })
  }
  if (lower.includes('timed out') || lower.includes('timeout')) return publicError(PUBLIC.timeout)
  if (lower.includes('worker')) return publicError(PUBLIC.worker)
  if (lower.includes('unavailable') || lower.includes('not available')) return publicError(PUBLIC.unavailable)
  if (lower.includes('not owned by this renderer')) return publicError(PUBLIC.notOwned)
  if (lower.includes('no longer current')) return publicError(PUBLIC.notCurrent)
  if (/^coverage (request|ipc sender) id is invalid\.$/u.test(lower)) return publicError(PUBLIC.invalid)
  return publicError(PUBLIC.failed)
}

/**
 * Builds one public error with an optional name and code.
 * @param {string} message
 * @param {{ name?: string, code?: string }} [options]
 */
function publicError(message, options = {}) {
  const error = new Error(message)
  if (options.name !== undefined) error.name = options.name
  if (options.code !== undefined) error.code = options.code
  return error
}

/** True for a failure that is ordinary cancellation rather than a fault worth logging. */
function isCoverageCancellationFailure(error) {
  return error instanceof Error &&
    (error.name === 'AbortError' || String(error.message).includes('coverage-cancelled:'))
}

module.exports = {
  PUBLIC_COVERAGE_ERROR_MESSAGES,
  isCoverageCancellationFailure,
  toPublicCoverageError,
}
