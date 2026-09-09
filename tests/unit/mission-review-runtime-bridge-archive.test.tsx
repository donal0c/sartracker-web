// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MissionReviewRuntimeBridge } from '../../src/features/mission-review/mission-review-runtime-bridge'
import {
  resetMissionArchiveReviewStore,
  useMissionArchiveReviewStore,
} from '../../src/features/mission-review/mission-archive-review-store'
import {
  createMissionReviewRuntimeState,
  type MissionReviewController,
  type StartMissionReviewRuntimeDependencies,
} from '../../src/features/mission-review/start-mission-review-runtime'
import { useMissionReviewStore } from '../../src/features/mission-review/mission-review-store'
import type {
  MissionArchiveReviewController,
  StartMissionArchiveReviewRuntimeDependencies,
} from '../../src/features/mission-review/start-mission-archive-review-runtime'
import type { ArchiveReviewPublicSession } from '../../src/infrastructure/archive-review/archive-review-types'
import type {
  Mission,
  MissionArchiveInfo,
} from '../../src/infrastructure/mission-store/tauri-mission-store'

const mocks = vi.hoisted(() => ({
  createElectronArchiveReviewSource: vi.fn(),
  createElectronLayerCatalogStore: vi.fn(),
  createElectronMissionStore: vi.fn(),
  startMissionArchiveReviewRuntime: vi.fn(),
  startMissionReviewRuntime: vi.fn(),
}))

vi.mock('../../src/features/mission/mission-browser-harness', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/features/mission/mission-browser-harness')>()
  return { ...actual, shouldEnableMissionBrowserHarness: () => false }
})

vi.mock('../../src/infrastructure/mission-store/electron-mission-store', () => ({
  createElectronMissionStore: mocks.createElectronMissionStore,
}))

vi.mock('../../src/infrastructure/layer-catalog-store/electron-layer-catalog-store', () => ({
  createElectronLayerCatalogStore: mocks.createElectronLayerCatalogStore,
}))

vi.mock('../../src/infrastructure/archive-review/electron-archive-review-source', () => ({
  createElectronArchiveReviewSource: mocks.createElectronArchiveReviewSource,
}))

vi.mock('../../src/features/mission-review/start-mission-review-runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/features/mission-review/start-mission-review-runtime')>()
  return { ...actual, startMissionReviewRuntime: mocks.startMissionReviewRuntime }
})

vi.mock('../../src/features/mission-review/start-mission-archive-review-runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/features/mission-review/start-mission-archive-review-runtime')>()
  return {
    ...actual,
    startMissionArchiveReviewRuntime: mocks.startMissionArchiveReviewRuntime,
  }
})

const ARCHIVE_SESSION: ArchiveReviewPublicSession = Object.freeze({
  sessionId: '987c24da-d3cf-4cac-84d2-b1df45a0e94c',
  archiveId: '13f8522c-d4b9-4320-839d-a54c6fdc47fe',
  missionId: 'mission-review-fixed',
  containerVersion: 2,
  encrypted: true,
  verified: true,
  immutable: true,
  ciphertextSha256: 'a'.repeat(64),
  previousArchiveId: null,
  openedAt: '2026-08-30T09:00:00.000Z',
  plaintextResidual: 'permission_restricted_session_open',
})

