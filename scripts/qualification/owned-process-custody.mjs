/**
 * Return whether an owned-process result proves that a supervisor was launched
 * but failed to prove descendant cleanup.
 *
 * A null supervisor PID is the explicit no-launch result used when the strict
 * supervisor is unavailable. That case remains ordinary invalid evidence and
 * does not retain a campaign resource lock.
 *
 * @param {object} execution bounded owned-process result
 * @returns {boolean} whether campaign-owned cleanup must remain blocked
 */
export function ownedProcessCleanupBlocked(execution) {
  return execution !== null && typeof execution === 'object'
    && Number.isSafeInteger(execution.supervisorPid) && execution.supervisorPid > 0
    && execution.zeroDescendantsAfterRun !== true
}

/**
 * Throw the typed custody signal immediately after an owned producer returns.
 *
 * The error deliberately carries only bounded controller code fields. Adapter
 * output and process diagnostics must not cross this boundary as arbitrary
 * exception text.
 *
 * @param {object} execution bounded owned-process result
 * @param {string} adapterId reviewed controller adapter id
 * @returns {void}
 */
export function assertOwnedProcessCleanup(execution, adapterId) {
  if (!ownedProcessCleanupBlocked(execution)) return
  const error = new Error('Owned producer cleanup was not positively verified.')
  error.code = 'OWNED_PROCESS_CLEANUP_BLOCKED'
  error.adapterId = adapterId
  error.resourceCleanupBlocked = true
  throw error
}

/**
 * Recognize a typed adapter custody failure for the currently executing adapter.
 *
 * @param {unknown} error caught adapter error
 * @param {string} adapterId current reviewed adapter id
 * @returns {boolean} whether the controller must retain its resource lock
 */
export function isOwnedProcessCleanupError(error, adapterId) {
  return error !== null && typeof error === 'object'
    && error.code === 'OWNED_PROCESS_CLEANUP_BLOCKED'
    && error.adapterId === adapterId
    && error.resourceCleanupBlocked === true
}

/**
 * Recognize a returned custody marker from a reviewed adapter.
 *
 * @param {object} execution adapter execution receipt
 * @returns {boolean} whether the controller must retain its resource lock
 */
export function hasOwnedProcessCleanupMarker(execution) {
  return execution !== null && typeof execution === 'object'
    && (execution.resourceCleanupBlocked === true || execution.observed?.resourceCleanupBlocked === true)
}
