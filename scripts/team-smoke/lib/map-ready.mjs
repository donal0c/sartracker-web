/**
 * Waits until the app's MapLibre map has actually drawn [DON-288].
 *
 * A .maplibregl-canvas element exists as soon as the map is created, long
 * before its style and tiles are loaded; under software rendering on the test
 * box that took about a minute. MapLibre's own loaded()/areTilesLoaded() also
 * count errored tiles as done, so a map whose every request failed would pass
 * them. Checks that screenshot "the map" therefore wait for the style plus at
 * least one tile loaded with data, read through the `window.__SARTRACKER_MAP__`
 * handle the app exposes.
 */

import { delay } from './app.mjs'
import { NotTested } from './results.mjs'

/**
 * Reads the map's load flags and basemap tile states. Self-contained: it runs inside
 * the page. Tile states come from MapLibre internals (`style.tileManagers`,
 * 5.x); when they cannot be read, `tiles` is null rather than a guess.
 *
 * @param {any} [win] the page's window
 * @returns {{canvas: boolean, mapExposed: boolean, styleLoaded: boolean, tilesLoaded: boolean, loaded: boolean,
 *   tiles: {loaded: number, errored: number, other: number} | null}}
 */
export function readMapLoadState(win = globalThis) {
  const BASEMAP_SOURCE_TYPES = new Set(['raster', 'vector', 'raster-dem'])
  const canvas = win.document?.querySelector('.maplibregl-canvas') != null
  const map = win.__SARTRACKER_MAP__
  const flag = (read) => {
    try {
      return read() === true
    } catch {
      return false
    }
  }
  if (map === undefined || map === null) {
    return { canvas, mapExposed: false, styleLoaded: false, tilesLoaded: false, loaded: false, tiles: null }
  }
  let tiles = null
  try {
    const managers = map.style?.tileManagers
    if (managers !== undefined && managers !== null) {
      tiles = { loaded: 0, errored: 0, other: 0 }
      for (const manager of Object.values(managers)) {
        // Only basemap sources: overlays are GeoJSON, whose tiles load even when empty.
        if (manager?.used === false || !BASEMAP_SOURCE_TYPES.has(manager.getSource()?.type)) continue
        for (const id of manager.getIds()) {
          const state = manager.getTileByID(id)?.state
          if (state === 'loaded') tiles.loaded += 1
          else if (state === 'errored') tiles.errored += 1
          else tiles.other += 1
        }
      }
    }
  } catch {
    tiles = null
  }
  return {
    canvas,
    mapExposed: true,
    styleLoaded: flag(() => map.isStyleLoaded()),
    tilesLoaded: flag(() => map.areTilesLoaded()),
    loaded: flag(() => map.loaded()),
    tiles,
  }
}

/**
 * Polls until the map is loaded with at least one tile holding data, or the
 * time is up. A page briefly unreachable (reloading) is polled again; a page
 * that cannot be read at all until the deadline is missing evidence.
 *
 * @param {{evaluate: (fn: (win?: any) => any) => Promise<any>}} page
 * @param {{timeoutMs?: number, intervalMs?: number, readTimeoutMs?: number}} [options]
 * @returns {Promise<{ready: boolean, waitedMs: number, state: ReturnType<typeof readMapLoadState>}>}
 * @throws {NotTested} when the page could not be read before the deadline
 */
export async function waitForMapDrawn(page, { timeoutMs = 90_000, intervalMs = 1000, readTimeoutMs = 5000 } = {}) {
  const startedAt = Date.now()
  let state = null
  let readError = null
  for (;;) {
    try {
      state = await boundedRead(page, readTimeoutMs)
      readError = null
    } catch (error) {
      readError = error
    }
    if (readError === null && isDrawn(state)) return { ready: true, waitedMs: Date.now() - startedAt, state }
    if (Date.now() - startedAt >= timeoutMs) break
    await delay(intervalMs)
  }
  if (readError !== null) {
    throw new NotTested(`The map's load state could not be read: ${readError?.message ?? readError}`)
  }
  if (state.loaded && state.tiles === null) {
    throw new NotTested('The map loaded but its basemap tile states could not be read (MapLibre internals changed?).')
  }
  return { ready: false, waitedMs: Date.now() - startedAt, state }
}

/**
 * Reads the map state, giving up after `readTimeoutMs` without leaving a
 * pending rejection behind (the runner fails a check on any stray rejection).
 */
function boundedRead(page, readTimeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`page did not answer within ${readTimeoutMs / 1000} s`)), readTimeoutMs)
    page.evaluate(readMapLoadState).then(
      (value) => { clearTimeout(timer); resolve(value) },
      (error) => { clearTimeout(timer); reject(error) },
    )
  })
}

/** True when the canvas exists, the style and tiles are settled and some tile has data. */
function isDrawn(state) {
  return state.canvas && state.loaded && state.tilesLoaded && state.tiles !== null && state.tiles.loaded > 0
}

/**
 * Says what never finished loading, for a FAIL row.
 *
 * @param {ReturnType<typeof readMapLoadState>} state
 * @param {number} timeoutMs
 * @returns {string}
 */
export function describeMapNotDrawn(state, timeoutMs) {
  const tiles = state.tiles === null
    ? '; tile states unreadable'
    : `; tiles: ${state.tiles.loaded} loaded, ${state.tiles.errored} errored, ${state.tiles.other} other`
  const detail = !state.mapExposed
    ? 'no map was created'
    : `${state.canvas ? '' : 'no map canvas, '}${state.styleLoaded ? 'style loaded' : 'style still loading'}, `
      + `${state.tilesLoaded ? 'tiles loaded' : 'tiles still loading'}${tiles}`
  return `the map did not finish loading within ${Math.round(timeoutMs / 1000)} s (${detail})`
}