describe('Mission Review Electron archive source bridge [DON-253 / BCP-16]', () => {
  let container: HTMLDivElement
  let root: Root
  let mounted: boolean
  let liveMissionStore: Record<string, unknown>
  let liveLayerCatalogStore: Record<string, unknown>
  let archiveSource: Record<string, unknown>
  let archiveController: MissionArchiveReviewController
  let reviewControllers: readonly MissionReviewController[]
  let reviewStarts: StartMissionReviewRuntimeDependencies[]
  let archiveStart: StartMissionArchiveReviewRuntimeDependencies | null

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    mounted = false

    liveMissionStore = Object.freeze({ source: 'electron-live-mission-store' })
    liveLayerCatalogStore = Object.freeze({
      source: 'electron-live-layer-catalog-store',
      listMetadata: vi.fn(),
    })
    archiveSource = Object.freeze({
      source: 'fixed-archive-review-source',
      listLayerCatalogMetadata: vi.fn(),
    })

    const archiveDispose = vi.fn().mockResolvedValue(undefined)
    archiveController = Object.freeze({
      refreshTimeline: vi.fn().mockResolvedValue(undefined),
      openArchive: vi.fn().mockResolvedValue(undefined),
      closeArchiveReview: vi.fn().mockResolvedValue(undefined),
      dispose: archiveDispose,
    })
    reviewControllers = [
      controller('initial-live'),
      controller('fixed-archive'),
      controller('fresh-live'),
    ]
    reviewStarts = []
    archiveStart = null

    mocks.createElectronMissionStore.mockReset().mockReturnValue(liveMissionStore)
    mocks.createElectronLayerCatalogStore.mockReset().mockReturnValue(liveLayerCatalogStore)
    mocks.createElectronArchiveReviewSource.mockReset().mockReturnValue(archiveSource)
    mocks.startMissionReviewRuntime.mockReset().mockImplementation(
      async (dependencies: StartMissionReviewRuntimeDependencies) => {
        reviewStarts.push(dependencies)
        return reviewControllers[reviewStarts.length - 1]
      },
    )
    mocks.startMissionArchiveReviewRuntime.mockReset().mockImplementation(
      async (dependencies: StartMissionArchiveReviewRuntimeDependencies) => {
        archiveStart = dependencies
        return archiveController
      },
    )

    Object.defineProperty(window, 'sartrackerElectron', {
      configurable: true,
      value: {
        archiveReview: Object.freeze({
          open: vi.fn(),
          close: vi.fn(),
          cancel: vi.fn(),
          read: vi.fn(),
          onProgress: vi.fn(),
        }),
      },
    })

    useMissionReviewStore.setState({
      ...createMissionReviewRuntimeState(),
      controller: null,
    })
    resetMissionArchiveReviewStore()
  })

  afterEach(async () => {
    if (mounted) await act(async () => root.unmount())
    container.remove()
    Reflect.deleteProperty(window, 'sartrackerElectron')
    vi.restoreAllMocks()
  })

  it('starts the live Review source and the retained-archive timeline under one Electron owner', async () => {
    mounted = true
    await mountBridge(root)

    expect(mocks.startMissionReviewRuntime).toHaveBeenCalledTimes(1)
    expect(reviewStarts[0]).toMatchObject({
      source: 'live',
      archiveSession: null,
      missionStore: liveMissionStore,
      layerCatalogStore: liveLayerCatalogStore,
    })
    expect(mocks.startMissionArchiveReviewRuntime).toHaveBeenCalledTimes(1)
    expect(archiveStart).toMatchObject({
      missionStore: liveMissionStore,
      archiveReview: window.sartrackerElectron?.archiveReview,
    })
    expect(archiveStart?.switchMissionReviewSource).toEqual(expect.any(Function))
    expect(useMissionReviewStore.getState().controller).toBe(reviewControllers[0])
    expect(useMissionArchiveReviewStore.getState().controller).toBe(archiveController)
  })

  it('switches through a fixed archive facade, then starts a fresh live runtime immune to stale archive applies', async () => {
    mounted = true
    await mountBridge(root)
    expect(mocks.startMissionArchiveReviewRuntime).toHaveBeenCalledOnce()
    if (archiveStart === null) throw new Error('Archive orchestration did not start.')

    await act(async () => {
      await archiveStart?.switchMissionReviewSource({
        source: 'archive',
        archiveSession: ARCHIVE_SESSION,
      })
    })

    expect(mocks.createElectronArchiveReviewSource).toHaveBeenCalledOnce()
    expect(mocks.createElectronArchiveReviewSource).toHaveBeenCalledWith(ARCHIVE_SESSION)
    expect(reviewStarts[1]).toMatchObject({
      source: 'archive',
      archiveSession: ARCHIVE_SESSION,
      missionStore: archiveSource,
    })
    expect(reviewStarts[1]?.layerCatalogStore).toEqual({
      listMetadata: archiveSource.listLayerCatalogMetadata,
    })
    expect(useMissionReviewStore.getState().controller).toBe(reviewControllers[1])

    const staleArchiveApply = reviewStarts[1]?.applyRuntime
    await act(async () => {
      await archiveStart?.switchMissionReviewSource({ source: 'live' })
    })

    expect(mocks.startMissionReviewRuntime).toHaveBeenCalledTimes(3)
    expect(reviewStarts[2]).toMatchObject({
      source: 'live',
      archiveSession: null,
      missionStore: liveMissionStore,
      layerCatalogStore: liveLayerCatalogStore,
    })
    expect(useMissionReviewStore.getState().controller).toBe(reviewControllers[2])

    const currentLiveState = createMissionReviewRuntimeState({ source: 'live' })
    const staleArchiveState = createMissionReviewRuntimeState({
      source: 'archive',
      archiveSession: ARCHIVE_SESSION,
    })
    await act(async () => {
      reviewStarts[2]?.applyRuntime(currentLiveState)
      staleArchiveApply?.(staleArchiveState)
    })

    expect(useMissionReviewStore.getState()).toMatchObject({
      source: 'live',
      archiveSession: null,
      controller: reviewControllers[2],
    })
  })

  it('disposes the owning archive orchestration on unmount so its backend session cleanup is requested', async () => {
    mounted = true
    await mountBridge(root)
    expect(mocks.startMissionArchiveReviewRuntime).toHaveBeenCalledOnce()

    await act(async () => root.unmount())
    mounted = false

    expect(archiveController.dispose).toHaveBeenCalledOnce()
    expect(useMissionArchiveReviewStore.getState().controller).toBeNull()
  })

  it('lets the real archive controller resume the live source during renderer teardown', async () => {
    const actualArchiveRuntime = await vi.importActual<
      typeof import('../../src/features/mission-review/start-mission-archive-review-runtime')
    >('../../src/features/mission-review/start-mission-archive-review-runtime')
    const mission: Mission = {
      id: ARCHIVE_SESSION.missionId,
      name: 'Renderer teardown archive mission',
      status: 'finalized',
      start_time: '2026-08-29T08:00:00.000Z',
      pause_time: null,
      finish_time: '2026-08-29T16:00:00.000Z',
      paused_seconds: 0,
      notes: null,
      schema_version: 13,
    }
    const archive: MissionArchiveInfo = {
      id: ARCHIVE_SESSION.archiveId,
      mission_id: mission.id,
      protected_finalization_epoch: 1,
      archive_kind: 'finalized',
      container_version: 2,
      archive_path: `/archive-custody/${ARCHIVE_SESSION.archiveId}.sararch`,
      ciphertext_sha256: ARCHIVE_SESSION.ciphertextSha256,
      size_bytes: 4_096,
      created_at: '2026-08-29T16:10:00.000Z',
      verified_at: '2026-08-29T16:15:00.000Z',
      previous_archive_id: null,
      previous_archive_sha256: null,
      revision_sequence: 1,
      revision_count: 1,
      supplement_authority: null,
      supplement_reason: null,
      supplement_created_at: null,
      status: 'verified',
      availability: 'present',
      availability_reason: null,
      slots: [{ slotId: 'passphrase-slot', slotType: 'passphrase' }],
      last_non_machine_unwrap_at: null,
    }
    liveMissionStore = Object.freeze({
      source: 'electron-live-mission-store',
      listMissions: vi.fn(async () => [mission]),
      listMissionArchives: vi.fn(async () => [archive]),
    })
    mocks.createElectronMissionStore.mockReturnValue(liveMissionStore)
    mocks.startMissionArchiveReviewRuntime.mockImplementation(
      actualArchiveRuntime.startMissionArchiveReviewRuntime,
    )
    const close = vi.fn(async () => true)
    Object.defineProperty(window, 'sartrackerElectron', {
      configurable: true,
      value: {
        archiveReview: Object.freeze({
          open: vi.fn(async (request: { readonly operationId: string }) => ({
            operationId: request.operationId,
            ...ARCHIVE_SESSION,
          })),
          close,
          cancel: vi.fn(async () => true),
          read: vi.fn(),
          onProgress: vi.fn(() => () => undefined),
        }),
      },
    })

    mounted = true
    await mountBridge(root)
    const realController = useMissionArchiveReviewStore.getState().controller
    if (realController === null) throw new Error('Expected the real archive controller.')
    await act(async () => {
      await realController.openArchive({
        archiveId: archive.id,
        containerVersion: 2,
        slotType: 'passphrase',
        secret: 'Archive-Review-Secret-2026!',
      })
    })
    expect(reviewStarts.at(-1)?.source).toBe('archive')

    act(() => root.unmount())
    mounted = false
    await vi.waitFor(() => expect(close).toHaveBeenCalledWith({
      sessionId: ARCHIVE_SESSION.sessionId,
    }))
    await vi.waitFor(() => expect(useMissionArchiveReviewStore.getState().controller).toBeNull())
    expect(reviewStarts.at(-1)?.source).toBe('live')
  })

  it('retains visible ownership until unmount disposal confirms plaintext cleanup', async () => {
    const disposal = deferred<void>()
    archiveController = Object.freeze({
      ...archiveController,
      dispose: vi.fn(() => disposal.promise),
    })
    mounted = true
    await mountBridge(root)
    archiveStart?.applyRuntime({
      timeline: [],
      phase: 'open',
      activeOperationId: null,
      activeArchiveId: ARCHIVE_SESSION.archiveId,
      activeSession: ARCHIVE_SESSION,
      progress: null,
      recoveryRequired: 'none',
      error: null,
    })

    act(() => root.unmount())
    mounted = false
    expect(useMissionArchiveReviewStore.getState()).toMatchObject({
      controller: archiveController,
      activeSession: ARCHIVE_SESSION,
    })

    disposal.resolve()
    await act(async () => {
      await disposal.promise
      await Promise.resolve()
    })
    expect(useMissionArchiveReviewStore.getState().controller).toBeNull()
    expect(useMissionReviewStore.getState().controller).toBeNull()
  })

  it('keeps cleanup failure and its controller retryable after bridge unmount', async () => {
    const dispose = vi.fn(async () => {
      archiveStart?.applyRuntime({
        timeline: [],
        phase: 'error',
        activeOperationId: null,
        activeArchiveId: ARCHIVE_SESSION.archiveId,
        activeSession: ARCHIVE_SESSION,
        progress: null,
        recoveryRequired: 'plaintext_cleanup',
        error: 'Archive Review plaintext cleanup failed safely.',
      })
      throw new Error('cleanup failed')
    })
    archiveController = Object.freeze({ ...archiveController, dispose })
    mounted = true
    await mountBridge(root)

    await act(async () => root.unmount())
    mounted = false

    expect(dispose).toHaveBeenCalledOnce()
    expect(useMissionArchiveReviewStore.getState()).toMatchObject({
      controller: archiveController,
      activeSession: ARCHIVE_SESSION,
      recoveryRequired: 'plaintext_cleanup',
      error: expect.stringMatching(/cleanup/iu),
    })
    expect(useMissionReviewStore.getState().controller).not.toBeNull()
  })
})

