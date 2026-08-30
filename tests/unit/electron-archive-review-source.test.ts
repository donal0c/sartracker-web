import { createHash } from 'node:crypto'
import { constants, fstatSync } from 'node:fs'
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3') as new (
  databasePath: string,
) => {
  readonly prepare: (sql: string) => {
    readonly run: (...values: readonly unknown[]) => unknown
  }
  readonly pragma: (sql: string) => unknown
  readonly close: () => void
}
const { createElectronMissionStore, CURRENT_SCHEMA_VERSION } = require(
  '../../electron/mission-store.cjs',
) as {
  readonly CURRENT_SCHEMA_VERSION: number
  readonly createElectronMissionStore: (
    options: { readonly userDataPath: string },
  ) => FixtureMissionStore
}
const { createArchiveReviewSource } = require(
  '../../electron/archive-review-source.cjs',
) as {
  readonly createArchiveReviewSource: (
    options: ArchiveReviewSourceOptions,
  ) => ArchiveReviewSource
}
const { openVerifiedRestoredAttachment } = require(
  '../../electron/archive-review-attachment-opener.cjs',
) as {
  readonly openVerifiedRestoredAttachment: (input: RestoredAttachmentOpenInput & {
    readonly openPath: (stagePath: string) => Promise<string>
  }) => Promise<boolean>
}
const { runMissionReviewReadQueryInWorker } = require(
  '../../electron/mission-review-read-query-runner.cjs',
) as {
  readonly runMissionReviewReadQueryInWorker: ReviewRunner
}
const { runMissionReplayInWorker } = require(
  '../../electron/mission-replay-runner.cjs',
) as {
  readonly runMissionReplayInWorker: ReplayRunner
}
const { runSearchOperationPageInWorker } = require(
  '../../electron/search-operations-page-runner.cjs',
) as {
  readonly runSearchOperationPageInWorker: SearchRunner
}

const SOURCE_FUNCTIONS = [
  'cancelMissionReplay',
  'cancelMissionReviewRead',
  'close',
  'info',
  'listDevices',
  'listDrawings',
  'listGpxImportPage',
  'listGpxImports',
  'listHelicopters',
  'listLayerCatalogMetadata',
  'listArchiveAttachmentPage',
  'listMarkers',
  'listMissions',
  'listOutings',
  'listSearchOperationPage',
  'openAttachment',
  'readMissionReplay',
  'readMissionReplayFilterPage',
  'readMissionReplayObjectChunk',
  'readMissionReplayTrackChunk',
  'readMissionReview',
] as const

type RunnerInput = {
  readonly databasePath: string
  readonly query: Readonly<Record<string, unknown>>
  readonly kind?: 'state' | 'chunk' | 'objects' | 'filters'
  readonly signal?: AbortSignal
}
type WorkerPromise = Promise<unknown> & { readonly workerExited?: Promise<unknown> }
type ReviewRunner = (input: RunnerInput) => WorkerPromise
type ReplayRunner = (input: RunnerInput) => WorkerPromise
type SearchRunner = (input: RunnerInput) => WorkerPromise
type ProjectionRunnerInput = {
  readonly databasePath: string
  readonly method:
    | 'listMissions'
    | 'listMarkers'
    | 'listDevices'
    | 'listDrawings'
    | 'listHelicopters'
    | 'listGpxImports'
    | 'listGpxImportPage'
    | 'listOutings'
    | 'listLayerCatalogMetadata'
  readonly missionId?: string
  readonly query?: Readonly<Record<string, unknown>>
  readonly signal?: AbortSignal
}
type ProjectionRunner = (input: ProjectionRunnerInput) => WorkerPromise

type RestoredAttachmentOpenInput = {
  readonly restoredPath: string
  readonly displayName: string
  readonly expectedSha256: string
  readonly expectedSizeBytes: number
  readonly sessionDirectory: string
  readonly signal: AbortSignal
}

type ArchiveReviewSourceOptions = {
  readonly databasePath: string
  readonly databaseFileHandle?: Awaited<ReturnType<typeof open>>
  readonly expectedDatabaseIdentity?: {
    readonly dev: number
    readonly ino: number
    readonly sizeBytes: number
  }
  readonly missionId: string
  readonly sessionId: string
  readonly runMissionReviewRead?: ReviewRunner
  readonly runMissionReplayRead?: ReplayRunner
  readonly runSearchOperationPage?: SearchRunner
  readonly runProjectionRead?: ProjectionRunner
  readonly attachmentMappings?: readonly Readonly<Record<string, unknown>>[]
  readonly openRestoredAttachment?: (input: RestoredAttachmentOpenInput) => Promise<boolean | {
    readonly opened: true
    readonly close: () => Promise<void>
  }>
}

type ArchiveReviewSource = {
  readonly info: () => Promise<unknown>
  readonly listMissions: () => Promise<readonly Readonly<Record<string, unknown>>[]>
  readonly readMissionReview: (
    input: Readonly<Record<string, unknown>>,
    requestId?: string,
  ) => Promise<unknown>
  readonly cancelMissionReviewRead: (requestId: string) => Promise<boolean>
  readonly readMissionReplay: (
    input: Readonly<Record<string, unknown>>,
    requestId?: string,
  ) => Promise<unknown>
  readonly readMissionReplayTrackChunk: (
    input: Readonly<Record<string, unknown>>,
    requestId?: string,
  ) => Promise<unknown>
  readonly readMissionReplayObjectChunk: (
    input: Readonly<Record<string, unknown>>,
    requestId?: string,
  ) => Promise<unknown>
  readonly readMissionReplayFilterPage: (
    input: Readonly<Record<string, unknown>>,
    requestId?: string,
  ) => Promise<unknown>
  readonly cancelMissionReplay: (requestId: string) => Promise<boolean>
  readonly listMarkers: (missionId: string) => Promise<readonly Readonly<Record<string, unknown>>[]>
  readonly listDevices: (missionId: string) => Promise<readonly Readonly<Record<string, unknown>>[]>
  readonly listDrawings: (missionId: string) => Promise<readonly Readonly<Record<string, unknown>>[]>
  readonly listHelicopters: (missionId: string) => Promise<readonly Readonly<Record<string, unknown>>[]>
  readonly listGpxImports: (missionId: string) => Promise<readonly Readonly<Record<string, unknown>>[]>
  readonly listGpxImportPage: (input: Readonly<Record<string, unknown>>) => Promise<unknown>
  readonly listSearchOperationPage: (input: Readonly<Record<string, unknown>>) => Promise<unknown>
  readonly listOutings: (missionId: string) => Promise<readonly Readonly<Record<string, unknown>>[]>
  readonly listLayerCatalogMetadata: (
    missionId: string,
  ) => Promise<readonly Readonly<Record<string, unknown>>[]>
  readonly listArchiveAttachmentPage: (
    input: Readonly<Record<string, unknown>>,
  ) => Promise<unknown>
  readonly openAttachment: (input: {
    readonly missionId: string
    readonly attachmentPath: string
    readonly referenceKind: string
    readonly referenceId: string
  }) => Promise<boolean>
  readonly close: () => Promise<void> | void
}

