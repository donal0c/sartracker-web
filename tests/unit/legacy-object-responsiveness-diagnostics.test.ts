import { performance as nodePerformance, PerformanceObserver, type PerformanceEntry } from 'node:perf_hooks'

import { afterEach, describe, expect, it, vi } from 'vitest'
import { observeHeartbeatWork } from '../support/legacy-object-responsiveness-diagnostics'

describe('legacy object responsiveness diagnostics controls [DON-277]', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns an inspection result and preserves an inspection exception', async () => {
    const diagnostics = observeHeartbeatWork()
    try {
      expect(diagnostics.inspect('open', () => 'opened')).toBe('opened')
      const failure = new Error('inspection failed')
      expect(() => diagnostics.inspect('count', () => { throw failure })).toThrow(failure)
    } finally {
      await diagnostics.finish()
    }
  })

  it('retains the inspection span overlapping the largest heartbeat and keeps CPU scopes distinct', async () => {
    const diagnostics = observeHeartbeatWork()
    try {
      const inspectionStart = performance.now()
      expect(diagnostics.inspect('count', () => 42)).toBe(42)
      const inspectionEnd = performance.now()
      diagnostics.heartbeat(inspectionStart - 1, inspectionEnd + 100)
      const report = await diagnostics.finish()

      expect(report.largestGap).toEqual(expect.objectContaining({
        inspections: [expect.objectContaining({ start: expect.any(Number), duration: expect.any(Number) })],
        processCpuMs: expect.any(Number),
        eventLoop: expect.any(Object),
      }))
      expect(report.largestGap).toHaveProperty('threadCpuMs')
      expect(report.largestGap?.threadCpuMs === null || typeof report.largestGap?.threadCpuMs === 'number').toBe(true)
    } finally {
      await diagnostics.finish()
    }
  })

  it('includes a GC span delivered during finish in the largest heartbeat overlap', async () => {
    const gcNodeStart = nodePerformance.now()
    vi.spyOn(PerformanceObserver.prototype, 'takeRecords').mockReturnValue([
      { startTime: gcNodeStart, duration: 5 } as PerformanceEntry,
    ])
    const diagnostics = observeHeartbeatWork()
    try {
      const heartbeatStart = performance.now()
      diagnostics.heartbeat(heartbeatStart - 25, heartbeatStart + 100)
      const report = await diagnostics.finish()

      expect(report.largestGap?.gc).toEqual(expect.arrayContaining([
        expect.objectContaining({ start: expect.any(Number), duration: 5 }),
      ]))
    } finally {
      await diagnostics.finish()
    }
  })
})
