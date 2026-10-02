import { describe, expect, it } from 'vitest'
import { extractStoragePhaseAttribution, installRealmResponsivenessProbe, mainStallWallWindows, validateAttributionEvidence } from '../../build/responsiveness-attribution-lib.js'
import { attachInspectorAttribution, startResponsivenessAttribution } from '../../build/responsiveness-attribution-node.js'

describe('responsiveness attribution [DON-254]', () => {
  it('cleans already-installed observers when a later realm install fails', async () => {
    const calls: string[] = []
    const probe = await startResponsivenessAttribution({
      mainPid: 1,
      mainInspector: { evaluate: async (expression: string) => { calls.push(expression); return { result: { value: {} } } } },
      page: { evaluate: async (expression: string) => { calls.push(expression); throw new Error('injected renderer install failure') } },
    })
    expect(await probe.stop()).toMatchObject({ collected: false, reason: 'installation-failed' })
    expect(calls.some(value => value.includes('__SAR_ATTR_PROBE__?.stop()'))).toBe(true)
    expect(calls.some(value => value.includes('__SAR_ATTR_POINTER__?.stop()'))).toBe(true)
  })
  it('rejects missing mandatory realm evidence instead of treating it as zero delay', () => {
    expect(() => validateAttributionEvidence({})).toThrow('incomplete')
  })
  it('retains the current inspector heartbeat shape without inventing dropped samples', () => {
    const evidence = { collected: true, completeness: { contextEvicted: false } }
    expect(attachInspectorAttribution(evidence, {
      roundTrips: [12, 18],
      errors: 1,
      failures: [{ controllerAtMs: 42 }],
    })).toMatchObject({
      inspectorRoundTrips: [12, 18],
      inspectorDroppedEventCount: 0,
      inspectorCollection: { collected: true, errors: 1 },
      completeness: { contextEvicted: false },
    })
  })
  it('rejects malformed clocks and reports evicted optional context', () => {
    const realm = { timeOriginMs: 0, startedAtMs: 0, stoppedAtMs: 100, maximumGapMs: 50, samples: 2, events: [], droppedEventCount: 0 }
    const evidence = { main: realm, controller: realm, renderer: { timer: realm, pointer: { events: [] } },
      anchors: ['main', 'renderer', 'main-end', 'renderer-end'].map(name => ({ realm: name, controllerBeforeMs: 0, controllerAfterMs: 1, remote: { nowMs: 0, timeOriginMs: 0 } })),
      droppedPressureCount: 1 }
    expect(validateAttributionEvidence(evidence).contextEvicted).toBe(true)
    expect(() => validateAttributionEvidence(evidence, true)).toThrow('incomplete')
    expect(() => validateAttributionEvidence({ ...evidence, main: { ...realm, samples: undefined } })).toThrow('incomplete')
    expect(() => validateAttributionEvidence({ ...evidence, anchors: evidence.anchors.slice(1) })).toThrow('incomplete')
  })
  it('retains a real event-loop gap independently of inspector timing', () => {
    let now = 0
    let tick = () => {}
    const root = {
      performance: { now: () => now, timeOrigin: 1234 },
      setInterval: (callback: () => void) => { tick = callback; return 1 },
      clearInterval: () => {},
    }
    const probe = installRealmResponsivenessProbe(root)
    now = 50; tick()
    now = 350; tick()
    const result = probe.stop()
    expect(result.maximumGapMs).toBe(300)
    expect(result.over200Count).toBe(1)
    expect(result.events[0]).toMatchObject({ startMs: 50, endMs: 350, gapMs: 300 })
    expect(result.timeOriginMs).toBe(1234)
  })

  it('bounds retained events without losing maximum or failure counts', () => {
    let now = 0
    let tick = () => {}
    const probe = installRealmResponsivenessProbe({
      performance: { now: () => now, timeOrigin: 0 },
      setInterval: (callback: () => void) => { tick = callback; return 1 },
      clearInterval: () => {},
    })
    for (let index = 0; index < 600; index++) { now += 250; tick() }
    const result = probe.stop()
    expect(result.events).toHaveLength(512)
    expect(result.droppedEventCount).toBe(88)
    expect(result.over200Count).toBe(600)
    expect(result.maximumGapMs).toBe(250)
  })

  it('includes the final incomplete interval and stops idempotently', () => {
    let now = 0
    let clears = 0
    const probe = installRealmResponsivenessProbe({
      performance: { now: () => now, timeOrigin: 0 },
      setInterval: () => 1,
      clearInterval: () => { clears++ },
    })
    now = 201
    expect(probe.stop().over200Count).toBe(1)
    expect(probe.stop().over200Count).toBe(1)
    expect(clears).toBe(1)
  })
})

/**
 * DON-313 / DON-324: the box soak (2 Oct 2026) had 39 of 47 main stalls in the
 * first minute, but the count-bounded rings had evicted that minute's GC and
 * storage context by the end. Stalls of 200 ms or more now keep their own
 * context, so a long run cannot evict it.
 */
