import { readFile } from 'node:fs/promises'
import { installRealmResponsivenessProbe, installPointerAttribution, validateAttributionEvidence } from './responsiveness-attribution-lib.js'
import { SOAK_INTERACTION_TARGETS } from './soak-interaction-targets.js'
import { createPressureTimeline } from './responsiveness-pressure-timeline.js'

// Parallel stop reads take at most 5s, pressure drain 1s and remote cleanup 5s.
export const ATTRIBUTION_COLLECTION_TIMEOUT_MS = 12_000

/** Explicit failure of diagnostic evidence; never a successful zero-delay observation. */
export function unavailableAttribution(reason, partial = {}) {
  return { ...partial, schemaVersion: 1, diagnosticOnly: true, collected: false, reason,
    completeness: { mandatoryChannelsComplete: false, causalAttribution: 'unresolved' } }
}

/** Missing original heartbeat context is unavailable, never an empty successful sample. */
export function attachInspectorAttribution(evidence, heartbeat) {
  if (!heartbeat) return unavailableAttribution(evidence.collected === false ? evidence.reason : 'inspector-not-collected', {
    ...evidence, inspectorCollection: { collected: false, reason: 'not-collected' },
  })
  return { ...evidence, inspectorCollection: { collected: true }, inspectorRoundTrips: heartbeat.events,
    inspectorDroppedEventCount: heartbeat.droppedEventCount,
    completeness: { ...evidence.completeness,
      contextEvicted: evidence.completeness.contextEvicted === true || heartbeat.droppedEventCount > 0 } }
}

/** Bounds diagnostic collection independently of the unchanged operational soak verdict. */
export async function collectAttributionEvidence(attribution, timeoutMs = ATTRIBUTION_COLLECTION_TIMEOUT_MS) {
  try {
    return await boundedDiagnosticCall(() => attribution.stop(), timeoutMs)
  } catch (error) {
    return unavailableAttribution(error?.code === 'ATTRIBUTION_TIMEOUT' ? 'collection-timeout' : 'collection-failed')
  }
}

/** Adds observations without turning diagnostic availability into an operational gate. */
export async function startResponsivenessAttribution({ mainInspector, page, mainPid, requireFrames = false }) {
  const readMain = (expression) => boundedDiagnosticCall(() => mainInspector.evaluate(expression))
  const readRenderer = (expression) => boundedDiagnosticCall(() => page.evaluate(expression))
  const cleanupRemote = () => Promise.allSettled([
    readMain('globalThis.__SAR_ATTR_PROBE__?.stop(); void 0'),
    readRenderer('globalThis.__SAR_ATTR_PROBE__?.stop(); globalThis.__SAR_ATTR_POINTER__?.stop(); void 0'),
  ])
  const controller = installRealmResponsivenessProbe()
  const anchors = []
  const timeline = createPressureTimeline()
  let sampling = null
  const samplePressure = async () => {
    const startMs = performance.now()
    const files = process.platform === 'linux'
      ? ['/proc/pressure/cpu', `/proc/${mainPid}/schedstat`, '/sys/fs/cgroup/cpu.stat'] : []
    const values = await Promise.all(files.map(async (file) => {
      try {
        const text = await boundedDiagnosticCall(() => readFile(file, 'utf8'), 1000)
        return text.length <= 2048 && /^[a-z0-9_.= \n]+$/u.test(text) ? text : null
      } catch { return null }
    }))
    timeline.add({ startMs, endMs: performance.now(), cpuPressure: values[0] ?? null,
      mainSchedstat: values[1] ?? null, cgroupCpu: values[2] ?? null })
  }
  const anchor = async (realm, read) => {
    const beforeMs = performance.now()
    const remote = await read()
    anchors.push({ realm, controllerBeforeMs: beforeMs, controllerAfterMs: performance.now(), remote })
  }
  try {
    await readMain(`globalThis.__SAR_ATTR_PROBE__ = (${installRealmResponsivenessProbe.toString()})(globalThis); void 0`)
    await readRenderer(`globalThis.__SAR_ATTR_PROBE__ = (${installRealmResponsivenessProbe.toString()})(globalThis); void 0`)
    await readRenderer(`globalThis.__SAR_ATTR_POINTER__ = (${installPointerAttribution.toString()})(globalThis, ${JSON.stringify(Object.values(SOAK_INTERACTION_TARGETS))}); void 0`)
    await anchor('main', async () => (await readMain('({ nowMs: performance.now(), timeOriginMs: performance.timeOrigin })')).result.value)
    await anchor('renderer', () => readRenderer(() => ({ nowMs: performance.now(), timeOriginMs: performance.timeOrigin })))
    await samplePressure()
  } catch {
    const snapshot = controller.stop()
    await cleanupRemote()
    const failure = unavailableAttribution('installation-failed', { controller: snapshot, anchors })
    return { stop: async () => failure }
  }
  const timer = setInterval(() => {
    if (sampling === null) sampling = samplePressure().finally(() => { sampling = null })
  }, 500)
  let stopPromise
  const stop = async () => {
    clearInterval(timer)
    let main
    let renderer
    let controllerSnapshot
    let failed = false
    try {
      if (sampling) await sampling
      const results = await Promise.allSettled([
        anchor('main-end', async () => (await readMain('({ nowMs: performance.now(), timeOriginMs: performance.timeOrigin })')).result.value),
        anchor('renderer-end', () => readRenderer(() => ({ nowMs: performance.now(), timeOriginMs: performance.timeOrigin }))),
        readMain('globalThis.__SAR_ATTR_PROBE__.stop()').then(result => { main = result.result.value }),
        readRenderer(() => ({ timer: globalThis.__SAR_ATTR_PROBE__.stop(), pointer: globalThis.__SAR_ATTR_POINTER__.stop(),
          cadencedFrames: globalThis.__SAR_ATTR_FRAME_GAPS__ ?? null })).then(result => { renderer = result }),
      ])
      failed = results.some(result => result.status === 'rejected')
    } finally {
      controllerSnapshot = controller.stop()
      await cleanupRemote()
    }
    const { samples: pressure, ...pressureRetention } = timeline.snapshot()
    const evidence = { schemaVersion: 1, diagnosticOnly: true, collected: true, anchors, main, renderer,
      controller: controllerSnapshot, pressure, pressureRetention,
      droppedPressureCount: pressureRetention.decimatedCount,
      limitations: ['Clock anchors bound transport uncertainty; timeOrigin is not a shared monotonic clock.',
        'Process CPU includes worker threads. Pressure overlap does not establish cause.',
        'Pressure is progressively decimated across the whole run; spacing limits causal precision.',
        'Missing platform counters are unavailable, never zero. GPU cause remains unobserved.',
        'GC entries are asynchronously delivered; absence is not proof that no GC occurred.'] }
    if (failed) return unavailableAttribution('collection-failed', evidence)
    try { evidence.completeness = validateAttributionEvidence(evidence, requireFrames) }
    catch { return unavailableAttribution('incomplete-evidence', evidence) }
    return evidence
  }
  return { stop: () => { stopPromise ??= stop(); return stopPromise } }
}

/** Bounds diagnostic transport and identifies timeout without retaining arbitrary error text. */
async function boundedDiagnosticCall(operation, timeoutMs = 5000) {
  let timeout
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => { timeout = setTimeout(() => {
        const error = new Error('Responsiveness diagnostic collection timed out.')
        error.code = 'ATTRIBUTION_TIMEOUT'
        reject(error)
      }, timeoutMs) }),
    ])
  } finally { clearTimeout(timeout) }
}
