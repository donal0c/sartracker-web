// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { describeMapNotDrawn, readMapLoadState, waitForMapDrawn } from '../../scripts/team-smoke/lib/map-ready.mjs'
import { NotTested } from '../../scripts/team-smoke/lib/results.mjs'

/**
 * DON-288: no-gpu-flag passed on the mere presence of .maplibregl-canvas and
 * screenshotted at once, so the box run (2 Oct 2026) saved a black
 * after-restart picture of a map that drew fully a minute later. The check now
 * waits until MapLibre reports the style loaded and at least one tile loaded
 * with data (errored tiles count as "loaded" to MapLibre itself).
 */

type TileState = 'loading' | 'loaded' | 'errored'

/** A MapLibre-like map with one used tile manager holding tiles in the given states. */
function map(loaded: boolean, tiles: TileState[], { style = true, tileManagers = true, overlay = [] as TileState[] } = {}) {
  const manager = (type: string, states: TileState[], used = true) => {
    const byId = Object.fromEntries(states.map((state, index) => [String(index), { state }]))
    return { used, getSource: () => ({ type }), getIds: () => Object.keys(byId), getTileByID: (id: string) => byId[id] }
  }
  return {
    loaded: () => loaded,
    areTilesLoaded: () => [...tiles, ...overlay].every((state) => state !== 'loading'),
    isStyleLoaded: () => style,
    style: tileManagers
      ? {
          tileManagers: {
            basemap: manager('raster', tiles),
            unused: manager('raster', ['errored'], false),
            tracking: manager('geojson', overlay),
          },
        }
      : {},
  }
}

type FakeMap = ReturnType<typeof map>
const windowWith = (current: FakeMap | undefined, canvas = true) =>
  ({ __SARTRACKER_MAP__: current, document: { querySelector: () => (canvas ? {} : null) } })

/** A Playwright-like page whose window's map changes over successive polls. */
function fakePage(sequence: (FakeMap | undefined)[]) {
  let calls = 0
  return {
    calls: () => calls,
    page: {
      evaluate: async (fn: (win: unknown) => unknown) => {
        const current = sequence[Math.min(calls, sequence.length - 1)]
        calls += 1
        return fn(windowWith(current))
      },
    },
  }
}

describe('readMapLoadState [DON-288]', () => {
  it('reports no map when the app has not exposed one', () => {
    expect(readMapLoadState(windowWith(undefined, false))).toEqual({
      canvas: false, mapExposed: false, styleLoaded: false, tilesLoaded: false, loaded: false, tiles: null,
    })
  })

  it('counts basemap tile states in used raster or vector sources only', () => {
    expect(readMapLoadState(windowWith(map(true, ['loaded', 'errored', 'loading'], { overlay: ['loaded'] })))).toEqual({
      canvas: true, mapExposed: true, styleLoaded: true, tilesLoaded: false, loaded: true,
      tiles: { loaded: 1, errored: 1, other: 1 },
    })
  })

  it('reports unreadable tile states as null rather than guessing', () => {
    expect(readMapLoadState(windowWith(map(true, ['loaded'], { tileManagers: false })))).toMatchObject({ tiles: null })
  })

  it('treats a map method that throws as not loaded, not as a crash', () => {
    const broken = { ...map(true, ['loaded']), loaded: () => { throw new Error('removed') } }
    expect(readMapLoadState(windowWith(broken))).toMatchObject({ mapExposed: true, loaded: false })
  })
})

