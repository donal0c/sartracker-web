import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createRejectedPositionAnomalyKey,
  createRejectedPositionDeliveryId,
  createRejectedPositionEvidence,
} from '../../src/features/tracking/rejected-position-evidence'

const require = createRequire(import.meta.url)

type Health = { readonly state: string; readonly reason: string | null }
type Store = {
  readonly createMission: (input: { readonly name: string }) => Promise<{ readonly id: string }>
  readonly finishMission: (missionId: string) => Promise<unknown>
  readonly finalizeMission: (missionId: string) => Promise<unknown>
  readonly setRendererEvidencePending: (input: { readonly mission_id: string; readonly pending: boolean }) => Promise<void>
  readonly establishRendererEvidenceProtocol: () => Promise<void>
  readonly clearRendererEvidencePending: (input?: { readonly mission_ids: readonly string[] }) => Promise<void>
  readonly getIngestEvidenceHealth: (missionId: string) => Promise<Health>
  readonly listMissionIdsAwaitingEvidenceClosure: () => Promise<readonly string[]>
  readonly recordIngestRejections: (input: {
    readonly mission_id: string
    readonly rejections: readonly Readonly<Record<string, unknown>>[]
  }) => Promise<{ readonly acknowledgedDeliveryIds: readonly string[] }>
  readonly listIngestAnomalies: (missionId: string) => Promise<readonly unknown[]>
  readonly prepareClose: () => Promise<void>
  readonly close: () => void
}
const { createElectronMissionStore } = require('../../electron/mission-store.cjs') as {
  readonly createElectronMissionStore: (options: { readonly userDataPath: string }) => Store
}
const {
  RENDERER_TEARDOWN_READY_CHANNEL,
  createRendererTeardownCoordinator,
} = require('../../electron/renderer-teardown-coordinator.cjs') as {
  readonly RENDERER_TEARDOWN_READY_CHANNEL: string
  readonly createRendererTeardownCoordinator: (dependencies: {
    readonly ipcMain: unknown
    readonly missionStore: Store
    readonly createRequestId: () => string
    readonly setTimeout: (listener: () => void, delayMs: number) => unknown
    readonly clearTimeout: (timer: unknown) => void
    readonly timeoutMs: number
  }) => {
    readonly prepare: (window: unknown, reason: string) => Promise<unknown>
    readonly markRendererUnavailable: () => Promise<unknown>
    readonly dispose: () => void
  }
}

/**
 * Eamonn's 13.5 report (DON-318): a mission with no rejected-position evidence
 * ever pending showed "EVIDENCE HEALTH CRITICAL" after the app ended
 * unexpectedly, blocking Finish and Archive. These tests join the real mission
 * store, outbox files and teardown coordinator.
 */
