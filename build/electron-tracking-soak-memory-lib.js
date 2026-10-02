/**
 * Heap and retained-state samplers for the packaged Electron tracking soak
 * [DON-312]. The soak otherwise records process RSS only, which cannot say
 * which copy of the breadcrumbs grows. Every reading is bounded and an
 * unreadable value is recorded as null with its reason, never as zero.
 */

/** MapLibre sources that hold the operational tracking picture. */
export const TRACKING_MEMORY_SOURCE_IDS = Object.freeze([
  'tracking',
  'tracking-breadcrumb-dots-exact',
])

/**
 * Counts the features and vertices the renderer holds in the tracking map
 * sources. Runs inside the page through `page.evaluate`, so it must stay
 * self-contained: no references to module scope.
 * @param {object} [win] window-like object holding `__SARTRACKER_MAP__`
 * @returns {{available: boolean, reason?: string, sources: Record<string, object>}}
 */
export function readRendererTrackingStateCounts(win = globalThis) {
  const sourceIds = ['tracking', 'tracking-breadcrumb-dots-exact']
  const map = win?.__SARTRACKER_MAP__
  if (map === undefined || map === null || typeof map.getSource !== 'function') {
    return { available: false, reason: 'map-unavailable', sources: {} }
  }
  const sources = {}
  for (const id of sourceIds) {
    const source = map.getSource(id)
    if (source === undefined || source === null || typeof source.serialize !== 'function') {
      sources[id] = { unavailable: 'source-missing' }
      continue
    }
    const data = source.serialize()?.data
    if (data === null || typeof data !== 'object' || !Array.isArray(data.features)) {
      sources[id] = { unavailable: 'source-data-not-inline' }
      continue
    }
    let lineFeatures = 0
    let pointFeatures = 0
    let otherFeatures = 0
    let vertices = 0
    let maxLineVertices = 0
    for (const feature of data.features) {
      const geometry = feature?.geometry
      if (geometry?.type === 'LineString' && Array.isArray(geometry.coordinates)) {
        lineFeatures += 1
        vertices += geometry.coordinates.length
        if (geometry.coordinates.length > maxLineVertices) maxLineVertices = geometry.coordinates.length
      } else if (geometry?.type === 'Point') {
        pointFeatures += 1
        vertices += 1
      } else {
        otherFeatures += 1
      }
    }
    sources[id] = {
      features: data.features.length,
      lineFeatures,
      pointFeatures,
      otherFeatures,
      vertices,
      maxLineVertices,
    }
  }
  return { available: true, sources }
}

/**
 * Reads main heap, renderer heap and renderer tracking state in parallel.
 * One failing or hanging reader does not lose the others.
 * @param {{
 *   readMainMemoryUsage: () => Promise<unknown>,
 *   readRendererHeapUsage: () => Promise<unknown>,
 *   readRendererStateCounts: () => Promise<unknown>,
 *   timeoutMs: number,
 * }} readers
 */
export async function readHeapAndStateSample(readers) {
  const unavailable = []
  const [main, renderer, state] = await Promise.all([
    bounded(readers.readMainMemoryUsage, readers.timeoutMs),
    bounded(readers.readRendererHeapUsage, readers.timeoutMs),
    bounded(readers.readRendererStateCounts, readers.timeoutMs),
  ])
  const mainHeap = normalize(main, 'main-heap', unavailable, {
    heapUsedBytes: 'heapUsed',
    heapTotalBytes: 'heapTotal',
    externalBytes: 'external',
    arrayBuffersBytes: 'arrayBuffers',
  })
  const rendererHeap = normalize(renderer, 'renderer-heap', unavailable, {
    usedJSHeapBytes: 'usedSize',
    totalJSHeapBytes: 'totalSize',
    embedderHeapUsedBytes: 'embedderHeapUsedSize',
    backingStorageBytes: 'backingStorageSize',
  })
  let rendererState = null
  if (state.ok) rendererState = state.value
  else unavailable.push(`renderer-state: ${state.reason}`)
  return { mainHeap, rendererHeap, rendererState, unavailable }
}

/**
 * Starts a heap read for an evidence sample without making the caller wait,
 * with at most one read in flight per launch; a sample taken while one is in
 * flight goes without heap evidence. The result is attached to the sample
 * when it arrives.
 * @param {{heapSampleInFlight?: Promise<void>}} state per-launch state
 * @param {object} sample the evidence sample to annotate
 * @param {() => Promise<object>} read heap reader that never rejects
 * @returns {boolean} whether a read was started
 */
export function scheduleEvidenceHeapSample(state, sample, read) {
  if (state.heapSampleInFlight !== undefined) return false
  state.heapSampleInFlight = Promise.resolve().then(read).then((heap) => {
    sample.heap = heap
  }).finally(() => {
    state.heapSampleInFlight = undefined
  })
  return true
}

/**
 * Peaks across a launch's evidence samples, each with the batch it was seen
 * at. A measure never read reports null, not zero.
 * @param {ReadonlyArray<{completedBatch?: number | null, heap?: object}>} samples
 */
export function summarizeHeapSamples(samples) {
  let samplesWithHeap = 0
  let samplesWithoutHeap = 0
  let peakRendererUsedJSHeap = null
  let peakMainHeapUsed = null
  let peakTrackingVertices = null
  for (const sample of samples) {
    const heap = sample?.heap
    if (heap === undefined || heap === null) {
      samplesWithoutHeap += 1
      continue
    }
    samplesWithHeap += 1
    const completedBatch = sample.completedBatch ?? null
    const renderer = heap.rendererHeap?.usedJSHeapBytes
    if (Number.isFinite(renderer) && (peakRendererUsedJSHeap === null || renderer > peakRendererUsedJSHeap.bytes)) {
      peakRendererUsedJSHeap = { bytes: renderer, completedBatch }
    }
    const main = heap.mainHeap?.heapUsedBytes
    if (Number.isFinite(main) && (peakMainHeapUsed === null || main > peakMainHeapUsed.bytes)) {
      peakMainHeapUsed = { bytes: main, completedBatch }
    }
    if (heap.rendererState?.available === true) {
      let vertices = 0
      let counted = false
      for (const source of Object.values(heap.rendererState.sources ?? {})) {
        if (Number.isFinite(source?.vertices)) {
          vertices += source.vertices
          counted = true
        }
      }
      if (counted && (peakTrackingVertices === null || vertices > peakTrackingVertices.vertices)) {
        peakTrackingVertices = { vertices, completedBatch }
      }
    }
  }
  return {
    samplesWithHeap,
    samplesWithoutHeap,
    peakRendererUsedJSHeap,
    peakMainHeapUsed,
    peakTrackingVertices,
  }
}

async function bounded(read, timeoutMs) {
  let timer
  try {
    const value = await Promise.race([
      Promise.resolve().then(read),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs} ms`)), timeoutMs)
      }),
    ])
    return { ok: true, value }
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) }
  } finally {
    clearTimeout(timer)
  }
}

/** The first two fields are required; later ones are null when this runtime lacks them. */
function normalize(result, label, unavailable, fields) {
  if (!result.ok) {
    unavailable.push(`${label}: ${result.reason}`)
    return null
  }
  const normalized = {}
  for (const [index, [target, source]] of Object.entries(fields).entries()) {
    const value = result.value?.[source]
    if (!Number.isFinite(value) && index >= 2) {
      normalized[target] = null
      continue
    }
    if (!Number.isFinite(value)) {
      unavailable.push(`${label}: ${source} is not a finite number`)
      return null
    }
    normalized[target] = value
  }
  return normalized
}