describe('waitForMapDrawn [DON-288]', () => {
  it('does not accept a map that exists but is still loading tiles', async () => {
    const { page } = fakePage([map(false, ['loading'])])
    await expect(waitForMapDrawn(page, { timeoutMs: 60, intervalMs: 10 }))
      .resolves.toMatchObject({ ready: false, state: { mapExposed: true, tilesLoaded: false } })
  })

  it('does not accept a map whose every tile errored, though MapLibre calls it loaded', async () => {
    const { page } = fakePage([map(true, ['errored', 'errored'])])
    await expect(waitForMapDrawn(page, { timeoutMs: 60, intervalMs: 10 }))
      .resolves.toMatchObject({ ready: false, state: { loaded: true, tiles: { loaded: 0, errored: 2 } } })
  })

  it('does not let loaded overlay tiles stand in for a basemap whose tiles all errored', async () => {
    const { page } = fakePage([map(true, ['errored'], { overlay: ['loaded', 'loaded'] })])
    await expect(waitForMapDrawn(page, { timeoutMs: 40, intervalMs: 10 }))
      .resolves.toMatchObject({ ready: false, state: { tiles: { loaded: 0, errored: 1 } } })
  })

  it('is NotTested when the basemap tile states cannot be read', async () => {
    const { page } = fakePage([map(true, ['loaded'], { tileManagers: false })])
    const error = await waitForMapDrawn(page, { timeoutMs: 40, intervalMs: 10 }).catch((caught) => caught)
    expect(error).toBeInstanceOf(NotTested)
    expect(error.message).toContain('tile states')
  })

  it('waits through loading until style and some tiles are loaded with data', async () => {
    const { page, calls } = fakePage([undefined, map(false, ['loading']), map(true, ['loaded', 'errored'])])
    await expect(waitForMapDrawn(page, { timeoutMs: 1000, intervalMs: 5 }))
      .resolves.toMatchObject({ ready: true, state: { tiles: { loaded: 1, errored: 1 } } })
    expect(calls()).toBe(3)
  })

  it('is not ready while the map canvas is missing', async () => {
    const page = { evaluate: async (fn: (win: unknown) => unknown) => fn(windowWith(map(true, ['loaded']), false)) }
    await expect(waitForMapDrawn(page, { timeoutMs: 40, intervalMs: 10 })).resolves.toMatchObject({ ready: false })
  })

  it('is not ready when the app never exposes a map', async () => {
    const { page } = fakePage([undefined])
    await expect(waitForMapDrawn(page, { timeoutMs: 40, intervalMs: 10 }))
      .resolves.toMatchObject({ ready: false, state: { mapExposed: false } })
  })

  it('keeps polling when the page is briefly unreachable during load', async () => {
    let calls = 0
    const page = {
      evaluate: async (fn: (win: unknown) => unknown) => {
        calls += 1
        if (calls === 1) throw new Error('Execution context was destroyed')
        return fn(windowWith(map(true, ['loaded'])))
      },
    }
    await expect(waitForMapDrawn(page, { timeoutMs: 1000, intervalMs: 5 })).resolves.toMatchObject({ ready: true })
  })

  it('is NotTested, not a product failure, when the page cannot be read until the deadline', async () => {
    const page = { evaluate: async () => { throw new Error('Target closed') } }
    const error = await waitForMapDrawn(page, { timeoutMs: 40, intervalMs: 10 }).catch((caught) => caught)
    expect(error).toBeInstanceOf(NotTested)
    expect(error.message).toContain('Target closed')
  })

  it('bounds a page read that never answers', async () => {
    const page = { evaluate: () => new Promise(() => undefined) }
    const startedAt = Date.now()
    const error = await waitForMapDrawn(page, { timeoutMs: 50, intervalMs: 10, readTimeoutMs: 20 }).catch((caught) => caught)
    expect(error).toBeInstanceOf(NotTested)
    expect(Date.now() - startedAt).toBeLessThan(1000)
  })
})

describe('describeMapNotDrawn [DON-288]', () => {
  it('names what never finished loading', () => {
    expect(describeMapNotDrawn({ canvas: true, mapExposed: true, styleLoaded: true, tilesLoaded: false, loaded: false, tiles: { loaded: 0, errored: 0, other: 3 } }, 90_000))
      .toBe('the map did not finish loading within 90 s (style loaded, tiles still loading; tiles: 0 loaded, 0 errored, 3 other)')
    expect(describeMapNotDrawn({ canvas: true, mapExposed: true, styleLoaded: true, tilesLoaded: true, loaded: true, tiles: { loaded: 0, errored: 4, other: 0 } }, 90_000))
      .toBe('the map did not finish loading within 90 s (style loaded, tiles loaded; tiles: 0 loaded, 4 errored, 0 other)')
    expect(describeMapNotDrawn({ canvas: false, mapExposed: false, styleLoaded: false, tilesLoaded: false, loaded: false, tiles: null }, 90_000))
      .toBe('the map did not finish loading within 90 s (no map was created)')
  })
})
