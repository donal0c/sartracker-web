import maplibregl from 'maplibre-gl'

import './bench.css'

const EMPTY_COLLECTION = Object.freeze({ type: 'FeatureCollection', features: [] })
const status = document.querySelector('#status')
const map = new maplibregl.Map({
  container: 'map',
  center: [-9.6, 52.2],
  zoom: 8,
  attributionControl: false,
  style: {
    version: 8,
    sources: {},
    layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#dce7ea' } }],
  },
})

const config = await window.coverageBench.getConfig()
const startedAt = new Date(config.benchmarkStartedAtMs).toISOString()
const startedAtMs = config.benchmarkStartedAtMs
const periodSources = new Map()
const periodLayerIds = new Map()
const periodFeatureIds = new Map()
const periodContentRevs = new Map()
const chunkContentRevs = new Map()
const chunks = new Map()
const candidateCFeatures = []
const rendererFrameMs = []
let collectingFrames = false
let previousFrameAt = null
let expectedFixCount = 0
let expectedChunkCount = 0
let deliveredFixCount = 0
let deliveredChunkCount = 0
let firstUsefulMs = null
let firstUsefulPromise = null
let bounds = [-10.5, 51.3, -5.4, 55.5]
let phases = { queryMs: 0, segmentationMs: 0, encodeServeMs: 0, sourceUpdateMs: 0, renderSettleMs: 0 }
let appendResult = null
let firstDeviceId = null
let firstGroupId = null
let settledPeakBytes = 0
let completeResolve
let completeReject
const completePromise = new Promise((resolve, reject) => {
  completeResolve = resolve
  completeReject = reject
})

maplibregl.addProtocol('coverage-b', async (request) => {
  const parsed = parseCoverageTileUrl(request.url)
  const bytes = await window.coverageBench.readTile({ ...parsed, cacheDirectory: parsed.cacheDirectory })
  return bytes === null ? { data: new Uint8Array() } : { data: new Uint8Array(bytes) }
})

window.coverageBench.onWorkerEvent((event) => {
  void handleWorkerEvent(event).catch(completeReject)
})

await waitForMapLoad()
addCurrentPositionSource()
startFrameSampler()
setStatus(`Candidate ${config.candidate}, ${config.fixturePreset}: loading`)
await window.coverageBench.start()

try {
  await completePromise
  await runPostLoadMeasurements()
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  setStatus(`FAILED: ${message}`)
  await window.coverageBench.fail(message)
}

/** Applies one streamed worker event to the candidate-specific renderer. */
async function handleWorkerEvent(event) {
  if (event.type === 'error') throw new Error(event.error)
  if (event.type === 'metadata') {
    expectedChunkCount = event.expectedChunkCount
    firstDeviceId = event.firstDeviceId
    firstGroupId = event.firstGroupId
    return
  }
  if (event.type === 'chunk') {
    await applyChunk(event, false)
    return
  }
  if (event.type === 'chunk-replaced') {
    await applyChunk(event, true)
    return
  }
  if (event.type === 'period-ready') {
    deliveredFixCount += event.fixCount
    deliveredChunkCount += event.chunkCount
    periodContentRevs.set(event.periodKey, event.contentRev)
    await ensureVectorPeriod(event)
    await markFirstUseful()
    return
  }
  if (event.type === 'period-rebuilt') {
    deliveredFixCount += event.appendedFixCount
    await replaceVectorPeriod(event)
    periodContentRevs.set(event.periodKey, event.contentRev)
    return
  }
  if (event.type === 'progress') {
    setStatus(`Candidate ${config.candidate}: ${event.deliveredFixes.toLocaleString()} fixes prepared`)
    return
  }
  if (event.type === 'complete') {
    expectedFixCount = event.expectedFixCount
    expectedChunkCount = event.expectedChunkCount
    bounds = event.bounds
    phases = { ...phases, ...event.phases }
    if (config.candidate === 'C') {
      const sourceStarted = performance.now()
      addGeoJsonPeriod('monolithic', candidateCFeatures)
      phases.sourceUpdateMs += performance.now() - sourceStarted
      deliveredFixCount = expectedFixCount
      deliveredChunkCount = expectedChunkCount
      await markFirstUseful()
    } else if (firstUsefulPromise !== null) {
      await firstUsefulPromise
    }
    completeResolve()
  }
}

