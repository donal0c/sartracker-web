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
import {
  COVERAGE_CATCH_UP_STALL_MS,
  summarizeCoverageStatus,
} from '../../src/features/tracking/coverage-progress'
import { selectCoverageOverlaySyncInputs } from '../../src/features/tracking/sync-coverage-overlay'

/**
 * DON-338 piece 5: the whole-history (coverage) status must tell the truth.
 * These drive the real controller with a fake native store and a fake map
 * renderer; only the store and MapLibre are replaced.
 */

const KEY: CoverageChunkKey = { device_id: 'device-a', period_kind: 'outing', period_id: 'outing-1' }
const OPEN_OUTING = { id: 'outing-1', label: 'Outing 1', started_at: '2026-11-07T08:00:00.000Z', ended_at: null }

afterEach(() => vi.useRealTimers())

/** One open-outing chunk at `rev`; built only when `built` equals `rev`. */
function manifest(rev: number, built: number | null, count: number): CoverageManifest {
  return {
    changeSeq: rev,
    enumerated: true,
    pendingInvalidation: false,
    backfillIncomplete: false,
    outings: [OPEN_OUTING],
    chunks: [{
      key: KEY,
      contentRev: rev,
      builtRev: built,
      fixCount: built === rev ? count : null,
      exactCount: count,
      fixDigest: built === rev ? `digest-${rev}` : null,
    }],
  }
}

function claim(rev: number): CoverageClaim {
  return { changeSeq: rev, databaseReady: true, blockers: [], chunkRevisions: [{ key: KEY, contentRev: rev }] }
}

type Store = {
  manifest: CoverageManifest
  stale: boolean
  acknowledge: boolean
}

/** Builds a controller whose fake renderer acknowledges each staged catalog. */
function harness(store: Store) {
  let stage = 0
  let controller: CoverageController | null = null
  const deliverSelection = vi.fn(async (request: {
    readonly chunks: readonly { readonly key: CoverageChunkKey; readonly contentRev: number }[]
  }): Promise<CoverageReadResult<CoverageTileCatalog>> => {
    if (store.stale) return { kind: 'stale', reason: 'coverage_revision_moved', changeSeq: store.manifest.changeSeq }
    stage += 1
    return {
      missionId: 'mission-1',
      activationId: `stage-${stage}`,
      periods: [{ periodKey: 'outing\u0000outing-1', revisionDigest: `rev-${request.chunks[0]?.contentRev ?? 0}` }],
      delivered: request.chunks.map((chunk) => ({ key: chunk.key, contentRev: chunk.contentRev })),
    }
  })
  const acknowledged = new Set<string>()
  controller = createCoverageController({
    monotonicNow: () => Date.now(),
    readManifest: vi.fn(async () => store.manifest),
    readChunk: vi.fn(async () => { throw new Error('not used') }),
    readClaim: vi.fn(async () => claim(store.manifest.changeSeq)),
    applyChunk: vi.fn(async () => undefined),
    deliverSelection,
    publish: (state) => {
      if (!store.acknowledge || state.status !== 'loading' || state.tileCatalog === null) return
      const catalog = state.tileCatalog
      const id = catalog.activationId ?? ''
      if (acknowledged.has(id)) return
      acknowledged.add(id)
      queueMicrotask(() => { void controller?.notifyCatalogApplied(catalog).catch(() => undefined) })
    },
  })
  return { controller, deliverSelection, acknowledged }
}

function active(state: CoverageState): Exclude<CoverageState, { status: 'inactive' }> {
  if (state.status === 'inactive') throw new Error('Coverage unexpectedly inactive.')
  return state
}

