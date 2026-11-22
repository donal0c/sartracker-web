import { afterEach, describe, expect, it } from 'vitest'

import { reportTrackingSourceErrors } from '../../src/features/map/tracking-source-error-report'
import {
  readTrackingSourceInPage,
  summarizeSurfaceSamples,
  trackingNodesHiddenInCatalog,
} from '../../scripts/war06-surface-observation.mjs'

/**
 * Stands in for the renderer window, with the given properties assigned as
 * the product assigns them. A published map comes with the product's empty
 * tracking-source error report unless the properties say otherwise.
 */
function pageWindow(props: Record<string, unknown> = {}): Record<string, unknown> {
  const page: Record<string, unknown> = {}
  ;(globalThis as unknown as { window?: unknown }).window = page
  if (props.__SARTRACKER_MAP__ !== undefined) page.__SARTRACKER_TRACKING_SOURCE_ERRORS__ = []
  Object.assign(page, props)
  return page
}

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
    pageWindow({ __SARTRACKER_MAP__: map, __SARTRACKER_TRACKING_VISIBLE__: trackingVisible })
  }
  const features = [
    { properties: { featureKind: 'device', dataOrigin: 'cache', attention: true } },
    { properties: { featureKind: 'device', dataOrigin: 'live' } },
    { properties: { featureKind: 'breadcrumb' } },
  ]
  const stableSource = { loaded: () => true, getData: () => Promise.resolve({ features }) }
  const sourceMap = { getSource: () => stableSource }

  it('no map is not drawn, not a zero', async () => {
    pageWindow()
    expect(await readTrackingSourceInPage()).toEqual({ state: 'not-drawn', reason: 'no map' })
  })

  it('no tracking source is not drawn, not a zero', async () => {
    withMap({ getSource: () => undefined })
    expect(await readTrackingSourceInPage()).toEqual({ state: 'not-drawn', reason: 'no tracking source' })
  })

  it('a source that throws is unreadable', async () => {
    const failing = { loaded: () => true, getData: () => Promise.reject(new Error('boom')) }
    withMap({ getSource: () => failing })
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

  it('a non-boolean visibility value is unconfirmed, never ready', async () => {
    withMap(sourceMap, 'true')
    expect(await readTrackingSourceInPage()).toMatchObject({ state: 'unconfirmed' })
  })

  it('unknown tracking visibility is unconfirmed, never ready', async () => {
    pageWindow({ __SARTRACKER_MAP__: sourceMap })
    expect(await readTrackingSourceInPage()).toMatchObject({ state: 'unconfirmed', fixes: 2 })
  })
})

