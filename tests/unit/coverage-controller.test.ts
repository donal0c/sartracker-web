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
    await vi.waitFor(() => expect(controller.getState()).toMatchObject({
      missionId: 'mission-2', tileCatalog: { activationId: 'stage-mission-2' },
    }))
    if (controller.getState().status === 'inactive') throw new Error('Coverage unexpectedly inactive.')
    const nextCatalog = controller.getState().tileCatalog!
    await controller.notifyCatalogApplied(nextCatalog)
    await nextLoad
    finishOldFinalization?.()
    await oldNotification
    await oldLoad

    controller.cancel()
    expect(controller.getState()).toMatchObject({
      missionId: 'mission-2', tileCatalog: { missionId: 'mission-2' },
    })
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
  const controller = createCoverageController({
    readManifest,
    readChunk,
    readClaim,
    applyChunk,
    publish: vi.fn(),
  })
  return { controller, readManifest, readChunk, readClaim, applyChunk }
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