describe('DON-338 coverage status that can be trusted', () => {
  it('REN-2: a moving device reads catching up with the true drawn count, not "incomplete, 0 of N"', async () => {
    vi.useFakeTimers()
    const store: Store = { manifest: manifest(1, 0, 37_000), stale: false, acknowledge: true }
    const { controller } = harness(store)
    // The line is staged from revision 1; by the time it is drawn the person has moved on (revision 2).
    let reads = 0
    const original = store.manifest
    Object.defineProperty(store, 'manifest', {
      configurable: true,
      get: () => (reads++ === 0 ? original : manifest(2, 1, 37_010)),
    })

    await controller.updateContext({ missionId: 'mission-1', rendererGeneration: 'r1' })
    await vi.advanceTimersByTimeAsync(0)

    const moving = active(controller.getState())
    expect(moving.status).toBe('partial')
    expect(moving.drawnFixCount).toBe(37_000)
    expect(moving.totalFixCount).toBe(37_010)
    expect(moving.updating).toBe(true)
    expect(summarizeCoverageStatus(moving)).toMatchObject({
      kind: 'catching_up', needsAttention: false, drawnFixCount: 37_000, totalFixCount: 37_010,
    })

    // The automatic refresh catches up without the operator.
    await vi.advanceTimersByTimeAsync(30_000)
    expect(active(controller.getState())).toMatchObject({ status: 'complete', drawnFixCount: 37_010 })
    expect(summarizeCoverageStatus(controller.getState()).kind).toBe('up_to_date')
    controller.stop()
  })

  it('REN-2: continuous movement that keeps being drawn never escalates to a warning', async () => {
    vi.useFakeTimers()
    let rev = 1
    let reads = 0
    const store: Store = { manifest: manifest(1, 1, 100), stale: false, acknowledge: true }
    Object.defineProperty(store, 'manifest', {
      configurable: true,
      // Every second manifest read sees one more fix: the person never stops moving.
      get: () => {
        reads += 1
        if (reads % 2 === 0) rev += 1
        return manifest(rev, rev - 1, 99 + rev)
      },
    })
    const { controller } = harness(store)
    await controller.updateContext({ missionId: 'mission-1', rendererGeneration: 'r1' })
    for (let step = 0; step < 20; step += 1) {
      await vi.advanceTimersByTimeAsync(30_000)
      await controller.notifyChanged('mission-1', rev + 1)
      const current = active(controller.getState())
      expect(current.stalled).toBe(false)
      expect(summarizeCoverageStatus(current)).toMatchObject({ kind: 'catching_up', needsAttention: false })
      expect(current.drawnFixCount).toBeGreaterThan(0)
    }
    controller.stop()
  })

  it('REN-3/COV-2: a line that cannot be drawn for two minutes becomes a visible warning', async () => {
    vi.useFakeTimers()
    const store: Store = { manifest: manifest(1, 1, 500), stale: true, acknowledge: true }
    const { controller } = harness(store)
    await controller.updateContext({ missionId: 'mission-1', rendererGeneration: 'r1' })
    await vi.advanceTimersByTimeAsync(0)

    const early = active(controller.getState())
    expect(early.drawnFixCount).toBe(0)
    expect(early.stalled).toBe(false)
    expect(summarizeCoverageStatus(early)).toMatchObject({ kind: 'loading', needsAttention: false })

    await vi.advanceTimersByTimeAsync(COVERAGE_CATCH_UP_STALL_MS)
    const stalled = active(controller.getState())
    expect(stalled.stalled).toBe(true)
    expect(summarizeCoverageStatus(stalled)).toMatchObject({ kind: 'behind', needsAttention: true, stalled: true })

    // It clears itself once the line is drawn again.
    store.stale = false
    await vi.advanceTimersByTimeAsync(30_000)
    expect(active(controller.getState())).toMatchObject({ status: 'complete', stalled: false })
    controller.stop()
  })

  it('REN-3: a map that never accepts the update ends in a visible failure that retries itself', async () => {
    vi.useFakeTimers()
    const store: Store = { manifest: manifest(1, 1, 50), stale: false, acknowledge: false }
    const { controller } = harness(store)
    void controller.updateContext({ missionId: 'mission-1', rendererGeneration: 'r1' })
    await vi.advanceTimersByTimeAsync(0)
    expect(active(controller.getState()).status).toBe('loading')

    await vi.advanceTimersByTimeAsync(60_000)
    const failed = active(controller.getState())
    expect(failed).toMatchObject({ status: 'error', lastErrorClass: 'timeout', updating: true })
    expect(summarizeCoverageStatus(failed)).toMatchObject({
      kind: 'failed', needsAttention: true, automaticRetry: true,
    })

    store.acknowledge = true
    await vi.advanceTimersByTimeAsync(30_000)
    expect(active(controller.getState()).status).toBe('complete')
    controller.stop()
  })

  it('REN-4: a failed history load recovers without the operator', async () => {
    vi.useFakeTimers()
    const store: Store = { manifest: manifest(1, 1, 50), stale: false, acknowledge: true }
    const { controller } = harness(store)
    let failures = 1
    const original = store.manifest
    Object.defineProperty(store, 'manifest', {
      configurable: true,
      get: () => {
        if (failures > 0) {
          failures -= 1
          throw new Error('Coverage manifest worker timed out.')
        }
        return original
      },
    })
    await controller.updateContext({ missionId: 'mission-1', rendererGeneration: 'r1' })
    await vi.advanceTimersByTimeAsync(0)
    expect(active(controller.getState())).toMatchObject({ status: 'error', updating: true })

    await vi.advanceTimersByTimeAsync(30_000)
    expect(active(controller.getState()).status).toBe('complete')
    controller.stop()
  })

  it('REN-4: repeated map source failures keep retrying with a growing delay, not once', async () => {
    vi.useFakeTimers()
    const store: Store = { manifest: manifest(1, 1, 50), stale: false, acknowledge: false }
    const { controller, deliverSelection } = harness(store)
    const failCurrent = (): void => {
      const current = active(controller.getState())
      const catalog = current.tileCatalog
      if (catalog === null) throw new Error('No staged catalog to fail.')
      controller.notifyRendererFailure({
        missionId: 'mission-1',
        periodKey: catalog.periods[0]!.periodKey,
        revisionDigest: catalog.periods[0]!.revisionDigest,
        ...(catalog.activationId === undefined ? {} : { activationId: catalog.activationId }),
        message: 'Coverage overlay source loading timed out.',
      })
    }
    void controller.updateContext({ missionId: 'mission-1', rendererGeneration: 'r1' })
    await vi.advanceTimersByTimeAsync(0)
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      expect(deliverSelection).toHaveBeenCalledTimes(attempt)
      failCurrent()
      expect(active(controller.getState())).toMatchObject({ status: 'error', updating: true })
      await vi.advanceTimersByTimeAsync(30_000)
    }
    expect(deliverSelection).toHaveBeenCalledTimes(5)
    store.acknowledge = true
    const staged = active(controller.getState()).tileCatalog
    if (staged === null) throw new Error('No staged recovery catalog.')
    await controller.notifyCatalogApplied(staged)
    await vi.advanceTimersByTimeAsync(0)
    expect(active(controller.getState()).status).toBe('complete')
    controller.stop()
  })

  it('REN-5: a renderer restart redraws the open outing at once instead of leaving it off the map', async () => {
    vi.useFakeTimers()
    const store: Store = { manifest: manifest(1, 1, 50), stale: false, acknowledge: true }
    const { controller, deliverSelection } = harness(store)
    await controller.updateContext({ missionId: 'mission-1', rendererGeneration: 'r1' })
    await vi.advanceTimersByTimeAsync(0)
    expect(active(controller.getState()).status).toBe('complete')

    // The map was rebuilt (new renderer generation) a few seconds later.
    await vi.advanceTimersByTimeAsync(5_000)
    await controller.updateContext({ missionId: 'mission-1', rendererGeneration: 'r2' })
    await vi.advanceTimersByTimeAsync(0)
    expect(deliverSelection).toHaveBeenCalledTimes(2)
    const redrawn = active(controller.getState())
    expect(redrawn.tileCatalog).not.toBeNull()
    expect(redrawn).toMatchObject({ status: 'complete', drawnFixCount: 50 })
    controller.stop()
  })

  it('REN-3: state churn from new fixes does not restart the map update for the same catalog', async () => {
    vi.useFakeTimers()
    const store: Store = { manifest: manifest(1, 1, 50), stale: false, acknowledge: false }
    const { controller } = harness(store)
    // Fake map: re-runs the overlay sync only when its inputs change, takes 200 ms
    // to load the staged source, and is aborted when a re-run starts.
    let inFlight: AbortController | null = null
    let lastSignature: string | null = null
    let syncStarts = 0
    let lastCatalog: CoverageTileCatalog | null = null
    const unsubscribe = setInterval(() => {
      const inputs = selectCoverageOverlaySyncInputs(controller.getState(), 'mission-1', {
        omittedDeviceIds: [], omittedPeriodKeys: [],
      })
      const signature = `${inputs.catalog === null ? 'none' : inputs.catalog.activationId}|${inputs.selectionSignature}`
      if (signature === lastSignature && inputs.catalog === lastCatalog) return
      lastSignature = signature
      lastCatalog = inputs.catalog
      inFlight?.abort()
      const run = new AbortController()
      inFlight = run
      syncStarts += 1
      const catalog = inputs.catalog
      if (catalog === null) return
      setTimeout(() => {
        if (run.signal.aborted) return
        void controller.notifyCatalogApplied(catalog).catch(() => undefined)
      }, 200)
    }, 10)

    void controller.updateContext({ missionId: 'mission-1', rendererGeneration: 'r1' })
    let seq = 1
    for (let tick = 0; tick < 20; tick += 1) {
      seq += 1
      await controller.notifyChanged('mission-1', seq)
      await vi.advanceTimersByTimeAsync(100)
    }
    clearInterval(unsubscribe)
    const after = active(controller.getState())
    expect(after.drawnFixCount).toBe(50)
    expect(syncStarts).toBeLessThanOrEqual(3)
    controller.stop()
  })

  it('REN-3: overlay sync inputs ignore churn that does not change what the map must draw', () => {
    const catalog: CoverageTileCatalog = {
      missionId: 'mission-1', activationId: 'stage-1',
      periods: [{ periodKey: 'outing\u0000outing-1', revisionDigest: 'rev-1' }],
      delivered: [{ key: KEY, contentRev: 1 }],
    }
    const base: CoverageState = {
      status: 'loading', missionId: 'mission-1', rendererGeneration: 'r1',
      changeSeq: 1, latestObservedChangeSeq: 1, manifest: manifest(1, 1, 10),
      tileCatalog: catalog, delivered: {}, deliveredFixCount: 0, totalFixCount: 10,
    }
    const omissions = { omittedDeviceIds: [], omittedPeriodKeys: [] }
    const first = selectCoverageOverlaySyncInputs(base, 'mission-1', omissions)
    const churned = selectCoverageOverlaySyncInputs({
      ...base, status: 'partial', latestObservedChangeSeq: 9, deliveredFixCount: 10,
      manifest: manifest(2, 1, 11), delivered: { x: 1 },
    }, 'mission-1', omissions)
    expect(churned.catalog).toBe(first.catalog)
    expect(churned.selectionSignature).toBe(first.selectionSignature)

    const filtered = selectCoverageOverlaySyncInputs(base, 'mission-1', {
      omittedDeviceIds: ['device-a'], omittedPeriodKeys: [],
    })
    expect(filtered.selectionSignature).not.toBe(first.selectionSignature)
    expect(selectCoverageOverlaySyncInputs(base, 'mission-2', omissions).catalog).toBeNull()
  })
})