describe('WAR-06 pending source updates [DON-353]', () => {
  const win = globalThis as unknown as { window?: Record<string, unknown> }
  afterEach(() => { delete win.window })
  const device = { properties: { featureKind: 'device', dataOrigin: 'live' } }

  /**
   * Behaves like MapLibre's GeoJSON source: updateData() queues the change,
   * loaded() is false until the worker finishes, and getData() keeps returning
   * the old payload until then.
   */
  function delayedSource() {
    let data: { features: unknown[] } = { features: [] }
    let pending: { features: unknown[] } | null = null
    return {
      loaded: () => pending === null,
      getData: () => Promise.resolve(data),
      updateData: (next: { features: unknown[] }) => { pending = next },
      finishUpdate: () => { if (pending !== null) { data = pending; pending = null } },
    }
  }

  it('a pending update is blind, not a zero; once it completes the reading is ready', async () => {
    const source = delayedSource()
    const page = pageWindow({ __SARTRACKER_MAP__: { getSource: () => source } })
    source.updateData({ features: [device] })
    page.__SARTRACKER_TRACKING_VISIBLE__ = true
    expect(await readTrackingSourceInPage()).toMatchObject({ state: 'pending', fixes: 0 })
    source.finishUpdate()
    expect(await readTrackingSourceInPage()).toEqual({ state: 'ready', fixes: 1, cache: 0, attention: 0 })
  })

  it('an update that starts during the read is blind', async () => {
    const source = delayedSource()
    const map = { getSource: () => source }
    pageWindow({ __SARTRACKER_MAP__: map, __SARTRACKER_TRACKING_VISIBLE__: true })
    const read = source.getData
    source.getData = () => { source.updateData({ features: [device] }); return read() }
    expect(await readTrackingSourceInPage()).toMatchObject({ state: 'pending' })
  })

  it('a source replaced during the read is unreadable', async () => {
    let current = { loaded: () => true, getData: () => { current = { ...current }; return Promise.resolve({ features: [] }) } }
    pageWindow({ __SARTRACKER_MAP__: { getSource: () => current }, __SARTRACKER_TRACKING_VISIBLE__: true })
    expect(await readTrackingSourceInPage()).toMatchObject({ state: 'unreadable' })
  })

  it('a visibility report that changes during the read is not ready', async () => {
    const page = pageWindow({ __SARTRACKER_TRACKING_VISIBLE__: true, __SARTRACKER_TRACKING_SOURCE_ERRORS__: [] })
    const changing = { loaded: () => true, getData: () => { page.__SARTRACKER_TRACKING_VISIBLE__ = false; return Promise.resolve({ features: [] }) } }
    page.__SARTRACKER_MAP__ = { getSource: () => changing }
    expect(await readTrackingSourceInPage()).toMatchObject({ state: 'hidden' })
  })

  it('a source that cannot say whether an update is pending is blind', async () => {
    const silent = { getData: () => Promise.resolve({ features: [] }) }
    pageWindow({ __SARTRACKER_MAP__: { getSource: () => silent }, __SARTRACKER_TRACKING_VISIBLE__: true })
    expect(await readTrackingSourceInPage()).toMatchObject({ state: 'pending' })
  })

  it('pending readings count as blind in the summary', () => {
    const zeroAt = (at: number) => ({ state: 'ready', at, doneAt: at + 10, currentFixCount: 0, cachedDeviceCount: 0 })
    const summary = summarizeSurfaceSamples([zeroAt(0), { state: 'pending', at: 50, doneAt: 60, currentFixCount: 0, cachedDeviceCount: 0 }, zeroAt(3_000)], { startedAt: 0, endedAt: 3_020 })
    expect(summary.longestGapMs).toBe(3_010)
    expect(summary.pendingCount).toBe(1)
  })
})

