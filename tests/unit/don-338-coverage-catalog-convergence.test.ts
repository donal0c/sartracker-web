import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

import { afterEach, describe, expect, it, vi } from 'vitest'

import type {
  CoverageChunkKey,
  CoverageManifest,
  CoverageReadResult,
  CoverageTileCatalog,
} from '../../src/infrastructure/mission-store/tauri-mission-store'
import {
  createCoverageController,
  type CoverageController,
  type CoverageState,
} from '../../src/features/tracking/coverage-controller'
import { coverageChunkIdentity } from '../../src/features/tracking/coverage-identity'
import { summarizeCoverageStatus } from '../../src/features/tracking/coverage-progress'

const require = createRequire(import.meta.url)

type CoverageKey = {
  readonly device_id: string
  readonly period_kind: 'outing' | 'unassigned'
  readonly period_id: string
}

type ChunkRevision = { readonly key: CoverageKey; readonly contentRev: number }

type StalePayload = { readonly kind: 'stale'; readonly reason: string; readonly changeSeq: number }

type CatalogPayload = {
  readonly activationId: string
  readonly delivered: readonly ChunkRevision[]
  readonly moved?: readonly ChunkRevision[]
}

type FixInput = {
  readonly source_position_id: string
  readonly device_id: string
  readonly lat: number
  readonly lon: number
  readonly timestamp: string
  readonly timestamp_source: 'fix'
}

type ConvergenceStore = {
  readonly close: () => void
  readonly createMission: (input: { readonly name: string; readonly start_time: string }) => Promise<{ readonly id: string }>
  readonly upsertDevice: (input: {
    readonly mission_id: string
    readonly device_id: string
    readonly name: string
    readonly color: string
    readonly status: string
  }) => Promise<unknown>
  readonly addPositionsBulk: (input: { readonly mission_id: string; readonly positions: readonly FixInput[] }) => Promise<unknown>
  readonly createOuting: (input: { readonly mission_id: string; readonly label: string; readonly started_at: string }) => Promise<{ readonly id: string }>
  readonly endOuting: (input: { readonly mission_id: string; readonly outing_id: string; readonly ended_at: string }) => Promise<unknown>
  readonly readCoverageManifest: (missionId: string, requestId?: string) => Promise<{
    readonly changeSeq: number
    readonly chunks: readonly ChunkRevision[]
  }>
  readonly syncCoverageTileCatalog: (
    input: { readonly missionId: string; readonly chunks: readonly ChunkRevision[] },
    requestId?: string,
  ) => Promise<CatalogPayload | StalePayload>
  readonly activateCoverageTileCatalog: (input: { readonly activationId: string }) => Promise<boolean>
  readonly finalizeCoverageTileCatalog: (input: { readonly activationId: string }) => Promise<boolean>
}

const { createElectronMissionStore } = require('../../electron/mission-store.cjs') as {
  readonly createElectronMissionStore: (options: {
    readonly userDataPath: string
    readonly onCoverageChanged?: (missionId: string, changeSeq: number) => void
  }) => ConvergenceStore
}

const DEVICES = ['device-a', 'device-b', 'device-c', 'device-d', 'device-e', 'device-f']
const MISSION_START = Date.parse('2026-08-24T08:00:00.000Z')
const CLOSED_START = MISSION_START + 30 * 60_000
const OPEN_START = CLOSED_START + 2 * 60 * 60_000

let directory: string | undefined
let store: ConvergenceStore | undefined

afterEach(async () => {
  vi.useRealTimers()
  store?.close()
  store = undefined
  if (directory !== undefined) await rm(directory, { recursive: true, force: true })
  directory = undefined
})

/** Builds one device's fix at `index` seconds-steps after `startMs`. */
function fixAt(deviceId: string, startMs: number, index: number, stepMs: number, tag: string): FixInput {
  const deviceIndex = DEVICES.indexOf(deviceId)
  return {
    source_position_id: `${tag}-${deviceId}-${index}`,
    device_id: deviceId,
    lat: 52 + deviceIndex * 0.01 + index * 0.00001,
    lon: -9.7 + Math.sin(index / 50) * 0.002,
    timestamp: new Date(startMs + index * stepMs).toISOString(),
    timestamp_source: 'fix',
  }
}

