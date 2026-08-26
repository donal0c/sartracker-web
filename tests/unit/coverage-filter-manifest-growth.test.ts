import { afterEach, describe, expect, it, vi } from 'vitest'

import type {
  CoverageChunkKey,
  CoverageManifest,
  Mission,
} from '../../src/infrastructure/mission-store/tauri-mission-store'
import { useMissionStore } from '../../src/features/mission/mission-store'
import { useCoverageStore } from '../../src/features/tracking/coverage-store'
import {
  selectCoverageChunkKeys,
  useCoverageFilterStore,
} from '../../src/features/tracking/coverage-filter-store'
import { useIngestHealthStore } from '../../src/features/tracking/ingest-health-store'
import { startCoverageRuntime } from '../../src/features/tracking/start-coverage-runtime'

describe('coverage filters across manifest growth [DON-275]', () => {
  afterEach(() => {
    useMissionStore.setState(useMissionStore.getInitialState())
    useCoverageStore.setState(useCoverageStore.getInitialState())
    useCoverageFilterStore.setState(useCoverageFilterStore.getInitialState())
    useIngestHealthStore.setState(useIngestHealthStore.getInitialState())
  })

  it('keeps newly created visible outing chunks inside the claim scope', async () => {
    let outings: CoverageManifest['outings'] = []
    let outingRev = 1
    let outingBuiltRev: number | null = 1
    let changeSeq = 1
    let stage = 0
    const seenClaims: CoverageChunkKey[][] = []
    const syncedBatches: CoverageChunkKey[][] = []

    const currentManifest = (): CoverageManifest => ({
      changeSeq,
      enumerated: true,
      pendingInvalidation: false,
      backfillIncomplete: false,
      outings,
      chunks: ['device-1', 'device-2'].flatMap((deviceId) => [
        {
          key: {
            device_id: deviceId,
            period_kind: 'unassigned' as const,
            period_id: '',
          },
          contentRev: 1,
          builtRev: 1,
          fixCount: 10,
          exactCount: 10,
          fixDigest: 'digest',
        },
        ...outings.map((outing) => ({
          key: {
            device_id: deviceId,
            period_kind: 'outing' as const,
            period_id: outing.id,
          },
          contentRev: outingRev,
          builtRev: outingBuiltRev,
          fixCount: outingBuiltRev === null ? null : 40,
          exactCount: 55,
          fixDigest: 'digest',
        })),
      ]),
    })

    const readCoverageClaim = vi.fn(async (query: {
      readonly missionId: string
      readonly selectedKeys: readonly CoverageChunkKey[]
    }) => {
      seenClaims.push([...query.selectedKeys])
      const byIdentity = new Map(currentManifest().chunks.map((chunk) => [
        coverageIdentity(chunk.key),
        chunk,
      ]))
      const blockers: string[] = []
      const chunkRevisions = query.selectedKeys.map((key) => {
        const chunk = byIdentity.get(coverageIdentity(key))
        if (chunk === undefined) throw new Error('Selected coverage chunk is missing.')
        if (chunk.builtRev !== chunk.contentRev) blockers.push('chunk_not_fresh')
        return { key, contentRev: chunk.contentRev }
      })
      const uniqueBlockers = [...new Set(blockers)]
      return {
        changeSeq,
        databaseReady: uniqueBlockers.length === 0,
        blockers: uniqueBlockers,
        chunkRevisions,
      }
    })

    const missionStore = {
      readCoverageManifest: vi.fn(async () => currentManifest()),
      syncCoverageTileCatalog: vi.fn(async (input: {
        readonly missionId: string
        readonly chunks: readonly { readonly key: CoverageChunkKey; readonly contentRev: number }[]
      }) => {
        stage += 1
        syncedBatches.push(input.chunks.map((chunk) => chunk.key))
        if (input.chunks.some((chunk) => chunk.key.period_kind === 'outing')) {
          outingBuiltRev = outingRev
        }
        return {
          activationId: `stage-${stage}`,
          missionId: input.missionId,
          periods: [{ periodKey: 'period', revisionDigest: `revision-${stage}` }],
          delivered: input.chunks.map((chunk) => ({
            key: chunk.key,
            contentRev: chunk.contentRev,
          })),
        }
      }),
      activateCoverageTileCatalog: vi.fn(async () => true),
      finalizeCoverageTileCatalog: vi.fn(async () => true),
      discardCoverageTileCatalog: vi.fn(async () => true),
      readCoverageClaim,
      cancelCoverageQuery: vi.fn(async () => true),
    }

    useMissionStore.setState({ currentMission: mission(), phase: 'active' })
    let changedListener: ((event: { missionId: string; changeSeq: number }) => void) | undefined
    const stop = startCoverageRuntime(missionStore, {
      enabled: true,
      rendererGeneration: 'renderer-1',
      subscribeCoverageChanged: (listener) => {
        changedListener = listener
        return () => { changedListener = undefined }
      },
      schedulePeriodicRefresh: () => () => undefined,
    })
    await settleCoverageRuntime()
    await vi.waitFor(() => expect(useCoverageStore.getState().state.status).toBe('complete'))

    useCoverageFilterStore.getState().setDeviceVisibility('device-1', false)
    await settleCoverageRuntime()
    await vi.waitFor(() => expect(useCoverageStore.getState().state.status).toBe('complete'))

    outings = [{
      id: 'outing-1',
      mission_id: 'mission-1',
      label: 'Sector A',
      started_at: '2026-08-24T09:00:00.000Z',
      ended_at: null,
      notes: null,
    }]
    changeSeq = 2
    changedListener?.({ missionId: 'mission-1', changeSeq })
    await settleCoverageRuntime()
    await vi.waitFor(() => expect(useCoverageStore.getState().state).toMatchObject({
      status: 'complete',
      changeSeq: 2,
    }))
    const syncCountAfterOuting = syncedBatches.length

    outingRev = 2
    outingBuiltRev = 1
    changeSeq = 3
    changedListener?.({ missionId: 'mission-1', changeSeq })
    await settleCoverageRuntime()
    await vi.waitFor(() => expect(useCoverageStore.getState().state.changeSeq).toBe(3))

    expect(useCoverageStore.getState().state).toMatchObject({
      status: 'partial',
      blockers: expect.arrayContaining(['chunk_not_fresh']),
    })
    expect(seenClaims.at(-1)).toContainEqual({
      device_id: 'device-2',
      period_kind: 'outing',
      period_id: 'outing-1',
    })
    expect(syncedBatches).toHaveLength(syncCountAfterOuting)
    expect(outingBuiltRev).toBe(1)
    stop()
  })
})

async function settleCoverageRuntime(): Promise<void> {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const current = useCoverageStore.getState()
    if (current.state.status !== 'inactive' && current.state.tileCatalog !== null) {
      await current.controller?.notifyCatalogApplied(current.state.tileCatalog)
        .catch(() => undefined)
    }
    const after = useCoverageStore.getState()
    const manifest = after.state.status === 'inactive' ? null : after.state.manifest
    await after.controller?.notifySelectionApplied(
      selectCoverageChunkKeys(manifest, useCoverageFilterStore.getState()),
    ).catch(() => undefined)
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

function coverageIdentity(key: CoverageChunkKey): string {
  return `${key.device_id}\u0000${key.period_kind}\u0000${key.period_id}`
}

function mission(): Mission {
  return {
    id: 'mission-1',
    name: 'Mission',
    status: 'active',
    start_time: '2026-08-24T08:00:00.000Z',
    pause_time: null,
    finish_time: null,
    paused_seconds: 0,
    notes: null,
    schema_version: 10,
  }
}
