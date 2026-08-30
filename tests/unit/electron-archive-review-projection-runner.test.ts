import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)

const PROJECTION_METHODS = [
  'listMissions',
  'listMarkers',
  'listDevices',
  'listDrawings',
  'listHelicopters',
  'listGpxImports',
  'listGpxImportPage',
  'listOutings',
  'listLayerCatalogMetadata',
] as const

type ProjectionMethod = typeof PROJECTION_METHODS[number]
type ProjectionResult =
  | readonly Readonly<Record<string, unknown>>[]
  | Readonly<{
      entries: readonly Readonly<Record<string, unknown>>[]
      nextCursor: string | null
    }>
type ProjectionOperation = Promise<ProjectionResult> & {
  readonly workerExited: Promise<void>
}
type WorkerInput = Readonly<{
  workerData: Readonly<Record<string, unknown>>
  workerPath: string
}>

const { runArchiveReviewProjectionInWorker } = require(
  '../../electron/archive-review-projection-runner.cjs',
) as {
  readonly runArchiveReviewProjectionInWorker: (input: {
    readonly databasePath: string
    readonly method: ProjectionMethod
    readonly missionId?: string
    readonly query?: Readonly<Record<string, unknown>>
    readonly signal?: AbortSignal
    readonly workerPath?: string
    readonly createWorker?: (input: WorkerInput) => FakeWorker
    readonly timeoutMs?: number
  }) => ProjectionOperation
}

/** Minimal worker double for exact-envelope and lifecycle attacks. */
class FakeWorker extends EventEmitter {
  readonly posted: Array<Readonly<Record<string, unknown>>> = []
  readonly terminate = vi.fn(async () => 1)