/** Seeds a mission with one closed and one open outing for every device. */
async function seedBusyMission(coverageStore: ConvergenceStore, openFixesPerDevice: number): Promise<{
  readonly missionId: string
  readonly openOutingId: string
  nextLiveIndex: number
}> {
  const mission = await coverageStore.createMission({
    name: 'Convergence mission',
    start_time: new Date(MISSION_START).toISOString(),
  })
  for (const deviceId of DEVICES) {
    await coverageStore.upsertDevice({ mission_id: mission.id, device_id: deviceId, name: deviceId, color: '#fff', status: 'online' })
  }
  const closedCount = Number(process.env.COV2_CLOSED_OUTINGS ?? 1)
  const closedSpanMs = Math.floor((OPEN_START - CLOSED_START) / closedCount)
  const closedFixesPerOuting = Math.floor(1_000 / closedCount)
  for (let outing = 0; outing < closedCount; outing += 1) {
    const startMs = CLOSED_START + outing * closedSpanMs
    const closed = await coverageStore.createOuting({ mission_id: mission.id, label: `Closed ${outing}`, started_at: new Date(startMs).toISOString() })
    await coverageStore.endOuting({ mission_id: mission.id, outing_id: closed.id, ended_at: new Date(startMs + closedSpanMs - 60_000).toISOString() })
    for (const deviceId of DEVICES) {
      const fixes = Array.from({ length: closedFixesPerOuting }, (_, index) =>
        fixAt(deviceId, startMs + 1_000, index, Math.floor((closedSpanMs - 120_000) / closedFixesPerOuting), `closed-${outing}`))
      for (let offset = 0; offset < fixes.length; offset += 256) {
        await coverageStore.addPositionsBulk({ mission_id: mission.id, positions: fixes.slice(offset, offset + 256) })
      }
    }
  }
  const open = await coverageStore.createOuting({ mission_id: mission.id, label: 'Open', started_at: new Date(OPEN_START).toISOString() })
  for (const deviceId of DEVICES) {
    const openFixes = Array.from({ length: openFixesPerDevice }, (_, index) => fixAt(deviceId, OPEN_START + 1_000, index, 5_000, 'open'))
    for (let offset = 0; offset < openFixes.length; offset += 256) {
      await coverageStore.addPositionsBulk({ mission_id: mission.id, positions: openFixes.slice(offset, offset + 256) })
    }
  }
  return { missionId: mission.id, openOutingId: open.id, nextLiveIndex: openFixesPerDevice }
}

function isStale(result: CatalogPayload | StalePayload): result is StalePayload {
  return 'kind' in result && result.kind === 'stale'
}