describe('stall-anchored attribution [DON-313]', () => {
  /** A realm whose clock, timer and GC observer the test drives. */
  function drivenRealm() {
    let now = 0
    let tick = () => {}
    let emitGc: (entries: { startTime: number, duration: number }[]) => void = () => {}
    class PerformanceObserver {
      constructor(callback: (list: { getEntries: () => unknown[] }) => void) {
        emitGc = (entries) => callback({ getEntries: () => entries })
      }
      observe() {}
      disconnect() {}
    }
    const root = {
      performance: { now: () => now, timeOrigin: 0 },
      setInterval: (callback: () => void) => { tick = callback; return 1 },
      clearInterval: () => {},
      process: { getBuiltinModule: () => ({ PerformanceObserver }) },
    }
    return {
      probe: installRealmResponsivenessProbe(root),
      advance: (ms: number) => { now += ms; tick() },
      gc: (startTime: number, duration: number) => emitGc([{ startTime, duration }]),
      now: () => now,
    }
  }

  it('keeps an early stall and its GC after the rings have evicted them', () => {
    const realm = drivenRealm()
    realm.advance(50)
    realm.gc(100, 40) // delivered before the stall is seen
    realm.advance(300) // stall 50..350
    realm.gc(330, 15) // delivered after the stall, inside it
    for (let index = 0; index < 600; index++) { realm.gc(realm.now(), 1); realm.advance(120) }
    const result = realm.probe.stop()
    expect(result.droppedEventCount).toBeGreaterThan(0)
    expect(result.gc.droppedEventCount).toBeGreaterThan(0)
    expect(result.stalls[0]).toMatchObject({ startMs: 50, endMs: 350, gapMs: 300 })
    expect(result.stalls[0].gc).toEqual([{ startMs: 100, durationMs: 40 }, { startMs: 330, durationMs: 15 }])
    expect(result.droppedStallCount).toBe(0)
  })

  it('bounds the stall list and says how many it dropped', () => {
    const realm = drivenRealm()
    for (let index = 0; index < 1100; index++) realm.advance(250)
    const result = realm.probe.stop()
    expect(result.stalls).toHaveLength(1024)
    expect(result.droppedStallCount).toBe(76)
    // The earliest stalls are the ones kept: they are where startup trouble is.
    expect(result.stalls[0].startMs).toBe(0)
  })

  it('maps each launch main stall onto the wall clock the runtime log uses', () => {
    const main = { startedAtMs: 1_000, wallStartedAtMs: 1_790_940_775_000, stalls: [{ startMs: 19_000, endMs: 19_300 }] }
    expect(mainStallWallWindows([{ main }, undefined, { collected: false }])).toEqual([
      { startWallMs: 1_790_940_793_000, endWallMs: 1_790_940_793_300 },
    ])
  })

  it('keeps storage phases around each stall after the ring has evicted them', () => {
    const line = (event: string, atMs: number, durationMs: number) =>
      JSON.stringify({ event, ts: new Date(atMs).toISOString(), durationMs })
    const base = Date.parse('2026-10-02T11:33:00.000Z')
    const lines = [
      line('storage_tracking_positions_completed', base + 1_000, 240),
      line('storage_tracking_positions_completed', base + 9_000, 5),
      ...Array.from({ length: 600 }, (_, index) => line('storage_tracking_positions_completed', base + 60_000 + index * 100, 3)),
    ]
    const result = extractStoragePhaseAttribution(lines.join('\n'), {
      stallWindows: [{ startWallMs: base + 800, endWallMs: base + 1_100 }],
    })
    expect(result.droppedEventCount).toBeGreaterThan(0)
    expect(result.stallAnchored).toEqual([{
      startWallMs: base + 800, endWallMs: base + 1_100, droppedEventCount: 0,
      events: [{
        event: 'storage_tracking_positions_completed', wallMs: base + 1_000, durationMs: 240,
        phaseDurationMs: null, totalDurationMs: null, elapsedDurationMs: null,
      }],
    }])
  })

  it('anchors a backup by its logged phase or total duration, and counts what a full window drops (Codex)', () => {
    const base = Date.parse('2026-10-02T11:33:00.000Z')
    const at = (ms: number) => new Date(base + ms).toISOString()
    const lines = [
      // A 2 s copy phase ending 1.5 s after a 500–1000 ms stall.
      JSON.stringify({ event: 'storage_backup_copied', ts: at(2_500), phaseDurationMs: 2_000, elapsedDurationMs: 2_100 }),
      JSON.stringify({ event: 'storage_backup_completed', ts: at(3_000), totalDurationMs: 2_600 }),
      ...Array.from({ length: 70 }, (_, index) =>
        JSON.stringify({ event: 'storage_tracking_positions_completed', ts: at(20_000 + index), durationMs: 5 })),
    ]
    const result = extractStoragePhaseAttribution(lines.join('\n'), {
      stallWindows: [{ startWallMs: base + 500, endWallMs: base + 1_000 }, { startWallMs: base + 20_000, endWallMs: base + 20_100 }],
    })
    expect(result.stallAnchored?.[0]?.events.map((event: { event: string }) => event.event))
      .toEqual(['storage_backup_copied', 'storage_backup_completed'])
    // 69 of the 70 overlap (one ends exactly at the window start): 64 kept, 5 counted.
    expect(result.stallAnchored?.[1]).toMatchObject({ droppedEventCount: 5 })
    expect(result.stallAnchored?.[1]?.events).toHaveLength(64)
  })
})
