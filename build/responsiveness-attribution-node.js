import { readFile } from 'node:fs/promises'
import { installRealmResponsivenessProbe, installPointerAttribution, validateAttributionEvidence } from './responsiveness-attribution-lib.js'

/** Adds observation channels to an existing packaged launch, without changing its workload or gates. */
export async function startResponsivenessAttribution({ mainInspector, page, mainPid, requireFrames = false }) {
  const readRenderer = (expression) => boundedDiagnosticCall(() => page.evaluate(expression))
  const cleanupRemote = () => Promise.allSettled([
    boundedDiagnosticCall(() => mainInspector.evaluate('globalThis.__SAR_ATTR_PROBE__?.stop(); void 0')),
    readRenderer('globalThis.__SAR_ATTR_PROBE__?.stop(); globalThis.__SAR_ATTR_POINTER__?.stop(); void 0'),
  ])
  const controller = installRealmResponsivenessProbe()
  const anchors = []
  const pressure = []
  let droppedPressureCount = 0
  let sampling = null
  const samplePressure = async () => {
    const startMs = performance.now()
    const files = process.platform === 'linux'
      ? ['/proc/pressure/cpu', `/proc/${mainPid}/schedstat`, '/sys/fs/cgroup/cpu.stat']
      : []
    const values = await Promise.all(files.map(async (file) => {
      try {
        const text = await readFile(file, 'utf8')
        // Kernel-generated numeric counters only; never retain paths, command lines or environment.
        return text.length <= 2048 && /^[a-z0-9_.= \n]+$/u.test(text) ? text : null
      } catch { return null }
    }))
    if (pressure.length === 512) { pressure.shift(); droppedPressureCount++ }
    pressure.push({ startMs, endMs: performance.now(), cpuPressure: values[0] ?? null,
      mainSchedstat: values[1] ?? null, cgroupCpu: values[2] ?? null })
  }
  const anchor = async (realm, read) => {
    const beforeMs = performance.now()
    const remote = await read()
    anchors.push({ realm, controllerBeforeMs: beforeMs, controllerAfterMs: performance.now(), remote })
  }
  try {
    await mainInspector.evaluate(`globalThis.__SAR_ATTR_PROBE__ = (${installRealmResponsivenessProbe.toString()})(globalThis); void 0`)
    await readRenderer(`globalThis.__SAR_ATTR_PROBE__ = (${installRealmResponsivenessProbe.toString()})(globalThis); void 0`)
    await readRenderer(`globalThis.__SAR_ATTR_POINTER__ = (${installPointerAttribution.toString()})(globalThis); void 0`)
    await anchor('main', async () => (await mainInspector.evaluate('({ nowMs: performance.now(), timeOriginMs: performance.timeOrigin })')).result.value)
    await anchor('renderer', () => readRenderer(() => ({ nowMs: performance.now(), timeOriginMs: performance.timeOrigin })))
    await samplePressure()
  } catch (error) {
    controller.stop()
    await cleanupRemote()
    throw error
  }
  const timer = setInterval(() => {
    if (sampling === null) sampling = samplePressure().finally(() => { sampling = null })
  }, 500)
  return {
    async stop() {
      clearInterval(timer)
      let main
      let renderer
      try {
        if (sampling) await sampling
        await anchor('main-end', async () => (await mainInspector.evaluate('({ nowMs: performance.now(), timeOriginMs: performance.timeOrigin })')).result.value)
        await anchor('renderer-end', () => readRenderer(() => ({ nowMs: performance.now(), timeOriginMs: performance.timeOrigin })))
        main = (await mainInspector.evaluate('globalThis.__SAR_ATTR_PROBE__.stop()')).result.value
        renderer = await readRenderer(() => ({
          timer: globalThis.__SAR_ATTR_PROBE__.stop(), pointer: globalThis.__SAR_ATTR_POINTER__.stop(),
          cadencedFrames: globalThis.__SAR_ATTR_FRAME_GAPS__ ?? null,
        }))
      } finally { controller.stop(); await cleanupRemote() }
      const evidence = { schemaVersion: 1, diagnosticOnly: true, anchors, main, renderer,
        controller: controller.stop(), pressure, droppedPressureCount,
        limitations: ['Clock anchors bound transport uncertainty; timeOrigin is not a shared monotonic clock.',
          'Process CPU includes worker threads. Pressure overlap does not establish cause.',
          'Missing platform counters are unavailable, never zero. GPU cause remains unobserved.',
          'GC entries are asynchronously delivered; absence is not proof that no GC occurred.'] }
      evidence.completeness = validateAttributionEvidence(evidence, requireFrames)
      return evidence
    },
  }
}

/** Bounds diagnostic transport without converting unavailable evidence into a successful sample. */
async function boundedDiagnosticCall(operation) {
  let timeout
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Responsiveness diagnostic collection timed out.')), 5000) }),
    ])
  } finally { clearTimeout(timeout) }
}