type FixtureMissionStore = {
  readonly info: () => Promise<{ readonly database_path: string; readonly schema_version: number }>
  readonly createMission: (input: {
    readonly name: string
    readonly start_time: string
  }) => Promise<{ readonly id: string }>
  readonly finishMission: (missionId: string) => Promise<unknown>
  readonly upsertDevice: (input: Readonly<Record<string, unknown>>) => Promise<unknown>
  readonly addPosition: (input: Readonly<Record<string, unknown>>) => Promise<unknown>
  readonly upsertMarker: (input: Readonly<Record<string, unknown>>) => Promise<{ readonly id: string }>
  readonly upsertDrawing: (input: Readonly<Record<string, unknown>>) => Promise<unknown>
  readonly upsertHelicopter: (input: Readonly<Record<string, unknown>>) => Promise<unknown>
  readonly upsertGpxImport: (input: Readonly<Record<string, unknown>>) => Promise<unknown>
  readonly createOuting: (input: Readonly<Record<string, unknown>>) => Promise<unknown>
  readonly upsertSearchArea: (input: Readonly<Record<string, unknown>>) => Promise<unknown>
  readonly upsertLayerCatalogMetadata: (input: Readonly<Record<string, unknown>>) => Promise<unknown>
  readonly prepareClose: () => Promise<void>
  readonly close: () => void
}

type Fixture = {
  readonly root: string
  readonly databasePath: string
  readonly missionId: string
  readonly decoyMissionId: string
  readonly sessionId: string
  readonly selectedTime: string
  readonly markerId: string
}

const fixtureRoots = new Set<string>()

/** Creates one externally settled promise for lifecycle race tests. */
function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle
    reject = fail
  })
  return { promise, resolve, reject }
}

afterEach(async () => {
  await Promise.all([...fixtureRoots].map(async (root) => {
    await chmod(path.join(root, '.review', 'session-secret', 'mission-store.sqlite'), 0o600)
      .catch(() => undefined)
    await rm(root, { recursive: true, force: true })
  }))
  fixtureRoots.clear()
})

