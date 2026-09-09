'use strict'

const path = require('node:path')

const {
  captureCorrectionDirectoryIdentity,
} = require('./archive-correction-directory-capability.cjs')

const DEFAULT_WORKER_PATH = path.join(__dirname, 'archive-correction-custody-recovery-worker.cjs')
const CANCEL_GRACE_MS = 2_000
const READY_TIMEOUT_MS = 5_000

/** Starts utility-process startup reconciliation for correction attachment custody. */
function startArchiveCorrectionAttachmentRecovery(input) {
  const request = normalizeRequest(input)
  const workerExited = createDeferred()
  let utility
  let ready = false
  let terminal = null
  let settled = false
  let completionTerminationRequested = false
  let cancelOperation = () => undefined
  let terminationTimer = null
  let readyTimer = null
  let exitListenerInstalled = false
  const completion = new Promise((resolve, reject) => {
    const rejectOnce = (error) => {
      if (settled) return
      settled = true
      reject(error)
    }
    try {
      const databaseDirectory = path.dirname(request.databasePath)
      const directoryIdentity = captureCorrectionDirectoryIdentity(databaseDirectory)
      utility = request.createUtilityProcess?.({
        modulePath: request.workerPath,
        cwd: databaseDirectory,
        serviceName: 'SAR Tracker archive correction recovery',
      })
      assertUtilityProcess(utility)
      const kill = () => {
        try { utility.kill() } catch {}
      }
      const cancel = () => {
        if (terminal !== null) {
          completionTerminationRequested = true
          kill()
          return
        }
        if (settled) {
          kill()
          return
        }
        try { utility.postMessage({ type: 'cancel' }) } catch {}
        rejectOnce(createFailure('ARCHIVE_CANCELLED'))
        if (terminationTimer === null) {
          terminationTimer = setTimeout(kill, CANCEL_GRACE_MS)
        }
      }
      cancelOperation = cancel
      utility.on('message', (message) => {
        if (settled || terminal !== null) return
        if (!ready) {
          if (!isReady(message, directoryIdentity)) {
            rejectOnce(createFailure())
            kill()
            return
          }
          ready = true
          if (readyTimer !== null) clearTimeout(readyTimer)
          try {
            utility.postMessage({
              type: 'start',
              directoryIdentity,
              request: { databaseName: path.basename(request.databasePath) },
            })
          } catch {
            rejectOnce(createFailure())
            kill()
          }
          return
        }
        if (message?.type === 'complete' && isComplete(message)) {
          terminal = Object.freeze({ recovered: message.recovered })
          return
        }
        if (message?.type === 'error'
          && message.code === 'ARCHIVE_CORRECTION_ATTACHMENT_RECOVERY_REQUIRED') {
          rejectOnce(createFailure())
          return
        }
        rejectOnce(createFailure())
        kill()
      })
      utility.once('error', () => rejectOnce(createFailure()))
      utility.once('exit', (code) => {
        if (terminationTimer !== null) clearTimeout(terminationTimer)
        if (readyTimer !== null) clearTimeout(readyTimer)
        workerExited.resolve()
        if (settled) return
        settled = true
        if (terminal !== null && (code === 0 || completionTerminationRequested)) resolve(terminal)
        else reject(createFailure())
      })
      exitListenerInstalled = true
      readyTimer = setTimeout(() => {
        rejectOnce(createFailure())
        kill()
      }, READY_TIMEOUT_MS)
      readyTimer.unref?.()
    } catch {
      if (readyTimer !== null) clearTimeout(readyTimer)
      if (!exitListenerInstalled) workerExited.resolve()
      else {
        try { utility.kill?.() } catch {}
      }
      rejectOnce(createFailure())
    }
  })
  Object.defineProperty(completion, 'workerExited', { value: workerExited.promise })
  Object.defineProperty(completion, 'cancel', { value: () => cancelOperation() })
  return completion
}

/** Validates the bounded startup recovery request. */
function normalizeRequest(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some((key) => ![
      'databasePath', 'workerPath', 'createUtilityProcess',
    ].includes(key))
    || typeof input.databasePath !== 'string'
    || !path.isAbsolute(input.databasePath)
    || path.resolve(input.databasePath) !== input.databasePath
    || Buffer.byteLength(input.databasePath, 'utf8') > 8_192
    || (input.workerPath !== undefined && (
      typeof input.workerPath !== 'string'
      || !path.isAbsolute(input.workerPath)
      || path.resolve(input.workerPath) !== input.workerPath
      || Buffer.byteLength(input.workerPath, 'utf8') > 8_192
    ))
    || (input.createUtilityProcess !== undefined
      && typeof input.createUtilityProcess !== 'function')) {
    throw createFailure()
  }
  return Object.freeze({
    databasePath: input.databasePath,
    workerPath: input.workerPath ?? DEFAULT_WORKER_PATH,
    createUtilityProcess: input.createUtilityProcess,
  })
}

/** Requires the Electron utility-process surface used by recovery. */
function assertUtilityProcess(value) {
  if (!value || typeof value.on !== 'function' || typeof value.once !== 'function'
    || typeof value.postMessage !== 'function' || typeof value.kill !== 'function') {
    throw new Error('Archive correction recovery requires an Electron utility process.')
  }
}

/** Validates the recovery utility's cwd identity before sending database authority. */
function isReady(message, expectedIdentity) {
  return message !== null && typeof message === 'object' && !Array.isArray(message)
    && Object.keys(message).sort().join(',') === 'directoryIdentity,type'
    && message.type === 'ready'
    && message.directoryIdentity !== null && typeof message.directoryIdentity === 'object'
    && !Array.isArray(message.directoryIdentity)
    && Object.keys(message.directoryIdentity).sort().join(',') === 'dev,ino'
    && message.directoryIdentity.dev === expectedIdentity.dev
    && message.directoryIdentity.ino === expectedIdentity.ino
}

/** Returns one closed recovery failure. */
function createFailure(code = 'ARCHIVE_CORRECTION_ATTACHMENT_RECOVERY_REQUIRED') {
  const error = new Error(
    code === 'ARCHIVE_CANCELLED'
      ? 'Archive correction attachment custody recovery was cancelled.'
      : 'Archive correction attachment custody recovery requires operator review before retry.',
  )
  error.code = code
  return error
}

/** Validates the closed utility completion envelope. */
function isComplete(message) {
  return Object.keys(message).sort().join(',') === 'recovered,type'
    && Number.isSafeInteger(message.recovered) && message.recovered >= 0
}

/** Creates one externally-resolvable utility-exit promise. */
function createDeferred() {
  let resolve
  const promise = new Promise((settle) => { resolve = settle })
  return { promise, resolve }
}

module.exports = { startArchiveCorrectionAttachmentRecovery }
