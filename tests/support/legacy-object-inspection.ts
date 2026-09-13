import { createRequire } from 'node:module'
import { threadId as parentThreadId, Worker, type WorkerOptions } from 'node:worker_threads'

const WORKER_PATH = createRequire(import.meta.url).resolve('./legacy-object-inspection-worker.cjs')

export interface LegacyObjectInspectionResult {
  readonly count: number
  readonly workerQueryElapsedMs: number
  readonly workerThreadId: number
}

export interface LegacyObjectInspection {
  count(): Promise<LegacyObjectInspectionResult>
  close(): Promise<void>
}

/** Allows focused tests to retain the owned worker and observe its real exit. */
export type LegacyObjectInspectionWorkerFactory = (
  filename: string,
  options: WorkerOptions,
) => Worker

export interface LegacyObjectInspectionOptions {
  readonly timeoutMs?: number
  readonly startupTimeoutMs?: number
  readonly countTimeoutMs?: number
  readonly closeTimeoutMs?: number
  readonly workerPath?: string
  readonly workerFactory?: LegacyObjectInspectionWorkerFactory
}

interface PendingCount {
  readonly requestId: number
  readonly resolve: (result: LegacyObjectInspectionResult) => void
  readonly reject: (error: Error) => void
}

/** Converts an unknown failure into an Error without losing the original message. */
function asError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason))
}

/** Creates an explicitly settled operation on the repository's ES2023 target. */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((accept, refuse) => {
    resolve = accept
    reject = refuse
  })
  return { promise, resolve, reject }
}

/** Identifies message objects before the protocol-specific validation runs. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Checks the positive worker and request identity values used by the protocol. */
function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

/** Checks the nonnegative count returned by the worker. */
function isNonnegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

/** Checks a worker-side duration without accepting NaN or infinity. */
function isNonnegativeFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

/** Builds an actionable error for a malformed or out-of-sequence worker message. */
function protocolError(detail: string): Error {
  return new Error(`Legacy object inspection protocol error: ${detail}`)
}

