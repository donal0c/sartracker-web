import { describe, expect, it, vi } from 'vitest'

import type {
  CoverageChunkKey,
  CoverageClaim,
  CoverageManifest,
} from '../../src/infrastructure/mission-store/tauri-mission-store'
import { createCoverageController } from '../../src/features/tracking/coverage-controller'

const KEY: CoverageChunkKey = {
  device_id: 'device-1', period_kind: 'unassigned', period_id: '',
}

describe('coverage claim revocation [DON-276]', () => {
  it('revokes Complete immediately without discarding unchanged delivery', async () => {
    const manifests = [manifest(1), manifest(2)]
    const claims = [claim(1), claim(2)]
    const controller = createCoverageController({
      readManifest: vi.fn(async () => manifests.shift()!),
      readChunk: vi.fn(async () => ({
        contentRev: 1,
        positions: [],
        nextCursor: null,
      })),
      readClaim: vi.fn(async () => claims.shift()!),
      applyChunk: vi.fn(async () => undefined),
      publish: vi.fn(),
    })
    await controller.updateContext({ missionId: 'mission-1', rendererGeneration: 'r1' })

    const refresh = controller.notifyChanged('mission-1', 2)
    expect(controller.getState()).toMatchObject({
      status: 'loading',
      latestObservedChangeSeq: 2,
      deliveredFixCount: 1,
    })
    await refresh

    expect(controller.getState()).toMatchObject({ status: 'complete', changeSeq: 2 })
  })

  it('catches a missed notification on the bounded refresh path', async () => {
    const readManifest = vi.fn()
      .mockResolvedValueOnce(manifest(1))
      .mockResolvedValueOnce(manifest(3))
    const readClaim = vi.fn()
      .mockResolvedValueOnce(claim(1))
      .mockResolvedValueOnce(claim(3))
    const controller = createCoverageController({
      readManifest,
      readChunk: vi.fn(async () => ({ contentRev: 1, positions: [], nextCursor: null })),
      readClaim,
      applyChunk: vi.fn(async () => undefined),
      publish: vi.fn(),
    })
    await controller.updateContext({ missionId: 'mission-1', rendererGeneration: 'r1' })

    await controller.refresh()

    expect(controller.getState()).toMatchObject({
      status: 'complete', changeSeq: 3, latestObservedChangeSeq: 3,
    })
  })
})

function manifest(changeSeq: number): CoverageManifest {
  return {
    changeSeq,
    enumerated: true,
    pendingInvalidation: false,
    backfillIncomplete: false,
    outings: [],
    chunks: [{
      key: KEY,
      contentRev: 1,
      builtRev: 1,
      fixCount: 1,
      exactCount: 1,
      fixDigest: 'digest',
    }],
  }
}

function claim(changeSeq: number): CoverageClaim {
  return {
    changeSeq,
    databaseReady: true,
    blockers: [],
    chunkRevisions: [{ key: KEY, contentRev: 1 }],
  }
}