/** Adds or replaces one logical chunk for GeoJSON candidates. */
async function applyChunk(event, replacing) {
  const previous = chunks.get(event.chunkKey)
  chunks.set(event.chunkKey, event)
  if (firstDeviceId === null) firstDeviceId = event.deviceId
  if (config.candidate === 'C') {
    if (replacing && previous) {
      const oldIds = new Set(previous.features.map((feature) => feature.id))
      for (let index = candidateCFeatures.length - 1; index >= 0; index -= 1) {
        if (oldIds.has(candidateCFeatures[index].id)) candidateCFeatures.splice(index, 1)
      }
    }
    candidateCFeatures.push(...event.features)
    if (replacing && periodSources.has('monolithic')) {
      const sourceStarted = performance.now()
      map.getSource(periodSources.get('monolithic')).setData({
        type: 'FeatureCollection',
        features: candidateCFeatures,
      })
      phases.sourceUpdateMs += performance.now() - sourceStarted
    }
  } else {
    const sourceStarted = performance.now()
    const sourceId = addGeoJsonPeriod(event.periodKey, [])
    await waitForCondition(() => map.getSource(sourceId) !== undefined, 1_000)
    const source = map.getSource(sourceId)
    if (typeof source?.updateData !== 'function') {
      throw new Error(`Candidate A source ${sourceId} does not expose updateData.`)
    }
    const oldIds = replacing && previous ? previous.features.map((feature) => feature.id) : []
    source.updateData({ remove: oldIds, add: event.features })
    periodFeatureIds.set(event.periodKey, [
      ...(periodFeatureIds.get(event.periodKey) ?? []).filter((id) => !oldIds.includes(id)),
      ...event.features.map((feature) => feature.id),
    ])
    phases.sourceUpdateMs += performance.now() - sourceStarted
  }
  if (replacing && previous) deliveredFixCount += event.fixCount - previous.fixCount
  else {
    deliveredFixCount += event.fixCount
    deliveredChunkCount += 1
  }
  chunkContentRevs.set(event.chunkKey, event.contentRev)
  if (config.candidate !== 'C' && event.fixCount > 0) await markFirstUseful()
}

/** Adds a dynamic GeoJSON source and its line/point layers once. */
function addGeoJsonPeriod(periodKey, initialFeatures) {
  if (periodSources.has(periodKey)) return periodSources.get(periodKey)
  const index = periodSources.size
  const sourceId = `coverage-geojson-${index}`
  const lineId = `${sourceId}-line`
  const pointId = `${sourceId}-point`
  map.addSource(sourceId, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: initialFeatures },
  })
  map.addLayer({
    id: lineId,
    source: sourceId,
    type: 'line',
    filter: ['==', ['geometry-type'], 'LineString'],
    paint: { 'line-color': '#005ea8', 'line-width': 2, 'line-opacity': 0.72 },
  })
  map.addLayer({
    id: pointId,
    source: sourceId,
    type: 'circle',
    filter: ['==', ['geometry-type'], 'Point'],
    paint: { 'circle-color': '#005ea8', 'circle-radius': 3 },
  })
  periodSources.set(periodKey, sourceId)
  periodLayerIds.set(periodKey, [lineId, pointId])
  return sourceId
}

/** Adds one revision-bound vector source for Candidate B. */
async function ensureVectorPeriod(event) {
  if (firstDeviceId === null) {
    const chunk = [...chunks.values()][0]
    firstDeviceId = chunk?.deviceId ?? null
  }
  const index = periodSources.size
  const sourceId = `coverage-vector-${index}`
  const lineId = `${sourceId}-line`
  const pointId = `${sourceId}-point`
  map.addSource(sourceId, {
    type: 'vector',
    tiles: [`coverage-b://${encodeURIComponent(event.periodKey)}/{z}/{x}/{y}.pbf?rev=${event.contentRev}`],
    minzoom: 0,
    maxzoom: 16,
  })
  map.addLayer({
    id: lineId,
    source: sourceId,
    'source-layer': 'coverage',
    type: 'line',
    filter: ['==', ['geometry-type'], 'LineString'],
    paint: { 'line-color': '#7b2cbf', 'line-width': 2, 'line-opacity': 0.72 },
  })
  map.addLayer({
    id: pointId,
    source: sourceId,
    'source-layer': 'coverage',
    type: 'circle',
    filter: ['==', ['geometry-type'], 'Point'],
    paint: { 'circle-color': '#7b2cbf', 'circle-radius': 3 },
  })
  periodSources.set(event.periodKey, sourceId)
  periodLayerIds.set(event.periodKey, [lineId, pointId])
}

