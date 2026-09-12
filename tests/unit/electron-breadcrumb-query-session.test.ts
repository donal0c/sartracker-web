import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

import { afterEach, describe, expect, it } from 'vitest'
import { createBreadcrumbRecordDecoder } from '../../src/infrastructure/mission-store/breadcrumb-query-client'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')
const { listBreadcrumbPositions } = require('../../electron/breadcrumb-query.cjs')
const { startBreadcrumbQuerySession } = require('../../electron/breadcrumb-query-session.cjs') as {
  startBreadcrumbQuerySession(input: {
    databasePath: string; missionId: string; perDeviceLimit: number
    signal?: AbortSignal; workerPath?: string; timeoutMs?: number
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
  async function controlledWorker(body: string, timeoutMs = 2_000) {
    directory = await mkdtemp(path.join(tmpdir(), 'sar-breadcrumb-session-control-'))
    const workerPath = path.join(directory, 'worker.cjs')
    await writeFile(workerPath, `const { parentPort, threadId } = require('node:worker_threads')
      parentPort.postMessage({ type: 'ready', workerThreadId: threadId, manifest: {
        version: 1, positionCount: 0, deviceTotalCount: 0, deviceSelectionCount: 0, droppedPositionCount: 0
      } })\n${body}`)
    const session = await startBreadcrumbQuerySession({ databasePath: 'unused', missionId: 'mission-a',
      perDeviceLimit: 5_000, workerPath, timeoutMs })
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
  })

  it('does not start an already cancelled query', async () => {
    await expect(startBreadcrumbQuerySession({ databasePath: 'unused', missionId: 'mission-a',
      perDeviceLimit: 5_000, signal: AbortSignal.abort() })).rejects.toMatchObject({ name: 'AbortError' })
  })
})
