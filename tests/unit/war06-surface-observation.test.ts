import { afterEach, describe, expect, it } from 'vitest'

import { readTrackingSourceInPage, summarizeSurfaceSamples, trackingNodesHiddenInCatalog } from '../../scripts/war06-surface-observation.mjs'

/** A ready reading of zero, read from `at` to `doneAt`. */
const zero = (at: number, doneAt = at + 10) => ({ state: 'ready', at, doneAt, currentFixCount: 0, cachedDeviceCount: 0 })
const notDrawn = (at: number, doneAt = at + 5) => ({ state: 'not-drawn', at, doneAt })

describe('WAR-06 blind stretches [DON-353]', () => {
  it('measures from the first ready reading and reports startup apart', () => {
    const summary = summarizeSurfaceSamples([notDrawn(0), notDrawn(5_000), zero(9_000), zero(9_050)], { startedAt: 0, actionStartedAt: 9_100, endedAt: 9_100 })
    expect(summary.startupMs).toBe(9_010)
    expect(summary.readyBeforeAction).toBe(true)
    expect(summary.longestGapMs).toBe(60)
  })

  it('a first ready reading after the action began is not ready before it', () => {
    const summary = summarizeSurfaceSamples([notDrawn(0), zero(500)], { startedAt: 0, actionStartedAt: 100, endedAt: 600 })
    expect(summary.readyBeforeAction).toBe(false)
  })

  it('counts the stretch after the last reading', () => {
    const summary = summarizeSurfaceSamples([zero(0), zero(50)], { startedAt: 0, endedAt: 10_050 })
    expect(summary.longestGapMs).toBe(10_000)
  })

  it('counts a slow read from the previous reading\'s start to its completion', () => {
    const summary = summarizeSurfaceSamples([zero(0), zero(100, 5_100), zero(5_150)], { startedAt: 0, endedAt: 5_200 })
    expect(summary.longestGapMs).toBe(5_100)
  })

  it('after the first ready reading, no map or source is missing evidence', () => {
    const samples = [zero(0), notDrawn(50), notDrawn(5_000), notDrawn(10_000), zero(10_050)]
    const summary = summarizeSurfaceSamples(samples, { startedAt: 0, endedAt: 10_070 })
    expect(summary.longestGapMs).toBe(10_060)
    expect(summary.notDrawnAfterReadyCount).toBe(3)
  })

  it('losing the tracking source after readiness is blind to the end', () => {
    const summary = summarizeSurfaceSamples([zero(0), notDrawn(100), notDrawn(3_000)], { startedAt: 0, endedAt: 3_010 })
    expect(summary.longestGapMs).toBe(3_010)
  })

  it('treats unreadable, hidden and unconfirmed readings as blind', () => {
    const samples = [
      zero(0),
      { state: 'unreadable', at: 50, doneAt: 60 },
      { state: 'hidden', at: 1_000, doneAt: 1_010, currentFixCount: 0, cachedDeviceCount: 0 },
      { state: 'unconfirmed', at: 2_000, doneAt: 2_010, currentFixCount: 0, cachedDeviceCount: 0 },
      zero(3_000),
    ]
    const summary = summarizeSurfaceSamples(samples, { startedAt: 0, endedAt: 3_020 })
    expect(summary.longestGapMs).toBe(3_010)
    expect(summary.readableCount).toBe(2)
    expect(summary.hiddenCount).toBe(1)
    expect(summary.unconfirmedCount).toBe(1)
  })

  it('a ready reading without counts is invalid, not a proven zero', () => {
    const summary = summarizeSurfaceSamples([zero(0), { state: 'ready', at: 50, doneAt: 60 }], { startedAt: 0, endedAt: 3_000 })
    expect(summary.readableCount).toBe(1)
    expect(summary.invalidCount).toBe(1)
    expect(summary.longestGapMs).toBe(3_000)
  })

  it('a whole observation with no ready reading is blind throughout', () => {
    const summary = summarizeSurfaceSamples([{ state: 'unreadable', at: 0, doneAt: 5 }], { startedAt: 0, endedAt: 4_000 })
    expect(summary.longestGapMs).toBe(4_000)
    expect(summary.readableCount).toBe(0)
    expect(summary.startupMs).toBeNull()
    expect(summary.readyBeforeAction).toBe(false)
    expect(summary.maxCurrentFixCount).toBeNull()
  })

  it('an untimed entry is neither proof nor coverage', () => {
    const summary = summarizeSurfaceSamples([zero(0), { state: 'ready', currentFixCount: 0, cachedDeviceCount: 0 }], { startedAt: 0, endedAt: 3_000 })
    expect(summary.readableCount).toBe(1)
    expect(summary.untimedCount).toBe(1)
    expect(summary.longestGapMs).toBe(3_000)
  })

  it('a drawn position counts towards the maxima whatever the visibility reading', () => {
    const samples = [zero(0), { state: 'unconfirmed', at: 50, doneAt: 60, currentFixCount: 2, cachedDeviceCount: 1 }]
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
  const withMap = (map: unknown, trackingVisible: unknown = true) => {
    win.window = { __SARTRACKER_MAP__: map, __SARTRACKER_TRACKING_VISIBLE__: trackingVisible }
  }
  const features = [
    { properties: { featureKind: 'device', dataOrigin: 'cache', attention: true } },
    { properties: { featureKind: 'device', dataOrigin: 'live' } },
    { properties: { featureKind: 'breadcrumb' } },
  ]
  const sourceMap = { getSource: () => ({ getData: () => Promise.resolve({ features }) }) }

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
    withMap(sourceMap)
    expect(await readTrackingSourceInPage()).toEqual({ state: 'ready', fixes: 2, cache: 1, attention: 1 })
  })

  it('tracking hidden on the map is hidden, never ready', async () => {
    withMap(sourceMap, false)
    expect(await readTrackingSourceInPage()).toMatchObject({ state: 'hidden', fixes: 2 })
  })

  it('unknown tracking visibility is unconfirmed, never ready', async () => {
    win.window = { __SARTRACKER_MAP__: sourceMap }
    expect(await readTrackingSourceInPage()).toMatchObject({ state: 'unconfirmed', fixes: 2 })
  })
})

describe('WAR-06 saved tracking visibility [DON-353]', () => {
  it('reads the IPC field names and names the entries that hide tracking positions', () => {
    expect(trackingNodesHiddenInCatalog([
      { nodeId: 'group:tracking', isVisible: false },
      { nodeId: 'layer:tracking:devices', isVisible: true },
      { nodeId: 'device:3', parentNodeId: 'layer:tracking:devices', isVisible: false },
      { nodeId: 'layer:tracking:breadcrumbs', isVisible: false },
      { nodeId: 'group:helicopters', isVisible: false },
    ])).toEqual(['group:tracking', 'device:3'])
  })

  it('a visible catalog hides nothing', () => {
    expect(trackingNodesHiddenInCatalog([{ nodeId: 'layer:tracking:devices', isVisible: true }])).toEqual([])
  })

  it('refuses an entry it cannot read rather than calling it visible', () => {
    expect(() => trackingNodesHiddenInCatalog([{ node_id: 'group:tracking', is_visible: 0 }])).toThrow(/cannot be read/u)
  })
})