describe('renderer pending-evidence marker at the real persistence boundary [DON-318]', () => {
  let userDataPath: string | null = null
  let store: Store | null = null

  afterEach(async () => {
    await store?.prepareClose()
    store?.close()
    store = null
    if (userDataPath !== null) await rm(userDataPath, { recursive: true, force: true })
    userDataPath = null
  })

  /** Opens the store as a 13.6 session would after its renderer loaded (protocol running). */
  async function openStore(options: { readonly protocol?: boolean } = {}): Promise<Store> {
    userDataPath ??= await mkdtemp(path.join(tmpdir(), 'sartracker-pending-marker-'))
    store = createElectronMissionStore({ userDataPath })
    if (options.protocol !== false) await store.establishRendererEvidenceProtocol()
    return store
  }

  /** Startup after an unclean end, a crashed renderer and a fatal main error all take this path. */
  async function failRenderer(missionStore: Store): Promise<unknown> {
    const coordinator = createRendererTeardownCoordinator({
      ipcMain: { on: vi.fn(), removeListener: vi.fn() },
      missionStore,
      createRequestId: () => 'request-unavailable',
      setTimeout: vi.fn(() => 1),
      clearTimeout: vi.fn(),
      timeoutMs: 5_000,
    })
    try {
      return await coordinator.markRendererUnavailable()
    } finally {
      coordinator.dispose()
    }
  }

  /** A quit whose renderer answers "could not drain" (or never confirms before loss). */
  async function failDrain(missionStore: Store): Promise<unknown> {
    const listeners = new Map<string, (event: unknown, input: unknown) => void>()
    const webContents = { id: 1, isDestroyed: () => false, send: vi.fn() }
    let softDeadline: (() => void) | undefined
    const coordinator = createRendererTeardownCoordinator({
      ipcMain: {
        on: (channel: string, listener: (event: unknown, input: unknown) => void) => listeners.set(channel, listener),
        removeListener: vi.fn(),
      },
      missionStore,
      createRequestId: () => 'request-drain',
      setTimeout: vi.fn((listener: () => void) => {
        softDeadline = listener
        return 2
      }),
      clearTimeout: vi.fn(),
      timeoutMs: 5_000,
    })
    try {
      const preparation = coordinator.prepare({ webContents }, 'window_close')
      await vi.waitFor(() => expect(webContents.send).toHaveBeenCalledOnce())
      softDeadline?.()
      await new Promise((resolve) => setTimeout(resolve, 20))
      listeners.get(RENDERER_TEARDOWN_READY_CHANNEL)?.(
        { sender: webContents },
        { requestId: 'request-drain', ok: false },
      )
      return await preparation
    } finally {
      coordinator.dispose()
    }
  }

  it('does not mark evidence lost when nothing was pending (the reported case)', async () => {
    const missionStore = await openStore()
    const mission = await missionStore.createMission({ name: 'TestRR' })

    await expect(failRenderer(missionStore)).resolves.toEqual({ mode: 'no_unfinalized_mission' })
    await expect(failDrain(missionStore)).resolves.toEqual({ mode: 'no_unfinalized_mission' })

    await expect(missionStore.getIngestEvidenceHealth(mission.id)).resolves.toMatchObject({
      state: 'healthy', reason: null,
    })
  })

  it.each([
    ['renderer gone / startup after an unclean end', failRenderer],
    ['unconfirmed drain at quit', failDrain],
  ] as const)('keeps the loss block when the renderer held evidence: %s', async (_name, fail) => {
    const missionStore = await openStore()
    const held = await missionStore.createMission({ name: 'Held evidence' })
    await missionStore.finishMission(held.id)
    const clean = await missionStore.createMission({ name: 'Nothing held' })
    await missionStore.setRendererEvidencePending({ mission_id: held.id, pending: true })

    await fail(missionStore)

    await expect(missionStore.getIngestEvidenceHealth(held.id)).resolves.toMatchObject({
      state: 'critical', reason: 'renderer_pending_evidence_lost',
    })
    await expect(missionStore.getIngestEvidenceHealth(clean.id)).resolves.toMatchObject({
      state: 'healthy', reason: null,
    })
    // The sealed marker is consumed: the loss is now the durable record.
    const outboxNames = await readdir(path.join(userDataPath!, 'ingest-anomaly-outbox'))
    expect(outboxNames.filter((name) => name.startsWith('renderer-evidence-pending-'))).toEqual([])
  })

  it('survives a restart: a marker written before the process died is found by the next start', async () => {
    const first = await openStore()
    const mission = await first.createMission({ name: 'Crashed with evidence' })
    await first.setRendererEvidencePending({ mission_id: mission.id, pending: true })
    await first.prepareClose()
    first.close()
    store = null

    const restarted = await openStore({ protocol: false })
    await failRenderer(restarted)

    await expect(restarted.getIngestEvidenceHealth(mission.id)).resolves.toMatchObject({
      state: 'critical', reason: 'renderer_pending_evidence_lost',
    })
  })

  it('treats an unreadable marker as uncertain for every open mission, never as nothing pending', async () => {
    const missionStore = await openStore()
    const mission = await missionStore.createMission({ name: 'Damaged marker' })
    const outboxDirectory = path.join(userDataPath!, 'ingest-anomaly-outbox')
    await mkdir(outboxDirectory, { recursive: true })
    await writeFile(
      path.join(outboxDirectory, `renderer-evidence-pending-${'0'.repeat(16)}.json.marker`),
      'damaged',
    )

    await failRenderer(missionStore)

    await expect(missionStore.getIngestEvidenceHealth(mission.id)).resolves.toMatchObject({
      state: 'critical', reason: 'renderer_pending_evidence_lost',
    })
  })

  it('re-derives a rejection lost in the accepted crash window as one ledger entry', async () => {
    // The same malformed Traccar row, read before a crash and again by the
    // next start's history re-read, must produce one record, not zero or two.
    const malformedRow = {
      id: 9_001, deviceId: 7, latitude: 200, longitude: -9.6,
      fixTime: '2026-10-01T03:00:00.000Z', serverTime: '2026-10-01T03:00:05.000Z', valid: true,
    }
    const envelopeFor = (missionId: string, receivedAt: string) => {
      const evidence = createRejectedPositionEvidence({ ...malformedRow })
      const anomalyKey = createRejectedPositionAnomalyKey(evidence, 'invalid_coordinates')
      return {
        deliveryId: createRejectedPositionDeliveryId(missionId, anomalyKey),
        anomalyKey,
        deviceId: '7',
        sourcePositionId: evidence.sourcePositionId,
        reasonClass: 'invalid_coordinates',
        receivedAt,
        canonicalEvidence: evidence.canonicalEvidence,
      }
    }
    // Session 1 read the row, then died before saving it (the accepted window).
    const first = await openStore()
    const mission = await first.createMission({ name: 'Re-derived rejection' })
    const unsaved = envelopeFor(mission.id, '2026-10-01T03:00:06.000Z')
    await expect(first.listIngestAnomalies(mission.id)).resolves.toHaveLength(0)
    await first.prepareClose()
    first.close()
    store = null

    // Session 2's history re-read derives the same identity and records it.
    const restarted = await openStore()
    const reread = envelopeFor(mission.id, '2026-10-01T09:00:00.000Z')
    expect(reread.anomalyKey).toBe(unsaved.anomalyKey)
    expect(reread.deliveryId).toBe(unsaved.deliveryId)
    await restarted.recordIngestRejections({ mission_id: mission.id, rejections: [reread] })
    await expect(restarted.listIngestAnomalies(mission.id)).resolves.toHaveLength(1)
    // Seeing it yet again (live poll plus re-read) never makes a second entry.
    await restarted.recordIngestRejections({
      mission_id: mission.id,
      rejections: [envelopeFor(mission.id, '2026-10-01T09:05:00.000Z')],
    })
    await expect(restarted.listIngestAnomalies(mission.id)).resolves.toHaveLength(1)
  })

  it('stays uncertain for a profile last run without markers (an upgrade from 13.5)', async () => {
    const missionStore = await openStore({ protocol: false })
    const mission = await missionStore.createMission({ name: 'Upgraded from 13.5' })

    await failRenderer(missionStore)

    await expect(missionStore.getIngestEvidenceHealth(mission.id)).resolves.toMatchObject({
      state: 'critical', reason: 'renderer_pending_evidence_lost',
    })
  })

  it('stays uncertain after a pending marker could not be written, now and after a restart', async () => {
    const missionStore = await openStore()
    const mission = await missionStore.createMission({ name: 'Marker write failed' })
    const outboxDirectory = path.join(userDataPath!, 'ingest-anomaly-outbox')
    // The disk refuses the marker write.
    const fsPromises = require('node:fs/promises') as typeof import('node:fs/promises')
    const original = fsPromises.open.bind(fsPromises)
    const openSpy = vi.spyOn(fsPromises, 'open').mockImplementation((async (file: string, ...rest: never[]) => {
      if (String(file).includes('renderer-evidence-pending-')) throw Object.assign(new Error('disk full'), { code: 'ENOSPC' })
      return original(file, ...rest)
    }) as typeof fsPromises.open)
    try {
      await expect(missionStore.setRendererEvidencePending({ mission_id: mission.id, pending: true }))
        .rejects.toThrow()
    } finally {
      openSpy.mockRestore()
    }
    expect(await readdir(outboxDirectory)).not.toContain('renderer-evidence-protocol-v1.json.marker')

    await failRenderer(missionStore)

    await expect(missionStore.getIngestEvidenceHealth(mission.id)).resolves.toMatchObject({
      state: 'critical', reason: 'renderer_pending_evidence_lost',
    })
  })

  it('trusts markers again after a confirmed clean drain following a failed marker write', async () => {
    const missionStore = await openStore()
    const failedMission = await missionStore.createMission({ name: 'Write failed earlier' })
    const fsPromises = require('node:fs/promises') as typeof import('node:fs/promises')
    const original = fsPromises.open.bind(fsPromises)
    const openSpy = vi.spyOn(fsPromises, 'open').mockImplementation((async (file: string, ...rest: never[]) => {
      if (String(file).includes('renderer-evidence-pending-')) throw Object.assign(new Error('disk full'), { code: 'ENOSPC' })
      return original(file, ...rest)
    }) as typeof fsPromises.open)
    try {
      await expect(missionStore.setRendererEvidencePending({ mission_id: failedMission.id, pending: true }))
        .rejects.toThrow()
    } finally {
      openSpy.mockRestore()
    }
    await missionStore.finishMission(failedMission.id)

    // The renderer drained cleanly (it held nothing); a new renderer starts.
    await missionStore.clearRendererEvidencePending()
    await missionStore.establishRendererEvidenceProtocol()
    const later = await missionStore.createMission({ name: 'Nothing held later' })
    await failRenderer(missionStore)

    await expect(missionStore.getIngestEvidenceHealth(later.id)).resolves.toMatchObject({
      state: 'healthy', reason: null,
    })
  })

  it('removes a damaged marker once its loss is sealed, and after a clean drain', async () => {
    const missionStore = await openStore()
    const mission = await missionStore.createMission({ name: 'Damaged then sealed' })
    const outboxDirectory = path.join(userDataPath!, 'ingest-anomaly-outbox')
    const damaged = `renderer-evidence-pending-${'0'.repeat(16)}.json.marker`
    await writeFile(path.join(outboxDirectory, damaged), 'damaged')

    await failRenderer(missionStore)
    expect(await readdir(outboxDirectory)).not.toContain(damaged)
    await expect(missionStore.getIngestEvidenceHealth(mission.id)).resolves.toMatchObject({ state: 'critical' })

    await writeFile(path.join(outboxDirectory, damaged), 'damaged')
    await missionStore.clearRendererEvidencePending()
    expect(await readdir(outboxDirectory)).not.toContain(damaged)
  })

  it('ignores a marker left on a finalized mission', async () => {
    const missionStore = await openStore()
    const mission = await missionStore.createMission({ name: 'Finalized with stale marker' })
    await missionStore.finishMission(mission.id)
    await missionStore.finalizeMission(mission.id)
    await missionStore.setRendererEvidencePending({ mission_id: mission.id, pending: true })

    await expect(failRenderer(missionStore)).resolves.toEqual({ mode: 'no_unfinalized_mission' })
    await expect(missionStore.getIngestEvidenceHealth(mission.id)).resolves.toMatchObject({
      state: 'healthy',
    })
  })

  it('crosses IPC only on its named channel, through main\'s sender-validated store handler', async () => {
    const channel = 'sartracker:mission-store:set-renderer-evidence-pending'
    const invoke = vi.fn().mockResolvedValue(undefined)
    let bridge: Record<string, unknown> | undefined
    runInNewContext(readFileSync('electron/preload.cjs', 'utf8'), {
      process: { platform: 'linux' },
      TextEncoder,
      require: (specifier: string) => {
        if (specifier !== 'electron') throw new Error(`Sandboxed preload cannot require ${specifier}.`)
        return {
          contextBridge: { exposeInMainWorld: (_name: string, exposed: Record<string, unknown>) => { bridge = exposed } },
          ipcRenderer: { invoke, on: vi.fn(), removeListener: vi.fn(), send: vi.fn() },
        }
      },
      window: { addEventListener: vi.fn() },
    })
    const missionStore = bridge?.missionStore as {
      readonly setRendererEvidencePending: (input: unknown) => Promise<unknown>
    }
    await missionStore.setRendererEvidencePending({ mission_id: 'mission-1', pending: true })
    expect(invoke).toHaveBeenCalledWith(channel, { mission_id: 'mission-1', pending: true })

    // Main registers every MISSION_STORE_CHANNELS entry not owned by a query
    // module through one handler that calls validateIpcSender first.
    const main = readFileSync('electron/main.cjs', 'utf8')
    expect(main).toContain(`setRendererEvidencePending: '${channel}'`)
    expect(main).toMatch(/ipcMain\.handle\(channel, \(event, \.\.\.args\) => \{\s*validateIpcSender\(event\)\s*return missionStore\[methodName\]\(\.\.\.args\)/u)
    const ownedQueryMethods = /const ownedQueryMethods = new Set\(\[([\s\S]*?)\]\)/u.exec(main)?.[1] ?? ''
    expect(ownedQueryMethods).not.toContain('setRendererEvidencePending')
  })

  it('rejects malformed pending requests at the store boundary', async () => {
    const missionStore = await openStore()
    const mission = await missionStore.createMission({ name: 'Bounded input' })
    await expect(missionStore.setRendererEvidencePending({ mission_id: mission.id, pending: 'yes' as unknown as boolean }))
      .rejects.toThrow(/true or false/u)
    await expect(missionStore.setRendererEvidencePending({ mission_id: '', pending: true }))
      .rejects.toThrow()
    await expect(missionStore.setRendererEvidencePending({ mission_id: 'no-such-mission', pending: true }))
      .rejects.toThrow()
  })
})
