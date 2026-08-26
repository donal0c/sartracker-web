import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

import { afterEach, describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')
const { createCoverageTileCatalog } = require('../../electron/coverage-tile-catalog.cjs') as {
  readonly createCoverageTileCatalog: (input: {
    readonly missionId: string
    readonly chunks: readonly { readonly key: CoverageKey; readonly contentRev: number }[]
  }) => {
    readonly periods: readonly {
      readonly periodKey: string
      readonly revisionDigest: string
      readonly contributors: readonly string[]
    }[]
  }
}
const { runCoverageQueryInWorker: runRealCoverageQueryInWorker } = require(
  '../../electron/coverage-query-runner.cjs',
) as {
  readonly runCoverageQueryInWorker: (input: {
    readonly databasePath: string
    readonly query: Readonly<Record<string, unknown>>
    readonly signal?: AbortSignal
  }) => Promise<Record<string, unknown>>
}
const { createElectronMissionStore } = require('../../electron/mission-store.cjs') as {
  readonly createElectronMissionStore: (options: {
    readonly userDataPath: string
    readonly onCoverageChanged?: (missionId: string, changeSeq: number) => void
    readonly coverageTileRunner?: {
      readonly syncCatalog: (input: unknown, options: unknown) => Promise<unknown>
      readonly commitCatalog?: (input: unknown, options: unknown) => Promise<unknown>
      readonly finalizeCatalog?: (input: unknown, options: unknown) => Promise<unknown>
      readonly discardCatalog?: (input: unknown, options: unknown) => Promise<unknown>
      readonly readTile: (
        input: unknown,
        options?: { readonly signal?: AbortSignal },
      ) => Promise<Uint8Array | null>
      readonly close: () => Promise<void>
    }
    readonly runCoverageQueryInWorker?: (input: {
      readonly databasePath: string
      readonly query: Readonly<Record<string, unknown>>
      readonly signal?: AbortSignal
      readonly resultLimits?: Readonly<Record<string, number>>
    }) => Promise<Record<string, unknown>>
    readonly ingestEvidenceFaultInjection?: {
      readonly failProjection?: boolean
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
  }) => Promise<{ readonly id: string }>
  readonly endOuting: (input: {
    readonly mission_id: string
    readonly outing_id: string
    readonly ended_at: string
  }) => Promise<unknown>
  readonly editOutingBoundaries: (input: {
    readonly mission_id: string
    readonly outing_id: string
    readonly started_at?: string
    readonly ended_at?: string | null
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
  readonly recordIngestRejections: (input: {
    readonly mission_id: string
    readonly rejections: readonly {
      readonly deliveryId: string
      readonly anomalyKey: string
      readonly deviceId: string
      readonly sourcePositionId: string
      readonly reasonClass: string
      readonly receivedAt: string
      readonly canonicalEvidence: Readonly<Record<string, unknown>>
    }[]
  }) => Promise<unknown>
  readonly cancelCoverageQuery: (requestId: string) => Promise<boolean>
  readonly readCoverageTile: (
    input: Readonly<Record<string, unknown>>,
    requestId?: string,
  ) => Promise<Uint8Array | null>
  readonly cancelCoverageTileRead: (requestId: string) => Promise<boolean>
  readonly syncCoverageTileCatalog: (
    input: { readonly missionId: string; readonly chunks: readonly unknown[] },
    requestId?: string,
  ) => Promise<{
    readonly activationId: string
    readonly periods: readonly {
      readonly periodKey: string
      readonly revisionDigest: string
    }[]
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
  it('attests staged and active tiles through the real store and worker across rebuilds', async () => {
    store = await createStore()
    const mission = await seedMission(store)
    await store.createOuting({
      mission_id: mission.id,
      label: 'Search period',
      started_at: '2026-08-24T09:03:00.000Z',
    })

    const firstManifest = await store.readCoverageManifest(mission.id, 'real-worker-manifest-1')
    const firstChunks = firstManifest.chunks.map((chunk) => ({
      key: chunk.key,
      contentRev: chunk.contentRev,
    }))
    expect(firstChunks).toHaveLength(2)
    const firstCatalog = await store.syncCoverageTileCatalog({
      missionId: mission.id,
      chunks: firstChunks,
    }, 'real-worker-sync-1')
    const outingPeriod = firstCatalog.periods.find((period) => period.periodKey.startsWith('outing\u0000'))
    expect(outingPeriod).toBeDefined()
    const tileAddress = {
      missionId: mission.id,
      periodKey: outingPeriod!.periodKey,
      revisionDigest: outingPeriod!.revisionDigest,
      z: 8,
      x: 121,
      y: 84,
    }

    const stagedTile = await store.readCoverageTile(tileAddress, 'real-worker-staged-tile')
    expect(stagedTile?.byteLength).toBeGreaterThan(0)
    await expect(store.activateCoverageTileCatalog({
      activationId: firstCatalog.activationId,
    })).resolves.toBe(true)
    const activeTile = await store.readCoverageTile(tileAddress, 'real-worker-active-tile')
    expect(activeTile).toEqual(stagedTile)
    await expect(store.finalizeCoverageTileCatalog({
      activationId: firstCatalog.activationId,
    })).resolves.toBe(true)

    await store.addPositionsBulk({
      mission_id: mission.id,
      positions: [{
        source_position_id: 'source-3',
        device_id: 'device-1',
        lat: 52.02,
        lon: -9.72,
        timestamp: '2026-08-24T09:06:00.000Z',
      }],
    })
    const secondManifest = await store.readCoverageManifest(mission.id, 'real-worker-manifest-2')
    const secondChunks = secondManifest.chunks.map((chunk) => ({
      key: chunk.key,
      contentRev: chunk.contentRev,
    }))
    const firstRevisions = new Map(firstChunks.map((chunk) => [
      `${chunk.key.device_id}\u0000${chunk.key.period_kind}\u0000${chunk.key.period_id}`,
      chunk.contentRev,
    ]))
    expect(secondChunks.filter((chunk) => firstRevisions.get(
      `${chunk.key.device_id}\u0000${chunk.key.period_kind}\u0000${chunk.key.period_id}`,
    ) === chunk.contentRev)).toHaveLength(1)
    const secondCatalog = await store.syncCoverageTileCatalog({
      missionId: mission.id,
      chunks: secondChunks,
    }, 'real-worker-sync-2')
    await store.activateCoverageTileCatalog({ activationId: secondCatalog.activationId })
    await store.finalizeCoverageTileCatalog({ activationId: secondCatalog.activationId })
    await expect(store.readCoverageClaim({
      missionId: mission.id,
      selectedKeys: secondManifest.chunks.map((chunk) => chunk.key),
    }, 'real-worker-claim-2')).resolves.toMatchObject({
      databaseReady: true,
      blockers: [],
    })

    await store.addPositionsBulk({
      mission_id: mission.id,
      positions: [{
        source_position_id: 'source-4',
        device_id: 'device-1',
        lat: 52.03,
        lon: -9.73,
        timestamp: '2026-08-24T09:07:00.000Z',
      }],
    })
    await expect(store.syncCoverageTileCatalog({
      missionId: mission.id,
      chunks: secondChunks,
    }, 'real-worker-stale-sync')).rejects.toThrow(/revision/i)
    const thirdManifest = await store.readCoverageManifest(mission.id, 'real-worker-manifest-3')
    await expect(store.syncCoverageTileCatalog({
      missionId: mission.id,
      chunks: thirdManifest.chunks.map((chunk) => ({
        key: chunk.key,
        contentRev: chunk.contentRev,
      })),
    }, 'real-worker-recovery-sync')).resolves.toMatchObject({
      delivered: expect.arrayContaining([
        expect.objectContaining({ contentRev: expect.any(Number) }),
      ]),
    })
  }, 20_000)

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

    const rendererControlledInput = {
      kind: 'enumerate',
      missionId: mission.id,
      key: manifest.chunks[0]!.key,
      expectedContentRev: manifest.chunks[0]!.contentRev,
    }
    await expect(store.readCoverageChunk(rendererControlledInput, 'chunk-owned-kind'))
      .resolves.toMatchObject({
        positions: [
          expect.objectContaining({ source_position_id: 'source-1' }),
          expect.objectContaining({ source_position_id: 'source-2' }),
        ],
      })

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

  it('adds ingest_outbox_pending at the production claim boundary while durable evidence awaits projection', async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'sartracker-coverage-store-'))
    store = createElectronMissionStore({
      userDataPath: directory,
      ingestEvidenceFaultInjection: { failProjection: true },
    })
    const mission = await seedMission(store)
    const manifest = await store.readCoverageManifest(mission.id, 'pending-outbox-manifest')

    await store.recordIngestRejections({
      mission_id: mission.id,
      rejections: [{
        deliveryId: 'pending-coverage-rejection',
        anomalyKey: 'source:rejected-1',
        deviceId: 'device-1',
        sourcePositionId: 'rejected-1',
        reasonClass: 'coordinate_out_of_range',
        receivedAt: '2026-08-24T09:06:00.000Z',
        canonicalEvidence: { source_position_id: 'rejected-1' },
      }],
    })

    await expect(store.readCoverageClaim({
      missionId: mission.id,
      selectedKeys: manifest.chunks.map((chunk) => chunk.key),
    }, 'pending-outbox-claim')).resolves.toMatchObject({
      databaseReady: false,
      blockers: expect.arrayContaining(['ingest_outbox_pending']),
    })
  })

  it('returns the newer direct claim when an accepted write lands after the worker snapshot', async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'sartracker-coverage-store-'))
    let injectAcceptedWrite = false
    store = createElectronMissionStore({
      userDataPath: directory,
      runCoverageQueryInWorker: async (input) => {
        const result = await runRealCoverageQueryInWorker(input)
        if (injectAcceptedWrite && input.query.kind === 'claim') {
          const database = new Database(input.databasePath)
          database.transaction(() => {
            database.prepare(`UPDATE coverage_chunks SET
              content_rev = content_rev + 1, built_rev = NULL
              WHERE mission_id = ?`).run(input.query.missionId)
            database.prepare(`UPDATE coverage_missions SET
              change_seq = change_seq + 1 WHERE mission_id = ?`)
              .run(input.query.missionId)
          })()
          database.close()
        }
        return result
      },
    })
    const mission = await seedMission(store)
    const manifest = await store.readCoverageManifest(mission.id, 'manifest-before-write')
    injectAcceptedWrite = true

    await expect(store.readCoverageClaim({
      missionId: mission.id,
      selectedKeys: manifest.chunks.map((chunk) => chunk.key),
    }, 'claim-with-concurrent-write')).resolves.toMatchObject({
      changeSeq: manifest.changeSeq + 1,
      databaseReady: false,
      blockers: expect.arrayContaining(['chunk_not_fresh']),
    })
  })

  it('rejects worker claim divergence at the current database sequence', async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'sartracker-coverage-store-'))
    let forgeCurrentClaim = false
    store = createElectronMissionStore({
      userDataPath: directory,
      runCoverageQueryInWorker: async (input) => {
        const result = await runRealCoverageQueryInWorker(input)
        return forgeCurrentClaim && input.query.kind === 'claim'
          ? { ...result, databaseReady: false, blockers: ['pending_invalidation'] }
          : result
      },
    })
    const mission = await seedMission(store)
    const manifest = await store.readCoverageManifest(mission.id, 'manifest-for-claim-forgery')
    forgeCurrentClaim = true

    await expect(store.readCoverageClaim({
      missionId: mission.id,
      selectedKeys: manifest.chunks.map((chunk) => chunk.key),
    }, 'forged-current-claim')).rejects.toThrow(/claim result diverged/iu)
  })

  it('never claims complete when canonical inventory appears without a ledger row', async () => {
    store = await createStore()
    const mission = await seedMission(store)
    await store.readCoverageManifest(mission.id, 'manifest-initial')
    const database = new Database(path.join(directory!, 'mission-store.sqlite'))
    database.prepare(`INSERT INTO outings (
      id, mission_id, label, started_at, ended_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      'outing-with-unbuilt-evidence',
      mission.id,
      'Unbuilt evidence outing',
      '2026-08-24T08:00:00.000Z',
      '2026-08-24T10:00:00.000Z',
      '2026-08-24T10:01:00.000Z',
      '2026-08-24T10:01:00.000Z',
    )
    database.close()

    const manifest = await store.readCoverageManifest(mission.id, 'manifest-new-inventory')
    const outingChunk = manifest.chunks.find((chunk) =>
      chunk.key.period_id === 'outing-with-unbuilt-evidence')
    expect(outingChunk).toMatchObject({
      builtRev: null,
      exactCount: 2,
    })
    await expect(store.readCoverageClaim({
      missionId: mission.id,
      selectedKeys: [outingChunk!.key],
    }, 'claim-new-inventory')).resolves.toMatchObject({
      databaseReady: false,
      blockers: expect.arrayContaining(['chunk_not_fresh']),
    })

    for (const chunk of manifest.chunks) {
      if (chunk.builtRev === chunk.contentRev) continue
      await store.readCoverageChunk({
        missionId: mission.id,
        key: chunk.key,
        expectedContentRev: chunk.contentRev,
      }, `build-${chunk.key.period_kind}`)
    }
    const rebuilt = await store.readCoverageManifest(mission.id, 'manifest-rebuilt-inventory')
    expect(rebuilt.chunks.map((chunk) => ({
      periodKind: chunk.key.period_kind,
      exactCount: chunk.exactCount,
      fresh: chunk.builtRev === chunk.contentRev,
    }))).toEqual([
      { periodKind: 'outing', exactCount: 2, fresh: true },
      { periodKind: 'unassigned', exactCount: 0, fresh: true },
    ])
    await expect(store.readCoverageClaim({
      missionId: mission.id,
      selectedKeys: rebuilt.chunks.map((chunk) => chunk.key),
    }, 'claim-rebuilt-inventory')).resolves.toMatchObject({
      databaseReady: true,
      blockers: [],
    })
  })

  it('rejects a current-sequence manifest that omits a real stale canonical chunk', async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'sartracker-coverage-store-'))
    let omitManifest = false
    store = createElectronMissionStore({
      userDataPath: directory,
      runCoverageQueryInWorker: async (input) => {
        if (omitManifest && input.query.kind === 'manifest') {
          const database = new Database(input.databasePath)
          const changeSeq = Number(database.prepare(`SELECT change_seq
            FROM coverage_missions WHERE mission_id = ?`)
            .get(input.query.missionId)?.change_seq ?? 0)
          database.close()
          return {
            changeSeq,
            enumerated: true,
            pendingInvalidation: false,
            backfillIncomplete: false,
            diagnostics: {
              queueDepth: 0,
              oldestQueuedAt: null,
              pendingChunkCount: 0,
              staleChunkCount: 0,
              freshChunkCount: 0,
              pendingInvalidationCount: 0,
            },
            outings: [],
            chunks: [],
          }
        }
        return runRealCoverageQueryInWorker(input)
      },
    })
    const mission = await seedMission(store)
    await store.readCoverageManifest(mission.id, 'manifest-fresh')
    await store.addPositionsBulk({
      mission_id: mission.id,
      positions: [{
        source_position_id: 'source-3',
        device_id: 'device-1',
        lat: 52.02,
        lon: -9.72,
        timestamp: '2026-08-24T09:10:00.000Z',
      }],
    })
    omitManifest = true

    await expect(store.readCoverageManifest(mission.id, 'manifest-omitted'))
      .rejects.toThrow(/coverage manifest.*inventory/iu)
    const database = new Database(path.join(directory, 'mission-store.sqlite'))
    expect(database.prepare(`SELECT content_rev, built_rev, fix_count
      FROM coverage_chunks WHERE mission_id = ?`).get(mission.id)).toEqual({
      content_rev: 2,
      built_rev: 1,
      fix_count: 2,
    })
    database.close()
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

  it('cannot drain a moved outing with an empty worker analysis and retain stale fresh counts', async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'sartracker-coverage-store-'))
    let injectEmptyInvalidationAnalysis = false
    const coverageQueryRunner = vi.fn((input: {
      readonly databasePath: string
      readonly query: Readonly<Record<string, unknown>>
      readonly signal?: AbortSignal
    }) => {
      if (
        injectEmptyInvalidationAnalysis &&
        input.query.kind === 'invalidation-analysis'
      ) {
        return Promise.resolve({
          invalidationId: input.query.invalidationId,
          affectedKeys: [],
        })
      }
      return runRealCoverageQueryInWorker(input)
    })
    store = createElectronMissionStore({
      userDataPath: directory,
      runCoverageQueryInWorker: coverageQueryRunner,
    })
    const mission = await seedMission(store)
    const outing = await store.createOuting({
      mission_id: mission.id,
      label: 'Outing 1',
      started_at: '2026-08-24T08:30:00.000Z',
    })
    await store.endOuting({
      mission_id: mission.id,
      outing_id: outing.id,
      ended_at: '2026-08-24T10:00:00.000Z',
    })
    let initial = await store.readCoverageManifest(mission.id, 'initial-outing')
    for (const chunk of initial.chunks) {
      if (chunk.builtRev === chunk.contentRev) continue
      await store.readCoverageChunk({
        missionId: mission.id,
        key: chunk.key,
        expectedContentRev: chunk.contentRev,
      }, `build-initial-${chunk.key.period_kind}`)
    }
    initial = await store.readCoverageManifest(mission.id, 'initial-outing-built')
    expect(initial.chunks.map((chunk) => ({
      kind: chunk.key.period_kind,
      exactCount: chunk.exactCount,
      fresh: chunk.builtRev === chunk.contentRev,
    }))).toEqual([
      { kind: 'outing', exactCount: 2, fresh: true },
      { kind: 'unassigned', exactCount: 0, fresh: true },
    ])
    const initialRevisionByKind = new Map(initial.chunks.map((chunk) => [
      chunk.key.period_kind,
      chunk.contentRev,
    ]))

    injectEmptyInvalidationAnalysis = true
    await store.editOutingBoundaries({
      mission_id: mission.id,
      outing_id: outing.id,
      started_at: '2026-08-24T09:03:00.000Z',
    })
    const moved = await store.readCoverageManifest(mission.id, 'moved-outing')
    expect(moved.chunks.map((chunk) => ({
      kind: chunk.key.period_kind,
      contentRev: chunk.contentRev,
      builtRev: chunk.builtRev,
      exactCount: chunk.exactCount,
    }))).toEqual([
      {
        kind: 'outing',
        contentRev: initialRevisionByKind.get('outing')! + 1,
        builtRev: initialRevisionByKind.get('outing'),
        exactCount: 1,
      },
      {
        kind: 'unassigned',
        contentRev: initialRevisionByKind.get('unassigned')! + 1,
        builtRev: initialRevisionByKind.get('unassigned'),
        exactCount: 1,
      },
    ])
    await expect(store.readCoverageClaim({
      missionId: mission.id,
      selectedKeys: moved.chunks.map((chunk) => chunk.key),
    }, 'moved-outing-claim')).resolves.toMatchObject({
      databaseReady: false,
      blockers: expect.arrayContaining(['chunk_not_fresh']),
    })
  })

  it('rejects forged or altered manifest outing metadata against current SQLite state', async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'sartracker-coverage-store-'))
    let mutation: 'forged' | 'altered' = 'forged'
    const coverageQueryRunner = vi.fn(async (input: {
      readonly databasePath: string
      readonly query: Readonly<Record<string, unknown>>
      readonly signal?: AbortSignal
      readonly resultLimits?: Readonly<Record<string, number>>
    }) => {
      const result = await runRealCoverageQueryInWorker(input)
      if (input.query.kind !== 'manifest') return result
      const outings = result.outings as readonly Readonly<Record<string, unknown>>[]
      return {
        ...result,
        outings: mutation === 'forged'
          ? [{
              id: 'forged-outing',
              label: 'Forged outing',
              started_at: '2026-08-24T07:00:00.000Z',
              ended_at: '2026-08-24T08:00:00.000Z',
            }]
          : outings.map((outing, index) => index === 0
              ? { ...outing, label: 'Altered by worker' }
              : outing),
      }
    })
    store = createElectronMissionStore({
      userDataPath: directory,
      runCoverageQueryInWorker: coverageQueryRunner,
    })
    const mission = await seedMission(store)
    await store.createOuting({
      mission_id: mission.id,
      label: 'Canonical outing',
      started_at: '2026-08-24T08:30:00.000Z',
    })

    await expect(store.readCoverageManifest(mission.id, 'forged-outing-manifest'))
      .rejects.toThrow(/manifest.*outing.*canonical metadata/iu)

    mutation = 'altered'
    await expect(store.readCoverageManifest(mission.id, 'altered-outing-manifest'))
      .rejects.toThrow(/manifest.*outing.*canonical metadata/iu)
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
      periods: coveragePeriodsFor(mission.id, chunk.key, chunk.contentRev),
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

  it('rejects forged tile-worker summaries before they can make a stale real chunk fresh', async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'sartracker-coverage-store-'))
    const discardCatalog = vi.fn().mockResolvedValue(true)
    const invalidateWorker = vi.fn().mockResolvedValue(undefined)
    const syncCatalog = vi.fn(async (input: {
      readonly missionId: string
      readonly chunks: readonly { readonly key: CoverageKey; readonly contentRev: number }[]
    }) => ({
      stageId: 'coverage-stage-00000000-0000-4000-8000-000000000021-1',
      periods: createCoverageTileCatalog(input).periods,
      delivered: input.chunks,
      builds: input.chunks.map((chunk) => ({
        ...chunk,
        fixCount: 0,
        fixDigest: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        minTs: null,
        maxTs: null,
      })),
    }))
    const tileRunner = {
      syncCatalog,
      commitCatalog: vi.fn().mockResolvedValue(true),
      finalizeCatalog: vi.fn().mockResolvedValue(true),
      discardCatalog,
      invalidateWorker,
      readTile: vi.fn().mockResolvedValue(new Uint8Array()),
      close: vi.fn().mockResolvedValue(undefined),
    }
    store = createElectronMissionStore({ userDataPath: directory, coverageTileRunner: tileRunner })
    const mission = await seedMission(store)
    const initial = await store.readCoverageManifest(mission.id, 'forged-build-initial')
    expect(initial.chunks[0]).toMatchObject({
      contentRev: 1, builtRev: 1, fixCount: 2, exactCount: 2,
    })
    await store.addPositionsBulk({
      mission_id: mission.id,
      positions: [{
        source_position_id: 'source-3', device_id: 'device-1', lat: 52.02, lon: -9.72,
        timestamp: '2026-08-24T09:10:00.000Z',
      }],
    })
    const stale = await store.readCoverageManifest(mission.id, 'forged-build-stale')
    const chunk = stale.chunks[0]!
    expect(chunk).toMatchObject({ contentRev: 2, builtRev: 1, fixCount: 2, exactCount: 3 })

    await expect(store.syncCoverageTileCatalog({
      missionId: mission.id,
      chunks: [{ key: chunk.key, contentRev: chunk.contentRev }],
    }, 'forged-build-sync')).rejects.toThrow(/build.*exact.*summary|summary.*diverged/i)

    expect(discardCatalog).toHaveBeenCalledWith({
      stageId: 'coverage-stage-00000000-0000-4000-8000-000000000021-1',
    })
    expect(invalidateWorker).toHaveBeenCalledOnce()
    await expect(store.readCoverageManifest(mission.id, 'forged-build-after')).resolves
      .toMatchObject({
        chunks: [expect.objectContaining({
          contentRev: 2, builtRev: 1, fixCount: 2, exactCount: 3,
        })],
      })
    await expect(store.readCoverageClaim({
      missionId: mission.id,
      selectedKeys: [chunk.key],
    }, 'forged-build-claim')).resolves.toMatchObject({
      databaseReady: false,
      blockers: expect.arrayContaining(['chunk_not_fresh']),
    })
  })

  it('bounds claim and catalog inputs to unique current canonical inventory', async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'sartracker-coverage-store-'))
    const syncCatalog = vi.fn()
    const tileRunner = {
      syncCatalog,
      commitCatalog: vi.fn().mockResolvedValue(true),
      finalizeCatalog: vi.fn().mockResolvedValue(true),
      discardCatalog: vi.fn().mockResolvedValue(true),
      readTile: vi.fn().mockResolvedValue(new Uint8Array()),
      close: vi.fn().mockResolvedValue(undefined),
    }
    store = createElectronMissionStore({ userDataPath: directory, coverageTileRunner: tileRunner })
    const mission = await seedMission(store)
    const manifest = await store.readCoverageManifest(mission.id, 'inventory-manifest')
    const chunk = manifest.chunks[0]!
    const unknownKey = { ...chunk.key, device_id: 'unknown-device' }

    await expect(store.readCoverageClaim({
      missionId: mission.id,
      selectedKeys: [chunk.key, chunk.key],
    }, 'duplicate-claim')).rejects.toThrow(/coverage.*current mission inventory/i)
    await expect(store.readCoverageClaim({
      missionId: mission.id,
      selectedKeys: [unknownKey],
    }, 'unknown-claim')).rejects.toThrow(/current.*inventory/i)
    await expect(store.syncCoverageTileCatalog({
      missionId: mission.id,
      chunks: [
        { key: chunk.key, contentRev: chunk.contentRev },
        { key: chunk.key, contentRev: chunk.contentRev },
      ],
    }, 'duplicate-catalog')).rejects.toThrow(/coverage.*current mission inventory/i)
    await expect(store.syncCoverageTileCatalog({
      missionId: mission.id,
      chunks: Array.from({ length: 20_000 }, () => ({
        key: chunk.key,
        contentRev: chunk.contentRev,
      })),
    }, 'oversized-catalog')).rejects.toThrow(/coverage.*current mission inventory/i)
    await expect(store.syncCoverageTileCatalog({
      missionId: mission.id,
      chunks: [{ key: chunk.key, contentRev: chunk.contentRev + 1 }],
    }, 'stale-catalog')).rejects.toThrow(/current.*revision/i)
    expect(syncCatalog).not.toHaveBeenCalled()

    syncCatalog.mockResolvedValue({
      stageId: 'coverage-stage-00000000-0000-4000-8000-000000000004-1',
      periods: coveragePeriodsFor(mission.id, chunk.key, chunk.contentRev),
      delivered: [{ key: chunk.key, contentRev: chunk.contentRev }],
      builds: [{
        key: chunk.key,
        contentRev: chunk.contentRev,
        fixCount: chunk.exactCount,
        fixDigest: chunk.exactDigest,
        minTs: '2026-08-24T09:00:00.000Z',
        maxTs: '2026-08-24T09:05:00.000Z',
      }],
    })
    await expect(store.syncCoverageTileCatalog({
      missionId: mission.id,
      chunks: [{
        type: 'close', requestId: 'renderer-owned',
        key: { ...chunk.key, extra: 'strip-me' },
        contentRev: chunk.contentRev,
      }],
      type: 'close',
      requestId: 'renderer-owned',
    } as never, 'valid-catalog')).resolves.toMatchObject({
      activationId: 'coverage-stage-00000000-0000-4000-8000-000000000004-1',
    })
    expect(syncCatalog).toHaveBeenCalledWith({
      missionId: mission.id,
      chunks: [{ key: chunk.key, contentRev: chunk.contentRev }],
    }, { signal: expect.any(AbortSignal) })
  })

  it('discards a staged catalog before applying divergent worker builds', async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'sartracker-coverage-store-'))
    const discardCatalog = vi.fn().mockResolvedValue(true)
    const syncCatalog = vi.fn()
    const tileRunner = {
      syncCatalog,
      commitCatalog: vi.fn().mockResolvedValue(true),
      finalizeCatalog: vi.fn().mockResolvedValue(true),
      discardCatalog,
      readTile: vi.fn().mockResolvedValue(new Uint8Array()),
      close: vi.fn().mockResolvedValue(undefined),
    }
    store = createElectronMissionStore({ userDataPath: directory, coverageTileRunner: tileRunner })
    const mission = await seedMission(store)
    const manifest = await store.readCoverageManifest(mission.id, 'result-manifest')
    const chunk = manifest.chunks[0]!
    const build = {
      key: chunk.key,
      contentRev: chunk.contentRev,
      fixCount: 2,
      fixDigest: chunk.exactDigest,
      minTs: chunk.exactMinTs,
      maxTs: chunk.exactMaxTs,
    }
    syncCatalog.mockResolvedValue({
      stageId: 'coverage-stage-00000000-0000-4000-8000-000000000005-1',
      periods: coveragePeriodsFor(mission.id, chunk.key, chunk.contentRev),
      delivered: [{ key: chunk.key, contentRev: chunk.contentRev }],
      builds: [build, build],
    })

    await expect(store.syncCoverageTileCatalog({
      missionId: mission.id,
      chunks: [{ key: chunk.key, contentRev: chunk.contentRev }],
    }, 'divergent-result')).rejects.toThrow(/catalog worker result/i)
    expect(discardCatalog).toHaveBeenCalledWith({
      stageId: 'coverage-stage-00000000-0000-4000-8000-000000000005-1',
    })
  })

  it('rejects renderer tile coordinates and strips control fields before the worker boundary', async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'sartracker-coverage-store-'))
    const readTile = vi.fn().mockResolvedValue(new Uint8Array([1]))
    const tileRunner = {
      syncCatalog: vi.fn(),
      commitCatalog: vi.fn(),
      discardCatalog: vi.fn(),
      readTile,
      close: vi.fn().mockResolvedValue(undefined),
    }
    store = createElectronMissionStore({ userDataPath: directory, coverageTileRunner: tileRunner })

    await expect(store.readCoverageTile({
      requestId: 19,
      type: 'close',
      missionId: 'mission-1',
      periodKey: 'outing\u0000outing-1',
      revisionDigest: 'revision-1',
      z: 0,
      x: '0/../../../../../escaped',
      y: 0,
    })).rejects.toThrow(/tile coordinate/i)
    expect(readTile).not.toHaveBeenCalled()

    await expect(store.readCoverageTile({
      requestId: 19,
      type: 'close',
      missionId: 'mission-1',
      periodKey: 'outing\u0000outing-1',
      revisionDigest: 'revision-1',
      z: 0,
      x: 0,
      y: 0,
    })).resolves.toEqual(new Uint8Array([1]))
    expect(readTile).toHaveBeenCalledWith({
      missionId: 'mission-1',
      periodKey: 'outing\u0000outing-1',
      revisionDigest: 'revision-1',
      z: 0,
      x: 0,
      y: 0,
    }, { signal: expect.any(AbortSignal) })
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
        periods: coveragePeriodsFor(mission.id, chunk.key, chunk.contentRev),
        delivered: [{ key: chunk.key, contentRev: chunk.contentRev }],
        builds: [{
          key: chunk.key, contentRev: chunk.contentRev, fixCount: 2,
          fixDigest: chunk.exactDigest,
          minTs: '2026-08-24T09:00:00.000Z',
          maxTs: '2026-08-24T09:05:00.000Z',
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
    }, {
      signal: expect.any(AbortSignal),
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

  it('forwards cancellation to the tile runner before a replacement catalog starts', async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'sartracker-coverage-store-'))
    const syncCatalog = vi.fn((input: unknown, options: { readonly signal: AbortSignal }) =>
      new Promise<{
        stageId: string
        periods: readonly unknown[]
        delivered: readonly unknown[]
        builds: readonly unknown[]
      }>((resolve, reject) => {
        if (syncCatalog.mock.calls.length > 1) {
          resolve({
            stageId: 'coverage-stage-00000000-0000-4000-8000-000000000006-1',
            periods: [], delivered: [], builds: [],
          })
          return
        }
        options.signal.addEventListener('abort', () => {
          const error = new Error('cancelled by mission store')
          error.name = 'AbortError'
          reject(error)
        }, { once: true })
      }))
    const tileRunner = {
      syncCatalog,
      commitCatalog: vi.fn().mockResolvedValue(true),
      discardCatalog: vi.fn().mockResolvedValue(true),
      readTile: vi.fn().mockResolvedValue(new Uint8Array([1])),
      close: vi.fn().mockResolvedValue(undefined),
    }
    store = createElectronMissionStore({ userDataPath: directory, coverageTileRunner: tileRunner })
    const mission = await seedMission(store)
    const first = store.syncCoverageTileCatalog({ missionId: mission.id, chunks: [] }, 'first')
    await vi.waitFor(() => expect(syncCatalog).toHaveBeenCalledTimes(1))

    await expect(store.cancelCoverageQuery('first')).resolves.toBe(true)
    await expect(first).rejects.toMatchObject({ name: 'AbortError' })
    await expect(store.syncCoverageTileCatalog({
      missionId: mission.id,
      chunks: [],
    }, 'replacement')).resolves.toMatchObject({
      activationId: 'coverage-stage-00000000-0000-4000-8000-000000000006-1',
    })
    expect(syncCatalog).toHaveBeenCalledTimes(2)
  })

  it('cancels one obsolete tile read without terminating the shared renderer worker', async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'sartracker-coverage-store-'))
    const readTile = vi.fn((_input: unknown, options: { readonly signal?: AbortSignal }) =>
      new Promise<Uint8Array>((_resolve, reject) => {
        options.signal?.addEventListener('abort', () => {
          const error = new Error('tile read cancelled')
          error.name = 'AbortError'
          reject(error)
        }, { once: true })
      }))
    const tileRunner = {
      syncCatalog: vi.fn(),
      commitCatalog: vi.fn(),
      discardCatalog: vi.fn(),
      readTile,
      close: vi.fn().mockResolvedValue(undefined),
    }
    store = createElectronMissionStore({ userDataPath: directory, coverageTileRunner: tileRunner })
    const request = store.readCoverageTile({
      missionId: 'mission-1', periodKey: 'outing\u0000outing-1',
      revisionDigest: 'revision-1', z: 8, x: 1, y: 1,
    }, 'tile-read-1')
    await vi.waitFor(() => expect(readTile).toHaveBeenCalledOnce())

    await expect(store.cancelCoverageTileRead('tile-read-1')).resolves.toBe(true)
    await expect(request).rejects.toMatchObject({ name: 'AbortError' })
    await expect(store.cancelCoverageTileRead('tile-read-1')).resolves.toBe(false)
    expect(readTile).toHaveBeenCalledWith(expect.any(Object), {
      signal: expect.any(AbortSignal),
    })
    expect(tileRunner.close).not.toHaveBeenCalled()
  })
})

async function createStore(): Promise<CoverageMissionStore> {
  directory = await mkdtemp(path.join(tmpdir(), 'sartracker-coverage-store-'))
  return createElectronMissionStore({ userDataPath: directory })
}

function coveragePeriodsFor(
  missionId: string,
  key: CoverageKey,
  contentRev: number,
): ReturnType<typeof createCoverageTileCatalog>['periods'] {
  return createCoverageTileCatalog({
    missionId,
    chunks: [{ key, contentRev }],
  }).periods
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
