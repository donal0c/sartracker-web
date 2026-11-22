import { afterEach, describe, expect, it } from 'vitest'

import { readTrackingSourceInPage, summarizeSurfaceSamples, trackingNodesHiddenInCatalog } from '../../scripts/war06-surface-observation.mjs'

/** A ready reading of zero, read from `at` to `doneAt`. */
const zero = (at: number, doneAt = at + 10) => ({ state: 'ready', at, doneAt, currentFixCount: 0, cachedDeviceCount: 0 })

describe('WAR-06 blind stretches [DON-353]', () => {
  it('counts the stretch before the first reading', () => {
    const summary = summarizeSurfaceSamples([zero(10_000), zero(10_050)], { startedAt: 0, endedAt: 10_100 })
    expect(summary.longestGapMs).toBe(10_010)
  })

  it('counts the stretch after the last reading', () => {
    const summary = summarizeSurfaceSamples([zero(0), zero(50)], { startedAt: 0, endedAt: 10_050 })
    expect(summary.longestGapMs).toBe(10_000)
  })

  it('counts a slow read from the previous reading\'s start to its completion', () => {
    const summary = summarizeSurfaceSamples([zero(0), zero(100, 5_100), zero(5_150)], { startedAt: 0, endedAt: 5_200 })
    expect(summary.longestGapMs).toBe(5_100)
  })

  it('treats unreadable readings as blind', () => {
    const samples = [zero(0), { state: 'unreadable', at: 50, doneAt: 60 }, { state: 'unreadable', at: 2_000, doneAt: 2_010 }, zero(3_000)]
    const summary = summarizeSurfaceSamples(samples, { startedAt: 0, endedAt: 3_020 })
    expect(summary.longestGapMs).toBe(3_010)
    expect(summary.unreadableCount).toBe(2)
  })

  it('a whole observation with no reading is blind throughout', () => {
    const summary = summarizeSurfaceSamples([{ state: 'unreadable', at: 0, doneAt: 5 }], { startedAt: 0, endedAt: 4_000 })
    expect(summary.longestGapMs).toBe(4_000)
    expect(summary.readableCount).toBe(0)
    expect(summary.maxCurrentFixCount).toBeNull()
  })

  it('an untimed entry is neither proof nor coverage', () => {
    const summary = summarizeSurfaceSamples([zero(0), { state: 'ready', currentFixCount: 0, cachedDeviceCount: 0 }], { startedAt: 0, endedAt: 3_000 })
    expect(summary.readableCount).toBe(1)
    expect(summary.untimedCount).toBe(1)
    expect(summary.longestGapMs).toBe(3_000)
  })

  it('no map or source covers the moment but is never a proven zero', () => {
    const samples = [{ state: 'not-drawn', at: 0, doneAt: 5 }, { state: 'not-drawn', at: 1_000, doneAt: 1_005 }, zero(1_900)]
    const summary = summarizeSurfaceSamples(samples, { startedAt: 0, endedAt: 1_950 })
    expect(summary.longestGapMs).toBeLessThanOrEqual(2_000)
    expect(summary.readableCount).toBe(1)
    expect(summary.notDrawnCount).toBe(2)
  })

  it('takes maxima from ready readings only', () => {
    const samples = [zero(0), { state: 'ready', at: 50, doneAt: 60, currentFixCount: 2, cachedDeviceCount: 1 }]
    const summary = summarizeSurfaceSamples(samples, { startedAt: 0, endedAt: 70 })
    expect(summary.maxCurrentFixCount).toBe(2)
    expect(summary.maxCachedDeviceCount).toBe(1)
  })

  it('a warning returned by the action is a sighting but not a reading', () => {
    const summary = summarizeSurfaceSamples([zero(0)], { startedAt: 0, endedAt: 20 }, 'Cache discarded', 'Cache discarded')
    expect(summary.discardWarningObserved).toBe(true)
    expect(summary.sampleCount).toBe(1)
  })

  it('refuses an observation without a start and end', () => {
    expect(() => summarizeSurfaceSamples([zero(0)], { startedAt: Number.NaN, endedAt: 10 })).toThrow(/no valid start and end/u)
  })
})

describe('WAR-06 tracking source reading [DON-353]', () => {
  const win = globalThis as unknown as { window?: unknown }
  afterEach(() => { delete win.window })
  const withMap = (map: unknown) => { win.window = { __SARTRACKER_MAP__: map } }

  it('no map is not drawn, not a zero', async () => {
    win.window = {}
    expect(await readTrackingSourceInPage()).toEqual({ state: 'not-drawn', reason: 'no map' })
  })

  it('no tracking source is not drawn, not a zero', async () => {
    withMap({ getSource: () => undefined })
    expect(await readTrackingSourceInPage()).toEqual({ state: 'not-drawn', reason: 'no tracking source' })
  })

  it('a source that throws is unreadable', async () => {
    withMap({ getSource: () => ({ getData: () => Promise.reject(new Error('boom')) }) })
    expect(await readTrackingSourceInPage()).toEqual({ state: 'unreadable', reason: 'boom' })
  })

  it('counts one device point per position, with cache origin and attention', async () => {
    const features = [
      { properties: { featureKind: 'device', dataOrigin: 'cache', attention: true } },
      { properties: { featureKind: 'device', dataOrigin: 'live' } },
      { properties: { featureKind: 'breadcrumb' } },
    ]
    withMap({ getSource: () => ({ getData: () => Promise.resolve({ features }) }) })
    expect(await readTrackingSourceInPage()).toEqual({ state: 'ready', fixes: 2, cache: 1, attention: 1 })
  })
})

describe('WAR-06 saved tracking visibility [DON-353]', () => {
  it('names the entries that hide tracking positions and nothing else', () => {
    expect(trackingNodesHiddenInCatalog([
      { node_id: 'group:tracking', is_visible: 0 },
      { node_id: 'layer:tracking:devices', is_visible: 1 },
      { node_id: 'device:3', parent_node_id: 'layer:tracking:devices', is_visible: 0 },
      { node_id: 'layer:tracking:breadcrumbs', is_visible: 0 },
      { node_id: 'group:helicopters', is_visible: 0 },
    ])).toEqual(['group:tracking', 'device:3'])
  })

  it('a visible catalog hides nothing', () => {
    expect(trackingNodesHiddenInCatalog([{ node_id: 'layer:tracking:devices', is_visible: 1 }])).toEqual([])
  })
})