describe('DON-338 COV-2 coverage catalog convergence under live ingest (real store and worker)', () => {
  it.runIf(process.env.COV2_PROBE !== undefined)('PROBE: measures the catalog window and convergence at a live poll cadence', async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'sartracker-coverage-convergence-'))
    store = createElectronMissionStore({ userDataPath: directory })
    const openFixes = Number(process.env.COV2_OPEN_FIXES ?? 2_000)
    const pollMs = Number(process.env.COV2_POLL_MS ?? 5_000)
    const retryMs = Number(process.env.COV2_RETRY_MS ?? 30_000)
    const durationMs = Number(process.env.COV2_DURATION_MS ?? 60_000)
    const seeded = await seedBusyMission(store, openFixes)
    const liveStore = store

    // Cold first build, then one warm rebuild, with no concurrent ingest.
    const windows: number[] = []
    for (let round = 0; round < 3; round += 1) {
      const started = performance.now()
      const manifest = await liveStore.readCoverageManifest(seeded.missionId, `probe-manifest-${round}`)
      const result = await liveStore.syncCoverageTileCatalog({ missionId: seeded.missionId, chunks: manifest.chunks }, `probe-sync-${round}`)
      windows.push(performance.now() - started)
      expect(isStale(result)).toBe(false)
      if (!isStale(result)) {
        await liveStore.activateCoverageTileCatalog({ activationId: result.activationId })
        await liveStore.finalizeCoverageTileCatalog({ activationId: result.activationId })
      }
      const fixes = DEVICES.map((deviceId) => fixAt(deviceId, OPEN_START + 1_000, seeded.nextLiveIndex, 5_000, 'live'))
      seeded.nextLiveIndex += 1
      await liveStore.addPositionsBulk({ mission_id: seeded.missionId, positions: fixes })
    }

    // Live ingest: one fix per device per poll, all in one write, as the poller does.
    let polls = 0
    const ingest = setInterval(() => {
      const fixes = DEVICES.map((deviceId) => fixAt(deviceId, OPEN_START + 1_000, seeded.nextLiveIndex, 5_000, 'live'))
      seeded.nextLiveIndex += 1
      polls += 1
      void liveStore.addPositionsBulk({ mission_id: seeded.missionId, positions: fixes })
    }, pollMs)
    const attempts: { readonly outcome: 'stale' | 'drawn'; readonly windowMs: number }[] = []
    const started = performance.now()
    try {
      while (performance.now() - started < durationMs) {
        const attemptStarted = performance.now()
        const manifest = await liveStore.readCoverageManifest(seeded.missionId, `live-manifest-${attempts.length}`)
        const result = await liveStore.syncCoverageTileCatalog({ missionId: seeded.missionId, chunks: manifest.chunks }, `live-sync-${attempts.length}`)
        const windowMs = performance.now() - attemptStarted
        if (isStale(result)) {
          attempts.push({ outcome: 'stale', windowMs })
        } else {
          attempts.push({ outcome: 'drawn', windowMs })
          await liveStore.activateCoverageTileCatalog({ activationId: result.activationId })
          await liveStore.finalizeCoverageTileCatalog({ activationId: result.activationId })
        }
        await new Promise((resolve) => setTimeout(resolve, retryMs))
      }
    } finally {
      clearInterval(ingest)
    }
    const report = JSON.stringify({
      openFixesPerDevice: openFixes,
      devices: DEVICES.length,
      pollMs,
      retryMs,
      quietWindowsMs: windows.map((value) => Math.round(value)),
      polls,
      attempts: attempts.map((attempt) => `${attempt.outcome}:${Math.round(attempt.windowMs)}`),
      drawn: attempts.filter((attempt) => attempt.outcome === 'drawn').length,
      stale: attempts.filter((attempt) => attempt.outcome === 'stale').length,
    })
    console.log(`COV2 ${report}`)
  }, 600_000)
  it('serves the rest of a cumulative catalog when the open outing moves between batches, and names the moved chunks', async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'sartracker-coverage-convergence-batches-'))
    store = createElectronMissionStore({ userDataPath: directory })
    const liveStore = store
    const seeded = await seedBusyMission(liveStore, 500)
    /** One poll: a fix for every device in one write, as the poller persists them. */
    const poll = async (): Promise<void> => {
      const fixes = DEVICES.map((deviceId) => fixAt(deviceId, OPEN_START + 1_000, seeded.nextLiveIndex, 5_000, 'live'))
      seeded.nextLiveIndex += 1
      await liveStore.addPositionsBulk({ mission_id: seeded.missionId, positions: fixes })
    }
    /** Requests one catalog and, when served, activates and finalizes it as the map would. */
    const deliver = async (label: string, chunks: readonly ChunkRevision[]) => {
      const result = await liveStore.syncCoverageTileCatalog({ missionId: seeded.missionId, chunks }, label)
      if (!isStale(result)) {
        await expect(liveStore.activateCoverageTileCatalog({ activationId: result.activationId })).resolves.toBe(true)
        await expect(liveStore.finalizeCoverageTileCatalog({ activationId: result.activationId })).resolves.toBe(true)
      }
      return result
    }

    // The renderer reads revisions once per load and sends one cumulative catalog per period.
    const manifest = await liveStore.readCoverageManifest(seeded.missionId, 'load-manifest')
    const openChunks = manifest.chunks.filter((chunk) => chunk.key.period_id === seeded.openOutingId)
    expect(openChunks).toHaveLength(DEVICES.length)
    const first = await deliver('batch-1', manifest.chunks)
    expect(isStale(first)).toBe(false)

    // The poller writes while the map is loading the first batch.
    await poll()
    const second = await deliver('batch-2', manifest.chunks)

    // The closed outings are still served; the open outing is served at the revision the
    // map already draws and is named as moved, never claimed as current.
    expect(second).not.toMatchObject({ kind: 'stale' })
    if (isStale(second)) return
    const moved = new Map((second.moved ?? []).map((entry) => [coverageChunkIdentity(entry.key), entry.contentRev]))
    expect(moved.size).toBe(DEVICES.length)
    for (const chunk of openChunks) expect(moved.get(coverageChunkIdentity(chunk.key))).toBe(chunk.contentRev)
    const delivered = new Map(second.delivered.map((entry) => [coverageChunkIdentity(entry.key), entry.contentRev]))
    for (const chunk of manifest.chunks) expect(delivered.get(coverageChunkIdentity(chunk.key))).toBe(chunk.contentRev)
    const current = await liveStore.readCoverageManifest(seeded.missionId, 'after-move')
    for (const chunk of current.chunks) {
      if (chunk.key.period_id === seeded.openOutingId) {
        expect(chunk.contentRev).toBeGreaterThan(delivered.get(coverageChunkIdentity(chunk.key)) ?? Number.POSITIVE_INFINITY)
      } else {
        expect(moved.has(coverageChunkIdentity(chunk.key))).toBe(false)
      }
    }

    // The next load rereads revisions and draws the open outing at its new revision.
    const next = await deliver('next-load', current.chunks)
    expect(next).not.toMatchObject({ kind: 'stale' })
    if (!isStale(next)) expect(next.moved ?? []).toEqual([])
  }, 60_000)

  it.runIf(process.env.COV2_E2E !== undefined)('PROBE: real controller and store converge the open outing at a live poll cadence', async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'sartracker-coverage-convergence-e2e-'))
    // Change notifications carry the sequence, as in the app; nothing else reads the manifest.
    let notifyChanged: (missionId: string, changeSeq: number) => void = () => undefined
    store = createElectronMissionStore({
      userDataPath: directory,
      onCoverageChanged: (missionId, changeSeq) => notifyChanged(missionId, changeSeq),
    })
    const liveStore = store
    const openFixes = Number(process.env.COV2_OPEN_FIXES ?? 2_000)
    const pollMs = Number(process.env.COV2_POLL_MS ?? 5_000)
    const rendererMs = Number(process.env.COV2_RENDERER_MS ?? 1_000)
    const durationMs = Number(process.env.COV2_DURATION_MS ?? 180_000)
    const seeded = await seedBusyMission(liveStore, openFixes)
    let catalogCalls = 0
    let staleCatalogs = 0
    const errors: string[] = []
    let controller: CoverageController | null = null
    const acknowledged = new Set<string>()
    controller = createCoverageController({
      readManifest: async (missionId, requestId) =>
        await liveStore.readCoverageManifest(missionId, requestId) as unknown as CoverageManifest,
      readChunk: async () => { throw new Error('not used') },
      readClaim: async (query) => {
        const manifest = await liveStore.readCoverageManifest(query.missionId)
        return { changeSeq: manifest.changeSeq, databaseReady: true, blockers: [], chunkRevisions: manifest.chunks }
      },
      applyChunk: async () => undefined,
      deliverSelection: async ({ missionId, chunks, requestId }) => {
        catalogCalls += 1
        const result = await liveStore.syncCoverageTileCatalog({
          missionId,
          chunks: chunks.map((chunk) => ({ key: chunk.key, contentRev: chunk.contentRev })),
        }, requestId).catch((error: unknown) => {
          errors.push(error instanceof Error ? error.message : String(error))
          throw error
        })
        if (isStale(result)) staleCatalogs += 1
        return result as unknown as CoverageReadResult<CoverageTileCatalog>
      },
      activateCatalog: async (catalog) => {
        if (catalog.activationId !== undefined) await liveStore.activateCoverageTileCatalog({ activationId: catalog.activationId })
      },
      finalizeCatalog: async (catalog) => {
        if (catalog.activationId !== undefined) await liveStore.finalizeCoverageTileCatalog({ activationId: catalog.activationId })
      },
      publish: (state: CoverageState) => {
        if (state.status !== 'loading' || state.tileCatalog === null) return
        const catalog = state.tileCatalog
        const id = catalog.activationId ?? ''
        if (acknowledged.has(id)) return
        acknowledged.add(id)
        // The map takes `rendererMs` to load the new tiles before it accepts them.
        setTimeout(() => { void controller?.notifyCatalogApplied(catalog).catch(() => undefined) }, rendererMs)
      },
    })
    notifyChanged = (missionId, changeSeq) => { void controller?.notifyChanged(missionId, changeSeq) }
    const started = performance.now()
    const samples: string[] = []
    let firstOpenDrawnAtMs: number | null = null
    const ingest = setInterval(() => {
      const fixes = DEVICES.map((deviceId) => fixAt(deviceId, OPEN_START + 1_000, seeded.nextLiveIndex, 5_000, 'live'))
      seeded.nextLiveIndex += 1
      void liveStore.addPositionsBulk({ mission_id: seeded.missionId, positions: fixes })
    }, pollMs)
    const sampler = setInterval(() => {
      const state = controller?.getState()
      if (state === undefined || state.status === 'inactive' || state.manifest === null) return
      const openChunks = state.manifest.chunks.filter((chunk) => chunk.key.period_id === seeded.openOutingId)
      const openDrawn = openChunks.filter((chunk) => state.delivered[coverageChunkIdentity(chunk.key)] !== undefined).length
      const allDrawn = state.manifest.chunks.filter((chunk) => state.delivered[coverageChunkIdentity(chunk.key)] !== undefined).length
      const openCurrent = openChunks.filter((chunk) => state.delivered[coverageChunkIdentity(chunk.key)] === chunk.contentRev).length
      if (firstOpenDrawnAtMs === null && openDrawn === openChunks.length && openChunks.length > 0) {
        firstOpenDrawnAtMs = performance.now() - started
      }
      samples.push(`${Math.round((performance.now() - started) / 1000)}s:${state.status}:open ${openDrawn}/${openChunks.length} current ${openCurrent}:all ${allDrawn}/${state.manifest.chunks.length}:stale ${state.retryableStaleCount ?? 0}${state.status === 'error' ? `:${state.lastErrorClass ?? ''}:${state.message ?? ''}` : ''}`)
    }, 5_000)
    try {
      await controller.updateContext({ missionId: seeded.missionId, rendererGeneration: 'probe' })
      await new Promise((resolve) => setTimeout(resolve, durationMs))
    } finally {
      clearInterval(ingest)
      clearInterval(sampler)
      controller.stop()
      // Let in-flight polls and catalog requests settle before the store closes.
      await new Promise((resolve) => setTimeout(resolve, 3_000))
    }
    console.log(`COV2E2E ${JSON.stringify({
      openFixesPerDevice: openFixes,
      closedOutings: Number(process.env.COV2_CLOSED_OUTINGS ?? 1),
      pollMs,
      rendererMs,
      catalogCalls,
      staleCatalogs,
      firstOpenDrawnAtMs: firstOpenDrawnAtMs === null ? null : Math.round(firstOpenDrawnAtMs),
      errors,
      samples,
    })}`)
  }, 900_000)
})