/** Replaces only the affected Candidate-B period source after a revision bump. */
async function replaceVectorPeriod(event) {
  const sourceId = periodSources.get(event.periodKey)
  const layerIds = periodLayerIds.get(event.periodKey) ?? []
  if (!sourceId) throw new Error('Candidate B rebuilt an unknown period.')
  for (const layerId of layerIds) if (map.getLayer(layerId)) map.removeLayer(layerId)
  if (map.getSource(sourceId)) map.removeSource(sourceId)
  periodSources.delete(event.periodKey)
  periodLayerIds.delete(event.periodKey)
  await ensureVectorPeriod(event)
}

/** Records first useful rendered coverage and triggers the deliberate kill probe. */
async function markFirstUseful() {
  if (firstUsefulMs !== null) return
  if (firstUsefulPromise === null) {
    firstUsefulPromise = (async () => {
      const settleStarted = performance.now()
      await waitForIdle(10_000)
      phases.renderSettleMs += performance.now() - settleStarted
      firstUsefulMs = Date.now() - startedAtMs
      if (config.killProbe) {
        await window.coverageBench.killAtFirstUseful({ deliveredFixes: Math.max(1, deliveredFixCount) })
      }
    })()
  }
  await firstUsefulPromise
}

/** Runs filter, append, pan/zoom, attestation, memory, and responsiveness measurements. */
async function runPostLoadMeasurements() {
  map.fitBounds(bounds, { padding: 40, duration: 0 })
  const completeSettleStarted = performance.now()
  await waitForIdle(30_000)
  phases.renderSettleMs += performance.now() - completeSettleStarted
  const completeMs = Date.now() - startedAtMs

  const filterMeasurements = await measureFilterToggle()
  const appendRerenderMs = await measureLateAppend()
  const attestation = await measurePanZoomAndAttestation()
  const memory = await window.coverageBench.readMemory()
  settledPeakBytes = Math.max(settledPeakBytes, memory.rendererRssPeakBytes)
  const mainGapMs = await window.coverageBench.readMainSamples()
  stopFrameSampler()

  if (firstUsefulMs === null) throw new Error('No useful coverage rendered.')
  if (deliveredFixCount !== expectedFixCount + 5_000) {
    throw new Error(`Delivered fix total mismatch after append: ${deliveredFixCount} vs ${expectedFixCount + 5_000}.`)
  }
  setStatus(`Candidate ${config.candidate}: complete`)
  await window.coverageBench.finish({
    startedAt,
    measurements: {
      timings: {
        firstUsefulMs,
        completeMs,
        filterToggleMs: Math.max(...Object.values(filterMeasurements)),
        filterDeviceMs: filterMeasurements.device,
        filterGroupMs: filterMeasurements.group,
        filterOutingMs: filterMeasurements.outing,
        appendRerenderMs,
      },
      phases: {
        queryMs: phases.queryMs,
        segmentationMs: phases.segmentationMs,
        encodeServeMs: appendResult?.phases?.encodeServeMs ?? phases.encodeServeMs,
        sourceUpdateMs: phases.sourceUpdateMs,
        renderSettleMs: phases.renderSettleMs,
      },
      responsiveness: { mainGapMs, rendererFrameMs },
      memory: {
        rendererRssPeakBytes: Math.max(settledPeakBytes, memory.rendererRssPeakBytes),
        rendererRssSettledBytes: memory.rendererRssBytes,
      },
      correctness: {
        currentFixWithinPollCycle: appendResult.currentFixLatencyMs <= config.pollCycleMs,
        killResumeHonest: config.killProofValid === true && deliveredChunkCount > 0,
        renderedAttestationExact: attestation.panes.every((pane) => pane.exact),
        exactDotsEqual: config.exactDotsContractPassed === true,
        staleTileGuarded: appendResult.staleTileGuarded,
        unrelatedRevisionStable: appendResult.unrelatedRevisionStable,
      },
      attestation,
    },
  })
}

