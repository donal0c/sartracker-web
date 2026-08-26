import { describe, expect, it, vi } from 'vitest'

import type {
  CoverageChunkKey,
  CoverageManifest,
  CoverageTileCatalog,
} from '../../src/infrastructure/mission-store/tauri-mission-store'
import { createCoverageController } from '../../src/features/tracking/coverage-controller'

const KEY_A: CoverageChunkKey = {
  device_id: 'device-a', period_kind: 'outing', period_id: 'outing-1',
}
const KEY_B: CoverageChunkKey = {
  device_id: 'device-b', period_kind: 'outing', period_id: 'outing-1',
}
const KEY_C: CoverageChunkKey = {
  device_id: 'device-c', period_kind: 'outing', period_id: 'outing-2',
}

describe('coverage controller [DON-276]', () => {
  it('attests delivery only after applying every selected chunk and a fresh claim', async () => {
    const harness = createHarness(manifest(1, [[KEY_A, 1], [KEY_B, 1]]))

    await harness.controller.updateContext({ missionId: 'mission-1', rendererGeneration: 'r1' })

    expect(harness.applyChunk).toHaveBeenCalledTimes(2)
    expect(harness.controller.getState()).toMatchObject({
      status: 'complete', missionId: 'mission-1', deliveredFixCount: 2, totalFixCount: 2,
    })
  })

  it('does not republish settled state for a repeated map selection acknowledgement', async () => {
    const harness = createHarness(manifest(1, [[KEY_A, 1]]))
    await harness.controller.updateContext({ missionId: 'mission-1', rendererGeneration: 'r1' })
    const publishCount = harness.publish.mock.calls.length

    await harness.controller.notifySelectionApplied()

    expect(harness.publish).toHaveBeenCalledTimes(publishCount)
    expect(harness.controller.getState()).toMatchObject({ status: 'complete' })
  })

  it('merges by chunk key, retains unchanged delivery, and reloads only the moved revision', async () => {
    const harness = createHarness(manifest(1, [[KEY_A, 1], [KEY_B, 1]]))
    await harness.controller.updateContext({ missionId: 'mission-1', rendererGeneration: 'r1' })
    harness.readManifest.mockResolvedValueOnce(manifest(2, [[KEY_A, 2], [KEY_B, 1]]))
    harness.readClaim.mockResolvedValueOnce({
      changeSeq: 2,
      databaseReady: true,
      blockers: [],
      chunkRevisions: [
        { key: KEY_A, contentRev: 2 },
        { key: KEY_B, contentRev: 1 },
      ],
    })

    await harness.controller.refresh()

    expect(harness.readChunk.mock.calls.slice(2).map((call) => call[0].key)).toEqual([KEY_A])
    expect(harness.controller.getState()).toMatchObject({ status: 'complete' })
  })

  it('resets delivery on renderer restart and re-delivers fresh SQLite chunks', async () => {
    const harness = createHarness(manifest(1, [[KEY_A, 1], [KEY_B, 1]]))
    await harness.controller.updateContext({ missionId: 'mission-1', rendererGeneration: 'r1' })

    await harness.controller.updateContext({ missionId: 'mission-1', rendererGeneration: 'r2' })

    expect(harness.readChunk).toHaveBeenCalledTimes(4)
    expect(harness.controller.getState()).toMatchObject({
      status: 'complete', rendererGeneration: 'r2', deliveredFixCount: 2,
    })
  })

  it('revokes Complete synchronously before a wider filter scope can be relabelled', async () => {
    const harness = createHarness(manifest(1, [[KEY_A, 1], [KEY_B, 1]]))
    await harness.controller.updateContext({
      missionId: 'mission-1', rendererGeneration: 'r1', selectedKeys: [KEY_A],
    })
    expect(harness.controller.getState()).toMatchObject({
      status: 'complete', deliveredFixCount: 1, totalFixCount: 1,
    })

    const widenSelection = harness.controller.updateContext({
      missionId: 'mission-1', rendererGeneration: 'r1',
    })

    expect(harness.controller.getState()).toMatchObject({
      status: 'partial', deliveredFixCount: 1, totalFixCount: 2,
    })
    await widenSelection
    await harness.controller.notifySelectionApplied()
    expect(harness.controller.getState()).toMatchObject({
      status: 'complete', deliveredFixCount: 2, totalFixCount: 2,
    })
  })

  it('does not restore Complete until a reversed filter is applied to the map', async () => {
    const harness = createHarness(manifest(1, [[KEY_A, 1], [KEY_B, 1]]))
    await harness.controller.updateContext({
      missionId: 'mission-1', rendererGeneration: 'r1', selectedKeys: [KEY_A],
    })

    const widenSelection = harness.controller.updateContext({
      missionId: 'mission-1', rendererGeneration: 'r1',
    })
    const restoreSelection = harness.controller.updateContext({
      missionId: 'mission-1', rendererGeneration: 'r1', selectedKeys: [KEY_A],
    })

    expect(harness.controller.getState()).toMatchObject({
      status: 'partial', deliveredFixCount: 1, totalFixCount: 1,
      blockers: ['renderer_filter_pending'],
    })
    await Promise.all([widenSelection, restoreSelection])
    expect(harness.controller.getState()).toMatchObject({
      status: 'partial', blockers: ['renderer_filter_pending'],
    })

    await harness.controller.notifySelectionApplied()
    expect(harness.controller.getState()).toMatchObject({
      status: 'partial', blockers: ['renderer_filter_pending'],
    })

    await harness.controller.notifySelectionApplied([KEY_A])

    expect(harness.controller.getState()).toMatchObject({
      status: 'complete', deliveredFixCount: 1, totalFixCount: 1,
    })
  })

  it('does not restore a queued Complete claim after newer evidence is observed', async () => {
    const harness = createHarness(manifest(1, [[KEY_A, 1], [KEY_B, 1]]))
    await harness.controller.updateContext({
      missionId: 'mission-1', rendererGeneration: 'r1', selectedKeys: [KEY_A],
    })

    const widenSelection = harness.controller.updateContext({
      missionId: 'mission-1', rendererGeneration: 'r1',
    })
    const refresh = harness.controller.notifyChanged('mission-1', 2)
    const restoreSelection = harness.controller.updateContext({
      missionId: 'mission-1', rendererGeneration: 'r1', selectedKeys: [KEY_A],
    })

    expect(harness.controller.getState()).toMatchObject({
      status: 'partial', latestObservedChangeSeq: 2,
    })
    await Promise.all([widenSelection, refresh, restoreSelection])
  })

  it('keeps delivered geometry on cancel and resumes only undelivered chunks', async () => {
    let releaseSecond: (() => void) | undefined
    let blockedSecond = false
    const harness = createHarness(manifest(1, [[KEY_A, 1], [KEY_B, 1]]))
    harness.readChunk.mockImplementation(async ({ key }) => {
      if (key.device_id === 'device-b' && !blockedSecond) {
        blockedSecond = true
        await new Promise<void>((resolve) => { releaseSecond = resolve })
      }
      return page(key, 1)
    })
    const load = harness.controller.updateContext({ missionId: 'mission-1', rendererGeneration: 'r1' })
    await vi.waitFor(() => expect(harness.readChunk).toHaveBeenCalledTimes(2))

    harness.controller.cancel()
    releaseSecond?.()
    await load
    expect(harness.controller.getState()).toMatchObject({
      status: 'partial', deliveredFixCount: 1,
    })

    await harness.controller.resume()
    expect(harness.readChunk).toHaveBeenCalledTimes(3)
    expect(harness.controller.getState()).toMatchObject({ status: 'complete' })
  })

  it('fails closed on mission switch and ignores the old mission completion', async () => {
    let releaseOld: (() => void) | undefined
    const harness = createHarness(manifest(1, [[KEY_A, 1]]))
    harness.readChunk.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => { releaseOld = resolve })
      return page(KEY_A, 1)
    })
    const oldLoad = harness.controller.updateContext({ missionId: 'mission-1', rendererGeneration: 'r1' })
    await vi.waitFor(() => expect(harness.readChunk).toHaveBeenCalledTimes(1))
    harness.readManifest.mockResolvedValueOnce({
      ...manifest(1, []), changeSeq: 1,
    })

    await harness.controller.updateContext({ missionId: 'mission-2', rendererGeneration: 'r1' })
    releaseOld?.()
    await oldLoad

    expect(harness.controller.getState()).toMatchObject({
      missionId: 'mission-2', status: 'complete', deliveredFixCount: 0,
    })
  })

  it('coalesces a higher sequence behind active historical delivery instead of restarting it', async () => {
    let releaseSecond: (() => void) | undefined
    const harness = createHarness(manifest(1, [[KEY_A, 1], [KEY_B, 1]]))
    harness.readChunk.mockImplementation(async ({ key, expectedContentRev }) => {
      if (key.device_id === 'device-b') {
        await new Promise<void>((resolve) => { releaseSecond = resolve })
      }
      return page(key, expectedContentRev)
    })
    harness.readManifest.mockResolvedValueOnce(manifest(1, [[KEY_A, 1], [KEY_B, 1]]))
    harness.readManifest.mockResolvedValueOnce(manifest(2, [[KEY_A, 1], [KEY_B, 1]]))
    harness.readClaim.mockResolvedValueOnce({
      changeSeq: 1, databaseReady: true, blockers: [],
      chunkRevisions: [
        { key: KEY_A, contentRev: 1 }, { key: KEY_B, contentRev: 1 },
      ],
    })
    harness.readClaim.mockResolvedValueOnce({
      changeSeq: 2, databaseReady: true, blockers: [],
      chunkRevisions: [
        { key: KEY_A, contentRev: 1 }, { key: KEY_B, contentRev: 1 },
      ],
    })
    const initialLoad = harness.controller.updateContext({
      missionId: 'mission-1', rendererGeneration: 'r1',
    })
    await vi.waitFor(() => expect(harness.readChunk).toHaveBeenCalledTimes(2))

    void harness.controller.notifyChanged('mission-1', 2)
    expect(harness.readManifest).toHaveBeenCalledTimes(1)
    releaseSecond?.()
    await initialLoad
    await vi.waitFor(() => expect(harness.controller.getState()).toMatchObject({
      status: 'complete', changeSeq: 2,
    }))
    expect(harness.applyChunk).toHaveBeenCalledTimes(2)
  })

  it('attests Candidate B delivery from the active tile catalog without renderer GeoJSON pages', async () => {
    const initial = manifest(1, [[KEY_A, 1], [KEY_B, 1]])
    const readManifest = vi.fn().mockResolvedValue(initial)
    const readChunk = vi.fn()
    const applyChunk = vi.fn()
    const deliverSelection = vi.fn().mockResolvedValue({
      periods: [{ periodKey: 'outing\u0000outing-1', revisionDigest: 'revision-1' }],
      delivered: [
        { key: KEY_A, contentRev: 1 }, { key: KEY_B, contentRev: 1 },
      ],
    })
    const controller = createCoverageController({
      readManifest,
      readChunk,
      readClaim: vi.fn().mockResolvedValue({
        changeSeq: 1, databaseReady: true, blockers: [],
        chunkRevisions: [
          { key: KEY_A, contentRev: 1 }, { key: KEY_B, contentRev: 1 },
        ],
      }),
      applyChunk,
      deliverSelection,
      publish: vi.fn(),
    })

    const load = controller.updateContext({ missionId: 'mission-1', rendererGeneration: 'r1' })
    await vi.waitFor(() => expect(controller.getState()).toMatchObject({
      status: 'loading', tileCatalog: { periods: [{ revisionDigest: 'revision-1' }] },
      deliveredFixCount: 0,
    }))
    const pendingCatalog = controller.getState().status === 'inactive'
      ? null
      : controller.getState().tileCatalog
    controller.notifyCatalogApplied(pendingCatalog!)
    await load

    expect(readChunk).not.toHaveBeenCalled()
    expect(applyChunk).not.toHaveBeenCalled()
    expect(controller.getState()).toMatchObject({
      status: 'complete',
      tileCatalog: { periods: [{ revisionDigest: 'revision-1' }] },
      deliveredFixCount: 2,
    })
  })

  it('publishes Candidate B newest-period progress before the full catalog is ready', async () => {
    const initial: CoverageManifest = {
      ...manifest(1, [[KEY_A, 1], [KEY_C, 1]]),
      outings: [
        { id: 'outing-1', label: 'Older', started_at: '2026-08-20T09:00:00.000Z', ended_at: '2026-08-20T10:00:00.000Z' },
        { id: 'outing-2', label: 'Newest', started_at: '2026-08-24T09:00:00.000Z', ended_at: '2026-08-24T10:00:00.000Z' },
      ],
    }
    const deliverSelection = vi.fn(async ({ chunks }: {
      readonly chunks: readonly { readonly key: CoverageChunkKey; readonly contentRev: number }[]
    }) => ({
      periods: chunks.map((chunk) => ({
        periodKey: `${chunk.key.period_kind}\u0000${chunk.key.period_id}`,
        revisionDigest: `rev-${chunk.key.period_id}`,
      })),
      delivered: chunks,
    }))
    const controller = createCoverageController({
      readManifest: vi.fn().mockResolvedValue(initial),
      readChunk: vi.fn(),
      readClaim: vi.fn().mockResolvedValue({
        changeSeq: 1, databaseReady: true, blockers: [],
        chunkRevisions: [{ key: KEY_A, contentRev: 1 }, { key: KEY_C, contentRev: 1 }],
      }),
      applyChunk: vi.fn(), deliverSelection, publish: vi.fn(),
    })

    const load = controller.updateContext({ missionId: 'mission-1', rendererGeneration: 'r1' })
    await vi.waitFor(() => expect(deliverSelection).toHaveBeenCalledTimes(1))
    expect(deliverSelection.mock.calls[0]![0].chunks.map((chunk) => chunk.key)).toEqual([KEY_C])
    let pending = controller.getState()
    expect(pending).toMatchObject({ status: 'loading', deliveredFixCount: 0, totalFixCount: 2 })
    if (pending.status === 'inactive') throw new Error('Coverage unexpectedly inactive.')
    controller.notifyCatalogApplied(pending.tileCatalog!)

    await vi.waitFor(() => {
      expect(controller.getState()).toMatchObject({ status: 'loading', deliveredFixCount: 1 })
      expect(deliverSelection).toHaveBeenCalledTimes(2)
    })
    pending = controller.getState()
    if (pending.status === 'inactive') throw new Error('Coverage unexpectedly inactive.')
    controller.notifyCatalogApplied(pending.tileCatalog!)
    await load

    expect(controller.getState()).toMatchObject({ status: 'complete', deliveredFixCount: 2 })
  })

  it('keeps every progressive catalog in a multi-period renderer recovery fresh', async () => {
    const initial: CoverageManifest = {
      ...manifest(1, [[KEY_A, 1], [KEY_C, 1]]),
      outings: [
        { id: 'outing-1', label: 'Older', started_at: '2026-08-20T09:00:00.000Z', ended_at: '2026-08-20T10:00:00.000Z' },
        { id: 'outing-2', label: 'Newest', started_at: '2026-08-24T09:00:00.000Z', ended_at: '2026-08-24T10:00:00.000Z' },
      ],
    }
    const deliverSelection = vi.fn(async ({ chunks }: {
      readonly chunks: readonly { readonly key: CoverageChunkKey; readonly contentRev: number }[]
    }) => {
      const activationId = `multi-period-recovery-stage-${deliverSelection.mock.calls.length}`
      return {
        missionId: 'mission-1',
        activationId,
        periods: chunks.map((chunk) => ({
          periodKey: `${chunk.key.period_kind}\u0000${chunk.key.period_id}`,
          revisionDigest: `${chunk.key.period_id}-revision-1`,
        })),
        delivered: chunks,
      }
    })
    const controller = createCoverageController({
      readManifest: vi.fn().mockResolvedValue(initial),
      readChunk: vi.fn(),
      readClaim: vi.fn().mockResolvedValue({
        changeSeq: 1, databaseReady: true, blockers: [],
        chunkRevisions: [{ key: KEY_A, contentRev: 1 }, { key: KEY_C, contentRev: 1 }],
      }),
      applyChunk: vi.fn(), deliverSelection, publish: vi.fn(),
    })
    const applyCurrentCatalog = async (
      failureSources: readonly {
        readonly periodKey: string
        readonly revisionDigest: string
        readonly activationId: string
      }[],
    ): Promise<void> => {
      const current = controller.getState()
      if (current.status === 'inactive' || current.tileCatalog === null) {
        throw new Error('Coverage catalog was unavailable during the recovery regression.')
      }
      await controller.notifyCatalogApplied(current.tileCatalog, {
        failureSources,
        commit: vi.fn(), finalize: vi.fn(), rollback: vi.fn(),
      })
    }

    const initialLoad = controller.updateContext({
      missionId: 'mission-1', rendererGeneration: 'r1',
    })
    await vi.waitFor(() => expect(deliverSelection).toHaveBeenCalledTimes(1))
    await applyCurrentCatalog([{
      periodKey: 'outing\u0000outing-2',
      revisionDigest: 'outing-2-revision-1',
      activationId: 'multi-period-recovery-stage-1',
    }])
    await vi.waitFor(() => expect(deliverSelection).toHaveBeenCalledTimes(2))
    await applyCurrentCatalog([
      {
        periodKey: 'outing\u0000outing-2',
        revisionDigest: 'outing-2-revision-1',
        activationId: 'multi-period-recovery-stage-1',
      },
      {
        periodKey: 'outing\u0000outing-1',
        revisionDigest: 'outing-1-revision-1',
        activationId: 'multi-period-recovery-stage-2',
      },
    ])
    await initialLoad
    expect(controller.getState()).toMatchObject({ status: 'complete' })

    controller.notifyRendererFailure({
      missionId: 'mission-1',
      periodKey: 'outing\u0000outing-1',
      revisionDigest: 'outing-1-revision-1',
      activationId: 'multi-period-recovery-stage-2',
      message: 'Older retained coverage source failed.',
    })
    await vi.waitFor(() => expect(deliverSelection).toHaveBeenCalledTimes(3))
    expect(controller.getState()).toMatchObject({
      status: 'loading',
      tileCatalog: { requiresFreshRendererSources: true },
    })
    await applyCurrentCatalog([
      {
        periodKey: 'outing\u0000outing-2',
        revisionDigest: 'outing-2-revision-1',
        activationId: 'multi-period-recovery-stage-3',
      },
      {
        periodKey: 'outing\u0000outing-1',
        revisionDigest: 'outing-1-revision-1',
        activationId: 'multi-period-recovery-stage-2',
      },
    ])

    await vi.waitFor(() => expect(deliverSelection).toHaveBeenCalledTimes(4))
    expect(controller.getState()).toMatchObject({
      status: 'loading',
      tileCatalog: { requiresFreshRendererSources: true },
    })
    await applyCurrentCatalog([
      {
        periodKey: 'outing\u0000outing-2',
        revisionDigest: 'outing-2-revision-1',
        activationId: 'multi-period-recovery-stage-4',
      },
      {
        periodKey: 'outing\u0000outing-1',
        revisionDigest: 'outing-1-revision-1',
        activationId: 'multi-period-recovery-stage-4',
      },
    ])
    await vi.waitFor(() => expect(controller.getState()).toMatchObject({ status: 'complete' }))
  })

  it('rebuilds a changed period with every unchanged sibling descriptor', async () => {
    let current = manifest(1, [[KEY_A, 1], [KEY_B, 1]])
    const deliverSelection = vi.fn(async ({ chunks }: {
      readonly chunks: readonly { readonly key: CoverageChunkKey; readonly contentRev: number }[]
    }) => ({
      periods: [{ periodKey: 'outing\u0000outing-1', revisionDigest: `rev-${chunks[0]!.contentRev}` }],
      delivered: chunks,
    }))
    const controller = createCoverageController({
      readManifest: vi.fn(async () => current),
      readChunk: vi.fn(),
      readClaim: vi.fn(async () => ({
        changeSeq: current.changeSeq, databaseReady: true, blockers: [],
        chunkRevisions: current.chunks.map(({ key, contentRev }) => ({ key, contentRev })),
      })),
      applyChunk: vi.fn(), deliverSelection, publish: vi.fn(),
    })
    const initial = controller.updateContext({ missionId: 'mission-1', rendererGeneration: 'r1' })
    await vi.waitFor(() => expect(deliverSelection).toHaveBeenCalledTimes(1))
    if (controller.getState().status === 'inactive') throw new Error('Coverage unexpectedly inactive.')
    controller.notifyCatalogApplied(controller.getState().tileCatalog!)
    await initial

    current = manifest(2, [[KEY_A, 2], [KEY_B, 1]])
    const refresh = controller.refresh()
    await vi.waitFor(() => expect(deliverSelection).toHaveBeenCalledTimes(2))

    expect(deliverSelection.mock.calls[1]![0].chunks.map((chunk) => [
      chunk.key.device_id, chunk.contentRev,
    ])).toEqual([['device-a', 2], ['device-b', 1]])
    if (controller.getState().status === 'inactive') throw new Error('Coverage unexpectedly inactive.')
    controller.notifyCatalogApplied(controller.getState().tileCatalog!)
    await refresh
    expect(controller.getState()).toMatchObject({ status: 'complete', deliveredFixCount: 2 })
  })

  it('does not let an older in-flight claim overwrite a newer sequence revocation', async () => {
    let releaseFirstClaim: (() => void) | undefined
    const publish = vi.fn()
    const readManifest = vi.fn()
      .mockResolvedValueOnce(manifest(1, [[KEY_A, 1]]))
      .mockResolvedValueOnce(manifest(2, [[KEY_A, 1]]))
    const readClaim = vi.fn()
      .mockImplementationOnce(async () => {
        await new Promise<void>((resolve) => { releaseFirstClaim = resolve })
        return {
          changeSeq: 1, databaseReady: true, blockers: [],
          chunkRevisions: [{ key: KEY_A, contentRev: 1 }],
        }
      })
      .mockResolvedValueOnce({
        changeSeq: 2, databaseReady: true, blockers: [],
        chunkRevisions: [{ key: KEY_A, contentRev: 1 }],
      })
    const controller = createCoverageController({
      readManifest,
      readChunk: vi.fn(async ({ key, expectedContentRev }) => page(key, expectedContentRev)),
      readClaim,
      applyChunk: vi.fn(),
      publish,
    })
    const load = controller.updateContext({ missionId: 'mission-1', rendererGeneration: 'r1' })
    await vi.waitFor(() => expect(readClaim).toHaveBeenCalledTimes(1))

    await controller.notifyChanged('mission-1', 2)
    const publicationsAfterRevocation = publish.mock.calls.length
    releaseFirstClaim?.()
    await load
    await vi.waitFor(() => expect(controller.getState()).toMatchObject({
      status: 'complete', changeSeq: 2,
    }))

    expect(publish.mock.calls.slice(publicationsAfterRevocation)
      .map(([published]) => published)
      .some((published) => published.status === 'complete' && published.changeSeq === 1))
      .toBe(false)
  })

  it('cannot claim Complete when renderer catalog activation fails', async () => {
    const initial = manifest(1, [[KEY_A, 1]])
    const controller = createCoverageController({
      readManifest: vi.fn().mockResolvedValue(initial),
      readChunk: vi.fn(),
      readClaim: vi.fn().mockResolvedValue({
        changeSeq: 1, databaseReady: true, blockers: [],
        chunkRevisions: [{ key: KEY_A, contentRev: 1 }],
      }),
      applyChunk: vi.fn(),
      deliverSelection: vi.fn().mockResolvedValue({
        missionId: 'mission-1',
        periods: [{ periodKey: 'outing\u0000outing-1', revisionDigest: 'rev-1' }],
        delivered: [{ key: KEY_A, contentRev: 1 }],
      }),
      publish: vi.fn(),
    })

    const load = controller.updateContext({ missionId: 'mission-1', rendererGeneration: 'r1' })
    await vi.waitFor(() => expect(controller.getState()).toMatchObject({
      status: 'loading', deliveredFixCount: 0,
      tileCatalog: { periods: [{ revisionDigest: 'rev-1' }] },
    }))
    controller.notifyRendererFailure({
      missionId: 'mission-1',
      periodKey: 'outing\u0000outing-1', revisionDigest: 'rev-1',
      message: 'Coverage tile could not be decoded.',
    })
    await load

    expect(controller.getState()).toMatchObject({ status: 'error', deliveredFixCount: 0 })
  })

  it('automatically retries one transient renderer activation failure after the failed load settles', async () => {
    const initial = manifest(1, [[KEY_A, 1]])
    const deliverSelection = vi.fn(async () => {
      const attempt = deliverSelection.mock.calls.length
      return {
        periods: [{
          periodKey: 'outing\u0000outing-1',
          revisionDigest: `renderer-retry-${attempt}`,
        }],
        delivered: [{ key: KEY_A, contentRev: 1 }],
      }
    })
    const controller = createCoverageController({
      readManifest: vi.fn().mockResolvedValue(initial),
      readChunk: vi.fn(),
      readClaim: vi.fn().mockResolvedValue({
        changeSeq: 1, databaseReady: true, blockers: [],
        chunkRevisions: [{ key: KEY_A, contentRev: 1 }],
      }),
      applyChunk: vi.fn(),
      deliverSelection,
      publish: vi.fn(),
    })

    const firstLoad = controller.updateContext({
      missionId: 'mission-1', rendererGeneration: 'r1',
    })
    await vi.waitFor(() => expect(controller.getState()).toMatchObject({
      status: 'loading',
      tileCatalog: { periods: [{ revisionDigest: 'renderer-retry-1' }] },
    }))
    controller.notifyRendererFailure({
      missionId: 'mission-1',
      periodKey: 'outing\u0000outing-1',
      revisionDigest: 'renderer-retry-1',
      message: 'Coverage map source activation failed.',
    })
    await firstLoad

    await vi.waitFor(() => expect(deliverSelection).toHaveBeenCalledTimes(2))
    const recovery = controller.getState()
    if (recovery.status === 'inactive') throw new Error('Coverage unexpectedly inactive.')
    expect(recovery).toMatchObject({
      status: 'loading', deliveredFixCount: 0,
      tileCatalog: {
        requiresFreshRendererSources: true,
        periods: [{ revisionDigest: 'renderer-retry-2' }],
      },
    })
    await controller.notifyCatalogApplied(recovery.tileCatalog!)

    await vi.waitFor(() => expect(controller.getState()).toMatchObject({
      status: 'complete', deliveredFixCount: 1, totalFixCount: 1,
    }))
  })

  it('bounds automatic renderer recovery to one attempt until the operator retries', async () => {
    const initial = manifest(1, [[KEY_A, 1]])
    const deliverSelection = vi.fn(async () => {
      const attempt = deliverSelection.mock.calls.length
      return {
        missionId: 'mission-1',
        activationId: `bounded-renderer-stage-${attempt}`,
        periods: [{
          periodKey: 'outing\u0000outing-1',
          revisionDigest: 'unchanged-production-revision',
        }],
        delivered: [{ key: KEY_A, contentRev: 1 }],
      }
    })
    const controller = createCoverageController({
      readManifest: vi.fn().mockResolvedValue(initial),
      readChunk: vi.fn(),
      readClaim: vi.fn().mockResolvedValue({
        changeSeq: 1, databaseReady: true, blockers: [],
        chunkRevisions: [{ key: KEY_A, contentRev: 1 }],
      }),
      applyChunk: vi.fn(), deliverSelection, publish: vi.fn(),
    })
    const failCurrentCatalog = (): void => {
      const current = controller.getState()
      if (current.status === 'inactive' || current.tileCatalog === null) {
        throw new Error('Coverage catalog is unavailable for the failure probe.')
      }
      controller.notifyRendererFailure({
        missionId: 'mission-1',
        periodKey: 'outing\u0000outing-1',
        revisionDigest: current.tileCatalog.periods[0]!.revisionDigest,
        ...(current.tileCatalog.activationId === undefined
          ? {}
          : { activationId: current.tileCatalog.activationId }),
        message: 'Coverage map source activation failed.',
      })
    }

    const firstLoad = controller.updateContext({
      missionId: 'mission-1', rendererGeneration: 'r1',
    })
    await vi.waitFor(() => expect(deliverSelection).toHaveBeenCalledTimes(1))
    failCurrentCatalog()
    await firstLoad
    await vi.waitFor(() => expect(deliverSelection).toHaveBeenCalledTimes(2))
    failCurrentCatalog()
    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(deliverSelection).toHaveBeenCalledTimes(2)
    expect(controller.getState()).toMatchObject({ status: 'error' })

    const manualRetry = controller.resume()
    await vi.waitFor(() => expect(deliverSelection).toHaveBeenCalledTimes(3))
    failCurrentCatalog()
    await manualRetry
    await vi.waitFor(() => expect(deliverSelection).toHaveBeenCalledTimes(4))
    const recovery = controller.getState()
    if (recovery.status === 'inactive') throw new Error('Coverage unexpectedly inactive.')
    await controller.notifyCatalogApplied(recovery.tileCatalog!)

    await vi.waitFor(() => expect(controller.getState()).toMatchObject({ status: 'complete' }))
  })

  it('coalesces duplicate failures from one finalized catalog without cancelling recovery', async () => {
    const initial = manifest(1, [[KEY_A, 1]])
    const deliverSelection = vi.fn(async () => {
      const attempt = deliverSelection.mock.calls.length
      return {
        missionId: 'mission-1',
        activationId: `shared-activation-${attempt}`,
        periods: [{ periodKey: 'outing\u0000outing-1', revisionDigest: 'shared-revision' }],
        delivered: [{ key: KEY_A, contentRev: 1 }],
      }
    })
    const controller = createCoverageController({
      readManifest: vi.fn().mockResolvedValue(initial),
      readChunk: vi.fn(),
      readClaim: vi.fn().mockResolvedValue({
        changeSeq: 1, databaseReady: true, blockers: [],
        chunkRevisions: [{ key: KEY_A, contentRev: 1 }],
      }),
      applyChunk: vi.fn(), deliverSelection, publish: vi.fn(),
    })
    const initialLoad = controller.updateContext({
      missionId: 'mission-1', rendererGeneration: 'r1',
    })
    await vi.waitFor(() => expect(deliverSelection).toHaveBeenCalledTimes(1))
    let current = controller.getState()
    if (current.status === 'inactive') throw new Error('Coverage unexpectedly inactive.')
    await controller.notifyCatalogApplied(current.tileCatalog!)
    await initialLoad
    expect(controller.getState()).toMatchObject({ status: 'complete' })

    const failure = {
      missionId: 'mission-1',
      periodKey: 'outing\u0000outing-1',
      revisionDigest: 'shared-revision',
      activationId: 'shared-activation-1',
      message: 'Coverage tile delivery failed.',
    }
    controller.notifyRendererFailure(failure)
    controller.notifyRendererFailure(failure)

    await vi.waitFor(() => expect(deliverSelection).toHaveBeenCalledTimes(2))
    current = controller.getState()
    if (current.status === 'inactive') throw new Error('Coverage unexpectedly inactive.')
    await controller.notifyCatalogApplied(current.tileCatalog!)
    await vi.waitFor(() => expect(controller.getState()).toMatchObject({ status: 'complete' }))
  })

  it('coalesces a delayed duplicate while automatic recovery still reads its manifest', async () => {
    const initial = manifest(1, [[KEY_A, 1]])
    let releaseRecoveryManifest: (() => void) | undefined
    const readManifest = vi.fn()
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce(initial)
      .mockImplementationOnce(async () => {
        await new Promise<void>((resolve) => { releaseRecoveryManifest = resolve })
        return initial
      })
      .mockResolvedValue(initial)
    const deliverSelection = vi.fn(async () => {
      const attempt = deliverSelection.mock.calls.length
      return {
        missionId: 'mission-1',
        activationId: `manifest-recovery-stage-${attempt}`,
        periods: [{ periodKey: 'outing\u0000outing-1', revisionDigest: 'shared-revision' }],
        delivered: [{ key: KEY_A, contentRev: 1 }],
      }
    })
    const controller = createCoverageController({
      readManifest,
      readChunk: vi.fn(),
      readClaim: vi.fn().mockResolvedValue({
        changeSeq: 1, databaseReady: true, blockers: [],
        chunkRevisions: [{ key: KEY_A, contentRev: 1 }],
      }),
      applyChunk: vi.fn(), deliverSelection, publish: vi.fn(),
    })
    const initialLoad = controller.updateContext({
      missionId: 'mission-1', rendererGeneration: 'r1',
    })
    await vi.waitFor(() => expect(deliverSelection).toHaveBeenCalledTimes(1))
    let current = controller.getState()
    if (current.status === 'inactive') throw new Error('Coverage unexpectedly inactive.')
    await controller.notifyCatalogApplied(current.tileCatalog!)
    await initialLoad

    const failure = {
      missionId: 'mission-1',
      periodKey: 'outing\u0000outing-1',
      revisionDigest: 'shared-revision',
      activationId: 'manifest-recovery-stage-1',
      message: 'Coverage tile delivery failed.',
    }
    controller.notifyRendererFailure(failure)
    await vi.waitFor(() => expect(readManifest).toHaveBeenCalledTimes(3))
    expect(controller.getState()).toMatchObject({
      status: 'loading',
      tileCatalog: { activationId: 'manifest-recovery-stage-1' },
    })

    controller.notifyRendererFailure(failure)
    releaseRecoveryManifest?.()
    await vi.waitFor(() => expect(deliverSelection).toHaveBeenCalledTimes(2))
    current = controller.getState()
    if (current.status === 'inactive') throw new Error('Coverage unexpectedly inactive.')
    await controller.notifyCatalogApplied(current.tileCatalog!)

    await vi.waitFor(() => expect(controller.getState()).toMatchObject({
      status: 'complete',
      tileCatalog: { activationId: 'manifest-recovery-stage-2' },
    }))
  })

  it('ignores a delayed failure from the prior activation while its retry is loading', async () => {
    const initial = manifest(1, [[KEY_A, 1]])
    const deliverSelection = vi.fn(async () => {
      const attempt = deliverSelection.mock.calls.length
      return {
        missionId: 'mission-1',
        activationId: `delayed-failure-stage-${attempt}`,
        periods: [{ periodKey: 'outing\u0000outing-1', revisionDigest: 'shared-revision' }],
        delivered: [{ key: KEY_A, contentRev: 1 }],
      }
    })
    const controller = createCoverageController({
      readManifest: vi.fn().mockResolvedValue(initial),
      readChunk: vi.fn(),
      readClaim: vi.fn().mockResolvedValue({
        changeSeq: 1, databaseReady: true, blockers: [],
        chunkRevisions: [{ key: KEY_A, contentRev: 1 }],
      }),
      applyChunk: vi.fn(), deliverSelection, publish: vi.fn(),
    })
    const initialLoad = controller.updateContext({
      missionId: 'mission-1', rendererGeneration: 'r1',
    })
    await vi.waitFor(() => expect(deliverSelection).toHaveBeenCalledTimes(1))
    let current = controller.getState()
    if (current.status === 'inactive') throw new Error('Coverage unexpectedly inactive.')
    await controller.notifyCatalogApplied(current.tileCatalog!)
    await initialLoad

    const staleFailure = {
      missionId: 'mission-1',
      periodKey: 'outing\u0000outing-1',
      revisionDigest: 'shared-revision',
      activationId: 'delayed-failure-stage-1',
      message: 'Coverage tile delivery failed.',
    }
    controller.notifyRendererFailure(staleFailure)
    await vi.waitFor(() => expect(deliverSelection).toHaveBeenCalledTimes(2))
    expect(controller.getState()).toMatchObject({
      status: 'loading',
      tileCatalog: { activationId: 'delayed-failure-stage-2' },
    })

    controller.notifyRendererFailure(staleFailure)
    current = controller.getState()
    if (current.status === 'inactive') throw new Error('Coverage unexpectedly inactive.')
    await controller.notifyCatalogApplied(current.tileCatalog!)

    await vi.waitFor(() => expect(controller.getState()).toMatchObject({
      status: 'complete',
      tileCatalog: { activationId: 'delayed-failure-stage-2' },
    }))
    expect(deliverSelection).toHaveBeenCalledTimes(2)
  })

  it('revokes Complete when a retained period fails from its older source activation', async () => {
    let current = manifest(1, [[KEY_A, 1], [KEY_B, 1]])
    const readManifest = vi.fn(async () => current)
    const readClaim = vi.fn(async () => ({
      changeSeq: current.changeSeq,
      databaseReady: true,
      blockers: [],
      chunkRevisions: current.chunks.map(({ key, contentRev }) => ({ key, contentRev })),
    }))
    const deliverSelection = vi.fn(async () => {
      const attempt = deliverSelection.mock.calls.length
      return {
        missionId: 'mission-1',
        activationId: `retained-period-stage-${attempt}`,
        periods: attempt === 1
          ? [
              { periodKey: 'outing\u0000a', revisionDigest: 'a1' },
              { periodKey: 'outing\u0000b', revisionDigest: 'b1' },
            ]
          : [
              { periodKey: 'outing\u0000a', revisionDigest: 'a2' },
              { periodKey: 'outing\u0000b', revisionDigest: 'b1' },
            ],
        delivered: current.chunks.map(({ key, contentRev }) => ({ key, contentRev })),
      }
    })
    const controller = createCoverageController({
      readManifest,
      readChunk: vi.fn(),
      readClaim,
      applyChunk: vi.fn(),
      deliverSelection,
      publish: vi.fn(),
    })
    const firstLoad = controller.updateContext({
      missionId: 'mission-1', rendererGeneration: 'r1',
    })
    await vi.waitFor(() => expect(deliverSelection).toHaveBeenCalledTimes(1))
    let state = controller.getState()
    if (state.status === 'inactive') throw new Error('Coverage unexpectedly inactive.')
    await controller.notifyCatalogApplied(state.tileCatalog!, {
      failureSources: [
        {
          periodKey: 'outing\u0000a', revisionDigest: 'a1',
          activationId: 'retained-period-stage-1',
        },
        {
          periodKey: 'outing\u0000b', revisionDigest: 'b1',
          activationId: 'retained-period-stage-1',
        },
      ],
      commit: vi.fn(), finalize: vi.fn(), rollback: vi.fn(),
    })
    await firstLoad

    current = manifest(2, [[KEY_A, 2], [KEY_B, 1]])
    const refresh = controller.refresh()
    await vi.waitFor(() => expect(deliverSelection).toHaveBeenCalledTimes(2))
    state = controller.getState()
    if (state.status === 'inactive') throw new Error('Coverage unexpectedly inactive.')
    await controller.notifyCatalogApplied(state.tileCatalog!, {
      failureSources: [
        {
          periodKey: 'outing\u0000a', revisionDigest: 'a2',
          activationId: 'retained-period-stage-2',
        },
        {
          periodKey: 'outing\u0000b', revisionDigest: 'b1',
          activationId: 'retained-period-stage-1',
        },
      ],
      commit: vi.fn(), finalize: vi.fn(), rollback: vi.fn(),
    })
    await refresh
    expect(controller.getState()).toMatchObject({ status: 'complete' })

    controller.notifyRendererFailure({
      missionId: 'mission-1',
      periodKey: 'outing\u0000b',
      revisionDigest: 'b1',
      activationId: 'retained-period-stage-1',
      message: 'Retained coverage tile delivery failed.',
    })

    expect(controller.getState()).toMatchObject({ status: 'error' })
    await vi.waitFor(() => expect(deliverSelection).toHaveBeenCalledTimes(3))
    controller.notifyRendererFailure({
      missionId: 'mission-1',
      periodKey: 'outing\u0000b',
      revisionDigest: 'b1',
      activationId: 'retained-period-stage-1',
      message: 'Delayed retained coverage tile failure.',
    })
    state = controller.getState()
    if (state.status === 'inactive') throw new Error('Coverage unexpectedly inactive.')
    expect(state).toMatchObject({
      status: 'loading',
      tileCatalog: {
        activationId: 'retained-period-stage-3',
        requiresFreshRendererSources: true,
      },
    })
    await controller.notifyCatalogApplied(state.tileCatalog!, {
      failureSources: [
        {
          periodKey: 'outing\u0000a', revisionDigest: 'a2',
          activationId: 'retained-period-stage-3',
        },
        {
          periodKey: 'outing\u0000b', revisionDigest: 'b1',
          activationId: 'retained-period-stage-3',
        },
      ],
      commit: vi.fn(), finalize: vi.fn(), rollback: vi.fn(),
    })
    await vi.waitFor(() => expect(controller.getState()).toMatchObject({ status: 'complete' }))
  })

  it('ignores a stale renderer failure from another mission with the same revision', async () => {
    const controller = createCoverageController({
      readManifest: vi.fn().mockResolvedValue(manifest(1, [[KEY_A, 1]])),
      readChunk: vi.fn(),
      readClaim: vi.fn().mockResolvedValue({
        changeSeq: 1, databaseReady: true, blockers: [],
        chunkRevisions: [{ key: KEY_A, contentRev: 1 }],
      }),
      applyChunk: vi.fn(),
      deliverSelection: vi.fn().mockResolvedValue({
        missionId: 'mission-1',
        periods: [{ periodKey: 'outing\u0000outing-1', revisionDigest: 'rev-1' }],
        delivered: [{ key: KEY_A, contentRev: 1 }],
      }),
      publish: vi.fn(),
    })
    const load = controller.updateContext({ missionId: 'mission-1', rendererGeneration: 'r1' })
    await vi.waitFor(() => expect(controller.getState()).toMatchObject({
      status: 'loading', tileCatalog: { missionId: 'mission-1' },
    }))

    controller.notifyRendererFailure({
      missionId: 'mission-2',
      periodKey: 'outing\u0000outing-1',
      revisionDigest: 'rev-1',
      message: 'Stale mission tile failed.',
    })
    const catalog = controller.getState().status === 'inactive'
      ? null
      : controller.getState().tileCatalog
    expect(catalog).not.toBeNull()
    await controller.notifyCatalogApplied(catalog!)
    await load

    expect(controller.getState()).toMatchObject({ status: 'complete', missionId: 'mission-1' })
  })

  it('reattaches an already-active catalog after style loss without reactivating the backend', async () => {
    const activateCatalog = vi.fn().mockResolvedValue(undefined)
    const finalizeCatalog = vi.fn().mockResolvedValue(undefined)
    const discardCatalog = vi.fn().mockResolvedValue(undefined)
    const controller = createCoverageController({
      readManifest: vi.fn().mockResolvedValue(manifest(1, [[KEY_A, 1]])),
      readChunk: vi.fn(),
      readClaim: vi.fn().mockResolvedValue({
        changeSeq: 1, databaseReady: true, blockers: [],
        chunkRevisions: [{ key: KEY_A, contentRev: 1 }],
      }),
      applyChunk: vi.fn(),
      deliverSelection: vi.fn().mockResolvedValue({
        activationId: 'style-stage-1',
        periods: [{ periodKey: 'outing\u0000outing-1', revisionDigest: 'revision-1' }],
        delivered: [{ key: KEY_A, contentRev: 1 }],
      }),
      activateCatalog,
      finalizeCatalog,
      discardCatalog,
      publish: vi.fn(),
    })
    const firstRenderer = { commit: vi.fn(), rollback: vi.fn(), finalize: vi.fn() }
    const load = controller.updateContext({ missionId: 'mission-1', rendererGeneration: 'r1' })
    await vi.waitFor(() => expect(controller.getState()).toMatchObject({
      tileCatalog: { activationId: 'style-stage-1' },
    }))
    const catalog = controller.getState().status === 'inactive'
      ? null
      : controller.getState().tileCatalog
    if (catalog === null) throw new Error('Coverage catalog was not staged.')

    await controller.notifyCatalogApplied(catalog, firstRenderer)
    await load
    expect(controller.getState()).toMatchObject({ status: 'complete' })

    const replacementRenderer = { commit: vi.fn(), rollback: vi.fn(), finalize: vi.fn() }
    await controller.notifyCatalogApplied(catalog, replacementRenderer)

    expect(activateCatalog).toHaveBeenCalledOnce()
    expect(finalizeCatalog).toHaveBeenCalledOnce()
    expect(discardCatalog).not.toHaveBeenCalled()
    expect(replacementRenderer.commit).toHaveBeenCalledOnce()
    expect(replacementRenderer.finalize).toHaveBeenCalledOnce()
    expect(replacementRenderer.rollback).not.toHaveBeenCalled()
    expect(controller.getState()).toMatchObject({ status: 'complete' })
  })

  it('never treats a cancelled staged catalog as renderer-attachable', async () => {
    const discardCatalog = vi.fn().mockResolvedValue(undefined)
    const controller = createCoverageController({
      readManifest: vi.fn().mockResolvedValue(manifest(1, [[KEY_A, 1]])),
      readChunk: vi.fn(),
      readClaim: vi.fn().mockResolvedValue({
        changeSeq: 1, databaseReady: true, blockers: [],
        chunkRevisions: [{ key: KEY_A, contentRev: 1 }],
      }),
      applyChunk: vi.fn(),
      deliverSelection: vi.fn().mockResolvedValue({
        activationId: 'cancelled-stage-1',
        missionId: 'mission-1',
        periods: [{ periodKey: 'outing\u0000outing-1', revisionDigest: 'revision-1' }],
        delivered: [{ key: KEY_A, contentRev: 1 }],
      }),
      discardCatalog,
      publish: vi.fn(),
    })
    const load = controller.updateContext({ missionId: 'mission-1', rendererGeneration: 'r1' })
    await vi.waitFor(() => expect(controller.getState()).toMatchObject({
      tileCatalog: { activationId: 'cancelled-stage-1' },
    }))
    const staged = controller.getState().status === 'inactive'
      ? null
      : controller.getState().tileCatalog
    if (staged === null) throw new Error('Coverage catalog was not staged.')

    controller.cancel()
    await load

    expect(controller.getState()).toMatchObject({ status: 'partial', tileCatalog: null })
    const renderer = { commit: vi.fn(), rollback: vi.fn(), finalize: vi.fn() }
    await controller.notifyCatalogApplied(staged, renderer)
    expect(renderer.commit).not.toHaveBeenCalled()
    expect(renderer.rollback).toHaveBeenCalledOnce()
    expect(discardCatalog).toHaveBeenCalledWith(staged)
  })

  it('suspends Complete while a style has no attested coverage source', async () => {
    const controller = createCoverageController({
      readManifest: vi.fn().mockResolvedValue(manifest(1, [[KEY_A, 1]])),
      readChunk: vi.fn(),
      readClaim: vi.fn().mockResolvedValue({
        changeSeq: 1, databaseReady: true, blockers: [],
        chunkRevisions: [{ key: KEY_A, contentRev: 1 }],
      }),
      applyChunk: vi.fn(),
      deliverSelection: vi.fn().mockResolvedValue({
        activationId: 'style-stage-2',
        missionId: 'mission-1',
        periods: [{ periodKey: 'outing\u0000outing-1', revisionDigest: 'revision-1' }],
        delivered: [{ key: KEY_A, contentRev: 1 }],
      }),
      activateCatalog: vi.fn().mockResolvedValue(undefined),
      finalizeCatalog: vi.fn().mockResolvedValue(undefined),
      publish: vi.fn(),
    })
    const load = controller.updateContext({ missionId: 'mission-1', rendererGeneration: 'r1' })
    await vi.waitFor(() => expect(controller.getState()).toMatchObject({
      tileCatalog: { activationId: 'style-stage-2' },
    }))
    if (controller.getState().status === 'inactive') throw new Error('Coverage unexpectedly inactive.')
    const catalog = controller.getState().tileCatalog!
    await controller.notifyCatalogApplied(catalog)
    await load
    expect(controller.getState()).toMatchObject({ status: 'complete' })

    const detach = (controller as unknown as {
      readonly notifyRendererDetached: () => void
    }).notifyRendererDetached
    expect(detach).toBeTypeOf('function')
    detach.call(controller)

    expect(controller.getState()).toMatchObject({
      status: 'partial', blockers: expect.arrayContaining(['renderer_detached']),
    })
    await controller.notifyCatalogApplied(catalog)
    expect(controller.getState()).toMatchObject({ status: 'complete', blockers: [] })
  })

  it('keeps a detached renderer partial across an unchanged periodic refresh', async () => {
    const catalog: CoverageTileCatalog = {
      activationId: 'detached-refresh-stage',
      missionId: 'mission-1',
      periods: [{ periodKey: 'outing\\u0000outing-1', revisionDigest: 'revision-1' }],
      delivered: [{ key: KEY_A, contentRev: 1 }],
    }
    const deliverSelection = vi.fn().mockResolvedValue(catalog)
    const controller = createCoverageController({
      readManifest: vi.fn().mockResolvedValue(manifest(1, [[KEY_A, 1]])),
      readChunk: vi.fn(),
      readClaim: vi.fn().mockResolvedValue({
        changeSeq: 1, databaseReady: true, blockers: [],
        chunkRevisions: [{ key: KEY_A, contentRev: 1 }],
      }),
      applyChunk: vi.fn(),
      deliverSelection,
      activateCatalog: vi.fn().mockResolvedValue(undefined),
      finalizeCatalog: vi.fn().mockResolvedValue(undefined),
      publish: vi.fn(),
    })
    const initialLoad = controller.updateContext({
      missionId: 'mission-1', rendererGeneration: 'r1',
    })
    await vi.waitFor(() => expect(controller.getState()).toMatchObject({
      tileCatalog: { activationId: 'detached-refresh-stage' },
    }))
    await controller.notifyCatalogApplied(catalog)
    await initialLoad

    controller.notifyRendererDetached()
    await controller.refresh()

    expect(deliverSelection).toHaveBeenCalledOnce()
    expect(controller.getState()).toMatchObject({
      status: 'partial',
      blockers: expect.arrayContaining(['renderer_detached']),
    })
  })

  it('latches renderer detachment that arrives after an unchanged refresh starts', async () => {
    let releaseRefreshManifest: (() => void) | undefined
    let manifestReadCount = 0
    const currentManifest = manifest(1, [[KEY_A, 1]])
    const catalog: CoverageTileCatalog = {
      activationId: 'detach-during-refresh-stage',
      missionId: 'mission-1',
      periods: [{ periodKey: 'outing\\u0000outing-1', revisionDigest: 'revision-1' }],
      delivered: [{ key: KEY_A, contentRev: 1 }],
    }
    const controller = createCoverageController({
      readManifest: vi.fn(async () => {
        manifestReadCount += 1
        if (manifestReadCount === 3) {
          await new Promise<void>((resolve) => { releaseRefreshManifest = resolve })
        }
        return currentManifest
      }),
      readChunk: vi.fn(),
      readClaim: vi.fn().mockResolvedValue({
        changeSeq: 1, databaseReady: true, blockers: [],
        chunkRevisions: [{ key: KEY_A, contentRev: 1 }],
      }),
      applyChunk: vi.fn(),
      deliverSelection: vi.fn().mockResolvedValue(catalog),
      activateCatalog: vi.fn().mockResolvedValue(undefined),
      finalizeCatalog: vi.fn().mockResolvedValue(undefined),
      publish: vi.fn(),
    })
    const initialLoad = controller.updateContext({
      missionId: 'mission-1', rendererGeneration: 'r1',
    })
    await vi.waitFor(() => expect(controller.getState()).toMatchObject({
      tileCatalog: { activationId: 'detach-during-refresh-stage' },
    }))
    await controller.notifyCatalogApplied(catalog)
    await initialLoad

    const refresh = controller.refresh()
    await vi.waitFor(() => expect(manifestReadCount).toBe(3))
    expect(controller.getState()).toMatchObject({ status: 'loading' })
    controller.notifyRendererDetached(catalog)

    expect(controller.getState()).toMatchObject({
      status: 'loading', blockers: expect.arrayContaining(['renderer_detached']),
    })
    releaseRefreshManifest?.()
    await refresh
    expect(controller.getState()).toMatchObject({
      status: 'partial', blockers: expect.arrayContaining(['renderer_detached']),
    })
  })

  it('does not mistake a staged replacement for detachment of the finalized catalog', async () => {
    const catalog: CoverageTileCatalog = {
      activationId: 'finalized-stage',
      missionId: 'mission-1',
      periods: [{ periodKey: 'outing\\u0000outing-1', revisionDigest: 'revision-1' }],
      delivered: [{ key: KEY_A, contentRev: 1 }],
    }
    const publish = vi.fn()
    const controller = createCoverageController({
      readManifest: vi.fn().mockResolvedValue(manifest(1, [[KEY_A, 1]])),
      readChunk: vi.fn(),
      readClaim: vi.fn().mockResolvedValue({
        changeSeq: 1, databaseReady: true, blockers: [],
        chunkRevisions: [{ key: KEY_A, contentRev: 1 }],
      }),
      applyChunk: vi.fn(),
      deliverSelection: vi.fn().mockResolvedValue(catalog),
      activateCatalog: vi.fn().mockResolvedValue(undefined),
      finalizeCatalog: vi.fn().mockResolvedValue(undefined),
      publish,
    })
    const load = controller.updateContext({ missionId: 'mission-1', rendererGeneration: 'r1' })
    await vi.waitFor(() => expect(controller.getState()).toMatchObject({
      tileCatalog: { activationId: 'finalized-stage' },
    }))
    await controller.notifyCatalogApplied(catalog)
    await load
    publish.mockClear()

    controller.notifyRendererDetached({
      ...catalog,
      activationId: 'pending-replacement-stage',
      periods: [{ periodKey: 'outing\\u0000outing-1', revisionDigest: 'revision-2' }],
    })

    expect(controller.getState()).toMatchObject({ status: 'complete', blockers: [] })
    expect(publish).not.toHaveBeenCalled()
  })

  it('never restores Complete while a newer change sequence is queued', async () => {
    let releaseRefreshManifest: (() => void) | undefined
    let manifestReadCount = 0
    const catalog: CoverageTileCatalog = {
      activationId: 'stale-reattach-stage',
      missionId: 'mission-1',
      periods: [{ periodKey: 'outing\\u0000outing-1', revisionDigest: 'revision-1' }],
      delivered: [{ key: KEY_A, contentRev: 1 }],
    }
    const controller = createCoverageController({
      readManifest: vi.fn(async () => {
        manifestReadCount += 1
        if (manifestReadCount === 3) {
          await new Promise<void>((resolve) => { releaseRefreshManifest = resolve })
        }
        return manifest(1, [[KEY_A, 1]])
      }),
      readChunk: vi.fn(),
      readClaim: vi.fn().mockResolvedValue({
        changeSeq: 1, databaseReady: true, blockers: [],
        chunkRevisions: [{ key: KEY_A, contentRev: 1 }],
      }),
      applyChunk: vi.fn(),
      deliverSelection: vi.fn().mockResolvedValue(catalog),
      activateCatalog: vi.fn().mockResolvedValue(undefined),
      finalizeCatalog: vi.fn().mockResolvedValue(undefined),
      publish: vi.fn(),
    })
    const initialLoad = controller.updateContext({ missionId: 'mission-1', rendererGeneration: 'r1' })
    await vi.waitFor(() => expect(controller.getState()).toMatchObject({
      tileCatalog: { activationId: 'stale-reattach-stage' },
    }))
    await controller.notifyCatalogApplied(catalog)
    await initialLoad
    controller.notifyRendererDetached(catalog)
    const refresh = controller.refresh()
    await vi.waitFor(() => expect(manifestReadCount).toBe(3))
    await controller.notifyChanged('mission-1', 2)

    await controller.notifyCatalogApplied(catalog)

    expect(controller.getState()).toMatchObject({
      status: 'partial', changeSeq: 1, latestObservedChangeSeq: 2,
    })
    releaseRefreshManifest?.()
    await refresh
  })

  it('keeps renderer detachment latched when style loss follows renderer commit', async () => {
    let releaseReplacementFinalization: (() => void) | undefined
    let manifestReadCount = 0
    const catalog1: CoverageTileCatalog = {
      activationId: 'style-loss-stage-1',
      missionId: 'mission-1',
      periods: [{ periodKey: 'outing\\u0000outing-1', revisionDigest: 'revision-1' }],
      delivered: [{ key: KEY_A, contentRev: 1 }],
    }
    const catalog2: CoverageTileCatalog = {
      ...catalog1,
      activationId: 'style-loss-stage-2',
      periods: [{ periodKey: 'outing\\u0000outing-1', revisionDigest: 'revision-2' }],
      delivered: [{ key: KEY_A, contentRev: 2 }],
    }
    const renderer = { commit: vi.fn(), rollback: vi.fn(), finalize: vi.fn() }
    const controller = createCoverageController({
      readManifest: vi.fn(async () => {
        manifestReadCount += 1
        return manifest(manifestReadCount <= 2 ? 1 : 2, [[KEY_A, manifestReadCount <= 2 ? 1 : 2]])
      }),
      readChunk: vi.fn(),
      readClaim: vi.fn(async () => ({
        changeSeq: manifestReadCount <= 2 ? 1 : 2,
        databaseReady: true,
        blockers: [],
        chunkRevisions: [{ key: KEY_A, contentRev: manifestReadCount <= 2 ? 1 : 2 }],
      })),
      applyChunk: vi.fn(),
      deliverSelection: vi.fn()
        .mockResolvedValueOnce(catalog1)
        .mockResolvedValueOnce(catalog2),
      activateCatalog: vi.fn().mockResolvedValue(undefined),
      finalizeCatalog: vi.fn(async (catalog) => {
        if (catalog.activationId === catalog2.activationId) {
          await new Promise<void>((resolve) => { releaseReplacementFinalization = resolve })
        }
      }),
      publish: vi.fn(),
    })
    const initialLoad = controller.updateContext({ missionId: 'mission-1', rendererGeneration: 'r1' })
    await vi.waitFor(() => expect(controller.getState()).toMatchObject({
      tileCatalog: { activationId: 'style-loss-stage-1' },
    }))
    await controller.notifyCatalogApplied(catalog1)
    await initialLoad
    controller.notifyRendererDetached(catalog1)
    const replacementLoad = controller.refresh()
    await vi.waitFor(() => expect(controller.getState()).toMatchObject({
      tileCatalog: { activationId: 'style-loss-stage-2' },
    }))
    const applyReplacement = controller.notifyCatalogApplied(catalog2, renderer)
    await vi.waitFor(() => expect(renderer.commit).toHaveBeenCalledOnce())

    controller.notifyRendererDetached()
    releaseReplacementFinalization?.()
    await applyReplacement
    await replacementLoad

    expect(controller.getState()).toMatchObject({
      status: 'partial', blockers: expect.arrayContaining(['renderer_detached']),
    })
  })

  it('rejects activation when style loss occurs before renderer commit', async () => {
    let releaseReplacementActivation: (() => void) | undefined
    let manifestReadCount = 0
    const catalog1: CoverageTileCatalog = {
      activationId: 'pre-commit-style-stage-1',
      missionId: 'mission-1',
      periods: [{ periodKey: 'outing\\u0000outing-1', revisionDigest: 'revision-1' }],
      delivered: [{ key: KEY_A, contentRev: 1 }],
    }
    const catalog2: CoverageTileCatalog = {
      ...catalog1,
      activationId: 'pre-commit-style-stage-2',
      periods: [{ periodKey: 'outing\\u0000outing-1', revisionDigest: 'revision-2' }],
      delivered: [{ key: KEY_A, contentRev: 2 }],
    }
    const renderer = { commit: vi.fn(), rollback: vi.fn(), finalize: vi.fn() }
    const controller = createCoverageController({
      readManifest: vi.fn(async () => {
        manifestReadCount += 1
        const revision = manifestReadCount <= 2 ? 1 : 2
        return manifest(revision, [[KEY_A, revision]])
      }),
      readChunk: vi.fn(),
      readClaim: vi.fn(async () => {
        const revision = manifestReadCount <= 2 ? 1 : 2
        return {
          changeSeq: revision, databaseReady: true, blockers: [],
          chunkRevisions: [{ key: KEY_A, contentRev: revision }],
        }
      }),
      applyChunk: vi.fn(),
      deliverSelection: vi.fn()
        .mockResolvedValueOnce(catalog1)
        .mockResolvedValueOnce(catalog2),
      activateCatalog: vi.fn(async (catalog) => {
        if (catalog.activationId === catalog2.activationId) {
          await new Promise<void>((resolve) => { releaseReplacementActivation = resolve })
        }
      }),
      finalizeCatalog: vi.fn().mockResolvedValue(undefined),
      discardCatalog: vi.fn().mockResolvedValue(undefined),
      publish: vi.fn(),
    })
    const initialLoad = controller.updateContext({ missionId: 'mission-1', rendererGeneration: 'r1' })
    await vi.waitFor(() => expect(controller.getState()).toMatchObject({
      tileCatalog: { activationId: 'pre-commit-style-stage-1' },
    }))
    await controller.notifyCatalogApplied(catalog1)
    await initialLoad
    controller.notifyRendererDetached(catalog1)
    const replacementLoad = controller.refresh()
    await vi.waitFor(() => expect(controller.getState()).toMatchObject({
      tileCatalog: { activationId: 'pre-commit-style-stage-2' },
    }))
    const applyReplacement = controller.notifyCatalogApplied(catalog2, renderer)
    await vi.waitFor(() => expect(releaseReplacementActivation).toBeTypeOf('function'))

    controller.notifyRendererDetached()
    releaseReplacementActivation?.()
    await expect(applyReplacement).rejects.toThrow(/detached while its catalog was activating/u)
    await replacementLoad

    expect(renderer.commit).not.toHaveBeenCalled()
    expect(renderer.rollback).toHaveBeenCalledOnce()
    expect(controller.getState()).not.toMatchObject({ status: 'complete' })
  })

  it('rejects initial activation when total style loss occurs before its first commit', async () => {
    let releaseActivation: (() => void) | undefined
    const catalog: CoverageTileCatalog = {
      activationId: 'initial-style-loss-stage',
      missionId: 'mission-1',
      periods: [{ periodKey: 'outing\\u0000outing-1', revisionDigest: 'revision-1' }],
      delivered: [{ key: KEY_A, contentRev: 1 }],
    }
    const renderer = { commit: vi.fn(), rollback: vi.fn(), finalize: vi.fn() }
    const controller = createCoverageController({
      readManifest: vi.fn().mockResolvedValue(manifest(1, [[KEY_A, 1]])),
      readChunk: vi.fn(),
      readClaim: vi.fn().mockResolvedValue({
        changeSeq: 1, databaseReady: true, blockers: [],
        chunkRevisions: [{ key: KEY_A, contentRev: 1 }],
      }),
      applyChunk: vi.fn(),
      deliverSelection: vi.fn().mockResolvedValue(catalog),
      activateCatalog: vi.fn(async () => {
        await new Promise<void>((resolve) => { releaseActivation = resolve })
      }),
      finalizeCatalog: vi.fn().mockResolvedValue(undefined),
      discardCatalog: vi.fn().mockResolvedValue(undefined),
      publish: vi.fn(),
    })
    const load = controller.updateContext({ missionId: 'mission-1', rendererGeneration: 'r1' })
    await vi.waitFor(() => expect(controller.getState()).toMatchObject({
      tileCatalog: { activationId: 'initial-style-loss-stage' },
    }))
    const apply = controller.notifyCatalogApplied(catalog, renderer)
    await vi.waitFor(() => expect(releaseActivation).toBeTypeOf('function'))

    controller.notifyRendererDetached()
    releaseActivation?.()
    await expect(apply).rejects.toThrow(/detached while its catalog was activating/u)
    await load

    expect(renderer.commit).not.toHaveBeenCalled()
    expect(renderer.rollback).toHaveBeenCalledOnce()
    expect(controller.getState()).not.toMatchObject({ status: 'complete' })
  })

  it('ignores total style loss when an empty mission has no coverage catalog', async () => {
    const harness = createHarness(manifest(1, []))

    await harness.controller.updateContext({ missionId: 'mission-1', rendererGeneration: 'r1' })
    expect(harness.controller.getState()).toMatchObject({
      status: 'complete', tileCatalog: null, deliveredFixCount: 0, totalFixCount: 0,
    })

    harness.controller.notifyRendererDetached()

    expect(harness.controller.getState()).toMatchObject({
      status: 'complete', tileCatalog: null, deliveredFixCount: 0, totalFixCount: 0,
    })
    expect(harness.controller.getState()).not.toMatchObject({
      blockers: expect.arrayContaining(['renderer_detached']),
    })
  })

  it('never promotes a previously partial cancelled state during renderer reattachment', async () => {
    const catalog: CoverageTileCatalog = {
      activationId: 'cancelled-reattach-stage',
      missionId: 'mission-1',
      periods: [{ periodKey: 'outing\\u0000outing-1', revisionDigest: 'revision-1' }],
      delivered: [{ key: KEY_A, contentRev: 1 }],
    }
    const controller = createCoverageController({
      readManifest: vi.fn().mockResolvedValue(manifest(1, [[KEY_A, 1]])),
      readChunk: vi.fn(),
      readClaim: vi.fn().mockResolvedValue({
        changeSeq: 1, databaseReady: true, blockers: [],
        chunkRevisions: [{ key: KEY_A, contentRev: 1 }],
      }),
      applyChunk: vi.fn(),
      deliverSelection: vi.fn().mockResolvedValue(catalog),
      activateCatalog: vi.fn().mockResolvedValue(undefined),
      finalizeCatalog: vi.fn().mockResolvedValue(undefined),
      publish: vi.fn(),
    })
    const load = controller.updateContext({ missionId: 'mission-1', rendererGeneration: 'r1' })
    await vi.waitFor(() => expect(controller.getState()).toMatchObject({
      tileCatalog: { activationId: 'cancelled-reattach-stage' },
    }))
    await controller.notifyCatalogApplied(catalog)
    await load
    controller.cancel()
    controller.notifyRendererDetached(catalog)

    await controller.notifyCatalogApplied(catalog)

    expect(controller.getState()).toMatchObject({ status: 'partial', blockers: [] })
  })

  it('never republishes a cancelled staged catalog during a filter change', async () => {
    let releaseReplacement: (() => void) | undefined
    const discardCatalog = vi.fn().mockResolvedValue(undefined)
    const deliverSelection = vi.fn()
      .mockResolvedValueOnce({
        activationId: 'cancelled-filter-stage',
        missionId: 'mission-1',
        periods: [{ periodKey: 'outing\\u0000outing-1', revisionDigest: 'revision-all' }],
        delivered: [{ key: KEY_A, contentRev: 1 }, { key: KEY_B, contentRev: 1 }],
      })
      .mockImplementationOnce(async () => {
        await new Promise<void>((resolve) => { releaseReplacement = resolve })
        return {
          activationId: 'replacement-filter-stage',
          missionId: 'mission-1',
          periods: [{ periodKey: 'outing\\u0000outing-1', revisionDigest: 'revision-a' }],
          delivered: [{ key: KEY_A, contentRev: 1 }],
        }
      })
    const controller = createCoverageController({
      readManifest: vi.fn().mockResolvedValue(manifest(1, [[KEY_A, 1], [KEY_B, 1]])),
      readChunk: vi.fn(),
      readClaim: vi.fn().mockResolvedValue({
        changeSeq: 1, databaseReady: true, blockers: [],
        chunkRevisions: [{ key: KEY_A, contentRev: 1 }],
      }),
      applyChunk: vi.fn(), deliverSelection, discardCatalog, publish: vi.fn(),
    })
    const initialLoad = controller.updateContext({
      missionId: 'mission-1', rendererGeneration: 'r1',
    })
    await vi.waitFor(() => expect(controller.getState()).toMatchObject({
      tileCatalog: { activationId: 'cancelled-filter-stage' },
    }))

    const replacementLoad = controller.updateContext({
      missionId: 'mission-1', rendererGeneration: 'r1', selectedKeys: [KEY_A],
    })
    await vi.waitFor(() => expect(deliverSelection).toHaveBeenCalledTimes(2))

    expect(controller.getState()).toMatchObject({ status: 'loading', tileCatalog: null })
    expect(discardCatalog).toHaveBeenCalledWith(expect.objectContaining({
      activationId: 'cancelled-filter-stage',
    }))

    releaseReplacement?.()
    await vi.waitFor(() => expect(controller.getState()).toMatchObject({
      tileCatalog: { activationId: 'replacement-filter-stage' },
    }))
    if (controller.getState().status === 'inactive') throw new Error('Coverage unexpectedly inactive.')
    await controller.notifyCatalogApplied(controller.getState().tileCatalog!)
    await replacementLoad
    await initialLoad
  })

  it('does not let style reattachment erase a worker failure', async () => {
    const controller = createCoverageController({
      readManifest: vi.fn().mockResolvedValue(manifest(1, [[KEY_A, 1]])),
      readChunk: vi.fn(),
      readClaim: vi.fn().mockResolvedValue({
        changeSeq: 1, databaseReady: true, blockers: [],
        chunkRevisions: [{ key: KEY_A, contentRev: 1 }],
      }),
      applyChunk: vi.fn(),
      deliverSelection: vi.fn().mockResolvedValue({
        activationId: 'reattach-after-failure',
        missionId: 'mission-1',
        periods: [{ periodKey: 'outing\u0000outing-1', revisionDigest: 'revision-1' }],
        delivered: [{ key: KEY_A, contentRev: 1 }],
      }),
      activateCatalog: vi.fn().mockResolvedValue(undefined),
      finalizeCatalog: vi.fn().mockResolvedValue(undefined),
      publish: vi.fn(),
    })
    const load = controller.updateContext({ missionId: 'mission-1', rendererGeneration: 'r1' })
    await vi.waitFor(() => expect(controller.getState()).toMatchObject({
      tileCatalog: { activationId: 'reattach-after-failure' },
    }))
    if (controller.getState().status === 'inactive') {
      throw new Error('Coverage unexpectedly inactive.')
    }
    const catalog = controller.getState().tileCatalog!
    await controller.notifyCatalogApplied(catalog)
    await load

    controller.notifyRendererDetached()
    controller.notifyRendererUnavailable('Coverage tile worker exited.')
    await controller.notifyCatalogApplied(catalog)

    expect(controller.getState()).toMatchObject({
      status: 'error', deliveredFixCount: 0, blockers: expect.not.arrayContaining(['renderer_detached']),
    })
  })

  it('cannot retain an obsolete catalog when mission switch occurs during finalization', async () => {
    let finishOldFinalization: (() => void) | undefined
    const oldFinalization = new Promise<void>((resolve) => { finishOldFinalization = resolve })
    const finalizeCatalog = vi.fn((catalog: CoverageTileCatalog) =>
      catalog.missionId === 'mission-1' ? oldFinalization : Promise.resolve())
    const controller = createCoverageController({
      readManifest: vi.fn(async (missionId) => manifest(
        1,
        [[missionId === 'mission-1' ? KEY_A : KEY_C, 1]],
      )),
      readChunk: vi.fn(),
      readClaim: vi.fn(async ({ selectedKeys }) => ({
        changeSeq: 1,
        databaseReady: true,
        blockers: [],
        chunkRevisions: selectedKeys.map((key) => ({ key, contentRev: 1 })),
      })),
      applyChunk: vi.fn(),
      deliverSelection: vi.fn(async ({ missionId, chunks }) => ({
        activationId: `stage-${missionId}`,
        missionId,
        periods: [{
          periodKey: `${chunks[0]!.key.period_kind}\u0000${chunks[0]!.key.period_id}`,
          revisionDigest: `revision-${missionId}`,
        }],
        delivered: chunks.map(({ key, contentRev }) => ({ key, contentRev })),
      })),
      activateCatalog: vi.fn().mockResolvedValue(undefined),
      finalizeCatalog,
      discardCatalog: vi.fn().mockResolvedValue(undefined),
      publish: vi.fn(),
    })
    const oldLoad = controller.updateContext({ missionId: 'mission-1', rendererGeneration: 'r1' })
    await vi.waitFor(() => expect(controller.getState()).toMatchObject({
      tileCatalog: { activationId: 'stage-mission-1' },
    }))
    if (controller.getState().status === 'inactive') throw new Error('Coverage unexpectedly inactive.')
    const oldCatalog = controller.getState().tileCatalog!
    const oldNotification = controller.notifyCatalogApplied(oldCatalog)
    await vi.waitFor(() => expect(finalizeCatalog).toHaveBeenCalledWith(oldCatalog))

    const nextLoad = controller.updateContext({ missionId: 'mission-2', rendererGeneration: 'r1' })
    expect(controller.getState()).toMatchObject({
      missionId: 'mission-1', tileCatalog: { activationId: 'stage-mission-1' },
    })
    finishOldFinalization?.()
    await oldNotification
    await oldLoad
    await vi.waitFor(() => expect(controller.getState()).toMatchObject({
      missionId: 'mission-2', tileCatalog: { activationId: 'stage-mission-2' },
    }))
    if (controller.getState().status === 'inactive') throw new Error('Coverage unexpectedly inactive.')
    const nextCatalog = controller.getState().tileCatalog!
    await controller.notifyCatalogApplied(nextCatalog)
    await nextLoad

    controller.cancel()
    expect(controller.getState()).toMatchObject({
      missionId: 'mission-2', tileCatalog: { missionId: 'mission-2' },
    })
  })

  it('serializes a selection change behind irreversible catalog finalization', async () => {
    let finishFirstFinalization: (() => void) | undefined
    const finalizeCatalog = vi.fn()
      .mockImplementationOnce(async () => {
        await new Promise<void>((resolve) => { finishFirstFinalization = resolve })
      })
      .mockResolvedValue(undefined)
    const deliverSelection = vi.fn(async ({ chunks }: {
      readonly chunks: readonly { readonly key: CoverageChunkKey; readonly contentRev: number }[]
    }) => ({
      activationId: `selection-stage-${deliverSelection.mock.calls.length}`,
      missionId: 'mission-1',
      periods: [{
        periodKey: `${chunks[0]!.key.period_kind}\u0000${chunks[0]!.key.period_id}`,
        revisionDigest: `selection-revision-${deliverSelection.mock.calls.length}`,
      }],
      delivered: chunks.map(({ key, contentRev }) => ({ key, contentRev })),
    }))
    const controller = createCoverageController({
      readManifest: vi.fn().mockResolvedValue(manifest(1, [[KEY_A, 1], [KEY_B, 1]])),
      readChunk: vi.fn(),
      readClaim: vi.fn(async ({ selectedKeys }) => ({
        changeSeq: 1, databaseReady: true, blockers: [],
        chunkRevisions: selectedKeys.map((key) => ({ key, contentRev: 1 })),
      })),
      applyChunk: vi.fn(), deliverSelection,
      activateCatalog: vi.fn().mockResolvedValue(undefined),
      finalizeCatalog,
      discardCatalog: vi.fn().mockResolvedValue(undefined),
      publish: vi.fn(),
    })
    const firstRenderer = { commit: vi.fn(), rollback: vi.fn(), finalize: vi.fn() }
    const initialLoad = controller.updateContext({
      missionId: 'mission-1', rendererGeneration: 'r1', selectedKeys: [KEY_A],
    })
    await vi.waitFor(() => expect(controller.getState()).toMatchObject({
      tileCatalog: { activationId: 'selection-stage-1' },
    }))
    if (controller.getState().status === 'inactive') throw new Error('Coverage unexpectedly inactive.')
    const firstCatalog = controller.getState().tileCatalog!
    const firstNotification = controller.notifyCatalogApplied(firstCatalog, firstRenderer)
    await vi.waitFor(() => expect(finishFirstFinalization).toBeTypeOf('function'))

    const selectionChange = controller.updateContext({
      missionId: 'mission-1', rendererGeneration: 'r1', selectedKeys: [KEY_B],
    })
    await Promise.resolve()

    expect(deliverSelection).toHaveBeenCalledOnce()
    finishFirstFinalization?.()
    await firstNotification
    await initialLoad
    await selectionChange
    await controller.notifySelectionApplied([KEY_B])

    expect(deliverSelection).toHaveBeenCalledOnce()
    expect(firstRenderer.commit).toHaveBeenCalledOnce()
    expect(firstRenderer.finalize).toHaveBeenCalledOnce()
    expect(firstRenderer.rollback).not.toHaveBeenCalled()
    expect(controller.getState()).toMatchObject({ status: 'complete', deliveredFixCount: 1 })
  })

  it('keeps cancel authoritative and renderer-consistent during catalog finalization', async () => {
    let finishFinalization: (() => void) | undefined
    const readClaim = vi.fn(async ({ selectedKeys }) => ({
      changeSeq: 1, databaseReady: true, blockers: [],
      chunkRevisions: selectedKeys.map((key: CoverageChunkKey) => ({ key, contentRev: 1 })),
    }))
    const deliverSelection = vi.fn(async ({ chunks }: {
      readonly chunks: readonly { readonly key: CoverageChunkKey; readonly contentRev: number }[]
    }) => ({
      activationId: 'cancel-during-finalization-stage',
      missionId: 'mission-1',
      periods: [{ periodKey: 'outing\u0000outing-1', revisionDigest: 'cancel-finalize-revision' }],
      delivered: chunks.map(({ key, contentRev }) => ({ key, contentRev })),
    }))
    const controller = createCoverageController({
      readManifest: vi.fn().mockResolvedValue(manifest(1, [[KEY_A, 1], [KEY_B, 1]])),
      readChunk: vi.fn(),
      readClaim,
      applyChunk: vi.fn(), deliverSelection,
      activateCatalog: vi.fn().mockResolvedValue(undefined),
      finalizeCatalog: vi.fn(async () => {
        await new Promise<void>((resolve) => { finishFinalization = resolve })
      }),
      discardCatalog: vi.fn().mockResolvedValue(undefined),
      publish: vi.fn(),
    })
    const renderer = { commit: vi.fn(), rollback: vi.fn(), finalize: vi.fn() }
    const load = controller.updateContext({
      missionId: 'mission-1', rendererGeneration: 'r1', selectedKeys: [KEY_A],
    })
    await vi.waitFor(() => expect(controller.getState()).toMatchObject({
      tileCatalog: { activationId: 'cancel-during-finalization-stage' },
    }))
    if (controller.getState().status === 'inactive') throw new Error('Coverage unexpectedly inactive.')
    const notification = controller.notifyCatalogApplied(controller.getState().tileCatalog!, renderer)
    await vi.waitFor(() => expect(finishFinalization).toBeTypeOf('function'))
    const queuedSelection = controller.updateContext({
      missionId: 'mission-1', rendererGeneration: 'r1', selectedKeys: [KEY_B],
    })

    controller.cancel()
    finishFinalization?.()
    await notification
    await load

    expect(renderer.finalize).toHaveBeenCalledOnce()
    expect(renderer.rollback).not.toHaveBeenCalled()
    expect(controller.getState()).toMatchObject({ status: 'partial', deliveredFixCount: 1 })
    expect(deliverSelection).toHaveBeenCalledOnce()
    await queuedSelection

    await controller.notifySelectionApplied([KEY_B])
    await controller.resume()
    expect(readClaim.mock.calls.at(-1)?.[0]).toMatchObject({ selectedKeys: [KEY_B] })
    expect(controller.getState()).toMatchObject({ status: 'complete', totalFixCount: 1 })
  })

  it('coalesces repeated renderer acknowledgements while one catalog is finalizing', async () => {
    let finishFinalization: (() => void) | undefined
    const finalizationGate = new Promise<void>((resolve) => { finishFinalization = resolve })
    const activateCatalog = vi.fn().mockResolvedValue(undefined)
    const finalizeCatalog = vi.fn(async () => finalizationGate)
    const discardCatalog = vi.fn().mockResolvedValue(undefined)
    const controller = createCoverageController({
      readManifest: vi.fn().mockResolvedValue(manifest(1, [[KEY_A, 1]])),
      readChunk: vi.fn(),
      readClaim: vi.fn().mockResolvedValue({
        changeSeq: 1, databaseReady: true, blockers: [],
        chunkRevisions: [{ key: KEY_A, contentRev: 1 }],
      }),
      applyChunk: vi.fn(),
      deliverSelection: vi.fn().mockResolvedValue({
        activationId: 'single-flight-stage',
        missionId: 'mission-1',
        periods: [{ periodKey: 'outing\u0000outing-1', revisionDigest: 'single-flight-revision' }],
        delivered: [{ key: KEY_A, contentRev: 1 }],
      }),
      activateCatalog,
      finalizeCatalog,
      discardCatalog,
      publish: vi.fn(),
    })
    const firstRenderer = { commit: vi.fn(), rollback: vi.fn(), finalize: vi.fn() }
    const replacementRenderer = { commit: vi.fn(), rollback: vi.fn(), finalize: vi.fn() }
    const load = controller.updateContext({ missionId: 'mission-1', rendererGeneration: 'r1' })
    await vi.waitFor(() => expect(controller.getState()).toMatchObject({
      tileCatalog: { activationId: 'single-flight-stage' },
    }))
    if (controller.getState().status === 'inactive') throw new Error('Coverage unexpectedly inactive.')
    const catalog = controller.getState().tileCatalog!

    const firstNotification = controller.notifyCatalogApplied(catalog, firstRenderer)
    await vi.waitFor(() => expect(finalizeCatalog).toHaveBeenCalledOnce())
    const replacementNotification = controller.notifyCatalogApplied(catalog, replacementRenderer)
    await Promise.resolve()

    expect(activateCatalog).toHaveBeenCalledOnce()
    expect(finalizeCatalog).toHaveBeenCalledOnce()
    finishFinalization?.()
    await Promise.all([firstNotification, replacementNotification, load])

    expect(firstRenderer.rollback).not.toHaveBeenCalled()
    expect(replacementRenderer.commit).toHaveBeenCalledOnce()
    expect(replacementRenderer.finalize).toHaveBeenCalledOnce()
    expect(replacementRenderer.rollback).not.toHaveBeenCalled()
    expect(discardCatalog).not.toHaveBeenCalled()
    expect(controller.getState()).toMatchObject({ status: 'complete' })
  })

  it('serializes Retry behind irreversible catalog finalization', async () => {
    let finishFinalization: (() => void) | undefined
    const readManifest = vi.fn().mockResolvedValue(manifest(1, [[KEY_A, 1]]))
    const controller = createCoverageController({
      readManifest,
      readChunk: vi.fn(),
      readClaim: vi.fn().mockResolvedValue({
        changeSeq: 1, databaseReady: true, blockers: [],
        chunkRevisions: [{ key: KEY_A, contentRev: 1 }],
      }),
      applyChunk: vi.fn(),
      deliverSelection: vi.fn().mockResolvedValue({
        activationId: 'retry-after-finalization-stage',
        missionId: 'mission-1',
        periods: [{ periodKey: 'outing\u0000outing-1', revisionDigest: 'retry-revision' }],
        delivered: [{ key: KEY_A, contentRev: 1 }],
      }),
      activateCatalog: vi.fn().mockResolvedValue(undefined),
      finalizeCatalog: vi.fn(async () => {
        await new Promise<void>((resolve) => { finishFinalization = resolve })
      }),
      discardCatalog: vi.fn().mockResolvedValue(undefined),
      publish: vi.fn(),
    })
    const renderer = { commit: vi.fn(), rollback: vi.fn(), finalize: vi.fn() }
    const load = controller.updateContext({ missionId: 'mission-1', rendererGeneration: 'r1' })
    await vi.waitFor(() => expect(controller.getState()).toMatchObject({
      tileCatalog: { activationId: 'retry-after-finalization-stage' },
    }))
    if (controller.getState().status === 'inactive') throw new Error('Coverage unexpectedly inactive.')
    const notification = controller.notifyCatalogApplied(controller.getState().tileCatalog!, renderer)
    await vi.waitFor(() => expect(finishFinalization).toBeTypeOf('function'))

    const retry = controller.resume()
    await Promise.resolve()

    expect(readManifest).toHaveBeenCalledOnce()
    finishFinalization?.()
    await Promise.all([notification, load, retry])
    expect(renderer.finalize).toHaveBeenCalledOnce()
    expect(renderer.rollback).not.toHaveBeenCalled()
    expect(readManifest).toHaveBeenCalledTimes(4)
  })

  it('does not let Retry discard a queued history selection update', async () => {
    let finishFinalization: (() => void) | undefined
    const readClaim = vi.fn(async ({ selectedKeys }) => ({
      changeSeq: 1, databaseReady: true, blockers: [],
      chunkRevisions: selectedKeys.map((key: CoverageChunkKey) => ({ key, contentRev: 1 })),
    }))
    const deliverSelection = vi.fn(async ({ chunks }: {
      readonly chunks: readonly { readonly key: CoverageChunkKey; readonly contentRev: number }[]
    }) => ({
      activationId: `selection-retry-stage-${deliverSelection.mock.calls.length}`,
      missionId: 'mission-1',
      periods: [{
        periodKey: `${chunks[0]!.key.period_kind}\u0000${chunks[0]!.key.period_id}`,
        revisionDigest: `selection-retry-revision-${deliverSelection.mock.calls.length}`,
      }],
      delivered: chunks.map(({ key, contentRev }) => ({ key, contentRev })),
    }))
    const controller = createCoverageController({
      readManifest: vi.fn().mockResolvedValue(manifest(1, [[KEY_A, 1], [KEY_B, 1]])),
      readChunk: vi.fn(),
      readClaim,
      applyChunk: vi.fn(), deliverSelection,
      activateCatalog: vi.fn().mockResolvedValue(undefined),
      finalizeCatalog: vi.fn()
        .mockImplementationOnce(async () => {
          await new Promise<void>((resolve) => { finishFinalization = resolve })
        })
        .mockResolvedValue(undefined),
      discardCatalog: vi.fn().mockResolvedValue(undefined),
      publish: vi.fn(),
    })
    const load = controller.updateContext({
      missionId: 'mission-1', rendererGeneration: 'r1', selectedKeys: [KEY_A],
    })
    await vi.waitFor(() => expect(controller.getState()).toMatchObject({
      tileCatalog: { activationId: 'selection-retry-stage-1' },
    }))
    if (controller.getState().status === 'inactive') throw new Error('Coverage unexpectedly inactive.')
    const notification = controller.notifyCatalogApplied(controller.getState().tileCatalog!)
    await vi.waitFor(() => expect(finishFinalization).toBeTypeOf('function'))

    const selectionChange = controller.updateContext({
      missionId: 'mission-1', rendererGeneration: 'r1', selectedKeys: [KEY_B],
    })
    const retry = controller.resume()
    finishFinalization?.()
    await Promise.all([notification, load, selectionChange, retry])
    await controller.notifySelectionApplied([KEY_B])

    expect(readClaim.mock.calls.at(-1)?.[0]).toMatchObject({ selectedKeys: [KEY_B] })
    expect(controller.getState()).toMatchObject({ status: 'complete', totalFixCount: 1 })
  })

  it('retains an explicit renderer failure without undoing irreversible finalization', async () => {
    let finishFinalization: (() => void) | undefined
    let finishRecoveryManifest: (() => void) | undefined
    const coverageManifest = manifest(1, [[KEY_A, 1]])
    const readManifest = vi.fn().mockResolvedValue(coverageManifest)
    const discardCatalog = vi.fn().mockResolvedValue(undefined)
    const deliverSelection = vi.fn().mockImplementation(async () => ({
      activationId: `renderer-failure-stage-${deliverSelection.mock.calls.length}`,
      missionId: 'mission-1',
      periods: [{
        periodKey: 'outing\u0000outing-1',
        revisionDigest: `failure-revision-${deliverSelection.mock.calls.length}`,
      }],
      delivered: [{ key: KEY_A, contentRev: 1 }],
    }))
    const controller = createCoverageController({
      readManifest,
      readChunk: vi.fn(),
      readClaim: vi.fn().mockResolvedValue({
        changeSeq: 1, databaseReady: true, blockers: [],
        chunkRevisions: [{ key: KEY_A, contentRev: 1 }],
      }),
      applyChunk: vi.fn(),
      deliverSelection,
      activateCatalog: vi.fn().mockResolvedValue(undefined),
      finalizeCatalog: vi.fn()
        .mockImplementationOnce(async () => {
          await new Promise<void>((resolve) => { finishFinalization = resolve })
        })
        .mockResolvedValue(undefined),
      discardCatalog,
      publish: vi.fn(),
    })
    const renderer = { commit: vi.fn(), rollback: vi.fn(), finalize: vi.fn() }
    const load = controller.updateContext({ missionId: 'mission-1', rendererGeneration: 'r1' })
    await vi.waitFor(() => expect(controller.getState()).toMatchObject({
      tileCatalog: { activationId: 'renderer-failure-stage-1' },
    }))
    if (controller.getState().status === 'inactive') throw new Error('Coverage unexpectedly inactive.')
    const catalog = controller.getState().tileCatalog!
    const notification = controller.notifyCatalogApplied(catalog, renderer)
    await vi.waitFor(() => expect(finishFinalization).toBeTypeOf('function'))

    controller.notifyRendererFailure({
      missionId: 'mission-1',
      periodKey: 'outing\u0000outing-1',
      revisionDigest: 'failure-revision-1',
      activationId: 'renderer-failure-stage-1',
      message: 'Coverage tile failed while the catalog was finalizing.',
    })
    finishFinalization?.()
    await Promise.all([notification, load])

    expect(renderer.finalize).toHaveBeenCalledOnce()
    expect(renderer.rollback).not.toHaveBeenCalled()
    expect(discardCatalog).not.toHaveBeenCalled()
    expect(controller.getState()).toMatchObject({
      status: 'error',
      tileCatalog: { activationId: 'renderer-failure-stage-1' },
      message: 'Complete mission history is temporarily unavailable. Existing coverage remains shown.',
    })

    readManifest.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => { finishRecoveryManifest = resolve })
      return coverageManifest
    })
    const retry = controller.resume()
    await vi.waitFor(() => expect(controller.getState()).toMatchObject({ status: 'loading' }))
    expect(controller.getState()).toMatchObject({ deliveredFixCount: 0 })
    finishRecoveryManifest?.()
    await vi.waitFor(() => expect(controller.getState()).toMatchObject({
      status: 'loading', tileCatalog: { activationId: 'renderer-failure-stage-2' },
    }))
    if (controller.getState().status === 'inactive') throw new Error('Coverage unexpectedly inactive.')
    const recoveryRenderer = { commit: vi.fn(), rollback: vi.fn(), finalize: vi.fn() }
    await controller.notifyCatalogApplied(controller.getState().tileCatalog!, recoveryRenderer)
    await retry

    expect(deliverSelection).toHaveBeenCalledTimes(2)
    expect(recoveryRenderer.finalize).toHaveBeenCalledOnce()
    expect(controller.getState()).toMatchObject({ status: 'complete' })
  })

  it('releases the owning load when backend catalog finalization rejects', async () => {
    const controller = createCoverageController({
      readManifest: vi.fn().mockResolvedValue(manifest(1, [[KEY_A, 1]])),
      readChunk: vi.fn(),
      readClaim: vi.fn().mockResolvedValue({
        changeSeq: 1, databaseReady: true, blockers: [],
        chunkRevisions: [{ key: KEY_A, contentRev: 1 }],
      }),
      applyChunk: vi.fn(),
      deliverSelection: vi.fn().mockResolvedValue({
        activationId: 'rejected-finalization-stage',
        missionId: 'mission-1',
        periods: [{ periodKey: 'outing\u0000outing-1', revisionDigest: 'rejected-revision' }],
        delivered: [{ key: KEY_A, contentRev: 1 }],
      }),
      activateCatalog: vi.fn().mockResolvedValue(undefined),
      finalizeCatalog: vi.fn().mockRejectedValue(new Error('Catalog finalization failed.')),
      discardCatalog: vi.fn().mockResolvedValue(undefined),
      publish: vi.fn(),
    })
    const renderer = { commit: vi.fn(), rollback: vi.fn(), finalize: vi.fn() }
    let loadSettled = false
    const load = controller.updateContext({ missionId: 'mission-1', rendererGeneration: 'r1' })
    void load.finally(() => { loadSettled = true })
    await vi.waitFor(() => expect(controller.getState()).toMatchObject({
      tileCatalog: { activationId: 'rejected-finalization-stage' },
    }))
    if (controller.getState().status === 'inactive') throw new Error('Coverage unexpectedly inactive.')

    await expect(controller.notifyCatalogApplied(
      controller.getState().tileCatalog!,
      renderer,
    )).rejects.toThrow('Catalog finalization failed.')

    try {
      await vi.waitFor(() => expect(loadSettled).toBe(true))
      expect(renderer.rollback).toHaveBeenCalledOnce()
      expect(controller.getState()).toMatchObject({ status: 'error' })
    } finally {
      controller.stop()
      await load
    }
  })

  it('clears a deferred Cancel after rejected finalization before Retry', async () => {
    let rejectFinalization: (() => void) | undefined
    const deliverSelection = vi.fn().mockImplementation(async () => ({
      activationId: `cancel-reject-stage-${deliverSelection.mock.calls.length}`,
      missionId: 'mission-1',
      periods: [{
        periodKey: 'outing\u0000outing-1',
        revisionDigest: `cancel-reject-revision-${deliverSelection.mock.calls.length}`,
      }],
      delivered: [{ key: KEY_A, contentRev: 1 }],
    }))
    const controller = createCoverageController({
      readManifest: vi.fn().mockResolvedValue(manifest(1, [[KEY_A, 1]])),
      readChunk: vi.fn(),
      readClaim: vi.fn().mockResolvedValue({
        changeSeq: 1, databaseReady: true, blockers: [],
        chunkRevisions: [{ key: KEY_A, contentRev: 1 }],
      }),
      applyChunk: vi.fn(),
      deliverSelection,
      activateCatalog: vi.fn().mockResolvedValue(undefined),
      finalizeCatalog: vi.fn()
        .mockImplementationOnce(async () => {
          await new Promise<void>((_resolve, reject) => {
            rejectFinalization = () => { reject(new Error('Catalog finalization failed.')) }
          })
        })
        .mockResolvedValue(undefined),
      discardCatalog: vi.fn().mockResolvedValue(undefined),
      publish: vi.fn(),
    })
    const firstRenderer = { commit: vi.fn(), rollback: vi.fn(), finalize: vi.fn() }
    const load = controller.updateContext({ missionId: 'mission-1', rendererGeneration: 'r1' })
    await vi.waitFor(() => expect(controller.getState()).toMatchObject({
      tileCatalog: { activationId: 'cancel-reject-stage-1' },
    }))
    if (controller.getState().status === 'inactive') throw new Error('Coverage unexpectedly inactive.')
    const notification = controller.notifyCatalogApplied(controller.getState().tileCatalog!, firstRenderer)
    await vi.waitFor(() => expect(rejectFinalization).toBeTypeOf('function'))

    controller.cancel()
    rejectFinalization?.()
    await expect(notification).rejects.toThrow('Catalog finalization failed.')
    await load

    const retry = controller.resume()
    await vi.waitFor(() => expect(controller.getState()).toMatchObject({
      status: 'loading', tileCatalog: { activationId: 'cancel-reject-stage-2' },
    }))
    if (controller.getState().status === 'inactive') throw new Error('Coverage unexpectedly inactive.')
    const recoveryRenderer = { commit: vi.fn(), rollback: vi.fn(), finalize: vi.fn() }
    await controller.notifyCatalogApplied(controller.getState().tileCatalog!, recoveryRenderer)
    await retry

    expect(deliverSelection).toHaveBeenCalledTimes(2)
    expect(recoveryRenderer.finalize).toHaveBeenCalledOnce()
    expect(controller.getState()).toMatchObject({ status: 'complete' })
  })

  it('never rolls back a renderer after backend finalization has succeeded', async () => {
    const discardCatalog = vi.fn().mockResolvedValue(undefined)
    const controller = createCoverageController({
      readManifest: vi.fn().mockResolvedValue(manifest(1, [[KEY_A, 1]])),
      readChunk: vi.fn(),
      readClaim: vi.fn().mockResolvedValue({
        changeSeq: 1, databaseReady: true, blockers: [],
        chunkRevisions: [{ key: KEY_A, contentRev: 1 }],
      }),
      applyChunk: vi.fn(),
      deliverSelection: vi.fn().mockResolvedValue({
        activationId: 'renderer-finalize-failure-stage',
        missionId: 'mission-1',
        periods: [{ periodKey: 'outing\u0000outing-1', revisionDigest: 'finalize-failure-revision' }],
        delivered: [{ key: KEY_A, contentRev: 1 }],
      }),
      activateCatalog: vi.fn().mockResolvedValue(undefined),
      finalizeCatalog: vi.fn().mockResolvedValue(undefined),
      discardCatalog,
      publish: vi.fn(),
    })
    const renderer = {
      commit: vi.fn(),
      rollback: vi.fn(),
      finalize: vi.fn(() => { throw new Error('Renderer ownership finalization failed.') }),
    }
    const load = controller.updateContext({ missionId: 'mission-1', rendererGeneration: 'r1' })
    await vi.waitFor(() => expect(controller.getState()).toMatchObject({
      tileCatalog: { activationId: 'renderer-finalize-failure-stage' },
    }))
    if (controller.getState().status === 'inactive') throw new Error('Coverage unexpectedly inactive.')

    await controller.notifyCatalogApplied(controller.getState().tileCatalog!, renderer)
    await load

    expect(renderer.commit).toHaveBeenCalledOnce()
    expect(renderer.rollback).not.toHaveBeenCalled()
    expect(discardCatalog).not.toHaveBeenCalled()
    expect(controller.getState()).toMatchObject({
      status: 'error',
      tileCatalog: { activationId: 'renderer-finalize-failure-stage' },
      deliveredFixCount: 0,
    })
  })

  it('settles irreversible catalog finalization before stopping the controller', async () => {
    let finishFinalization: (() => void) | undefined
    const discardCatalog = vi.fn().mockResolvedValue(undefined)
    const controller = createCoverageController({
      readManifest: vi.fn().mockResolvedValue(manifest(1, [[KEY_A, 1]])),
      readChunk: vi.fn(),
      readClaim: vi.fn().mockResolvedValue({
        changeSeq: 1, databaseReady: true, blockers: [],
        chunkRevisions: [{ key: KEY_A, contentRev: 1 }],
      }),
      applyChunk: vi.fn(),
      deliverSelection: vi.fn().mockResolvedValue({
        activationId: 'stop-finalization-stage',
        missionId: 'mission-1',
        periods: [{ periodKey: 'outing\u0000outing-1', revisionDigest: 'stop-revision' }],
        delivered: [{ key: KEY_A, contentRev: 1 }],
      }),
      activateCatalog: vi.fn().mockResolvedValue(undefined),
      finalizeCatalog: vi.fn(async () => {
        await new Promise<void>((resolve) => { finishFinalization = resolve })
      }),
      discardCatalog,
      publish: vi.fn(),
    })
    const renderer = { commit: vi.fn(), rollback: vi.fn(), finalize: vi.fn() }
    const load = controller.updateContext({ missionId: 'mission-1', rendererGeneration: 'r1' })
    await vi.waitFor(() => expect(controller.getState()).toMatchObject({
      tileCatalog: { activationId: 'stop-finalization-stage' },
    }))
    if (controller.getState().status === 'inactive') throw new Error('Coverage unexpectedly inactive.')
    const notification = controller.notifyCatalogApplied(controller.getState().tileCatalog!, renderer)
    await vi.waitFor(() => expect(finishFinalization).toBeTypeOf('function'))

    controller.stop()
    finishFinalization?.()
    await Promise.all([notification, load])

    expect(renderer.finalize).toHaveBeenCalledOnce()
    expect(renderer.rollback).not.toHaveBeenCalled()
    expect(discardCatalog).not.toHaveBeenCalled()
    expect(controller.getState()).toEqual({ status: 'inactive' })
  })

  it.each(['resolve', 'reject'] as const)(
    'fences an obsolete mission activation after backend %s',
    async (outcome) => {
      let resolveOld: (() => void) | undefined
      let rejectOld: ((error: Error) => void) | undefined
      const oldBackendActivation = new Promise<void>((resolve, reject) => {
        resolveOld = resolve
        rejectOld = reject
      })
      const activateCatalog = vi.fn((catalog: CoverageTileCatalog) =>
        catalog.activationId === 'stage-mission-1'
          ? oldBackendActivation
          : Promise.resolve())
      const finalizeCatalog = vi.fn().mockResolvedValue(undefined)
      const discardCatalog = vi.fn().mockResolvedValue(undefined)
      const oldRenderer = { commit: vi.fn(), rollback: vi.fn(), finalize: vi.fn() }
      const nextRenderer = { commit: vi.fn(), rollback: vi.fn(), finalize: vi.fn() }
      const controller = createCoverageController({
        readManifest: vi.fn(async (missionId) => manifest(
          1,
          [[missionId === 'mission-1' ? KEY_A : KEY_C, 1]],
        )),
        readChunk: vi.fn(),
        readClaim: vi.fn(async ({ selectedKeys }) => ({
          changeSeq: 1,
          databaseReady: true,
          blockers: [],
          chunkRevisions: selectedKeys.map((key) => ({ key, contentRev: 1 })),
        })),
        applyChunk: vi.fn(),
        deliverSelection: vi.fn(async ({ missionId, chunks }) => ({
          activationId: `stage-${missionId}`,
          periods: [{
            periodKey: `${chunks[0]!.key.period_kind}\u0000${chunks[0]!.key.period_id}`,
            revisionDigest: `revision-${missionId}`,
          }],
          delivered: chunks.map(({ key, contentRev }) => ({ key, contentRev })),
        })),
        activateCatalog,
        finalizeCatalog,
        discardCatalog,
        publish: vi.fn(),
      })
      const notify = controller.notifyCatalogApplied as unknown as (
        catalog: CoverageTileCatalog,
        activation: { readonly commit: () => void; readonly rollback: () => void },
      ) => Promise<void>

      const oldLoad = controller.updateContext({
        missionId: 'mission-1', rendererGeneration: 'r1',
      })
      await vi.waitFor(() => expect(controller.getState()).toMatchObject({
        missionId: 'mission-1', tileCatalog: { activationId: 'stage-mission-1' },
      }))
      const oldState = controller.getState()
      if (oldState.status === 'inactive' || oldState.tileCatalog === null) {
        throw new Error('Old coverage catalog was not staged.')
      }
      const oldNotification = notify(oldState.tileCatalog, oldRenderer)
      await vi.waitFor(() => expect(activateCatalog).toHaveBeenCalledWith(oldState.tileCatalog))

      const nextLoad = controller.updateContext({
        missionId: 'mission-2', rendererGeneration: 'r1',
      })
      await vi.waitFor(() => expect(controller.getState()).toMatchObject({
        missionId: 'mission-2', tileCatalog: { activationId: 'stage-mission-2' },
      }))
      const nextState = controller.getState()
      if (nextState.status === 'inactive' || nextState.tileCatalog === null) {
        throw new Error('Replacement coverage catalog was not staged.')
      }
      await notify(nextState.tileCatalog, nextRenderer)
      await nextLoad

      if (outcome === 'resolve') resolveOld?.()
      else rejectOld?.(new Error('obsolete activation failed'))
      await expect(oldNotification).resolves.toBeUndefined()
      await oldLoad

      expect(oldRenderer.commit).not.toHaveBeenCalled()
      expect(oldRenderer.rollback).toHaveBeenCalledOnce()
      expect(nextRenderer.commit).toHaveBeenCalledOnce()
      if (outcome === 'resolve') {
        expect(discardCatalog).toHaveBeenCalledWith(oldState.tileCatalog)
      }
      expect(controller.getState()).toMatchObject({
        missionId: 'mission-2', status: 'complete', deliveredFixCount: 1,
      })
    },
  )

  it('revokes Complete immediately when the active tile worker is lost', async () => {
    const harness = createHarness(manifest(1, [[KEY_A, 1]]))
    await harness.controller.updateContext({ missionId: 'mission-1', rendererGeneration: 'r1' })

    harness.controller.notifyRendererUnavailable('Coverage tile worker exited.')

    expect(harness.controller.getState()).toMatchObject({
      status: 'error', deliveredFixCount: 0, totalFixCount: 1,
    })
  })

  it('forces full Candidate-B redelivery before Complete can return after worker loss', async () => {
    const initial = manifest(1, [[KEY_A, 1]])
    const deliverSelection = vi.fn(async ({ chunks }: {
      readonly chunks: readonly { readonly key: CoverageChunkKey; readonly contentRev: number }[]
    }) => ({
      periods: [{ periodKey: 'outing\u0000outing-1', revisionDigest: `rev-${deliverSelection.mock.calls.length}` }],
      delivered: chunks,
    }))
    const controller = createCoverageController({
      readManifest: vi.fn().mockResolvedValue(initial),
      readChunk: vi.fn(),
      readClaim: vi.fn().mockResolvedValue({
        changeSeq: 1, databaseReady: true, blockers: [],
        chunkRevisions: [{ key: KEY_A, contentRev: 1 }],
      }),
      applyChunk: vi.fn(), deliverSelection, publish: vi.fn(),
    })
    const firstLoad = controller.updateContext({ missionId: 'mission-1', rendererGeneration: 'r1' })
    await vi.waitFor(() => expect(deliverSelection).toHaveBeenCalledTimes(1))
    if (controller.getState().status === 'inactive') throw new Error('Coverage unexpectedly inactive.')
    controller.notifyCatalogApplied(controller.getState().tileCatalog!)
    await firstLoad

    controller.notifyRendererUnavailable('Coverage tile worker exited.')
    expect(controller.getState()).toMatchObject({ status: 'error', deliveredFixCount: 0 })
    const retry = controller.resume()
    await vi.waitFor(() => expect(deliverSelection).toHaveBeenCalledTimes(2))
    expect(controller.getState()).toMatchObject({ status: 'loading', deliveredFixCount: 0 })
    if (controller.getState().status === 'inactive') throw new Error('Coverage unexpectedly inactive.')
    controller.notifyCatalogApplied(controller.getState().tileCatalog!)
    await retry

    expect(controller.getState()).toMatchObject({ status: 'complete', deliveredFixCount: 1 })
  })

  it('retains an allow-listed worker error class after a successful retry', async () => {
    const harness = createHarness(manifest(1, [[KEY_A, 1]]))
    harness.readManifest
      .mockRejectedValueOnce(new Error('Coverage tile worker timed out at /private/path'))
      .mockResolvedValueOnce(manifest(1, [[KEY_A, 1]]))

    await harness.controller.updateContext({ missionId: 'mission-1', rendererGeneration: 'r1' })
    expect(harness.controller.getState()).toMatchObject({
      status: 'error', lastErrorClass: 'timeout',
    })

    await harness.controller.resume()
    expect(harness.controller.getState()).toMatchObject({
      status: 'complete', lastErrorClass: 'timeout',
    })
    expect(JSON.stringify(harness.controller.getState())).not.toContain('/private/path')
  })

  it('lets operator Retry bypass the automatic open-outing rebuild cooldown', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-24T10:00:00.000Z'))
    const openKey: CoverageChunkKey = {
      device_id: 'device-a', period_kind: 'outing', period_id: 'open-outing',
    }
    const first = {
      ...manifest(1, [[openKey, 1]]),
      outings: [{
        id: 'open-outing', label: 'Open outing',
        started_at: '2026-08-24T09:00:00.000Z', ended_at: null,
      }],
    }
    const second = {
      ...first,
      changeSeq: 2,
      chunks: [{ ...first.chunks[0]!, contentRev: 2, builtRev: 2 }],
    }
    const readManifest = vi.fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValue(second)
    const readChunk = vi.fn().mockImplementation(async ({ key, expectedContentRev }) =>
      page(key, expectedContentRev))
    const readClaim = vi.fn().mockImplementation(async ({ selectedKeys }) => {
      const current = readManifest.mock.calls.length === 1 ? first : second
      return {
        changeSeq: current.changeSeq,
        databaseReady: true,
        blockers: [],
        chunkRevisions: selectedKeys.map((key: CoverageChunkKey) => ({
          key,
          contentRev: current.chunks[0]!.contentRev,
        })),
      }
    })
    const controller = createCoverageController({
      readManifest,
      readChunk,
      readClaim,
      applyChunk: vi.fn().mockResolvedValue(undefined),
      publish: vi.fn(),
    })

    await controller.updateContext({ missionId: 'mission-1', rendererGeneration: 'r1' })
    await controller.refresh()
    expect(controller.getState()).toMatchObject({ status: 'partial' })
    expect(readChunk).toHaveBeenCalledTimes(1)

    await controller.resume()

    expect(readChunk).toHaveBeenCalledTimes(2)
    expect(readChunk.mock.calls[1]?.[0]).toMatchObject({ expectedContentRev: 2 })
    expect(controller.getState()).toMatchObject({ status: 'complete' })
  })
})

