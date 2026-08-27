import { EventEmitter } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

import { afterEach, describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')

const runnerPath = '../../electron/breadcrumb-dot-query-runner.cjs'
let tempDirectory: string | undefined

afterEach(async () => {
  if (tempDirectory !== undefined) {
    await rm(tempDirectory, { recursive: true, force: true })
    tempDirectory = undefined
  }
})

describe('exact breadcrumb-dot worker runner', () => {
  it('returns the exact SQLite page from an isolated worker', async () => {
    tempDirectory = await mkdtemp(path.join(tmpdir(), 'sartracker-dot-runner-'))
    const databasePath = path.join(tempDirectory, 'mission-store.sqlite')
    const database = new Database(databasePath)
    database.exec(`
      CREATE TABLE missions (
        id TEXT PRIMARY KEY,
        start_time TEXT NOT NULL
      );
      CREATE TABLE devices (
        id TEXT PRIMARY KEY,
        mission_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        UNIQUE (mission_id, device_id)
      );
      CREATE TABLE positions (
        id TEXT PRIMARY KEY,
        mission_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        source_position_id TEXT,
        lat REAL NOT NULL,
        lon REAL NOT NULL,
        timestamp TEXT NOT NULL,
        data_origin TEXT NOT NULL,
        timestamp_source TEXT NOT NULL DEFAULT 'fix'
      );
      INSERT INTO missions VALUES
        ('mission-a', '2026-08-10T09:00:00.000Z');
      INSERT INTO devices VALUES
        ('device-local-1', 'mission-a', 'device-1');
      INSERT INTO positions VALUES
        ('local-1', 'mission-a', 'device-1', 'source-1', 52.1, -9.1,
         '2026-08-10T10:00:00.000Z', 'live', 'fix');
    `)
    database.close()

    const { runBreadcrumbDotQueryInWorker } = require(runnerPath) as {
      readonly runBreadcrumbDotQueryInWorker: (input: {
        readonly databasePath: string
        readonly query: {
          readonly missionId: string
          readonly activeDeviceIds: readonly string[]
          readonly limit: number
          readonly direction: 'latest'
        }
      }) => Promise<{ readonly positions: readonly { readonly id: string }[] }>
    }
    await expect(runBreadcrumbDotQueryInWorker({
      databasePath,
      query: {
        missionId: 'mission-a',
        activeDeviceIds: [],
        limit: 10_000,
        direction: 'latest',
      },
    })).resolves.toEqual(expect.objectContaining({
      positions: [expect.objectContaining({ id: 'local-1' })],
      workerThreadId: expect.any(Number),
    }))
  })

  it('terminates an unresolved exact-dot worker on cancellation', async () => {
    tempDirectory = await mkdtemp(path.join(tmpdir(), 'sartracker-dot-abort-'))
    const workerPath = path.join(tempDirectory, 'hanging-worker.cjs')
    await writeFile(workerPath, 'setInterval(() => {}, 1_000)\n', 'utf8')
    const { runBreadcrumbDotQueryInWorker } = require(runnerPath) as {
      readonly runBreadcrumbDotQueryInWorker: (input: {
        readonly databasePath: string
        readonly query: {
          readonly missionId: string
          readonly activeDeviceIds: readonly string[]
          readonly limit: number
          readonly direction: 'latest'
        }
        readonly workerPath: string
        readonly timeoutMs: number
        readonly signal: AbortSignal
      }) => Promise<unknown>
    }
    const controller = new AbortController()
    const result = runBreadcrumbDotQueryInWorker({
      databasePath: path.join(tempDirectory, 'unused.sqlite'),
      query: {
        missionId: 'mission-a',
        activeDeviceIds: [],
        limit: 10_000,
        direction: 'latest',
      },
      workerPath,
      timeoutMs: 10_000,
      signal: controller.signal,
    })

    controller.abort()

    await expect(result).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('does not settle a timeout until the timed-out worker has terminated', async () => {
    tempDirectory = await mkdtemp(path.join(tmpdir(), 'sartracker-dot-timeout-'))
    const workerPath = path.join(tempDirectory, 'hanging-worker.cjs')
    await writeFile(workerPath, 'setInterval(() => {}, 1_000)\n', 'utf8')
    const termination = createDeferred<number>()
    const fakeWorker = Object.assign(new EventEmitter(), {
      terminate: vi.fn(() => termination.promise),
    })
    const createWorker = vi.fn(() => fakeWorker)
    const { runBreadcrumbDotQueryInWorker } = require(runnerPath) as {
      readonly runBreadcrumbDotQueryInWorker: (input: {
        readonly databasePath: string
        readonly query: {
          readonly missionId: string
          readonly activeDeviceIds: readonly string[]
          readonly limit: number
          readonly direction: 'latest'
        }
        readonly workerPath: string
        readonly timeoutMs: number
        readonly signal: AbortSignal
        readonly createWorker: typeof createWorker
      }) => Promise<unknown>
    }
    const controller = new AbortController()
    const result = runBreadcrumbDotQueryInWorker({
      databasePath: path.join(tempDirectory, 'unused.sqlite'),
      query: {
        missionId: 'mission-a',
        activeDeviceIds: [],
        limit: 10_000,
        direction: 'latest',
      },
      workerPath,
      timeoutMs: 10,
      signal: controller.signal,
      createWorker,
    })
    let settled = false
    const observeSettlement = result.then(
      () => { settled = true },
      () => { settled = true },
    )

    try {
      await delay(30)
      expect(createWorker).toHaveBeenCalledOnce()
      expect(fakeWorker.terminate).toHaveBeenCalledOnce()
      expect(settled).toBe(false)
      termination.resolve(1)
      await expect(result).rejects.toThrow(/timed out/iu)
    } finally {
      termination.resolve(1)
      controller.abort()
      await observeSettlement
    }
  })

  it('does not settle a worker-reported error until that worker has terminated', async () => {
    tempDirectory = await mkdtemp(path.join(tmpdir(), 'sartracker-dot-error-'))
    const workerPath = path.join(tempDirectory, 'hanging-worker.cjs')
    await writeFile(workerPath, 'setInterval(() => {}, 1_000)\n', 'utf8')
    const termination = createDeferred<number>()
    const fakeWorker = Object.assign(new EventEmitter(), {
      terminate: vi.fn(() => termination.promise),
    })
    const createWorker = vi.fn(() => fakeWorker)
    const { runBreadcrumbDotQueryInWorker } = require(runnerPath) as {
      readonly runBreadcrumbDotQueryInWorker: (input: {
        readonly databasePath: string
        readonly query: {
          readonly missionId: string
          readonly activeDeviceIds: readonly string[]
          readonly limit: number
          readonly direction: 'latest'
        }
        readonly workerPath: string
        readonly timeoutMs: number
        readonly signal: AbortSignal
        readonly createWorker: typeof createWorker
      }) => Promise<unknown>
    }
    const controller = new AbortController()
    const result = runBreadcrumbDotQueryInWorker({
      databasePath: path.join(tempDirectory, 'unused.sqlite'),
      query: {
        missionId: 'mission-a',
        activeDeviceIds: [],
        limit: 10_000,
        direction: 'latest',
      },
      workerPath,
      timeoutMs: 10_000,
      signal: controller.signal,
      createWorker,
    })
    let settled = false
    const observeSettlement = result.then(
      () => { settled = true },
      () => { settled = true },
    )

    try {
      expect(createWorker).toHaveBeenCalledOnce()
      fakeWorker.emit('message', {
        type: 'error',
        name: 'Error',
        message: 'read failed',
      })
      await Promise.resolve()
      expect(fakeWorker.terminate).toHaveBeenCalledOnce()
      expect(settled).toBe(false)
      termination.resolve(1)
      await expect(result).rejects.toThrow(/read failed/iu)
    } finally {
      termination.resolve(1)
      controller.abort()
      await observeSettlement
    }
  })
})

function createDeferred<T>(): {
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
} {
  let resolvePromise: (value: T) => void = () => undefined
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve
  })
  return { promise, resolve: resolvePromise }
}

function delay(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs))
}
