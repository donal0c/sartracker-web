import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import config from '../../playwright.config'
import { installRealmResponsivenessProbe, installPointerAttribution } from '../../build/responsiveness-attribution-lib.js'
import * as diagnostics from '../../build/responsiveness-attribution-node.js'
import { createPressureTimeline } from '../../build/responsiveness-pressure-timeline.js'

describe('responsiveness review regressions [DON-254]', () => {
  it('isolates Electron controls from the display-free Chromium release gate', () => {
    const chromium = config.projects!.find(project => project.name === 'chromium')!
    expect(chromium.testIgnore).toContain('**/electron/**')
    const electron = config.projects!.find(project => project.name === 'electron-controls')!
    expect(electron.testMatch).toBe('**/electron/**/*.spec.ts')
    const workflow = readFileSync('.github/workflows/electron-linux-validation.yml', 'utf8')
    expect(workflow).toMatch(/xvfb-run[^\n]*\\\n\s+npx playwright test --project=electron-controls/)
  })

  it('freezes both wall and monotonic stop clocks across delayed cleanup', () => {
    const wall = vi.spyOn(Date, 'now').mockReturnValue(1000)
    try {
      const probe = installRealmResponsivenessProbe({ performance: { now: () => 100, timeOrigin: 0 }, setInterval: () => 1, clearInterval: () => {} })
      const first = probe.stop()
      wall.mockReturnValue(9000)
      expect(probe.stop()).toEqual(first)
    } finally { wall.mockRestore() }
  })

  it('keeps diagnostic rejection and timeout explicit without throwing away original results', async () => {
    vi.useFakeTimers()
    try {
      const rejected = await diagnostics.collectAttributionEvidence({ stop: async () => { throw new Error('private injected error') } })
      expect(rejected).toMatchObject({ collected: false, reason: 'collection-failed' })
      expect(JSON.stringify(rejected)).not.toContain('private')
      const waiting = diagnostics.collectAttributionEvidence({ stop: () => new Promise(() => {}) }, 12000)
      await vi.advanceTimersByTimeAsync(12000)
      expect(await waiting).toMatchObject({ collected: false, reason: 'collection-timeout' })
    } finally { vi.useRealTimers() }
  })

  it('allows a collection lasting more than the former two-second cleanup budget', async () => {
    vi.useFakeTimers()
    try {
      const collection = diagnostics.collectAttributionEvidence({ stop: () => new Promise(resolve => {
        setTimeout(() => resolve({ collected: true }), 3000)
      }) })
      await vi.advanceTimersByTimeAsync(3000)
      expect(await collection).toEqual({ collected: true })
    } finally { vi.useRealTimers() }
  })

  it('retains surviving channels when the main collector disconnects and stops only once', async () => {
    const realm = { timeOriginMs: 0, startedAtMs: 0, stoppedAtMs: 100, maximumGapMs: 50, samples: 2, events: [] }
    const readMain = vi.fn(async (expression: string) => {
      if (expression === 'globalThis.__SAR_ATTR_PROBE__.stop()') throw new Error('injected disconnect')
      return { result: { value: { nowMs: 10, timeOriginMs: 0 } } }
    })
    const probe = await diagnostics.startResponsivenessAttribution({ mainPid: process.pid,
      mainInspector: { evaluate: readMain },
      page: { evaluate: async (expression: unknown) => String(expression).includes('cadencedFrames:')
        ? { timer: realm, pointer: { events: [] } } : { nowMs: 10, timeOriginMs: 0 } },
    })
    const first = probe.stop()
    expect(probe.stop()).toBe(first)
    const result = await first
    expect(result).toMatchObject({ collected: false, reason: 'collection-failed', renderer: { timer: realm } })
    expect(JSON.parse(JSON.stringify(result)).completeness.mandatoryChannelsComplete).toBe(false)
    expect(readMain.mock.calls.filter(([expression]) => expression === 'globalThis.__SAR_ATTR_PROBE__.stop()')).toHaveLength(1)
  })

  it('retains whole-run pressure coverage instead of only a four-minute tail', () => {
    const timeline = createPressureTimeline()
    const total = 14 * 24 * 60 * 60 * 2
    for (let index = 0; index < total; index++) timeline.add({ startMs: index * 500, endMs: index * 500 + 1 })
    const result = timeline.snapshot()
    expect(result.samples.length).toBeLessThanOrEqual(512)
    expect(result.samples[0].startMs).toBe(0)
    expect(result.samples.at(-1).startMs).toBe((total - 1) * 500)
    expect(result.samples.some((sample: { startMs: number }) => sample.startMs > total * 200 && sample.startMs < total * 300)).toBe(true)
    expect(result.decimatedCount).toBe(total - result.samples.length)
    expect(result.maximumSpacingMs).toBeLessThan(2 * 60 * 60 * 1000)
  })

  it('hit-tests once per pointer event and signals an unregistered preflight', () => {
    let listener: (event: unknown) => void = () => {}
    const hit = vi.fn(() => null)
    const root = { performance: { now: () => 1, timeOrigin: 0 },
      __SAR_ATTR_LAST_PREFLIGHT__: { testId: 'changed-target' },
      document: { addEventListener: (_name: string, callback: typeof listener) => { listener = callback },
        removeEventListener: () => {}, querySelector: () => null, elementFromPoint: hit } }
    const probe = installPointerAttribution(root, ['first', 'second'])
    listener({ type: 'click', composedPath: () => [], clientX: 1, clientY: 1, isTrusted: true })
    expect(hit).toHaveBeenCalledTimes(1)
    expect(probe.stop().unregisteredPreflightCount).toBe(1)
  })

  it('does not treat a later unrelated click as a missing former action target', () => {
    let listener: (event: unknown) => void = () => {}
    const target = { getBoundingClientRect: () => ({ x: 0, y: 0, width: 10, height: 10 }), contains: () => false }
    let present = true
    const root = { performance: { now: () => 1, timeOrigin: 0 },
      __SAR_ATTR_LAST_PREFLIGHT__: { testId: 'close' },
      document: { addEventListener: (_name: string, callback: typeof listener) => { listener = callback },
        removeEventListener: () => {}, querySelector: () => present ? target : null, elementFromPoint: () => null } }
    const probe = installPointerAttribution(root, ['close'])
    const event = { type: 'click', composedPath: () => [target], clientX: 1, clientY: 1, isTrusted: true }
    listener(event)
    present = false
    listener({ ...event, composedPath: () => [] })
    expect(probe.stop().missingExpectedTargetCount).toBe(0)
  })

  it('never reports an uncollected original heartbeat as a successful empty channel', () => {
    const result = diagnostics.attachInspectorAttribution({ collected: true, completeness: { mandatoryChannelsComplete: true } }, undefined)
    expect(result).toMatchObject({ collected: false, reason: 'inspector-not-collected', inspectorCollection: { collected: false } })
    expect(result.inspectorRoundTrips).toBeUndefined()
    expect(result.inspectorDroppedEventCount).toBeUndefined()
    expect(JSON.parse(JSON.stringify(result)).completeness.mandatoryChannelsComplete).toBe(false)
  })
})