function createHarness(initialManifest: CoverageManifest) {
  const readManifest = vi.fn().mockResolvedValue(initialManifest)
  const readChunk = vi.fn().mockImplementation(async ({ key, expectedContentRev }) =>
    page(key, expectedContentRev))
  const readClaim = vi.fn().mockImplementation(async ({ selectedKeys }) => ({
    changeSeq: initialManifest.changeSeq,
    databaseReady: true,
    blockers: [],
    chunkRevisions: selectedKeys.map((key: CoverageChunkKey) => ({ key, contentRev: 1 })),
  }))
  const applyChunk = vi.fn().mockResolvedValue(undefined)
  const publish = vi.fn()
  const controller = createCoverageController({
    readManifest,
    readChunk,
    readClaim,
    applyChunk,
    publish,
  })
  return { controller, readManifest, readChunk, readClaim, applyChunk, publish }
}

function manifest(
  changeSeq: number,
  chunks: readonly (readonly [CoverageChunkKey, number])[],
): CoverageManifest {
  return {
    changeSeq,
    enumerated: true,
    pendingInvalidation: false,
    backfillIncomplete: false,
    outings: [],
    chunks: chunks.map(([key, contentRev]) => ({
      key, contentRev, builtRev: contentRev, fixCount: 1, exactCount: 1, fixDigest: 'digest',
    })),
  }
}

function page(key: CoverageChunkKey, contentRev: number) {
  return {
    contentRev,
    nextCursor: null,
    positions: [{
      id: key.device_id,
      mission_id: 'mission-1',
      device_id: key.device_id,
      source_position_id: key.device_id,
      name: null,
      lat: 53,
      lon: -8,
      altitude: null,
      speed: null,
      battery: null,
      accuracy: null,
      timestamp: '2026-08-24T10:00:00.000Z',
      source: 'traccar',
      data_origin: 'live' as const,
      received_at: '2026-08-24T10:00:01.000Z',
    }],
  }
}