describe('WAR-06 failed source updates [DON-353]', () => {
  const win = globalThis as unknown as { window?: Record<string, unknown> }
  afterEach(() => { delete win.window })

  /** A minimal evented object, like MapLibre's map and sources. */
  function evented<T extends object>(body: T) {
    const listeners: Record<string, Array<(event: unknown) => void>> = {}
    return Object.assign(body, {
      on: (type: string, listener: (event: unknown) => void) => { (listeners[type] ??= []).push(listener) },
      off: (type: string, listener: (event: unknown) => void) => { listeners[type] = (listeners[type] ?? []).filter((each) => each !== listener) },
      fire: (type: string, event: unknown) => { for (const listener of listeners[type] ?? []) listener(event) },
    })
  }

  /**
   * Behaves like MapLibre 5.22 when the worker rejects an update: the source
   * stops being busy (loaded() is true again), keeps its old payload, and fires
   * an error that the map re-fires with the source id.
   */
  function rejectingSetup() {
    let pending = false
    const map = evented({ getSource: (): unknown => source })
    const source = evented({
      loaded: () => !pending,
      getData: () => Promise.resolve({ features: [] }),
      updateData: () => { pending = true },
      rejectUpdate: (message: string) => {
        pending = false
        const event = { error: new Error(message) }
        source.fire('error', event)
        map.fire('error', { ...event, sourceId: 'tracking' })
      },
    })
    // The product's own report, attached as use-map-instance.ts attaches it.
    pageWindow({ __SARTRACKER_TRACKING_VISIBLE__: true })
    reportTrackingSourceErrors(map)
    ;(globalThis as unknown as { window: Record<string, unknown> }).window.__SARTRACKER_MAP__ = map
    return { map, source }
  }

  it('a rejected worker update fails the reading with its error, never a ready zero', async () => {
    const { source } = rejectingSetup()
    expect(await readTrackingSourceInPage()).toMatchObject({ state: 'ready', fixes: 0 })
    source.updateData()
    source.rejectUpdate('worker could not parse the update')
    const reading = await readTrackingSourceInPage()
    expect(reading).toMatchObject({ state: 'failed' })
    expect((reading as { reason: string }).reason).toContain('worker could not parse the update')
  })

  it('stays failed after the source settles again, until the observation ends', async () => {
    const { source } = rejectingSetup()
    await readTrackingSourceInPage()
    source.rejectUpdate('boom')
    await readTrackingSourceInPage()
    expect(await readTrackingSourceInPage()).toMatchObject({ state: 'failed' })
  })

  it('ignores errors from other sources', async () => {
    const { map } = rejectingSetup()
    await readTrackingSourceInPage()
    map.fire('error', { error: new Error('tile 404'), sourceId: 'basemap' })
    expect(await readTrackingSourceInPage()).toMatchObject({ state: 'ready' })
  })

  it('a rejection before the first sample still fails the first reading', async () => {
    const { source } = rejectingSetup()
    source.updateData()
    source.rejectUpdate('rejected before anyone looked')
    expect(await readTrackingSourceInPage()).toMatchObject({ state: 'failed', reason: expect.stringContaining('rejected before anyone looked') })
  })

  it('a recreated map is reported from the moment it is created', async () => {
    rejectingSetup()
    const page = (globalThis as unknown as { window: Record<string, unknown> }).window
    expect(await readTrackingSourceInPage()).toMatchObject({ state: 'ready' })
    // As use-map-instance.ts does on teardown and remount.
    delete page.__SARTRACKER_TRACKING_SOURCE_ERRORS__
    delete page.__SARTRACKER_MAP__
    expect(await readTrackingSourceInPage()).toMatchObject({ state: 'not-drawn', reason: 'no map' })
    const next = evented({ getSource: (): unknown => nextSource })
    const nextSource = { loaded: () => true, getData: () => Promise.resolve({ features: [] }) }
    reportTrackingSourceErrors(next)
    page.__SARTRACKER_MAP__ = next
    next.fire('error', { error: new Error('rejected on the new map'), sourceId: 'tracking' })
    expect(await readTrackingSourceInPage()).toMatchObject({ state: 'failed', reason: expect.stringContaining('rejected on the new map') })
  })

  it('a map without the error report is never trusted', async () => {
    pageWindow({ __SARTRACKER_TRACKING_VISIBLE__: true })
    const page = (globalThis as unknown as { window: Record<string, unknown> }).window
    page.__SARTRACKER_MAP__ = evented({ getSource: () => ({ loaded: () => true, getData: () => Promise.resolve({ features: [] }) }) })
    expect(await readTrackingSourceInPage()).toMatchObject({ state: 'uncaptured' })
  })

  it('a malformed error report is never trusted', async () => {
    pageWindow({ __SARTRACKER_MAP__: { getSource: () => undefined }, __SARTRACKER_TRACKING_SOURCE_ERRORS__: 'boom' })
    expect(await readTrackingSourceInPage()).toMatchObject({ state: 'uncaptured' })
  })

  it('counts readings taken without the renderer error report [DON-353]', () => {
    const zeroAt = (at: number) => ({ state: 'ready', at, doneAt: at + 10, currentFixCount: 0, cachedDeviceCount: 0 })
    const samples = [zeroAt(0), { state: 'uncaptured', at: 50, doneAt: 60 }, zeroAt(100)]
    expect(summarizeSurfaceSamples(samples, { startedAt: 0, endedAt: 120 }).uncapturedCount).toBe(1)
  })

  it('a failed reading fails the summary with the error text', () => {
    const zeroAt = (at: number) => ({ state: 'ready', at, doneAt: at + 10, currentFixCount: 0, cachedDeviceCount: 0 })
    const samples = [zeroAt(0), { state: 'failed', at: 50, doneAt: 60, map: { reason: 'the tracking source reported an error: boom' } }, zeroAt(100)]
    const summary = summarizeSurfaceSamples(samples, { startedAt: 0, endedAt: 120 })
    expect(summary.trackingSourceErrors).toEqual(['the tracking source reported an error: boom'])
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