describe('DON-338 COV-2 renderer consumes a catalog with moved chunks', () => {
  const OPEN_KEY: CoverageChunkKey = { device_id: 'device-a', period_kind: 'outing', period_id: 'outing-open' }
  const CLOSED_KEY: CoverageChunkKey = { device_id: 'device-a', period_kind: 'outing', period_id: 'outing-closed' }

  /** A mission with one closed and one open outing; the open one is at `openRev`. */
  function manifestAt(openRev: number): CoverageManifest {
    return {
      changeSeq: openRev + 1,
      enumerated: true,
      pendingInvalidation: false,
      backfillIncomplete: false,
      outings: [
        { id: 'outing-closed', label: 'Closed', started_at: '2026-11-07T08:00:00.000Z', ended_at: '2026-11-07T09:00:00.000Z' },
        { id: 'outing-open', label: 'Open', started_at: '2026-11-07T09:00:00.000Z', ended_at: null },
      ],
      chunks: [
        { key: CLOSED_KEY, contentRev: 1, builtRev: 1, fixCount: 400, exactCount: 400, fixDigest: 'closed' },
        { key: OPEN_KEY, contentRev: openRev, builtRev: null, fixCount: null, exactCount: 100 + openRev, fixDigest: null },
      ],
    } as unknown as CoverageManifest
  }

  it('draws the closed outing, reads the moved open outing as catching up, and retries it without the operator', async () => {
    vi.useFakeTimers()
    let openRev = 1
    let moveDuringBuild = true
    let stage = 0
    let controller: CoverageController | null = null
    const acknowledged = new Set<string>()
    const deliverSelection = vi.fn(async (request: {
      readonly chunks: readonly { readonly key: CoverageChunkKey; readonly contentRev: number }[]
    }): Promise<CoverageReadResult<CoverageTileCatalog>> => {
      stage += 1
      const delivered = request.chunks.map((chunk) => ({ key: chunk.key, contentRev: chunk.contentRev }))
      // The person keeps moving while the first catalog is built.
      if (moveDuringBuild) openRev += 1
      return {
        missionId: 'mission-1',
        activationId: `stage-${stage}`,
        periods: request.chunks.map((chunk) => ({ periodKey: `outing\u0000${chunk.key.period_id}`, revisionDigest: `rev-${chunk.contentRev}` })),
        delivered,
        moved: delivered.filter((entry) => entry.key.period_id === 'outing-open' && entry.contentRev !== openRev),
      }
    })
    controller = createCoverageController({
      monotonicNow: () => Date.now(),
      readManifest: vi.fn(async () => manifestAt(openRev)),
      readChunk: vi.fn(async () => { throw new Error('not used') }),
      readClaim: vi.fn(async () => ({
        changeSeq: openRev + 1,
        databaseReady: true,
        blockers: [],
        chunkRevisions: [{ key: CLOSED_KEY, contentRev: 1 }, { key: OPEN_KEY, contentRev: openRev }],
      })),
      applyChunk: vi.fn(async () => undefined),
      deliverSelection,
      publish: (state) => {
        if (state.status !== 'loading' || state.tileCatalog === null) return
        const catalog = state.tileCatalog
        const id = catalog.activationId ?? ''
        if (acknowledged.has(id)) return
        acknowledged.add(id)
        queueMicrotask(() => { void controller?.notifyCatalogApplied(catalog).catch(() => undefined) })
      },
    })

    await controller.updateContext({ missionId: 'mission-1', rendererGeneration: 'r1' })
    await vi.advanceTimersByTimeAsync(0)
    const behind = controller.getState()
    if (behind.status === 'inactive') throw new Error('Coverage unexpectedly inactive.')
    expect(behind.status).toBe('partial')
    expect(behind.lastErrorClass ?? null).toBeNull()
    expect(behind.delivered[coverageChunkIdentity(CLOSED_KEY)]).toBe(1)
    expect(behind.updating).toBe(true)
    expect(summarizeCoverageStatus(behind)).toMatchObject({ kind: 'catching_up', needsAttention: false })

    moveDuringBuild = false
    await vi.advanceTimersByTimeAsync(30_000)
    const caughtUp = controller.getState()
    if (caughtUp.status === 'inactive') throw new Error('Coverage unexpectedly inactive.')
    expect(caughtUp.status).toBe('complete')
    expect(caughtUp.delivered[coverageChunkIdentity(OPEN_KEY)]).toBe(openRev)
    expect(summarizeCoverageStatus(caughtUp).kind).toBe('up_to_date')
    controller.stop()
  })
})