/** Opens a read-only worker inspector for the legacy object-version count. */
export async function openLegacyObjectInspection(
  databasePath: string,
  options: LegacyObjectInspectionOptions = {},
): Promise<LegacyObjectInspection> {
  if (databasePath.length === 0) {
    throw new TypeError('A database path is required for legacy-object inspection.')
  }

  const defaultTimeoutMs = options.timeoutMs ?? 5_000
  const startupTimeoutMs = options.startupTimeoutMs ?? defaultTimeoutMs
  const countTimeoutMs = options.countTimeoutMs ?? defaultTimeoutMs
  const closeTimeoutMs = options.closeTimeoutMs ?? defaultTimeoutMs
  for (const timeout of [startupTimeoutMs, countTimeoutMs, closeTimeoutMs]) {
    if (!Number.isFinite(timeout) || timeout <= 0) {
      throw new RangeError('Legacy-object inspection timeouts must be positive finite numbers.')
    }
  }

  const workerFactory = options.workerFactory ?? ((filename, workerOptions) => (
    new Worker(filename, workerOptions)
  ))
  const worker = workerFactory(options.workerPath ?? WORKER_PATH, {
    workerData: { databasePath },
  })
  let pending: PendingCount | undefined
  let pendingPromise: Promise<LegacyObjectInspectionResult> | undefined
  let nextRequestId = 0
  let readyThreadId: number | undefined
  let readyReceived = false
  let failure: Error | undefined
  let closed = false
  let exited = false
  let terminationRequested = false
  let terminationPromise: Promise<void> | undefined
  let closePromise: Promise<void> | undefined

  const ready = deferred<void>()
  const joinedExit = deferred<number>()

  /** Terminates the owned worker and waits for its physical exit exactly once. */
  const terminateAndJoin = (): Promise<void> => {
    if (terminationPromise !== undefined) return terminationPromise
    terminationRequested = true
    terminationPromise = (async () => {
      let terminationError: Error | undefined
      if (!exited) {
        try {
          await worker.terminate()
        } catch (error) {
          terminationError = asError(error)
        }
      }
      await joinedExit.promise
      if (terminationError !== undefined) throw terminationError
    })()
    return terminationPromise
  }

  /** Retains the first failure, rejects the active operation, and starts a join. */
  const fail = (reason: unknown): void => {
    if (terminationRequested) return
    const error = failure ?? asError(reason)
    failure ??= error
    const join = terminateAndJoin()
    if (pending !== undefined) {
      const pendingFailure = pending
      void join.then(
        () => pendingFailure.reject(error),
        () => pendingFailure.reject(error),
      )
    } else if (!readyReceived) {
      void join.then(
        () => ready.reject(error),
        () => ready.reject(error),
      )
    } else {
      void join.catch(() => undefined)
    }
  }

  worker.on('message', (message: unknown) => {
    if (terminationRequested) return
    if (!isRecord(message) || typeof message.type !== 'string') {
      fail(protocolError('unknown message'))
      return
    }

    if (message.type === 'ready') {
      if (readyReceived) {
        fail(protocolError('duplicate ready reply'))
      } else if (
        !isPositiveSafeInteger(message.threadId)
        || message.threadId === parentThreadId
        || message.threadId !== worker.threadId
      ) {
        fail(protocolError('ready reply has an invalid threadId'))
      } else {
        readyReceived = true
        readyThreadId = message.threadId
        ready.resolve()
      }
      return
    }

    if (message.type === 'error') {
      if (typeof message.message !== 'string' || message.message.length === 0) {
        fail(protocolError('error reply has an invalid message'))
      } else {
        fail(new Error(message.message))
      }
      return
    }

    if (message.type !== 'count') {
      fail(protocolError(`unknown message type ${message.type}`))
      return
    }

    if (pending === undefined) {
      fail(protocolError('unexpected or duplicate count reply'))
      return
    }
    if (!isPositiveSafeInteger(message.requestId) || message.requestId !== pending.requestId) {
      fail(protocolError(`count reply requestId ${String(message.requestId)} does not match ${pending.requestId}`))
      return
    }
    if (
      !isPositiveSafeInteger(message.threadId)
      || message.threadId === parentThreadId
      || message.threadId !== readyThreadId
    ) {
      fail(protocolError('count reply has an invalid threadId'))
      return
    }
    if (!isNonnegativeSafeInteger(message.count)) {
      fail(protocolError('count reply has an invalid count'))
      return
    }
    if (!isNonnegativeFinite(message.queryMs)) {
      fail(protocolError('count reply has an invalid queryMs'))
      return
    }

    pending.resolve({
      count: message.count,
      workerQueryElapsedMs: message.queryMs,
      workerThreadId: message.threadId,
    })
  })
  worker.on('error', fail)
  worker.on('exit', (code) => {
    exited = true
    joinedExit.resolve(code)
    if (!terminationRequested && (code !== 0 || !closed)) {
      fail(new Error(`Legacy-object inspection worker exited with code ${code}.`))
    }
  })

  const startupTimer = setTimeout(() => {
    fail(new Error(`Legacy-object inspection startup timed out after ${startupTimeoutMs}ms.`))
  }, startupTimeoutMs)
  try {
    await ready.promise
  } catch (error) {
    await terminateAndJoin().catch(() => undefined)
    throw error
  } finally {
    clearTimeout(startupTimer)
  }

  return {
    /** Runs one worker-side prepare/get under the bounded count timeout. */
    count() {
      if (closed) return Promise.reject(new Error('Legacy-object inspection is closed.'))
      if (failure !== undefined) return Promise.reject(failure)
      if (pendingPromise !== undefined) {
        return Promise.reject(new Error('Legacy-object inspection already has a request in flight.'))
      }

      const requestId = ++nextRequestId
      let timer: ReturnType<typeof setTimeout> | undefined
      const operation = new Promise<LegacyObjectInspectionResult>((resolve, reject) => {
        pending = { requestId, resolve, reject }
        timer = setTimeout(() => {
          fail(new Error(`Legacy-object inspection count request timed out after ${countTimeoutMs}ms.`))
        }, countTimeoutMs)
        try {
          worker.postMessage({ type: 'count', requestId })
        } catch (error) {
          fail(error)
        }
      })
      const result = operation.finally(() => {
        if (timer !== undefined) clearTimeout(timer)
        if (pending?.requestId === requestId) pending = undefined
        pendingPromise = undefined
      })
      pendingPromise = result
      return result
    },

    /** Closes cooperatively when idle, or cancels, terminates, and joins otherwise. */
    close() {
      if (closePromise !== undefined) return closePromise
      const pendingAtClose = pending
      const operationAtClose = pendingPromise
      closed = true

      closePromise = (async () => {
        let closeTimer: ReturnType<typeof setTimeout> | undefined
        try {
          if (pendingAtClose !== undefined) {
            pendingAtClose.reject(failure ?? new Error('Legacy-object inspection was closed.'))
            if (pending?.requestId === pendingAtClose.requestId) pending = undefined
          }

          if (pendingAtClose !== undefined || failure !== undefined) {
            await terminateAndJoin().catch((error) => {
              if (failure === undefined) failure = asError(error)
            })
          } else if (!exited) {
            const closeTimedOut = new Promise<void>((resolve) => {
              closeTimer = setTimeout(() => {
                if (failure === undefined) {
                  failure = new Error(`Legacy-object inspection close timed out after ${closeTimeoutMs}ms.`)
                }
                void terminateAndJoin().catch(() => undefined)
                resolve()
              }, closeTimeoutMs)
            })
            try {
              worker.postMessage({ type: 'close' })
              await Promise.race([joinedExit.promise.then(() => undefined), closeTimedOut])
              if (!exited) await joinedExit.promise
            } catch (error) {
              fail(error)
              await terminateAndJoin().catch((terminationError) => {
                if (failure === undefined) failure = asError(terminationError)
              })
            }
          }

          await operationAtClose?.catch(() => undefined)
          await joinedExit.promise
          if (failure !== undefined) throw failure
        } finally {
          if (closeTimer !== undefined) clearTimeout(closeTimer)
        }
      })()
      return closePromise
    },
  }
}