/** Measures a device filter without changing mission evidence or the live source. */
async function measureFilterToggle() {
  const layerIds = [...periodLayerIds.values()].flat()
  const deviceId = firstDeviceId ?? [...chunks.values()][0]?.deviceId
  const device = await measureLayerFilter(layerIds, deviceId
    ? ['!=', ['get', 'device_id'], deviceId]
    : null)
  const group = await measureLayerFilter(layerIds, firstGroupId
    ? ['==', ['get', 'group_id'], firstGroupId]
    : null)
  const firstPeriodLayers = [...periodLayerIds.values()][0] ?? []
  const outingStarted = performance.now()
  for (const layerId of firstPeriodLayers) map.setLayoutProperty(layerId, 'visibility', 'none')
  await waitForRenderedFrame(2_000)
  const outing = performance.now() - outingStarted
  for (const layerId of firstPeriodLayers) map.setLayoutProperty(layerId, 'visibility', 'visible')
  return { device, group, outing }
}

/** Times one history-only MapLibre filter and restores the geometry filter afterwards. */
async function measureLayerFilter(layerIds, selectionFilter) {
  const started = performance.now()
  if (selectionFilter) {
    for (const layerId of layerIds) {
      const geometryFilter = ['==', ['geometry-type'], map.getLayer(layerId).type === 'line' ? 'LineString' : 'Point']
      map.setFilter(layerId, ['all', selectionFilter, geometryFilter])
    }
    await waitForRenderedFrame(2_000)
  }
  const elapsed = performance.now() - started
  for (const layerId of layerIds) {
    map.setFilter(layerId, ['==', ['geometry-type'], map.getLayer(layerId).type === 'line' ? 'LineString' : 'Point'])
  }
  return elapsed
}

/** Measures the late-batch candidate update while updating the independent live marker first. */
async function measureLateAppend() {
  await window.coverageBench.primeInvalidation()
  const liveStarted = performance.now()
  const liveSource = map.getSource('current-position')
  liveSource.setData({
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      id: 'current-position:probe',
      geometry: { type: 'Point', coordinates: [bounds[0], bounds[1]] },
      properties: { featureKind: 'current' },
    }],
  })
  const currentFixLatencyMs = performance.now() - liveStarted
  const started = performance.now()
  const workerResult = await window.coverageBench.appendLateBatch()
  await waitForCondition(() => {
    if (config.candidate === 'B') {
      return periodContentRevs.get(workerResult.periodKey) === workerResult.contentRev
    }
    return chunkContentRevs.get(workerResult.chunkKey) === workerResult.contentRev
  }, 30_000)
  await waitForIdle(20_000)
  appendResult = { ...workerResult, currentFixLatencyMs }
  return performance.now() - started
}

/** Exercises three zoom bands and verifies sampled rendered coverage carries revision identity. */
async function measurePanZoomAndAttestation() {
  const [west, south, east, north] = bounds
  const points = [
    [west, south, 14], [(west + east) / 2, south, 11], [east, south, 8],
    [east, (south + north) / 2, 14], [(west + east) / 2, (south + north) / 2, 11], [west, (south + north) / 2, 8],
    [west, north, 14], [(west + east) / 2, north, 11], [east, north, 8],
  ]
  const panes = []
  for (const [index, [lon, lat, zoom]] of points.entries()) {
    map.jumpTo({ center: [lon, lat], zoom })
    await waitForIdle(5_000)
    const canvas = map.getCanvas()
    const inset = 80
    const northWest = map.unproject([inset, inset])
    const southEast = map.unproject([canvas.clientWidth - inset, canvas.clientHeight - inset])
    const paneBounds = [northWest.lng, southEast.lat, southEast.lng, northWest.lat]
    const features = map.queryRenderedFeatures(
      [[inset, inset], [canvas.clientWidth - inset, canvas.clientHeight - inset]],
      { layers: [...periodLayerIds.values()].flat() },
    )
    const renderedKeys = [...new Set(features.map(renderedAttestationKey))].sort()
    const expected = await window.coverageBench.attestPane(paneBounds)
    const renderedDigest = await sha256(renderedKeys.join('\n'))
    panes.push({
      index,
      zoom,
      bounds: paneBounds,
      expectedSegmentCount: expected.segmentCount,
      renderedSegmentCount: renderedKeys.length,
      expectedDigest: expected.digest,
      renderedDigest,
      exact: expected.segmentCount === renderedKeys.length && expected.digest === renderedDigest,
    })
    const memory = await window.coverageBench.readMemory()
    settledPeakBytes = Math.max(settledPeakBytes, memory.rendererRssPeakBytes)
  }
  return { seed: 'g2-serpentine-v1', panes }
}

