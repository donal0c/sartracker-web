/**
 * Watches the map's tracking GeoJSON source for worker updates that fail
 * (DON-357). MapLibre applies `setData`/`updateData` asynchronously in a
 * worker; when the worker rejects an update the source keeps its old data and
 * only fires an `error` event, so the call that sent it never learns. Without
 * this watch the map kept drawing old positions as if they were current.
 *
 * Recovery is strict. A diff dispatched after a failure was built against data
 * the source never applied, so its success proves nothing. Only a full
 * replacement sent after the failure, and dispatched after that point, clears
 * it. MapLibre runs one worker dispatch at a time and starts each with a
 * `dataloading` event, so counting those tells which dispatch a later `data`
 * event belongs to.
 */

type SourceListener = (event: unknown) => void

/** The part of a MapLibre GeoJSON source this needs: its own events. */
export interface UpdateEventedSource {
  on(type: string, listener: SourceListener): unknown
  off(type: string, listener: SourceListener): unknown
}

export type TrackingSourceUpdateWatch = {
  /** True after a failed update until a full replacement has been sent. */
  readonly needsFullResync: () => boolean
  /** Call immediately before sending the source its full data. */
  readonly noteFullResync: () => void
  /** Stops listening to the source. */
  readonly stop: () => void
}

export type TrackingSourceUpdateWatchOptions = {
  /**
   * A failure is already showing from an earlier source. A new source's first
   * dispatch carries full data (and may have started before this watch could
   * listen), so its first success clears it.
   */
  readonly startFailed: boolean
  readonly onFailure: (message: string) => void
  readonly onRecovered: () => void
}

const MESSAGE_LIMIT = 200

/**
 * Reads a source error event's message, whatever shape it has.
 *
 * @param event the event MapLibre fired
 * @returns the error text, bounded
 */
function describeSourceError(event: unknown): string {
  const error = typeof event === 'object' && event !== null ? (event as { error?: unknown }).error : undefined
  const message = error instanceof Error
    ? error.message
    : typeof error === 'string' && error !== '' ? error : 'unknown error'
  return message.slice(0, MESSAGE_LIMIT)
}

/**
 * Reads a field from an event object without trusting its shape.
 *
 * @param event the event MapLibre fired
 * @param field the field to read
 * @returns the field's value, or undefined
 */
function readField(event: unknown, field: string): unknown {
  return typeof event === 'object' && event !== null ? (event as Record<string, unknown>)[field] : undefined
}

/**
 * Starts watching one tracking source's worker updates.
 *
 * @param source the map's tracking GeoJSON source
 * @param options what to report and whether a failure is already showing
 * @returns the watch, used by the sync to decide when to resend everything
 */
export function watchTrackingSourceUpdates(
  source: UpdateEventedSource,
  options: TrackingSourceUpdateWatchOptions,
): TrackingSourceUpdateWatch {
  let dispatches = 0
  let failed = options.startFailed
  // Dispatch count at the moment the full replacement was sent; null while
  // none has been sent since the latest failure.
  let resyncAfter: number | null = options.startFailed ? -1 : null

  const onDataLoading: SourceListener = (event) => {
    // Tile requests also fire `dataloading` on the source; they carry a tile.
    if (readField(event, 'tile') !== undefined) return
    dispatches += 1
  }
  const onData: SourceListener = (event) => {
    if (readField(event, 'sourceDataType') !== 'content') return
    if (!failed || resyncAfter === null || dispatches <= resyncAfter) return
    failed = false
    resyncAfter = null
    options.onRecovered()
  }
  const onError: SourceListener = (event) => {
    failed = true
    resyncAfter = null
    options.onFailure(describeSourceError(event))
  }

  source.on('dataloading', onDataLoading)
  source.on('data', onData)
  source.on('error', onError)

  return {
    needsFullResync: () => failed && resyncAfter === null,
    noteFullResync: () => {
      if (failed) resyncAfter = dispatches
    },
    stop: () => {
      source.off('dataloading', onDataLoading)
      source.off('data', onData)
      source.off('error', onError)
    },
  }
}
