/**
 * Installs an independent realm timer. This function is self-contained so the
 * same observer runs in the controller, packaged main process and renderer.
 * Evidence is diagnostic only: no existing gate is replaced or discounted.
 */
export function installRealmResponsivenessProbe(root = globalThis) {
  const events = []
  const startedAtMs = root.performance.now()
  const wallStartedAtMs = Date.now()
  let previous = startedAtMs
  let samples = 0
  let maximumGapMs = 0
  let over200Count = 0
  let droppedEventCount = 0
  let stoppedAtMs = null
  let wallStoppedAtMs = null
  const gcEvents = []
  let droppedGcCount = 0
  let gcStatus = 'unavailable'
  let gcObserver
  try {
    const hooks = root.process?.getBuiltinModule?.('node:perf_hooks')
    if (hooks?.PerformanceObserver) {
      gcObserver = new hooks.PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (gcEvents.length === 256) { gcEvents.shift(); droppedGcCount++ }
          gcEvents.push({ startMs: entry.startTime, durationMs: entry.duration })
        }
      })
      gcObserver.observe({ entryTypes: ['gc'] })
      gcStatus = 'observing'
    }
  } catch { gcStatus = 'unavailable' }
  const cpu = () => root.process?.cpuUsage?.() ?? null
  let previousCpu = cpu()
  const sample = () => {
    const endMs = root.performance.now()
    const gapMs = endMs - previous
    const currentCpu = cpu()
    samples += 1
    maximumGapMs = Math.max(maximumGapMs, gapMs)
    if (gapMs >= 200) over200Count += 1
    if (gapMs >= 100) {
      if (events.length === 512) { events.shift(); droppedEventCount += 1 }
      events.push({
        startMs: previous, endMs, gapMs,
        processCpuMs: currentCpu && previousCpu
          ? ((currentCpu.user - previousCpu.user) + (currentCpu.system - previousCpu.system)) / 1000
          : null,
      })
    }
    previous = endMs
    previousCpu = currentCpu
  }
  const timer = root.setInterval(sample, 50)
  return {
    stop() {
      if (stoppedAtMs === null) {
        root.clearInterval(timer)
        sample()
        stoppedAtMs = previous
        wallStoppedAtMs = Date.now()
        gcObserver?.disconnect()
      }
      return {
        clock: 'realm-performance-now', timeOriginMs: root.performance.timeOrigin,
        startedAtMs, stoppedAtMs, wallStartedAtMs, wallStoppedAtMs, intervalMs: 50, samples,
        maximumGapMs, over200Count, droppedEventCount, events,
        gc: { status: gcStatus, events: gcEvents, droppedEventCount: droppedGcCount },
      }
    },
  }
}

/** Captures pointer geometry at actual browser dispatch, without text or IDs from user data. */
export function installPointerAttribution(root, allowed) {
  if (!Array.isArray(allowed) || allowed.length === 0) throw new Error('Pointer attribution requires interaction targets.')
  const events = []
  let droppedEventCount = 0
  let unregisteredPreflightCount = 0
  let missingExpectedTargetCount = 0
  const layoutShifts = []
  let droppedLayoutShiftCount = 0
  let layoutObserver
  let layoutStatus = 'unavailable'
  try {
    if (root.PerformanceObserver?.supportedEntryTypes?.includes('layout-shift')) {
      layoutObserver = new root.PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
          if (layoutShifts.length === 128) { layoutShifts.shift(); droppedLayoutShiftCount++ }
          layoutShifts.push({ atMs: entry.startTime, value: entry.value, hadRecentInput: entry.hadRecentInput })
        }
      })
      layoutObserver.observe({ type: 'layout-shift' })
      layoutStatus = 'observing'
    }
  } catch { layoutStatus = 'unavailable' }
  const bounds = (element) => {
    if (!element) return null
    const rect = element.getBoundingClientRect()
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
  }
  const listener = (event) => {
    if (event.type === 'pointercancel') { root.__SAR_ATTR_LAST_PREFLIGHT__ = null; return }
    if (events.length === 256) { events.shift(); droppedEventCount += 1 }
    const path = event.composedPath()
    const hit = root.document.elementFromPoint(event.clientX, event.clientY)
    const preflight = root.__SAR_ATTR_LAST_PREFLIGHT__
    if (preflight && !allowed.includes(preflight.testId)) unregisteredPreflightCount++
    events.push({
      type: event.type, atMs: root.performance.now(), trusted: event.isTrusted,
      x: event.clientX, y: event.clientY,
      preflight: allowed.includes(root.__SAR_ATTR_LAST_PREFLIGHT__?.testId)
        ? root.__SAR_ATTR_LAST_PREFLIGHT__ : null,
      controls: allowed.map((testId) => {
        const target = root.document.querySelector(`[data-testid="${testId}"]`)
        if (preflight?.testId === testId && target === null) missingExpectedTargetCount++
        return { testId, rect: bounds(target), inEventPath: path.includes(target),
          receivesPoint: target !== null && (hit === target || target.contains(hit)) }
      }),
    })
    // A completed dispatch must not own later unrelated pointer events.
    if (event.type === 'click') root.__SAR_ATTR_LAST_PREFLIGHT__ = null
  }
  for (const type of ['pointerdown', 'pointerup', 'click', 'pointercancel']) root.document.addEventListener(type, listener, true)
  return {
    stop() {
      for (const type of ['pointerdown', 'pointerup', 'click', 'pointercancel']) root.document.removeEventListener(type, listener, true)
      layoutObserver?.disconnect()
      return { timeOriginMs: root.performance.timeOrigin, events, droppedEventCount,
        unregisteredPreflightCount, missingExpectedTargetCount,
        layout: { status: layoutStatus, events: layoutShifts, droppedEventCount: droppedLayoutShiftCount } }
    },
  }
}

