// @vitest-environment jsdom

import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type maplibregl from 'maplibre-gl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  CoverageChunkKey,
  CoverageClaim,
  CoverageManifest,
  CoverageReadResult,
  CoverageTileCatalog,
} from '../../src/infrastructure/mission-store/tauri-mission-store'
import { useMapOverlays } from '../../src/features/map/use-map-overlays'
import {
  createCoverageController,
  type CoverageController,
  type CoverageState,
} from '../../src/features/tracking/coverage-controller'
import { applyCoverageState, useCoverageStore } from '../../src/features/tracking/coverage-store'
import { useCoverageFilterStore } from '../../src/features/tracking/coverage-filter-store'
import { useMissionStore } from '../../src/features/mission/mission-store'
import { DEFAULT_BASEMAP_ID } from '../../src/lib/map-config'

/**
 * DON-338 round 3: the real useMapOverlays hook, mounted against an
 * event-capable map double and a real coverage controller. Proves the hook's
 * effect reruns for Retry, a replaced catalog and a filter change, and that
 * it acknowledges the selection the operator chose.
 */

const KEY_A: CoverageChunkKey = { device_id: 'device-a', period_kind: 'outing', period_id: 'outing-1' }
const KEY_B: CoverageChunkKey = { device_id: 'device-b', period_kind: 'outing', period_id: 'outing-1' }

type Listener = (event: { readonly sourceId?: string }) => void
type StoredLayer = { readonly id: string; filter?: unknown; readonly source?: string }

/** A MapLibre stand-in with real events, sources, layers and filters. */
function createMapDouble() {
  const sources = new Map<string, Record<string, unknown>>()
  const layers = new Map<string, StoredLayer>()
  const images = new Set<string>()
  const listeners = new Map<string, Set<Listener>>()
  const emit = (event: string, payload: { readonly sourceId?: string } = {}): void => {
    for (const listener of [...(listeners.get(event) ?? [])]) listener(payload)
  }
  const map = {
    sources,
    layers,
    emit,
    getStyle: () => ({ layers: [{ id: 'basemap-background' }, ...layers.values()] }),
    on: (event: string, listener: Listener) => {
      const set = listeners.get(event) ?? new Set<Listener>()
      set.add(listener)
      listeners.set(event, set)
    },
    off: (event: string, listener: Listener) => { listeners.get(event)?.delete(listener) },
    addSource: (id: string, spec: Record<string, unknown>) => {
      sources.set(id, { ...spec, setData: () => undefined, updateData: () => undefined })
      queueMicrotask(() => emit('sourcedata', { sourceId: id }))
    },
    getSource: (id: string) => sources.get(id),
    removeSource: (id: string) => { sources.delete(id) },
    isSourceLoaded: (id: string) => sources.has(id),
    addLayer: (layer: StoredLayer) => { layers.set(layer.id, { ...layer }) },
    getLayer: (id: string) => layers.get(id),
    removeLayer: (id: string) => { layers.delete(id) },
    moveLayer: () => undefined,
    getFilter: (id: string) => layers.get(id)?.filter,
    setFilter: (id: string, filter: unknown) => {
      const layer = layers.get(id)
      if (layer !== undefined) layer.filter = filter
    },
    getPaintProperty: () => undefined,
    setPaintProperty: () => undefined,
    getLayoutProperty: () => undefined,
    setLayoutProperty: () => undefined,
    hasImage: (id: string) => images.has(id),
    addImage: (id: string) => { images.add(id) },
  }
  return map
}

type MapDouble = ReturnType<typeof createMapDouble>

/** Coverage source ids currently installed on the map. */
function coverageSourceIds(map: MapDouble): readonly string[] {
  return [...map.sources.entries()]
    .filter(([, spec]) => JSON.stringify(spec.tiles ?? '').includes('activation='))
    .map(([id]) => id)
}

/** Removes every coverage source and layer, as a style swap does. */
function wipeCoverage(map: MapDouble): void {
  for (const id of coverageSourceIds(map)) {
    for (const layer of [...map.layers.values()]) if (layer.source === id) map.layers.delete(layer.id)
    map.sources.delete(id)
  }
}

/** The native store: one outing, two devices, revisions the test can move. */
function createStore() {
  const store = { changeSeq: 1, contentRev: 1, stage: 0 }
  const manifest = (): CoverageManifest => ({
    changeSeq: store.changeSeq,
    enumerated: true,
    pendingInvalidation: false,
    backfillIncomplete: false,
    outings: [],
    chunks: [KEY_A, KEY_B].map((key) => ({
      key, contentRev: store.contentRev, builtRev: store.contentRev, fixCount: 5, exactCount: 5, fixDigest: 'digest',
    })),
  })
  const deliverSelection = vi.fn(async (request: {
    readonly chunks: readonly { readonly key: CoverageChunkKey; readonly contentRev: number }[]
  }): Promise<CoverageReadResult<CoverageTileCatalog>> => {
    store.stage += 1
    return {
      missionId: 'mission-1',
      activationId: `stage-${store.stage}`,
      periods: [{ periodKey: 'outing\u0000outing-1', revisionDigest: `rev-${store.contentRev}` }],
      delivered: request.chunks.map((chunk) => ({ key: chunk.key, contentRev: chunk.contentRev })),
    }
  })
  return { store, manifest, deliverSelection }
}

