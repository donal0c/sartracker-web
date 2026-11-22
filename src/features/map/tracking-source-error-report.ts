/**
 * Reports, for the packaged WAR-06 probe only, the errors the map's tracking
 * source has raised since the map was created (DON-353). A rejected worker
 * update leaves the source looking settled with its old data, so without this
 * the probe could read a stale zero as proof. Write-only: nothing in the
 * product reads it.
 *
 * The product attaches it itself, straight after creating the map, because a
 * probe cannot get a script into a packaged app's first window before the page
 * loads. Only the latest entries are kept, so an error that repeats over a
 * long mission cannot grow memory.
 *
 * The entries belong to the current map and go with it. A count of every
 * tracking-source error since the page loaded is kept beside them and never
 * reset or removed, so an error just before the map is torn down and
 * recreated is still seen.
 */

/** How many of the latest tracking-source errors are kept. */
export const TRACKING_SOURCE_ERROR_REPORT_LIMIT = 20

const TRACKING_SOURCE_ID = 'tracking'
const MESSAGE_LIMIT = 200

type ReportingWindow = Window & {
  __SARTRACKER_TRACKING_SOURCE_ERRORS__?: string[]
  __SARTRACKER_TRACKING_SOURCE_ERROR_COUNT__?: number
}

type ErrorListener = (event: unknown) => void

/** The part of a MapLibre map this needs: its error events. */
export interface ErrorEventedMap {
  on(type: 'error', listener: ErrorListener): unknown
  off(type: 'error', listener: ErrorListener): unknown
}

/**
 * Reads a map error event's source id and message, whatever shape it has.
 *
 * @param event the event MapLibre fired
 * @returns the source id, if any, and the error text
 */
function describeError(event: unknown): { sourceId: unknown, message: string } {
  const fields = typeof event === 'object' && event !== null ? event as { sourceId?: unknown, error?: unknown } : {}
  const error = fields.error
  const message = error instanceof Error
    ? error.message
    : typeof error === 'string' && error !== '' ? error : 'unknown error'
  return { sourceId: fields.sourceId, message: message.slice(0, MESSAGE_LIMIT) }
}

/**
 * Starts a fresh report for a newly created map and records its
 * tracking-source errors there until stopped.
 *
 * @param map the map, before any source is added to it
 * @returns a function that stops listening and removes this map's entries,
 *   unless a newer map's have replaced them; the page-lifetime count stays
 */
export function reportTrackingSourceErrors(map: ErrorEventedMap): () => void {
  if (typeof window === 'undefined') return () => undefined
  const reportingWindow = window as ReportingWindow
  const errors: string[] = []
  reportingWindow.__SARTRACKER_TRACKING_SOURCE_ERRORS__ = errors
  // Page-lifetime: started once, never reset, never removed.
  if (typeof reportingWindow.__SARTRACKER_TRACKING_SOURCE_ERROR_COUNT__ !== 'number') {
    reportingWindow.__SARTRACKER_TRACKING_SOURCE_ERROR_COUNT__ = 0
  }
  const listener: ErrorListener = (event) => {
    const { sourceId, message } = describeError(event)
    if (sourceId !== TRACKING_SOURCE_ID) return
    reportingWindow.__SARTRACKER_TRACKING_SOURCE_ERROR_COUNT__ = (reportingWindow.__SARTRACKER_TRACKING_SOURCE_ERROR_COUNT__ ?? 0) + 1
    errors.push(message)
    if (errors.length > TRACKING_SOURCE_ERROR_REPORT_LIMIT) errors.splice(0, errors.length - TRACKING_SOURCE_ERROR_REPORT_LIMIT)
  }
  map.on('error', listener)
  return () => {
    map.off('error', listener)
    if (reportingWindow.__SARTRACKER_TRACKING_SOURCE_ERRORS__ === errors) {
      delete reportingWindow.__SARTRACKER_TRACKING_SOURCE_ERRORS__
    }
  }
}