/** Mounts the bridge and flushes its two asynchronous runtime startups. */
async function mountBridge(root: Root): Promise<void> {
  await act(async () => {
    root.render(createElement(MissionReviewRuntimeBridge))
    await Promise.resolve()
  })
  await act(async () => {
    await vi.waitFor(() => {
      expect(mocks.startMissionReviewRuntime).toHaveBeenCalledTimes(1)
    })
    await Promise.resolve()
  })
  expect(mocks.startMissionReviewRuntime).toHaveBeenCalledTimes(1)
}

/** Creates one distinct runtime controller identity for source-switch assertions. */
function controller(identity: string): MissionReviewController {
  return Object.freeze({
    identity,
    load: vi.fn().mockResolvedValue(undefined),
    selectMission: vi.fn().mockResolvedValue(undefined),
    refreshSelectedMission: vi.fn().mockResolvedValue(undefined),
    loadNextGpxImports: vi.fn().mockResolvedValue(undefined),
    returnToFirstGpxImports: vi.fn().mockResolvedValue(undefined),
    setIncludeTelemetry: vi.fn().mockResolvedValue(undefined),
    seekReplay: vi.fn().mockResolvedValue(undefined),
    loadNextReplayChunk: vi.fn().mockResolvedValue(undefined),
    loadPreviousReplayChunk: vi.fn().mockResolvedValue(undefined),
    loadNextReplayObjects: vi.fn().mockResolvedValue(undefined),
    loadPreviousReplayObjects: vi.fn().mockResolvedValue(undefined),
    returnToLive: vi.fn(),
    searchSearchOperations: vi.fn().mockResolvedValue(undefined),
    loadNextSearchOperations: vi.fn().mockResolvedValue(undefined),
    returnToFirstSearchOperations: vi.fn().mockResolvedValue(undefined),
    searchReplayOutingFilters: vi.fn().mockResolvedValue(undefined),
    loadNextReplayOutingFilters: vi.fn().mockResolvedValue(undefined),
    returnToFirstReplayOutingFilters: vi.fn().mockResolvedValue(undefined),
    recordSearchAssignment: vi.fn().mockResolvedValue(undefined),
    recordSearchPass: vi.fn().mockResolvedValue(undefined),
    openAttachment: vi.fn().mockResolvedValue(true),
  } as MissionReviewController & { readonly identity: string })
}

/** Creates one externally settled promise for bridge teardown assertions. */
function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle
    reject = fail
  })
  return { promise, resolve, reject }
}