  postMessage(message: Readonly<Record<string, unknown>>): void {
    this.posted.push(structuredClone(message))
  }
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('archive review projection worker runner [DON-252 / BCP-15]', () => {
  it.each(PROJECTION_METHODS)(
    'passes only the exact bounded %s request to an off-main worker',
    async (method) => {
      const worker = new FakeWorker()
      let workerInput: WorkerInput | undefined
      const databasePath = path.resolve('/archive-review/session/mission-store.sqlite')
      const query = method === 'listGpxImportPage'
        ? Object.freeze({ missionId: 'mission-archive', cursor: null, limit: 25 })
        : undefined
      const operation = runArchiveReviewProjectionInWorker({
        databasePath,
        method,
        ...(query === undefined ? { missionId: 'mission-archive' } : { query }),
        createWorker: (input) => {
          workerInput = input
          return worker
        },
      })

      expect(workerInput).toEqual({
        workerPath: expect.stringMatching(/archive-review-projection-worker\.cjs$/u),
        workerData: query === undefined
          ? { databasePath, method, missionId: 'mission-archive' }
          : { databasePath, method, query },
      })
      expect(Object.isFrozen(workerInput)).toBe(true)
      expect(Object.isFrozen(workerInput?.workerData)).toBe(true)

      const result: ProjectionResult = method === 'listGpxImportPage'
        ? { entries: [{ id: 'gpx-1' }], nextCursor: 'page-2' }
        : [{ id: `${method}-1` }]
      worker.emit('message', { type: 'complete', method, result })
      let publiclySettled = false
      void operation.finally(() => { publiclySettled = true })
      await Promise.resolve()
      expect(publiclySettled).toBe(false)

      worker.emit('exit', 0)
      await expect(operation).resolves.toEqual(result)
      await expect(operation.workerExited).resolves.toBeUndefined()
    },
  )

  it.each([
    'createMission',
    'upsertMarker',
    'deleteMarker',
    'finishMission',
    'finalizeMission',
    'unlockFinalizedMission',
    'unknownFutureRead',
  ])('rejects unsupported or mutation method %s before worker creation', (method) => {
    const createWorker = vi.fn()

    expect(() => runArchiveReviewProjectionInWorker({
      databasePath: path.resolve('/archive-review/session/mission-store.sqlite'),
      method: method as ProjectionMethod,
      missionId: 'mission-archive',
      createWorker,
    })).toThrow(/projection request|method/iu)
    expect(createWorker).not.toHaveBeenCalled()
  })

  it('rejects malformed, unresolved, foreign-field, and unbounded requests before worker creation', () => {
    const createWorker = vi.fn()
    const databasePath = path.resolve('/archive-review/session/mission-store.sqlite')
    const attacks: readonly Readonly<Record<string, unknown>>[] = [
      { databasePath: 'relative.sqlite', method: 'listMarkers', missionId: 'mission-archive' },
      {
        databasePath: `${path.parse(databasePath).root}archive-review/../outside.sqlite`,
        method: 'listMarkers',
        missionId: 'mission-archive',
      },
      { databasePath, method: 'listMarkers' },
      { databasePath, method: 'listMarkers', missionId: '' },
      { databasePath, method: 'listMarkers', missionId: `mission-${'x'.repeat(201)}` },
      {
        databasePath,
        method: 'listMarkers',
        missionId: 'mission-archive',
        query: { missionId: 'mission-archive', limit: 25 },
      },
      {
        databasePath,
        method: 'listGpxImportPage',
        missionId: 'mission-archive',
        query: { missionId: 'mission-archive', limit: 25 },
      },
      { databasePath, method: 'listGpxImportPage' },
      { databasePath, method: 'listGpxImportPage', query: null },
      {
        databasePath,
        method: 'listGpxImportPage',
        query: { missionId: 'mission-archive', limit: 0 },
      },
      {
        databasePath,
        method: 'listGpxImportPage',
        query: { missionId: 'mission-archive', limit: 101 },
      },
      {
        databasePath,
        method: 'listGpxImportPage',
        query: { missionId: 'mission-archive', cursor: 'x'.repeat(2_049), limit: 25 },
      },
      {
        databasePath,
        method: 'listGpxImportPage',
        query: { missionId: 'mission-archive', limit: 25, mutation: 'delete' },
      },
      {
        databasePath,
        method: 'listDevices',
        missionId: 'mission-archive',
        hostileExtraField: true,
      },
    ]

    for (const attack of attacks) {
      expect(() => runArchiveReviewProjectionInWorker({
        ...attack,
        createWorker,
      } as never)).toThrow(/projection request|database|mission|query/iu)
    }
    expect(createWorker).not.toHaveBeenCalled()
  })

  it.each([
    { operationMethod: 'listMarkers', message: null },
    { operationMethod: 'listMarkers', message: [] },
    {
      operationMethod: 'listMarkers',
      message: { type: 'complete', method: 'listMarkers' },
    },
    {
      operationMethod: 'listMarkers',
      message: { type: 'complete', method: 'listDevices', result: [] },
    },
    {
      operationMethod: 'listMarkers',
      message: {
        type: 'complete',
        method: 'listMarkers',
        result: {},
        reflectedPath: '/secret',
      },
    },
    {
      operationMethod: 'listMarkers',
      message: { type: 'complete', method: 'listMarkers', result: { rows: [] } },
    },
    {
      operationMethod: 'listMarkers',
      message: { type: 'complete', method: 'listMarkers', result: [{ value: Infinity }] },
    },
    {
      operationMethod: 'listMarkers',
      message: { type: 'complete', method: 'listMarkers', result: [{ value: 1n }] },
    },
    {
      operationMethod: 'listGpxImportPage',
      message: { type: 'complete', method: 'listGpxImportPage', result: [] },
    },
    {
      operationMethod: 'listGpxImportPage',
      message: { type: 'complete', method: 'listGpxImportPage', result: { entries: [] } },
    },
    {
      operationMethod: 'listGpxImportPage',
      message: {
        type: 'complete',
        method: 'listGpxImportPage',
        result: { entries: [], nextCursor: null, extra: true },
      },
    },
    {
      operationMethod: 'listGpxImportPage',
      message: {
        type: 'complete',
        method: 'listGpxImportPage',
        result: { entries: [], nextCursor: 123 },
      },
    },
  ] as const)(
    'fails closed on malformed, mismatched, or extra-field terminal output %#',
    async ({ operationMethod, message }) => {
    const worker = new FakeWorker()
    const databasePath = path.resolve('/archive-review/session/mission-store.sqlite')
    const secret = `${databasePath}/SECRET-RESULT`
    const operation = runArchiveReviewProjectionInWorker({
      databasePath,
      method: operationMethod,
      ...(operationMethod === 'listGpxImportPage'
        ? { query: { missionId: 'mission-archive', limit: 25 } }
        : { missionId: 'mission-archive' }),
      createWorker: () => worker,
    })

    worker.emit('message', message === null ? message : structuredClone(message))
    const error = await operation.catch((reason: unknown) => reason as Error)
    expect(error.message).toMatch(/projection worker|terminal output|invalid/iu)
    expect(error.message).not.toContain(databasePath)
    expect(error.message).not.toContain(secret)
    expect(worker.posted).toEqual([{ type: 'cancel' }])

    worker.emit('exit', 1)
    await expect(operation.workerExited).resolves.toBeUndefined()
    },
  )

  it('rejects unbounded row counts and serialized results without reflecting worker data', async () => {
    const databasePath = path.resolve('/archive-review/session/mission-store.sqlite')
    const attacks: readonly ProjectionResult[] = [
      Array.from({ length: 100_001 }, (_value, index) => ({ id: `row-${index}` })),
      [{ id: 'row-secret', value: `SECRET-${'x'.repeat(64 * 1024 * 1024)}` }],
    ]

    for (const result of attacks) {
      const worker = new FakeWorker()
      const operation = runArchiveReviewProjectionInWorker({
        databasePath,
        method: 'listMarkers',
        missionId: 'mission-archive',
        createWorker: () => worker,
      })
      worker.emit('message', { type: 'complete', method: 'listMarkers', result })

      const error = await operation.catch((reason: unknown) => reason as Error)
      expect(error.message).toMatch(/projection worker|terminal output|invalid|bound/iu)
      expect(error.message).not.toContain('SECRET-')
      expect(error.message).not.toContain(databasePath)
      worker.emit('exit', 1)
      await expect(operation.workerExited).resolves.toBeUndefined()
    }
  }, 20_000)

  it.each([
    {
      method: 'listMissions',
      query: undefined,
      result: [{ id: 'mission-archive' }, { id: 'foreign-mission' }],
    },
    {
      method: 'listGpxImportPage',
      query: { missionId: 'mission-archive', limit: 25 },
      result: {
        entries: Array.from({ length: 26 }, (_value, index) => ({ id: `gpx-${index}` })),
        nextCursor: null,
      },
    },
    {
      method: 'listGpxImportPage',
      query: { missionId: 'mission-archive', limit: 25 },
      result: { entries: [], nextCursor: 'x'.repeat(2_049) },
    },
  ] as const)(
    'enforces the method-specific result bound for $method',
    async ({ method, query, result }) => {
      const worker = new FakeWorker()
      const operation = runArchiveReviewProjectionInWorker({
        databasePath: path.resolve('/archive-review/session/mission-store.sqlite'),
        method,
        ...(query === undefined
          ? { missionId: 'mission-archive' }
          : { query }),
        createWorker: () => worker,
      })

      worker.emit('message', { type: 'complete', method, result })
      await expect(operation).rejects.toThrow(/projection worker|invalid|bound/iu)
      expect(worker.posted).toEqual([{ type: 'cancel' }])
      worker.emit('exit', 1)
      await expect(operation.workerExited).resolves.toBeUndefined()
    },
  )

  it('rejects a duplicate terminal message instead of accepting the first result', async () => {
    const worker = new FakeWorker()
    const operation = runArchiveReviewProjectionInWorker({
      databasePath: path.resolve('/archive-review/session/mission-store.sqlite'),
      method: 'listMarkers',
      missionId: 'mission-archive',
      createWorker: () => worker,
    })

    worker.emit('message', { type: 'complete', method: 'listMarkers', result: [] })
    worker.emit('message', { type: 'complete', method: 'listMarkers', result: [] })

    await expect(operation).rejects.toThrow(/duplicate|projection worker|terminal/iu)
    expect(worker.posted).toEqual([{ type: 'cancel' }])
    worker.emit('exit', 1)
    await expect(operation.workerExited).resolves.toBeUndefined()
  })

  it('rejects cancellation promptly but owns the worker until physical exit', async () => {
    const worker = new FakeWorker()
    const controller = new AbortController()
    const operation = runArchiveReviewProjectionInWorker({
      databasePath: path.resolve('/archive-review/session/mission-store.sqlite'),
      method: 'listMarkers',
      missionId: 'mission-archive',
      signal: controller.signal,
      createWorker: () => worker,
    })

    controller.abort()
    await expect(operation).rejects.toMatchObject({ name: 'AbortError' })
    expect(worker.posted).toEqual([{ type: 'cancel' }])
    let physicallyExited = false
    void operation.workerExited.then(() => { physicallyExited = true })
    await Promise.resolve()
    expect(physicallyExited).toBe(false)

    worker.emit('exit', 1)
    await expect(operation.workerExited).resolves.toBeUndefined()
  })

  it('rejects an already-aborted request without constructing a worker', async () => {
    const controller = new AbortController()
    const createWorker = vi.fn()
    controller.abort()

    const operation = runArchiveReviewProjectionInWorker({
      databasePath: path.resolve('/archive-review/session/mission-store.sqlite'),
      method: 'listMarkers',
      missionId: 'mission-archive',
      signal: controller.signal,
      createWorker,
    })

    await expect(operation).rejects.toMatchObject({ name: 'AbortError' })
    await expect(operation.workerExited).resolves.toBeUndefined()
    expect(createWorker).not.toHaveBeenCalled()
  })

  it('does not lose an abort fired synchronously during worker construction', async () => {
    const controller = new AbortController()
    const worker = new FakeWorker()
    const operation = runArchiveReviewProjectionInWorker({
      databasePath: path.resolve('/archive-review/session/mission-store.sqlite'),
      method: 'listMarkers',
      missionId: 'mission-archive',
      signal: controller.signal,
      createWorker: () => {
        controller.abort()
        return worker
      },
    })

    await expect(operation).rejects.toMatchObject({ name: 'AbortError' })
    expect(worker.posted).toEqual([{ type: 'cancel' }])
    worker.emit('exit', 1)
    await expect(operation.workerExited).resolves.toBeUndefined()
  })

  it('does not reflect worker-controlled error messages or physical-exit values', async () => {
    const databasePath = path.resolve('/archive-review/session/mission-store.sqlite')
    for (const terminal of ['error', 'exit'] as const) {
      const worker = new FakeWorker()
      const operation = runArchiveReviewProjectionInWorker({
        databasePath,
        method: 'listMarkers',
        missionId: 'mission-archive',
        createWorker: () => worker,
      })
      const secret = `${databasePath}/SECRET-WORKER-FAILURE`
      if (terminal === 'error') worker.emit('error', new Error(secret))
      else worker.emit('exit', secret)

      const error = await operation.catch((reason: unknown) => reason as Error)
      expect(error.message).toMatch(/projection worker/iu)
      expect(error.message).not.toContain(databasePath)
      expect(error.message).not.toContain('SECRET-WORKER-FAILURE')
      if (terminal === 'error') {
        worker.emit('exit', 1)
      }
      await expect(operation.workerExited).resolves.toBeUndefined()
    }
  })

  it('uses a bounded watchdog and does not release physical-exit ownership on timeout', async () => {
    vi.useFakeTimers()
    const worker = new FakeWorker()
    const operation = runArchiveReviewProjectionInWorker({
      databasePath: path.resolve('/archive-review/session/mission-store.sqlite'),
      method: 'listMarkers',
      missionId: 'mission-archive',
      timeoutMs: 25,
      createWorker: () => worker,
    })
    const failure = operation.catch((reason: unknown) => reason as Error)

    await vi.advanceTimersByTimeAsync(24)
    expect(worker.posted).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    await expect(failure).resolves.toEqual(expect.objectContaining({
      message: expect.stringMatching(/timed out|progress/iu),
    }))
    expect(worker.posted).toEqual([{ type: 'cancel' }])

    let physicallyExited = false
    void operation.workerExited.then(() => { physicallyExited = true })
    await Promise.resolve()
    expect(physicallyExited).toBe(false)
    worker.emit('exit', 1)
    await expect(operation.workerExited).resolves.toBeUndefined()
  })

  it('settles workerExited when construction fails before a worker exists', async () => {
    const constructionError = new Error('worker threads unavailable SECRET-WORKER')
    const operation = runArchiveReviewProjectionInWorker({
      databasePath: path.resolve('/archive-review/session/mission-store.sqlite'),
      method: 'listMarkers',
      missionId: 'mission-archive',
      createWorker: () => { throw constructionError },
    })

    const error = await operation.catch((reason: unknown) => reason as Error)
    expect(error.message).toMatch(/could not start|projection worker/iu)
    expect(error.message).not.toContain('SECRET-WORKER')
    await expect(operation.workerExited).resolves.toBeUndefined()
  })
})
