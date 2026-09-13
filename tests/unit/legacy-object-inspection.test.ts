import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { threadId as parentThreadId, Worker, type WorkerOptions } from 'node:worker_threads'

import { afterEach, describe, expect, it } from 'vitest'

import {
  openLegacyObjectInspection,
} from '../support/legacy-object-inspection'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3') as new (path: string) => {
  exec(sql: string): void
  close(): void
}

describe('legacy object inspection worker boundary', () => {
  let temporaryDirectory: string | undefined

  afterEach(async () => {
    if (temporaryDirectory !== undefined) {
      await rm(temporaryDirectory, { recursive: true, force: true })
      temporaryDirectory = undefined
    }
  })

  it('counts from a readonly worker and returns worker timing identity', async () => {
    const databasePath = await createDatabase(3)
    const inspection = await openLegacyObjectInspection(databasePath)

    await expect(inspection.count()).resolves.toEqual({
      count: 3,
      workerQueryElapsedMs: expect.any(Number),
      workerThreadId: expect.any(Number),
    })
    const second = await inspection.count()
    expect(second.count).toBe(3)
    expect(second.workerThreadId).toBeGreaterThan(0)
    expect(second.workerThreadId).not.toBe(parentThreadId)
    expect(second.workerQueryElapsedMs).toBeGreaterThanOrEqual(0)
    await expect(inspection.close()).resolves.toBeUndefined()
  })

  it('rejects when the worker cannot open the SQLite file', async () => {
    const databasePath = await createDatabase(0)
    const missingPath = path.join(path.dirname(databasePath), 'missing.sqlite')

    await expect(openLegacyObjectInspection(missingPath))
      .rejects.toThrow(/unable to open|no such file|file.*exist/i)
  })

  it('retains a real SQLite read failure through close', async () => {
    const databasePath = await createDatabase(0)
    const database = new Database(databasePath)
    database.exec('DROP TABLE mission_object_versions')
    database.close()
    const inspection = await openLegacyObjectInspection(databasePath)

    await expect(inspection.count()).rejects.toThrow(/no such table|mission_object_versions/i)
    await expect(inspection.close()).rejects.toThrow(/no such table|mission_object_versions/i)
  })

  it('keeps the strict main-thread gate when the inspector is active', async () => {
    const databasePath = await createDatabase(0)
    const inspection = await openLegacyObjectInspection(databasePath)
    let maximumHeartbeatGapMs = 0
    let lastHeartbeat = performance.now()
    const heartbeat = setInterval(() => {
      const current = performance.now()
      maximumHeartbeatGapMs = Math.max(maximumHeartbeatGapMs, current - lastHeartbeat)
      lastHeartbeat = current
    }, 10)

    try {
      await new Promise((resolve) => setTimeout(resolve, 30))
      const count = inspection.count()
      const blockStarted = performance.now()
      while (performance.now() - blockStarted < 250) {
        // Deliberately occupy the caller to prove the strict negative control.
      }
      await expect(count).resolves.toMatchObject({ count: 0 })
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(maximumHeartbeatGapMs).toBeGreaterThanOrEqual(200)
      expect(() => expect(maximumHeartbeatGapMs).toBeLessThan(200)).toThrow()
    } finally {
      clearInterval(heartbeat)
      await inspection.close()
    }
  })

  it('rejects a second count while one request is outstanding', async () => {
    const databasePath = await createDatabase(1)
    const workerPath = await createWorker(`
      if (message.type === 'count') {
        setTimeout(() => parentPort.postMessage({
          type: 'count', requestId: message.requestId, count: 1, queryMs: 0, threadId,
        }), 30)
      }
      if (message.type === 'close') parentPort.close()
    `)
    const inspection = await openLegacyObjectInspection(databasePath, { workerPath })
    const first = inspection.count()

    await expect(inspection.count()).rejects.toThrow(/request in flight/i)
    await expect(first).resolves.toMatchObject({ count: 1 })
    await inspection.close()
  })

  it('times out startup and joins a worker that never becomes ready', async () => {
    const databasePath = await createDatabase(0)
    const workerPath = await createWorker('setInterval(() => {}, 1_000)', false)
    let ownedWorker: Worker | undefined
    const workerFactory = (filename: string, options: WorkerOptions): Worker => {
      const worker = new Worker(filename, options)
      ownedWorker = worker
      return worker
    }

    await expect(openLegacyObjectInspection(databasePath, {
      workerPath,
      startupTimeoutMs: 20,
      workerFactory,
    }))
      .rejects.toThrow(/startup.*timed out/i)
    expect(ownedWorker?.threadId).toBe(-1)
  })

  it('times out a count, terminates the worker, and retains the first failure on close', async () => {
    const databasePath = await createDatabase(0)
    const workerPath = await createWorker(`
      if (message.type === 'count') return
    `)
    let ownedWorker: Worker | undefined
    const workerFactory = (filename: string, options: WorkerOptions): Worker => {
      const worker = new Worker(filename, options)
      ownedWorker = worker
      return worker
    }
    const inspection = await openLegacyObjectInspection(databasePath, {
      workerPath,
      countTimeoutMs: 20,
      workerFactory,
    })

    await expect(inspection.count()).rejects.toThrow(/count request.*timed out/i)
    expect(ownedWorker?.threadId).toBe(-1)
    await expect(inspection.close()).rejects.toThrow(/count request.*timed out/i)
  })

  it('times out close and joins a worker that ignores close', async () => {
    const databasePath = await createDatabase(0)
    const workerPath = await createWorker('')
    let ownedWorker: Worker | undefined
    const workerFactory = (filename: string, options: WorkerOptions): Worker => {
      const worker = new Worker(filename, options)
      ownedWorker = worker
      return worker
    }
    const inspection = await openLegacyObjectInspection(databasePath, {
      workerPath,
      closeTimeoutMs: 20,
      workerFactory,
    })

    await expect(inspection.close()).rejects.toThrow(/close.*timed out/i)
    expect(ownedWorker?.threadId).toBe(-1)
  })

  it('cancels a pending count while close remains successful and shared', async () => {
    const databasePath = await createDatabase(0)
    const workerPath = await createWorker('')
    const inspection = await openLegacyObjectInspection(databasePath, { workerPath, closeTimeoutMs: 200 })
    const count = inspection.count()
    const firstClose = inspection.close()
    const secondClose = inspection.close()

    expect(secondClose).toBe(firstClose)
    await expect(count).rejects.toThrow(/was closed/i)
    await expect(firstClose).resolves.toBeUndefined()
  })

  it('rejects malformed startup thread identity', async () => {
    const databasePath = await createDatabase(0)
    const workerPath = await createWorker(`
      parentPort.postMessage({ type: 'ready', threadId: 0 })
    `, false)

    await expect(openLegacyObjectInspection(databasePath, { workerPath, startupTimeoutMs: 100 }))
      .rejects.toThrow(/threadId/i)
  })

  it.each([
    ['unknown reply', "parentPort.postMessage({ type: 'mystery' })", /unknown|protocol/i],
    ['wrong request id', "parentPort.postMessage({ type: 'count', requestId: message.requestId + 1, count: 0, queryMs: 0, threadId })", /requestId/i],
    ['wrong thread id', "parentPort.postMessage({ type: 'count', requestId: message.requestId, count: 0, queryMs: 0, threadId: threadId + 1 })", /threadId/i],
    ['negative count', "parentPort.postMessage({ type: 'count', requestId: message.requestId, count: -1, queryMs: 0, threadId })", /count/i],
    ['unsafe count', "parentPort.postMessage({ type: 'count', requestId: message.requestId, count: Number.MAX_SAFE_INTEGER + 1, queryMs: 0, threadId })", /count/i],
    ['negative query time', "parentPort.postMessage({ type: 'count', requestId: message.requestId, count: 0, queryMs: -1, threadId })", /queryMs/i],
    ['nonfinite query time', "parentPort.postMessage({ type: 'count', requestId: message.requestId, count: 0, queryMs: NaN, threadId })", /queryMs/i],
  ])('rejects %s protocol replies and surfaces the first failure on close', async (_name, response, errorPattern) => {
    const databasePath = await createDatabase(0)
    const workerPath = await createWorker(response)
    const inspection = await openLegacyObjectInspection(databasePath, { workerPath, countTimeoutMs: 100 })

    await expect(inspection.count()).rejects.toThrow(errorPattern)
    await expect(inspection.close()).rejects.toThrow(errorPattern)
  })

  it('rejects a duplicate count reply after the first reply was accepted', async () => {
    const databasePath = await createDatabase(0)
    const workerPath = await createWorker(`
      if (message.type === 'count') {
        const reply = { type: 'count', requestId: message.requestId, count: 0, queryMs: 0, threadId }
        parentPort.postMessage(reply)
        setImmediate(() => parentPort.postMessage(reply))
      }
    `)
    let ownedWorker: Worker | undefined
    let workerExit: Promise<number> | undefined
    const workerFactory = (filename: string, options: WorkerOptions): Worker => {
      const worker = new Worker(filename, options)
      ownedWorker = worker
      workerExit = new Promise((resolve) => worker.once('exit', resolve))
      return worker
    }
    const inspection = await openLegacyObjectInspection(databasePath, {
      workerPath,
      closeTimeoutMs: 100,
      workerFactory,
    })

    await expect(inspection.count()).resolves.toMatchObject({ count: 0 })
    await expect(workerExit).resolves.toEqual(expect.any(Number))
    expect(ownedWorker?.threadId).toBe(-1)
    await expect(inspection.close()).rejects.toThrow(/duplicate|unexpected|protocol/i)
  })

  it('retains an idle worker error and rejects close with it', async () => {
    const databasePath = await createDatabase(0)
    const workerPath = await createWorker('', true, `
      setTimeout(() => parentPort.postMessage({ type: 'error', message: 'idle worker failure' }), 10)
    `)
    let ownedWorker: Worker | undefined
    let workerExit: Promise<number> | undefined
    const workerFactory = (filename: string, options: WorkerOptions): Worker => {
      const worker = new Worker(filename, options)
      ownedWorker = worker
      workerExit = new Promise((resolve) => worker.once('exit', resolve))
      return worker
    }
    const inspection = await openLegacyObjectInspection(databasePath, {
      workerPath,
      closeTimeoutMs: 100,
      workerFactory,
    })
    await expect(workerExit)
      .resolves.toEqual(expect.any(Number))

    await expect(inspection.close()).rejects.toThrow('idle worker failure')
    expect(ownedWorker?.threadId).toBe(-1)
  })

  /** Creates a temporary mission-object table with the requested row count. */
  async function createDatabase(rowCount: number): Promise<string> {
    temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'sartracker-legacy-object-inspection-'))
    const databasePath = path.join(temporaryDirectory, 'mission-store.sqlite')
    const database = new Database(databasePath)
    database.exec('CREATE TABLE mission_object_versions (id INTEGER PRIMARY KEY)')
    if (rowCount > 0) {
      database.exec(`
        WITH RECURSIVE numbers(value) AS (
          SELECT 1 UNION ALL SELECT value + 1 FROM numbers WHERE value < ${rowCount}
        ) INSERT INTO mission_object_versions (id) SELECT value FROM numbers;
      `)
    }
    database.close()
    return databasePath
  }

  /** Writes a focused worker fixture with optional startup fault behavior. */
  async function createWorker(
    body: string,
    includeReady = true,
    startup = '',
  ): Promise<string> {
    if (temporaryDirectory === undefined) {
      throw new Error('A temporary directory is required before creating a worker.')
    }
    const workerPath = path.join(temporaryDirectory, `fault-${Date.now()}-${Math.random()}.cjs`)
    const source = includeReady
      ? `
        const { parentPort, threadId } = require('node:worker_threads')
        parentPort.postMessage({ type: 'ready', threadId })
        ${startup}
        parentPort.on('message', (message) => {
          ${body}
        })
      `
      : `
        const { parentPort } = require('node:worker_threads')
        ${body}
      `
    await writeFile(workerPath, source, 'utf8')
    return workerPath
  }
})
