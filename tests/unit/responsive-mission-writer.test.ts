import { createRequire } from 'node:module'
import { afterEach, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')
const { createResponsiveMissionWriter } = require('../../electron/responsive-mission-writer.cjs') as {
  createResponsiveMissionWriter: (database: unknown) => {
    run: <T>(callback: () => T, options?: { signal?: AbortSignal }) => Promise<T>
    close: () => Promise<void>
    readonly pendingCount: number
  }
}
afterEach(() => vi.useRealTimers())

it('rolls back an owned transaction left open by a failing transaction wrapper', async () => {
  const db = new Database(':memory:')
  db.exec('CREATE TABLE evidence (value TEXT)')
  const failure = new Error('transaction wrapper rollback failed')
  let first = true
  const adapter = {
    get inTransaction() { return db.inTransaction },
    pragma: db.pragma.bind(db),
    exec: db.exec.bind(db),
    transaction: (callback: () => unknown) => ({ immediate: () => {
      if (!first) return db.transaction(callback).immediate()
      first = false
      db.exec("BEGIN IMMEDIATE; INSERT INTO evidence VALUES ('partial')")
      throw failure
    } }),
  }
  const writer = createResponsiveMissionWriter(adapter)
  try {
    await expect(writer.run(() => undefined)).rejects.toBe(failure)
    expect(db.inTransaction).toBe(false)
    expect(db.prepare('SELECT * FROM evidence').all()).toEqual([])
    await expect(writer.run(() => 42)).resolves.toBe(42)
  } finally { await writer.close(); db.close() }
})

it('quarantines its writer when an owned transaction cannot be rolled back', async () => {
  let inTransaction = false
  const callback = vi.fn()
  const writer = createResponsiveMissionWriter({
    get inTransaction() { return inTransaction },
    pragma: () => 5000,
    exec: () => { throw new Error('I/O failure') },
    transaction: () => ({ immediate: () => {
      inTransaction = true
      throw new Error('write failed')
    } }),
  })
  await expect(writer.run(callback)).rejects.toMatchObject({ code: 'MISSION_WRITER_FAULTED' })
  await expect(writer.run(callback)).rejects.toMatchObject({ code: 'MISSION_WRITER_FAULTED' })
  expect(callback).not.toHaveBeenCalled()
  await writer.close()
})

it('rolls back the complete attempt, restores SQLite configuration and preserves admitted write order', async () => {
  vi.useFakeTimers()
  const db = new Database(':memory:')
  db.exec('CREATE TABLE evidence (value TEXT)')
  const writer = createResponsiveMissionWriter(db)
  const order: string[] = []
  let attempts = 0
  try {
    const first = writer.run(() => {
      expect(db.pragma('busy_timeout', { simple: true })).toBe(0)
      db.prepare('INSERT INTO evidence VALUES (?)').run('older')
      if (++attempts === 1) throw Object.assign(new Error('busy'), { code: 'SQLITE_BUSY_SNAPSHOT' })
      order.push('older')
    })
    const second = writer.run(() => {
      order.push('newer')
      db.prepare('INSERT INTO evidence VALUES (?)').run('newer')
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(db.inTransaction).toBe(false)
    expect(db.pragma('busy_timeout', { simple: true })).toBe(5000)
    expect(db.prepare('SELECT * FROM evidence').all()).toEqual([])
    expect(writer.pendingCount).toBe(2)
    await vi.runAllTimersAsync()
    await Promise.all([first, second])
    expect(order).toEqual(['older', 'newer'])
    expect(db.prepare('SELECT * FROM evidence').all()).toEqual([{ value: 'older' }, { value: 'newer' }])
    expect(db.pragma('busy_timeout', { simple: true })).toBe(5000)
    expect(writer.pendingCount).toBe(0)
  } finally { await writer.close(); db.close() }
})

it('stops an explicitly cancelled sleeping attempt', async () => {
  vi.useFakeTimers()
  const db = new Database(':memory:')
  const writer = createResponsiveMissionWriter(db)
  const controller = new AbortController()
  const callback = vi.fn(() => { throw Object.assign(new Error('busy'), { code: 'SQLITE_BUSY' }) })
  try {
    const pending = writer.run(callback, { signal: controller.signal })
    const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    await vi.advanceTimersByTimeAsync(0)
    controller.abort()
    await rejection
    await vi.runAllTimersAsync()
    expect(callback).toHaveBeenCalledTimes(1)
    expect(db.inTransaction).toBe(false)
    expect(db.pragma('busy_timeout', { simple: true })).toBe(5000)
  } finally { await writer.close(); db.close() }
})

it('drains admitted writes through contention on close and rejects new admissions', async () => {
  vi.useFakeTimers()
  const db = new Database(':memory:')
  db.exec('CREATE TABLE edits (value TEXT)')
  const writer = createResponsiveMissionWriter(db)
  let attempts = 0
  try {
    const first = writer.run(() => {
      db.prepare('INSERT INTO edits VALUES (?)').run('participant')
      if (++attempts === 1) throw Object.assign(new Error('busy'), { code: 'SQLITE_BUSY' })
    })
    const second = writer.run(() => db.prepare('INSERT INTO edits VALUES (?)').run('outing'))
    // Observe both outcomes immediately, including on the broken implementation.
    const outcomes = Promise.allSettled([first, second])
    await vi.advanceTimersByTimeAsync(0)
    const closing = writer.close()
    await expect(writer.run(() => 1)).rejects.toMatchObject({ name: 'AbortError' })
    await vi.runAllTimersAsync()
    await closing
    expect((await outcomes).map((outcome) => outcome.status)).toEqual(['fulfilled', 'fulfilled'])
    expect(db.prepare('SELECT value FROM edits ORDER BY rowid').all()).toEqual([
      { value: 'participant' }, { value: 'outing' },
    ])
    expect(writer.pendingCount).toBe(0)
    expect(db.inTransaction).toBe(false)
  } finally { await writer.close(); db.close() }
})

it('stops at a finite busy retry budget without committing partial evidence', async () => {
  vi.useFakeTimers()
  const db = new Database(':memory:')
  db.exec('CREATE TABLE evidence (value TEXT)')
  const writer = createResponsiveMissionWriter(db)
  const callback = vi.fn(() => {
    db.prepare('INSERT INTO evidence VALUES (?)').run('partial')
    throw Object.assign(new Error('busy'), { code: 'SQLITE_BUSY' })
  })
  try {
    const pending = writer.run(callback)
    const rejection = expect(pending).rejects.toMatchObject({ code: 'SQLITE_BUSY' })
    await vi.runAllTimersAsync()
    await rejection
    expect(callback).toHaveBeenCalledTimes(241)
    expect(db.prepare('SELECT * FROM evidence').all()).toEqual([])
    expect(db.inTransaction).toBe(false)
    expect(db.pragma('busy_timeout', { simple: true })).toBe(5000)
  } finally { await writer.close(); db.close() }
})

it('does not retry non-busy failures or enter an existing transaction', async () => {
  const db = new Database(':memory:')
  const writer = createResponsiveMissionWriter(db)
  const failure = Object.assign(new Error('invalid evidence'), { code: 'SQLITE_CONSTRAINT' })
  const callback = vi.fn(() => { throw failure })
  try {
    await expect(writer.run(callback)).rejects.toBe(failure)
    expect(callback).toHaveBeenCalledTimes(1)
    db.exec('BEGIN')
    await expect(writer.run(() => 1)).rejects.toThrow(/transaction/)
    expect(db.inTransaction).toBe(true)
    db.exec('ROLLBACK')
    expect(db.pragma('busy_timeout', { simple: true })).toBe(5000)
  } finally { await writer.close(); db.close() }
})

it('rejects asynchronous callbacks and rolls back a thenable returned by a synchronous callback', async () => {
  const db = new Database(':memory:')
  db.exec('CREATE TABLE evidence (value TEXT)')
  const writer = createResponsiveMissionWriter(db)
  let asynchronousCalled = false
  /** Represents an invalid asynchronous database callback without a mock wrapper. */
  async function asynchronous() { asynchronousCalled = true; return 1 }
  try {
    await expect(writer.run(asynchronous)).rejects.toThrow(/synchronous/)
    expect(asynchronousCalled).toBe(false)
    await expect(writer.run(() => {
      db.prepare('INSERT INTO evidence VALUES (?)').run('partial')
      return Promise.resolve(1)
    })).rejects.toThrow(/synchronous/)
    expect(db.prepare('SELECT * FROM evidence').all()).toEqual([])
    expect(db.inTransaction).toBe(false)
    expect(db.pragma('busy_timeout', { simple: true })).toBe(5000)
  } finally { await writer.close(); db.close() }
})
