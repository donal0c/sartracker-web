import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

import { afterEach, describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const { createElectronMissionStore } = require('../../electron/mission-store.cjs') as {
  readonly createElectronMissionStore: (options: {
    readonly userDataPath: string
    readonly onCoverageChanged?: (missionId: string, changeSeq: number) => void
    readonly coverageTileRunner?: {
      readonly syncCatalog: (input: unknown, options: unknown) => Promise<unknown>
      readonly commitCatalog?: (input: unknown, options: unknown) => Promise<unknown>
      readonly finalizeCatalog?: (input: unknown, options: unknown) => Promise<unknown>
      readonly discardCatalog?: (input: unknown, options: unknown) => Promise<unknown>
      readonly readTile: (input: unknown) => Promise<Uint8Array | null>
      readonly close: () => Promise<void>
    }
  }) => CoverageMissionStore
}

type CoverageKey = {
  readonly device_id: string
  readonly period_kind: 'outing' | 'unassigned'
  readonly period_id: string
}

type CoverageMissionStore = {
  readonly close: () => void
  readonly createMission: (input: { readonly name: string; readonly start_time: string }) => Promise<{ readonly id: string }>
  readonly upsertDevice: (input: {
    readonly mission_id: string
    readonly device_id: string
    readonly name: string
    readonly color: string
    readonly status: string
  }) => Promise<unknown>
  readonly addPositionsBulk: (input: {
    readonly mission_id: string
    readonly positions: readonly {
      readonly source_position_id: string
      readonly device_id: string
      readonly lat: number
      readonly lon: number
      readonly timestamp: string
    }[]
  }) => Promise<unknown>
  readonly createOuting: (input: {
    readonly mission_id: string
    readonly label: string
    readonly started_at: string
  }) => Promise<unknown>
  readonly selectMissionParticipants: (input: {
    readonly mission_id: string
    readonly groups: readonly {
      readonly traccar_group_id: string
      readonly name: string
      readonly member_device_ids: readonly string[]
    }[]
    readonly devices: readonly unknown[]
    readonly selected_by: string
  }) => Promise<readonly { readonly mission_team_id: string | null }[]>
  readonly recordGroupMembershipEvents: (input: {
    readonly mission_id: string
    readonly events: readonly {
      readonly mission_team_id: string
      readonly traccar_device_id: string
      readonly change: 'member' | 'left'
      readonly observed_at: string
    }[]
  }) => Promise<readonly unknown[]>
  readonly readCoverageManifest: (missionId: string, requestId?: string) => Promise<{
    readonly changeSeq: number
    readonly enumerated: boolean
    readonly pendingInvalidation: boolean
    readonly diagnostics: {
      readonly queueDepth: number
      readonly oldestQueuedAt: string | null
      readonly pendingChunkCount: number
      readonly staleChunkCount: number
      readonly freshChunkCount: number
      readonly pendingInvalidationCount: number
      readonly lastEnumerationDurationMs: number | null
      readonly lastBuildDurationMs: number | null
    }
    readonly chunks: readonly {
      readonly key: CoverageKey
      readonly contentRev: number
      readonly builtRev: number | null
      readonly fixCount: number | null
      readonly exactCount: number
      readonly fixDigest: string | null
    }[]
  }>
  readonly readCoverageChunk: (input: {
    readonly missionId: string
    readonly key: CoverageKey
    readonly expectedContentRev: number
    readonly cursor?: { readonly timestamp: string; readonly id: string }
  }, requestId?: string) => Promise<{
    readonly contentRev: number
    readonly positions: readonly { readonly source_position_id: string | null }[]
  }>
  readonly readCoverageClaim: (input: {
    readonly missionId: string
    readonly selectedKeys: readonly CoverageKey[]
  }, requestId?: string) => Promise<{
    readonly changeSeq: number
    readonly databaseReady: boolean
    readonly blockers: readonly string[]
    readonly chunkRevisions: readonly { readonly key: CoverageKey; readonly contentRev: number }[]
  }>
  readonly cancelCoverageQuery: (requestId: string) => Promise<boolean>
  readonly syncCoverageTileCatalog: (
    input: { readonly missionId: string; readonly chunks: readonly unknown[] },
    requestId?: string,
  ) => Promise<{
    readonly activationId: string
    readonly delivered: readonly { readonly key: CoverageKey; readonly contentRev: number }[]
  }>
  readonly activateCoverageTileCatalog: (input: { readonly activationId: string }) => Promise<boolean>
  readonly finalizeCoverageTileCatalog: (input: { readonly activationId: string }) => Promise<boolean>
  readonly discardCoverageTileCatalog: (input: { readonly activationId: string }) => Promise<boolean>
  readonly readCoverageTile: (input: Readonly<Record<string, unknown>>) => Promise<Uint8Array | null>
}

let directory: string | undefined
let store: CoverageMissionStore | undefined

afterEach(async () => {
  store?.close()
  store = undefined
  if (directory !== undefined) await rm(directory, { recursive: true, force: true })
  directory = undefined
})

describe('Electron coverage mission-store orchestration', () => {
  it('enumerates once, persists fresh metadata, and reads lossless chunks through the worker', async () => {
    store = await createStore()
    const mission = await seedMission(store)

    const manifest = await store.readCoverageManifest(mission.id, 'manifest-1')

    expect(manifest).toMatchObject({ enumerated: true, pendingInvalidation: false })
    expect(manifest.diagnostics).toMatchObject({
      queueDepth: 0,
      pendingChunkCount: 0,
      staleChunkCount: 0,
      freshChunkCount: 1,
      pendingInvalidationCount: 0,
      lastBuildDurationMs: null,
    })
    expect(manifest.diagnostics.lastEnumerationDurationMs).toBeGreaterThanOrEqual(0)
    expect(manifest.chunks).toEqual([
      expect.objectContaining({
        key: { device_id: 'device-1', period_kind: 'unassigned', period_id: '' },
        contentRev: 1,
        builtRev: 1,
        fixCount: 2,
        exactCount: 2,
      }),
    ])
    const chunk = await store.readCoverageChunk({
      missionId: mission.id,
      key: manifest.chunks[0]!.key,
      expectedContentRev: manifest.chunks[0]!.contentRev,
    }, 'chunk-1')
    expect(chunk.positions.map((position) => position.source_position_id)).toEqual([
      'source-1', 'source-2',
    ])

    const secondManifest = await store.readCoverageManifest(mission.id, 'manifest-2')
    expect(secondManifest.chunks).toEqual(manifest.chunks)
  })

  it('returns a database claim snapshot and blocks it immediately on a pending invalidation', async () => {
    store = await createStore()
    const mission = await seedMission(store)
    const manifest = await store.readCoverageManifest(mission.id, 'manifest-1')
    const selectedKeys = manifest.chunks.map((chunk) => chunk.key)

    await expect(store.readCoverageClaim({
      missionId: mission.id, selectedKeys,
    }, 'claim-1')).resolves.toMatchObject({
      databaseReady: true,
      blockers: [],
      chunkRevisions: [{ key: selectedKeys[0], contentRev: 1 }],
    })

    await store.createOuting({
      mission_id: mission.id,
      label: 'Outing 1',
      started_at: '2026-08-24T09:03:00.000Z',
    })
    await expect(store.readCoverageClaim({
      missionId: mission.id, selectedKeys,
    }, 'claim-2')).resolves.toMatchObject({
      databaseReady: false,
      blockers: expect.arrayContaining(['pending_invalidation']),
    })
  })

  it('drains invalidations and conditionally marks a complete chunk read fresh', async () => {
    store = await createStore()
    const mission = await seedMission(store)
    await store.readCoverageManifest(mission.id, 'manifest-1')
    await store.createOuting({
      mission_id: mission.id,
      label: 'Outing 1',
      started_at: '2026-08-24T09:03:00.000Z',
    })

    const stale = await store.readCoverageManifest(mission.id, 'manifest-2')
    expect(stale.pendingInvalidation).toBe(false)
    expect(stale.chunks.some((chunk) => chunk.builtRev !== chunk.contentRev)).toBe(true)
    for (const chunk of stale.chunks) {
      await store.readCoverageChunk({
        missionId: mission.id,
        key: chunk.key,
        expectedContentRev: chunk.contentRev,
      }, `chunk-${chunk.key.period_kind}`)
    }

    const fresh = await store.readCoverageManifest(mission.id, 'manifest-3')
    expect(fresh.chunks.every((chunk) => chunk.builtRev === chunk.contentRev)).toBe(true)
  })

  it('cancels only an active request ID and returns false for an unknown request', async () => {
    store = await createStore()

    await expect(store.cancelCoverageQuery('unknown')).resolves.toBe(false)
  })

  it('publishes the committed change sequence before a relevant mutation resolves', async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'sartracker-coverage-store-'))
    const ordering: string[] = []
    store = createElectronMissionStore({
      userDataPath: directory,
      onCoverageChanged: (missionId, changeSeq) => {
        ordering.push(`changed:${missionId}:${changeSeq}`)
      },
    })
    const mission = await seedMission(store)
    ordering.length = 0

    await store.createOuting({
      mission_id: mission.id,
      label: 'Outing 1',
      started_at: '2026-08-24T10:00:00.000Z',
    }).then(() => ordering.push('resolved'))

    expect(ordering).toEqual([`changed:${mission.id}:2`, 'resolved'])
  })

  it('revokes coverage before a group membership scope change resolves', async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'sartracker-coverage-store-'))
    const ordering: string[] = []
    store = createElectronMissionStore({
      userDataPath: directory,
      onCoverageChanged: (missionId, changeSeq) => {
        ordering.push(`changed:${missionId}:${changeSeq}`)
      },
    })
    const mission = await store.createMission({
      name: 'Coverage group mission', start_time: '2026-08-24T08:00:00.000Z',
    })
    const [group] = await store.selectMissionParticipants({
      mission_id: mission.id,
      groups: [{ traccar_group_id: 'group-1', name: 'Group 1', member_device_ids: [] }],
      devices: [], selected_by: 'Coordinator',
    })
    ordering.length = 0

    await store.recordGroupMembershipEvents({
      mission_id: mission.id,
      events: [{
        mission_team_id: group!.mission_team_id!, traccar_device_id: 'device-2',
        change: 'member', observed_at: '2026-08-24T09:00:00.000Z',
      }],
    }).then(() => ordering.push('resolved'))

    expect(ordering).toEqual([`changed:${mission.id}:2`, 'resolved'])
  })

  it('applies build metadata but keeps the prior catalog until renderer activation', async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'sartracker-coverage-store-'))
    const tileBytes = new Uint8Array([1, 2, 3])
    const syncCatalog = vi.fn()
    const tileRunner = {
      syncCatalog,
      commitCatalog: vi.fn().mockResolvedValue(true),
      finalizeCatalog: vi.fn().mockResolvedValue(true),
      discardCatalog: vi.fn().mockResolvedValue(true),
      readTile: vi.fn().mockResolvedValue(tileBytes),
      close: vi.fn().mockResolvedValue(undefined),
    }
    store = createElectronMissionStore({ userDataPath: directory, coverageTileRunner: tileRunner })
    const mission = await seedMission(store)
    const manifest = await store.readCoverageManifest(mission.id, 'manifest-1')
    const chunk = manifest.chunks[0]!
    syncCatalog.mockResolvedValue({
      stageId: 'coverage-stage-00000000-0000-4000-8000-000000000001-1',
      periods: [{
        periodKey: 'unassigned\u0000',
        revisionDigest: 'revision-1',
        contributors: [`device-1\u0000unassigned\u0000@${chunk.contentRev}`],
      }],
      delivered: [{ key: chunk.key, contentRev: chunk.contentRev }],
      builds: [{
        key: chunk.key,
        contentRev: chunk.contentRev,
        fixCount: 2,
        fixDigest: chunk.exactDigest,
        minTs: '2026-08-24T09:00:00.000Z',
        maxTs: '2026-08-24T09:05:00.000Z',
      }],
    })

    await expect(store.syncCoverageTileCatalog({
      missionId: mission.id,
      chunks: [{ key: chunk.key, contentRev: chunk.contentRev }],
    }, 'tiles-1')).resolves.toMatchObject({
      activationId: 'coverage-stage-00000000-0000-4000-8000-000000000001-1',
      delivered: [{ key: chunk.key, contentRev: chunk.contentRev }],
    })
    expect(tileRunner.commitCatalog).not.toHaveBeenCalled()
    await expect(store.activateCoverageTileCatalog({
      activationId: 'coverage-stage-00000000-0000-4000-8000-000000000001-1',
    })).resolves.toBe(true)
    expect(tileRunner.commitCatalog).toHaveBeenCalledWith(
      { stageId: 'coverage-stage-00000000-0000-4000-8000-000000000001-1' },
    )
    await expect(store.finalizeCoverageTileCatalog({
      activationId: 'coverage-stage-00000000-0000-4000-8000-000000000001-1',
    })).resolves.toBe(true)
    expect(tileRunner.finalizeCatalog).toHaveBeenCalledWith(
      { stageId: 'coverage-stage-00000000-0000-4000-8000-000000000001-1' },
    )
    expect(tileRunner.discardCatalog).not.toHaveBeenCalled()
    await expect(store.readCoverageTile({
      missionId: mission.id,
      periodKey: 'outing\u0000outing-1',
      revisionDigest: 'revision-1',
      z: 8,
      x: 1,
      y: 1,
    })).resolves.toEqual(tileBytes)
    const postBuildManifest = await store.readCoverageManifest(mission.id, 'manifest-2')
    expect(postBuildManifest.diagnostics.lastBuildDurationMs).toBeGreaterThanOrEqual(0)
  })

  it('discards a staged tile catalog when a live write rejects its build metadata', async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'sartracker-coverage-store-'))
    const commitCatalog = vi.fn().mockResolvedValue(true)
    const discardCatalog = vi.fn().mockResolvedValue(true)
    const syncCatalog = vi.fn()
    const tileRunner = {
      syncCatalog,
      commitCatalog,
      discardCatalog,
      readTile: vi.fn().mockResolvedValue(new Uint8Array()),
      close: vi.fn().mockResolvedValue(undefined),
    }
    store = createElectronMissionStore({ userDataPath: directory, coverageTileRunner: tileRunner })
    const mission = await seedMission(store)
    const manifest = await store.readCoverageManifest(mission.id, 'manifest-stage')
    const chunk = manifest.chunks[0]!
    syncCatalog.mockImplementationOnce(async () => {
      await store!.addPositionsBulk({
        mission_id: mission.id,
        positions: [{
          source_position_id: 'source-live-race', device_id: 'device-1',
          lat: 52.02, lon: -9.72, timestamp: '2026-08-24T09:06:00.000Z',
        }],
      })
      return {
        stageId: 'coverage-stage-00000000-0000-4000-8000-000000000002-1',
        periods: [{
          periodKey: 'unassigned\u0000', revisionDigest: 'revision-stale',
          contributors: [`device-1\u0000unassigned\u0000@${chunk.contentRev}`],
        }],
        delivered: [{ key: chunk.key, contentRev: chunk.contentRev }],
        builds: [{
          key: chunk.key, contentRev: chunk.contentRev, fixCount: 2,
          fixDigest: chunk.exactDigest, minTs: null, maxTs: null,
        }],
      }
    })

    await expect(store.syncCoverageTileCatalog({
      missionId: mission.id,
      chunks: [{ key: chunk.key, contentRev: chunk.contentRev }],
    }, 'tiles-race')).rejects.toThrow(/chunk-stale/i)
    expect(discardCatalog).toHaveBeenCalledWith({
      stageId: 'coverage-stage-00000000-0000-4000-8000-000000000002-1',
    })
    expect(commitCatalog).not.toHaveBeenCalled()
  })

  it('cancels a catalog build without terminating the worker serving retained coverage', async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'sartracker-coverage-store-'))
    let finishBuild: ((value: {
      stageId: string
      periods: readonly unknown[]
      delivered: readonly unknown[]
      builds: readonly unknown[]
    }) => void) | undefined
    const syncCatalog = vi.fn(() => new Promise<{
      stageId: string
      periods: readonly unknown[]
      delivered: readonly unknown[]
      builds: readonly unknown[]
    }>((resolve) => {
      finishBuild = resolve
    }))
    const discardCatalog = vi.fn().mockResolvedValue(true)
    const tileRunner = {
      syncCatalog,
      commitCatalog: vi.fn().mockResolvedValue(true),
      discardCatalog,
      readTile: vi.fn().mockResolvedValue(new Uint8Array([1])),
      close: vi.fn().mockResolvedValue(undefined),
    }
    store = createElectronMissionStore({ userDataPath: directory, coverageTileRunner: tileRunner })
    const mission = await seedMission(store)
    const request = store.syncCoverageTileCatalog({
      missionId: mission.id,
      chunks: [],
    }, 'tiles-cancel-retain')
    await vi.waitFor(() => expect(syncCatalog).toHaveBeenCalledOnce())

    const cancelled = store.cancelCoverageQuery('tiles-cancel-retain')
    finishBuild?.({
      stageId: 'coverage-stage-00000000-0000-4000-8000-000000000003-1',
      periods: [],
      delivered: [],
      builds: [],
    })

    await expect(request).rejects.toMatchObject({ name: 'AbortError' })
    await expect(cancelled).resolves.toBe(true)
    expect(syncCatalog).toHaveBeenCalledWith({
      missionId: mission.id,
      chunks: [],
    })
    expect(discardCatalog).toHaveBeenCalledWith({
      stageId: 'coverage-stage-00000000-0000-4000-8000-000000000003-1',
    })
    await expect(store.readCoverageTile({
      missionId: mission.id,
      periodKey: 'outing\u0000outing-1',
      revisionDigest: 'revision-1',
      z: 8,
      x: 1,
      y: 1,
    })).resolves.toEqual(new Uint8Array([1]))
  })
})

async function createStore(): Promise<CoverageMissionStore> {
  directory = await mkdtemp(path.join(tmpdir(), 'sartracker-coverage-store-'))
  return createElectronMissionStore({ userDataPath: directory })
}

async function seedMission(coverageStore: CoverageMissionStore): Promise<{ readonly id: string }> {
  const mission = await coverageStore.createMission({
    name: 'Coverage mission',
    start_time: '2026-08-24T08:00:00.000Z',
  })
  await coverageStore.upsertDevice({
    mission_id: mission.id,
    device_id: 'device-1',
    name: 'Device 1',
    color: '#fff',
    status: 'online',
  })
  await coverageStore.addPositionsBulk({
    mission_id: mission.id,
    positions: [
      { source_position_id: 'source-1', device_id: 'device-1', lat: 52, lon: -9.7, timestamp: '2026-08-24T09:00:00.000Z' },
      { source_position_id: 'source-2', device_id: 'device-1', lat: 52.01, lon: -9.71, timestamp: '2026-08-24T09:05:00.000Z' },
    ],
  })
  return mission
}
