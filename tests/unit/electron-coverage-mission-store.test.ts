import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { createElectronMissionStore } = require('../../electron/mission-store.cjs') as {
  readonly createElectronMissionStore: (options: {
    readonly userDataPath: string
    readonly onCoverageChanged?: (missionId: string, changeSeq: number) => void
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
  readonly readCoverageManifest: (missionId: string, requestId?: string) => Promise<{
    readonly changeSeq: number
    readonly enumerated: boolean
    readonly pendingInvalidation: boolean
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
