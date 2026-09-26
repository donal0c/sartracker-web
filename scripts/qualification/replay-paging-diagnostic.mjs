import { createRequire } from 'node:module'

const { REPLAY_PAGING_DIAGNOSTIC_PREFIX: prefix, validateReplayPagingDiagnostic } =
  createRequire(import.meta.url)('../../electron/mission-replay-paging-diagnostic.cjs')
const maximumLineBytes = 256

/** Retain at most one closed comparison, never general application stderr. */
export function createReplayPagingDiagnosticCollector() {
  let partial = ''
  let discarded = false
  let record = null
  let matches = 0
  return {
    /** Parse bounded ASCII lines across arbitrary stream chunk boundaries. */
    accept(chunk) {
      for (const byte of chunk) {
        if (byte === 10) {
          if (!discarded && partial.startsWith(prefix)) {
            try {
              const value = validateReplayPagingDiagnostic(JSON.parse(partial.slice(prefix.length)))
              if (value !== null) {
                matches = Math.min(2, matches + 1)
                record = matches === 1 ? value : null
              }
            } catch { /* Malformed diagnostics have no evidential value. */ }
          }
          partial = ''
          discarded = false
        } else if (!discarded) {
          if (byte < 32 || byte > 126 || partial.length >= maximumLineBytes) {
            partial = ''
            discarded = true
          } else {
            partial += String.fromCharCode(byte)
            if (partial.length <= prefix.length && !prefix.startsWith(partial)) {
              partial = ''
              discarded = true
            }
          }
        }
      }
    },
    /** A successful probe or unrelated failure must not acquire guard attribution. */
    forFailure(failure) {
      return typeof failure === 'string' && failure.includes('Mission replay evidence changed while paging.')
        && matches === 1 ? record : null
    },
  }
}
