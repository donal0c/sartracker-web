import { describe, expect, it } from 'vitest'

import {
  readHeapAndStateSample,
  readRendererTrackingStateCounts,
  scheduleEvidenceHeapSample,
  summarizeHeapSamples,
} from '../../build/electron-tracking-soak-memory-lib.js'

/**
 * DON-312 step 1: the soak records process RSS only. These samplers add
 * main/renderer JS heap and the renderer's retained tracking state, so a
 * later run can tell which copy of the breadcrumbs grows. Nothing is
 * invented: an unreadable value is null with a stated reason.
 */

function line(vertices: number) {
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'LineString', coordinates: Array.from({ length: vertices }, (_, index) => [index, index]) },
  }
}

function point() {
  return { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [0, 0] } }
}

function fakeWindow(sources: Record<string, unknown>) {
  return {
    __SARTRACKER_MAP__: {
      getSource: (id: string) => (id in sources
        ? { serialize: () => ({ type: 'geojson', data: sources[id] }) }
        : undefined),
    },
  }
}

describe('readRendererTrackingStateCounts [DON-312]', () => {
  it('counts features, lines, points and vertices per tracking source', () => {
    const counts = readRendererTrackingStateCounts(fakeWindow({
      tracking: { type: 'FeatureCollection', features: [line(3), line(5), point(), point()] },
      'tracking-breadcrumb-dots-exact': { type: 'FeatureCollection', features: [point()] },
    }))
    expect(counts).toEqual({
      available: true,
      sources: {
        tracking: { features: 4, lineFeatures: 2, pointFeatures: 2, otherFeatures: 0, vertices: 10, maxLineVertices: 5 },
        'tracking-breadcrumb-dots-exact': { features: 1, lineFeatures: 0, pointFeatures: 1, otherFeatures: 0, vertices: 1, maxLineVertices: 0 },
      },
    })
  })

  it('says the map is unavailable rather than reporting zero', () => {
    expect(readRendererTrackingStateCounts({})).toEqual({ available: false, reason: 'map-unavailable', sources: {} })
  })

  it('marks a missing or unreadable source instead of counting it as empty', () => {
    const counts = readRendererTrackingStateCounts(fakeWindow({ tracking: 'https://example.invalid/data.json' }))
    expect(counts.available).toBe(true)
    expect(counts.sources).toEqual({
      tracking: { unavailable: 'source-data-not-inline' },
      'tracking-breadcrumb-dots-exact': { unavailable: 'source-missing' },
    })
  })
})

describe('readHeapAndStateSample [DON-312]', () => {
  const mainUsage = { rss: 900, heapTotal: 400, heapUsed: 300, external: 50, arrayBuffers: 20 }
  const rendererUsage = { usedSize: 700, totalSize: 800, embedderHeapUsedSize: 10, backingStorageSize: 5 }
  const counts = { available: true, sources: {} }

  it('records main heap, renderer heap and state counts from the three readers', async () => {
    const sample = await readHeapAndStateSample({
      readMainMemoryUsage: async () => mainUsage,
      readRendererHeapUsage: async () => rendererUsage,
      readRendererStateCounts: async () => counts,
      timeoutMs: 1_000,
    })
    expect(sample).toEqual({
      mainHeap: { heapUsedBytes: 300, heapTotalBytes: 400, externalBytes: 50, arrayBuffersBytes: 20 },
      rendererHeap: { usedJSHeapBytes: 700, totalJSHeapBytes: 800, embedderHeapUsedBytes: 10, backingStorageBytes: 5 },
      rendererState: counts,
      unavailable: [],
    })
  })

  it('keeps the other readings and names the failure when one reader throws or times out', async () => {
    const sample = await readHeapAndStateSample({
      readMainMemoryUsage: async () => { throw new Error('inspector closed') },
      readRendererHeapUsage: () => new Promise(() => undefined),
      readRendererStateCounts: async () => counts,
      timeoutMs: 20,
    })
    expect(sample.mainHeap).toBeNull()
    expect(sample.rendererHeap).toBeNull()
    expect(sample.rendererState).toEqual(counts)
    expect(sample.unavailable).toEqual(['main-heap: inspector closed', 'renderer-heap: timed out after 20 ms'])
  })

  it('rejects non-numeric heap values instead of recording them', async () => {
    const sample = await readHeapAndStateSample({
      readMainMemoryUsage: async () => ({ heapUsed: 'lots' }),
      readRendererHeapUsage: async () => rendererUsage,
      readRendererStateCounts: async () => counts,
      timeoutMs: 1_000,
    })
    expect(sample.mainHeap).toBeNull()
    expect(sample.unavailable).toEqual(['main-heap: heapUsed is not a finite number'])
  })
})

describe('summarizeHeapSamples [DON-312]', () => {
  it('reports the peak of each measure with the batch it was seen at', () => {
    const sample = (batch: number, renderer: number | null, main: number | null, vertices: number | null) => ({
      completedBatch: batch,
      heap: {
        mainHeap: main === null ? null : { heapUsedBytes: main },
        rendererHeap: renderer === null ? null : { usedJSHeapBytes: renderer },
        rendererState: vertices === null
          ? { available: false, reason: 'map-unavailable', sources: {} }
          : { available: true, sources: { tracking: { vertices } } },
        unavailable: [],
      },
    })
    expect(summarizeHeapSamples([
      sample(10, 100, 50, 1_000),
      sample(240, 900, 70, 400_000),
      sample(480, 700, 90, null),
      { completedBatch: 500 },
    ])).toEqual({
      samplesWithHeap: 3,
      samplesWithoutHeap: 1,
      peakRendererUsedJSHeap: { bytes: 900, completedBatch: 240 },
      peakMainHeapUsed: { bytes: 90, completedBatch: 480 },
      peakTrackingVertices: { vertices: 400_000, completedBatch: 240 },
    })
  })

  it('reports no peak rather than zero when nothing was readable', () => {
    expect(summarizeHeapSamples([])).toEqual({
      samplesWithHeap: 0,
      samplesWithoutHeap: 0,
      peakRendererUsedJSHeap: null,
      peakMainHeapUsed: null,
      peakTrackingVertices: null,
    })
  })
})

describe('scheduleEvidenceHeapSample [DON-312]', () => {
  it('does not make the sampler wait, keeps one read in flight, and attaches the result later', async () => {
    const state: { heapSampleInFlight?: Promise<void> } = {}
    let release: (value: object) => void = () => undefined
    const read = () => new Promise<object>((resolve) => { release = resolve })
    const first: { heap?: object } = {}
    const second: { heap?: object } = {}
    expect(scheduleEvidenceHeapSample(state, first, read)).toBe(true)
    expect(scheduleEvidenceHeapSample(state, second, read)).toBe(false)
    expect(first.heap).toBeUndefined()
    await Promise.resolve()
    release({ unavailable: [] })
    await state.heapSampleInFlight
    expect(first.heap).toEqual({ unavailable: [] })
    expect(second.heap).toBeUndefined()
    expect(state.heapSampleInFlight).toBeUndefined()
    expect(scheduleEvidenceHeapSample(state, second, async () => ({ unavailable: [] }))).toBe(true)
  })
})
