'use strict'

const { randomUUID: cryptoRandomUUID } = require('node:crypto')

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const ARCHIVE_ERROR_CODE = /^ARCHIVE_[A-Z0-9_]{1,80}$/u
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u

/** Starts durable cleanup recovery while returning control before any row batches complete. */
async function startInterruptedMissionCleanupRecovery(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)
    || typeof input.missionStore?.listInterruptedMissionCleanups !== 'function'
    || typeof input.missionStore?.resumeMissionCleanup !== 'function'
    || typeof input.sessionManager?.acquireCleanupLease !== 'function'
    || (input.randomUUID !== undefined && typeof input.randomUUID !== 'function')
    || typeof input.onFailure !== 'function') {
    throw new TypeError('Archive cleanup startup recovery adapters are invalid.')
  }
  const interrupted = await input.missionStore.listInterruptedMissionCleanups()
  if (!Array.isArray(interrupted) || interrupted.length > 10_000) {
    throw new TypeError('Interrupted mission cleanup inventory is invalid.')
  }
  const identities = interrupted.map(normalizeInterruptedIdentity)
  if (new Set(identities.map((entry) => entry.missionId)).size !== identities.length) {
    throw new TypeError('Interrupted mission cleanup inventory contains duplicate missions.')
  }
  if (identities.length === 0) {
    return Object.freeze({ started: false, count: 0, completion: Promise.resolve() })
  }

  // Acquiring the global lease before returning prevents archive review from
  // racing the first resumed batch, while the completion itself stays off the
  // startup/current-position path.
  const lease = input.sessionManager.acquireCleanupLease(identities[0].missionId)
  if (lease === null || typeof lease !== 'object' || typeof lease.release !== 'function') {
    throw new TypeError('Archive cleanup startup lease is invalid.')
  }
  const randomUUID = input.randomUUID ?? cryptoRandomUUID
  const completion = (async () => {
    try {
      for (const identity of identities) {
        try {
          const operationId = randomUUID()
          if (typeof operationId !== 'string' || !UUID_V4.test(operationId)) {
            throw Object.assign(new Error('Archive cleanup recovery identity is invalid.'), {
              code: 'ARCHIVE_CLEANUP_STARTUP_INVALID',
            })
          }
          await input.missionStore.resumeMissionCleanup(identity, {
            operationId,
            reviewActivity: false,
            onProgress: () => undefined,
          })
        } catch (error) {
          await reportFailure(input.onFailure, identity, error)
        }
      }
    } finally {
      lease.release()
    }
  })()
  return Object.freeze({ started: true, count: identities.length, completion })
}

/** Closes one journal identity before it is handed to the mission store. */
function normalizeInterruptedIdentity(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('Interrupted mission cleanup identity is invalid.')
  }
  return Object.freeze({
    missionId: normalizeIdentifier(input.missionId),
    archiveId: normalizeIdentifier(input.archiveId),
  })
}

/** Requires one bounded non-control identifier without coercion. */
function normalizeIdentifier(value) {
  if (typeof value !== 'string' || value.length < 1
    || Buffer.byteLength(value, 'utf8') > 200
    || CONTROL_CHARACTERS.test(value)) {
    throw new TypeError('Interrupted mission cleanup identity is invalid.')
  }
  return value
}

/** Reports only exact identities and one stable code, never the source error text. */
async function reportFailure(onFailure, identity, error) {
  const code = typeof error?.code === 'string' && ARCHIVE_ERROR_CODE.test(error.code)
    ? error.code
    : 'ARCHIVE_CLEANUP_STARTUP_FAILED'
  try {
    await onFailure(Object.freeze({ ...identity, code }))
  } catch {
    // Recovery must continue across independently journalled missions even when
    // best-effort diagnostics are unavailable.
  }
}

module.exports = { startInterruptedMissionCleanupRecovery }
