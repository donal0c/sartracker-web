import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ serviceWorkers: 'block' })
await context.route('**/*', route => {
  const url = new URL(route.request().url())
  if (url.pathname === '/audit-blank') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Isolated stationary projection timing</title>' })
  return ['127.0.0.1', 'localhost'].includes(url.hostname) ? route.continue() : route.abort()
})
const page = await context.newPage()
try {
  await page.goto('http://127.0.0.1:1439/audit-blank')
  await page.bringToFront()
  const output = await page.evaluate(async () => {
    const { createBreadcrumbAccumulator } = await import('/src/features/tracking/breadcrumb-accumulator.ts')
    const { createStationaryAttentionProjector } = await import('/src/features/tracking/stationary-attention-projection.ts')
    const { DEFAULT_STATIONARY_ATTENTION_CONFIG: config } = await import('/src/features/tracking/stationary-attention.ts')
    const fix = (device, index) => ({ id: String(device * 100_000 + index + 1), device_id: String(device + 1),
      lat: 52 + Math.sin(index / 50) / 100, lon: -9.7 + Math.cos(index / 50) / 100,
      timestamp: new Date(Date.parse('2026-08-22T10:00:00.000Z') + Math.floor(index / 420) * 86_400_000 + (index % 420) * 100_000).toISOString(),
      timestamp_source: 'fix', fix_time_unverified: false, accuracy: 4, altitude: null, speed: null, battery: null,
      source: 'osmand', data_origin: 'live', cache_age_seconds: null, device_cache_stale: false })
    const devices = Array.from({ length: 100 }, (_, index) => ({ device_id: String(index + 1), name: String(index + 1),
      status: 'online', last_seen: null, unique_id: null, category: null, group_id: null }))
    const raw = Array.from({ length: 5_000 }, (_, index) => devices.map((_, device) => fix(device, index))).flat()
    const frames = []
    const longTasks = []
    let recording = true
    function recordFrame(timestamp) {
      if (recording) {
        frames.push({ timestamp, callbackAt: performance.now() })
        requestAnimationFrame(recordFrame)
      }
    }
    requestAnimationFrame(recordFrame)
    const observer = new PerformanceObserver(list => {
      for (const entry of list.getEntries()) longTasks.push({ startTime: entry.startTime, duration: entry.duration })
    })
    observer.observe({ type: 'longtask', buffered: true })
    function prepare() {
      const accumulator = createBreadcrumbAccumulator(raw)
      const before = accumulator.snapshot()
      const projector = createStationaryAttentionProjector()
      projector.project({ devices, breadcrumbs: before.positions, positions: [] }, config)
      return { accumulator, before, projector }
    }
    async function measure(phase, operation) {
      await new Promise(resolve => setTimeout(resolve, 300))
      await new Promise(requestAnimationFrame)
      const windowStart = performance.now()
      const firstFrameIndex = Math.max(0, frames.length - 1)
      const stats = await new Promise(resolve => setTimeout(() => resolve(operation()), 0))
      const operationFinishedAt = performance.now()
      await new Promise(resolve => setTimeout(resolve, 120))
      const windowEnd = performance.now()
      // Always include the frame immediately before the operation; filtering
      // by timestamp proximity could discard the very gap being measured.
      const sampledFrames = frames.slice(firstFrameIndex)
      const callbackGaps = sampledFrames.slice(1).map((frame, index) =>
        frame.callbackAt - sampledFrames[index].callbackAt)
      const timestampGaps = sampledFrames.slice(1).map((frame, index) =>
        frame.timestamp - sampledFrames[index].timestamp)
      const overlappingLongTasks = longTasks.filter(task => task.startTime >= windowStart && task.startTime <= windowEnd)
      return { phase, ...stats, maximumRafGapMs: Math.max(0, ...callbackGaps, ...timestampGaps),
        maximumCallbackGapMs: Math.max(0, ...callbackGaps), maximumFrameTimestampGapMs: Math.max(0, ...timestampGaps),
        sampledFrameGaps: callbackGaps.length,
        postOperationFrameObserved: sampledFrames.some(frame => frame.callbackAt >= operationFinishedAt),
        operationStartedAtMs: windowStart, operationFinishedAtMs: operationFinishedAt,
        firstCallbackAtMs: sampledFrames[0]?.callbackAt, lastCallbackAtMs: sampledFrames.at(-1)?.callbackAt,
        callbackGapsMs: callbackGaps, frameTimestampGapsMs: timestampGaps,
        maximumLongTaskMs: Math.max(0, ...overlappingLongTasks.map(task => task.duration)), longTasks: overlappingLongTasks }
    }
    const samples = []
    let state = prepare()
    samples.push(await measure('unchanged-control', () => {
      const start = performance.now()
      const result = state.projector.project({ devices, breadcrumbs: state.before.positions, positions: [] }, config)
      return { projectionMs: performance.now() - start, deviceCount: result.size, beforeCount: state.before.positions.length }
    }))
    samples.push(await measure('current-only-all-devices', () => {
      const start = performance.now()
      const result = state.projector.project({ devices, breadcrumbs: state.before.positions,
        positions: devices.map((_, device) => fix(device, 5_000)) }, config)
      return { projectionMs: performance.now() - start, deviceCount: result.size,
        beforeCount: state.before.positions.length }
    }))
    for (let repeat = 1; repeat <= 3; repeat++) {
      state = prepare()
      samples.push(await measure(`compaction-${repeat}`, () => {
        const start = performance.now()
        const after = state.accumulator.append([fix(0, 5_000)])
        const afterAppend = performance.now()
        const result = state.projector.project({ devices, breadcrumbs: after.positions, positions: [] }, config)
        const finish = performance.now()
        if (after.positions.length !== 499_983 || result.size !== 100) throw new Error('Unexpected production fixture boundary')
        return { appendMs: afterAppend - start, projectionMs: finish - afterAppend, totalSynchronousMs: finish - start,
          deviceCount: result.size, beforeCount: state.before.positions.length, afterCount: after.positions.length }
      }))
    }
    recording = false
    observer.disconnect()
    return { evidence: 'Real production accumulator/projector in Chromium renderer on an isolated blank local page. Fixture generated inside renderer; construction and initial projection excluded from timing windows. One unchanged control, one all-device current-only update and exactly three one-device compaction repeats. Synthetic, non-packaged; not a release-gate run.',
      fixture: { devices: 100, retainedPerDevice: 5000, dailyOutingFixes: 420, secondsBetweenFixes: 100, rawCount: raw.length },
      userAgent: navigator.userAgent, samples }
  })
  await mkdir('output/repair-train-a', { recursive: true })
  await writeFile(`output/repair-train-a/stationary-renderer-${Date.now()}.json`, JSON.stringify(output, null, 2))
  if (output.samples.some(sample => sample.maximumRafGapMs >= 200)) throw new Error('AUD-03: renderer frame gap exceeded 200 ms')
  if (output.samples.some(sample => sample.sampledFrameGaps === 0)) throw new Error('AUD-03: renderer timing did not capture frames')
  if (output.samples.some(sample => !sample.postOperationFrameObserved)) throw new Error('AUD-03: renderer timing did not capture a post-operation frame')
  console.log(JSON.stringify(output, null, 2))
} finally { await context.close(); await browser.close() }