/** Reads the worker-bound feature identity retained by every candidate. */
function renderedAttestationKey(feature) {
  return `${feature.properties?.feature_key}|${feature.properties?.chunk_key}|${feature.properties?.content_rev}`
}

/** Produces a browser-native SHA-256 digest for sampled rendered feature keys. */
async function sha256(value) {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** Adds the safety-critical current-position source outside all history sources and filters. */
function addCurrentPositionSource() {
  map.addSource('current-position', { type: 'geojson', data: EMPTY_COLLECTION })
  map.addLayer({
    id: 'current-position',
    source: 'current-position',
    type: 'circle',
    paint: { 'circle-color': '#d90429', 'circle-radius': 8, 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 },
  })
}

/** Parses the revision-bound Candidate-B custom protocol URL. */
function parseCoverageTileUrl(url) {
  const parsed = new URL(url)
  const match = parsed.pathname.match(/^\/(\d+)\/(\d+)\/(\d+)\.pbf$/)
  if (!match) throw new Error(`Invalid Candidate-B tile URL: ${url}`)
  return {
    periodKey: decodeURIComponent(parsed.hostname),
    z: Number(match[1]),
    x: Number(match[2]),
    y: Number(match[3]),
    contentRev: Number(parsed.searchParams.get('rev')),
  }
}

/** Records actual animation-frame gaps during candidate activity. */
function startFrameSampler() {
  collectingFrames = true
  const sample = (now) => {
    if (!collectingFrames) return
    if (previousFrameAt !== null) rendererFrameMs.push(Math.max(0, now - previousFrameAt))
    previousFrameAt = now
    requestAnimationFrame(sample)
  }
  requestAnimationFrame(sample)
}

/** Stops animation-frame measurement before result serialization. */
function stopFrameSampler() {
  collectingFrames = false
}

/** Waits for the initial MapLibre style to be ready. */
function waitForMapLoad() {
  if (map.loaded()) return Promise.resolve()
  return new Promise((resolve) => map.once('load', resolve))
}

/** Waits for rendered sources to settle, with a loud bounded timeout. */
function waitForIdle(timeoutMs) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error(`Map did not settle within ${timeoutMs} ms.`))
    }, timeoutMs)
    const onIdle = () => {
      cleanup()
      resolve()
    }
    const cleanup = () => {
      clearTimeout(timeout)
      map.off('idle', onIdle)
    }
    map.on('idle', onIdle)
    map.triggerRepaint()
  })
}

/** Waits for the first painted frame after a synchronous filter change. */
function waitForRenderedFrame(timeoutMs) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error(`Map did not render a filter change within ${timeoutMs} ms.`))
    }, timeoutMs)
    const onRender = () => {
      cleanup()
      resolve()
    }
    const cleanup = () => {
      clearTimeout(timeout)
      map.off('render', onRender)
    }
    map.on('render', onRender)
    map.triggerRepaint()
  })
}

/** Polls a renderer condition without using unbounded waits. */
async function waitForCondition(predicate, timeoutMs) {
  const deadline = performance.now() + timeoutMs
  while (!predicate()) {
    if (performance.now() >= deadline) throw new Error('Timed out waiting for candidate update.')
    await delay(25)
  }
}

/** Resolves after a bounded renderer delay. */
function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

/** Updates the visible benchmark status without affecting the measured map. */
function setStatus(message) {
  status.textContent = message
}
