import { createRequire } from 'node:module'
import { constants } from 'node:fs'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'

import { afterEach, describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')
const { runMissionReviewReadQueryInWorker } = require(
  '../../electron/mission-review-read-query-runner.cjs',
) as {
  readonly runMissionReviewReadQueryInWorker: (input: {
    readonly databasePath: string
    readonly query: {
      readonly missionId: string
      readonly includeTelemetry: boolean
      readonly auditLimit: number
    }
    readonly workerPath?: string
    readonly timeoutMs?: number
    readonly signal?: AbortSignal
    readonly createWorker?: () => EventEmitter & { readonly terminate: () => Promise<number> }
  }) => Promise<{
    readonly auditEvents: readonly { readonly id: string }[]
    readonly breadcrumbCount: number
    readonly workerThreadId: number
  }> & { readonly workerExited?: Promise<void> }
}

describe('Mission Review read worker boundary [DON-251]', () => {
  let tempDirectory: string | undefined

  afterEach(async () => {
    if (tempDirectory !== undefined) {
      await rm(tempDirectory, { recursive: true, force: true })
      tempDirectory = undefined
    }
  })

  it('returns only the bounded audit page and scalar count from a read-only worker', async () => {
    tempDirectory = await mkdtemp(path.join(tmpdir(), 'sartracker-review-worker-'))
    const databasePath = path.join(tempDirectory, 'mission-store.sqlite')
    const database = new Database(databasePath)
    database.exec(`
      CREATE TABLE missions (id TEXT PRIMARY KEY);
      CREATE TABLE mission_cleanup_journal (mission_id TEXT PRIMARY KEY, state TEXT NOT NULL);
      CREATE TABLE positions (
        id TEXT PRIMARY KEY,
        mission_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        timestamp TEXT NOT NULL
      );
      CREATE TABLE mission_events (
        id TEXT PRIMARY KEY,
        mission_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        details_json TEXT
      );
      INSERT INTO missions VALUES ('mission-1');
      INSERT INTO positions VALUES
        ('position-1', 'mission-1', 'device-1', '2026-08-20T08:00:00.000Z'),
        ('position-2', 'mission-1', 'device-1', '2026-08-20T08:01:00.000Z');
      INSERT INTO mission_events VALUES
        ('operator-1', 'mission-1', 'marker_created', '2026-08-20T08:00:00.000Z', NULL),
        ('telemetry-1', 'mission-1', 'position_recorded', '2026-08-20T08:01:00.000Z', NULL),
        ('operator-2', 'mission-1', 'drawing_created', '2026-08-20T08:02:00.000Z', NULL);
    `)
    database.close()

    const result = await runMissionReviewReadQueryInWorker({
      databasePath,
      query: {
        missionId: 'mission-1',
        includeTelemetry: false,
        auditLimit: 1,
      },
    })

    expect(result.workerThreadId).toBeGreaterThan(0)
    expect(result.breadcrumbCount).toBe(2)
    expect(result.auditEvents.map((event) => event.id)).toEqual(['operator-2'])
    expect(Object.keys(result).sort()).toEqual([
      'auditEvents',
      'breadcrumbCount',
      'workerThreadId',
    ])
  })

  it('keeps the main event loop responsive during a deliberately slow review query', async () => {
    const timerGaps: number[] = []
    let lastTimerAt = performance.now()
    const timer = setInterval(() => {
      const now = performance.now()
      timerGaps.push(now - lastTimerAt)
      lastTimerAt = now
    }, 5)

    const result = await runMissionReviewReadQueryInWorker({
      databasePath: '/unused/by/fixture.sqlite',
      query: {
        missionId: 'mission-1',
        includeTelemetry: false,
        auditLimit: 501,
      },
      workerPath: path.resolve(
        'tests/fixtures/slow-mission-review-read-query-worker.cjs',
      ),
    })
    clearInterval(timer)

    expect(result.breadcrumbCount).toBe(0)
    expect(Math.max(...timerGaps)).toBeLessThan(200)
  })

  it('rejects an over-8 MiB details payload inside the worker before structured clone', async () => {
    tempDirectory = await mkdtemp(path.join(tmpdir(), 'sartracker-review-worker-output-bound-'))
    const databasePath = path.join(tempDirectory, 'mission-store.sqlite')
    const oversizedPostMessageSentinel = `${databasePath}.oversized-post-message`
    const database = new Database(databasePath)
    database.exec(`
      CREATE TABLE missions (id TEXT PRIMARY KEY);
      CREATE TABLE mission_cleanup_journal (mission_id TEXT PRIMARY KEY, state TEXT NOT NULL);
      CREATE TABLE positions (
        id TEXT PRIMARY KEY,
        mission_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        timestamp TEXT NOT NULL
      );
      CREATE TABLE mission_events (
        id TEXT PRIMARY KEY,
        mission_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        details_json TEXT
      );
      INSERT INTO missions VALUES ('mission-1');
    `)
    database.prepare(`INSERT INTO mission_events (
      id, mission_id, event_type, timestamp, details_json
    ) VALUES (?, ?, ?, ?, ?)`).run(
      'oversized-details-event',
      'mission-1',
      'marker_created',
      '2026-08-20T08:00:00.000Z',
      JSON.stringify({ evidence: 'A'.repeat(8 * 1024 * 1024) }),
    )
    database.close()

    const timerGaps: number[] = []
    let lastTimerAt = performance.now()
    const timer = setInterval(() => {
      const now = performance.now()
      timerGaps.push(now - lastTimerAt)
      lastTimerAt = now
    }, 5)
    let workerFailure: unknown
    try {
      await runMissionReviewReadQueryInWorker({
        databasePath,
        query: {
          missionId: 'mission-1',
          includeTelemetry: false,
          auditLimit: 1,
        },
        workerPath: path.resolve(
          'tests/fixtures/mission-review-read-query-post-message-probe-worker.cjs',
        ),
      })
    } catch (error) {
      workerFailure = error
    } finally {
      clearInterval(timer)
    }

    let oversizedPostMessageObserved = true
    try {
      await access(oversizedPostMessageSentinel, constants.F_OK)
    } catch (error) {
      oversizedPostMessageObserved = (error as NodeJS.ErrnoException).code !== 'ENOENT'
    }
    expect.soft(
      oversizedPostMessageObserved,
      'the worker must reject before an oversized result reaches postMessage',
    ).toBe(false)
    expect.soft(workerFailure).toBeInstanceOf(Error)
    expect.soft(String(workerFailure)).toMatch(
      /8\s*MiB|8388608|result.*limit|payload.*limit|output.*limit/iu,
    )
    expect(timerGaps.length).toBeGreaterThan(0)
    expect(Math.max(...timerGaps)).toBeLessThan(200)
  })

  it('terminates an obsolete query when its abort signal is cancelled', async () => {
    const controller = new AbortController()
    const query = runMissionReviewReadQueryInWorker({
      databasePath: '/unused/by/fixture.sqlite',
      query: {
        missionId: 'mission-1',
        includeTelemetry: false,
        auditLimit: 501,
      },
      workerPath: path.resolve(
        'tests/fixtures/slow-mission-review-read-query-worker.cjs',
      ),
      signal: controller.signal,
    })

    controller.abort()

    await expect(query).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('rejects cancellation without waiting for a blocked worker termination', async () => {
    const controller = new AbortController()
    const worker = Object.assign(new EventEmitter(), {
      terminate: () => new Promise<number>(() => undefined),
    })
    const createWorker = vi.fn(() => worker)
    const query = runMissionReviewReadQueryInWorker({
      databasePath: '/unused.sqlite',
      query: {
        missionId: 'mission-1',
        includeTelemetry: false,
        auditLimit: 501,
      },
      signal: controller.signal,
      createWorker,
    })

    controller.abort()

    await expect(Promise.race([
      query,
      new Promise((_resolve, reject) => setTimeout(
        () => reject(new Error('cancellation stayed pending')),
        100,
      )),
    ])).rejects.toMatchObject({ name: 'AbortError' })
    expect(createWorker).toHaveBeenCalledOnce()
  })

  it('surfaces a bounded worker error for an unreadable database', async () => {
    await expect(
      runMissionReviewReadQueryInWorker({
        databasePath: '/missing/mission-store.sqlite',
        query: {
          missionId: 'mission-1',
          includeTelemetry: false,
          auditLimit: 501,
        },
      }),
    ).rejects.toThrow(/Mission Review read worker failed/u)
  })

  it('settles its worker slot when worker construction throws synchronously', async () => {
    const constructionError = new Error('worker threads unavailable')
    const query = runMissionReviewReadQueryInWorker({
      databasePath: '/unused.sqlite',
      query: {
        missionId: 'mission-1',
        includeTelemetry: false,
        auditLimit: 501,
      },
      createWorker: () => {
        throw constructionError
      },
    })

    await expect(query).rejects.toBe(constructionError)
    await expect(Promise.race([
      query.workerExited,
      new Promise((_resolve, reject) => setTimeout(
        () => reject(new Error('worker slot stayed pending')),
        100,
      )),
    ])).resolves.toBeUndefined()
  })
})
