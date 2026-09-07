const THREAD_ROLES = new Set([
  'CrBrowserMain', 'CrRendererMain', 'CrGpuMain', 'Compositor',
  'VizCompositorThread', 'DedicatedWorker thread', 'WorkerThread',
])
const TASK_NAMES = new Set([
  'ThreadControllerImpl::RunTask', 'Scheduler::RunTask',
  'GpuChannel::ExecuteDeferredRequest', 'CommandBuffer::Flush',
  'RendererRasterWorker', 'WebGL', 'RasterDecoderImpl::DoEndRasterCHROMIUM',
  'NativeViewGLSurfaceEGL:RealSwapBuffers', 'GrShaderCache::load',
  'GrShaderCache::store', 'TimerFire', 'FireAnimationFrame', 'FunctionCall',
  'Layout', 'Paint', 'MajorGC', 'MinorGC', 'ProxyMain::BeginMainFrame',
])
const MARK_NAMES = new Set([
  'sartracker-archive-finalize-start', 'sartracker-archive-finalize-end',
  'sartracker-archive-first-failure',
])

/** Keeps only finite numeric task timings and closed diagnostic names in bounded memory. */
export function createRenderTraceCollector({ capacity = 4096 } = {}) {
  if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 4096) {
    throw new Error('Render diagnostic capacity is invalid.')
  }
  const threads = new Map()
  const events = []
  const markers = new Map()
  let droppedEventCount = 0
  let droppedThreadCount = 0
  return {
    /** Accepts CDP records without retaining arbitrary arguments, URLs, or application text. */
    accept(records) {
      if (!Array.isArray(records)) return
      for (const event of records) {
        if (!event || !Number.isSafeInteger(event.pid) || !Number.isSafeInteger(event.tid)) continue
        const key = `${event.pid}:${event.tid}`
        if (event.ph === 'M' && event.name === 'thread_name' && THREAD_ROLES.has(event.args?.name)) {
          if (threads.has(key) || threads.size < 64) threads.set(key, event.args.name)
          else droppedThreadCount += 1
          continue
        }
        const marker = event.ph === 'I' && MARK_NAMES.has(event.name)
        if ((!marker && (event.ph !== 'X' || !TASK_NAMES.has(event.name)))
          || !Number.isFinite(event.ts) || event.ts < 0
          || (!marker && (!Number.isFinite(event.dur) || event.dur < 0))) continue
        const projected = {
          key, name: event.name, timestampUs: event.ts,
          durationUs: marker ? 0 : event.dur,
          threadDurationUs: Number.isFinite(event.tdur) && event.tdur >= 0 ? event.tdur : null,
        }
        if (marker) {
          if (!markers.has(event.name)) markers.set(event.name, projected)
          continue
        }
        let low = 0
        let high = events.length
        while (low < high) {
          const mid = (low + high) >>> 1
          if (events[mid].timestampUs + events[mid].durationUs <= projected.timestampUs + projected.durationUs) low = mid + 1
          else high = mid
        }
        events.splice(low, 0, projected)
        if (events.length > capacity) { events.shift(); droppedEventCount += 1 }
      }
    },
    /** Reports any truncation explicitly; unknown thread identities stay unclassified. */
    snapshot() {
      return {
        capacity, droppedEventCount, droppedThreadCount,
        truncated: droppedEventCount > 0 || droppedThreadCount > 0,
        markers: [...markers.values()].map(({ name, timestampUs }) => ({ name, timestampUs })),
        events: [...events].sort((left, right) => left.timestampUs - right.timestampUs)
          .map(({ key, ...event }) => ({ role: threads.get(key) ?? 'unclassified', ...event })),
      }
    },
  }
}

/** Owns a separate CDP trace session; collection cannot decide or replace the liveness verdict. */
export async function startRenderTraceDiagnostics(session, { timeoutMs = 10000 } = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000) {
    throw new Error('Render diagnostic timeout is invalid.')
  }
  const collector = createRenderTraceCollector()
  const onData = ({ value }) => collector.accept(value)
  let complete
  const completed = new Promise(resolve => { complete = resolve })
  session.on('Tracing.dataCollected', onData)
  session.once('Tracing.tracingComplete', complete)
  const startedAtMs = Date.now()
  let startSucceeded = false
  let endPromise
  let stopPromise
  let dataLossOccurred = null
  let captureStatus = 'incomplete'
  let endRequestedAtMs = null
  /** Bounds every diagnostic transport operation independently from the operator gate. */
  const bounded = async (operation) => {
    let timer
    try {
      return await Promise.race([
        Promise.resolve().then(operation),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Diagnostic deadline')), timeoutMs) }),
      ])
    } finally { clearTimeout(timer) }
  }
  try {
    await bounded(() => session.send('Tracing.start', {
      categories: 'gpu,toplevel,devtools.timeline,blink.user_timing',
      options: 'record-continuously', transferMode: 'ReportEvents',
    }))
    startSucceeded = true
  } catch { /* The closed status below records diagnostic failure without copying transport text. */ }
  /** Freezes the browser trace at first failure without waiting for later file publication. */
  const end = () => {
    endPromise ??= (async () => {
      endRequestedAtMs = Date.now()
      captureStatus = startSucceeded ? 'captured' : 'incomplete'
      try {
        await bounded(async () => {
          await session.send('Tracing.end')
          const completion = await completed
          dataLossOccurred = completion?.dataLossOccurred === true
          if (dataLossOccurred) captureStatus = 'incomplete'
        })
      } catch { captureStatus = 'incomplete' }
    })()
    return endPromise
  }
  return {
    end,
    /** Drains at most once, always detaches, and preserves an explicit incomplete status. */
    stop() {
      stopPromise ??= (async () => {
        try {
          await end()
        }
        finally {
          session.off('Tracing.dataCollected', onData)
          session.off('Tracing.tracingComplete', complete)
          try { await bounded(() => session.detach()) } catch { captureStatus = 'incomplete' }
        }
        return { status: captureStatus, dataLossOccurred, startedAtMs, endRequestedAtMs, completedAtMs: Date.now(), ...collector.snapshot() }
      })()
      return stopPromise
    },
  }
}