describe('archive-backed Mission Review source [DON-252 / BCP-15]', () => {
  it('rejects a restored database that differs from the worker-pinned inode identity', async () => {
    const fixture = await createV13Fixture()
    const identity = await stat(fixture.databasePath)

    expect(() => createArchiveReviewSource({
      databasePath: fixture.databasePath,
      expectedDatabaseIdentity: {
        dev: identity.dev,
        ino: identity.ino + 1,
        sizeBytes: identity.size,
      },
      missionId: fixture.missionId,
      sessionId: fixture.sessionId,
    })).toThrowError(expect.objectContaining({ code: 'ARCHIVE_REVIEW_DATABASE_UNAVAILABLE' }))
  })

  it('zeroes the transferred restored database inode when its session path was displaced', async () => {
    const fixture = await createV13Fixture()
    await chmod(fixture.databasePath, 0o600)
    const originalIdentity = await stat(fixture.databasePath)
    const databaseFileHandle = await open(
      fixture.databasePath,
      constants.O_RDWR | (constants.O_NOFOLLOW ?? 0),
    )
    const sessionDirectory = path.dirname(fixture.databasePath)
    const displacedDirectory = path.join(fixture.root, 'displaced-session')
    await rename(sessionDirectory, displacedDirectory)
    await mkdir(sessionDirectory, { recursive: true, mode: 0o700 })
    await writeFile(fixture.databasePath, 'DECOY', { mode: 0o600 })

    try {
      expect(() => createArchiveReviewSource({
        databasePath: fixture.databasePath,
        databaseFileHandle,
        expectedDatabaseIdentity: {
          dev: originalIdentity.dev,
          ino: originalIdentity.ino,
          sizeBytes: originalIdentity.size,
        },
        missionId: fixture.missionId,
        sessionId: fixture.sessionId,
      })).toThrowError(expect.objectContaining({ code: 'ARCHIVE_REVIEW_DATABASE_UNAVAILABLE' }))
      expect((await stat(path.join(displacedDirectory, 'mission-store.sqlite'))).size).toBe(0)
      expect(await readFile(fixture.databasePath, 'utf8')).toBe('DECOY')
    } finally {
      await databaseFileHandle.close().catch(() => undefined)
    }
  })

  it('retries a transient transferred database handle close before claiming descriptor cleanup', async () => {
    const fixture = await createV13Fixture()
    await chmod(fixture.databasePath, 0o600)
    const identity = await stat(fixture.databasePath)
    const databaseFileHandle = await open(
      fixture.databasePath,
      constants.O_RDWR | (constants.O_NOFOLLOW ?? 0),
    )
    const close = vi.fn()
      .mockRejectedValueOnce(new Error('transient descriptor close failure'))
      .mockImplementationOnce(() => databaseFileHandle.close())
    const source = createArchiveReviewSource({
      databasePath: fixture.databasePath,
      databaseFileHandle: { fd: databaseFileHandle.fd, close } as never,
      expectedDatabaseIdentity: {
        dev: identity.dev,
        ino: identity.ino,
        sizeBytes: identity.size,
      },
      missionId: fixture.missionId,
      sessionId: fixture.sessionId,
    })

    try {
      await expect(source.close()).rejects.toThrow(/transient descriptor close failure/iu)
      expect(() => fstatSync(databaseFileHandle.fd)).not.toThrow()

      await expect(source.close()).resolves.toBeUndefined()
      expect(close).toHaveBeenCalledTimes(2)
      expect(() => fstatSync(databaseFileHandle.fd)).toThrow()
    } finally {
      await databaseFileHandle.close().catch(() => undefined)
    }
  })

  it('exposes an exact read-only capability surface even when the archived row claims active', async () => {
    const fixture = await createV13Fixture()
    const source = createSource(fixture)

    try {
      expect(Object.keys(source).sort()).toEqual([...SOURCE_FUNCTIONS].sort())
      expect(await source.info()).toEqual({
        mission_id: fixture.missionId,
        session_id: fixture.sessionId,
        read_only: true,
      })
      await expect(source.listMissions()).resolves.toEqual([
        expect.objectContaining({ id: fixture.missionId, status: 'active' }),
      ])

      for (const property of [
        'createMission',
        'upsertMarker',
        'deleteMarker',
        'finishMission',
        'finalizeMission',
        'unlockFinalizedMission',
        'databasePath',
        'unknownFutureMutation',
      ]) {
        expectReadOnlyPropertyAccess(source, property)
      }
      expect(() => Reflect.set(
        source as unknown as Record<string, unknown>,
        'upsertMarker',
        () => undefined,
      )).toThrow(expect.objectContaining({ code: 'ARCHIVE_REVIEW_READ_ONLY' }))
    } finally {
      await source.close()
    }
  })

  it('reads representative v13 review projections with fixed-mission filtering and no scratch-path leak', async () => {
    const fixture = await createV13Fixture()
    const source = createSource(fixture)

    try {
      const review = await source.readMissionReview({
        missionId: fixture.missionId,
        includeTelemetry: false,
        auditLimit: 100,
      }, 'review-projection')
      const replay = await source.readMissionReplay({
        missionId: fixture.missionId,
        selectedTime: fixture.selectedTime,
        timezone: 'Europe/Dublin',
        trackLimit: 100,
        objectLimit: 100,
      }, 'replay-projection')
      const searchPage = await source.listSearchOperationPage({
        missionId: fixture.missionId,
        kind: 'areas',
        limit: 25,
      })
      const projections = {
        missions: await source.listMissions(),
        markers: await source.listMarkers(fixture.missionId),
        devices: await source.listDevices(fixture.missionId),
        drawings: await source.listDrawings(fixture.missionId),
        helicopters: await source.listHelicopters(fixture.missionId),
        gpxImports: await source.listGpxImports(fixture.missionId),
        gpxPage: await source.listGpxImportPage({
          missionId: fixture.missionId,
          limit: 25,
        }),
        outings: await source.listOutings(fixture.missionId),
        layerMetadata: await source.listLayerCatalogMetadata(fixture.missionId),
        review,
        replay,
        searchPage,
      }

      expect(projections.markers).toEqual([
        expect.objectContaining({
          name: 'Archive IPP',
          attachment_path: 'briefing.pdf',
        }),
      ])
      expect(projections.devices).toEqual([
        expect.objectContaining({ device_id: 'tracker-archive' }),
      ])
      expect(projections.drawings).toEqual([
        expect.objectContaining({ name: 'Archive sector' }),
      ])
      expect(projections.helicopters).toEqual([
        expect.objectContaining({ call_sign: 'Rescue Archive' }),
      ])
      expect(projections.gpxImports).toEqual([
        expect.objectContaining({
          display_name: 'Archive ridge track',
          source_path: 'ridge.gpx',
        }),
      ])
      expect(projections.outings).toEqual([
        expect.objectContaining({ label: 'Archive outing' }),
      ])
      expect(projections.layerMetadata).toEqual([
        expect.objectContaining({
          missionId: fixture.missionId,
          nodeId: 'group:archive-tracking',
          isVisible: false,
        }),
      ])
      expect(review).toMatchObject({ breadcrumbCount: 1 })
      expect(JSON.stringify(review)).toContain('marker_created')
      expect(JSON.stringify(replay)).toContain('tracker-archive')
      expect(searchPage).toMatchObject({ totalCount: expect.any(Number) })
      expect((searchPage as { readonly totalCount: number }).totalCount).toBeGreaterThanOrEqual(1)
      expect(JSON.stringify(searchPage)).toContain('Archive Area')

      const serialized = JSON.stringify(projections)
      expect(serialized).not.toContain(fixture.databasePath)
      expect(serialized).not.toContain(path.dirname(fixture.databasePath))
      expect(serialized).not.toContain('session-secret')
      expect(serialized).not.toContain('/original/live')
      expect(serialized).not.toContain(fixture.decoyMissionId)
    } finally {
      await source.close()
    }
  })

  it('rejects every foreign-mission read before a worker or attachment action can run', async () => {
    const fixture = await createV13Fixture()
    const reviewRunner = vi.fn(runMissionReviewReadQueryInWorker)
    const replayRunner = vi.fn(runMissionReplayInWorker)
    const searchRunner = vi.fn(runSearchOperationPageInWorker)
    const source = createSource(fixture, {
      runMissionReviewRead: reviewRunner,
      runMissionReplayRead: replayRunner,
      runSearchOperationPage: searchRunner,
    })
    const replayInput = {
      missionId: fixture.decoyMissionId,
      selectedTime: fixture.selectedTime,
      timezone: 'Europe/Dublin',
      trackLimit: 100,
      objectLimit: 100,
    }

    try {
      const attacks: readonly (() => Promise<unknown>)[] = [
        () => source.readMissionReview({
          missionId: fixture.decoyMissionId,
          includeTelemetry: false,
          auditLimit: 100,
        }, 'foreign-review'),
        () => source.readMissionReplay(replayInput, 'foreign-replay'),
        () => source.readMissionReplayTrackChunk(replayInput, 'foreign-tracks'),
        () => source.readMissionReplayObjectChunk(replayInput, 'foreign-objects'),
        () => source.readMissionReplayFilterPage({
          ...replayInput,
          filterKind: 'outing',
          filterLimit: 100,
        }, 'foreign-filters'),
        () => source.listMarkers(fixture.decoyMissionId),
        () => source.listDevices(fixture.decoyMissionId),
        () => source.listDrawings(fixture.decoyMissionId),
        () => source.listHelicopters(fixture.decoyMissionId),
        () => source.listGpxImports(fixture.decoyMissionId),
        () => source.listGpxImportPage({ missionId: fixture.decoyMissionId, limit: 25 }),
        () => source.listSearchOperationPage({
          missionId: fixture.decoyMissionId,
          kind: 'areas',
          limit: 25,
        }),
        () => source.listOutings(fixture.decoyMissionId),
        () => source.listLayerCatalogMetadata(fixture.decoyMissionId),
        () => source.openAttachment({
          missionId: fixture.decoyMissionId,
          attachmentPath: '/original/live/mission/attachments/briefing.pdf',
          referenceKind: 'marker',
          referenceId: fixture.markerId,
        }),
      ]

      for (const attack of attacks) {
        await expect(attack()).rejects.toThrow(/archive review.*mission|mission.*mismatch/iu)
      }
      expect(reviewRunner).not.toHaveBeenCalled()
      expect(replayRunner).not.toHaveBeenCalled()
      expect(searchRunner).not.toHaveBeenCalled()
    } finally {
      await source.close()
    }
  })

  it('delegates bounded reads using only the internal database path and preserves request cancellation', async () => {
    const fixture = await createV13Fixture()
    const reviewRunner = vi.fn(runMissionReviewReadQueryInWorker)
    const replayRunner = vi.fn(runMissionReplayInWorker)
    const searchRunner = vi.fn(runSearchOperationPageInWorker)
    const source = createSource(fixture, {
      runMissionReviewRead: reviewRunner,
      runMissionReplayRead: replayRunner,
      runSearchOperationPage: searchRunner,
    })
    const replayInput = {
      missionId: fixture.missionId,
      selectedTime: fixture.selectedTime,
      timezone: 'Europe/Dublin',
      trackLimit: 100,
      objectLimit: 100,
    }

    try {
      const replayState = await source.readMissionReplay(
        replayInput,
        'replay-state-owned',
      ) as { readonly replayGeneration: number }
      const results = await Promise.all([
        source.readMissionReview({
          missionId: fixture.missionId,
          includeTelemetry: false,
          auditLimit: 100,
        }, 'review-owned'),
        source.readMissionReplayTrackChunk(replayInput, 'replay-tracks-owned'),
        source.readMissionReplayObjectChunk({
          ...replayInput,
          replayGeneration: replayState.replayGeneration,
        }, 'replay-objects-owned'),
        source.readMissionReplayFilterPage({
          ...replayInput,
          filterKind: 'outing',
          filterLimit: 100,
        }, 'replay-filters-owned'),
        source.listSearchOperationPage({
          missionId: fixture.missionId,
          kind: 'areas',
          limit: 25,
        }),
      ])

      expect(reviewRunner).toHaveBeenCalledWith(expect.objectContaining({
        databasePath: pinnedDatabasePathMatcher(),
        query: expect.objectContaining({ missionId: fixture.missionId }),
        signal: expect.any(AbortSignal),
      }))
      expect(replayRunner.mock.calls.map(([input]) => input.kind)).toEqual([
        'state',
        'chunk',
        'objects',
        'filters',
      ])
      for (const [input] of replayRunner.mock.calls) {
        expect(input).toMatchObject({
          databasePath: pinnedDatabasePathMatcher(),
          query: expect.objectContaining({ missionId: fixture.missionId }),
          signal: expect.any(AbortSignal),
        })
      }
      expect(searchRunner).toHaveBeenCalledWith(expect.objectContaining({
        databasePath: pinnedDatabasePathMatcher(),
        query: expect.objectContaining({ missionId: fixture.missionId }),
        signal: expect.any(AbortSignal),
      }))
      expect(JSON.stringify(results)).not.toContain(path.dirname(fixture.databasePath))
    } finally {
      await source.close()
    }

    const cancellation = createAbortableReviewRunner()
    const cancellingSource = createSource(fixture, {
      runMissionReviewRead: cancellation.runner,
    })
    const pending = cancellingSource.readMissionReview({
      missionId: fixture.missionId,
      includeTelemetry: false,
      auditLimit: 100,
    }, 'cancel-owned')
    await cancellation.started
    await expect(cancellingSource.cancelMissionReviewRead('cancel-owned')).resolves.toBe(true)
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(cancellation.signal?.aborted).toBe(true)
    await cancellingSource.close()
  })

  it('delegates every simple database projection off-main without opening SQLite in the source isolate', async () => {
    const fixture = await createV13Fixture()
    const databasePath = path.join(
      fixture.root,
      '.review',
      'projection-session-with-no-main-database',
      'mission-store.sqlite',
    )
    await mkdir(path.dirname(databasePath), { recursive: true, mode: 0o700 })
    await copyFile(fixture.databasePath, databasePath)
    const runProjectionRead = vi.fn<ProjectionRunner>((input) => {
      const value = input.method === 'listGpxImportPage'
        ? { entries: [{ projection: input.method }], nextCursor: 'gpx-page-2' }
        : [{ projection: input.method }]
      const result = Promise.resolve(value) as WorkerPromise
      Object.defineProperty(result, 'workerExited', { value: Promise.resolve() })
      return result
    })
    const source = createArchiveReviewSource({
      databasePath,
      missionId: fixture.missionId,
      sessionId: fixture.sessionId,
      runProjectionRead,
    })
    const gpxQuery = Object.freeze({
      missionId: fixture.missionId,
      cursor: null,
      limit: 25,
    })

    try {
      const results = await Promise.all([
        source.listMissions(),
        source.listMarkers(fixture.missionId),
        source.listDevices(fixture.missionId),
        source.listDrawings(fixture.missionId),
        source.listHelicopters(fixture.missionId),
        source.listGpxImports(fixture.missionId),
        source.listGpxImportPage(gpxQuery),
        source.listOutings(fixture.missionId),
        source.listLayerCatalogMetadata(fixture.missionId),
      ])

      expect(results).toEqual([
        [{ projection: 'listMissions' }],
        [{ projection: 'listMarkers' }],
        [{ projection: 'listDevices' }],
        [{ projection: 'listDrawings' }],
        [{ projection: 'listHelicopters' }],
        [{ projection: 'listGpxImports' }],
        { entries: [{ projection: 'listGpxImportPage' }], nextCursor: 'gpx-page-2' },
        [{ projection: 'listOutings' }],
        [{ projection: 'listLayerCatalogMetadata' }],
      ])
      expect(runProjectionRead).toHaveBeenCalledTimes(9)
      expect(runProjectionRead.mock.calls.map(([input]) => ({
        databasePath: input.databasePath,
        method: input.method,
        missionId: input.missionId,
        query: input.query,
        hasAbortSignal: input.signal instanceof AbortSignal,
      }))).toEqual([
        projectionCall(databasePath, 'listMissions', fixture.missionId),
        projectionCall(databasePath, 'listMarkers', fixture.missionId),
        projectionCall(databasePath, 'listDevices', fixture.missionId),
        projectionCall(databasePath, 'listDrawings', fixture.missionId),
        projectionCall(databasePath, 'listHelicopters', fixture.missionId),
        projectionCall(databasePath, 'listGpxImports', fixture.missionId),
        projectionCall(databasePath, 'listGpxImportPage', undefined, gpxQuery),
        projectionCall(databasePath, 'listOutings', fixture.missionId),
        projectionCall(databasePath, 'listLayerCatalogMetadata', fixture.missionId),
      ])
    } finally {
      await source.close()
    }
  })

  it('makes every concurrent close caller join the same active projection worker exit', async () => {
    const fixture = await createV13Fixture()
    const databasePath = path.join(
      fixture.root,
      '.review',
      'projection-close-session',
      'mission-store.sqlite',
    )
    await mkdir(path.dirname(databasePath), { recursive: true, mode: 0o700 })
    await copyFile(fixture.databasePath, databasePath)
    let observedSignal: AbortSignal | undefined
    let resolveWorkerExit = () => undefined
    const workerExited = new Promise<void>((resolve) => { resolveWorkerExit = resolve })
    const runProjectionRead = vi.fn<ProjectionRunner>((input) => {
      observedSignal = input.signal
      const result = new Promise<unknown>((_resolve, reject) => {
        input.signal?.addEventListener('abort', () => {
          const error = new Error('Archive review projection cancelled.')
          error.name = 'AbortError'
          reject(error)
        }, { once: true })
      }) as WorkerPromise
      Object.defineProperty(result, 'workerExited', { value: workerExited })
      return result
    })
    const source = createArchiveReviewSource({
      databasePath,
      missionId: fixture.missionId,
      sessionId: fixture.sessionId,
      runProjectionRead,
    })
    const pending = source.listMarkers(fixture.missionId)
    const observedFailure = pending.catch((error: unknown) => error)
    await vi.waitFor(() => expect(runProjectionRead).toHaveBeenCalledOnce())

    let firstCloseSettled = false
    let secondCloseSettled = false
    const firstClose = Promise.resolve(source.close())
      .finally(() => { firstCloseSettled = true })
    const secondClose = Promise.resolve(source.close())
      .finally(() => { secondCloseSettled = true })
    await vi.waitFor(() => expect(observedSignal?.aborted).toBe(true))
    await Promise.resolve()
    expect(firstCloseSettled).toBe(false)
    expect(secondCloseSettled).toBe(false)
    await expect(observedFailure).resolves.toMatchObject({ name: 'AbortError' })

    resolveWorkerExit()
    await expect(firstClose).resolves.toBeUndefined()
    await expect(secondClose).resolves.toBeUndefined()
    expect(firstCloseSettled).toBe(true)
    expect(secondCloseSettled).toBe(true)
  })

  it('aborts an active Search Operations read and joins physical worker exit before close', async () => {
    const fixture = await createV13Fixture()
    let observedSignal: AbortSignal | undefined
    let resolveResult!: (value: unknown) => void
    let rejectResult!: (error: unknown) => void
    let resolveWorkerExit = () => undefined
    const workerExited = new Promise<void>((resolve) => { resolveWorkerExit = resolve })
    const runSearchOperationPage = vi.fn<SearchRunner>((input) => {
      observedSignal = input.signal
      const result = new Promise<unknown>((resolve, reject) => {
        resolveResult = resolve
        rejectResult = reject
        input.signal?.addEventListener('abort', () => {
          const error = new Error('Archive review search projection cancelled.')
          error.name = 'AbortError'
          reject(error)
        }, { once: true })
      }) as WorkerPromise
      Object.defineProperty(result, 'workerExited', { value: workerExited })
      return result
    })
    const source = createSource(fixture, { runSearchOperationPage })
    const pending = source.listSearchOperationPage({
      missionId: fixture.missionId,
      kind: 'areas',
      limit: 25,
    })
    const observedFailure = pending.catch((error: unknown) => error)
    await vi.waitFor(() => expect(runSearchOperationPage).toHaveBeenCalledOnce())

    let closeSettled = false
    const closing = Promise.resolve(source.close()).finally(() => { closeSettled = true })
    try {
      await vi.waitFor(() => expect(observedSignal?.aborted).toBe(true))
      await expect(observedFailure).resolves.toMatchObject({ name: 'AbortError' })
      expect(closeSettled).toBe(false)
      resolveWorkerExit()
      await expect(closing).resolves.toBeUndefined()
    } finally {
      resolveResult({ entries: [], nextCursor: null, totalCount: 0 })
      rejectResult(new Error('test cleanup'))
      resolveWorkerExit()
      await Promise.allSettled([pending, closing])
    }
  })

  it('leaves the permission-restricted restored database byte-identical and fails closed after close', async () => {
    const fixture = await createV13Fixture()
    const beforeBytes = await readFile(fixture.databasePath)
    const beforeStat = await stat(fixture.databasePath)
    const source = createSource(fixture)

    await source.listMissions()
    await source.listMarkers(fixture.missionId)
    await source.readMissionReview({
      missionId: fixture.missionId,
      includeTelemetry: false,
      auditLimit: 100,
    }, 'immutability-review')
    expectReadOnlyPropertyAccess(source, 'upsertDrawing')
    await expect(source.listMarkers(fixture.decoyMissionId)).rejects.toThrow()
    await source.close()

    const afterBytes = await readFile(fixture.databasePath)
    const afterStat = await stat(fixture.databasePath)
    expect(sha256(afterBytes)).toBe(sha256(beforeBytes))
    expect(afterBytes.equals(beforeBytes)).toBe(true)
    expect(afterStat.mode & 0o777).toBe(0o444)
    expect(afterStat.mtimeMs).toBe(beforeStat.mtimeMs)

    await expect(source.info()).rejects.toMatchObject({
      code: 'ARCHIVE_REVIEW_SESSION_CLOSED',
    })
    await expect(source.listMissions()).rejects.toMatchObject({
      code: 'ARCHIVE_REVIEW_SESSION_CLOSED',
    })
    await expect(source.readMissionReplay({
      missionId: fixture.missionId,
      selectedTime: fixture.selectedTime,
      trackLimit: 100,
    })).rejects.toMatchObject({ code: 'ARCHIVE_REVIEW_SESSION_CLOSED' })
  })

  it('keeps every review read bound to the database inode pinned when the source opened', async () => {
    const fixture = await createV13Fixture()
    const movedDatabasePath = path.join(fixture.root, 'pinned-original.sqlite')
    const substituteDatabasePath = path.join(fixture.root, 'substituted-live.sqlite')
    await copyFile(fixture.databasePath, substituteDatabasePath)
    await chmod(substituteDatabasePath, 0o600)
    const substitute = new Database(substituteDatabasePath)
    substitute.prepare('UPDATE missions SET name = ? WHERE id = ?')
      .run('SUBSTITUTED LIVE', fixture.missionId)
    substitute.close()
    await chmod(substituteDatabasePath, 0o444)

    const source = createSource(fixture)
    await rename(fixture.databasePath, movedDatabasePath)
    await symlink(substituteDatabasePath, fixture.databasePath)
    try {
      await expect(source.listMissions()).resolves.toEqual([
        expect.objectContaining({
          id: fixture.missionId,
          name: 'Archived active-row attack mission',
        }),
      ])
      expect(JSON.stringify(await source.listMissions())).not.toContain('SUBSTITUTED LIVE')
    } finally {
      await source.close()
    }
  })

  it('opens only the restored attachment mapped to the exact archived evidence reference', async () => {
    const fixture = await createV13Fixture()
    const attachmentsDirectory = path.join(path.dirname(fixture.databasePath), 'attachments')
    const entryName = 'attachments/00000001-briefing.pdf'
    const restoredPath = path.join(path.dirname(fixture.databasePath), entryName)
    const archivedBytes = Buffer.from('ARCHIVED-BRIEFING')
    await mkdir(attachmentsDirectory, { mode: 0o700 })
    await writeFile(restoredPath, archivedBytes, { mode: 0o600 })
    const openRestoredAttachment = vi.fn(async () => true)
    const source = createSource(fixture, {
      attachmentMappings: [{
        entryName,
        sourceRelativePath: 'briefing.pdf',
        sha256: sha256(archivedBytes),
        sizeBytes: archivedBytes.byteLength,
        references: [{ referenceKind: 'marker', referenceId: fixture.markerId }],
      }],
      openRestoredAttachment,
    })

    try {
      await expect(source.openAttachment({
        missionId: fixture.missionId,
        attachmentPath: '/original/live/mission/attachments/briefing.pdf',
        referenceKind: 'marker',
        referenceId: fixture.markerId,
      })).resolves.toBe(true)
      expect(openRestoredAttachment).toHaveBeenCalledWith({
        restoredPath,
        displayName: 'briefing.pdf',
        expectedSha256: sha256(archivedBytes),
        expectedSizeBytes: archivedBytes.byteLength,
        sessionDirectory: path.dirname(fixture.databasePath),
        signal: expect.any(AbortSignal),
      })
      expect(JSON.stringify(openRestoredAttachment.mock.results)).not.toContain(restoredPath)

      for (const attack of [
        {
          missionId: fixture.missionId,
          attachmentPath: '/original/live/mission/attachments/briefing.pdf',
          referenceKind: 'marker',
          referenceId: 'foreign-marker',
        },
        {
          missionId: fixture.missionId,
          attachmentPath: '/original/live/mission/attachments/other.pdf',
          referenceKind: 'marker',
          referenceId: fixture.markerId,
        },
      ]) {
        await expect(source.openAttachment(attack)).rejects.toMatchObject({
          code: 'ARCHIVE_REVIEW_ATTACHMENT_UNAVAILABLE',
        })
      }
      expect(openRestoredAttachment).toHaveBeenCalledOnce()
    } finally {
      await source.close()
    }
  })

  it('retains failed-opener descriptor cleanup ownership until source close succeeds', async () => {
    const fixture = await createV13Fixture()
    const attachmentsDirectory = path.join(path.dirname(fixture.databasePath), 'attachments')
    const entryName = 'attachments/00000001-briefing.pdf'
    const restoredPath = path.join(path.dirname(fixture.databasePath), entryName)
    const archivedBytes = Buffer.from('ARCHIVED-BRIEFING')
    await mkdir(attachmentsDirectory, { mode: 0o700 })
    await writeFile(restoredPath, archivedBytes, { mode: 0o600 })
    const cleanupClose = vi.fn(async () => undefined)
    const openFailure = Object.assign(new Error('archived attachment failed safely'), {
      code: 'ARCHIVE_REVIEW_ATTACHMENT_UNAVAILABLE',
      cleanupLease: Object.freeze({ close: cleanupClose }),
    })
    const source = createSource(fixture, {
      attachmentMappings: [{
        entryName,
        sourceRelativePath: 'briefing.pdf',
        sha256: sha256(archivedBytes),
        sizeBytes: archivedBytes.byteLength,
        references: [{ referenceKind: 'marker', referenceId: fixture.markerId }],
      }],
      openRestoredAttachment: async () => { throw openFailure },
    })

    await expect(source.openAttachment({
      missionId: fixture.missionId,
      attachmentPath: '/original/live/mission/attachments/briefing.pdf',
      referenceKind: 'marker',
      referenceId: fixture.markerId,
    })).rejects.toMatchObject({ code: 'ARCHIVE_REVIEW_ATTACHMENT_UNAVAILABLE' })
    expect(cleanupClose).not.toHaveBeenCalled()

    await expect(source.close()).resolves.toBeUndefined()
    expect(cleanupClose).toHaveBeenCalledOnce()
  })

  it('retains a returned attachment lease when close races the handoff and its first close fails', async () => {
    const fixture = await createV13Fixture()
    const attachmentsDirectory = path.join(path.dirname(fixture.databasePath), 'attachments')
    const entryName = 'attachments/00000001-briefing.pdf'
    const restoredPath = path.join(path.dirname(fixture.databasePath), entryName)
    const archivedBytes = Buffer.from('ARCHIVED-BRIEFING')
    await mkdir(attachmentsDirectory, { mode: 0o700 })
    await writeFile(restoredPath, archivedBytes, { mode: 0o600 })
    const handoff = deferred<boolean | { readonly opened: true; readonly close: () => Promise<void> }>()
    const leaseClose = vi.fn()
      .mockRejectedValueOnce(new Error('transient returned lease close failure'))
      .mockResolvedValueOnce(undefined)
    const openRestoredAttachment = vi.fn(() => handoff.promise)
    const source = createSource(fixture, {
      attachmentMappings: [{
        entryName,
        sourceRelativePath: 'briefing.pdf',
        sha256: sha256(archivedBytes),
        sizeBytes: archivedBytes.byteLength,
        references: [{ referenceKind: 'marker', referenceId: fixture.markerId }],
      }],
      openRestoredAttachment,
    })
    const opening = source.openAttachment({
      missionId: fixture.missionId,
      attachmentPath: '/original/live/mission/attachments/briefing.pdf',
      referenceKind: 'marker',
      referenceId: fixture.markerId,
    })
    await vi.waitFor(() => expect(openRestoredAttachment).toHaveBeenCalledOnce())
    const closing = Promise.resolve(source.close())

    handoff.resolve(Object.freeze({ opened: true, close: leaseClose }))
    await expect(opening).rejects.toMatchObject({ code: 'ARCHIVE_REVIEW_SESSION_CLOSED' })
    await expect(closing).resolves.toBeUndefined()
    expect(leaseClose).toHaveBeenCalledTimes(2)
  })

  it('retains an opened attachment stage until source close owns its cleanup', async () => {
    const fixture = await createV13Fixture()
    const attachmentBytes = Buffer.from('ARCHIVED-LEASED-ATTACHMENT')
    const restoredPath = path.join(path.dirname(fixture.databasePath), 'attachments', 'leased.txt')
    await mkdir(path.dirname(restoredPath), { recursive: true, mode: 0o700 })
    await writeFile(restoredPath, attachmentBytes, { mode: 0o600 })
    const closeLease = vi.fn(async () => undefined)
    const openRestoredAttachment = vi.fn(async () => ({
      opened: true as const,
      close: closeLease,
    }))
    const source = createSource(fixture, {
      attachmentMappings: [{
        entryName: 'attachments/leased.txt',
        sourceRelativePath: 'leased.txt',
        sha256: sha256(attachmentBytes),
        sizeBytes: attachmentBytes.byteLength,
        references: [{ referenceKind: 'marker', referenceId: fixture.markerId }],
      }],
      openRestoredAttachment,
    })

    await expect(source.openAttachment({
      missionId: fixture.missionId,
      attachmentPath: 'leased.txt',
      referenceKind: 'marker',
      referenceId: fixture.markerId,
    })).resolves.toBe(true)
    expect(closeLease).not.toHaveBeenCalled()

    await source.close()
    expect(closeLease).toHaveBeenCalledOnce()
  })

  it('pages every current, historical-version, and audit attachment reference', async () => {
    const fixture = await createV13Fixture()
    const mapping = {
      entryName: 'attachments/00000001-briefing.pdf',
      sourceRelativePath: 'briefing.pdf',
      sha256: 'a'.repeat(64),
      sizeBytes: 17,
      references: [
        { referenceKind: 'marker', referenceId: fixture.markerId },
        { referenceKind: 'marker_version', referenceId: 'marker-version-1' },
        { referenceKind: 'marker_attachment_ingested', referenceId: 'event-1' },
      ],
    }
    const source = createSource(fixture, { attachmentMappings: [mapping] })

    try {
      const first = await source.listArchiveAttachmentPage({
        missionId: fixture.missionId,
        cursor: null,
        limit: 2,
      })
      expect(first).toEqual({
        entries: [
          {
            attachmentPath: 'briefing.pdf',
            referenceKind: 'marker',
            referenceId: fixture.markerId,
          },
          {
            attachmentPath: 'briefing.pdf',
            referenceKind: 'marker_attachment_ingested',
            referenceId: 'event-1',
          },
        ],
        nextCursor: '2',
        totalCount: 3,
      })
      await expect(source.listArchiveAttachmentPage({
        missionId: fixture.missionId,
        cursor: '2',
        limit: 2,
      })).resolves.toEqual({
        entries: [{
          attachmentPath: 'briefing.pdf',
          referenceKind: 'marker_version',
          referenceId: 'marker-version-1',
        }],
        nextCursor: null,
        totalCount: 3,
      })
    } finally {
      await source.close()
    }
  })

  it('aborts an in-flight attachment handoff before source close can sweep plaintext', async () => {
    const fixture = await createV13Fixture()
    const attachmentsDirectory = path.join(path.dirname(fixture.databasePath), 'attachments')
    const entryName = 'attachments/00000001-briefing.pdf'
    const archivedBytes = Buffer.from('ARCHIVED-BRIEFING')
    await mkdir(attachmentsDirectory, { mode: 0o700 })
    await writeFile(path.join(path.dirname(fixture.databasePath), entryName), archivedBytes, {
      mode: 0o600,
    })
    let observedSignal: AbortSignal | null = null
    const openRestoredAttachment = vi.fn((input: RestoredAttachmentOpenInput) => {
      observedSignal = input.signal
      return new Promise<boolean>((_resolve, reject) => {
        input.signal.addEventListener('abort', () => reject(Object.assign(
          new Error('attachment opening cancelled'),
          { code: 'ARCHIVE_REVIEW_ATTACHMENT_UNAVAILABLE' },
        )), { once: true })
      })
    })
    const source = createSource(fixture, {
      attachmentMappings: [{
        entryName,
        sourceRelativePath: 'briefing.pdf',
        sha256: sha256(archivedBytes),
        sizeBytes: archivedBytes.byteLength,
        references: [{ referenceKind: 'marker', referenceId: fixture.markerId }],
      }],
      openRestoredAttachment,
    })

    const opening = source.openAttachment({
      missionId: fixture.missionId,
      attachmentPath: '/original/live/mission/attachments/briefing.pdf',
      referenceKind: 'marker',
      referenceId: fixture.markerId,
    })
    await vi.waitFor(() => expect(openRestoredAttachment).toHaveBeenCalledOnce())
    await expect(source.openAttachment({
      missionId: fixture.missionId,
      attachmentPath: '/original/live/mission/attachments/briefing.pdf',
      referenceKind: 'marker',
      referenceId: fixture.markerId,
    })).rejects.toMatchObject({ code: 'ARCHIVE_REVIEW_ATTACHMENT_BUSY' })
    expect(openRestoredAttachment).toHaveBeenCalledOnce()
    await expect(source.close()).resolves.toBeUndefined()
    await expect(opening).rejects.toMatchObject({
      code: 'ARCHIVE_REVIEW_ATTACHMENT_UNAVAILABLE',
    })
    expect(observedSignal?.aborted).toBe(true)
  })

  it('rejects missing, malformed, or substituted attachment proofs before the opener', async () => {
    const fixture = await createV13Fixture()
    const openRestoredAttachment = vi.fn(async () => true)
    const mapping = {
      entryName: 'attachments/00000001-briefing.pdf',
      sourceRelativePath: 'briefing.pdf',
      sha256: 'a'.repeat(64),
      sizeBytes: 17,
      references: [{ referenceKind: 'marker', referenceId: fixture.markerId }],
    }
    const attacks: readonly Readonly<Record<string, unknown>>[] = [
      Object.fromEntries(Object.entries(mapping).filter(([key]) => key !== 'sha256')),
      Object.fromEntries(Object.entries(mapping).filter(([key]) => key !== 'sizeBytes')),
      { ...mapping, sha256: 'A'.repeat(64) },
      { ...mapping, sha256: 'a'.repeat(63) },
      { ...mapping, sha256: `${'a'.repeat(63)}z` },
      { ...mapping, sizeBytes: 0 },
      { ...mapping, sizeBytes: 1.5 },
      { ...mapping, sizeBytes: 8 * 1024 * 1024 * 1024 + 1 },
      { ...mapping, unsupportedProofField: true },
    ]

    for (const attack of attacks) {
      expect(() => createSource(fixture, {
        attachmentMappings: [attack],
        openRestoredAttachment,
      })).toThrowError(expect.objectContaining({ code: 'ARCHIVE_REVIEW_INPUT_INVALID' }))
    }
    expect(openRestoredAttachment).not.toHaveBeenCalled()
  })

  it.each([
    {
      label: 'UTF-8 path above 4096 bytes',
      attachmentPath: `/SECRET-${'é'.repeat(2_049)}`,
    },
    {
      label: 'control-character path',
      attachmentPath: '/original/live/mission/attachments/SECRET-\u0000.pdf',
    },
  ])('rejects a $label before the desktop opener without reflecting it', async ({ attachmentPath }) => {
    const fixture = await createV13Fixture()
    const openRestoredAttachment = vi.fn(async () => true)
    const source = createSource(fixture, { openRestoredAttachment })

    try {
      const error = await source.openAttachment({
        missionId: fixture.missionId,
        attachmentPath,
        referenceKind: 'marker',
        referenceId: fixture.markerId,
      }).catch((reason: unknown) => reason as Error & { readonly code?: string })

      expect(error).toMatchObject({ code: 'ARCHIVE_REVIEW_INPUT_INVALID' })
      expect(error.message).not.toContain('SECRET-')
      expect(error.message).not.toContain(attachmentPath)
      expect(openRestoredAttachment).not.toHaveBeenCalled()
    } finally {
      await source.close()
    }
  })

  it('rejects traversal mappings and prevents restored symlinks from reaching the desktop shell', async () => {
    const fixture = await createV13Fixture()
    const outsidePath = path.join(fixture.root, 'outside-must-not-open.txt')
    const outsideBytes = Buffer.from('OUTSIDE')
    await writeFile(outsidePath, outsideBytes, { mode: 0o600 })
    const attachmentsDirectory = path.join(path.dirname(fixture.databasePath), 'attachments')
    await mkdir(attachmentsDirectory, { mode: 0o700 })
    const linkPath = path.join(attachmentsDirectory, '00000001-briefing.pdf')
    await symlink(outsidePath, linkPath)
    const openPath = vi.fn(async () => '')
    const openRestoredAttachment = vi.fn(async (input: RestoredAttachmentOpenInput) =>
      openVerifiedRestoredAttachment({ ...input, openPath }))

    expect(() => createSource(fixture, {
      attachmentMappings: [{
        entryName: 'attachments/../outside-must-not-open.txt',
        sourceRelativePath: 'briefing.pdf',
        sha256: sha256(outsideBytes),
        sizeBytes: outsideBytes.byteLength,
        references: [{ referenceKind: 'marker', referenceId: fixture.markerId }],
      }],
      openRestoredAttachment,
    })).toThrowError(expect.objectContaining({ code: 'ARCHIVE_REVIEW_INPUT_INVALID' }))

    const source = createSource(fixture, {
      attachmentMappings: [{
        entryName: 'attachments/00000001-briefing.pdf',
        sourceRelativePath: 'briefing.pdf',
        sha256: sha256(outsideBytes),
        sizeBytes: outsideBytes.byteLength,
        references: [{ referenceKind: 'marker', referenceId: fixture.markerId }],
      }],
      openRestoredAttachment,
    })
    try {
      await expect(source.openAttachment({
        missionId: fixture.missionId,
        attachmentPath: '/original/live/mission/attachments/briefing.pdf',
        referenceKind: 'marker',
        referenceId: fixture.markerId,
      })).rejects.toMatchObject({ code: 'ARCHIVE_REVIEW_ATTACHMENT_UNAVAILABLE' })
      expect(openRestoredAttachment).toHaveBeenCalledOnce()
      expect(openPath).not.toHaveBeenCalled()
      expect(await readFile(outsidePath, 'utf8')).toBe('OUTSIDE')
    } finally {
      await source.close()
    }
  })
})

