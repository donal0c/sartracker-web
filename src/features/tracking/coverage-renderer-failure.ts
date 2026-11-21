/**
 * Allow-listed tile-worker failure codes that may cross from the Electron main
 * process to the renderer. Raw error text and paths never cross; anything not
 * on this list is reported as the generic failure [DON-338].
 * Keep in step with electron/coverage-renderer-failure.cjs and the inline copy
 * in electron/preload.cjs (the sandboxed preload cannot require it).
 */
export const COVERAGE_RENDERER_FAILURE_CODES = [
  'coverage-worker-out-of-memory',
  'coverage-worker-failed',
] as const

export type CoverageRendererFailureCode = typeof COVERAGE_RENDERER_FAILURE_CODES[number]

export type CoverageRendererUnavailableFailure = {
  readonly code: CoverageRendererFailureCode
}

/** Reduces an untrusted IPC payload to one allow-listed failure code. */
export function parseCoverageRendererFailure(payload: unknown): CoverageRendererUnavailableFailure {
  const code = typeof payload === 'object' && payload !== null
    ? (payload as { readonly code?: unknown }).code
    : undefined
  return {
    code: (COVERAGE_RENDERER_FAILURE_CODES as readonly unknown[]).includes(code)
      ? code as CoverageRendererFailureCode
      : 'coverage-worker-failed',
  }
}