/** Retains allowlisted storage phase timestamps; these are wall-clock observations, not monotonic causality. */
export function extractStoragePhaseAttribution(contents) {
  const events = []
  let droppedEventCount = 0
  const allowed = new Set(['storage_backup_requested', 'storage_backup_started', 'storage_backup_copied',
    'storage_backup_sanity_check_started', 'storage_backup_completed', 'storage_tracking_positions_completed'])
  for (const line of String(contents).split('\n')) {
    let entry
    try { entry = JSON.parse(line) } catch { continue }
    if (!allowed.has(entry?.event)) continue
    const wallMs = Date.parse(entry.ts)
    if (!Number.isFinite(wallMs)) continue
    if (events.length === 512) { events.shift(); droppedEventCount++ }
    events.push({ event: entry.event, wallMs,
      durationMs: Number.isFinite(entry.durationMs) ? entry.durationMs : null,
      elapsedDurationMs: Number.isFinite(entry.elapsedDurationMs) ? entry.elapsedDurationMs : null })
  }
  return { clock: 'runtime-log-wall-clock', events, droppedEventCount }
}

/** Rejects missing mandatory channels; optional or evicted causal context never proves absence. */
export function validateAttributionEvidence(evidence, requireFrames = false) {
  const realms = [evidence?.main, evidence?.renderer?.timer, evidence?.controller]
  if (realms.some(realm => !realm || !Number.isFinite(realm.timeOriginMs) ||
    !Number.isFinite(realm.startedAtMs) || !Number.isFinite(realm.stoppedAtMs) ||
    realm.stoppedAtMs < realm.startedAtMs || !Number.isFinite(realm.maximumGapMs) || realm.maximumGapMs < 0 ||
    !Number.isSafeInteger(realm.samples) || realm.samples < 1 || !Array.isArray(realm.events)) ||
    !Array.isArray(evidence?.anchors) || evidence.anchors.length !== 4 ||
    evidence.anchors.some(anchor => !Number.isFinite(anchor.remote?.nowMs) ||
      !Number.isFinite(anchor.remote?.timeOriginMs) || !Number.isFinite(anchor.controllerBeforeMs) ||
      !Number.isFinite(anchor.controllerAfterMs) || anchor.controllerAfterMs < anchor.controllerBeforeMs) ||
    !['main', 'renderer', 'main-end', 'renderer-end'].every(name => evidence.anchors.filter(anchor => anchor.realm === name).length === 1) ||
    !Array.isArray(evidence?.renderer?.pointer?.events) ||
    evidence.renderer.pointer.unregisteredPreflightCount > 0 ||
    evidence.renderer.pointer.missingExpectedTargetCount > 0 ||
    (requireFrames && !Array.isArray(evidence.renderer.cadencedFrames?.events))) {
    throw new Error('Responsiveness attribution incomplete: mandatory realm or clock evidence is missing.')
  }
  const contextEvicted = realms.some(realm => realm.droppedEventCount > 0 || realm.gc?.droppedEventCount > 0) ||
    evidence.droppedPressureCount > 0 || evidence.renderer.pointer?.droppedEventCount > 0 ||
    evidence.renderer.pointer?.layout?.droppedEventCount > 0 ||
    evidence.renderer.cadencedFrames?.droppedEventCount > 0
  return { mandatoryChannelsComplete: true, contextEvicted,
    causalAttribution: 'unresolved',
    interpretation: contextEvicted ? 'Some causal context was evicted; do not infer absence.' : 'Observations require interval correlation and controlled comparison.' }
}
