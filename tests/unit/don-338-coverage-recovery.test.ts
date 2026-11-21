import { afterEach, describe, expect, it, vi } from 'vitest'

import type {
  CoverageChunkKey,
  CoverageClaim,
  CoverageManifest,
  CoverageReadResult,
  CoverageTileCatalog,
} from '../../src/infrastructure/mission-store/tauri-mission-store'
import {
  createCoverageController,
  type CoverageController,
  type CoverageState,
} from '../../src/features/tracking/coverage-controller'
import { summarizeCoverageStatus } from '../../src/features/tracking/coverage-progress'
import { selectCoverageOverlaySyncInputs } from '../../src/features/tracking/sync-coverage-overlay'
import { selectCoverageChunkKeys, type CoverageOmissions } from '../../src/features/tracking/coverage-filter-selection'

/**
 * DON-338 round 2: the whole-history line recovers by itself after the tile
 * worker dies, and operator Retry makes the map re-apply a catalog or filter
 * that stalled. Only the native store and the map are replaced; the fake map
 * re-runs its sync exactly when use-map-overlays would (catalog object
 * identity or selection signature changes).
 */

const KEY_A: CoverageChunkKey = { device_id: 'device-a', period_kind: 'outing', period_id: 'outing-1' }
const KEY_B: CoverageChunkKey = { device_id: 'device-b', period_kind: 'outing', period_id: 'outing-1' }

afterEach(() => vi.useRealTimers())

function manifest(): CoverageManifest {
  return {
    changeSeq: 1,
    enumerated: true,
    pendingInvalidation: false,
    backfillIncomplete: false,
    outings: [],
    chunks: [KEY_A, KEY_B].map((key) => ({
      key, contentRev: 1, builtRev: 1, fixCount: 5, exactCount: 5, fixDigest: 'digest',
    })),
  }
}

function claim(selectedKeys: readonly CoverageChunkKey[]): CoverageClaim {
  return {
    changeSeq: 1, databaseReady: true, blockers: [],
    chunkRevisions: selectedKeys.map((key) => ({ key, contentRev: 1 })),
  }
}

type FakeMap = {
  /** False while the map cannot apply anything (style gone, sync stuck). */
  working: boolean
  omissions: CoverageOmissions
  syncs: number
}

/** Builds a controller wired to a fake map that mimics the overlay hook's re-run rule. */
function harness(options: { readonly failDelivery?: (call: number) => boolean } = {}) {
  let stage = 0
  let controller: CoverageController | null = null
  const map: FakeMap = { working: true, omissions: { omittedDeviceIds: [], omittedPeriodKeys: [] }, syncs: 0 }
  let lastCatalog: CoverageTileCatalog | null = null
  let lastSignature = ''
  const deliverSelection = vi.fn(async (request: {
    readonly chunks: readonly { readonly key: CoverageChunkKey; readonly contentRev: number }[]
  }): Promise<CoverageReadResult<CoverageTileCatalog>> => {
    if (options.failDelivery?.(deliverSelection.mock.calls.length) === true) {
      throw new Error('Coverage tile worker is unavailable.')
    }
    stage += 1
    return {
      missionId: 'mission-1',
      activationId: `stage-${stage}`,
      periods: [{ periodKey: 'outing\u0000outing-1', revisionDigest: `stage-${stage}` }],
      delivered: request.chunks.map((chunk) => ({ key: chunk.key, contentRev: chunk.contentRev })),
    }
  })
  const syncMap = (state: CoverageState): void => {
    const inputs = selectCoverageOverlaySyncInputs(state, 'mission-1', map.omissions)
    if (inputs.catalog === lastCatalog && inputs.selectionSignature === lastSignature) return
    lastCatalog = inputs.catalog
    lastSignature = inputs.selectionSignature
    if (!map.working) return
    const catalog = inputs.catalog
    const manifestNow = state.status === 'inactive' ? null : state.manifest
    queueMicrotask(() => {
      void (async () => {
        map.syncs += 1
        await controller?.notifySelectionApplied(selectCoverageChunkKeys(manifestNow, map.omissions))
        if (catalog !== null) await controller?.notifyCatalogApplied(catalog)
      })().catch(() => undefined)
    })
  }
  controller = createCoverageController({
    monotonicNow: () => Date.now(),
    readManifest: vi.fn(async () => manifest()),
    readChunk: vi.fn(async () => { throw new Error('not used') }),
    readClaim: vi.fn(async (query: { readonly selectedKeys: readonly CoverageChunkKey[] }) => claim(query.selectedKeys)),
    applyChunk: vi.fn(async () => undefined),
    deliverSelection,
    publish: syncMap,
  })
  return { controller, deliverSelection, map }
}

