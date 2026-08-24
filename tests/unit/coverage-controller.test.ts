import { describe, expect, it, vi } from 'vitest'

import type {
  CoverageChunkKey,
  CoverageManifest,
} from '../../src/infrastructure/mission-store/tauri-mission-store'
import { createCoverageController } from '../../src/features/tracking/coverage-controller'

const KEY_A: CoverageChunkKey = {
  device_id: 'device-a', period_kind: 'outing', period_id: 'outing-1',
}
const KEY_B: CoverageChunkKey = {
  device_id: 'device-b', period_kind: 'outing', period_id: 'outing-1',
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
