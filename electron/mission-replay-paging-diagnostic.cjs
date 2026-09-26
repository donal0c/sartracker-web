'use strict'

const MESSAGE = 'Mission replay evidence changed while paging. Re-seek the selected time.'
const PREFIX = 'sartracker-replay-paging-guard='
const GUARDS = new Set(['generation', 'eligible-position-count', 'eligible-track-count'])
const diagnostics = new WeakMap()

/** Accept only a closed, bounded comparison without mission or row information. */
function validateReplayPagingDiagnostic(value) {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
      || Reflect.ownKeys(value).sort().join(',') !== 'expected,guard,observed') return null
    const fields = Object.getOwnPropertyDescriptors(value)
    if (Object.values(fields).some(field => !Object.hasOwn(field, 'value'))) return null
    const { guard, expected, observed } = value
    if (!GUARDS.has(guard) || !Number.isSafeInteger(expected) || expected < 0
      || !Number.isSafeInteger(observed) || observed < 0 || expected === observed) return null
    return Object.freeze({ guard, expected, observed })
  } catch { return null }
}

/** Attach internal-only attribution while preserving the existing public error. */
function createReplayPagingChangedError(guard, expected, observed) {
  const error = new Error(MESSAGE)
  const record = validateReplayPagingDiagnostic({ guard, expected, observed })
  if (record !== null) diagnostics.set(error, record)
  return error
}

/** Read only metadata created here, never arbitrary properties on an error. */
function readReplayPagingDiagnostic(error) {
  return error !== null && typeof error === 'object' ? diagnostics.get(error) ?? null : null
}

/** Emit one safe internal record; diagnostics cannot replace the original failure. */
function emitReplayPagingDiagnostic(value, options = {}) {
  const enabled = options.enabled ?? process.env.SARTRACKER_REPLAY_PAGING_DIAGNOSTICS === '1'
  if (!enabled) return false
  const record = validateReplayPagingDiagnostic(value)
  if (record === null) return false
  try {
    const write = options.write ?? (line => process.stderr.write(line))
    write(`${PREFIX}${JSON.stringify(record)}\n`)
    return true
  } catch { return false }
}

module.exports = {
  REPLAY_PAGING_CHANGED_MESSAGE: MESSAGE,
  REPLAY_PAGING_DIAGNOSTIC_PREFIX: PREFIX,
  createReplayPagingChangedError,
  readReplayPagingDiagnostic,
  validateReplayPagingDiagnostic,
  emitReplayPagingDiagnostic,
}
