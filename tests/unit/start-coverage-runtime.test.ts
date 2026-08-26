import { afterEach, describe, expect, it, vi } from 'vitest'

import type {
  CoverageManifest,
  Mission,
} from '../../src/infrastructure/mission-store/tauri-mission-store'
import { useMissionStore } from '../../src/features/mission/mission-store'
import { useCoverageStore } from '../../src/features/tracking/coverage-store'
import { useIngestHealthStore } from '../../src/features/tracking/ingest-health-store'
import { startCoverageRuntime } from '../../src/features/tracking/start-coverage-runtime'

afterEach(() => {
  useMissionStore.setState(useMissionStore.getInitialState())
  useCoverageStore.setState(useCoverageStore.getInitialState())
  useIngestHealthStore.setState(useIngestHealthStore.getInitialState())
})

describe('coverage runtime wiring [DON-276]', () => {
  it('uses Candidate B catalog delivery and revokes on the coordinate-free change event', async () => {
    let changeSeq = 1
    let changedListener: ((event: { missionId: string; changeSeq: number }) => void) | undefined
    const readCoverageManifest = vi.fn(async () => manifest(changeSeq))
    const activateCoverageTileCatalog = vi.fn(async () => true)
    const finalizeCoverageTileCatalog = vi.fn(async () => true)
    const syncCoverageTileCatalog = vi.fn(async () => ({
      activationId: `stage-${changeSeq}`,
      periods: [{ periodKey: 'unassigned\u0000', revisionDigest: `rev-${changeSeq}` }],
      delivered: [{ key: manifest(changeSeq).chunks[0]!.key, contentRev: 1 }],
    }))
    const missionStore = {
      readCoverageManifest,
      syncCoverageTileCatalog,
      activateCoverageTileCatalog,
      finalizeCoverageTileCatalog,
      discardCoverageTileCatalog: vi.fn(async () => true),
      readCoverageClaim: vi.fn(async () => ({
        changeSeq,
        databaseReady: true,
        blockers: [],
        chunkRevisions: [{ key: manifest(changeSeq).chunks[0]!.key, contentRev: 1 }],
      })),
      cancelCoverageQuery: vi.fn(async () => true),
    }
    useMissionStore.setState({ currentMission: mission(), phase: 'active' })

    const stop = startCoverageRuntime(missionStore, {
      enabled: true,
      rendererGeneration: 'renderer-1',
      subscribeCoverageChanged: (listener) => {
        changedListener = listener
        return () => { changedListener = undefined }
      },
      schedulePeriodicRefresh: () => () => undefined,
    })
    await acknowledgePendingCatalog()
    await vi.waitFor(() => expect(useCoverageStore.getState().state).toMatchObject({
      status: 'complete', changeSeq: 1,
    }))
    expect(syncCoverageTileCatalog).toHaveBeenCalledOnce()
    expect(activateCoverageTileCatalog).toHaveBeenCalledWith({
      activationId: 'stage-1',
    })
    expect(finalizeCoverageTileCatalog).toHaveBeenCalledWith({
      activationId: 'stage-1',
    })

    changeSeq = 2
    changedListener?.({ missionId: 'mission-1', changeSeq: 2 })
    expect(useCoverageStore.getState().state.status).not.toBe('complete')
    await acknowledgePendingCatalog()
    await vi.waitFor(() => expect(useCoverageStore.getState().state).toMatchObject({
      status: 'complete', changeSeq: 2,
    }))

    stop()
    expect(useCoverageStore.getState().state).toEqual({ status: 'inactive' })
  })

  it('revokes Complete immediately when ingest evidence health changes', async () => {
    let evidenceChanged: (() => void) | undefined
    const readCoverageClaim = vi.fn(async () => ({
      changeSeq: 1, databaseReady: true, blockers: [],
      chunkRevisions: [{ key: manifest(1).chunks[0]!.key, contentRev: 1 }],
    }))
    const missionStore = {
      readCoverageManifest: vi.fn(async () => manifest(1)),
      syncCoverageTileCatalog: vi.fn(async () => ({
        activationId: 'stage-1',
        periods: [{ periodKey: 'unassigned\u0000', revisionDigest: 'rev-1' }],
        delivered: [{ key: manifest(1).chunks[0]!.key, contentRev: 1 }],
      })),
      activateCoverageTileCatalog: vi.fn(async () => true),
      finalizeCoverageTileCatalog: vi.fn(async () => true),
      discardCoverageTileCatalog: vi.fn(async () => true),
      readCoverageClaim,
      cancelCoverageQuery: vi.fn(async () => true),
    }
    useMissionStore.setState({ currentMission: mission(), phase: 'active' })
    const stop = startCoverageRuntime(missionStore, {
      enabled: true,
      rendererGeneration: 'renderer-1',
      subscribeCoverageChanged: () => () => undefined,
      subscribeIngestEvidenceHealth: (listener) => {
        evidenceChanged = listener
        return () => { evidenceChanged = undefined }
      },
      schedulePeriodicRefresh: () => () => undefined,
    })
    await acknowledgePendingCatalog()
    await vi.waitFor(() => expect(useCoverageStore.getState().state.status).toBe('complete'))

    useIngestHealthStore.getState().applyEvidenceHealth({
      state: 'degraded',
      reason: 'renderer_evidence_pending',
      pendingCount: 1,
      corruptCount: 0,
      conflictCount: 0,
      rejectedCount: 1,
      affectedDeviceCount: 1,
      conflictDeviceIds: [],
    })
    evidenceChanged?.()

    expect(useCoverageStore.getState().state.status).toBe('loading')
    await vi.waitFor(() => expect(readCoverageClaim).toHaveBeenCalledTimes(2))
    expect(useCoverageStore.getState().state).toMatchObject({
      status: 'partial',
      blockers: expect.arrayContaining(['renderer_evidence_pending']),
    })
    stop()
  })

  it('does nothing while the internal flag is off', () => {
    const stop = startCoverageRuntime({}, { enabled: false })

    expect(useCoverageStore.getState().state).toEqual({ status: 'inactive' })
    stop()
  })
})

async function acknowledgePendingCatalog(): Promise<void> {
  await vi.waitFor(() => {
    const current = useCoverageStore.getState()
    expect(current.controller).not.toBeNull()
    expect(current.state).not.toEqual({ status: 'inactive' })
    if (current.state.status !== 'inactive') expect(current.state.tileCatalog).not.toBeNull()
  })
  const current = useCoverageStore.getState()
  if (current.state.status !== 'inactive' && current.state.tileCatalog !== null) {
    await current.controller?.notifyCatalogApplied(current.state.tileCatalog)
  }
}

function mission(): Mission {
  return {
    id: 'mission-1', name: 'Mission', status: 'active',
    start_time: '2026-08-24T08:00:00.000Z', pause_time: null, finish_time: null,
    paused_seconds: 0, notes: null, schema_version: 10,
  }
}

function manifest(changeSeq: number): CoverageManifest {
  return {
    changeSeq,
    enumerated: true,
    pendingInvalidation: false,
    backfillIncomplete: false,
    outings: [],
    chunks: [{
      key: { device_id: 'device-1', period_kind: 'unassigned', period_id: '' },
      contentRev: 1, builtRev: 1, fixCount: 1, exactCount: 1, fixDigest: 'digest',
    }],
  }
}
