import { performance as nodePerformance, PerformanceObserver } from 'node:perf_hooks'
import { setImmediate as nextNodeTurn } from 'node:timers/promises'

/** Retains bounded causal evidence for a heartbeat without changing its clock or gate. */
export function observeHeartbeatWork() {
  type Span = { start: number; duration: number }
  type Inspection = Span & { kind: 'open' | 'count' }
  const clockOffset = nodePerformance.now() - performance.now()
  const recentGc: Span[] = []
  const recentInspections: Inspection[] = []
  let previousThreadCpu = process.threadCpuUsage?.()
  let previousProcessCpu = process.cpuUsage()
  let previousElu = nodePerformance.eventLoopUtilization()
  let maximumInspectionQueryMs: number | null = null
  let inspectionOpenMs: number | null = null
  let largestGap: (Span & {
    threadCpuMs: number | null
    processCpuMs: number
    eventLoop: ReturnType<typeof nodePerformance.eventLoopUtilization>
    inspections: Inspection[]
    gc: Span[]
  }) | null = null
  /** Caps retained history independently of test duration. */
  function retain<T>(entries: T[], entry: T) {
    entries.push(entry)
    if (entries.length > 64) entries.shift()
  }
  /** Uses interval overlap so asynchronously delivered GC remains attributable. */
  function overlaps(left: Span, right: Span) {
    return left.start < right.start + right.duration && left.start + left.duration > right.start
  }
  /** Aligns Node GC timestamps with the existing jsdom heartbeat clock. */
  function recordGc(entries: readonly { startTime: number; duration: number }[]) {
    for (const entry of entries) {
      const gc = { start: entry.startTime - clockOffset, duration: entry.duration }
      retain(recentGc, gc)
      if (largestGap !== null && overlaps(gc, largestGap)) retain(largestGap.gc, gc)
    }
  }
  const observer = new PerformanceObserver((list) => recordGc(list.getEntries()))
  observer.observe({ entryTypes: ['gc'] })
  return {
    /** Associates CPU and loop activity with the unchanged caller-owned interval. */
    heartbeat(start: number, end: number) {
      const threadCpu = previousThreadCpu === undefined ? undefined : process.threadCpuUsage(previousThreadCpu)
      const processCpu = process.cpuUsage(previousProcessCpu)
      const eventLoop = nodePerformance.eventLoopUtilization(previousElu)
      const gap = { start, duration: end - start }
      if (largestGap === null || gap.duration > largestGap.duration) {
        largestGap = { ...gap, threadCpuMs: threadCpu === undefined ? null : (threadCpu.user + threadCpu.system) / 1_000,
          processCpuMs: (processCpu.user + processCpu.system) / 1_000, eventLoop,
          inspections: recentInspections.filter((span) => overlaps(span, gap)),
          gc: recentGc.filter((span) => overlaps(span, gap)) }
      }
      previousThreadCpu = process.threadCpuUsage?.()
      previousProcessCpu = process.cpuUsage()
      previousElu = nodePerformance.eventLoopUtilization()
    },
    /** Measures the same synchronous inspector operation, including native SQLite time. */
    inspect<T>(kind: Inspection['kind'], operation: () => T): T {
      const start = performance.now()
      try { return operation() } finally {
        const span = { kind, start, duration: performance.now() - start }
        retain(recentInspections, span)
        if (kind === 'open') inspectionOpenMs = span.duration
        else maximumInspectionQueryMs = Math.max(maximumInspectionQueryMs ?? 0, span.duration)
      }
    },
    /** Drains asynchronous GC only after the caller stops its measurement timer. */
    async finish() {
      await nextNodeTurn()
      await nextNodeTurn()
      recordGc(observer.takeRecords())
      observer.disconnect()
      return { inspectionOpenMs, maximumInspectionQueryMs, largestGap }
    },
  }
}
