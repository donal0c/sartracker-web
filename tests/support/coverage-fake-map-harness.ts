import { expect, vi } from 'vitest'

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
import { selectCoverageOverlaySyncInputs } from '../../src/features/tracking/sync-coverage-overlay'
import { selectCoverageChunkKeys, type CoverageOmissions } from '../../src/features/tracking/coverage-filter-selection'

/**
 * A real coverage controller wired to a fake native store and a fake map
 * that re-runs its sync exactly when use-map-overlays would (catalog object
 * identity or selection signature changes) [DON-338].
 */

export const KEY_A: CoverageChunkKey = { device_id: 'device-a', period_kind: 'outing', period_id: 'outing-1' }
export const KEY_B: CoverageChunkKey = { device_id: 'device-b', period_kind: 'outing', period_id: 'outing-1' }

export type FakeMap = {
  /** False while the map cannot apply anything (style gone, sync stuck). */
  working: boolean
  omissions: CoverageOmissions
  syncs: number
}

export type FakeStore = {
  /** Blockers the next completeness claim reports. */
  claimBlockers: readonly string[]
  /** Chunk revision the claim reports as saved; above 1 means saved history the line does not show yet. */
  claimContentRev: number
}

/** Builds the two-device manifest every harness load reads. */
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

/** Builds a controller wired to a fake store and a fake map that mimics the overlay hook's re-run rule. */
export function createCoverageFakeMapHarness(options: {
  readonly failDelivery?: (call: number) => boolean
  readonly claimBlockers?: readonly string[]
  readonly claimContentRev?: number
} = {}) {
  let stage = 0
  let controller: CoverageController | null = null
  const map: FakeMap = { working: true, omissions: { omittedDeviceIds: [], omittedPeriodKeys: [] }, syncs: 0 }
  const store: FakeStore = { claimBlockers: options.claimBlockers ?? [], claimContentRev: options.claimContentRev ?? 1 }
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
    readClaim: vi.fn(async (query: { readonly selectedKeys: readonly CoverageChunkKey[] }): Promise<CoverageClaim> => ({
      changeSeq: 1, databaseReady: true, blockers: store.claimBlockers,
      chunkRevisions: query.selectedKeys.map((key) => ({ key, contentRev: store.claimContentRev })),
    })),
    applyChunk: vi.fn(async () => undefined),
    deliverSelection,
    publish: syncMap,
  })
  return { controller, deliverSelection, map, store }
}

/** Narrows coverage state to an active mission, failing the test otherwise. */
export function activeCoverage(state: CoverageState): Exclude<CoverageState, { status: 'inactive' }> {
  if (state.status === 'inactive') throw new Error('Coverage unexpectedly inactive.')
  return state
}

/** Loads mission-1 and lets the fake map apply it. */
export async function loadCoverage(controller: CoverageController): Promise<void> {
  await controller.updateContext({ missionId: 'mission-1', rendererGeneration: 'r1' })
  await vi.advanceTimersByTimeAsync(0)
}

/** Loads mission-1 and asserts every selected fix is drawn and verified. */
export async function loadCoverageComplete(controller: CoverageController): Promise<void> {
  await loadCoverage(controller)
  expect(activeCoverage(controller.getState()).status).toBe('complete')
}
