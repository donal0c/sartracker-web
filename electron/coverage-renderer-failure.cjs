'use strict'

/**
 * Allow-listed tile-worker failure codes that may cross from the main process
 * to the renderer. Raw error text, stacks and paths never cross; any other
 * failure is reported as the generic code [DON-338].
 * Keep in step with src/features/tracking/coverage-renderer-failure.ts and the
 * inline copy in preload.cjs (the sandboxed preload cannot require this file).
 */
const COVERAGE_RENDERER_FAILURE_CODES = Object.freeze([
  'coverage-worker-out-of-memory',
  'coverage-worker-failed',
])

/**
 * Projects a tile-worker failure to the bounded payload sent over IPC.
 * @param {unknown} error
 * @returns {{ code: string }}
 */
function projectCoverageRendererFailure(error) {
  const code = typeof error === 'object' && error !== null ? error.code : undefined
  return {
    code: COVERAGE_RENDERER_FAILURE_CODES.includes(code) ? code : 'coverage-worker-failed',
  }
}

module.exports = { COVERAGE_RENDERER_FAILURE_CODES, projectCoverageRendererFailure }
