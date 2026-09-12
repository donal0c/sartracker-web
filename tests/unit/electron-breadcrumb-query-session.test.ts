import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { setTimeout as realDelay } from 'node:timers/promises'

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBreadcrumbRecordDecoder } from '../../src/infrastructure/mission-store/breadcrumb-query-client'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')
const { listBreadcrumbPositions } = require('../../electron/breadcrumb-query.cjs')
const { startBreadcrumbQuerySession } = require('../../electron/breadcrumb-query-session.cjs') as {
  startBreadcrumbQuerySession(input: {
    databasePath: string; missionId: string; perDeviceLimit: number
    signal?: AbortSignal; workerPath?: string; timeoutMs?: number; absoluteTimeoutMs?: number; exitGraceMs?: number
  }): Promise<Session>
}
type Manifest = { version: 1; positionCount: number; deviceTotalCount: number
  deviceSelectionCount: number; droppedPositionCount: number }
type Frame = { sequence: number; payload: string; done: boolean }
type Session = { manifest: Manifest; read(sequence: number): Promise<Frame>
  finish(): Promise<void>; cancel(): Promise<void>; completion: Promise<void> }

describe('bounded breadcrumb worker result sessions', () => {
  let directory: string | undefined
  const sessions: Session[] = []
  afterEach(async () => {
    vi.useRealTimers()
    await Promise.all(sessions.splice(0).map((session) => session.cancel()))
    if (directory !== undefined) await rm(directory, { recursive: true, force: true })
  })

  /** Starts a real native worker against a retained SQLite selector fixture. */
  async function nativeFixture() {
    directory = await mkdtemp(path.join(tmpdir(), 'sar-breadcrumb-session-'))
    const databasePath = path.join(directory, 'mission.sqlite')
    const database = new Database(databasePath)
    database.pragma('journal_mode = WAL')
    database.exec(`CREATE TABLE positions (
      id TEXT PRIMARY KEY, mission_id TEXT, device_id TEXT, source_position_id TEXT,
      name TEXT, lat REAL, lon REAL, altitude REAL, speed REAL, battery REAL,
      accuracy REAL, source TEXT, timestamp TEXT, data_origin TEXT,
      timestamp_source TEXT, received_at TEXT, content_hash TEXT,
      source_kind TEXT, timestamp_provenance_recorded_at TEXT
    )`)
    const insert = database.prepare(`INSERT INTO positions VALUES (
      ?, 'mission-a', ?, ?, ?, ?, -9, NULL, 0.125, 95, NULL, 'source', ?,
      'live', 'fix', NULL, NULL, 'traccar', 'legacy-provenance'
    )`)
    database.transaction(() => {
      for (let index = 0; index < 600; index += 1) {
        insert.run(`row-${index}`, `device-${index % 3}`, index % 2 ? null : `source-${index}`,
          index === 300 ? 'Oversized 🧭\n"record" '.repeat(6_000) : `Éire ${index}`,
          52 + index / 100_000, new Date(1_700_000_000_000 + index * 1_000).toISOString())
      }
      insert.run('invalid', 'device-0', 'invalid', 'retained invalid', 95, 'invalid-time')
    })()
    const expected = listBreadcrumbPositions(database, 'mission-a', 5_000)
    database.close()
    const session = await startBreadcrumbQuerySession({ databasePath, missionId: 'mission-a', perDeviceLimit: 5_000 })
    sessions.push(session)
    return { session, expected, databasePath }
  }

  /** Creates a worker protocol control without launching the application. */
  async function controlledWorker(body: string, timeoutMs = 2_000, options: { absoluteTimeoutMs?: number; exitGraceMs?: number } = {}) {
    directory = await mkdtemp(path.join(tmpdir(), 'sar-breadcrumb-session-control-'))
    const workerPath = path.join(directory, 'worker.cjs')
    await writeFile(workerPath, `const { parentPort, threadId } = require('node:worker_threads')
      parentPort.postMessage({ type: 'ready', workerThreadId: threadId, manifest: {
        version: 1, positionCount: 0, deviceTotalCount: 0, deviceSelectionCount: 0, droppedPositionCount: 0
      } })\n${body}`)
    const session = await startBreadcrumbQuerySession({ databasePath: 'unused', missionId: 'mission-a',
      perDeviceLimit: 5_000, workerPath, timeoutMs, ...options })
    sessions.push(session)
    return session
  }

  it('frames the exact single-snapshot selector result, including oversized records and every stored field', async () => {
    const { session, expected, databasePath } = await nativeFixture()
    expect(session.manifest).toEqual({ version: 1, positionCount: expected.positions.length,
      deviceTotalCount: expected.deviceTotals.length, deviceSelectionCount: expected.deviceSelections.length,
      droppedPositionCount: expected.droppedPositionCount })
    // The snapshot is already closed: later storage edits cannot change this result.
    const writer = new Database(databasePath)
    writer.prepare("UPDATE positions SET name = 'changed after selection'").run()
    writer.close()
    let pending = ''
    const records: { kind: string; value: unknown }[] = []
    const decoder = createBreadcrumbRecordDecoder((record) => records.push({ kind: String(record.kind), value: record.value }))
    let frames = 0
    for (let sequence = 0; ; sequence += 1) {
      const frame = await session.read(sequence)
      expect(frame.sequence).toBe(sequence)
      expect(frame.payload.length).toBeLessThanOrEqual(32_768)
      expect(Object.keys(frame).sort()).toEqual(['done', 'payload', 'sequence'])
      pending += frame.payload
      const lines = pending.split('\n')
      pending = lines.pop() ?? ''
      for (const line of lines) decoder.acceptLine(line)
      frames += 1
      if (frame.done) break
    }
    expect(pending).toBe('')
    decoder.finish()
    expect(frames).toBeGreaterThan(4)
    expect(records).toEqual([
      ...expected.positions.map((value: unknown) => ({ kind: 'position', value })),
      ...expected.deviceTotals.map((value: unknown) => ({ kind: 'deviceTotal', value })),
      ...expected.deviceSelections.map((value: unknown) => ({ kind: 'deviceSelection', value })),
    ])
    await expect(session.finish()).resolves.toBeUndefined()
    await expect(session.completion).resolves.toBeUndefined()
  })

  it('rejects reads after a successful clean finish', async () => {
    const session = await controlledWorker(`parentPort.on('message', (message) => {
      if (message.type === 'read') parentPort.postMessage({ type: 'frame', sequence: 0, payload: '', done: true })
      if (message.type === 'finish') { parentPort.postMessage({ type: 'finished' }); parentPort.close() }
    })`)
    await session.read(0)
    await session.finish()
    await expect(session.read(1)).rejects.toThrow('no further frames')
  })

  it('keeps completion pending until finish and clean worker exit', async () => {
    const session = await controlledWorker(`parentPort.on('message', message => {
      if (message.type === 'read') parentPort.postMessage({ type: 'frame', sequence: message.sequence, payload: '', done: true })
      if (message.type === 'finish') {
        parentPort.postMessage({ type: 'finished' })
        setTimeout(() => parentPort.close(), 120)
      }
    })`)
    await session.read(0)
    const finish = session.finish()
    await expect(Promise.race([finish.then(() => 'finished'),
      new Promise((resolve) => setTimeout(() => resolve('worker still running'), 20))])).resolves.toBe('worker still running')
    await finish
  })

  it.each(['early', 'sequence', 'concurrent'])('rejects invalid client progress and joins cancellation: %s', async (kind) => {
    const session = await controlledWorker(`parentPort.on('message', () => {})`)
    const rejection = kind === 'early' ? session.finish() : kind === 'sequence' ? session.read(1)
      : (() => { void session.read(0).catch(() => undefined); return session.read(0) })()
    await expect(rejection).rejects.toThrow(/finish|sequence|pending|outstanding/i)
    await session.cancel()
    await expect(session.completion).rejects.toThrow()
  })

  it.each(['wrong sequence', 'oversized frame', 'exit without finish'])('fails closed for worker protocol corruption: %s', async (kind) => {
    const session = await controlledWorker(kind === 'exit without finish'
      ? `parentPort.on('message', () => parentPort.close())`
      : `parentPort.on('message', () => parentPort.postMessage({ type: 'frame', sequence: ${kind === 'wrong sequence' ? 1 : 0},
          payload: ${kind === 'oversized frame' ? "'x'.repeat(32769)" : "''"}, done: true }))`)
    await expect(session.read(0)).rejects.toThrow(/frame|sequence|exit/i)
    await expect(session.completion).rejects.toThrow()
  })

  it('cancels an outstanding pull and joins worker termination', async () => {
    const session = await controlledWorker(`parentPort.on('message', () => {})`)
    const read = session.read(0)
    const rejected = expect(read).rejects.toMatchObject({ name: 'AbortError' })
    await session.cancel()
    await rejected
    await expect(session.completion).rejects.toMatchObject({ name: 'AbortError' })
    await expect(session.read(1)).rejects.toThrow()
  })

  it('bounds a stalled receiver session and joins termination on timeout', async () => {
    const session = await controlledWorker(`parentPort.on('message', () => {})`, 150)
    await expect(session.completion).rejects.toThrow(/timed out/i)
    await expect(session.completion).rejects.toMatchObject({ code: 'BREADCRUMB_QUERY_INACTIVITY' })
  })

  it('renews the inactivity watchdog for valid frames across a longer healthy transfer', async () => {
    vi.useFakeTimers()
    const session = await controlledWorker(`parentPort.on('message', message => {
      if (message.type === 'read') parentPort.postMessage({ type: 'frame', sequence: message.sequence,
        payload: 'x', done: message.sequence === 3 })
      if (message.type === 'finish') { parentPort.postMessage({ type: 'finished' }); parentPort.close() }
    })`, 100)
    for (let sequence = 0; sequence < 4; sequence += 1) {
      await vi.advanceTimersByTimeAsync(80)
      await expect(session.read(sequence)).resolves.toMatchObject({ sequence })
    }
    await expect(session.finish()).resolves.toBeUndefined()
  })

  it('still terminates and joins a receiver that stalls after valid progress', async () => {
    vi.useFakeTimers()
    const session = await controlledWorker(`parentPort.on('message', message => {
      if (message.type === 'read') parentPort.postMessage({ type: 'frame', sequence: message.sequence, payload: 'x', done: false })
    })`, 100)
    await vi.advanceTimersByTimeAsync(80)
    await session.read(0)
    const rejected = expect(session.completion).rejects.toThrow(/timed out/i)
    await vi.advanceTimersByTimeAsync(101)
    await rejected
    await session.cancel()
  })

  it('does not start an already cancelled query', async () => {
    await expect(startBreadcrumbQuerySession({ databasePath: 'unused', missionId: 'mission-a',
      perDeviceLimit: 5_000, signal: AbortSignal.abort() })).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('joins termination at an absolute ceiling despite continuing valid progress', async () => {
    vi.useFakeTimers()
    const session = await controlledWorker(`parentPort.on('message', message => {
      parentPort.postMessage({ type: 'frame', sequence: message.sequence, payload: 'x', done: false })
    })`, 100, { absoluteTimeoutMs: 250 })
    for (let sequence = 0; sequence < 3; sequence += 1) {
      await vi.advanceTimersByTimeAsync(80)
      await session.read(sequence)
    }
    const rejection = expect(session.completion).rejects.toThrow(/absolute/i)
    await vi.advanceTimersByTimeAsync(11)
    await rejection
    await expect(session.completion).rejects.toMatchObject({ code: 'BREADCRUMB_QUERY_ABSOLUTE' })
    await session.cancel()
  })

  it('replaces inactivity with exit grace after acknowledgement while still joining exit', async () => {
    vi.useFakeTimers()
    const session = await controlledWorker(`parentPort.on('message', message => {
      if (message.type === 'read') parentPort.postMessage({ type: 'frame', sequence: 0, payload: '', done: true })
      if (message.type === 'finish') { parentPort.postMessage({ type: 'finished' }); setTimeout(() => parentPort.close(), 50) }
    })`, 100, { exitGraceMs: 500 })
    await session.read(0)
    await vi.advanceTimersByTimeAsync(90)
    const finish = session.finish()
    // Let the real worker deliver acknowledgement before advancing main's clock.
    await realDelay(15)
    await vi.advanceTimersByTimeAsync(20)
    await expect(finish).resolves.toBeUndefined()
  })

  it.each([
    ['SQLITE_CANTOPEN', 'secret /private/mission.sqlite', 'STORAGE'],
    ['MODULE_NOT_FOUND', 'Cannot find module /private/native.node', 'MODULE'],
    ['ERR_WORKER_OUT_OF_MEMORY', 'secret heap details', 'MEMORY'],
    ['UNKNOWN', 'private data and /private/path', 'WORKER'],
  ])('sanitizes worker failure category %s', async (code, message, category) => {
    const session = await controlledWorker(`parentPort.on('message', () => {
      parentPort.postMessage({type:'error', code:${JSON.stringify(code)}, message:${JSON.stringify(message)}})
    })`)
    const error = await session.read(0).catch((failure: Error) => failure)
    expect(error).toMatchObject({ code: `BREADCRUMB_QUERY_${category}` })
    expect(String(error)).not.toMatch(/private|secret|native\.node/)
    expect((error as Error).stack).toBe(`Error: ${(error as Error).message}`)
  })

  it('terminates and joins an acknowledged worker that never exits', async () => {
    vi.useFakeTimers()
    const session = await controlledWorker(`parentPort.on('message', message => {
      if (message.type === 'read') parentPort.postMessage({ type: 'frame', sequence: 0, payload: '', done: true })
      if (message.type === 'finish') parentPort.postMessage({ type: 'finished' })
    })`, 1_000, { exitGraceMs: 100 })
    await session.read(0)
    const rejected = expect(session.finish()).rejects.toThrow(/grace period/)
    await realDelay(15)
    await vi.advanceTimersByTimeAsync(101)
    await rejected
    await expect(session.completion).rejects.toMatchObject({ code: 'BREADCRUMB_QUERY_EXIT_GRACE' })
    await session.cancel()
  })

  it('sanitizes synchronous worker constructor errors', async () => {
    const error = await startBreadcrumbQuerySession({ databasePath: '/private/mission.sqlite', missionId: 'mission-a',
      perDeviceLimit: 5_000, workerPath: 'private-invalid-relative-path' }).catch((failure: Error) => failure)
    expect(error).toMatchObject({ code: 'BREADCRUMB_QUERY_MODULE' })
    expect(String(error)).not.toContain('private')
    expect(JSON.stringify(error, Object.getOwnPropertyNames(error))).not.toMatch(/private|\.codex|\.cjs|\.ts|asar/)
  })
})