/** Mounts useMapOverlays with the map double as its MapLibre map. */
function OverlayHost(props: { readonly map: MapDouble }) {
  const mapRef = React.useRef(props.map as unknown as maplibregl.Map)
  useMapOverlays({ activeBasemapId: DEFAULT_BASEMAP_ID, mapRef, mapReadyVersion: 1 })
  return null
}

let host: HTMLDivElement
let root: Root
let controller: CoverageController

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  useMissionStore.setState({
    currentMission: { id: 'mission-1' } as ReturnType<typeof useMissionStore.getState>['currentMission'],
  })
  useCoverageFilterStore.setState({ missionId: 'mission-1', omittedDeviceIds: [], omittedPeriodKeys: [] })
})

afterEach(() => {
  controller.stop()
  act(() => root.unmount())
  host.remove()
  useCoverageStore.setState({ state: { status: 'inactive' }, sourceState: { status: 'inactive' }, controller: null })
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/** Wires a real controller into the coverage store and mounts the hook. */
async function mount(map: MapDouble) {
  const native = createStore()
  controller = createCoverageController({
    monotonicNow: () => Date.now(),
    readManifest: vi.fn(async () => native.manifest()),
    readChunk: vi.fn(async () => { throw new Error('not used') }),
    readClaim: vi.fn(async (query: { readonly selectedKeys: readonly CoverageChunkKey[] }): Promise<CoverageClaim> => ({
      changeSeq: native.store.changeSeq, databaseReady: true, blockers: [],
      chunkRevisions: query.selectedKeys.map((key) => ({ key, contentRev: native.store.contentRev })),
    })),
    applyChunk: vi.fn(async () => undefined),
    deliverSelection: native.deliverSelection,
    publish: (state: CoverageState) => applyCoverageState(state),
  })
  useCoverageStore.setState({ controller })
  await act(async () => { root.render(React.createElement(OverlayHost, { map })) })
  await act(async () => {
    await controller.updateContext({ missionId: 'mission-1', rendererGeneration: 'r1' })
    await vi.advanceTimersByTimeAsync(0)
  })
  await settle()
  return native
}

/** Lets React effects, map microtasks and controller promises run. */
async function settle(): Promise<void> {
  for (let round = 0; round < 5; round += 1) {
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
  }
}

/** The coverage state the store holds for the mounted mission. */
function coverage(): Exclude<CoverageState, { status: 'inactive' }> {
  const state = useCoverageStore.getState().state
  if (state.status === 'inactive') throw new Error('Coverage unexpectedly inactive.')
  return state
}

describe('DON-338: the mounted overlay hook drives coverage on the map', () => {
  it('draws the first catalog and reports the line complete', async () => {
    const map = createMapDouble()
    await mount(map)
    expect(coverage()).toMatchObject({ status: 'complete', totalFixCount: 10 })
    expect(coverageSourceIds(map)).toHaveLength(1)
  })

  it('re-applies the catalog on Retry after the map lost the coverage layers', async () => {
    const map = createMapDouble()
    await mount(map)
    expect(coverage().status).toBe('complete')

    // A style swap removed the coverage sources and no map event followed.
    wipeCoverage(map)
    act(() => controller.notifyRendererDetached())
    expect(coverage().blockers).toContain('renderer_detached')
    expect(coverageSourceIds(map)).toHaveLength(0)

    await act(async () => { await controller.resume() })
    await settle()
    expect(coverageSourceIds(map)).toHaveLength(1)
    expect(coverage().blockers ?? []).not.toContain('renderer_detached')
    expect(coverage().status).toBe('complete')
  })

  it('replaces the catalog when saved history moves, leaving only the new source', async () => {
    const map = createMapDouble()
    const native = await mount(map)
    const [firstSource] = coverageSourceIds(map)

    native.store.changeSeq = 2
    native.store.contentRev = 2
    await act(async () => { await controller.notifyChanged('mission-1', 2) })
    await act(async () => { await vi.advanceTimersByTimeAsync(31_000) })
    await settle()

    expect(native.deliverSelection).toHaveBeenCalledTimes(2)
    const sources = coverageSourceIds(map)
    expect(sources).toHaveLength(1)
    expect(sources[0]).not.toBe(firstSource)
    expect(JSON.stringify(map.sources.get(sources[0]!)?.tiles)).toContain('rev-2')
    expect(coverage()).toMatchObject({ status: 'complete', changeSeq: 2 })
  })

  it('acknowledges the filter the operator chose, and only that one', async () => {
    const map = createMapDouble()
    await mount(map)
    const applied = vi.spyOn(controller, 'notifySelectionApplied')

    await act(async () => {
      useCoverageFilterStore.getState().setDeviceVisibility('device-b', false)
      await controller.updateContext({
        missionId: 'mission-1', rendererGeneration: 'r1', omittedDeviceIds: ['device-b'],
      })
    })
    await settle()

    expect(applied).toHaveBeenLastCalledWith([KEY_A])
    expect(coverage().blockers ?? []).not.toContain('renderer_filter_pending')
    expect(coverage()).toMatchObject({ status: 'complete', totalFixCount: 5 })
    const coverageFilters = [...map.layers.values()]
      .filter((layer) => coverageSourceIds(map).includes(layer.source ?? ''))
      .map((layer) => JSON.stringify(layer.filter))
    expect(coverageFilters.length).toBeGreaterThan(0)
    for (const filter of coverageFilters) expect(filter).toContain('device-b')
  })
})
