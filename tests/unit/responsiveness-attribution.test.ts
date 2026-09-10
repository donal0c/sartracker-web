import { describe, expect, it } from 'vitest'
import { installRealmResponsivenessProbe, validateAttributionEvidence } from '../../build/responsiveness-attribution-lib.js'
import { startResponsivenessAttribution } from '../../build/responsiveness-attribution-node.js'

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