function active(state: CoverageState): Exclude<CoverageState, { status: 'inactive' }> {
  if (state.status === 'inactive') throw new Error('Coverage unexpectedly inactive.')
  return state
}

async function loadComplete(controller: CoverageController): Promise<void> {
  await controller.updateContext({ missionId: 'mission-1', rendererGeneration: 'r1' })
  await vi.advanceTimersByTimeAsync(0)
  expect(active(controller.getState()).status).toBe('complete')
}

describe('DON-338: the history line recovers after the tile worker dies', () => {
  it('rebuilds without operator action and never reads up to date meanwhile', async () => {
    vi.useFakeTimers()
    const { controller, deliverSelection } = harness()
    await loadComplete(controller)
    expect(deliverSelection).toHaveBeenCalledTimes(1)

    controller.notifyRendererUnavailable('Coverage tile worker is unavailable.')
    const failed = active(controller.getState())
    expect(failed.status).toBe('error')
    expect(failed.updating).toBe(true)
    expect(summarizeCoverageStatus(failed)).toMatchObject({ kind: 'failed', automaticRetry: true })

    await vi.advanceTimersByTimeAsync(250)
    expect(deliverSelection).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(0)
    expect(active(controller.getState())).toMatchObject({ status: 'complete', deliveredFixCount: 10 })
    controller.stop()
  })

  it('schedules the next attempt when a recovery load also fails', async () => {
    vi.useFakeTimers()
    // The first rebuild after the worker died fails too.
    const { controller, deliverSelection } = harness({ failDelivery: (call) => call === 2 })
    await loadComplete(controller)

    controller.notifyRendererUnavailable('Coverage tile worker is unavailable.')
    await vi.advanceTimersByTimeAsync(250)
    expect(deliverSelection).toHaveBeenCalledTimes(2)
    const stillFailed = active(controller.getState())
    expect(stillFailed.status).toBe('error')
    expect(stillFailed.updating).toBe(true)
    expect(summarizeCoverageStatus(stillFailed).kind).toBe('failed')

    await vi.advanceTimersByTimeAsync(5_000)
    expect(deliverSelection).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(0)
    expect(active(controller.getState()).status).toBe('complete')
    controller.stop()
  })

  it('keeps retrying on the capped backoff while every rebuild fails', async () => {
    vi.useFakeTimers()
    const { controller, deliverSelection } = harness({ failDelivery: (call) => call >= 2 })
    await loadComplete(controller)

    controller.notifyRendererUnavailable('Coverage tile worker is unavailable.')
    await vi.advanceTimersByTimeAsync(250 + 5_000 + 15_000 + 30_000 + 30_000)
    expect(deliverSelection).toHaveBeenCalledTimes(6)
    expect(active(controller.getState())).toMatchObject({ status: 'error', updating: true })
    controller.stop()
  })
})

describe('DON-338: Retry makes the map re-apply a stalled catalog or filter', () => {
  it('recovers a detached map once the map can draw again', async () => {
    vi.useFakeTimers()
    const { controller, map } = harness()
    await loadComplete(controller)

    map.working = false
    controller.notifyRendererDetached()
    expect(active(controller.getState()).blockers).toContain('renderer_detached')
    map.working = true

    await controller.resume()
    await vi.advanceTimersByTimeAsync(0)
    const recovered = active(controller.getState())
    expect(recovered.blockers ?? []).not.toContain('renderer_detached')
    expect(recovered.status).toBe('complete')
    controller.stop()
  })

  it('recovers a history filter the map never applied', async () => {
    vi.useFakeTimers()
    const { controller, map } = harness()
    await loadComplete(controller)

    map.working = false
    map.omissions = { omittedDeviceIds: ['device-b'], omittedPeriodKeys: [] }
    await controller.updateContext({
      missionId: 'mission-1', rendererGeneration: 'r1', omittedDeviceIds: ['device-b'],
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(active(controller.getState()).blockers).toContain('renderer_filter_pending')
    map.working = true

    await controller.resume()
    await vi.advanceTimersByTimeAsync(0)
    const recovered = active(controller.getState())
    expect(recovered.blockers ?? []).not.toContain('renderer_filter_pending')
    expect(recovered).toMatchObject({ status: 'complete', totalFixCount: 5 })
    controller.stop()
  })
})
