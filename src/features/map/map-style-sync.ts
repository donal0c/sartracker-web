import type maplibregl from 'maplibre-gl'

const INITIAL_RETRY_DELAY_MS = 50
const MAX_RETRY_DELAY_MS = 2_000
const PERSISTENT_FAILURE_THRESHOLD = 3

export type MapStyleSyncOptions = {
  readonly onStyleUnavailable?: () => void
  readonly onPersistentFailure?: (failure: MapStyleSyncFailure) => void
  readonly onSynchronized?: () => void
  readonly failureState?: MapStyleSyncFailureState
}

export type MapStyleSyncFailure = {
  readonly consecutiveFailures: number
  readonly errorClass: string
}

/** Mutable failure streak shared by registrations for the same overlay. */
export type MapStyleSyncFailureState = {
  consecutiveFailures: number
  persistentFailureReported: boolean
}

const SAFE_ERROR_CLASSES = new Set([
  'Error',
  'TypeError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'URIError',
  'EvalError',
  'AggregateError',
  'AbortError',
])

/**
 * Runs a map overlay sync as soon as the style structure can accept app-owned
 * sources and layers, without waiting for slow or unavailable basemap tiles.
 * Repeats on style/idle transitions so late mission data and basemap changes
 * cannot drop operational overlays.
 */
export function registerMapStyleSync(
  map: maplibregl.Map,
  synchronize: (signal: AbortSignal) => void | Promise<void>,
  options: MapStyleSyncOptions = {},
): () => void {
  const abortController = new AbortController()
  let disposed = false
  let synchronizationInFlight = false
  let synchronizationRequested = false
  let retryTimer: number | null = null
  let retryDelayMs = INITIAL_RETRY_DELAY_MS
  const failureState = options.failureState ?? {
    consecutiveFailures: 0,
    persistentFailureReported: false,
  }

  const clearRetry = () => {
    if (retryTimer !== null) {
      window.clearTimeout(retryTimer)
      retryTimer = null
    }
    retryDelayMs = INITIAL_RETRY_DELAY_MS
  }

  const scheduleRetry = () => {
    if (disposed || retryTimer !== null) {
      return
    }
    const delayMs = retryDelayMs
    retryDelayMs = Math.min(retryDelayMs * 2, MAX_RETRY_DELAY_MS)
    retryTimer = window.setTimeout(() => {
      retryTimer = null
      runIfReady()
    }, delayMs)
  }

  const runIfReady = () => {
    if (disposed) {
      return
    }
    if (synchronizationInFlight) {
      synchronizationRequested = true
      return
    }
    if (!hasStyleStructure(map)) {
      options.onStyleUnavailable?.()
      scheduleRetry()
      return
    }

    synchronizationInFlight = true
    try {
      const result = synchronize(abortController.signal)
      if (result !== undefined) {
        void Promise.resolve(result).then(completeSynchronization, failSynchronization)
        return
      }
      completeSynchronization()
    } catch (error) {
      failSynchronization(error)
    }
  }

  const completeSynchronization = () => {
    synchronizationInFlight = false
    if (disposed) {
      return
    }
    clearRetry()
    failureState.consecutiveFailures = 0
    if (synchronizationRequested) {
      synchronizationRequested = false
      runIfReady()
      return
    }
    failureState.persistentFailureReported = false
    try {
      options.onSynchronized?.()
    } catch {
      console.error('Map overlay synchronization recovery could not be recorded.')
    }
  }

  const failSynchronization = (error: unknown) => {
    synchronizationInFlight = false
    if (disposed) {
      return
    }
    synchronizationRequested = false
    console.error('Map overlay synchronization failed; retrying.')
    failureState.consecutiveFailures += 1
    if (
      failureState.consecutiveFailures >= PERSISTENT_FAILURE_THRESHOLD &&
      !failureState.persistentFailureReported
    ) {
      try {
        options.onPersistentFailure?.({
          consecutiveFailures: failureState.consecutiveFailures,
          errorClass: getSafeErrorClass(error),
        })
        failureState.persistentFailureReported = true
      } catch {
        console.error('Persistent map overlay warning could not be recorded; retrying.')
      }
    }
    scheduleRetry()
  }

  map.on('style.load', runIfReady)
  map.on('styledataloading', runIfReady)
  map.on('idle', runIfReady)
  runIfReady()

  return () => {
    disposed = true
    synchronizationRequested = false
    abortController.abort()
    clearRetry()
    map.off('style.load', runIfReady)
    map.off('styledataloading', runIfReady)
    map.off('idle', runIfReady)
  }
}

/** Returns true once the current style has created at least one base layer. */
function hasStyleStructure(map: maplibregl.Map): boolean {
  try {
    return (map.getStyle().layers?.length ?? 0) > 0
  } catch {
    return false
  }
}

/** Returns only a fixed JavaScript error name suitable for support diagnostics. */
function getSafeErrorClass(error: unknown): string {
  try {
    const isKnownError = error instanceof Error ||
      (typeof DOMException !== 'undefined' && error instanceof DOMException)
    if (isKnownError && SAFE_ERROR_CLASSES.has(error.name)) {
      return error.name
    }
  } catch {
    // A hostile error object must not prevent the synchronization retry path.
  }
  return 'UnknownError'
}