function createSource(
  fixture: Fixture,
  overrides: Partial<ArchiveReviewSourceOptions> = {},
): ArchiveReviewSource {
  return createArchiveReviewSource({
    databasePath: fixture.databasePath,
    missionId: fixture.missionId,
    sessionId: fixture.sessionId,
    ...overrides,
  })
}

function projectionCall(
  _databasePath: string,
  method: ProjectionRunnerInput['method'],
  missionId?: string,
  query?: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return {
    databasePath: pinnedDatabasePathMatcher(),
    method,
    missionId,
    query,
    hasAbortSignal: true,
  }
}

function pinnedDatabasePathMatcher(): ReturnType<typeof expect.stringMatching> {
  return expect.stringMatching(/^\/(?:dev\/fd|proc\/self\/fd)\/\d+$/u)
}

async function createV13Fixture(): Promise<Fixture> {
  const root = await mkdtemp(path.join(tmpdir(), 'archive-review-source-'))
  fixtureRoots.add(root)
  const sessionId = 'archive-review-session-00000001'
  const userDataPath = path.join(root, '.review', 'session-secret')
  await mkdir(userDataPath, { recursive: true })
  const store = createElectronMissionStore({ userDataPath })
  try {
    const decoy = await store.createMission({
      name: 'Decoy mission that must never escape',
      start_time: '2026-08-30T07:00:00.000Z',
    })
    await store.finishMission(decoy.id)
    const mission = await store.createMission({
      name: 'Archived active-row attack mission',
      start_time: '2026-08-30T08:00:00.000Z',
    })
    await store.upsertDevice({
      mission_id: mission.id,
      device_id: 'tracker-archive',
      name: 'Archive Tracker',
      color: '#0077AA',
      status: 'online',
      last_seen: '2026-08-30T09:00:00.000Z',
    })
    await store.addPosition({
      source_position_id: 'archive-fix-1',
      mission_id: mission.id,
      device_id: 'tracker-archive',
      lat: 52.0599,
      lon: -9.5045,
      timestamp: '2026-08-30T09:00:00.000Z',
      timestamp_source: 'fix',
    })
    const marker = await store.upsertMarker({
      mission_id: mission.id,
      type: 'ipp_lkp',
      name: 'Archive IPP',
      lat: 52.0599,
      lon: -9.5045,
      irish_grid_e: 480000,
      irish_grid_n: 580000,
      display_order: 0,
      label_size: 14,
      attachment_path: '/original/live/mission/attachments/briefing.pdf',
    })
    await store.upsertDrawing({
      mission_id: mission.id,
      type: 'search_area',
      name: 'Archive sector',
      display_order: 0,
      geometry_json: '{"type":"Polygon","coordinates":[]}',
    })
    await store.upsertHelicopter({
      mission_id: mission.id,
      slot_key: 'slot_1',
      call_sign: 'Rescue Archive',
      lat: 52.06,
      lon: -9.5,
    })
    await store.upsertGpxImport({
      mission_id: mission.id,
      source_path: '/original/live/mission/tracks/ridge.gpx',
      file_name: 'ridge.gpx',
      display_name: 'Archive ridge track',
      geometry_json: '{"type":"LineString","coordinates":[]}',
    })
    await store.createOuting({ mission_id: mission.id, label: 'Archive outing' })
    await store.upsertSearchArea({
      mission_id: mission.id,
      name: 'Archive Area',
      status: 'active',
      geometry_json: '{"type":"Polygon","coordinates":[]}',
      updated_by: 'Archive Coordinator',
    })
    await store.upsertLayerCatalogMetadata({
      missionId: mission.id,
      nodeId: 'group:archive-tracking',
      parentNodeId: null,
      nodeKind: 'group',
      isVisible: false,
    })
    const info = await store.info()
    expect(info.schema_version).toBe(CURRENT_SCHEMA_VERSION)
    expect(info.schema_version).toBe(13)
    await store.prepareClose()
    store.close()
    const archivedDatabase = new Database(info.database_path)
    archivedDatabase.pragma('journal_mode = DELETE')
    archivedDatabase.close()
    await chmod(info.database_path, 0o444)
    return {
      root,
      databasePath: info.database_path,
      missionId: mission.id,
      decoyMissionId: decoy.id,
      sessionId,
      selectedTime: new Date().toISOString(),
      markerId: marker.id,
    }
  } catch (error) {
    try {
      store.close()
    } catch {
      // Preserve the original fixture-construction failure.
    }
    throw error
  }
}

function expectReadOnlyPropertyAccess(source: ArchiveReviewSource, property: string): void {
  expect(() => Reflect.get(
    source as unknown as Record<string, unknown>,
    property,
  )).toThrow(expect.objectContaining({ code: 'ARCHIVE_REVIEW_READ_ONLY' }))
}

function createAbortableReviewRunner(): {
  readonly runner: ReviewRunner
  readonly started: Promise<void>
  readonly signal: AbortSignal | null
} {
  let markStarted = () => undefined
  let observedSignal: AbortSignal | null = null
  const started = new Promise<void>((resolve) => { markStarted = resolve })
  const runner: ReviewRunner = (input) => {
    observedSignal = input.signal ?? null
    markStarted()
    const workerExited = Promise.resolve()
    const result = new Promise<unknown>((_resolve, reject) => {
      input.signal?.addEventListener('abort', () => {
        const error = new Error('Mission Review read worker was cancelled.')
        error.name = 'AbortError'
        reject(error)
      }, { once: true })
    }) as WorkerPromise
    Object.defineProperty(result, 'workerExited', { value: workerExited })
    return result
  }
  return {
    runner,
    started,
    get signal() {
      return observedSignal
    },
  }
}

function sha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}
