/**
 * Watches the map's tracking GeoJSON source for worker updates that fail
 * (DON-357). MapLibre applies `setData`/`updateData` asynchronously in a
 * worker; when the worker rejects an update the source keeps its old data and
 * only fires an `error` event, so the call that sent it never learns. Without
 * this watch the map kept drawing old positions as if they were current.
 *
 * Recovery is strict. A diff dispatched after a failure was built against data
 * the source never applied, so its success proves nothing. Only a full
 * replacement sent after the failure, and dispatched after that point, counts.
 * MapLibre runs one worker dispatch at a time and starts each with a
 * `dataloading` event, so counting those tells which dispatch a later `data`
 * event belongs to.
 *
 * Even then the worker holding the data is not the map drawing it. MapLibre's
 * own reload after a full replacement skips tiles that errored earlier, so a
 * tile that failed stays blank. Once the replacement is applied every visible
 * tile is reloaded, errored ones included, and the failure clears only when
 * none is still loading and none failed since. A tile that fails to load is
 * itself a failure: positions in it are not drawn.
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

/** The map's visible tiles for the tracking source. */
export type TrackingSourceTiles = {
  /** Reloads every visible tile, errored ones included (`map.refreshTiles`). */
  readonly refresh: () => void
  /** True when no visible tile is still loading (`map.isSourceLoaded`). */
  readonly settled: () => boolean
}

export type TrackingSourceUpdateWatchOptions = {
  /**
   * A failure is already showing from an earlier source. A new source's first
   * dispatch carries full data (and may have started before this watch could
   * listen), so its first success clears it.
   */
  readonly startFailed: boolean
  readonly tiles: TrackingSourceTiles
  readonly onFailure: (message: string) => void
  readonly onRecovered: () => void
}

const MESSAGE_LIMIT = 200

/** Shown when the source has no events to watch, so failures could go unseen. */
export const UNWATCHABLE_SOURCE_MESSAGE = 'the map tracking source cannot report failed updates'

/**
 * Reads a source error event's message, whatever shape it has.
 *
 * @param event the event MapLibre fired
 * @returns the error text, bounded
 */
function describeSourceError(event: unknown): string {
  const error = typeof event === 'object' && event !== null ? (event as { error?: unknown }).error : undefined
  return describeError(error)
}

/**
 * Reads an error's message, whatever shape it has.
 *
 * @param error what was thrown or reported
 * @returns the error text, bounded
 */
function describeError(error: unknown): string {
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
  // Without its events a rejected update would go unseen. Never skip the
  // watch quietly: report it, so the alarm says the map may be out of date.
  if (typeof source.on !== 'function' || typeof source.off !== 'function') {
    options.onFailure(UNWATCHABLE_SOURCE_MESSAGE)
    return { needsFullResync: () => true, noteFullResync: () => {}, stop: () => {} }
  }

  let dispatches = 0
  let failed = options.startFailed
  // Dispatch count at the moment the full replacement was sent; null while
  // none has been sent since the latest failure.
  let resyncAfter: number | null = options.startFailed ? -1 : null
  // The replacement is applied; waiting for every visible tile to redraw it.
  let awaitingTiles = false
  let stopped = false

  const fail = (message: string) => {
    failed = true
    resyncAfter = null
    awaitingTiles = false
    options.onFailure(message)
  }
  const recoverIfDrawn = () => {
    if (!failed || !awaitingTiles || !options.tiles.settled()) return
    failed = false
    resyncAfter = null
    awaitingTiles = false
    options.onRecovered()
  }
  const reloadTiles = () => {
    if (stopped || !awaitingTiles) return
    try {
      options.tiles.refresh()
    } catch (error) {
      fail(describeError(error))
      return
    }
    recoverIfDrawn()
  }

  const onDataLoading: SourceListener = (event) => {
    // Tile requests also fire `dataloading` on the source; they carry a tile.
    if (readField(event, 'tile') !== undefined) return
    dispatches += 1
  }
  const onData: SourceListener = (event) => {
    if (readField(event, 'tile') !== undefined) {
      recoverIfDrawn()
      return
    }
    if (readField(event, 'sourceDataType') !== 'content') return
    if (!failed || awaitingTiles || resyncAfter === null || dispatches <= resyncAfter) return
    awaitingTiles = true
    // After MapLibre's own handler for this event has started its reload, so
    // this reload of every tile is the one that counts.
    queueMicrotask(reloadTiles)
  }
  const onError: SourceListener = (event) => {
    fail(describeSourceError(event))
  }

  source.on('dataloading', onDataLoading)
  source.on('data', onData)
  source.on('error', onError)
  // A tile dropped from view while loading will not fire `data`.
  source.on('dataabort', recoverIfDrawn)

  return {
    needsFullResync: () => failed && resyncAfter === null,
    noteFullResync: () => {
      if (failed) resyncAfter = dispatches
    },
    stop: () => {
      stopped = true
      source.off('dataloading', onDataLoading)
      source.off('data', onData)
      source.off('error', onError)
      source.off('dataabort', recoverIfDrawn)
    },
  }
}
